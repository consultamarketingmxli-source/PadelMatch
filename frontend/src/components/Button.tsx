import React, { useCallback, useRef } from "react";
import { ActivityIndicator, StyleSheet, Text, TextStyle, TouchableOpacity, View } from "react-native";
import { BrandLogo } from "@/src/components/BrandLogo";
import { colors, radii, shadows, spacing, typography } from "@/src/theme";

/**
 * Auditoría Routing — Fase 3: Debounce universal en CTAs.
 *
 * Tap-lock síncrono (ref) que previene el clásico "doble click" que dispara
 * dos requests HTTP idénticos. React `setState(loading=true)` es async, así
 * que entre el primer onPress y el repaint con `disabled=true` existe una
 * ventana de ~16-100ms donde un segundo tap llega antes de que React lo
 * pinte deshabilitado. Esta ref cierra esa ventana sincrónicamente.
 */
const TAP_LOCK_MS = 600;

type Variant = "primary" | "secondary" | "danger" | "ghost";
type Size = "md" | "lg";

type Props = {
  title: string;
  onPress: () => void;
  variant?: Variant;
  size?: Size;
  disabled?: boolean;
  loading?: boolean;
  testID?: string;
  icon?: React.ReactNode;
  /**
   * Cuando es true, incrusta el isotipo PadelappRetas (pala/pelota mini blanca)
   * a la izquierda del título. Usar en CTAs principales como "Pagar inscripción"
   * o "Unirse a lista de espera" para guiar el ojo del usuario.
   */
  brandIcon?: boolean;
  block?: boolean;
};

export function Button({
  title,
  onPress,
  variant = "primary",
  size = "md",
  disabled,
  loading,
  testID,
  icon,
  brandIcon,
  block = true,
}: Props) {
  const styleVar = variantStyles[variant];
  const sizeStyle = size === "lg" ? styles.baseLg : styles.base;
  const labelStyle: TextStyle =
    size === "lg" ? (typography.buttonLg as TextStyle) : (typography.button as TextStyle);

  // Tap-lock síncrono. Si el caller pasa `loading=true`, ya está protegido,
  // pero entre la primera invocación y el siguiente repaint (~16-100ms) un
  // segundo tap puede colarse. Esta ref bloquea esa ventana.
  const lastPressRef = useRef(0);
  const handlePress = useCallback(() => {
    const now = Date.now();
    if (now - lastPressRef.current < TAP_LOCK_MS) {
      return;
    }
    lastPressRef.current = now;
    onPress();
  }, [onPress]);

  // Color del isotipo según variante (sobre fondo claro queremos color de marca,
  // sobre fondo emerald queremos blanco).
  const brandIconVariant = variant === "primary" || variant === "danger" ? "mono" : "default";
  const isotipoSize = size === "lg" ? 18 : 16;

  return (
    <TouchableOpacity
      testID={testID}
      onPress={handlePress}
      disabled={disabled || loading}
      activeOpacity={0.85}
      style={[
        sizeStyle,
        styleVar.button,
        variant === "primary" && shadows.cta,
        block && { alignSelf: "stretch" },
        (disabled || loading) && { opacity: 0.5 },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={styleVar.text.color} />
      ) : (
        <View style={styles.row}>
          {brandIcon ? (
            <View style={{ marginRight: spacing.sm }}>
              <BrandLogo size={isotipoSize} variant={brandIconVariant} />
            </View>
          ) : null}
          {icon ? <View style={{ marginRight: spacing.sm }}>{icon}</View> : null}
          <Text style={[labelStyle, styleVar.text]}>{title}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  base: {
    paddingVertical: spacing.md + 2,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.md,
    alignItems: "center",
    justifyContent: "center",
  },
  baseLg: {
    paddingVertical: spacing.base,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.lg,
    alignItems: "center",
    justifyContent: "center",
  },
  row: { flexDirection: "row", alignItems: "center" },
});

const variantStyles = {
  primary: {
    button: { backgroundColor: colors.brand.primary },
    text: { color: colors.text.inverse },
  },
  secondary: {
    button: {
      backgroundColor: "transparent",
      borderWidth: 1,
      borderColor: colors.brand.primary,
    },
    text: { color: colors.brand.primary },
  },
  danger: {
    button: { backgroundColor: colors.status.red },
    text: { color: colors.text.inverse },
  },
  ghost: {
    button: {
      backgroundColor: "transparent",
      borderWidth: 1,
      borderColor: colors.border.default,
    },
    text: { color: colors.text.primary },
  },
} as const;
