/**
 * PadelappRetas OS — Design Tokens
 * "Club Pro Clean" — luminoso, corporativo, alto rendimiento.
 *
 * Paleta:
 *  - bg-slate-50 (#F8FAFC) — fondo principal
 *  - bg-white (#FFFFFF) — tarjetas
 *  - border-slate-200 (#E2E8F0) — bordes sutiles
 *  - text-slate-900 (#0F172A) — títulos
 *  - text-slate-500 (#64748B) — texto secundario
 *  - bg-emerald-600 (#059669) — acento "Césped Pro" (CTAs, activos)
 *
 * Tipografía:
 *  - h1/h2/h3 con tracking-tight + font-black (900)
 *  - font-mono para datos variables: costos, distancias km, posiciones, timers
 */
import { Platform } from "react-native";

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
    primary: "#0F172A",        // slate-900
    secondary: "#64748B",      // slate-500
    tertiary: "#94A3B8",       // slate-400
    muted: "#94A3B8",
    inverse: "#FFFFFF",
    onAccent: "#FFFFFF",
  },
  // Semáforo "LED deportivo" — badges circulares de alta visibilidad
  status: {
    // Verde — cupos libres <50%
    green: "#059669",          // emerald-600 dot
    greenBg: "#D1FAE5",        // emerald-100
    greenText: "#065F46",      // emerald-800
    greenBorder: "#A7F3D0",    // emerald-200
    // Amarillo — alta demanda 50-99%
    amber: "#D97706",          // amber-600 dot
    amberBg: "#FEF3C7",        // amber-100
    amberText: "#92400E",      // amber-800
    amberBorder: "#FDE68A",    // amber-200
    // Rojo — llena 100%
    red: "#E11D48",            // rose-600 dot
    redBg: "#FFE4E6",          // rose-100
    redText: "#9F1239",        // rose-800
    redBorder: "#FECDD3",      // rose-200
    // Alias legacy (compatibilidad con código existente)
    yellow: "#D97706",
  },
  border: {
    default: "#E2E8F0",        // slate-200
    focus: "#059669",          // emerald-600
    subtle: "#F1F5F9",         // slate-100
    strong: "#CBD5E1",         // slate-300
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
  squircle: 22,                // App icon / hero CTAs
  pill: 999,
} as const;

// Fuente monoespaciada para datos variables (precios, km, posiciones, timers)
export const monoFont = Platform.select({
  ios: "Menlo",
  android: "monospace",
  default: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
}) as string;

export const typography = {
  // Títulos deportivos: tracking-tight + font-black
  h1: { fontSize: 32, fontWeight: "900" as const, letterSpacing: -0.8 },
  h2: { fontSize: 22, fontWeight: "900" as const, letterSpacing: -0.5 },
  h3: { fontSize: 18, fontWeight: "800" as const, letterSpacing: -0.3 },
  body: { fontSize: 15, fontWeight: "400" as const, letterSpacing: -0.1 },
  bodyBold: { fontSize: 15, fontWeight: "700" as const, letterSpacing: -0.1 },
  // Etiquetas tipo overline
  label: {
    fontSize: 11,
    fontWeight: "700" as const,
    letterSpacing: 1.2,
    textTransform: "uppercase" as const,
  },
  caption: { fontSize: 12, fontWeight: "500" as const },
  // Mono — para precios, distancias, contadores, posiciones de waitlist, timers
  mono: {
    fontFamily: monoFont,
    fontVariant: ["tabular-nums"] as ["tabular-nums"],
  },
  monoBold: {
    fontFamily: monoFont,
    fontVariant: ["tabular-nums"] as ["tabular-nums"],
    fontWeight: "800" as const,
  },
  monoLarge: {
    fontFamily: monoFont,
    fontVariant: ["tabular-nums"] as ["tabular-nums"],
    fontWeight: "900" as const,
    fontSize: 22,
    letterSpacing: -0.5,
  },
};

// Sombras sutiles (Mobile-first, alto rendimiento bajo el sol)
export const shadows = {
  card: Platform.select({
    ios: {
      shadowColor: "#0F172A",
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.04,
      shadowRadius: 6,
    },
    android: { elevation: 1 },
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
    default: {},
  }),
} as const;
