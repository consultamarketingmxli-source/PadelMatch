import React from "react";
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { colors, radii, spacing, typography } from "@/src/theme";

type Variant = "primary" | "secondary" | "danger" | "ghost";

type Props = {
  title: string;
  onPress: () => void;
  variant?: Variant;
  disabled?: boolean;
  loading?: boolean;
  testID?: string;
  icon?: React.ReactNode;
  block?: boolean;
};

export function Button({ title, onPress, variant = "primary", disabled, loading, testID, icon, block = true }: Props) {
  const styleVar = variantStyles[variant];
  return (
    <TouchableOpacity
      testID={testID}
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.7}
      style={[
        styles.base,
        styleVar.button,
        block && { alignSelf: "stretch" },
        (disabled || loading) && { opacity: 0.5 },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={styleVar.text.color} />
      ) : (
        <View style={styles.row}>
          {icon ? <View style={{ marginRight: spacing.sm }}>{icon}</View> : null}
          <Text style={[styles.label, styleVar.text]}>{title}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  base: {
    paddingVertical: spacing.md + 2,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.md,
    alignItems: "center",
    justifyContent: "center",
  },
  row: { flexDirection: "row", alignItems: "center" },
  label: {
    ...typography.label,
    fontSize: 13,
  },
});

const variantStyles = {
  primary: {
    button: { backgroundColor: colors.brand.primary },
    text: { color: colors.text.inverse },
  },
  secondary: {
    button: {
      backgroundColor: "transparent",
      borderWidth: 1,
      borderColor: colors.brand.primary,
    },
    text: { color: colors.brand.primary },
  },
  danger: {
    button: { backgroundColor: colors.status.red },
    text: { color: colors.text.primary },
  },
  ghost: {
    button: {
      backgroundColor: "transparent",
      borderWidth: 1,
      borderColor: colors.border.default,
    },
    text: { color: colors.text.primary },
  },
} as const;
