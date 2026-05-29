/**
 * Skeleton primitives — placeholders animados para esperas intermedias
 * (300–800ms). Más baratos que un spinner y dan percepción de contenido
 * ya construido.
 *
 * Implementación:
 *   - Pulso de opacidad con Reanimated (UI thread).
 *   - StyleSheet plano, sin gradientes pesados.
 *   - API tipo Material/Telegram: <Skeleton.Box w h /> · <Skeleton.Line w h />
 */
import React, { useEffect } from "react";
import { StyleSheet, View, ViewStyle } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

const BASE = "#E2E8F0";
const HIGHLIGHT = "#F1F5F9";

function usePulse() {
  const v = useSharedValue(0);
  useEffect(() => {
    v.value = withRepeat(
      withTiming(1, { duration: 1100, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
  }, [v]);
  return useAnimatedStyle(() => ({
    backgroundColor: v.value > 0.5 ? HIGHLIGHT : BASE,
    opacity: 0.6 + v.value * 0.4,
  }));
}

export type SkeletonBoxProps = {
  w?: number | `${number}%` | "100%";
  h?: number;
  radius?: number;
  style?: ViewStyle;
};

function Box({ w = "100%", h = 12, radius = 6, style }: SkeletonBoxProps) {
  const pulse = usePulse();
  return (
    <Animated.View
      style={[
        { width: w as any, height: h, borderRadius: radius, backgroundColor: BASE },
        pulse,
        style,
      ]}
    />
  );
}

function Line({ w = "60%", h = 10 }: SkeletonBoxProps) {
  return <Box w={w} h={h} radius={4} style={{ marginVertical: 4 }} />;
}

function Circle({ size = 40 }: { size?: number }) {
  return <Box w={size} h={size} radius={size / 2} />;
}

/** Card preset de feed de retas (replica el shape del RetaCard) */
function RetaCard() {
  return (
    <View style={styles.card}>
      <Box w="100%" h={120} radius={12} />
      <View style={{ height: 12 }} />
      <Line w="70%" h={14} />
      <Line w="40%" h={10} />
      <View style={styles.row}>
        <Box w={70} h={22} radius={11} />
        <Box w={70} h={22} radius={11} />
      </View>
    </View>
  );
}

/** Card preset genérica (rectangular grande). */
function GenericCard() {
  return (
    <View style={styles.card}>
      <Line w="50%" h={14} />
      <Line w="80%" h={10} />
      <Line w="60%" h={10} />
    </View>
  );
}

export const Skeleton = {
  Box,
  Line,
  Circle,
  RetaCard,
  GenericCard,
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#fff",
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#F1F5F9",
  },
  row: {
    flexDirection: "row",
    gap: 8,
    marginTop: 12,
  },
});
