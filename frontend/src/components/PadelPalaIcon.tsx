/**
 * PadelPalaIcon v2 "Blue Club Pro Flat" — Rediseño según referencia del usuario.
 *
 * Director de Arte / iteración 2:
 *   Estilo flat-illustration moderno (similar a icono Material/Apple).
 *   Sustituye la versión anterior de líneas finas Bullpadel-style.
 *
 * Anatomía (fiel a image_padel_reference.png):
 *   • Cabeza: silueta de gota/teardrop con cuello ligeramente cinturado.
 *   • Sombra lateral izquierda: gradiente sutil para volumen 3D plano.
 *   • Huecos: grid 4×4 honeycomb de círculos blancos calados.
 *   • Cuello V: muesca triangular blanca calada entre los dos brazos.
 *   • Grip: cilindro rectangular azul-accent con cap superior + cap inferior.
 *   • Cordón de muñeca: trazo curvo cobalto que sale lateralmente.
 *
 * Paleta (Blue Club Pro):
 *   • Cuerpo: gradiente blue-600 (#2563EB) → indigo-700 (#4338CA)
 *   • Sombra lado izquierdo: indigo-900 (#312E81) al 25%
 *   • Grip y detalles: blue-500 (#3B82F6) (accent)
 *   • Cordón: indigo-950 (#1E1B4B) o slate-900
 *   • Huecos / cuello-V: blanco puro
 *
 * Contrato (mantiene compatibilidad con la versión anterior):
 *   - size?: number
 *   - color?: string         (override del color principal para uso mono)
 *   - filled?: boolean       (true = ilustración fill; false = outline mono)
 *   - strokeWidth?: number   (ignorado en variante filled — sin uso)
 */
import React from "react";
import Svg, {
  Circle,
  Defs,
  LinearGradient,
  Path,
  Polygon,
  Stop,
  Rect,
  G,
} from "react-native-svg";

type Props = {
  size?: number;
  color?: string;
  strokeWidth?: number;
  /** true: ilustración flat con gradiente blue (default).
   *  false: silueta mono outline (compat con calls antiguos que pasaban filled=false).
   */
  filled?: boolean;
};

// Paleta blue club pro embebida (evita import circular con theme).
const BLUE_600 = "#2563EB";
const BLUE_700 = "#1D4ED8";
const INDIGO_700 = "#4338CA";
const INDIGO_900 = "#312E81";
const INDIGO_950 = "#1E1B4B";
const BLUE_500 = "#3B82F6";
const SLATE_900 = "#0F172A";

/**
 * ViewBox 80×100 — proporción 4:5 que captura cabeza + grip + cordón.
 *
 * Anclas (todos los valores en px del viewBox):
 *   TOP TIP            (40,  4)
 *   LEFT WIDEST        ( 6, 48)
 *   RIGHT WIDEST       (74, 48)
 *   BRIDGE NECK L      (32, 72)
 *   BRIDGE NECK R      (48, 72)
 *   V-CUT APEX UP      (40, 56)
 *   GRIP TOP           (36, 73)
 *   GRIP BOTTOM        (44, 93)
 *   CORD START         (44, 90)
 *   CORD LOOP END      (52, 98)
 */
