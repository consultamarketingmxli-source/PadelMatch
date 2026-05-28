/**
 * PadelPalaIcon — Isotipo vectorial profesional de pala de pádel.
 *
 * Fidelidad estilizada (Flat Design):
 *   • Forma lágrima moderna (LACRIMA): cabeza ancha + cuello que se afina hacia
 *     el puño, igual que palas pro tipo Bullpadel Vertex, Adidas Metalbone.
 *   • Marco con grosor sutil (perfil 38mm sintetizado): doble contorno.
 *   • Puente o "corazón" abierto justo arriba del puño — geometría triangular
 *     invertida (antivibrador / dilatación).
 *   • Patrón de agujeros (drilling pattern) concéntrico: 5 anillos de
 *     perforaciones calados, densidad mayor en el centro óptico (sweet spot).
 *   • Empuñadura con tapón redondeado al final (cap).
 *   • Trazo minimalista limpio — no fotografía, no render.
 *
 * Color por defecto: Slate 900 (#0F172A) — modo claro. Pasa "color" para
 * usarlo blanco sobre botones activos / fondos oscuros.
 *
 * Diseño escala perfectamente entre 16px y 256px gracias a viewBox 64x64.
 */
import React from "react";
import Svg, {
  Circle,
  G,
  Line,
  Path,
  Rect,
} from "react-native-svg";

type Props = {
  size?: number;
  /** Color del trazo principal. Por defecto slate-900. */
  color?: string;
  /** Stroke width override (auto-escala con el tamaño). */
  strokeWidth?: number;
};

const DEFAULT_COLOR = "#0F172A"; // slate-900

export function PadelPalaIcon({
  size = 24,
  color = DEFAULT_COLOR,
  strokeWidth,
}: Props) {
  // El stroke escala al tamaño para mantener proporciones uniformes a 24/48/96.
  const sw = strokeWidth ?? (size <= 28 ? 2 : 1.8);
  const fineSW = sw * 0.6;

  return (
    <Svg width={size} height={size} viewBox="0 0 64 64" fill="none">
      {/* --- MARCO EXTERIOR (perfil 38mm sintetizado: doble contorno) ---
        Forma lágrima/diamante moderno: cabeza ovalada superior + cuello que
        se cierra hacia el puño en una curva continua. */}
      <Path
        d="
          M32 4
          C 44 4  54 12  54 26
          C 54 35  50 42  44 46
          L 38 50
          L 38 56
          L 26 56
          L 26 50
          L 20 46
          C 14 42  10 35  10 26
          C 10 12  20 4  32 4 Z"
        fill="none"
        stroke={color}
        strokeWidth={sw}
        strokeLinejoin="round"
      />
      {/* Contorno interior — sugiere el grosor del marco (perfil 38mm). */}
      <Path
        d="
          M32 8
          C 42 8  50 15  50 26
          C 50 33  47 39  42 43
          L 36 47
          L 36 47.5
          L 28 47.5
          L 28 47
          L 22 43
          C 17 39  14 33  14 26
          C 14 15  22 8  32 8 Z"
        fill="none"
        stroke={color}
        strokeWidth={fineSW}
        opacity={0.55}
        strokeLinejoin="round"
      />

      {/* --- PATRÓN DE AGUJEROS CONCÉNTRICO --- */}
      {/* Sweet spot central (3 anillos densos) */}
      <DrillingPattern color={color} sweetSpot />

      {/* --- PUENTE / CORAZÓN ABIERTO (antivibrador geométrico) ---
        Triángulo invertido justo arriba del puño — un detalle clave de las
        palas pro. Va dentro del cuello, no en la cara. */}
      <Path
        d="
          M27 50.5
          L 32 56
          L 37 50.5 Z"
        fill="none"
        stroke={color}
        strokeWidth={fineSW}
        strokeLinejoin="round"
        opacity={0.85}
      />

      {/* --- EMPUÑADURA (grip) --- */}
      <Rect
        x={28}
        y={56}
        width={8}
        height={5}
        rx={1}
        fill={color}
        opacity={0.95}
      />
      {/* Tapón del puño (cap) */}
      <Rect
        x={26.5}
        y={59.5}
        width={11}
        height={2.5}
        rx={1.25}
        fill={color}
      />
    </Svg>
  );
}

/**
 * Patrón de agujeros calados — discos pequeños distribuidos en anillos
 * concéntricos sobre la cara de la pala. Usamos `fill` con el background del
 * SVG (transparente) y un stroke fino para sugerir agujeros perforados.
 */
function DrillingPattern({
  color,
  sweetSpot = true,
}: {
  color: string;
  sweetSpot?: boolean;
}) {
  // Coordenadas precomputadas relativas al centro (32, 26) — caras pala.
  const cx = 32;
  const cy = 26;
  const holeR = 1.05;
  const opAnillo = 0.45;
  const opCentro = 0.7;

  // Anillo 0 — centro (sweet spot)
  const ring0 = [{ x: 0, y: 0 }];

  // Anillo 1 — 6 agujeros radio 5
  const ring1 = [...Array(6)].map((_, i) => {
    const ang = (i / 6) * Math.PI * 2;
    return { x: Math.cos(ang) * 5, y: Math.sin(ang) * 5 };
  });

  // Anillo 2 — 10 agujeros radio 10
  const ring2 = [...Array(10)].map((_, i) => {
    const ang = (i / 10) * Math.PI * 2;
    return { x: Math.cos(ang) * 10, y: Math.sin(ang) * 10 };
  });

  // Anillo 3 — 12 agujeros radio 14 (sólo los que caen dentro de la cara)
  const ring3 = [...Array(12)].map((_, i) => {
    const ang = (i / 12) * Math.PI * 2 + Math.PI / 12;
    return { x: Math.cos(ang) * 14, y: Math.sin(ang) * 14 };
  });

  const render = (pts: { x: number; y: number }[], op: number) =>
    pts.map((p, i) => (
      <Circle
        key={i}
        cx={cx + p.x}
        cy={cy + p.y}
        r={holeR}
        fill={color}
        opacity={op}
      />
    ));

  return (
    <G>
      {sweetSpot && render(ring0, opCentro)}
      {render(ring1, opCentro)}
      {render(ring2, opAnillo)}
      {render(ring3, opAnillo * 0.85)}
    </G>
  );
}
