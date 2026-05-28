/**
 * PadelPalaIcon — Isotipo vectorial profesional de pala de pádel.
 *
 * Director de Arte v7 — Reconstrucción fiel al 100% del contorno
 * Bullpadel Vertex 04 (referencia provista por usuario).
 *
 *   ViewBox 40×64 — Aspect ratio real medido = 0.625 (ancho/alto)
 *
 *   Anclas geométricas (medidas en píxeles del viewBox 40×64):
 *
 *     TIP TOP            (20.0,  0.0)   — ratio (0.50, 0.00)
 *     UPPER SHOULDER L   ( 9.2,  9.6)   — ratio (0.23, 0.15)
 *     UPPER SHOULDER R   (30.8,  9.6)
 *     WIDEST POINT L     ( 2.8, 22.4)   — ratio (0.07, 0.35) · MAX width
 *     WIDEST POINT R     (37.2, 22.4)
 *     LOWER TAPER L      (10.0, 35.2)   — ratio (0.25, 0.55)
 *     LOWER TAPER R      (30.0, 35.2)
 *     BRIDGE TOP L       (14.0, 43.5)   — ratio (0.35, 0.68)
 *     BRIDGE TOP R       (26.0, 43.5)
 *     BRIDGE BOTTOM L    (16.0, 49.9)   — ratio (0.40, 0.78)
 *     BRIDGE BOTTOM R    (24.0, 49.9)
 *     GRIP CAP           (20.0, 63.4)   — ratio (0.50, 0.99)
 *
 *   Proporciones verificadas:
 *     • Head:   ~68% (y=0 → y=43.5)
 *     • Bridge: ~10% (y=43.5 → y=50)
 *     • Grip:   ~22% (y=50 → y=64)
 *
 *   Sin contenido interno (cero texto, cero marcas comerciales).
 *   Sólo silueta + grid uniforme de perforaciones + bridge calado.
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
  // Ratio real 40:64 = 0.625 — mantiene la aspecto exacto
  const w = (size * 40) / 64;
  const h = size;
  const sw = strokeWidth ?? (size <= 24 ? 1.8 : size <= 48 ? 1.6 : 1.4);
  const stroke = color;
  const fillHead = filled ? color : "none";
  const accent = filled ? "#FFFFFF" : color;
  const cutoutFill = filled ? color : "#FFFFFF";

  return (
    <Svg width={w} height={h} viewBox="0 0 40 64" fill="none">
      {/* =========================================================
          CABEZA — Contorno Bullpadel Vertex 04 (silhouette 1:1).

          Recorrido (anti-horario desde el tip):
            1. Tip (20,0) → curva tip-rounded → Upper-Shoulder-L (9.2, 9.6)
            2. Upper-Shoulder-L → Widest-L (2.8, 22.4)   (flare out)
            3. Widest-L → Lower-Taper-L (10, 35.2)        (taper in)
            4. Lower-Taper-L → Bridge-Top-L (14, 43.5)    (taper in)
            5. Bridge-Top-L → Bridge-Top-R (26, 43.5)     (línea recta)
            6. Espejo simétrico en lado derecho hasta cerrar en Tip.
          ========================================================= */}
      <Path
        d="
          M 20 0
          C 15.5 0  11.8 3.2  9.2 9.6
          C 6.4 13.8  3.6 17.6  2.8 22.4
          C 3.6 27.8  6.0 31.8  10 35.2
          C 11.6 38.5  13.0 41.0  14 43.5
          L 26 43.5
          C 27.0 41.0  28.4 38.5  30 35.2
          C 34.0 31.8  36.4 27.8  37.2 22.4
          C 36.4 17.6  33.6 13.8  30.8 9.6
          C 28.2 3.2  24.5 0  20 0 Z"
        fill={fillHead}
        stroke={stroke}
        strokeWidth={sw}
        strokeLinejoin="round"
        strokeLinecap="round"
      />

      {/* =========================================================
          PERFORACIONES GRID — Rectangular uniforme.
          Centrado en (20, 22). 7 cols × 8 filas, step 3.6.
          Solo dentro del area útil de la cara (sin invasión al
          contorno ni al área del bridge).
          ========================================================= */}
      <DrillingGrid color={accent} filled={filled} />

      {/* =========================================================
          PUENTE M-INVERTIDA — Trapecio sólido + 2 huecos triangulares.
          Bridge top (y=43.5) → Bridge bottom (y=50).
          ========================================================= */}
      <Polygon
        points="14,43.5 26,43.5 24,50 16,50"
        fill={stroke}
      />
      {/* Hueco triangular izquierdo */}
      <Polygon
        points="16.5,44.5 19.5,44.5 18,49"
        fill={cutoutFill}
      />
      {/* Hueco triangular derecho */}
      <Polygon
        points="20.5,44.5 23.5,44.5 22,49"
        fill={cutoutFill}
      />

      {/* =========================================================
          GRIP — Cap superior · cilindro · cap inferior expandido.
          ========================================================= */}
      {/* Cap superior delgado (conector bridge → grip) */}
      <Rect x={15.5} y={49.8} width={9} height={1.6} rx={0.5} fill={stroke} />
      {/* Cilindro principal */}
      <Rect x={16.8} y={51.4} width={6.4} height={10} rx={1.4} fill={stroke} />
      {/* Cap inferior expandido (knob) */}
      <Rect x={14.8} y={61.2} width={10.4} height={2.4} rx={1.2} fill={stroke} />
    </Svg>
  );
}

/**
 * Grid rectangular de perforaciones — uniforme y limpio.
 * Centrado en (20, 22), step 3.6, máx 7 cols × 8 filas.
 * Filtra agujeros que caigan fuera de la silueta diamante.
 */
function DrillingGrid({
  color,
  filled = false,
}: {
  color: string;
  filled?: boolean;
}) {
  const cx = 20;
  const cy = 22;
  const step = 3.6;
  const cols = 7;
  const rows = 9;
  const holeR = 0.7;
  const op = filled ? 0.95 : 0.5;

  const holes: { x: number; y: number }[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = cx + (c - (cols - 1) / 2) * step;
      const y = cy + (r - (rows - 1) / 2) * step;
      // Solo agujeros dentro del area útil (elipse interior de la cara)
      const dx = (x - cx) / 14.5;
      const dy = (y - cy) / 18;
      if (dx * dx + dy * dy <= 0.92) {
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
