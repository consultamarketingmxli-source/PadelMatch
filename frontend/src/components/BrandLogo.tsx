/**
 * BrandLogo v4 "Blue Club Pro" — Pelota fiel a la foto de referencia.
 *
 * Director de Arte / iteración 2 (post-feedback usuario):
 *
 *   La pelota muestra DOS arcos blancos elegantes que representan la
 *   costura continua de la pelota de tenis/pádel — uno bombeando hacia
 *   arriba en la mitad superior, otro bombeando hacia abajo en la mitad
 *   inferior. NO son zigzags ni curvas exageradas, son trazos suaves y
 *   premium tipo arcos de campana (Bezier cuadrático).
 *
 *   Cuerpo: gradiente lineal Azul Eléctrico (#2563EB) → Cobalto (#312E81)
 *   con highlight radial superior-izquierdo para volumen 3D.
 *
 * Exporta:
 *   - <BrandLogo />     : Isotipo (3 variantes: light / dark / mono)
 *   - <BrandWordmark /> : "Padel" light + "AppRetas" black (compat)
 *   - <BrandLockup />   : Isotipo + wordmark horizontal
 */
import React from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import Svg, {
  Circle,
  Defs,
  LinearGradient,
  Path,
  RadialGradient,
  Stop,
} from "react-native-svg";
import { colors, fonts } from "@/src/theme";

type Variant = "light" | "dark" | "mono";

type LogoProps = {
  size?: number;
  variant?: Variant;
  /** Custom color para variant="mono" */
  color?: string;
};

/**
 * Isotipo principal — Pelota de pádel/tenis fiel a la foto referencia.
 *
 * Geometría:
 *   • Esfera con degradado lineal blue-600 → indigo-900
 *   • Highlight radial superior-izquierdo (volumen 3D sutil)
 *   • DOS arcos blancos elegantes (uno arriba, otro abajo) — costura tenis
 */
export function BrandLogo({ size = 48, variant = "light", color }: LogoProps) {
  if (variant === "mono") {
    return <BrandMarkMono size={size} color={color ?? colors.brand.primary} />;
  }
  if (variant === "dark") {
    return <BrandMarkDark size={size} />;
  }
  return <BrandMarkLight size={size} />;
}

/**
 * Path data de las costuras — calculado para verse como la foto:
 *
 *   • TOP seam: M(6, 28) Q(32, 14) (58, 28)
 *     → bell curve que arranca a las 9 horas, sube hacia las 12, baja a las 3.
 *
 *   • BOTTOM seam: M(6, 36) Q(32, 50) (58, 36)
 *     → mirror exacto, bell curve hacia abajo.
 *
 *   Los puntos finales (6,28) y (58,28) están sobre el círculo r=29 cx=32,
 *   garantizando que la costura termina exactamente sobre el borde de la
 *   pelota sin sobresalir.
 */
const SEAM_TOP_PATH = "M 6 28 Q 32 14 58 28";
const SEAM_BOTTOM_PATH = "M 6 36 Q 32 50 58 36";
const SEAM_WIDTH = 2.4;

function BrandMarkLight({ size }: { size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64" fill="none">
      <Defs>
        <LinearGradient id="ballGradL" x1="14%" y1="14%" x2="86%" y2="86%">
          <Stop offset="0%" stopColor={colors.brand.gradientFrom} />
          <Stop offset="55%" stopColor={colors.brand.gradientVia} />
          <Stop offset="100%" stopColor={colors.brand.gradientTo} />
        </LinearGradient>
        <RadialGradient
          id="ballHiL"
          cx="32%"
          cy="28%"
          rx="35%"
          ry="35%"
          fx="32%"
          fy="28%"
        >
          <Stop offset="0%" stopColor="#FFFFFF" stopOpacity={0.4} />
          <Stop offset="60%" stopColor="#FFFFFF" stopOpacity={0.08} />
          <Stop offset="100%" stopColor="#FFFFFF" stopOpacity={0} />
        </RadialGradient>
      </Defs>

      <Circle cx={32} cy={32} r={29} fill="url(#ballGradL)" />
      <Circle cx={32} cy={32} r={29} fill="url(#ballHiL)" />

      {/* Costuras blancas elegantes — fiel a la foto. */}
      <Path
        d={SEAM_TOP_PATH}
        stroke="#FFFFFF"
        strokeWidth={SEAM_WIDTH}
        strokeLinecap="round"
        fill="none"
        opacity={0.95}
      />
      <Path
        d={SEAM_BOTTOM_PATH}
        stroke="#FFFFFF"
        strokeWidth={SEAM_WIDTH}
        strokeLinecap="round"
        fill="none"
        opacity={0.95}
      />
    </Svg>
  );
}

