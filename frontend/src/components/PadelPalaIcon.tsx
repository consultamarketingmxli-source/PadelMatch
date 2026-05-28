/**
 * PadelPalaIcon — Isotipo vectorial profesional de pala de pádel.
 *
 * Director de Arte v6 — Reingeniería geométrica fiel a Bullpadel Vertex 04.
 *
 *   Sistema de proporciones (viewBox 48×64 — ratio 3:4 vertical):
 *
 *     ┌──────────────┐  y=2   ← Vértice superior (tip suave)
 *     │   ▲ HEAD     │
 *     │  ◀ widest ▶  │  y=20  ← Ancho máximo (hombros altos, 30% desde top)
 *     │   ▼          │
 *     │ ╲          ╱ │
 *     ├──╲ BRIDGE ╱──┤  y=44  ← Base de la cabeza (cintura baja)
 *     │   ╲ ▲▲▲ ╱   │
 *     │    ╲___╱     │  y=56  ← Cuello del grip
 *     │     │ │      │
 *     │     │G│      │
 *     │     ╰─╯      │  y=63  ← Cap inferior
 *     └──────────────┘
 *
 *   Proporciones medidas (verificadas contra referencia Bullpadel Vertex 04):
 *     • Head:   42u  ≈ 65%
 *     • Bridge: 12u  ≈ 20%
 *     • Grip:   10u  ≈ 15%
 *
 *   Características:
 *     1. CABEZA DIAMANTE — Hombros altos y amplios, cintura inferior estrecha.
 *     2. PUENTE M-INVERTIDA — Trapecio sólido con dos huecos triangulares.
 *     3. GRID RECTANGULAR — 7×8 perforaciones uniformes (sin texto ni branding).
 *     4. GRIP CILÍNDRICO — Cap superior + cuerpo + cap inferior expandido.
 *     5. SIN MARCAS COMERCIALES — Geometría pura, cero tipografía / logos.
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
  // Ancho proporcional para mantener ratio 3:4 (48×64)
  const w = (size * 48) / 64;
  const h = size;
  const sw = strokeWidth ?? (size <= 24 ? 1.8 : size <= 48 ? 1.6 : 1.4);
  const stroke = color;
  const fillHead = filled ? color : "none";
  const accent = filled ? "#FFFFFF" : color;
  // Color que rellena los "huecos calados" del bridge — debe contrastar con el fill
  const cutoutFill = filled ? color : "#FFFFFF";

  return (
    <Svg width={w} height={h} viewBox="0 0 48 64" fill="none">
      {/* =========================================================
          CABEZA DIAMANTE — Silhouette Bullpadel Vertex 04.

          Anclas geométricas:
            • (24, 2)   — vértice superior (tip suave, ligeramente redondeado)
            • (4, 20)   — hombro izquierdo (ancho MÁX, 30% desde top)
            • (10, 38)  — taper inferior izquierdo
            • (14, 44)  — base izquierda del bridge
            • (34, 44)  — base derecha del bridge (simétrico)
            • (38, 38)  — taper inferior derecho
            • (44, 20)  — hombro derecho (ancho MÁX)
            • Bezier C1/C2 generan hombros redondeados altos.
          ========================================================= */}
      <Path
        d="
          M 24 3
          C 26 3 28 3.6 30 4.6
          L 41 13
          C 43.5 15.5 45 18.5 44 22
          L 38 38
          C 37 40.5 35 42.6 32.5 44
          L 15.5 44
          C 13 42.6 11 40.5 10 38
          L 4 22
          C 3 18.5 4.5 15.5 7 13
          L 18 4.6
          C 20 3.6 22 3 24 3 Z"
        fill={fillHead}
        stroke={stroke}
        strokeWidth={sw}
        strokeLinejoin="round"
        strokeLinecap="round"
      />

      {/* =========================================================
          PERFORACIONES GRID — Cuadrícula rectangular uniforme.
          Centradas en (24, 22). 7 columnas × 8 filas, step 4.2.
          Sólo agujeros dentro del area útil de la cara.
          ========================================================= */}
      <DrillingGrid color={accent} filled={filled} />

      {/* =========================================================
          PUENTE M-INVERTIDA SÓLIDA — Exoesqueleto Bullpadel.

          Trapecio sólido invertido con DOS huecos triangulares
          calados que generan la "M invertida" visible.
          Conecta cabeza (y=44) con cuello del grip (y=56).
          ========================================================= */}
      {/* Base sólida del bridge */}
      <Polygon
        points="14,44 34,44 30,56 18,56"
        fill={stroke}
      />
      {/* Hueco triangular izquierdo (calado) */}
      <Polygon
        points="17,45 22,45 20.5,53.5"
        fill={cutoutFill}
      />
      {/* Hueco triangular derecho (calado) */}
      <Polygon
        points="26,45 31,45 27.5,53.5"
        fill={cutoutFill}
      />

      {/* =========================================================
          GRIP — Cap superior + cilindro + cap inferior expandido.
          ========================================================= */}
      {/* Cap superior (tornillo / pin del bridge al grip) */}
      <Rect x={17} y={55.5} width={14} height={1.6} rx={0.5} fill={stroke} />
      {/* Cilindro principal del grip */}
      <Rect x={19} y={57.2} width={10} height={5} rx={1.4} fill={stroke} />
      {/* Cap inferior (más ancho que el cilindro) */}
      <Rect x={17} y={61.8} width={14} height={2.2} rx={1.1} fill={stroke} />
    </Svg>
  );
}

/**
 * Grid rectangular de perforaciones — patrón uniforme tipo Bullpadel Vertex.
 * 7 columnas × 8 filas centradas en (24, 22), step 4.2.
 * Sólo se renderizan los agujeros que caen dentro de la silueta diamante.
 */
function DrillingGrid({
  color,
  filled = false,
}: {
  color: string;
  filled?: boolean;
}) {
  const cx = 24;
  const cy = 22;
  const step = 4.2;
  const cols = 7;
  const rows = 8;
  const holeR = 0.75;
  const op = filled ? 0.95 : 0.5;

  const holes: { x: number; y: number }[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = cx + (c - (cols - 1) / 2) * step;
      const y = cy + (r - (rows - 1) / 2) * step;
      // Solo agujeros dentro del area útil de la cara (elipse interior)
      const dx = (x - cx) / 17;
      const dy = (y - cy) / 19;
      if (dx * dx + dy * dy <= 0.95) {
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
