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
import Svg, { Circle, Path } from "react-native-svg";

export type PadelBallLoaderProps = {
  /** Diámetro de la pelota en px (default 56). */
  size?: number;
  /** Mensaje opcional debajo. */
  label?: string;
  /** Estilo del contenedor. */
  style?: ViewStyle;
};

const VOLT = "#ccff00";
const SEAM = "#FFFFFF";
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
          <PadelBallSVG size={ballSize} />
        </Animated.View>
      </View>

      {label ? <Text style={styles.label}>{label}</Text> : null}
    </View>
  );
}

/**
 * SVG plano de la pelota. Geometría:
 *  - Círculo sólido volt.
 *  - DOS costuras blancas en perspectiva 3/4: una superior y una inferior,
 *    desplazadas lateralmente para que NO se crucen en el centro
 *    (replica la asimetría de la foto product_14_2.jpg).
 */
function PadelBallSVG({ size }: { size: number }) {
  const r = size / 2;
  const cx = r;
  const cy = r;
  // Costura superior: arco curvado hacia abajo, desplazado a la izquierda.
  // Costura inferior: arco curvado hacia abajo también, desplazado a la derecha.
  // El control point Q controla la curvatura.
  // Path "M start Q control end" en coordenadas SVG (origen top-left).
  const seamTop = `M ${cx - r * 0.78} ${cy - r * 0.22} Q ${cx - r * 0.05} ${
    cy - r * 0.78
  } ${cx + r * 0.72} ${cy - r * 0.32}`;
  const seamBottom = `M ${cx - r * 0.72} ${cy + r * 0.32} Q ${cx + r * 0.05} ${
    cy + r * 0.78
  } ${cx + r * 0.78} ${cy + r * 0.22}`;

  return (
    <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {/* Cuerpo plano */}
      <Circle cx={cx} cy={cy} r={r - 1} fill={VOLT} />
      {/* Costura superior */}
      <Path
        d={seamTop}
        stroke={SEAM}
        strokeWidth={Math.max(1.5, r * 0.13)}
        strokeLinecap="round"
        fill="none"
      />
      {/* Costura inferior */}
      <Path
        d={seamBottom}
        stroke={SEAM}
        strokeWidth={Math.max(1.5, r * 0.13)}
        strokeLinecap="round"
        fill="none"
      />
    </Svg>
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
