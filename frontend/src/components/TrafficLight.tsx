/** Semáforo de participación: 3 dots con glow. */
import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { colors, spacing, typography } from "@/src/theme";

type Props = {
  status: "VERDE" | "AMARILLO" | "ROJO";
  capacidadPct: number;
  size?: "sm" | "md";
};

export function TrafficLight({ status, capacidadPct, size = "md" }: Props) {
  const active = {
    VERDE: 0,
    AMARILLO: 1,
    ROJO: 2,
  }[status];
  const dot = size === "sm" ? 8 : 12;
  const palette = [colors.status.green, colors.status.yellow, colors.status.red];
  return (
    <View style={styles.row} testID="traffic-light">
      <View style={styles.dotsWrap}>
        {[0, 1, 2].map((i) => (
          <View
            key={i}
            style={[
              styles.dot,
              {
                width: dot,
                height: dot,
                borderRadius: dot / 2,
                backgroundColor:
                  i === active ? palette[i] : "rgba(255,255,255,0.12)",
                shadowColor: i === active ? palette[i] : "transparent",
                shadowOpacity: i === active ? 0.9 : 0,
                shadowRadius: i === active ? 8 : 0,
                shadowOffset: { width: 0, height: 0 },
              },
            ]}
          />
        ))}
      </View>
      {size === "md" && (
        <Text style={styles.label}>
          {capacidadPct.toFixed(0)}% · {status}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  dotsWrap: { flexDirection: "row", gap: 6 },
  dot: { borderWidth: 1, borderColor: "rgba(255,255,255,0.08)" },
  label: {
    ...typography.label,
    color: colors.text.secondary,
  },
});
