/**
 * userPlanStore — Estado global del plan del usuario (Gratis vs Premium de Por Vida).
 *
 * Arquitectura: Context API + AsyncStorage para persistencia local.
 * Se eligió Context sobre Zustand para minimizar dependencias y mantener el bundle ligero.
 *
 * Modo SANDBOX:
 *   - RevenueCat (react-native-purchases) se inicializa dentro de try/catch.
 *   - Si la lib NO está instalada o no hay API key real → simulación silenciosa.
 *   - simulatePurchase() activa Premium localmente sin llamar APIs reales.
 *
 * ┌────────────────────────────────────────────────────────────────────────┐
 * │ 🚧 TODO PRODUCCIÓN — Activar RevenueCat real                            │
 * │                                                                         │
 * │   1. Crear app en RevenueCat (https://app.revenuecat.com) y registrar  │
 * │      bundle iOS/Android.                                                │
 * │   2. Crear producto IAP en App Store Connect y Play Console con id     │
 * │      `padelappretas_premium_lifetime`.                                  │
 * │   3. Asociar SKUs en el dashboard de RevenueCat → entitlement          │
 * │      `premium_access`.                                                  │
 * │   4. Pegar las API keys en `/app/frontend/.env`:                        │
 * │         EXPO_PUBLIC_REVENUECAT_API_KEY_IOS=appl_xxx                     │
 * │         EXPO_PUBLIC_REVENUECAT_API_KEY_ANDROID=goog_xxx                 │
 * │   5. Rebuild nativo con EAS (`eas build`) — el flujo de compra real    │
 * │      sólo funciona en build nativo, NO en Expo Go.                      │
 * │                                                                         │
 * │   ✅ El código abajo YA está listo: detecta la key real, deja de usar  │
 * │   simulatePurchase y activa el SDK real automáticamente.                │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * Variables de entorno esperadas (cuando se active producción):
 *   - EXPO_PUBLIC_REVENUECAT_API_KEY_IOS
 *   - EXPO_PUBLIC_REVENUECAT_API_KEY_ANDROID
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";

// ────────────────────────────────────────────────────────────────────────────
// Constantes
// ────────────────────────────────────────────────────────────────────────────
const STORAGE_KEY = "padelappretas.userPlan.isPro";
const MOCK_API_KEY = "MOCK_REVENUECAT_KEY_DEV_SANDBOX";
const PREMIUM_PRICE_MXN = 349;
const PREMIUM_PRODUCT_ID = "padelappretas_premium_lifetime";

// ────────────────────────────────────────────────────────────────────────────
// Tipos
// ────────────────────────────────────────────────────────────────────────────
export type UserPlanState = {
  /** True si el usuario tiene Premium de Por Vida. */
  isPro: boolean;
  /** True mientras se hidrata el estado desde AsyncStorage. */
  loading: boolean;
  /** True si RevenueCat se inicializó en modo simulación (no producción). */
  simulationMode: boolean;
  /** Activa Premium localmente (modo sandbox para auditoría visual). */
  simulatePurchase: () => Promise<void>;
  /** Revoca Premium (para testing del paywall). */
  simulateRevoke: () => Promise<void>;
  /** Lanza el flujo real de compra de RevenueCat — fallback a simulatePurchase si no hay SDK. */
  purchasePremium: () => Promise<{ success: boolean; reason?: string }>;
  /** Precio en MXN del Premium Lifetime. */
  priceMxn: number;
  /** ID de producto en stores (App Store Connect / Play Console). */
  productId: string;
};