export function PadelPalaIcon({
  size = 24,
  color,
  filled = true,
}: Props) {
  // Aspect ratio 4:5 — mantén proporción real.
  const w = (size * 4) / 5;
  const h = size;

  if (!filled) {
    return <PalaMono size={size} color={color ?? SLATE_900} />;
  }

  return (
    <Svg width={w} height={h} viewBox="0 0 80 100" fill="none">
      <Defs>
        {/* Gradiente principal de la cabeza */}
        <LinearGradient id="palaHead" x1="0%" y1="0%" x2="100%" y2="100%">
          <Stop offset="0%" stopColor={BLUE_600} />
          <Stop offset="100%" stopColor={INDIGO_700} />
        </LinearGradient>
        {/* Sombra lateral izquierda (overlay sutil) */}
        <LinearGradient id="palaShadow" x1="0%" y1="0%" x2="100%" y2="0%">
          <Stop offset="0%" stopColor={INDIGO_900} stopOpacity={0.35} />
          <Stop offset="55%" stopColor={INDIGO_900} stopOpacity={0} />
        </LinearGradient>
      </Defs>

      {/* ─────────────────────────────────────────────────────────
          CABEZA — Teardrop fiel a la referencia.
          ───────────────────────────────────────────────────────── */}
      <Path
        d="
          M 40 4
          C 26 4, 14 16, 8 32
          C 5 42, 5 50, 8 56
          C 11 64, 20 71, 32 72
          L 48 72
          C 60 71, 69 64, 72 56
          C 75 50, 75 42, 72 32
          C 66 16, 54 4, 40 4 Z"
        fill="url(#palaHead)"
      />
      {/* Sombra lateral izquierda — encima del cuerpo, recortada por el path. */}
      <Path
        d="
          M 40 4
          C 26 4, 14 16, 8 32
          C 5 42, 5 50, 8 56
          C 11 64, 20 71, 32 72
          L 48 72
          C 60 71, 69 64, 72 56
          C 75 50, 75 42, 72 32
          C 66 16, 54 4, 40 4 Z"
        fill="url(#palaShadow)"
      />

      {/* ─────────────────────────────────────────────────────────
          HUECOS — Grid honeycomb-ish 4×4 (16 dots), centrado.
          ───────────────────────────────────────────────────────── */}
      <DotGrid />

      {/* ─────────────────────────────────────────────────────────
          CUELLO V — Muesca triangular blanca entre brazos.
          Apex apunta HACIA ARRIBA dentro de la cabeza (40, 56),
          base abierta en (33, 72) y (47, 72).
          ───────────────────────────────────────────────────────── */}
      <Polygon points="33,72 47,72 40,56" fill="#FFFFFF" />

      {/* ─────────────────────────────────────────────────────────
          GRIP — Cilindro azul-accent + caps.
          ───────────────────────────────────────────────────────── */}
      {/* Cap superior (conector neck → cilindro) */}
      <Rect x={35} y={72} width={10} height={2.5} rx={1} fill={BLUE_500} />
      {/* Cilindro principal */}
      <Rect x={36} y={74.5} width={8} height={16} rx={1.8} fill={BLUE_500} />
      {/* Cap inferior (knob) */}
      <Rect x={34} y={90.5} width={12} height={3} rx={1.4} fill={BLUE_500} />

      {/* ─────────────────────────────────────────────────────────
          CORDÓN — Loop de muñeca, sale del knob lateral derecho.
          ───────────────────────────────────────────────────────── */}
      <Path
        d="M 45 92 C 56 93, 62 97, 60 100 C 58 97, 52 96, 47 95"
        stroke={INDIGO_950}
        strokeWidth={1.6}
        strokeLinecap="round"
        fill="none"
      />
    </Svg>
  );
}

/**
 * Grid 4×4 de huecos (perforaciones) — ligeramente honeycomb por offset
 * alternado en filas pares. Coordenadas dentro del viewBox 80×100.
 */
function DotGrid() {
  const cx = 40;
  const cy = 36;
  const stepX = 8;
  const stepY = 7;
  const dotR = 2.1;
  const cols = 4;
  const rows = 4;
  const dots: { x: number; y: number }[] = [];
  for (let r = 0; r < rows; r++) {
    // Offset honeycomb: filas impares desplazadas medio paso.
    const xOffset = r % 2 === 0 ? 0 : stepX / 2;
    for (let c = 0; c < cols; c++) {
      const x = cx + (c - (cols - 1) / 2) * stepX + xOffset;
      const y = cy + (r - (rows - 1) / 2) * stepY;
      // Recorta huecos que se salen del area útil de la cabeza
      // (elipse interior aprox.).
      const dx = (x - cx) / 24;
      const dy = (y - cy) / 24;
      if (dx * dx + dy * dy <= 1) {
        dots.push({ x, y });
      }
    }
  }
  return (
    <G>
      {dots.map((d, i) => (
        <Circle key={i} cx={d.x} cy={d.y} r={dotR} fill="#FFFFFF" opacity={0.95} />
      ))}
    </G>
  );
}

/**
 * Variante MONO outline — silueta plana de un solo color.
 * Útil para chips, breadcrumbs y casos donde el fill ilustrativo es exceso visual.
 */
function PalaMono({ size, color }: { size: number; color: string }) {
  const w = (size * 4) / 5;
  const h = size;
  return (
    <Svg width={w} height={h} viewBox="0 0 80 100" fill="none">
      <Path
        d="
          M 40 4
          C 26 4, 14 16, 8 32
          C 5 42, 5 50, 8 56
          C 11 64, 20 71, 32 72
          L 48 72
          C 60 71, 69 64, 72 56
          C 75 50, 75 42, 72 32
          C 66 16, 54 4, 40 4 Z"
        fill={color}
        opacity={0.95}
      />
      <Polygon points="33,72 47,72 40,56" fill="#FFFFFF" />
      <Rect x={35} y={72} width={10} height={2.5} rx={1} fill={color} />
      <Rect x={36} y={74.5} width={8} height={16} rx={1.8} fill={color} />
      <Rect x={34} y={90.5} width={12} height={3} rx={1.4} fill={color} />
      <Path
        d="M 45 92 C 56 93, 62 97, 60 100 C 58 97, 52 96, 47 95"
        stroke={color}
        strokeWidth={1.6}
        strokeLinecap="round"
        fill="none"
      />
      {/* Huecos en mono — círculos blancos del fondo si filled fuera permitido */}
      <DotGrid />
    </Svg>
  );
}
