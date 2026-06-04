/**
 * SectionHeader — Encabezado de sección con eyebrow + título + acción.
 *
 * Layout:
 *   [Eyebrow uppercase pequeño]
 *   [Título h2 con tracking negativo]   [TouchableOpacity opcional →]
 *   [Subtítulo gris opcional]
 */
import React from "react";
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  ViewStyle,
} from "react-native";
import { ChevronRight } from "lucide-react-native";
import { colors, spacing, typography } from "@/src/theme";

export type SectionHeaderProps = {
  title: string;
  eyebrow?: string;
  subtitle?: string;
  actionLabel?: string;
  onActionPress?: () => void;
  style?: ViewStyle;
  testID?: string;
};

export function SectionHeader({
  title,
  eyebrow,
  subtitle,
  actionLabel,
  onActionPress,
  style,
  testID,
}: SectionHeaderProps) {
  return (
    <View testID={testID} style={[styles.wrapper, style]}>
      {eyebrow ? (
        <Text style={styles.eyebrow} numberOfLines={1}>
          {eyebrow}
        </Text>
      ) : null}
      <View style={styles.row}>
        <Text style={styles.title} numberOfLines={2}>
          {title}
        </Text>
        {actionLabel ? (
          <TouchableOpacity
            onPress={onActionPress}
            activeOpacity={0.7}
            style={styles.action}
          >
            <Text style={styles.actionLabel}>{actionLabel}</Text>
            <ChevronRight size={14} color={colors.brand.azure} />
          </TouchableOpacity>
        ) : null}
      </View>
      {subtitle ? (
        <Text style={styles.subtitle} numberOfLines={2}>
          {subtitle}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    marginBottom: spacing.md,
  },
  eyebrow: {
    ...typography.label,
    fontSize: 10,
    color: colors.brand.azure,
    letterSpacing: 1.6,
    marginBottom: 4,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  title: {
    ...typography.h2,
    flex: 1,
  },
  action: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  actionLabel: {
    ...typography.button,
    color: colors.brand.azure,
    fontSize: 11,
  },
  subtitle: {
    ...typography.bodySm,
    color: colors.text.secondary,
    marginTop: 4,
  },
});
