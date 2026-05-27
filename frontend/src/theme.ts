/**
 * PadelReta — Design tokens.
 * Paleta amigable: blanco + azul profesional + acentos cielo.
 */
export const colors = {
  bg: {
    app: "#F8FAFC",         // slate-50 — fondo principal suave
    card: "#FFFFFF",
    elevated: "#F1F5F9",    // slate-100 — chips/stat boxes
    modal: "rgba(15, 23, 42, 0.55)",
  },
  brand: {
    primary: "#2563EB",     // blue-600 — botones, links
    primaryHover: "#1D4ED8",
    primaryMuted: "rgba(37, 99, 235, 0.10)",
    primaryBorder: "rgba(37, 99, 235, 0.30)",
    primarySoft: "rgba(37, 99, 235, 0.06)",
    accent: "#0EA5E9",      // sky-500 — secundario
  },
  text: {
    primary: "#0F172A",     // slate-900
    secondary: "#475569",   // slate-600
    muted: "#94A3B8",       // slate-400
    inverse: "#FFFFFF",
  },
  status: {
    green: "#16A34A",       // disponible
    yellow: "#CA8A04",      // alta demanda
    red: "#DC2626",         // llena
  },
  border: {
    default: "#E2E8F0",     // slate-200
    focus: "#2563EB",
    subtle: "#F1F5F9",
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
  xl: 18,
  pill: 999,
} as const;

export const typography = {
  h1: { fontSize: 30, fontWeight: "800" as const, letterSpacing: -0.6 },
  h2: { fontSize: 22, fontWeight: "800" as const, letterSpacing: -0.3 },
  h3: { fontSize: 18, fontWeight: "700" as const },
  body: { fontSize: 15, fontWeight: "400" as const },
  bodyBold: { fontSize: 15, fontWeight: "700" as const },
  label: {
    fontSize: 11,
    fontWeight: "700" as const,
    letterSpacing: 1.2,
    textTransform: "uppercase" as const,
  },
  caption: { fontSize: 12, fontWeight: "500" as const },
};
