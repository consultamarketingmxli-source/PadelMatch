/**
 * FilterPill — Pill toggle horizontal para filtros (rebrand v3).
 *
 * Estados:
 *   • idle  : fondo blanco, borde azul hairline, texto ink.
 *   • active: fondo Azure sólido, texto blanco, shadow.btn (glow azul).
 */
import React from "react";
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  ViewStyle,
} from "react-native";
import { colors, radii, shadows, typography } from "@/src/theme";

export type FilterPillProps = {
  label: string;
  active?: boolean;
  onPress?: () => void;
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
  count?: number | string;
  style?: ViewStyle;
  testID?: string;
};

export function FilterPill({
  label,
  active,
  onPress,
  leading,
  trailing,
  count,
  style,
  testID,
}: FilterPillProps) {
  return (
    <TouchableOpacity
      testID={testID}
      onPress={onPress}
      activeOpacity={0.85}
      style={[
        styles.pill,
        active ? styles.pillActive : styles.pillIdle,
        active && (shadows.btn as object),
        style,
      ]}
    >
      {leading ? <View style={styles.icon}>{leading}</View> : null}
      <Text
        style={[
          styles.label,
          active ? styles.labelActive : styles.labelIdle,
        ]}
        numberOfLines={1}
      >
        {label}
      </Text>
      {count !== undefined && count !== null ? (
        <View
          style={[
            styles.count,
            active ? styles.countActive : styles.countIdle,
          ]}
        >
          <Text
            style={[
              styles.countText,
              active
                ? { color: colors.brand.sapphire }
                : { color: colors.text.secondary },
            ]}
          >
            {count}
          </Text>
        </View>
      ) : null}
      {trailing ? <View style={styles.icon}>{trailing}</View> : null}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: radii.pill,
    paddingHorizontal: 14,
    paddingVertical: 8,
    gap: 6,
  },
  pillIdle: {
    backgroundColor: colors.bg.card,
    borderWidth: 1,
    borderColor: colors.border.blueHairline,
  },
  pillActive: {
    backgroundColor: colors.brand.azure,
    borderWidth: 1,
    borderColor: colors.brand.azure,
  },
  icon: {
    alignItems: "center",
    justifyContent: "center",
  },
  label: {
    ...typography.bodyBold,
    fontSize: 12.5,
    letterSpacing: 0.2,
  },
  labelIdle: {
    color: colors.text.primary,
  },
  labelActive: {
    color: "#FFFFFF",
  },
  count: {
    minWidth: 20,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: radii.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  countIdle: {
    backgroundColor: colors.bg.elevated,
  },
  countActive: {
    backgroundColor: "#FFFFFF",
  },
  countText: {
    fontFamily: typography.monoBold.fontFamily,
    fontSize: 10.5,
    fontVariant: ["tabular-nums"],
  },
});
