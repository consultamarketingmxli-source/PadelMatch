/**
 * PadelBallShape — Forma CANÓNICA de pelota de pádel para toda la app.
 *
 * SINGLE SOURCE OF TRUTH: ningún otro componente debe redibujar la pelota.
 * La FORMA es inmutable; solo el COLOR puede cambiar por contexto
 * (Volt en loader, Azul en brand, etc.).
 *
 * Referencia visual: Pelota Padel.jpg (esfera + dos costuras blancas curvas
 * que se cruzan formando el patrón clásico de pelota de pádel/tenis).
 *
 * Geometría (viewBox 64×64):
 *   • Cuerpo: <Circle cx=32 cy=32 r=29>
 *   • Costura superior: bell-curve arqueando HACIA ARRIBA (M6,28 Q32,14 58,28)
 *   • Costura inferior: bell-curve arqueando HACIA ABAJO (M6,36 Q32,50 58,36)
 *   • Ambas costuras terminan exactamente sobre el borde de la esfera.
 */
import React from "react";
import Svg, {
  Circle,
  Defs,
  LinearGradient,
  Path,
  RadialGradient,
  Stop,
} from "react-native-svg";

export type PadelBallShapeProps = {
  /** Diámetro en px (default 64). */
  size?: number;
  /** Color principal del cuerpo (default Volt #ccff00). */
  color?: string;
  /** Color final del gradiente (esquina inferior-derecha). Si se omite
   *  y `gradient` es true, se usa un negro al 30% sobre `color`. */
  gradientTo?: string;
  /** true = aplica gradiente lineal `color → gradientTo` para volumen 3D.
   *  false = fill plano (default false = flat). */
  gradient?: boolean;
  /** true = añade highlight radial blanco superior-izquierdo (volumen extra). */
  highlight?: boolean;
  /** Color de las costuras (default blanco). */
  seamColor?: string;
  /** Grosor de costura como fracción del diámetro (default 0.0375 → 2.4 a size 64). */
  seamWidthRatio?: number;
  /** Opacidad de las costuras (default 0.95). */
  seamOpacity?: number;
};

// Path data invariante — re-utilizable en cualquier color.
const SEAM_TOP_PATH = "M 6 28 Q 32 14 58 28";
const SEAM_BOTTOM_PATH = "M 6 36 Q 32 50 58 36";

// IDs únicos por instancia para evitar colisiones cuando hay varias pelotas
// en la misma página (cada <Defs> debe tener IDs únicos en SVG).
let _uid = 0;
function useUid(prefix: string) {
  const ref = React.useRef<string>("");
  if (!ref.current) {
    _uid += 1;
    ref.current = `${prefix}_${_uid}`;
  }
  return ref.current;
}

export function PadelBallShape({
  size = 64,
  color = "#ccff00",
  gradientTo,
  gradient = false,
  highlight = false,
  seamColor = "#FFFFFF",
  seamWidthRatio = 0.0375,
  seamOpacity = 0.95,
}: PadelBallShapeProps) {
  const gradId = useUid("padelBallGrad");
  const hiId = useUid("padelBallHi");
  const strokeWidth = size * seamWidthRatio;

  // Si no hay gradient, fill plano. Si hay, gradient lineal diagonal.
  const fill = gradient ? `url(#${gradId})` : color;
  const fallbackDark = gradientTo ?? darken(color, 0.35);

  return (
    <Svg width={size} height={size} viewBox="0 0 64 64" fill="none">
      {(gradient || highlight) && (
        <Defs>
          {gradient && (
            <LinearGradient id={gradId} x1="14%" y1="14%" x2="86%" y2="86%">
              <Stop offset="0%" stopColor={color} />
              <Stop offset="100%" stopColor={fallbackDark} />
            </LinearGradient>
          )}
          {highlight && (
            <RadialGradient
              id={hiId}
              cx="32%"
              cy="28%"
              rx="38%"
              ry="38%"
              fx="32%"
              fy="28%"
            >
              <Stop offset="0%" stopColor="#FFFFFF" stopOpacity={0.45} />
              <Stop offset="60%" stopColor="#FFFFFF" stopOpacity={0.08} />
              <Stop offset="100%" stopColor="#FFFFFF" stopOpacity={0} />
            </RadialGradient>
          )}
        </Defs>
      )}

      {/* Cuerpo */}
      <Circle cx={32} cy={32} r={29} fill={fill} />
      {/* Highlight 3D opcional (encima del cuerpo, debajo de costuras) */}
      {highlight && <Circle cx={32} cy={32} r={29} fill={`url(#${hiId})`} />}

      {/* Costuras blancas — patrón canónico (idéntico en todos los contextos). */}
      <Path
        d={SEAM_TOP_PATH}
        stroke={seamColor}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        fill="none"
        opacity={seamOpacity}
      />
      <Path
        d={SEAM_BOTTOM_PATH}
        stroke={seamColor}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        fill="none"
        opacity={seamOpacity}
      />
    </Svg>
  );
}

/**
 * Mezcla `color` con negro proporcionalmente.
 * darken("#ccff00", 0.35) → un color más oscuro útil como gradiente final.
 */
function darken(hex: string, amount: number): string {
  const clean = hex.replace("#", "");
  if (clean.length !== 6) return hex;
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  const k = 1 - Math.max(0, Math.min(1, amount));
  const dr = Math.round(r * k);
  const dg = Math.round(g * k);
  const db = Math.round(b * k);
  const toHex = (n: number) => n.toString(16).padStart(2, "0");
  return `#${toHex(dr)}${toHex(dg)}${toHex(db)}`;
}
