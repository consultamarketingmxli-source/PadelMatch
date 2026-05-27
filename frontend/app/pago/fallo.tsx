/**
 * Pantalla de retorno tras pago cancelado/fallido (Mercado Pago / Stripe).
 *
 * Recibe deep-link `padelappretas://pago/fallo?reta_slug=...`.
 * Invita al usuario a intentar de nuevo desde la reta.
 */
import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { XCircle, Home, RefreshCw } from "lucide-react-native";

import { BrandHeader } from "@/src/components/BrandHeader";
import { colors, radii, spacing, typography } from "@/src/theme";

export default function PagoFalloScreen() {
  const router = useRouter();
  const { reta_slug, provider } = useLocalSearchParams<{
    reta_slug?: string;
    provider?: string;
  }>();

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <BrandHeader testID="pago-fallo-header" wordmarkSize="sm" logoSize={26} />

      <View style={styles.body}>
        <View style={styles.center} testID="pago-fallo">
          <View style={styles.iconWrap}>
            <XCircle size={56} color={colors.status.redText} />
          </View>
          <Text style={styles.title}>Pago no completado</Text>
          <Text style={styles.subtitle}>
            Cancelaste el cobro en {provider === "stripe" ? "Stripe" : "Mercado Pago"}{" "}
            o el cargo fue rechazado. Tu lugar no fue reservado.
          </Text>
          <Text style={styles.tip}>
            Si fue un error de tu banco, intenta nuevamente. El cupo estará disponible
            hasta que otra persona lo tome.
          </Text>
        </View>

        <View style={styles.ctaRow}>
          {reta_slug ? (
            <TouchableOpacity
              testID="pago-reintentar"
              style={[styles.btn, styles.btnPrimary]}
              onPress={() => router.replace(`/retas/${reta_slug}` as any)}
            >
              <RefreshCw size={16} color={colors.brand.onPrimary} />
              <Text style={styles.btnPrimaryText}>Intentar de nuevo</Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity
            testID="pago-fallo-home"
            style={[styles.btn, styles.btnGhost]}
            onPress={() => router.replace("/")}
          >
            <Home size={16} color={colors.brand.primary} />
            <Text style={styles.btnGhostText}>Volver al inicio</Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg.app },
  body: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    justifyContent: "center",
  },
  center: { alignItems: "center", gap: spacing.sm },
  iconWrap: {
    width: 92,
    height: 92,
    borderRadius: 46,
    backgroundColor: colors.status.redBg,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.sm,
  },
  title: {
    ...typography.h1,
    textAlign: "center",
  },
  subtitle: {
    ...typography.bodyRelaxed,
    textAlign: "center",
    paddingHorizontal: spacing.md,
  },
  tip: {
    ...typography.bodySm,
    textAlign: "center",
    paddingHorizontal: spacing.lg,
    marginTop: spacing.sm,
    color: colors.text.secondary,
  },
  ctaRow: {
    marginTop: spacing.xl,
    gap: spacing.sm,
  },
  btn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    paddingVertical: spacing.base,
    borderRadius: radii.md,
  },
  btnPrimary: {
    backgroundColor: colors.brand.primary,
  },
  btnPrimaryText: {
    ...typography.buttonLg,
    color: colors.brand.onPrimary,
  },
  btnGhost: {
    backgroundColor: colors.bg.card,
    borderWidth: 1,
    borderColor: colors.border.default,
  },
  btnGhostText: {
    ...typography.button,
    color: colors.brand.primary,
  },
});
