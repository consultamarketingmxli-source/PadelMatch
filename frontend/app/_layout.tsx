import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect, useRef, useState } from "react";
import { LogBox, Platform } from "react-native";
import { StatusBar } from "expo-status-bar";
import { useRouter, useSegments } from "expo-router";
import * as Linking from "expo-linking";
import * as Sentry from "@sentry/react-native";

import { useIconFonts } from "@/src/hooks/use-icon-fonts";
import { useAppFonts } from "@/src/hooks/use-app-fonts";
import { Toast } from "@/src/components/Toast";
import { onAuthExpired } from "@/src/api";
import { registerGuardToast } from "@/src/hooks/useRequireAdmin";
import { clearLastRole } from "@/src/utils/roleSelection";
import { AppErrorBoundary } from "@/src/components/AppErrorBoundary";
import { playerTokenStore } from "@/src/utils/playerTokenStore";
import { UserPlanProvider } from "@/src/stores/userPlanStore";
import { deepLinkStore, parseDeepLink } from "@/src/utils/deepLinkStore";

// ===================== Push Notifications · MODULE SCOPE =====================
// IMPORTANTE: estos imports DEBEN estar guardados antes de tocarse en web
// (expo-notifications crashea fuera de nativo). Por eso usamos require() lazy.
//
// El handler controla cómo se MUESTRA una notif cuando llega en foreground.
// El channel "default" garantiza que Android tenga el canal listo ANTES de
// que llegue cualquier push (si no, se descartan).
if (Platform.OS !== "web") {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Notifications = require("expo-notifications");
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
  if (Platform.OS === "android") {
    Notifications.setNotificationChannelAsync("default", {
      name: "Default",
      importance: Notifications.AndroidImportance.MAX,
      sound: "default",
      lightColor: "#2563EB",
      vibrationPattern: [0, 250, 250, 250],
    });
  }
}

// ===================== Sentry init (Front-end Crash Reporting) =====================
const SENTRY_DSN = process.env.EXPO_PUBLIC_SENTRY_DSN || "";
if (SENTRY_DSN && !__DEV__) {
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: "production",
    release: "padelappretas@1.0.0",
    tracesSampleRate: 0.10,
    enableAutoSessionTracking: true,
    sendDefaultPii: false,
    // Redact PII en breadcrumbs y eventos antes de mandar
    beforeSend(event) {
      try {
        const req = event.request as any;
        if (req?.data && typeof req.data === "object") {
          for (const k of ["telefono", "phone", "email", "password", "access_token", "refresh_token"]) {
            if (k in req.data) req.data[k] = "<redacted>";
          }
        }
      } catch {}
      return event;
    },
    ignoreErrors: [
      // Expo Router / RN internal warnings
      "Non-serializable values were found in the navigation state",
      "Network request failed", // typical offline cases — manejados en UI
    ],
  });
}

// Silenciar warnings ruidosos provenientes de dependencias (no-blockers).
// Estos warnings vienen de:
//  • react-native-draggable-flatlist en web (useNativeDriver)
//  • react-native-screens / react-navigation internals (pointerEvents prop)
//  • Compatibilidad futura React 19 (element.ref)
// El comportamiento es correcto en iOS/Android nativo.
LogBox.ignoreLogs([
  "useNativeDriver",
  "props.pointerEvents is deprecated",
  "Accessing element.ref",
  "shadow* props are deprecated",
]);

SplashScreen.preventAutoHideAsync();

// ============================================================================
// Auth Gate — Rutas públicas (NO requieren login de jugador).
// El resto de rutas (/, /retas, /perfil, /mi-cuenta, /seleccion) requieren
// que el usuario tenga un token de jugador. Sin token → redirect a /login.
//
// Los organizadores tienen su propio flujo en /admin/* (no afectado por este gate).
// ============================================================================
const PUBLIC_ROUTES = new Set<string>([
  "login",         // Login de jugador (OTP por WhatsApp + Google Sign-In)
  "admin/login",   // Login de organizador
  "privacy",       // Iter56 — Política de Privacidad (público, Play/App Store)
  "+not-found",    // Pantalla 404
]);

function isPublicRoute(segments: string[]): boolean {
  const path = (segments || []).join("/");
  if (PUBLIC_ROUTES.has(path)) return true;
  // Todas las rutas /admin/* son públicas desde el punto de vista del jugador
  // (el panel de admin tiene su propio guard `useRequireAdmin`).
  if (path.startsWith("admin")) return true;
  // Permitir cualquier ruta legal (/legal/terminos, /legal/privacidad)
  if (path.startsWith("legal")) return true;
  return false;
}

