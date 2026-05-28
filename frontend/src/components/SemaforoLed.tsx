/**
 * SemáforoLED — indicador deportivo 3D-stylized.
 *
 * Diseño:
 *   • Núcleo sólido brillante (estado actual: VERDE / AMARILLO / ROJO).
 *   • Anillo concéntrico perimetral con opacidad 0.1 → emula el relieve de
 *     una pelota oficial o de un marcador electrónico tipo LED.
 *   • Halo soft glow exterior para "encendido" (sólo cuando `activo`).
 *
 * Tamaños predefinidos: sm (10), md (14), lg (18), xl (22).
 */
import React from "react";
import { StyleSheet, View, ViewStyle } from "react-native";

import { colors } from "@/src/theme";

export type Estado = "VERDE" | "AMARILLO" | "ROJO";
type Size = "sm" | "md" | "lg" | "xl";

const SIZES: Record<Size, { core: number; ring: number }> = {
  sm: { core: 10, ring: 18 },
  md: { core: 14, ring: 24 },
  lg: { core: 18, ring: 30 },
  xl: { core: 22, ring: 36 },
};

const PALETTE: Record<Estado, { core: string; halo: string }> = {
  VERDE: { core: "#059669", halo: "rgba(5, 150, 105, 0.16)" },
  AMARILLO: { core: "#D97706", halo: "rgba(217, 119, 6, 0.18)" },
  ROJO: { core: "#E11D48", halo: "rgba(225, 29, 72, 0.18)" },
};

type Props = {
  estado?: Estado | null;
  size?: Size;
  /** Si true muestra halo glow encendido. */
  activo?: boolean;
  style?: ViewStyle;
  testID?: string;
};

export function SemaforoLed({
  estado = "VERDE",
  size = "md",
  activo = true,
  style,
  testID,
}: Props) {
  const dims = SIZES[size];
  const p = PALETTE[estado ?? "VERDE"];

  return (
    <View
      style={[
        styles.ringWrap,
        {
          width: dims.ring,
          height: dims.ring,
          borderRadius: dims.ring / 2,
          backgroundColor: activo ? p.halo : "transparent",
        },
        style,
      ]}
      testID={testID}
    >
      <View
        style={{
          width: dims.core,
          height: dims.core,
          borderRadius: dims.core / 2,
          backgroundColor: p.core,
          // sutil reflejo "specular" via borde claro arriba
          borderWidth: 1,
          borderColor: "rgba(255,255,255,0.5)",
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  ringWrap: {
    alignItems: "center",
    justifyContent: "center",
  },
});
