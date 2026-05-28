/**
 * PadelPalaIcon — Isotipo vectorial profesional de pala de pádel.
 *
 * Reingeniería de fidelidad geométrica (Director de Arte v5 — Bullpadel Vertex):
 *
 *   1. CABEZA DIAMANTE REAL — Modelo Bullpadel Vertex 04:
 *      • Top suave en (32, 4) — punto agudo redondeado.
 *      • Hombros caídos amplios — curvas Bézier C1/C2 muy bajas (y=8-12).
 *      • Cintura BAJA: ancho máximo cerca de y=26 (no en el medio).
 *      • Caída en V pronunciada hacia la base con concavidad lateral.
 *
 *   2. PUENTE M-INVERTIDA SÓLIDA — Exoesqueleto real:
 *      • Trapecio sólido invertido con dos huecos triangulares calados
 *        que simulan el sistema dual de brazos del Bullpadel.
 *      • Conecta base de cabeza con grip mediante 3 puntos de contacto.
 *
 *   3. PERFORACIONES GRID — Cuadrícula rectangular real:
 *      • 6 filas horizontales × 5-7 columnas (densidad uniforme).
 *      • Sólo en el área core de la cara (no en los bordes ni en el
 *        área del bridge).
 *
 *   4. GRIP — Cilindro envuelto + cap profesional.
 *
 *   5. ESTILO — Líneas finas `stroke-2` slate-900, auto-escala 16-256px.
 */
import React from "react";
import Svg, { Circle, G, Path, Polygon, Rect } from "react-native-svg";

type Props = {
  size?: number;
  color?: string;
  strokeWidth?: number;
  /** Si true, rellena la cabeza con color (versión activa). */
  filled?: boolean;
};

const DEFAULT_COLOR = "#0F172A"; // slate-900

export function PadelPalaIcon({
  size = 24,
  color = DEFAULT_COLOR,
  strokeWidth,
  filled = false,
}: Props) {
  const sw = strokeWidth ?? (size <= 24 ? 2 : size <= 48 ? 1.8 : 1.6);
  const stroke = color;
  const fillHead = filled ? color : "none";
  const accent = filled ? "#FFFFFF" : color;

  return (
    <Svg width={size} height={size} viewBox="0 0 64 64" fill="none">
      {/* =========================================================
          CABEZA DIAMANTE (Bullpadel Vertex 04 silhouette)

          Anclas geométricas:
            • (32, 4)  — vértice superior suave
            • (12, 14) — hombro izquierdo BAJO (caída amplia)
            • (8, 26)  — cintura baja izquierda (ancho máximo)
            • (16, 40) — quiebre antes de la base
            • (26, 47) — base izquierda del bridge
            • simétrico al lado derecho
          ========================================================= */}
      <Path
        d="
          M 32 3
          C 41 3  49 7  54 13
          C 57 18  57 24  55 31
          C 53 37  49 42  45 45
          L 37 47
          L 27 47
          L 19 45
          C 15 42  11 37  9 31
          C 7 24  7 18  10 13
          C 15 7  23 3  32 3 Z"
        fill={fillHead}
        stroke={stroke}
        strokeWidth={sw}
        strokeLinejoin="round"
        strokeLinecap="round"
      />

      {/* =========================================================
          PERFORACIONES GRID — Cuadrícula uniforme 6x6 en la cara.
          Coords del centro: (32, 26). Step: 5 unidades. Solo dentro
          del area core (radio efectivo ≈ 14).
          ========================================================= */}
      <DrillingGrid color={accent} filled={filled} />

      {/* =========================================================
          PUENTE M-INVERTIDA SÓLIDA — Exoesqueleto Bullpadel.

          Trapecio sólido invertido con DOS huecos triangulares
          calados que generan la M invertida visible.
          Conecta cabeza (y=47) con cuello del grip (y=55).
          ========================================================= */}
      {/* Base sólida del bridge */}
      <Polygon
        points="26,47 38,47 36,55 28,55"
        fill={stroke}
      />
      {/* Hueco triangular izquierdo (calado) */}
      <Polygon
        points="28,48 31,48 30,53"
        fill={filled ? color : "#FFFFFF"}
      />
      {/* Hueco triangular derecho (calado) */}
      <Polygon
        points="33,48 36,48 34,53"
        fill={filled ? color : "#FFFFFF"}
      />

      {/* =========================================================
          GRIP — Cilindro recto + cap superior.
          ========================================================= */}
      {/* Tornillo superior (cap negro del bullpadel) */}
      <Rect x={28} y={54.5} width={8} height={1.6} rx={0.4} fill={stroke} />
      {/* Cilindro principal del grip */}
      <Rect x={29} y={56} width={6} height={5} rx={1.2} fill={stroke} />
      {/* Cap final del grip (más ancho) */}
      <Rect x={27.5} y={60.5} width={9} height={2.2} rx={1.1} fill={stroke} />
    </Svg>
  );
}

/**
 * Grid rectangular de perforaciones — patrón uniforme tipo Bullpadel.
 * 6 filas × 7 columnas centradas en (32, 26), solo agujeros que caen
 * dentro del area útil de la cara (radio ≈ 14 desde el centro).
 */
function DrillingGrid({
  color,
  filled = false,
}: {
  color: string;
  filled?: boolean;
}) {
  const cx = 32;
  const cy = 26;
  const step = 4.2;
  const cols = 7;
  const rows = 6;
  const holeR = 0.85;
  const op = filled ? 0.95 : 0.55;

  const holes: { x: number; y: number }[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = cx + (c - (cols - 1) / 2) * step;
      const y = cy + (r - (rows - 1) / 2) * step;
      // Sólo agujeros dentro del area útil (radio elíptico)
      const dx = (x - cx) / 13;
      const dy = (y - cy) / 16;
      if (dx * dx + dy * dy <= 1) {
        holes.push({ x, y });
      }
    }
  }

  return (
    <G>
      {holes.map((h, i) => (
        <Circle key={i} cx={h.x} cy={h.y} r={holeR} fill={color} opacity={op} />
      ))}
    </G>
  );
}
