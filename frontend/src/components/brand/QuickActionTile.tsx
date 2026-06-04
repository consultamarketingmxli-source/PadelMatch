/**
 * QuickActionTile — Tile cuadrado de acción rápida (rebrand v3).
 *
 * Composición: ícono grande arriba + label inferior. Sombra premium suave
 * con tinte Sapphire. Adecuado para grid 2x2 / 3x3 en home y dashboards.
 */
import React from "react";
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  ViewStyle,
} from "react-native";
import { colors, radii, shadows, spacing, typography } from "@/src/theme";

export type QuickActionTileProps = {
  icon: React.ReactNode;
  label: string;
  sublabel?: string;
  onPress?: () => void;
  active?: boolean;
  style?: ViewStyle;
  testID?: string;
};

export function QuickActionTile({
  icon,
  label,
  sublabel,
  onPress,
  active,
  style,
  testID,
}: QuickActionTileProps) {
  return (
    <TouchableOpacity
      testID={testID}
      onPress={onPress}
      activeOpacity={0.9}
      style={[
        styles.tile,
        shadows.card as object,
        active && styles.tileActive,
        style,
      ]}
    >
      <View
        style={[
          styles.iconBox,
          active && { backgroundColor: colors.brand.primarySoft },
        ]}
      >
        {icon}
      </View>
      <Text
        style={[styles.label, active && { color: colors.brand.sapphire }]}
        numberOfLines={1}
      >
        {label}
      </Text>
      {sublabel ? (
        <Text style={styles.sublabel} numberOfLines={1}>
          {sublabel}
        </Text>
      ) : null}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  tile: {
    flex: 1,
    minHeight: 96,
    backgroundColor: colors.bg.card,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.border.blueHairline,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  tileActive: {
    borderColor: colors.brand.primaryBorder,
  },
  iconBox: {
    width: 44,
    height: 44,
    borderRadius: radii.icon,
    backgroundColor: colors.bg.elevated,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.sm,
  },
  label: {
    ...typography.bodyBold,
    fontSize: 13,
    color: colors.text.primary,
    textAlign: "center",
  },
  sublabel: {
    ...typography.caption,
    fontSize: 11,
    color: colors.text.secondary,
    marginTop: 2,
  },
});
