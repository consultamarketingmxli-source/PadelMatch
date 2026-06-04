/**
 * CourtLinesBackground — fondo SVG ultra sutil que recrea las líneas
 * oficiales de una cancha de pádel (top-down).
 *
 * Diseño:
 *   • Rectángulo exterior (paredes del fondo).
 *   • Red transversal central (línea horizontal punteada).
 *   • Líneas de saque a 1/4 y 3/4 verticales.
 *   • Línea central de saque vertical (sólo entre líneas de saque).
 *
 * Opacidad por defecto: 0.04 (≈ slate-200/30) — completamente decorativo,
 * "flota al fondo" sin interferir con la lectura tipográfica.
 *
 * Uso:
 *   <View style={{flex:1}}>
 *     <CourtLinesBackground />
 *     // contenido encima
 *   </View>
 */
import React from "react";
import { StyleSheet, View, ViewStyle } from "react-native";
import Svg, { Line, Rect } from "react-native-svg";

type Props = {
  /** Override opacidad — 0.03 muy fantasma, 0.08 más visible. */
  opacity?: number;
  /** Color de línea — default slate-300. */
  color?: string;
  /** Si false, oculta. Útil para deshabilitar en pantallas pequeñas. */
  visible?: boolean;
  style?: ViewStyle;
};

export function CourtLinesBackground({
  opacity = 0.02,
  color = "#0F172A",
  visible = true,
  style,
}: Props) {
  if (!visible) return null;
  return (
    <View style={[styles.abs, style, { pointerEvents: "none" }]}>
      <Svg
        width="100%"
        height="100%"
        viewBox="0 0 200 300"
        preserveAspectRatio="xMidYMid meet"
        opacity={opacity}
      >
        {/* Marco exterior (paredes) */}
        <Rect
          x={10}
          y={20}
          width={180}
          height={260}
          stroke={color}
          strokeWidth={1.2}
          fill="none"
          rx={2}
        />

        {/* Línea de fondo superior e inferior interiores */}
        <Line x1={10} y1={20} x2={190} y2={20} stroke={color} strokeWidth={1.2} />
        <Line x1={10} y1={280} x2={190} y2={280} stroke={color} strokeWidth={1.2} />

        {/* Línea de la red (centro horizontal con dash para sugerir malla) */}
        <Line
          x1={10}
          y1={150}
          x2={190}
          y2={150}
          stroke={color}
          strokeWidth={1.6}
          strokeDasharray="2 2"
        />

        {/* Líneas de saque (paralelas a la red, a 70 y 230) */}
        <Line x1={10} y1={80} x2={190} y2={80} stroke={color} strokeWidth={1} />
        <Line x1={10} y1={220} x2={190} y2={220} stroke={color} strokeWidth={1} />

        {/* Línea central de saque vertical — entre líneas de saque y red */}
        <Line x1={100} y1={80} x2={100} y2={150} stroke={color} strokeWidth={1} />
        <Line x1={100} y1={150} x2={100} y2={220} stroke={color} strokeWidth={1} />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  abs: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
});
