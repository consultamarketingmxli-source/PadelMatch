/**
 * CTAButton — Botón premium del rebrand v3 (Sapphire/Azure).
 *
 * Variantes:
 *   • primary  : gradiente Azure → Sapphire + shadow azure glow.
 *   • secondary: fondo blanco + borde azul hairline.
 *   • ghost    : texto azure, sin fondo.
 *   • danger   : rojo coral con glow rojo.
 *
 * Tamaños: sm / md (default) / lg. Soporta `loading`, `disabled`, iconos.
 */
import React from "react";
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  ViewStyle,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { colors, radii, shadows, typography } from "@/src/theme";

export type CTAButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type CTAButtonSize = "sm" | "md" | "lg";

export type CTAButtonProps = {
  label: string;
  onPress?: () => void;
  variant?: CTAButtonVariant;
  size?: CTAButtonSize;
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
  fullWidth?: boolean;
  loading?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
  testID?: string;
};

const SIZE_MAP: Record<
  CTAButtonSize,
  { paddingV: number; paddingH: number; fontSize: number; minHeight: number }
> = {
  sm: { paddingV: 8, paddingH: 14, fontSize: 12, minHeight: 36 },
  md: { paddingV: 12, paddingH: 18, fontSize: 13, minHeight: 46 },
  lg: { paddingV: 16, paddingH: 22, fontSize: 14, minHeight: 54 },
};

export function CTAButton({
  label,
  onPress,
  variant = "primary",
  size = "md",
  leading,
  trailing,
  fullWidth,
  loading,
  disabled,
  style,
  testID,
}: CTAButtonProps) {
  const s = SIZE_MAP[size];
  const isPrimary = variant === "primary";
  const isDanger = variant === "danger";
  const isGhost = variant === "ghost";
  const isSecondary = variant === "secondary";
  const isInteractive = !loading && !disabled;

  const textColor = isPrimary || isDanger
    ? "#FFFFFF"
    : isGhost
    ? colors.brand.azure
    : colors.brand.sapphire;

  const content = (
    <View style={styles.content}>
      {leading ? <View style={styles.icon}>{leading}</View> : null}
      {loading ? (
        <ActivityIndicator
          size="small"
          color={isPrimary || isDanger ? "#FFFFFF" : colors.brand.azure}
        />
      ) : (
        <Text
          style={[
            styles.label,
            { fontSize: s.fontSize, color: textColor },
          ]}
          numberOfLines={1}
        >
          {label}
        </Text>
      )}
      {trailing ? <View style={styles.icon}>{trailing}</View> : null}
    </View>
  );

  const sizingStyle: ViewStyle = {
    minHeight: s.minHeight,
    paddingVertical: s.paddingV,
    paddingHorizontal: s.paddingH,
    width: fullWidth ? "100%" : undefined,
    opacity: disabled ? 0.55 : 1,
  };

  if (isPrimary) {
    return (
      <TouchableOpacity
        testID={testID}
        onPress={onPress}
        activeOpacity={0.9}
        disabled={!isInteractive}
        style={[
          styles.wrapper,
          shadows.btn as object,
          sizingStyle,
          style,
        ]}
      >
        <LinearGradient
          colors={[colors.brand.gradientFrom, colors.brand.gradientTo]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill as ViewStyle}
        />
        {content}
      </TouchableOpacity>
    );
  }

  if (isDanger) {
    return (
      <TouchableOpacity
        testID={testID}
        onPress={onPress}
        activeOpacity={0.9}
        disabled={!isInteractive}
        style={[
          styles.wrapper,
          {
            backgroundColor: colors.status.red,
            boxShadow: "0px 6px 18px rgba(225,29,72,0.35)",
          } as any,
          sizingStyle,
          style,
        ]}
      >
        {content}
      </TouchableOpacity>
    );
  }

  if (isGhost) {
    return (
      <TouchableOpacity
        testID={testID}
        onPress={onPress}
        activeOpacity={0.7}
        disabled={!isInteractive}
        style={[styles.wrapper, sizingStyle, style]}
      >
        {content}
      </TouchableOpacity>
    );
  }

  // secondary
  return (
    <TouchableOpacity
      testID={testID}
      onPress={onPress}
      activeOpacity={0.85}
      disabled={!isInteractive}
      style={[
        styles.wrapper,
        styles.secondary,
        sizingStyle,
        style,
      ]}
    >
      {content}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    borderRadius: radii.button,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  secondary: {
    backgroundColor: colors.bg.card,
    borderWidth: 1,
    borderColor: colors.border.blueHairline,
  },
  content: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  icon: {
    alignItems: "center",
    justifyContent: "center",
  },
  label: {
    ...typography.button,
    letterSpacing: 0.6,
    textAlign: "center",
  },
});
