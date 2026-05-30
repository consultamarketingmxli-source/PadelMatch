/**
 * PadelBallLoader — Loader temático de élite (pelota de pádel volt rebotando).
 *
 * Diseño:
 *   - SVG puro plano (sin gradientes complejos ni sombras pesadas).
 *   - Color institucional Volt/Neón: #ccff00.
 *   - Dos costuras blancas curvas en perspectiva asimétrica (3/4),
 *     SIN cruzarse en el centro (basado en product_14_2.jpg).
 *   - Sombra elíptica plana #cbd5e1 que se contrae/oscurece al impacto.
 *
 * Física:
 *   - Squash & Stretch en el punto máximo de caída: scale(1.25, 0.75).
 *   - Sombra sincronizada: más pequeña y oscura en impacto,
 *     más grande y clara cuando la pelota se eleva.
 *
 * Implementación:
 *   - `react-native-reanimated` worklets corren en el UI thread
 *     (hardware-accelerated · cero overhead en el JS thread).
 *   - En web, Reanimated genera CSS transforms equivalentes a @keyframes.
 */
import React, { useEffect } from "react";
import { StyleSheet, Text, View, ViewStyle } from "react-native";
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { PadelBallShape } from "@/src/components/brand";

export type PadelBallLoaderProps = {
  /** Diámetro de la pelota en px (default 56). */
  size?: number;
  /** Mensaje opcional debajo. */
  label?: string;
  /** Estilo del contenedor. */
  style?: ViewStyle;
};

const VOLT = "#ccff00";
const SHADOW = "#cbd5e1";

export function PadelBallLoader({
  size = 56,
  label,
  style,
}: PadelBallLoaderProps) {
  // Shared value 0→1 corre en el UI thread (worklet).
  // Equivalente a un @keyframes con duración 900ms loop infinito.
  const t = useSharedValue(0);

  useEffect(() => {
    t.value = withRepeat(
      withTiming(1, {
        duration: 900,
        easing: Easing.inOut(Easing.cubic),
      }),
      -1, // loop infinito
      true, // reverse al terminar
    );
  }, [t]);

  // Ball animation: translateY (rebote) + squash horizontal/vertical al tocar piso.
  const ballStyle = useAnimatedStyle(() => {
    // Keyframes: 0% (arriba) → 50% (suelo, squashed) → 100% (arriba)
    // Como withRepeat con reverse=true, slo modelamos 0→0.5.
    const v = t.value;
    // translateY: -36% del size en pico, 0 al suelo
    const ty = interpolate(v, [0, 0.5, 1], [-size * 0.55, 0, -size * 0.55]);
    // Squash: en el contacto (v≈0.5) achata a 0.75 vertical / 1.25 horizontal
    const sx = interpolate(v, [0, 0.42, 0.5, 0.58, 1], [1, 1.04, 1.25, 1.04, 1]);
    const sy = interpolate(v, [0, 0.42, 0.5, 0.58, 1], [1, 0.96, 0.75, 0.96, 1]);
    return {
      transform: [{ translateY: ty }, { scaleX: sx }, { scaleY: sy }],
    };
  });

  // Shadow: más pequeña y oscura al impacto · más grande y tenue arriba.
  const shadowStyle = useAnimatedStyle(() => {
    const v = t.value;
    // Al impacto (v=0.5): scale 0.55 + opacity 0.55
    // En el pico (v=0 o 1): scale 1.10 + opacity 0.22
    const s = interpolate(v, [0, 0.5, 1], [1.1, 0.55, 1.1]);
    const o = interpolate(v, [0, 0.5, 1], [0.22, 0.55, 0.22]);
    return {
      transform: [{ scaleX: s }, { scaleY: s * 0.4 }],
      opacity: o,
    };
  });

  const stageHeight = size * 1.7; // espacio para rebote
  const ballSize = size;
  const shadowW = size * 0.85;
  const shadowH = size * 0.22;

  return (
    <View style={[styles.container, style]} accessible accessibilityLabel="Cargando">
      <View style={[styles.stage, { width: ballSize * 1.5, height: stageHeight }]}>
        {/* Sombra del piso (animada) */}
        <Animated.View
          style={[
            styles.shadow,
            {
              width: shadowW,
              height: shadowH,
              borderRadius: shadowH / 2,
              bottom: 2,
            },
            shadowStyle,
          ]}
          pointerEvents="none"
        />

        {/* Pelota (animada) */}
        <Animated.View
          style={[
            styles.ballWrap,
            { width: ballSize, height: ballSize, bottom: shadowH + 2 },
            ballStyle,
          ]}
          pointerEvents="none"
        >
          {/* Forma canónica (idéntica al brand logo). Solo color cambia. */}
          <PadelBallShape
            size={ballSize}
            color={VOLT}
            gradient
            highlight
          />
        </Animated.View>
      </View>

      {label ? <Text style={styles.label}>{label}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    justifyContent: "center",
  },
  stage: {
    alignItems: "center",
    justifyContent: "flex-end",
    position: "relative",
  },
  ballWrap: {
    position: "absolute",
    alignItems: "center",
    justifyContent: "center",
  },
  shadow: {
    position: "absolute",
    backgroundColor: SHADOW,
  },
  label: {
    marginTop: 14,
    fontSize: 12,
    color: "#64748B",
    fontWeight: "600",
    letterSpacing: 0.3,
  },
});
