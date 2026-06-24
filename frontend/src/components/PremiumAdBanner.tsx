/**
 * PremiumAdBanner — Banner publicitario adaptativo para usuarios Free.
 *
 * Características anti-crash y anti-memory-leak:
 *   1. Si user.isPro === true → retorna NULL de inmediato (cortocircuito de render).
 *      Esto desmonta el banner de memoria, ahorra red, batería y CPU.
 *   2. Lazy require del SDK 'react-native-google-mobile-ads' — si NO está instalado,
 *      muestra un placeholder visual neutro sin crashear.
 *   3. Uso ESTRICTO de TestIds.ADAPTIVE_BANNER mientras estamos en SANDBOX.
 *      Migrar a unitIds reales cuando obtengas tu cuenta AdMob aprobada.
 *
 * Estilo: minimalista premium · centrado · radius 12 · #f8fafc · sin animaciones.
 */
import React, { useMemo } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import { useUserPlan } from "@/src/stores/userPlanStore";

// ────────────────────────────────────────────────────────────────────────────
// Lazy SDK loader — protege contra crash si la lib no está instalada
// ────────────────────────────────────────────────────────────────────────────
type AdSDK = {
  BannerAd: React.ComponentType<{
    unitId: string;
    size: string;
    requestOptions?: object;
    onAdFailedToLoad?: (err: unknown) => void;
  }>;
  TestIds: { ADAPTIVE_BANNER: string };
  BannerAdSize: { ANCHORED_ADAPTIVE_BANNER: string };
};

function loadAdSdk(): AdSDK | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const sdk = require("react-native-google-mobile-ads");
    return {
      BannerAd: sdk.BannerAd,
      TestIds: sdk.TestIds,
      BannerAdSize: sdk.BannerAdSize,
    };
  } catch {
    return null;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Component
// ────────────────────────────────────────────────────────────────────────────
type Props = {
  /** Opcional: override del unitId para producción (por defecto usa TestIds). */
  unitId?: string;
  /** Margen vertical custom — default 12 según spec. */
  marginVertical?: number;
};

export function PremiumAdBanner({ unitId, marginVertical = 12 }: Props): React.ReactElement | null {
  const { isPro } = useUserPlan();
  // Hook DEBE ir antes de cualquier early return (React rules-of-hooks).
  const sdk = useMemo(() => loadAdSdk(), []);

  // ⚡ CORTOCIRCUITO — usuario premium NO ve ni monta el banner (sin overhead).
  if (isPro) return null;

  // Si el SDK no está instalado → placeholder neutro (no crash).
  if (!sdk) {
    return (
      <View style={[styles.container, styles.placeholder, { marginVertical }]}>
        <Text style={styles.placeholderText}>· Espacio publicitario · </Text>
      </View>
    );
  }

  // Usa TestIds oficiales de Google en SANDBOX — seguros, no facturan, no banean cuentas.
  const finalUnitId = unitId ?? sdk.TestIds.ADAPTIVE_BANNER;

  return (
    <View style={[styles.container, { marginVertical }]}>
      <sdk.BannerAd
        unitId={finalUnitId}
        size={sdk.BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
        requestOptions={{
          // Anti-personalización por defecto (cumple LGPD/GDPR/CCPA hasta que pidas consent).
          requestNonPersonalizedAdsOnly: true,
        }}
        onAdFailedToLoad={(err) => {
          // Falla silenciosa — el banner simplemente no aparece, app no crashea.
          console.warn("[PremiumAdBanner] Banner falló:", err);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignSelf: "center",
    backgroundColor: "#f8fafc",
    borderRadius: 12,
    overflow: "hidden",
    paddingHorizontal: 4,
    paddingVertical: 4,
    // Sombra sutil sólo en iOS para mantener consistencia minimalista.
    ...Platform.select({
      ios: {
        shadowColor: "#0f172a",
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.04,
        shadowRadius: 4,
      },
      android: {
        elevation: 1,
      },
    }),
  },
  placeholder: {
    minHeight: 50,
    minWidth: 320,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderStyle: "dashed",
  },
  placeholderText: {
    color: "#94a3b8",
    fontSize: 11,
    fontWeight: "500",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
});

export default PremiumAdBanner;
