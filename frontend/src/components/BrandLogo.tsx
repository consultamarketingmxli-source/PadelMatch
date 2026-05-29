/**
 * BrandLogo — Sistema de marca PadelappRetas v3 "Blue Club Pro"
 *
 * Director de Arte:
 *   "Isotipo: pelota de tenis/pádel minimalista de líneas fluidas, costuras
 *    curvas como trazados vectoriales calados en negativo. Renderizado en
 *    degradado de Azul Eléctrico (#2563EB) a Azul Cobalto Real (#312E81)
 *    sobre fondos claros, o Blanco Puro con destellos sutiles sobre oscuros.
 *
 *    Fusión Tipográfica Elegante: 'Padel' en peso ultra-delgado o regular
 *    (font-light/normal) y 'AppRetas' en peso extra-negrita (font-black/extrabold)."
 *
 * Exporta dos componentes:
 *   - <BrandLogo />       : Solo el isotipo (pelota azul minimalista)
 *   - <BrandWordmark />   : Wordmark "PadelAppRetas" con fusión tipográfica
 *   - <BrandLockup />     : Isotipo + wordmark en composición horizontal
 *
 * Variantes de color:
 *   - `light` (default): degradado azul sobre fondos claros
 *   - `dark`          : blanco puro con destellos para fondos oscuros
 *   - `mono`          : silueta plana en color custom
 */
import React from "react";
import { View, Text, StyleSheet, Platform } from "react-native";
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
 * Isotipo principal — Pelota de pádel/tenis minimalista.
 *
 * Geometría:
 *   • Esfera central (cuerpo) con degradado lineal blue-600 → indigo-900.
 *   • Highlight superior izquierdo (radial blanco) para volumen 3D sutil.
 *   • 2 costuras curvas (Path) calados en negativo blanco con stroke fino.
 *
 * Optimizado para iconos de app (64×64, 128×128) y headers (24-48).
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

/** Versión "light" — degradado azul sobre fondos claros. */
function BrandMarkLight({ size }: { size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64" fill="none">
      <Defs>
        {/* Degradado principal: blue-600 (top-left) → indigo-900 (bottom-right) */}
        <LinearGradient id="ballGrad" x1="14%" y1="14%" x2="86%" y2="86%">
          <Stop offset="0%" stopColor={colors.brand.gradientFrom} />
          <Stop offset="55%" stopColor={colors.brand.gradientVia} />
          <Stop offset="100%" stopColor={colors.brand.gradientTo} />
        </LinearGradient>
        {/* Highlight superior izquierdo — sutilísimo volumen 3D */}
        <RadialGradient
          id="ballHighlight"
          cx="32%"
          cy="28%"
          rx="35%"
          ry="35%"
          fx="32%"
          fy="28%"
        >
          <Stop offset="0%" stopColor="#FFFFFF" stopOpacity={0.35} />
          <Stop offset="60%" stopColor="#FFFFFF" stopOpacity={0.08} />
          <Stop offset="100%" stopColor="#FFFFFF" stopOpacity={0} />
        </RadialGradient>
      </Defs>

      {/* Cuerpo de la pelota — degradado azul */}
      <Circle cx={32} cy={32} r={29} fill="url(#ballGrad)" />
      {/* Highlight 3D */}
      <Circle cx={32} cy={32} r={29} fill="url(#ballHighlight)" />

      {/*
        Costuras (seams) — Trazados curvos calados en negativo blanco.
        Spec: "líneas fluidas y dinámicas de alta gama, líneas curvas
        características de la pelota como trazados vectoriales limpios
        de alto contraste o calados en negativo".

        Curva izquierda: nace en el flanco-izq y termina en el flanco-der
        atravesando la parte superior con forma de "C" invertida.
        Curva derecha: espejo, atraviesa la parte inferior.
      */}
      <Path
        d="M 6 32 C 14 18, 28 14, 40 18 S 58 28, 58 32"
        stroke="#FFFFFF"
        strokeWidth={2.6}
        strokeLinecap="round"
        fill="none"
        opacity={0.92}
      />
      <Path
        d="M 6 32 C 14 46, 28 50, 40 46 S 58 36, 58 32"
        stroke="#FFFFFF"
        strokeWidth={2.6}
        strokeLinecap="round"
        fill="none"
        opacity={0.92}
      />
    </Svg>
  );
}

