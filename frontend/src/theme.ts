/**
 * PadelappRetas OS — Design Tokens
 * "Club Pro Clean" — luminoso, corporativo, alto rendimiento.
 *
 * Paleta:
 *  - bg-slate-50 (#F8FAFC) — fondo principal
 *  - bg-white (#FFFFFF) — tarjetas
 *  - border-slate-200 (#E2E8F0) — bordes sutiles
 *  - text-slate-900 (#0F172A) — títulos
 *  - text-slate-700 (#334155) — lectura cómoda
 *  - text-slate-500 (#64748B) — texto secundario
 *  - bg-emerald-600 (#059669) — acento "Césped Pro" (CTAs, activos)
 *
 * Tipografía premium (Inter + JetBrains Mono):
 *  - Display / Títulos: Inter_900Black con tracking-tighter (estética Nike)
 *  - Body: Inter_400Regular con leading-relaxed sobre slate-700
 *  - Mono (precios, KMs, timers, posiciones): JetBrainsMono_600SemiBold + tabular-nums
 */
import { Platform, TextStyle } from "react-native";

export const colors = {
  bg: {
    app: "#F8FAFC",            // slate-50
    card: "#FFFFFF",           // white
    elevated: "#F1F5F9",       // slate-100
    modal: "rgba(15, 23, 42, 0.55)",
    surface: "#FAFAFA",        // alt soft background
  },
  brand: {
    primary: "#059669",        // emerald-600 — Césped Pro
    primaryHover: "#047857",   // emerald-700
    primaryMuted: "rgba(5, 150, 105, 0.10)",
    primaryBorder: "rgba(5, 150, 105, 0.30)",
    primarySoft: "#ECFDF5",    // emerald-50
    accent: "#10B981",         // emerald-500 secundario
    onPrimary: "#FFFFFF",
  },
  text: {
    primary: "#0F172A",        // slate-900 — títulos
    body: "#334155",           // slate-700 — lectura cómoda bajo el sol
    secondary: "#64748B",      // slate-500
    tertiary: "#94A3B8",       // slate-400
    muted: "#94A3B8",
    inverse: "#FFFFFF",
    onAccent: "#FFFFFF",
  },
  status: {
    green: "#059669",
    greenBg: "#D1FAE5",
    greenText: "#065F46",
    greenBorder: "#A7F3D0",
    amber: "#D97706",
    amberBg: "#FEF3C7",
    amberText: "#92400E",
    amberBorder: "#FDE68A",
    red: "#E11D48",
    redBg: "#FFE4E6",
    redText: "#9F1239",
    redBorder: "#FECDD3",
    yellow: "#D97706",
  },
  border: {
    default: "#E2E8F0",
    // Borde ultra fino v2 — slate-200/80 (CC = 80% alpha) — para tarjetas Club Pro.
    soft80: "rgba(226, 232, 240, 0.8)",
    // v3 — Hairline (Director de Arte): slate-200/60 — borde casi imperceptible
    // para tarjetas premium. Crea separación visual sin ruido.
    hairline: "rgba(226, 232, 240, 0.6)",
    focus: "#059669",
    subtle: "#F1F5F9",
    strong: "#CBD5E1",
  },
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  base: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const radii = {
  sm: 6,
  md: 10,
  lg: 14,
  xl: 20,
  squircle: 22,
  pill: 999,
} as const;

// Familias de fuentes premium. Centralizadas para evitar typos en StyleSheet.
export const fonts = {
  sansRegular: "Inter_400Regular",
  sansMedium: "Inter_500Medium",
  sansSemiBold: "Inter_600SemiBold",
  sansBold: "Inter_700Bold",
  sansExtraBold: "Inter_800ExtraBold",
  sansBlack: "Inter_900Black",
  monoRegular: "JetBrainsMono_400Regular",
  monoSemiBold: "JetBrainsMono_600SemiBold",
  monoBold: "JetBrainsMono_700Bold",
} as const;

// Fallback mono histórico (cuando JetBrains Mono no carga aún).
export const monoFont = Platform.select({
  ios: "Menlo",
  android: "monospace",
  default: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
}) as string;

/**
 * Sistema tipográfico jerárquico — Inter + JetBrains Mono.
 *
 * Reglas:
 *  - Display / H1 / H2 / H3 -> Inter_900Black / 800ExtraBold + tracking-tighter (-1.2 a -0.4)
 *  - Body / BodyRelaxed   -> Inter_400Regular sobre slate-700 con leading-relaxed
 *  - Mono*                -> JetBrainsMono_600SemiBold + tabular-nums (timers, precios)
 *  - Label                -> Inter_700Bold uppercase con tracking expandido (overline)
 */
export const typography: Record<string, TextStyle> = {
  // Headlines deportivos (estética Nike / marcadores LED)
  display: {
    fontFamily: fonts.sansBlack,
    fontSize: 40,
    letterSpacing: -1.4,
    lineHeight: 44,
    color: colors.text.primary,
  },
  h1: {
    fontFamily: fonts.sansBlack,
    fontSize: 30,
    letterSpacing: -1.0,
    lineHeight: 34,
    color: colors.text.primary,
  },
  h2: {
    fontFamily: fonts.sansBlack,
    fontSize: 22,
    letterSpacing: -0.6,
    lineHeight: 26,
    color: colors.text.primary,
  },
  h3: {
    fontFamily: fonts.sansExtraBold,
    fontSize: 18,
    letterSpacing: -0.4,
    lineHeight: 22,
    color: colors.text.primary,
  },
  brand: {
    // Brand inline (PADELAPPRETAS · ADMIN, etc.)
    fontFamily: fonts.sansBlack,
    fontSize: 18,
    letterSpacing: -0.4,
    color: colors.brand.primary,
  },

  // Lectura cómoda — slate-700 + leading-relaxed
  body: {
    fontFamily: fonts.sansRegular,
    fontSize: 15,
    lineHeight: 22,
    color: colors.text.body,
  },
  bodyRelaxed: {
    fontFamily: fonts.sansRegular,
    fontSize: 15,
    lineHeight: 24,
    color: colors.text.body,
  },
  bodyBold: {
    fontFamily: fonts.sansSemiBold,
    fontSize: 15,
    lineHeight: 22,
    color: colors.text.primary,
  },
  bodySm: {
    fontFamily: fonts.sansRegular,
    fontSize: 13,
    lineHeight: 18,
    color: colors.text.body,
  },

  // Etiqueta tipo overline (chips, headers de secciones)
  label: {
    fontFamily: fonts.sansBold,
    fontSize: 11,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    color: colors.text.secondary,
  },
  caption: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
    lineHeight: 16,
    color: colors.text.secondary,
  },

  // Botones (legible bajo el sol, alto contraste)
  button: {
    fontFamily: fonts.sansExtraBold,
    fontSize: 13,
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  buttonLg: {
    fontFamily: fonts.sansExtraBold,
    fontSize: 15,
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },

  // MONO — datos críticos (precios, distancias KM, posiciones, timers)
  mono: {
    fontFamily: fonts.monoSemiBold,
    fontSize: 14,
    fontVariant: ["tabular-nums"],
    color: colors.text.primary,
  },
  monoSm: {
    fontFamily: fonts.monoSemiBold,
    fontSize: 12,
    fontVariant: ["tabular-nums"],
    color: colors.text.body,
  },
  monoBold: {
    fontFamily: fonts.monoBold,
    fontSize: 14,
    fontVariant: ["tabular-nums"],
    color: colors.text.primary,
  },
  monoLarge: {
    fontFamily: fonts.monoBold,
    fontSize: 22,
    letterSpacing: -0.4,
    fontVariant: ["tabular-nums"],
    color: colors.text.primary,
  },
};

export const shadows = {
  // v2 — micro-sombra de dispersión suave (spec del Director de Arte):
  //   "shadow-[0_4px_20px_-4px_rgba(15,23,42,0.05)]"
  // Genera efecto de capas limpias sin ensuciar la pantalla.
  card: Platform.select({
    ios: {
      shadowColor: "#0F172A",
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.05,
      shadowRadius: 20,
    },
    android: { elevation: 2 },
    web: { boxShadow: "0 4px 20px -4px rgba(15,23,42,0.05)" } as any,
    default: {},
  }),
  cardHover: Platform.select({
    ios: {
      shadowColor: "#0F172A",
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.08,
      shadowRadius: 12,
    },
    android: { elevation: 3 },
    web: { boxShadow: "0 4px 12px rgba(15,23,42,0.08)" } as any,
    default: {},
  }),
  cta: Platform.select({
    ios: {
      shadowColor: "#059669",
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: 0.25,
      shadowRadius: 14,
    },
    android: { elevation: 6 },
    web: { boxShadow: "0 6px 14px rgba(5,150,105,0.25)" } as any,
    default: {},
  }),
  // v3 PREMIUM — Spec del Director de Arte:
  //   shadow-[0_8px_30px_rgb(15,23,42,0.02)]
  // Sombra ultra difuminada para look de software premium. Casi invisible
  // pero crea profundidad espacial entre layers.
  premium: Platform.select({
    ios: {
      shadowColor: "#0F172A",
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.02,
      shadowRadius: 30,
    },
    android: { elevation: 1 },
    web: { boxShadow: "0 8px 30px rgba(15,23,42,0.02)" } as any,
    default: {},
  }),
} as const;
