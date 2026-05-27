/**
 * Wordmark compuesto: "Padel" (slate-900 bold) + "AppRetas" (emerald-600 black).
 * Tamaños predefinidos para mantener consistencia visual.
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
};

export function BrandWordmark({ size = "md", style, testID }: Props) {
  const dims = SIZES[size];
  const baseStyle: TextStyle = {
    fontSize: dims.fontSize,
    letterSpacing: dims.letterSpacing,
    includeFontPadding: false,
  };
  return (
    <View style={[styles.row, style]} testID={testID}>
      <Text style={[baseStyle, styles.first]} accessibilityRole="header">
        Padel
      </Text>
      <Text style={[baseStyle, styles.second]}>AppRetas</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "baseline" },
  first: {
    fontFamily: FONTS.sansBold,
    color: colors.text.primary,
  },
  second: {
    fontFamily: FONTS.sansBlack,
    color: colors.brand.primary,
  },
});
