/**
 * CTAButton — Botón primario premium con gradiente Sapphire→Azure.
 *
 * Spec: bg gradient #3B82F6 → #1E3A8A, sombra azul colored, radius 14-16,
 *        peso ExtraBold + tracking-tight.
 */
import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { ArrowRight } from "lucide-react-native";
import { colors, fonts, radii, shadows } from "@/src/theme";

export type CTAButtonProps = {
  label: string;
  onPress?: () => void;
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  size?: "md" | "lg";
  testID?: string;
};

export function CTAButton({
  label,
  onPress,
  loading = false,
  disabled = false,
  fullWidth = false,
  size = "lg",
  testID,
}: CTAButtonProps) {
  const isDisabled = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      testID={testID}
      style={({ pressed }) => [
        styles.wrap,
        fullWidth && styles.full,
        pressed && !isDisabled && styles.pressed,
        isDisabled && styles.disabled,
      ]}
    >
      <LinearGradient
        colors={[colors.brand.azure, colors.brand.sapphire]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[
          styles.gradient,
          size === "lg" ? styles.lg : styles.md,
          shadows.btn,
        ]}
      >
        <View style={styles.row}>
          {loading ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <>
              <Text style={styles.label}>{label}</Text>
              <ArrowRight size={size === "lg" ? 16 : 13} color="#fff" strokeWidth={2.6} />
            </>
          )}
        </View>
      </LinearGradient>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { borderRadius: radii.button, overflow: "hidden" },
  full: { alignSelf: "stretch" },
  gradient: { borderRadius: radii.button, alignItems: "center", justifyContent: "center" },
  md: { paddingVertical: 11, paddingHorizontal: 18 },
  lg: { paddingVertical: 16, paddingHorizontal: 22 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10 },
  label: {
    color: "#fff",
    fontFamily: fonts.sansExtraBold,
    fontSize: 15,
    letterSpacing: -0.3,
  },
  pressed: { opacity: 0.9, transform: [{ translateY: 1 }] },
  disabled: { opacity: 0.5 },
});
