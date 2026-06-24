/**
 * AdBanner (native) — Banner AdMob para Android/iOS.
 *
 * REGLAS DE NEGOCIO:
 *   - Sólo visible para usuarios Free (isPro === false).
 *   - Sólo se monta en Android/iOS. Para `web` existe `AdBanner.web.tsx`
 *     que retorna `null` y previene crashes con React Native Web.
 *   - En __DEV__ usamos `TestIds.BANNER` para evitar baneos por fraude.
 *
 * REQUISITOS PARA QUE FUNCIONE:
 *   - Build nativo (Expo Go NO soporta módulos nativos AdMob).
 *   - Plugin `react-native-google-mobile-ads` declarado en `app.json` con
 *     el `androidAppId` configurado.
 *   - Permisos `INTERNET` y `ACCESS_NETWORK_STATE` (Android los toma por defecto).
 */
import React from "react";
import { Platform, StyleSheet, View } from "react-native";
import { BannerAd, BannerAdSize, TestIds } from "react-native-google-mobile-ads";

import { useSubscription } from "@/src/hooks/useSubscription";

// Production Ad Unit ID — Banner inferior pantalla de retas.
const PROD_BANNER_AD_UNIT_ID = "ca-app-pub-5641434677902126/8854554555";

// En desarrollo, SIEMPRE usamos test IDs para evitar baneos del account.
const adUnitId = __DEV__ ? TestIds.BANNER : PROD_BANNER_AD_UNIT_ID;

export function AdBanner() {
  const { isPro } = useSubscription();

  // Premium nunca ve anuncios.
  if (isPro) return null;
  // Defensa adicional: si por alguna razón se carga en web, no renderizar.
  if (Platform.OS === "web") return null;

  return (
    <View style={styles.wrap} testID="admob-banner">
      <BannerAd
        unitId={adUnitId}
        size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
        requestOptions={{
          requestNonPersonalizedAdsOnly: true,
        }}
      />
    </View>
  );
}

export default AdBanner;

const styles = StyleSheet.create({
  wrap: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 8,
    width: "100%",
    backgroundColor: "transparent",
  },
});
