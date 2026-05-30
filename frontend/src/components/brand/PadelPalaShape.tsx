/**
 * PadelPalaShape — Forma CANÓNICA de pala de pádel para toda la app.
 *
 * SINGLE SOURCE OF TRUTH: ningún otro componente debe redibujar la pala.
 * La FORMA es inmutable; solo el COLOR puede cambiar por contexto.
 *
 * Referencia visual: Pala de Padel.png
 *   • Cabezal teardrop / lágrima (más ancho arriba, se afina hacia el cuello).
 *   • Grid 8×8 uniforme de perforaciones blancas (~56 visibles tras recorte
 *     a la silueta del cabezal).
 *   • Mango cilíndrico con cap superior + cap inferior (knob).
 *   • Cordón de muñeca saliendo lateralmente del knob.
 *   • SIN muesca en V (no aparece en la referencia).
 */
import React from "react";
import Svg, { Circle, G, Path, Rect } from "react-native-svg";

export type PadelPalaShapeProps = {
  /** Alto en px (default 64). El ancho se calcula con aspect 4:5. */
  size?: number;
  /** Color principal de cuerpo, grip y cordón (default negro pádel). */
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

const HEAD_PATH =
  "M 40 4 C 26 4, 14 16, 8 32 C 5 42, 5 50, 8 56 " +
  "C 11 64, 20 71, 32 72 L 48 72 " +
  "C 60 71, 69 64, 72 56 C 75 50, 75 42, 72 32 " +
  "C 66 16, 54 4, 40 4 Z";

export function PadelPalaShape({
  size = 64,
  color = "#1E1B4B",
  gripColor,
  holeColor = "#FFFFFF",
  cordColor,
  opacity = 1,
}: PadelPalaShapeProps) {
  // Aspect ratio 4:5 (viewBox 80×100).
  const w = (size * 4) / 5;
  const h = size;
  const gripFill = gripColor ?? color;
  const cordFill = cordColor ?? color;

  return (
    <Svg width={w} height={h} viewBox="0 0 80 100" fill="none">
      {/* Cabezal teardrop */}
      <Path d={HEAD_PATH} fill={color} opacity={opacity} />

      {/* Perforaciones — grid 8×8 recortado a la silueta del cabezal. */}
      <HoleGrid color={holeColor} />

      {/* Grip — cap superior, cilindro y knob inferior. */}
      <Rect x={35} y={72} width={10} height={2.5} rx={1} fill={gripFill} />
      <Rect x={36} y={74.5} width={8} height={16} rx={1.8} fill={gripFill} />
      <Rect x={34} y={90.5} width={12} height={3} rx={1.4} fill={gripFill} />

      {/* Cordón de muñeca — sale lateralmente del knob. */}
      <Path
        d="M 45 92 C 56 93, 62 97, 60 100 C 58 97, 52 96, 47 95"
        stroke={cordFill}
        strokeWidth={1.6}
        strokeLinecap="round"
        fill="none"
      />
    </Svg>
  );
}

/**
 * Grid 8 columnas × 8 filas de perforaciones, centrado y recortado a la
 * elipse interior del cabezal teardrop. Replica el patrón uniforme de la
 * referencia (~56 huecos visibles).
 */
function HoleGrid({ color }: { color: string }) {
  const cx = 40;
  const cy = 38;
  const cols = 8;
  const rows = 8;
  const stepX = 6.2;
  const stepY = 6.6;
  const dotR = 1.7;
  // Elipse de recorte (área interior útil del cabezal).
  const rxClip = 26;
  const ryClip = 30;

  const dots: { x: number; y: number }[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = cx + (c - (cols - 1) / 2) * stepX;
      const y = cy + (r - (rows - 1) / 2) * stepY;
      const dx = (x - cx) / rxClip;
      const dy = (y - cy) / ryClip;
      if (dx * dx + dy * dy <= 0.95) {
        dots.push({ x, y });
      }
    }
  }
  return (
    <G>
      {dots.map((d, i) => (
        <Circle key={i} cx={d.x} cy={d.y} r={dotR} fill={color} />
      ))}
    </G>
  );
}
