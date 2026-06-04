/**
 * PadelappRetas OS — Design Tokens
 * "BLUE CLUB PRO V2" — Director de Arte: Identidad Premium Azul Profundo.
 *
 * MIGRACIÓN: emerald → azul eléctrico / cobalto. Esmeralda sólo se conserva
 * para semáforo positivo (+ScoreDelta, semáforo de cupo, semáforo de DG).
 *
 * Paleta principal (Tailwind tokens equivalentes):
 *  - bg-slate-50      (#F8FAFC) — fondo principal
 *  - bg-white         (#FFFFFF) — tarjetas
 *  - border-blue-100  (#DBEAFE / 60% alpha) — bordes hairline ultra-finos
 *  - text-slate-900   (#0F172A) — títulos
 *  - text-slate-700   (#334155) — cuerpo
 *  - text-slate-500   (#64748B) — secundario
 *  - bg-blue-600      (#2563EB) — Azul Eléctrico (brand primario)
 *  - bg-indigo-900    (#312E81) — Azul Cobalto Real (gradiente)
 *  - bg-blue-500      (#3B82F6) — acento secundario
 *  - text-emerald-600 (#059669) — Verde semáforo positivo (DG+, score+, capacidad ok)
 *
 * Tipografía premium (Inter + JetBrains Mono):
 *  - Display / Títulos: Inter_900Black con tracking-tighter (Nike-style)
 *  - Body: Inter_400Regular con leading-relaxed sobre slate-700
 *  - Mono (datos críticos): JetBrainsMono_700Bold + tabular-nums
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
    // ── BLUE CLUB PRO V2 ─────────────────────────────────────────
    primary: "#2563EB",        // blue-600 — Azul Eléctrico
    primaryHover: "#1D4ED8",   // blue-700
    primaryMuted: "rgba(37, 99, 235, 0.10)",
    primaryBorder: "rgba(37, 99, 235, 0.30)",
    primarySoft: "#EFF6FF",    // blue-50
    accent: "#3B82F6",         // blue-500 acento secundario
    // Gradiente premium (login, CTAs hero)
    gradientFrom: "#2563EB",   // blue-600
    gradientVia:  "#1E40AF",   // blue-800
    gradientTo:   "#312E81",   // indigo-900 — Azul Cobalto Real
    cobalt: "#312E81",         // indigo-900
    midnight: "#1E1B4B",       // indigo-950 (text titles ultra premium)
    onPrimary: "#FFFFFF",
  },
  text: {
    primary: "#0F172A",        // slate-900 — títulos
    body: "#334155",           // slate-700 — lectura cómoda
    secondary: "#64748B",      // slate-500
    tertiary: "#94A3B8",       // slate-400
    muted: "#94A3B8",
    inverse: "#FFFFFF",
    onAccent: "#FFFFFF",
    /** Datos críticos (mono) — Azul Medianoche slate-900. */
    dataMono: "#0F172A",
    /** Verde semáforo POSITIVO — DG+, score+, capacidad ok. */
    positive: "#059669",       // emerald-600
  },
  status: {
    // Verde Esmeralda se MANTIENE para semáforo universal positivo.
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
    // V2 — Borde ultra fino azul grisáceo tenue (spec del Director de Arte)
    //   "border-blue-100/60" = #DBEAFE @ 60% alpha
    blueHairline: "rgba(219, 234, 254, 0.6)",
    soft80: "rgba(226, 232, 240, 0.8)",
    hairline: "rgba(226, 232, 240, 0.6)",
    focus: "#2563EB",          // blue-600
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

export const monoFont = Platform.select({
  ios: "Menlo",
  android: "monospace",
  default: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
}) as string;

export const typography: Record<string, TextStyle> = {
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
    fontFamily: fonts.sansBlack,
    fontSize: 18,
    letterSpacing: -0.4,
    color: colors.brand.primary,
  },
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
  // MONO — datos críticos (precios, marcadores, DG, posiciones, timers)
  // Spec V2: text-slate-900 + tabular-nums.
  mono: {
    fontFamily: fonts.monoSemiBold,
    fontSize: 14,
    fontVariant: ["tabular-nums"],
    color: colors.text.dataMono,
  },
  monoSm: {
    fontFamily: fonts.monoSemiBold,
    fontSize: 12,
    fontVariant: ["tabular-nums"],
    color: colors.text.dataMono,
  },
  monoBold: {
    fontFamily: fonts.monoBold,
    fontSize: 14,
    fontVariant: ["tabular-nums"],
    color: colors.text.dataMono,
  },
  monoLarge: {
    fontFamily: fonts.monoBold,
    fontSize: 22,
    letterSpacing: -0.4,
    fontVariant: ["tabular-nums"],
    color: colors.text.dataMono,
  },
};

export const shadows = {
  // RN 0.76+ admite `boxShadow` cross-platform (iOS + Android + Web), por lo
  // que ya no necesitamos `shadowColor/shadowOffset/shadowOpacity/shadowRadius`
  // (deprecados). Mantenemos `elevation` en Android para conservar el look
  // Material si en algún build futuro vuelve a tener semántica distinta.
  card: {
    boxShadow: "0px 4px 20px rgba(15,23,42,0.05)",
    elevation: 2,
  } as any,
  cardHover: {
    boxShadow: "0px 4px 12px rgba(15,23,42,0.08)",
    elevation: 3,
  } as any,
  cta: {
    boxShadow: "0px 6px 14px rgba(37,99,235,0.25)",
    elevation: 6,
  } as any,
  premium: {
    boxShadow: "0px 8px 30px rgba(15,23,42,0.02)",
    elevation: 1,
  } as any,
  // V2 spec del Director de Arte:
  //   "shadow-[0_12px_40px_-6px_rgba(30,41,59,0.04)]"
  // Mini-sombra cohesionada para look de software premium internacional.
  premiumV2: {
    boxShadow: "0px 12px 40px rgba(30,41,59,0.04)",
    elevation: 2,
  } as any,
} as const;

/**
 * Convierte un color hex (#RGB / #RRGGBB) + alpha a `rgba(r,g,b,a)`.
 * Útil para construir `boxShadow` dinámicos sin depender de Platform.select.
 */
export function hexA(hex: string, alpha = 1): string {
  let h = (hex || "").replace("#", "").trim();
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (h.length !== 6) return `rgba(0,0,0,${alpha})`;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
