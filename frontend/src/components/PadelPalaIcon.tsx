/**
 * PadelPalaIcon — Isotipo vectorial profesional de pala de pádel.
 *
 * Reingeniería de fidelidad geométrica (Director de Arte v4):
 *
 *   1. CABEZA — Silueta DIAMANTE/LÁGRIMA con hombros caídos y cintura
 *      marcada. NO es un círculo: top puntiagudo, anchos máximos en
 *      el ecuador (~y=24), cierre en V hacia la base.
 *
 *   2. PUENTE Y-INVERTIDA (Dual Exoskeleton) — Dos brazos curvos que
 *      SALEN POR DEBAJO de la cabeza (visualmente separados de ella),
 *      con un espacio vacío central claramente visible. Forman una
 *      "Y" invertida que conecta la base de la cabeza con el cuello del
 *      grip.
 *
 *   3. PERFORACIONES — Cuadrícula concéntrica fina exclusivamente en
 *      el sweet spot. Márgenes limpios.
 *
 *   4. GRIP — Cilindro recto + cap redondeado, alineado al centro del
 *      bridge.
 *
 *   5. ESTILO — Líneas finas alto contraste (`stroke-2` auto-escala).
 *      Soporta versión `filled` para CTA activos.
 */
import React from "react";
import Svg, { Circle, G, Path, Rect } from "react-native-svg";

type Props = {
  size?: number;
  color?: string;
  strokeWidth?: number;
  /** Si true, rellena la cabeza con el color (versión activa). */
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
  // Cuando está filled, los agujeros y bridge se dibujan en blanco
  // para destacar sobre el color sólido.
  const accent = filled ? "#FFFFFF" : color;

  return (
    <Svg width={size} height={size} viewBox="0 0 64 64" fill="none">
      {/* =========================================================
          CABEZA — Diamante / Lágrima aerodinámica.
          • Top puntiagudo en (32, 3) con curva amplia hacia los hombros.
          • Hombros caídos en y=14.
          • Ancho máximo (cintura alta) en y=22.
          • Cierre en V hacia (32, 44) con concavidad lateral.
          ========================================================= */}
      <Path
        d="
          M 32 4
          C 40 4  47 9  50 16
          C 52 22  52 30  49 36
          L 42 43
          L 38 45
          L 26 45
          L 22 43
          L 15 36
          C 12 30  12 22  14 16
          C 17 9  24 4  32 4 Z"
        fill={fillHead}
        stroke={stroke}
        strokeWidth={sw}
        strokeLinejoin="round"
        strokeLinecap="round"
      />

      {/* =========================================================
          PUENTE Y-INVERTIDA (Dual Exoskeleton)
          Dos brazos curvos calados que conectan la cabeza con el grip,
          con un espacio central vacío visible (la Y invertida).
          Salen claramente POR DEBAJO de la cabeza para no solaparse.
          ========================================================= */}
      {/* Brazo izquierdo (arco hacia adentro) */}
      <Path
        d="
          M 26 45
          C 26.5 49  27.5 52  29.5 54.5
          L 30 56"
        fill="none"
        stroke={accent}
        strokeWidth={sw}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Brazo derecho (arco hacia adentro) */}
      <Path
        d="
          M 38 45
          C 37.5 49  36.5 52  34.5 54.5
          L 34 56"
        fill="none"
        stroke={accent}
        strokeWidth={sw}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Pequeño detalle: línea inferior cerrando el ojo de la Y */}
      <Path
        d="M 30 56 L 34 56"
        stroke={accent}
        strokeWidth={Math.max(0.8, sw * 0.55)}
        strokeLinecap="round"
        opacity={0.6}
      />

      {/* =========================================================
          PERFORACIONES — sweet spot centrado en (32, 24).
          ========================================================= */}
      <DrillingPattern color={accent} cx={32} cy={24} filled={filled} />

      {/* =========================================================
          GRIP — Cilindro recto + cap redondeado.
          ========================================================= */}
      <Rect
        x={28.5}
        y={55}
        width={7}
        height={5.5}
        rx={1.3}
        fill={stroke}
      />
      <Rect
        x={27}
        y={59.5}
        width={10}
        height={2.5}
        rx={1.25}
        fill={stroke}
      />
    </Svg>
  );
}

/**
 * Patrón de perforaciones — 4 anillos concéntricos en el sweet spot.
 * Centro + 6 + 10 + 12 = 29 agujeros, todos dentro del core (radio máx 11)
 * para mantener márgenes limpios como exige el spec.
 */
function DrillingPattern({
  color,
  cx,
  cy,
  filled = false,
}: {
  color: string;
  cx: number;
  cy: number;
  filled?: boolean;
}) {
  const holeR = 0.95;
  const opCentro = filled ? 1 : 0.75;
  const opAnillo = filled ? 0.95 : 0.5;

  const ring0 = [{ x: 0, y: 0 }];
  const ring1 = [...Array(6)].map((_, i) => {
    const ang = (i / 6) * Math.PI * 2;
    return { x: Math.cos(ang) * 4, y: Math.sin(ang) * 4 };
  });
  const ring2 = [...Array(10)].map((_, i) => {
    const ang = (i / 10) * Math.PI * 2 + Math.PI / 10;
    return { x: Math.cos(ang) * 7.5, y: Math.sin(ang) * 7.5 };
  });
  const ring3 = [...Array(12)].map((_, i) => {
    const ang = (i / 12) * Math.PI * 2;
    return { x: Math.cos(ang) * 11, y: Math.sin(ang) * 11 };
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
      {render(ring0, opCentro)}
      {render(ring1, opCentro * 0.9)}
      {render(ring2, opAnillo)}
      {render(ring3, opAnillo * 0.8)}
    </G>
  );
}