// ────────────────────────────────────────────────────────────────────────────
// Inicialización defensiva de RevenueCat (anti-crash)
// ────────────────────────────────────────────────────────────────────────────
async function initRevenueCatSafely(): Promise<{ ready: boolean; reason: string }> {
  try {
    const iosKey = process.env.EXPO_PUBLIC_REVENUECAT_API_KEY_IOS || MOCK_API_KEY;
    const androidKey = process.env.EXPO_PUBLIC_REVENUECAT_API_KEY_ANDROID || MOCK_API_KEY;
    const apiKey = Platform.OS === "ios" ? iosKey : androidKey;

    // Si la key es la mock o está vacía, NO intentamos cargar el SDK real.
    if (apiKey === MOCK_API_KEY || !apiKey) {
      console.warn(
        "[userPlanStore] RevenueCat en modo SIMULACIÓN. " +
          "Define EXPO_PUBLIC_REVENUECAT_API_KEY_(IOS|ANDROID) para activar producción.",
      );
      return { ready: false, reason: "mock_key" };
    }

    // Lazy require — sólo cargamos el SDK si la lib está instalada.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Purchases = require("react-native-purchases").default;
    await Purchases.configure({ apiKey });
    return { ready: true, reason: "configured" };
  } catch (err) {
    // El SDK no está instalado o falló al configurar — seguimos en simulación.
    console.warn(
      "[userPlanStore] react-native-purchases no disponible. " +
        "App seguirá en modo simulación. Detalle:",
      err instanceof Error ? err.message : err,
    );
    return { ready: false, reason: "sdk_missing" };
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Context
// ────────────────────────────────────────────────────────────────────────────
const UserPlanContext = createContext<UserPlanState | null>(null);

export function UserPlanProvider({ children }: { children: React.ReactNode }) {
  const [isPro, setIsPro] = useState(false);
  const [loading, setLoading] = useState(true);
  const [simulationMode, setSimulationMode] = useState(true);

  // Hidratación inicial desde AsyncStorage + intento de init RevenueCat.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const stored = await AsyncStorage.getItem(STORAGE_KEY);
        if (alive && stored === "true") {
          setIsPro(true);
        }
      } catch (e) {
        console.warn("[userPlanStore] AsyncStorage get falló:", e);
      }
      const init = await initRevenueCatSafely();
      if (alive) {
        setSimulationMode(!init.ready);
        setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const simulatePurchase = useCallback(async () => {
    try {
      await AsyncStorage.setItem(STORAGE_KEY, "true");
    } catch (e) {
      console.warn("[userPlanStore] AsyncStorage set falló:", e);
    }
    setIsPro(true);
  }, []);

  const simulateRevoke = useCallback(async () => {
    try {
      await AsyncStorage.removeItem(STORAGE_KEY);
    } catch (e) {
      console.warn("[userPlanStore] AsyncStorage remove falló:", e);
    }
    setIsPro(false);
  }, []);

  const purchasePremium = useCallback(async (): Promise<{ success: boolean; reason?: string }> => {
    // En modo simulación → siempre éxito (para auditoría visual).
    if (simulationMode) {
      await simulatePurchase();
      return { success: true, reason: "simulation_mode" };
    }
    // Modo producción: llamar a Purchases.purchaseProduct(...).
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const Purchases = require("react-native-purchases").default;
      const offerings = await Purchases.getOfferings();
      const pkg = offerings.current?.lifetime;
      if (!pkg) return { success: false, reason: "no_offering" };
      const { customerInfo } = await Purchases.purchasePackage(pkg);
      const entitled = !!customerInfo.entitlements.active["premium_lifetime"];
      if (entitled) {
        await AsyncStorage.setItem(STORAGE_KEY, "true");
        setIsPro(true);
      }
      return { success: entitled, reason: entitled ? "purchased" : "no_entitlement" };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown";
      // Usuario canceló → no es error real.
      if (msg.toLowerCase().includes("cancel")) {
        return { success: false, reason: "user_cancelled" };
      }
      console.warn("[userPlanStore] Compra falló:", msg);
      return { success: false, reason: msg };
    }
  }, [simulationMode, simulatePurchase]);

  const value = useMemo<UserPlanState>(
    () => ({
      isPro,
      loading,
      simulationMode,
      simulatePurchase,
      simulateRevoke,
      purchasePremium,
      priceMxn: PREMIUM_PRICE_MXN,
      productId: PREMIUM_PRODUCT_ID,
    }),
    [isPro, loading, simulationMode, simulatePurchase, simulateRevoke, purchasePremium],
  );

  return <UserPlanContext.Provider value={value}>{children}</UserPlanContext.Provider>;
}

/**
 * Hook seguro para consumir el plan del usuario.
 * Devuelve un estado por defecto si se usa fuera del Provider — previene crashes en SSR/web.
 */
export function useUserPlan(): UserPlanState {
  const ctx = useContext(UserPlanContext);
  if (!ctx) {
    return {
      isPro: false,
      loading: false,
      simulationMode: true,
      simulatePurchase: async () => {},
      simulateRevoke: async () => {},
      purchasePremium: async () => ({ success: false, reason: "no_provider" }),
      priceMxn: PREMIUM_PRICE_MXN,
      productId: PREMIUM_PRODUCT_ID,
    };
  }
  return ctx;
}
