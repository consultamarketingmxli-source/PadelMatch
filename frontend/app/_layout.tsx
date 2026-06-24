import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect, useRef, useState } from "react";
import { LogBox } from "react-native";
import { StatusBar } from "expo-status-bar";
import { useRouter, useSegments } from "expo-router";
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
  "login",         // Login de jugador (OTP por WhatsApp)
  "admin/login",   // Login de organizador
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
      const t = await playerTokenStore.get();
      if (!mounted) return;
      setHasToken(!!t);
      setAuthChecked(true);
    })();
    return () => {
      mounted = false;
    };
  }, []);

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
