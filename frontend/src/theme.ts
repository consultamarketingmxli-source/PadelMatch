/**
 * Pixel Padel OS — Design tokens.
 * Premium dark theme + neon padel green accent.
 */
export const colors = {
  bg: {
    app: "#0A0A0A",
    card: "#151515",
    elevated: "#1A1A1A",
    modal: "rgba(0,0,0,0.85)",
  },
  brand: {
    primary: "#A3E635",
    primaryMuted: "rgba(163,230,53,0.15)",
    primaryBorder: "rgba(163,230,53,0.4)",
    primarySoft: "rgba(163,230,53,0.05)",
  },
  text: {
    primary: "#FFFFFF",
    secondary: "#A1A1AA",
    muted: "#52525B",
    inverse: "#000000",
  },
  status: {
    green: "#22C55E",
    yellow: "#EAB308",
    red: "#EF4444",
  },
  border: {
    default: "#27272A",
    focus: "#A3E635",
    subtle: "#1F1F22",
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
  md: 8,
  lg: 12,
  xl: 16,
  pill: 999,
} as const;

export const typography = {
  h1: { fontSize: 32, fontWeight: "900" as const, letterSpacing: -1 },
  h2: { fontSize: 24, fontWeight: "800" as const, letterSpacing: -0.5 },
  h3: { fontSize: 20, fontWeight: "700" as const },
  body: { fontSize: 16, fontWeight: "400" as const },
  bodyBold: { fontSize: 16, fontWeight: "700" as const },
  label: {
    fontSize: 12,
    fontWeight: "700" as const,
    letterSpacing: 1.2,
    textTransform: "uppercase" as const,
  },
  caption: { fontSize: 12, fontWeight: "500" as const },
};
