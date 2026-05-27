/**
 * Componentes SVG temáticos de Pádel.
 *
 * - PadelPalaIcon: silueta de pala con patrón geométrico de agujeros.
 * - CourtClockIcon: reloj de 24h + línea de pista.
 * - WaitlistShieldIcon: silueta de jugador + escudo de reserva.
 * - MeshDivider: divisor con patrón de malla metálica (opacity-20).
 * - CourtWatermark: marca de agua con líneas oficiales de cancha (opacity-5).
 */
import React from "react";
import { View, StyleSheet, ViewStyle } from "react-native";
import Svg, {
  Circle,
  Defs,
  G,
  Line,
  Path,
  Pattern,
  Rect,
} from "react-native-svg";
import { colors } from "@/src/theme";

type IconProps = { size?: number; color?: string };

// =========== Pala de Pádel con agujeros ===========
export function PadelPalaIcon({
  size = 22,
  color = colors.brand.primary,
}: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* Mango */}
      <Path
        d="M11 18.5h2v3.2a1 1 0 0 1-2 0v-3.2Z"
        fill={color}
      />
      {/* Cabeza pála */}
      <Path
        d="M12 1.5c4.42 0 8 3.58 8 8s-3.58 8-8 8-8-3.58-8-8 3.58-8 8-8Z"
        stroke={color}
        strokeWidth={1.8}
        fill="none"
      />
      {/* Patrón de agujeros */}
      <Circle cx={9} cy={7.5} r={0.9} fill={color} />
      <Circle cx={12} cy={7.5} r={0.9} fill={color} />
      <Circle cx={15} cy={7.5} r={0.9} fill={color} />
      <Circle cx={7.5} cy={10} r={0.9} fill={color} />
      <Circle cx={10.5} cy={10} r={0.9} fill={color} />
      <Circle cx={13.5} cy={10} r={0.9} fill={color} />
      <Circle cx={16.5} cy={10} r={0.9} fill={color} />
      <Circle cx={9} cy={12.5} r={0.9} fill={color} />
      <Circle cx={12} cy={12.5} r={0.9} fill={color} />
      <Circle cx={15} cy={12.5} r={0.9} fill={color} />
      <Circle cx={10.5} cy={15} r={0.9} fill={color} />
      <Circle cx={13.5} cy={15} r={0.9} fill={color} />
    </Svg>
  );
}

// =========== Reloj 24h + línea de pista ===========
export function CourtClockIcon({
  size = 22,
  color = colors.brand.primary,
}: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* Reloj */}
      <Circle cx={9} cy={9} r={6.5} stroke={color} strokeWidth={1.8} fill="none" />
      {/* Manecillas */}
      <Line x1={9} y1={9} x2={9} y2={5.5} stroke={color} strokeWidth={1.6} strokeLinecap="round" />
      <Line x1={9} y1={9} x2={11.5} y2={9} stroke={color} strokeWidth={1.6} strokeLinecap="round" />
      {/* Línea de pista (cancha minimalista) */}
      <Rect
        x={11.5}
        y={17.5}
        width={11}
        height={4.5}
        rx={0.6}
        stroke={color}
        strokeWidth={1.4}
        fill="none"
      />
      <Line
        x1={17}
        y1={17.5}
        x2={17}
        y2={22}
        stroke={color}
        strokeWidth={1.2}
      />
    </Svg>
  );
}

// =========== Silueta jugador + escudo de reserva ===========
export function WaitlistShieldIcon({
  size = 22,
  color = colors.brand.primary,
}: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* Cabeza */}
      <Circle cx={9} cy={6.5} r={2.8} stroke={color} strokeWidth={1.7} fill="none" />
      {/* Torso */}
      <Path
        d="M2.5 20.5c0-3.6 2.9-6.5 6.5-6.5s6.5 2.9 6.5 6.5"
        stroke={color}
        strokeWidth={1.7}
        fill="none"
        strokeLinecap="round"
      />
      {/* Escudo de reserva */}
      <Path
        d="M18 8.5l3.5 1.4v3.5c0 2.7-1.6 5-3.5 5.8-1.9-.8-3.5-3.1-3.5-5.8V9.9L18 8.5Z"
        fill={color}
      />
      {/* Check dentro del escudo */}
      <Path
        d="M16.5 13l1.2 1.2L19.6 12"
        stroke="#FFFFFF"
        strokeWidth={1.4}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  );
}

