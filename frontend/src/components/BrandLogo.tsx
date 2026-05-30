/**
 * BrandLogo — Isotipo + wordmark de PadelAppRetas.
 *
 * Forma de la pelota: delega 100% en `PadelBallShape` (Single Source of Truth).
 * Lo único que varía entre variantes light / dark / mono es el COLOR del
 * cuerpo y/o las costuras.
 */
import React from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import { colors, fonts } from "@/src/theme";
import { PadelBallShape } from "@/src/components/brand";

type Variant = "light" | "dark" | "mono";

type LogoProps = {
  size?: number;
  variant?: Variant;
  /** Custom color para variant="mono". */
  color?: string;
};

export function BrandLogo({ size = 48, variant = "light", color }: LogoProps) {
  if (variant === "mono") {
    return (
      <PadelBallShape
        size={size}
        color={color ?? colors.brand.primary}
        seamColor="#FFFFFF"
      />
    );
  }
  if (variant === "dark") {
    // Sobre fondo oscuro: pelota clara con costuras cobalto sutil.
    return (
      <PadelBallShape
        size={size}
        color="#E0E7FF"
        gradient
        gradientTo="#FFFFFF"
        seamColor={colors.brand.cobalt}
        seamOpacity={0.85}
        seamWidthRatio={0.033}
      />
    );
  }
  // Light (default): gradiente azul brand con highlight 3D y costuras blancas.
  return (
    <PadelBallShape
      size={size}
      color={colors.brand.gradientFrom}
      gradientTo={colors.brand.gradientTo}
      gradient
      highlight
      seamColor="#FFFFFF"
    />
  );
}

/* ────────────────────────────────────────────────────────────────
   WORDMARK + LOCKUP (sin cambios funcionales).
   ──────────────────────────────────────────────────────────────── */

type WordmarkProps = {
  size?: number;
  variant?: Variant;
  color?: string;
};

export function BrandWordmark({
  size = 22,
  variant = "light",
  color,
}: WordmarkProps) {
  const lightColor = colors.brand.cobalt;
  const accentColor = colors.brand.primary;
  const darkColor = "#FFFFFF";
  const monoColor = color ?? colors.text.primary;

  const baseColor =
    variant === "dark" ? darkColor : variant === "mono" ? monoColor : lightColor;
  const heavyColor =
    variant === "dark" ? darkColor : variant === "mono" ? monoColor : accentColor;

  return (
    <View style={styles.wordmarkRow}>
      <Text
        style={[
          styles.wordmarkLight,
          { fontSize: size, lineHeight: size * 1.05, color: baseColor },
        ]}
      >
        Padel
      </Text>
      <Text
        style={[
          styles.wordmarkHeavy,
          { fontSize: size, lineHeight: size * 1.05, color: heavyColor },
        ]}
      >
        AppRetas
      </Text>
    </View>
  );
}

type LockupProps = {
  size?: number;
  variant?: Variant;
};

export function BrandLockup({ size = 32, variant = "light" }: LockupProps) {
  const wordSize = Math.round(size * 0.62);
  return (
    <View style={styles.lockupRow}>
      <BrandLogo size={size} variant={variant} />
      <BrandWordmark size={wordSize} variant={variant} />
    </View>
  );
}

const styles = StyleSheet.create({
  lockupRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  wordmarkRow: { flexDirection: "row", alignItems: "baseline" },
  wordmarkLight: {
    fontFamily: Platform.select({
      web: "Inter, system-ui, -apple-system, sans-serif",
      default: fonts.sansRegular,
    }) as string,
    fontWeight: "300",
    letterSpacing: -0.4,
  },
  wordmarkHeavy: {
    fontFamily: Platform.select({
      web: "Inter, system-ui, -apple-system, sans-serif",
      default: fonts.sansBlack,
    }) as string,
    fontWeight: "900",
    letterSpacing: -0.6,
  },
});
