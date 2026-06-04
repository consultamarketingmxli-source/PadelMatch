/**
 * Chip — Etiqueta semántica del rebrand v3.
 *
 * Variantes alineadas con `chipPalette` (theme.ts):
 *   beginner / mid / advanced / elite / available / full / premium / today
 *
 * Permite override `tone` libre para tonos custom (icon + color sólido).
 * Tamaño `sm` (default) y `md`.
 */
import React from "react";
import { StyleSheet, Text, View, ViewStyle } from "react-native";
import { chipPalette, radii, typography } from "@/src/theme";

export type ChipVariant = keyof typeof chipPalette;

export type ChipProps = {
  label: string;
  variant?: ChipVariant;
  /** Override manual de colores (bg + text). */
  tone?: { bg: string; text: string };
  size?: "sm" | "md";
  /** Punto indicador a la izquierda (color del texto). */
  dot?: boolean;
  leading?: React.ReactNode;
  style?: ViewStyle;
  testID?: string;
};

export function Chip({
  label,
  variant = "mid",
  tone,
  size = "sm",
  dot,
  leading,
  style,
  testID,
}: ChipProps) {
  const palette = tone ?? chipPalette[variant];
  const isMd = size === "md";
  return (
    <View
      testID={testID}
      style={[
        styles.chip,
        {
          backgroundColor: palette.bg,
          paddingVertical: isMd ? 6 : 3,
          paddingHorizontal: isMd ? 12 : 9,
        },
        style,
      ]}
    >
      {dot ? (
        <View
          style={[styles.dot, { backgroundColor: palette.text }]}
          pointerEvents="none"
        />
      ) : null}
      {leading ? <View style={styles.leading}>{leading}</View> : null}
      <Text
        style={[
          styles.text,
          { color: palette.text, fontSize: isMd ? 12 : 10.5 },
        ]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: radii.pill,
    alignSelf: "flex-start",
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 6,
  },
  leading: {
    marginRight: 4,
  },
  text: {
    ...typography.label,
    fontSize: 10.5,
    letterSpacing: 0.8,
  },
});
