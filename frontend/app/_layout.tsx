import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect, useRef, useState } from "react";
import { LogBox } from "react-native";
import { StatusBar } from "expo-status-bar";
import { useRouter, useSegments } from "expo-router";

import { useIconFonts } from "@/src/hooks/use-icon-fonts";
import { useAppFonts } from "@/src/hooks/use-app-fonts";
import { BrandSplash } from "@/src/components/BrandSplash";
import { Toast } from "@/src/components/Toast";
import { onAuthExpired } from "@/src/api";
import { registerGuardToast } from "@/src/hooks/useRequireAdmin";
import { clearLastRole } from "@/src/utils/roleSelection";
import { AppErrorBoundary } from "@/src/components/AppErrorBoundary";

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

export default function RootLayout() {
  const [iconsLoaded, iconsErr] = useIconFonts();
  const [fontsLoaded, fontsErr] = useAppFonts();
  const ready = (iconsLoaded || iconsErr) && (fontsLoaded || fontsErr);
  const [showBrandSplash, setShowBrandSplash] = useState(true);
  const router = useRouter();
  const segments = useSegments();
  const segmentsRef = useRef(segments);
  segmentsRef.current = segments;

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
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: "#F8FAFC" },
          animation: "slide_from_right",
        }}
      />
      {showBrandSplash ? (
        <BrandSplash onDone={() => setShowBrandSplash(false)} />
      ) : null}
      <Toast
        visible={!!toast}
        message={toast?.msg ?? ""}
        tone={toast?.tone}
        onHide={() => setToast(null)}
      />
    </AppErrorBoundary>
  );
}
