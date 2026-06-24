/**
 * PremiumGate — Helpers para bloquear features Premium y abrir paywall.
 *
 * Uso típico:
 *   // En el handler del toggle Anti-Flake (+90% asistencia):
 *   if (!gateAntiFlake(isPro, router)) return;
 *
 *   // En el botón "Exportar lista de pagos":
 *   if (!gateExport(isPro, router)) return;
 *
 * Si NO es Pro: muestra alert promocional y abre /paywall, retorna false.
 * Si SÍ es Pro: retorna true (continúa el flujo).
 */
import { Alert } from "react-native";
import type { Router } from "expo-router";

type AnyRouter = Pick<Router, "push">;

function openPaywall(router: AnyRouter) {
  router.push("/paywall" as never);
}

/**
 * Bloquea activación del filtro Anti-Flake si no es Pro.
 * @returns true si puede continuar, false si fue bloqueado.
 */
export function gateAntiFlake(isPro: boolean, router: AnyRouter): boolean {
  if (isPro) return true;
  Alert.alert(
    "🛡️ Función Premium",
    "El filtro Anti-Flake (+90% asistencia) es exclusivo para Miembros Fundadores. " +
      "Desbloquea esta y otras funciones con un pago único de por vida.",
    [
      { text: "Ahora no", style: "cancel" },
      { text: "Ver Plan Fundador", style: "default", onPress: () => openPaywall(router) },
    ],
  );
  return false;
}

/**
 * Bloquea exportación de listas/caja si no es Pro.
 * @returns true si puede continuar, false si fue bloqueado.
 */
export function gateExport(isPro: boolean, router: AnyRouter): boolean {
  if (isPro) return true;
  Alert.alert(
    "📊 Exportación Premium",
    "Exportar el desglose de pagos y la lista de asistencia requiere el Pase Fundador. " +
      "Un pago único · acceso de por vida · cero suscripciones.",
    [
      { text: "Ahora no", style: "cancel" },
      { text: "Ver Plan Fundador", style: "default", onPress: () => openPaywall(router) },
    ],
  );
  return false;
}