// =========== Divisor con malla metálica perimetral ===========
export function MeshDivider({ style }: { style?: ViewStyle }) {
  return (
    <View style={[meshStyles.wrap, style, { pointerEvents: "none" }]}>
      <Svg width="100%" height={14} viewBox="0 0 200 14" preserveAspectRatio="none">
        <Defs>
          <Pattern id="mesh" x={0} y={0} width={10} height={10} patternUnits="userSpaceOnUse">
            {/* Diamantes que emulan malla */}
            <Path
              d="M0 5 L5 0 L10 5 L5 10 Z"
              stroke={colors.text.tertiary}
              strokeWidth={0.6}
              fill="none"
              opacity={0.2}
            />
          </Pattern>
        </Defs>
        <Rect width="100%" height="100%" fill="url(#mesh)" />
        {/* Línea base superior e inferior (refuerzo perimetral) */}
        <Line
          x1={0}
          y1={0.5}
          x2={200}
          y2={0.5}
          stroke={colors.border.default}
          strokeWidth={0.6}
        />
        <Line
          x1={0}
          y1={13.5}
          x2={200}
          y2={13.5}
          stroke={colors.border.default}
          strokeWidth={0.6}
        />
      </Svg>
    </View>
  );
}

// =========== Marca de agua · plano de cancha de cristal ===========
export function CourtWatermark({
  width = 320,
  height = 110,
  style,
}: {
  width?: number;
  height?: number;
  style?: ViewStyle;
}) {
  // Plano oficial: 20m x 10m. Escala ajustada al viewBox 200x100.
  return (
    <View
      style={[
        { position: "absolute", right: -10, top: -10, opacity: 0.05, pointerEvents: "none" },
        style,
      ]}
    >
      <Svg width={width} height={height} viewBox="0 0 200 100" fill="none">
        {/* Borde exterior */}
        <Rect
          x={2}
          y={2}
          width={196}
          height={96}
          stroke={colors.text.primary}
          strokeWidth={1.6}
          fill="none"
        />
        {/* Línea de red central */}
        <Line
          x1={100}
          y1={2}
          x2={100}
          y2={98}
          stroke={colors.text.primary}
          strokeWidth={1.4}
          strokeDasharray="3,2"
        />
        {/* Líneas de saque (paralelas a la red, a 6.95m / aprox 70% del lado) */}
        <Line x1={30} y1={2} x2={30} y2={98} stroke={colors.text.primary} strokeWidth={1.2} />
        <Line x1={170} y1={2} x2={170} y2={98} stroke={colors.text.primary} strokeWidth={1.2} />
        {/* Línea central de saque */}
        <Line x1={30} y1={50} x2={170} y2={50} stroke={colors.text.primary} strokeWidth={1.2} />
        {/* Esquinas (cristales laterales) */}
        <Line x1={2} y1={20} x2={198} y2={20} stroke={colors.text.primary} strokeWidth={0.6} opacity={0.5} />
        <Line x1={2} y1={80} x2={198} y2={80} stroke={colors.text.primary} strokeWidth={0.6} opacity={0.5} />
      </Svg>
    </View>
  );
}

// =========== Logo / Isotipo PadelappRetas OS (Squircle) ===========
export function PixelPadelLogo({ size = 48 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64" fill="none">
      <Defs>
        <Pattern id="bg-grad" x={0} y={0} width={64} height={64} patternUnits="userSpaceOnUse">
          <Rect width={64} height={64} fill="#FFFFFF" />
        </Pattern>
      </Defs>
      {/* Squircle base */}
      <Path
        d="M32 2c18 0 30 12 30 30S50 62 32 62 2 50 2 32 14 2 32 2Z"
        fill="#FFFFFF"
        stroke={colors.border.default}
        strokeWidth={1}
      />
      {/* Vértice de cancha (3 líneas angulares) */}
      <Path
        d="M14 50 L32 14 L50 50"
        stroke={colors.text.primary}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <Line x1={20} y1={50} x2={44} y2={50} stroke={colors.text.primary} strokeWidth={2} strokeLinecap="round" />
      {/* Pelota de pádel */}
      <Circle cx={32} cy={34} r={9} fill="#059669" />
      <Path
        d="M23 34c0-2 1-4 3-5"
        stroke="#FFFFFF"
        strokeWidth={1.4}
        strokeLinecap="round"
        fill="none"
      />
      <Path
        d="M41 34c0 2-1 4-3 5"
        stroke="#FFFFFF"
        strokeWidth={1.4}
        strokeLinecap="round"
        fill="none"
      />
    </Svg>
  );
}

const meshStyles = StyleSheet.create({
  wrap: {
    width: "100%",
    height: 14,
    overflow: "hidden",
  },
});
