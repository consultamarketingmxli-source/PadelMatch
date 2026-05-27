/**
 * Toast minimalista cross-platform (sin dependencias externas).
 * Aparece flotando arriba con fade-in, se autodescarta a los 2.5s.
 */
import React, { useEffect, useRef } from "react";
import { Animated, StyleSheet, Text } from "react-native";
import { colors, fonts, radii, shadows, spacing } from "@/src/theme";

type Props = {
  message: string;
  visible: boolean;
  onHide: () => void;
  tone?: "info" | "warn" | "error";
};

export function Toast({ message, visible, onHide, tone = "info" }: Props) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translate = useRef(new Animated.Value(-12)).current;

  useEffect(() => {
    if (!visible) return;
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 220, useNativeDriver: true }),
      Animated.timing(translate, { toValue: 0, duration: 220, useNativeDriver: true }),
    ]).start();
    const t = setTimeout(() => {
      Animated.parallel([
        Animated.timing(opacity, { toValue: 0, duration: 220, useNativeDriver: true }),
        Animated.timing(translate, { toValue: -12, duration: 220, useNativeDriver: true }),
      ]).start(() => onHide());
    }, 2500);
    return () => clearTimeout(t);
  }, [visible, opacity, translate, onHide]);

  if (!visible) return null;

  const bg =
    tone === "error" ? colors.status.redText :
    tone === "warn"  ? colors.status.amberText :
    colors.text.primary;

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.toast,
        { backgroundColor: bg, opacity, transform: [{ translateY: translate }] },
      ]}
      testID="toast"
    >
      <Text style={styles.text}>{message}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  toast: {
    position: "absolute",
    top: spacing.lg,
    left: spacing.lg,
    right: spacing.lg,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.md,
    borderRadius: radii.md,
    zIndex: 999,
    ...(shadows.cardHover as object),
  },
  text: {
    color: "#FFFFFF",
    fontFamily: fonts.sansSemiBold,
    fontSize: 13,
    textAlign: "center",
    lineHeight: 18,
  },
});
