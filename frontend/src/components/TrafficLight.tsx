/**
 * TrafficLight · Semáforo de Participación
 * Estilo "LED deportivo": badge circular de alta visibilidad con dot + label.
 * Combina con la estética Club Pro Clean.
 */
import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { colors, radii, spacing, typography } from "@/src/theme";

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

  if (size === "sm") {
    // Variante compacta: solo dot LED + porcentaje pequeño
    return (
      <View
        style={[
          styles.badgeSm,
          { backgroundColor: palette.bg, borderColor: palette.border },
        ]}
        testID="traffic-light"
      >
        <View
          style={[
            styles.dotSm,
            {
              backgroundColor: palette.dot,
              shadowColor: palette.dot,
            },
          ]}
        />
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
      <View
        style={[
          styles.dotMd,
          {
            backgroundColor: palette.dot,
            shadowColor: palette.dot,
          },
        ]}
      />
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
  dotSm: {
    width: 8,
    height: 8,
    borderRadius: 4,
    shadowOpacity: 0.5,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 0 },
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
  dotMd: {
    width: 10,
    height: 10,
    borderRadius: 5,
    shadowOpacity: 0.6,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 },
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
