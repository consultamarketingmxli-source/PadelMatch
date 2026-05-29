/**
 * Layout del Ambiente Admin — Auditoría Routing P2.
 *
 * Único punto de aplicación del guard `useRequireAdmin()` para TODAS las
 * rutas bajo `/admin/*` (dashboard, retas, inscripciones, parejas, jugadores,
 * resultados, marketing, mercadopago, deploy-readiness, etc.).
 *
 * Excepción: `/admin/login` debe ser accesible sin token; el guard lo detecta
 * y NO bloquea (porque el segmento `login` no estaría protegido — el guard
 * solo redirige cuando el usuario está en `/admin/*` sin token; el redirect
 * destino es el propio `/admin/login`, así que no hay loop).
 *
 * Beneficios sobre aplicar el hook por pantalla:
 *   • Una sola línea de protección (less surface area for mistakes).
 *   • Cualquier ruta admin nueva queda protegida por defecto.
 *   • Si el JWT vence durante navegación, el interceptor 401 global ya
 *     limpia tokens y este layout re-evalúa al volver a montar.
 */
import { Stack, useSegments } from "expo-router";

import { useRequireAdmin } from "@/src/hooks/useRequireAdmin";

export default function AdminLayout() {
  const segments = useSegments();
  // Permitir que `/admin/login` se renderice sin guard (evita loop).
  const isLogin = (segments[segments.length - 1] ?? "") === "login";
  // Hook condicional sería antipatrón — siempre llamamos al hook;
  // dentro, él decide si redirige (sólo si NO está en /admin/login).
  useRequireAdmin();
  void isLogin; // doc-marker; el guard internamente revisa segments.

  return <Stack screenOptions={{ headerShown: false }} />;
}
