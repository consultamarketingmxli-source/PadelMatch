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
    // ── REBRAND v3 — SAPPHIRE / AZURE PREMIUM ──────────────────
    // Master spec: Sapphire #1E3A8A (hero, prices, deep CTAs)
    //              Azure   #3B82F6 (buttons, badges, active states)
    primary: "#3B82F6",        // Azure — botones primarios y estados activos
    primaryHover: "#1E3A8A",   // Sapphire — hover deep state
    primaryMuted: "rgba(59, 130, 246, 0.10)",
    primaryBorder: "rgba(59, 130, 246, 0.30)",
    primarySoft: "#EFF6FF",    // blue-50
    accent: "#60A5FA",         // Azure Light — íconos secundarios
    // Tokens explícitos del rebrand (uso directo en componentes nuevos)
    sapphire: "#1E3A8A",       // azul zafiro — precios, hero bg, deep accent
    azure: "#3B82F6",          // azul azure — CTAs, badges
    azureLight: "#60A5FA",     // azul claro — hover / secundarios
    bone: "#F8FAFC",           // hueso casi blanco — fondo app
    ink: "#0F172A",            // tinta — texto principal
    // Gradiente premium Sapphire → Azure (CTAs, hero overlays)
    gradientFrom: "#3B82F6",   // azure top
    gradientVia:  "#2563EB",   // blue-600 mid
    gradientTo:   "#1E3A8A",   // sapphire bottom
    cobalt: "#1E3A8A",         // alias legacy → sapphire
    midnight: "#0F172A",       // ink (text titles ultra premium)
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
  // ── REBRAND v3 — radios específicos del Master Design ──
  hero: 28,     // hero banner, modales principales
  card: 24,     // tarjetas de reta
  button: 14,   // botones primarios
  icon: 13,     // contenedor de íconos
  input: 12,    // inputs y selects
} as const;

/**
 * URLs de assets del rebrand v3 (imágenes externas curadas).
 * Servidas desde Emergent customer-assets CDN — públicas.
 */
export const brandAssets = {
  /** Cancha de pádel ángulo alto (fondo del Hero Banner). */
  courtHero:
    "https://customer-assets.emergentagent.com/job_padel-tournament-hub-9/artifacts/lbsdpc8k_campo-padel-alto-angulo_23-2149458998.avif",
} as const;

/**
 * Chips semánticos del rebrand. Cada variante = {bg, text, border}.
 * Usar con el componente <Chip variant="mid"/> para garantizar consistencia.
 */
export const chipPalette = {
  beginner:  { bg: "#F0FDF4", text: "#15803D" },
  mid:       { bg: "#EFF6FF", text: "#1D4ED8" },
  advanced:  { bg: "#FDF4FF", text: "#7E22CE" },
  elite:     { bg: "#FFF7ED", text: "#C2410C" },
  available: { bg: "#F0FDF4", text: "#15803D" },
  full:      { bg: "#FEF2F2", text: "#DC2626" },
  premium:   { bg: "#FFF7ED", text: "#C2410C" },
  today:     { bg: "#EFF6FF", text: "#1D4ED8" },
} as const;

export const fonts = {
  // ── REBRAND v3 — Plus Jakarta Sans (todos los nombres preservados) ──
  sansRegular: "PlusJakartaSans_400Regular",
  sansMedium: "PlusJakartaSans_500Medium",
  sansSemiBold: "PlusJakartaSans_600SemiBold",
  sansBold: "PlusJakartaSans_700Bold",
  sansExtraBold: "PlusJakartaSans_800ExtraBold",
  // PJS no tiene Black 900 — usamos ExtraBold como su tope (look equivalente).
  sansBlack: "PlusJakartaSans_800ExtraBold",
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
  // ── REBRAND v3 — Shadow System (Sapphire-tinted) ──
  // Tono base #0F286E rgba(15,40,110,X) en lugar de gris neutro,
  // para dar la sensación premium "azul profundo iluminado".
  card: {
    boxShadow:
      "0px 1px 2px rgba(15,40,110,0.04), 0px 4px 12px rgba(15,40,110,0.07), 0px 16px 40px rgba(15,40,110,0.09)",
    elevation: 2,
  } as any,
  cardHover: {
    boxShadow:
      "0px 2px 4px rgba(15,40,110,0.06), 0px 8px 24px rgba(15,40,110,0.12), 0px 28px 56px rgba(15,40,110,0.13)",
    elevation: 4,
  } as any,
  cta: {
    boxShadow: "0px 4px 14px rgba(59,130,246,0.35)",
    elevation: 6,
  } as any,
  // Hero / elementos grandes — multi-capa premium con inner highlight.
  hero: {
    boxShadow:
      "0px 2px 4px rgba(15,40,110,0.10), 0px 8px 20px rgba(15,40,110,0.18), 0px 28px 56px rgba(15,40,110,0.28)",
    elevation: 12,
  } as any,
  // Botón CTA principal — sombra de color Azure.
  btn: {
    boxShadow: "0px 6px 20px rgba(59,130,246,0.40)",
    elevation: 8,
  } as any,
  premium: {
    boxShadow: "0px 8px 30px rgba(15,40,110,0.04)",
    elevation: 1,
  } as any,
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
