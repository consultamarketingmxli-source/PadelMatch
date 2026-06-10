/**
 * BrandLogo — Isotipo + wordmark de PadelAppRetas.
 *
 * V4 (Junio 2026): Reemplazado SVG procedural por el ícono oficial de la marca
 * (squircle azul marino con raqueta blanca). El asset bitmap garantiza pixel-perfect
 * fidelity con el ícono de la App Store / Play Store.
 *
 * Variantes:
 *   - light (default) → Ícono oficial sobre cualquier fondo. Squircle navy self-contained.
 *   - dark            → Mismo ícono (ya tiene fondo navy, funciona en superficies oscuras).
 *   - mono            → Silueta blanca de la raqueta (para CTAs con fondo color).
 */
import React from "react";
import { Image, ImageStyle, Platform, StyleSheet, Text, View } from "react-native";
import { colors, fonts } from "@/src/theme";

type Variant = "light" | "dark" | "mono";

type LogoProps = {
  size?: number;
  variant?: Variant;
  /** Custom color para variant="mono". */
  color?: string;
};

// Imagen oficial (squircle + raqueta, sin texto). Source: assets/brand/iconmark.png
// Cargada estáticamente para que Metro la bundlee correctamente.
const ICONMARK = require("@/assets/brand/iconmark.png");
const ICONMARK_MONO = require("@/assets/images/icon-monochrome.png");

export function BrandLogo({ size = 48, variant = "light", color }: LogoProps) {
  if (variant === "mono") {
    // Silueta blanca → permite tint con `tintColor` para usar sobre cualquier color.
    const tint = color ?? colors.text.inverse ?? "#FFFFFF";
    return (
      <Image
        source={ICONMARK_MONO}
        style={[
          styles.icon,
          { width: size, height: size, tintColor: tint } as ImageStyle,
        ]}
        resizeMode="contain"
        accessibilityLabel="PadelAppRetas logo"
      />
    );
  }
  // light & dark → mismo asset (squircle self-contained).
  return (
    <Image
      source={ICONMARK}
      style={[styles.icon, { width: size, height: size }]}
      resizeMode="contain"
      accessibilityLabel="PadelAppRetas logo"
    />
  );
}

/* ────────────────────────────────────────────────────────────────
   WORDMARK + LOCKUP — Texto plano "PadelApp Retas".
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
  icon: {
    // Sin borde extra — el squircle ya viene incluido en el bitmap.
  },
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