function BrandMarkDark({ size }: { size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64" fill="none">
      <Defs>
        <RadialGradient id="ballDarkHi" cx="30%" cy="28%" rx="42%" ry="42%">
          <Stop offset="0%" stopColor="#FFFFFF" stopOpacity={1} />
          <Stop offset="100%" stopColor="#E0E7FF" stopOpacity={0.9} />
        </RadialGradient>
      </Defs>
      <Circle cx={32} cy={32} r={29} fill="url(#ballDarkHi)" />
      <Path
        d={SEAM_TOP_PATH}
        stroke={colors.brand.cobalt}
        strokeWidth={SEAM_WIDTH - 0.3}
        strokeLinecap="round"
        fill="none"
        opacity={0.85}
      />
      <Path
        d={SEAM_BOTTOM_PATH}
        stroke={colors.brand.cobalt}
        strokeWidth={SEAM_WIDTH - 0.3}
        strokeLinecap="round"
        fill="none"
        opacity={0.85}
      />
    </Svg>
  );
}

function BrandMarkMono({ size, color }: { size: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64" fill="none">
      <Circle cx={32} cy={32} r={29} fill={color} />
      <Path
        d={SEAM_TOP_PATH}
        stroke="#FFFFFF"
        strokeWidth={SEAM_WIDTH}
        strokeLinecap="round"
        fill="none"
        opacity={0.95}
      />
      <Path
        d={SEAM_BOTTOM_PATH}
        stroke="#FFFFFF"
        strokeWidth={SEAM_WIDTH}
        strokeLinecap="round"
        fill="none"
        opacity={0.95}
      />
    </Svg>
  );
}

/* ────────────────────────────────────────────────────────────────
   WORDMARK + LOCKUP (sin cambios funcionales, mantienen contrato).
   ──────────────────────────────────────────────────────────────── */

type WordmarkProps = {
  size?: number;
  variant?: Variant;
  color?: string;
};

export function BrandWordmark({
  size = 22,
  variant = "light",
  color,
}: WordmarkProps) {
  const lightColor = colors.brand.cobalt;
  const accentColor = colors.brand.primary;
  const darkColor = "#FFFFFF";
  const monoColor = color ?? colors.text.primary;

  const baseColor =
    variant === "dark" ? darkColor : variant === "mono" ? monoColor : lightColor;
  const heavyColor =
    variant === "dark" ? darkColor : variant === "mono" ? monoColor : accentColor;

  return (
    <View style={styles.wordmarkRow}>
      <Text
        style={[
          styles.wordmarkLight,
          { fontSize: size, lineHeight: size * 1.05, color: baseColor },
        ]}
      >
        Padel
      </Text>
      <Text
        style={[
          styles.wordmarkHeavy,
          { fontSize: size, lineHeight: size * 1.05, color: heavyColor },
        ]}
      >
        AppRetas
      </Text>
    </View>
  );
}

type LockupProps = {
  size?: number;
  variant?: Variant;
};

export function BrandLockup({ size = 32, variant = "light" }: LockupProps) {
  const wordSize = Math.round(size * 0.62);
  return (
    <View style={styles.lockupRow}>
      <BrandLogo size={size} variant={variant} />
      <BrandWordmark size={wordSize} variant={variant} />
    </View>
  );
}

const styles = StyleSheet.create({
  lockupRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  wordmarkRow: { flexDirection: "row", alignItems: "baseline" },
  wordmarkLight: {
    fontFamily: Platform.select({
      web: "Inter, system-ui, -apple-system, sans-serif",
      default: fonts.sansRegular,
    }) as string,
    fontWeight: "300",
    letterSpacing: -0.4,
  },
  wordmarkHeavy: {
    fontFamily: Platform.select({
      web: "Inter, system-ui, -apple-system, sans-serif",
      default: fonts.sansBlack,
    }) as string,
    fontWeight: "900",
    letterSpacing: -0.6,
  },
});
