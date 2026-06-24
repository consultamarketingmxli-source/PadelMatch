/**
 * useSubscription — Hook custom de monetización (alias premium de useUserPlan).
 *
 * Expone el esquema clásico de RevenueCat (entitlements + isPro + isLoading)
 * y agrega `purchasePackage(packageId)` con simulación 1.5s + alert.
 *
 * Usar en componentes:
 *   const { isPro, entitlements, isLoading, purchasePackage } = useSubscription();
 */
import { useCallback } from "react";
import { Alert } from "react-native";
import { useUserPlan } from "@/src/stores/userPlanStore";

const PREMIUM_ENTITLEMENT = "premium_access";
const SIMULATED_NATIVE_DELAY_MS = 1500;

export type SubscriptionState = {
  isPro: boolean;
  entitlements: string[];
  isLoading: boolean;
  /** Modo simulación activo (sin SDK real). */
  simulationMode: boolean;
  /**
   * Simula la pasarela de pago nativa.
   * 1) Espera 1.5s (UX del banner Apple/Google Pay).
   * 2) Activa Premium localmente (AsyncStorage).
   * 3) Lanza alert estético de éxito.
   */
  purchasePackage: (packageId?: string) => Promise<{ success: boolean; reason?: string }>;
  /** Revoca Premium (testing). */
  restorePurchases: () => Promise<void>;
};

export function useSubscription(): SubscriptionState {
  const { isPro, loading, simulationMode, simulatePurchase, simulateRevoke, purchasePremium } =
    useUserPlan();

  const purchasePackage = useCallback(
    async (packageId?: string) => {
      // En sandbox simulamos la pasarela nativa con delay.
      if (simulationMode) {
        await new Promise((r) => setTimeout(r, SIMULATED_NATIVE_DELAY_MS));
        await simulatePurchase();
        Alert.alert(
          "🏆 ¡Bienvenido, Miembro Premium!",
          `Acceso Premium de por vida activado.${packageId ? `\n\nPackage: ${packageId}` : ""}\n\nSandbox · Sin cargo real.`,
          [{ text: "Continuar", style: "default" }],
          { cancelable: false },
        );
        return { success: true, reason: "simulation_mode" };
      }
      // Producción → delega a RevenueCat real
      const res = await purchasePremium();
      if (res.success) {
        Alert.alert("🏆 ¡Bienvenido, Miembro Premium!", "Acceso Premium de por vida activado.");
      } else if (res.reason !== "user_cancelled") {
        Alert.alert("Error", `No se pudo completar la compra: ${res.reason ?? "desconocido"}`);
      }
      return res;
    },
    [simulationMode, simulatePurchase, purchasePremium],
  );

  return {
    isPro,
    entitlements: isPro ? [PREMIUM_ENTITLEMENT] : [],
    isLoading: loading,
    simulationMode,
    purchasePackage,
    restorePurchases: simulateRevoke,
  };
}
