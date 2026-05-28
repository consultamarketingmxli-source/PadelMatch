/**
 * TrafficLight · Semáforo Deportivado v2 (Club Pro Clean v2)
 *
 * Director de Arte spec:
 *   • Núcleo sólido del color (emerald-600 / amber / red).
 *   • Anillo perimetral concéntrico al 10% del mismo color → emula el
 *     relieve tridimensional de una pelota o marcador electrónico LED.
 *   • Sutil reflejo speccular vía borde blanco (50% alpha) en el núcleo.
 */
import React from "react";
import { Platform, View, Text, StyleSheet } from "react-native";
import { colors, radii, spacing, typography } from "@/src/theme";

// Glow LED multiplataforma. En web React Native usa `boxShadow` (props
// shadow* quedaron deprecadas); en native seguimos con shadow*.
const ledGlow = (color: string, radius: number) =>
  Platform.OS === "web"
    ? { boxShadow: `0 0 ${radius}px ${color}` as any }
    : {
        shadowColor: color,
        shadowOpacity: radius >= 6 ? 0.6 : 0.5,
        shadowRadius: radius,
        shadowOffset: { width: 0, height: 0 },
      };

// Anillo concéntrico relieve (v2). RGBA del color al 10%.
const HALO: Record<"VERDE" | "AMARILLO" | "ROJO", string> = {
  VERDE: "rgba(5, 150, 105, 0.10)",
  AMARILLO: "rgba(217, 119, 6, 0.12)",
  ROJO: "rgba(225, 29, 72, 0.12)",
};

type Props = {
  status: "VERDE" | "AMARILLO" | "ROJO";
  capacidadPct: number;
  size?: "sm" | "md";
};

export function TrafficLight({ status, capacidadPct, size = "md" }: Props) {
  const palette = {
    VERDE: {
      dot: colors.status.green,
      bg: colors.status.greenBg,
      text: colors.status.greenText,
      border: colors.status.greenBorder,
      label: "DISPONIBLE",
    },
    AMARILLO: {
      dot: colors.status.amber,
      bg: colors.status.amberBg,
      text: colors.status.amberText,
      border: colors.status.amberBorder,
      label: "DEMANDA",
    },
    ROJO: {
      dot: colors.status.red,
      bg: colors.status.redBg,
      text: colors.status.redText,
      border: colors.status.redBorder,
      label: "LLENA",
    },
  }[status];

  const halo = HALO[status];

  if (size === "sm") {
    return (
      <View
        style={[
          styles.badgeSm,
          { backgroundColor: palette.bg, borderColor: palette.border },
        ]}
        testID="traffic-light"
      >
        <View style={[styles.haloSm, { backgroundColor: halo }]}>
          <View
            style={[
              styles.dotSm,
              { backgroundColor: palette.dot, borderColor: "rgba(255,255,255,0.5)" },
              ledGlow(palette.dot, 4),
            ]}
          />
        </View>
        <Text style={[styles.pctSm, { color: palette.text }]}>
          {Math.round(capacidadPct)}%
        </Text>
      </View>
    );
  }

  return (
    <View
      style={[
        styles.badgeMd,
        { backgroundColor: palette.bg, borderColor: palette.border },
      ]}
      testID="traffic-light"
    >
      <View style={[styles.haloMd, { backgroundColor: halo }]}>
        <View
          style={[
            styles.dotMd,
            { backgroundColor: palette.dot, borderColor: "rgba(255,255,255,0.5)" },
            ledGlow(palette.dot, 6),
          ]}
        />
      </View>
      <Text style={[styles.labelMd, { color: palette.text }]}>
        {palette.label}
      </Text>
      <Text style={[styles.pctMd, { color: palette.text }]}>
        · {Math.round(capacidadPct)}%
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badgeSm: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radii.pill,
    borderWidth: 1,
  },
  haloSm: {
    width: 14,
    height: 14,
    borderRadius: 7,
    alignItems: "center",
    justifyContent: "center",
  },
  dotSm: {
    width: 8,
    height: 8,
    borderRadius: 4,
    borderWidth: 1,
  },
  pctSm: {
    ...typography.mono,
    fontSize: 11,
    fontWeight: "800",
  },
  badgeMd: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radii.pill,
    borderWidth: 1,
  },
  haloMd: {
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  dotMd: {
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 1,
  },
  labelMd: {
    ...typography.label,
    fontSize: 10,
    letterSpacing: 1.2,
  },
  pctMd: {
    ...typography.mono,
    fontSize: 11,
    fontWeight: "800",
  },
});