/** Versión "dark" — blanco puro con destellos sutiles sobre fondos oscuros. */
function BrandMarkDark({ size }: { size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64" fill="none">
      <Defs>
        <RadialGradient
          id="ballDarkHi"
          cx="30%"
          cy="28%"
          rx="40%"
          ry="40%"
        >
          <Stop offset="0%" stopColor="#FFFFFF" stopOpacity={1} />
          <Stop offset="100%" stopColor="#E0E7FF" stopOpacity={0.85} />
        </RadialGradient>
      </Defs>
      <Circle cx={32} cy={32} r={29} fill="url(#ballDarkHi)" />
      {/* Costuras en azul cobalto */}
      <Path
        d="M 6 32 C 14 18, 28 14, 40 18 S 58 28, 58 32"
        stroke={colors.brand.cobalt}
        strokeWidth={2.2}
        strokeLinecap="round"
        fill="none"
        opacity={0.8}
      />
      <Path
        d="M 6 32 C 14 46, 28 50, 40 46 S 58 36, 58 32"
        stroke={colors.brand.cobalt}
        strokeWidth={2.2}
        strokeLinecap="round"
        fill="none"
        opacity={0.8}
      />
    </Svg>
  );
}

/** Versión "mono" — silueta plana, color custom. */
function BrandMarkMono({ size, color }: { size: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64" fill="none">
      <Circle cx={32} cy={32} r={29} fill={color} />
      <Path
        d="M 6 32 C 14 18, 28 14, 40 18 S 58 28, 58 32"
        stroke="#FFFFFF"
        strokeWidth={2.6}
        strokeLinecap="round"
        fill="none"
        opacity={0.95}
      />
      <Path
        d="M 6 32 C 14 46, 28 50, 40 46 S 58 36, 58 32"
        stroke="#FFFFFF"
        strokeWidth={2.6}
        strokeLinecap="round"
        fill="none"
        opacity={0.95}
      />
    </Svg>
  );
}

/* ────────────────────────────────────────────────────────────────
   WORDMARK — Fusión tipográfica elegante.

   Spec: "'Padel' en peso ultra-delgado o regular (font-light/font-normal)
          y 'AppRetas' en peso extra-negrita (font-black/font-extrabold)"

   Implementación:
     • "Padel"     → Inter_400Regular (peso regular, look elegante)
     • "AppRetas"  → Inter_900Black + tracking-tighter (look corporativo)
   Color: degradado lineal en SVG (cuando es light) o text color (mono).
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
  const lightColor = colors.brand.cobalt;       // indigo-900 — base
  const accentColor = colors.brand.primary;     // blue-600 — acento
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

/* ────────────────────────────────────────────────────────────────
   LOCKUP — Composición horizontal isotipo + wordmark.
   ──────────────────────────────────────────────────────────────── */

type LockupProps = {
  /** Altura del isotipo (el wordmark se escala proporcionalmente). */
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
  lockupRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  wordmarkRow: {
    flexDirection: "row",
    alignItems: "baseline",
  },
  wordmarkLight: {
    // Peso ligero/regular — look elegante, casi editorial.
    fontFamily: Platform.select({
      web: "Inter, system-ui, -apple-system, sans-serif",
      default: fonts.sansRegular,
    }) as string,
    fontWeight: "300",
    letterSpacing: -0.4,
  },
  wordmarkHeavy: {
    // Peso extra-negrita — corporativo, deportivo.
    fontFamily: Platform.select({
      web: "Inter, system-ui, -apple-system, sans-serif",
      default: fonts.sansBlack,
    }) as string,
    fontWeight: "900",
    letterSpacing: -0.6,
  },
});
