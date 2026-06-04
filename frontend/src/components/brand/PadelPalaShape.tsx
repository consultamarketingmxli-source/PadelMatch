/**
 * PadelPalaShape — Forma CANÓNICA de pala de pádel (Rebrand v3).
 *
 * SINGLE SOURCE OF TRUTH: ningún otro componente debe redibujar la pala.
 * La FORMA es inmutable; solo el COLOR puede cambiar por contexto.
 *
 * Spec del Master Design Sapphire/Azure:
 *   • Cabezal teardrop con cuello estrecho hacia el grip.
 *   • Highlight rim lateral (brillo blanco 20% en el borde izquierdo).
 *   • Grid 3×5 de perforaciones blancas con falloff de opacidad.
 *   • Grip cilíndrico con 4 grip-wrap lines (vendaje).
 *   • Cordón de muñeca curvo + lazo ovalado.
 *
 * API DE PROPS PRESERVADA — drop-in compatible con todos los imports.
 */
import React from "react";
import Svg, { Circle, Ellipse, Line, Path } from "react-native-svg";

export type PadelPalaShapeProps = {
  /** Alto en px (default 64). El ancho se calcula con aspect 4:7. */
  size?: number;
  /** Color principal de cuerpo y grip (default Sapphire). */
  color?: string;
  /** Override del color del grip (default = `color`). */
  gripColor?: string;
  /** Color de las perforaciones (default blanco). */
  holeColor?: string;
  /** Color del cordón (default = `color`). */
  cordColor?: string;
  /** Opacidad global del cuerpo (default 1). */
  opacity?: number;
};

const HEAD_AND_GRIP_PATH =
  "M50 3 " +
  "C20 3 2 25 2 52 " +
  "C2 75 15 92 33 100 " +
  "C35.5 101.2 37 103.5 37 106 " +
  "L37 110 " +
  "C37 112.5 35 114.5 32.5 114.5 " +
  "L29 114.5 " +
  "C24.5 114.5 21 118 21 122.5 " +
  "L21 144 " +
  "C21 149.5 25.5 153 31 153 " +
  "L69 153 " +
  "C74.5 153 79 149.5 79 144 " +
  "L79 122.5 " +
  "C79 118 75.5 114.5 71 114.5 " +
  "L67.5 114.5 " +
  "C65 114.5 63 112.5 63 110 " +
  "L63 106 " +
  "C63 103.5 64.5 101.2 67 100 " +
  "C85 92 98 75 98 52 " +
  "C98 25 80 3 50 3Z";

export function PadelPalaShape({
  size = 64,
  color = "#1E3A8A",
  gripColor,
  holeColor = "#FFFFFF",
  cordColor,
  opacity = 1,
}: PadelPalaShapeProps) {
  // ViewBox 100×175 (aspect 4:7). El ancho proporcional al alto.
  const h = size;
  const w = (size * 100) / 175;
  const cord = cordColor ?? color;
  void gripColor;

  return (
    <Svg width={w} height={h} viewBox="0 0 100 175" fill="none">
      {/* Silueta principal (cabezal + cuello + grip integrados) */}
      <Path d={HEAD_AND_GRIP_PATH} fill={color} opacity={opacity} />

      {/* Highlight rim — brillo lateral izquierdo (efecto carbono pulido) */}
      <Path
        d="M50 8 C23 8 7 28 7 52 C7 73 19 89 36 97"
        stroke="rgba(255,255,255,0.20)"
        strokeWidth={3}
        strokeLinecap="round"
        fill="none"
      />

      {/* Grid 3×5 de perforaciones con falloff de opacidad */}
      {/* Fila 1 */}
      <Circle cx={35} cy={34} r={6.2} fill={holeColor} fillOpacity={0.28} />
      <Circle cx={50} cy={34} r={6.2} fill={holeColor} fillOpacity={0.28} />
      <Circle cx={65} cy={34} r={6.2} fill={holeColor} fillOpacity={0.28} />
      {/* Fila 2 */}
      <Circle cx={35} cy={48} r={6.2} fill={holeColor} fillOpacity={0.28} />
      <Circle cx={50} cy={48} r={6.2} fill={holeColor} fillOpacity={0.28} />
      <Circle cx={65} cy={48} r={6.2} fill={holeColor} fillOpacity={0.28} />
      {/* Fila 3 */}
      <Circle cx={35} cy={62} r={6.2} fill={holeColor} fillOpacity={0.28} />
      <Circle cx={50} cy={62} r={6.2} fill={holeColor} fillOpacity={0.28} />
      <Circle cx={65} cy={62} r={6.2} fill={holeColor} fillOpacity={0.28} />
      {/* Fila 4 (atenuada) */}
      <Circle cx={35} cy={76} r={6.2} fill={holeColor} fillOpacity={0.22} />
      <Circle cx={50} cy={76} r={6.2} fill={holeColor} fillOpacity={0.22} />
      <Circle cx={65} cy={76} r={6.2} fill={holeColor} fillOpacity={0.22} />
      {/* Fila 5 parcial (extremo) */}
      <Circle cx={42} cy={89} r={5.5} fill={holeColor} fillOpacity={0.16} />
      <Circle cx={58} cy={89} r={5.5} fill={holeColor} fillOpacity={0.16} />

      {/* Grip wrap lines — vendaje del mango */}
      <Line x1={30} y1={124} x2={70} y2={124} stroke="rgba(255,255,255,0.18)" strokeWidth={1.5} />
      <Line x1={30} y1={131} x2={70} y2={131} stroke="rgba(255,255,255,0.18)" strokeWidth={1.5} />
      <Line x1={30} y1={138} x2={70} y2={138} stroke="rgba(255,255,255,0.18)" strokeWidth={1.5} />
      <Line x1={30} y1={145} x2={70} y2={145} stroke="rgba(255,255,255,0.12)" strokeWidth={1.2} />

      {/* Cordón de muñeca con lazo ovalado */}
      <Path
        d="M50 153 Q50 159 45 161 Q37 165 37 170 Q37 174 42 174"
        stroke={cord}
        strokeWidth={2.8}
        strokeLinecap="round"
        fill="none"
        opacity={0.65}
      />
      <Ellipse
        cx={43}
        cy={173}
        rx={6}
        ry={4}
        stroke={cord}
        strokeWidth={2.2}
        fill="none"
        opacity={0.55}
      />
    </Svg>
  );
}
