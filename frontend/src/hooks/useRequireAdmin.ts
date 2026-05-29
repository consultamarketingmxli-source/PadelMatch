/**
 * Auditoría Routing — Guard de pantallas administrativas (P0).
 *
 * Uso: añadir `useRequireAdmin()` al inicio de cualquier componente bajo
 * `/app/admin/*`. Si no hay token de admin válido, redirige limpiamente
 * a `/admin/login` y dispara un toast en el siguiente layout.
 *
 * Importante: este guard NO se encarga del 401 medio-flujo (eso lo hace el
 * interceptor global en `src/api.ts`). Cubre el caso del usuario que
 * manipula la URL del navegador o regresa después de un cierre de sesión.
 */
import { useEffect } from "react";
import { useRouter, useSegments } from "expo-router";

import { api } from "@/src/api";

let _toastFn: ((msg: string) => void) | null = null;
export function registerGuardToast(fn: (msg: string) => void) {
  _toastFn = fn;
}

export function useRequireAdmin() {
  const router = useRouter();
  const segments = useSegments();
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const tok = await api.getToken();
      if (!cancelled && !tok) {
        // Sólo notificamos si claramente estaba dentro del admin.
        if (segments.join("/").startsWith("admin") && _toastFn) {
          _toastFn("No tienes permisos de administrador");
        }
        router.replace("/admin/login");
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
