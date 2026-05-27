/**
 * EmptyState — visual de marca con isotipo PadelappRetas + signo de interrogación,
 * mantiene identidad visual incluso cuando no hay datos.
 */
import React from "react";
import { StyleSheet, Text, View, ViewStyle } from "react-native";
import Svg, { Circle, Line, Path, Text as SvgText } from "react-native-svg";
import { colors, spacing } from "@/src/theme";
import { FONTS } from "@/src/hooks/use-app-fonts";

type Props = {
  title: string;
  subtitle?: string;
  size?: number;
  style?: ViewStyle;
  testID?: string;
};

export function EmptyState({ title, subtitle, size = 140, style, testID }: Props) {
  return (
    <View style={[styles.wrap, style]} testID={testID}>
      <BrandMarkWithQuestion size={size} color={colors.text.tertiary} />
      <Text style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    </View>
  );
}

function BrandMarkWithQuestion({ size, color }: { size: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 80 80" fill="none">
      {/* Vértice de cancha (líneas) */}
      <Path
        d="M18 60 L32 28 L46 60"
        stroke={color}
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <Line
        x1={22}
        y1={60}
        x2={42}
        y2={60}
        stroke={color}
        strokeWidth={2.2}
        strokeLinecap="round"
      />
      {/* Pelota */}
      <Circle cx={32} cy={44} r={7} fill={color} opacity={0.6} />
      {/* Signo de interrogación a la derecha */}
      <SvgText
        x={60}
        y={48}
        fontSize={32}
        fontWeight="900"
        fill={color}
        opacity={0.7}
      >
        ?
      </SvgText>
    </Svg>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
  },
  title: {
    fontFamily: FONTS.sansExtraBold,
    fontSize: 17,
    color: colors.text.primary,
    letterSpacing: -0.3,
    marginTop: spacing.base,
    textAlign: "center",
  },
  subtitle: {
    fontFamily: FONTS.sansRegular,
    fontSize: 14,
    color: colors.text.secondary,
    marginTop: spacing.xs,
    textAlign: "center",
    lineHeight: 20,
  },
});