export default function RootLayout() {
  const [iconsLoaded, iconsErr] = useIconFonts();
  const [fontsLoaded, fontsErr] = useAppFonts();
  const ready = (iconsLoaded || iconsErr) && (fontsLoaded || fontsErr);
  const router = useRouter();
  const segments = useSegments();
  const segmentsRef = useRef(segments);
  segmentsRef.current = segments;

  // ===== Auth Gate — chequeo de sesión =====
  // null = aún no verificado, true = autenticado, false = sin token
  const [authChecked, setAuthChecked] = useState(false);
  const [hasToken, setHasToken] = useState<boolean | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      // Iter56 — Chequear callback OAuth de Emergent (sólo web).
      // En mobile el flujo se maneja dentro de signInWithGoogle() con
      // WebBrowser + Linking listeners. En web el redirect deposita
      // #session_id=... en el URL y lo procesamos AL MOUNT.
      try {
        const { handleWebCallbackOnMount } = await import(
          "@/src/utils/emergentAuth"
        );
        const webResult = await handleWebCallbackOnMount();
        if (webResult && webResult.status === "ok" && mounted) {
          // Ya persistimos el JWT dentro del helper. Refrescamos estado.
          setHasToken(true);
          setAuthChecked(true);
          // Si es primer login → onboarding; sino → home según rol.
          if (!webResult.user.profile_completed) {
            router.replace("/onboarding" as any);
          }
          return;
        }
      } catch {
        /* no-op: si falla el callback, seguimos con el flujo normal */
      }

      const t = await playerTokenStore.get();
      if (!mounted) return;
      setHasToken(!!t);
      setAuthChecked(true);
    })();
    return () => {
      mounted = false;
    };
  }, [router]);

  // Redirige a /login cuando: fonts cargadas, gate chequeado, sin token, ruta protegida.
  useEffect(() => {
    if (!ready || !authChecked) return;
    if (hasToken) return;
    if (isPublicRoute(segments || [])) return;
    router.replace("/login" as any);
  }, [ready, authChecked, hasToken, segments, router]);

  // ===== Auditoría Routing — Sesión expirada (401) + Guard Toast =====
  const [toast, setToast] = useState<{ msg: string; tone: "warn" | "info" | "error" } | null>(null);

  useEffect(() => {
    // Listener global: si cualquier petición autenticada recibe 401, el
    // interceptor en src/api.ts limpia tokens y dispara este evento.
    // Limpiamos last_role y redirigimos al login correcto (admin si la
    // ruta actual era /admin/*, player en cualquier otro caso).
    const off = onAuthExpired(() => {
      const inAdmin = (segmentsRef.current || []).join("/").startsWith("admin");
      setToast({
        msg: "Tu sesión expiró. Por favor inicia sesión nuevamente.",
        tone: "warn",
      });
      void clearLastRole();
      try {
        router.replace(inAdmin ? "/admin/login" : "/login");
      } catch {
        /* no-op */
      }
    });

    // Registramos el toast para que `useRequireAdmin` lo use cuando un
    // jugador intente manipular la URL para entrar a /admin/*.
    registerGuardToast((msg) => setToast({ msg, tone: "warn" }));
    return () => {
      off();
    };
  }, [router]);

  // iter36 P2 fix: descartar cualquier toast residual cuando el usuario
  // llega a una pantalla de login (admin o player). El banner "No tienes
  // permisos" del guard previo no debe seguir visible mientras intenta
  // autenticarse.
  useEffect(() => {
    const path = (segments || []).join("/");
    if (path === "admin/login" || path === "login") {
      setToast(null);
    }
  }, [segments]);

  useEffect(() => {
    if (ready) {
      SplashScreen.hideAsync();
    }
  }, [ready]);

  // ===== Deep Linking + Push tap handling =====
  // 1. Captura URL inicial (cold-start) — universal/app link o esquema.
  // 2. Suscribe a URLs nuevas (background → foreground).
  // 3. Suscribe a taps en notifs push (con `data.action_url` o `deeplink`).
  // 4. Si el usuario aún no está autenticado, persiste la ruta y deja que
  //    `/login` la consuma post-OTP.
  useEffect(() => {
    if (!ready) return;

    const dispatchUrl = async (rawUrl: string | null | undefined) => {
      if (!rawUrl) return;
      const path = parseDeepLink(rawUrl);
      if (!path) return;
      const token = await playerTokenStore.get();
      if (!token) {
        await deepLinkStore.set(path);
        const seg = (segmentsRef.current || []).join("/");
        if (seg !== "login" && seg !== "admin/login") {
          router.replace("/login" as any);
        }
        return;
      }
      try {
        router.push(path as any);
      } catch {
        /* swallow */
      }
    };

    Linking.getInitialURL().then((url) => {
      if (url) void dispatchUrl(url);
    });

    const linkSub = Linking.addEventListener("url", (evt) => {
      void dispatchUrl(evt.url);
    });

    let notifTapSub: { remove: () => void } | null = null;
    if (Platform.OS !== "web") {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const Notifications = require("expo-notifications");
      notifTapSub = Notifications.addNotificationResponseReceivedListener(
        (response: any) => {
          const data = response?.notification?.request?.content?.data || {};
          const url: string | undefined = data.action_url || data.deeplink;
          if (url) void dispatchUrl(url);
        },
      );
      Notifications.getLastNotificationResponseAsync().then((response: any) => {
        if (!response) return;
        const data = response?.notification?.request?.content?.data || {};
        const url: string | undefined = data.action_url || data.deeplink;
        if (url) void dispatchUrl(url);
      });
    }

    return () => {
      try {
        linkSub.remove();
      } catch {
        /* swallow */
      }
      notifTapSub?.remove?.();
    };
  }, [ready, router]);

  if (!ready) return null;

  return (
    <AppErrorBoundary>
      <UserPlanProvider>
        <StatusBar style="dark" />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: "#F8FAFC" },
            animation: "slide_from_right",
          }}
        />
        <Toast
          visible={!!toast}
          message={toast?.msg ?? ""}
          tone={toast?.tone}
          onHide={() => setToast(null)}
        />
      </UserPlanProvider>
    </AppErrorBoundary>
  );
}
