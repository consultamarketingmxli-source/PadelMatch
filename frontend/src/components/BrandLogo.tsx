/**
 * Logotipo oficial de PadelappRetas — pelota de pádel verde esmeralda
 * intersectada con vértice de cancha. Optimizado para uso a cualquier escala.
 *
 * Variantes:
 *  - `default`: logo color con fondo squircle blanco (uso general).
 *  - `mono`: silueta plana blanca (uso en CTAs sobre fondo emerald).
 *  - `muted`: silueta plana en slate-300 (empty states).
 */
import React from "react";
import Svg, { Circle, Line, Path, Rect } from "react-native-svg";
import { colors } from "@/src/theme";

type Variant = "default" | "mono" | "muted";

type Props = {
  size?: number;
  variant?: Variant;
};

export function BrandLogo({ size = 48, variant = "default" }: Props) {
  if (variant === "mono") {
    return <BrandMarkPlain size={size} color="#FFFFFF" />;
  }
  if (variant === "muted") {
    return <BrandMarkPlain size={size} color={colors.text.tertiary} />;
  }
  return <BrandMarkColor size={size} />;
}

function BrandMarkColor({ size }: { size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64" fill="none">
      {/* Squircle blanco con borde sutil */}
      <Path
        d="M32 2c18 0 30 12 30 30S50 62 32 62 2 50 2 32 14 2 32 2Z"
        fill="#FFFFFF"
        stroke={colors.border.default}
        strokeWidth={1}
      />
      {/* Líneas de cancha (vértice apuntando arriba) */}
      <Path
        d="M14 50 L32 14 L50 50"
        stroke={colors.text.primary}
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <Line
        x1={20}
        y1={50}
        x2={44}
        y2={50}
        stroke={colors.text.primary}
        strokeWidth={2.2}
        strokeLinecap="round"
      />
      {/* Pelota de pádel — círculo emerald-600 con costura */}
      <Circle cx={32} cy={34} r={9.5} fill={colors.brand.primary} />
      <Path
        d="M23 34c0-2.2 1.1-4.2 3-5.4"
        stroke="#FFFFFF"
        strokeWidth={1.5}
        strokeLinecap="round"
        fill="none"
      />
      <Path
        d="M41 34c0 2.2-1.1 4.2-3 5.4"
        stroke="#FFFFFF"
        strokeWidth={1.5}
        strokeLinecap="round"
        fill="none"
      />
    </Svg>
  );
}

// Versión plana (sin squircle) para CTAs y empty states.
function BrandMarkPlain({ size, color }: { size: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* Vértice de cancha */}
      <Path
        d="M4 19 L12 5 L20 19"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <Line
        x1={7}
        y1={19}
        x2={17}
        y2={19}
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
      />
      {/* Pelota */}
      <Circle cx={12} cy={13.2} r={3.6} fill={color} />
    </Svg>
  );
}
