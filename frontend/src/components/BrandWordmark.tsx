/**
 * Wordmark compuesto — Spec Director de Arte v3 "Blue Club Pro":
 *   • "Padel"     → peso REGULAR (font-light/font-normal) — look elegante editorial
 *   • "AppRetas"  → peso EXTRA-NEGRITA (font-black) — corporativo deportivo
 *
 * Color V2:
 *   • "Padel"     → slate-900 (indigo-cobalt en variante hero)
 *   • "AppRetas"  → blue-600 (Azul Eléctrico)
 */
import React from "react";
import { StyleSheet, Text, TextStyle, View, ViewStyle } from "react-native";
import { colors } from "@/src/theme";
import { FONTS } from "@/src/hooks/use-app-fonts";

type Size = "sm" | "md" | "lg" | "xl";

const SIZES: Record<Size, { fontSize: number; letterSpacing: number }> = {
  sm: { fontSize: 14, letterSpacing: -0.3 },
  md: { fontSize: 17, letterSpacing: -0.4 },
  lg: { fontSize: 22, letterSpacing: -0.6 },
  xl: { fontSize: 32, letterSpacing: -1.0 },
};

type Props = {
  size?: Size;
  style?: ViewStyle;
  testID?: string;
  /** Forzar paleta "dark" (sobre fondos oscuros) — todo en blanco. */
  variant?: "light" | "dark";
};

export function BrandWordmark({
  size = "md",
  style,
  testID,
  variant = "light",
}: Props) {
  const dims = SIZES[size];
  const baseStyle: TextStyle = {
    fontSize: dims.fontSize,
    letterSpacing: dims.letterSpacing,
    includeFontPadding: false,
  };
  const firstColor = variant === "dark" ? "#FFFFFF" : colors.text.primary;
  const secondColor = variant === "dark" ? "#FFFFFF" : colors.brand.primary;
  return (
    <View style={[styles.row, style]} testID={testID}>
      <Text style={[baseStyle, styles.first, { color: firstColor }]} accessibilityRole="header">
        Padel
      </Text>
      <Text style={[baseStyle, styles.second, { color: secondColor }]}>
        AppRetas
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "baseline" },
  // Padel — peso ligero/regular para contraste elegante con AppRetas.
  first: {
    fontFamily: FONTS.sansRegular,
    fontWeight: "300" as any,
  },
  // AppRetas — peso negro corporativo.
  second: {
    fontFamily: FONTS.sansBlack,
    fontWeight: "900" as any,
  },
});
