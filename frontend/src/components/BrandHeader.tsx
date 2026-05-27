/**
 * Header común con logotipo PadelappRetas — uso en navbars de toda la app.
 * Logo 32x32 (isotipo) + wordmark compuesto a la izquierda + slot derecho para acciones.
 */
import React from "react";
import { StyleSheet, View, ViewStyle } from "react-native";
import { BrandLogo } from "@/src/components/BrandLogo";
import { BrandWordmark } from "@/src/components/BrandWordmark";
import { spacing } from "@/src/theme";

type Props = {
  size?: "sm" | "md";
  right?: React.ReactNode;
  style?: ViewStyle;
  testID?: string;
  wordmarkSize?: "sm" | "md" | "lg";
  logoSize?: number;
};

export function BrandHeader({
  right,
  style,
  testID,
  wordmarkSize = "md",
  logoSize = 32,
}: Props) {
  return (
    <View style={[styles.row, style]} testID={testID}>
      <View style={styles.left}>
        <BrandLogo size={logoSize} />
        <View style={{ width: spacing.sm }} />
        <BrandWordmark size={wordmarkSize} testID={testID ? `${testID}-wordmark` : undefined} />
      </View>
      {right ? <View style={styles.right}>{right}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.base,
    paddingTop: spacing.base,
    paddingBottom: spacing.sm,
  },
  left: { flexDirection: "row", alignItems: "center" },
  right: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
});
