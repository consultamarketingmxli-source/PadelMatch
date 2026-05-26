import React from "react";
import { StyleSheet, Text, TextInput, View, TextInputProps } from "react-native";
import { colors, radii, spacing, typography } from "@/src/theme";

type Props = TextInputProps & {
  label?: string;
  hint?: string;
  testID?: string;
};

export function Input({ label, hint, style, testID, ...rest }: Props) {
  return (
    <View style={styles.wrap}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <TextInput
        testID={testID}
        placeholderTextColor={colors.text.muted}
        style={[styles.input, style]}
        {...rest}
      />
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: "100%", marginBottom: spacing.md },
  label: {
    ...typography.label,
    color: colors.text.secondary,
    marginBottom: 6,
  },
  input: {
    backgroundColor: colors.bg.card,
    borderWidth: 1,
    borderColor: colors.border.default,
    borderRadius: radii.md,
    paddingHorizontal: spacing.base,
    paddingVertical: 14,
    color: colors.text.primary,
    fontSize: 15,
  },
  hint: {
    ...typography.caption,
    color: colors.text.muted,
    marginTop: 4,
  },
});
