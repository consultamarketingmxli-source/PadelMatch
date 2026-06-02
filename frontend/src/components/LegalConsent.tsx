/**
 * LegalConsent — Microcopy de consentimiento subyacente a los botones de login.
 *
 * Convención UX (Location A del spec):
 *   - Container suave (no rompe jerarquía visual) — fondo neutro 50, borde 100.
 *   - Texto en gris medio.
 *   - "Términos de Servicio" y "Política de Privacidad" como hyperlinks azules
 *     (color de acción primario) que abren las pantallas legales internas.
 *   - Tap area en cada link >= 44pt vertical.
 *
 * Modos:
 *   - implicit (default) — micro-copy "Al crear una cuenta, aceptas..."
 *   - checkbox — muestra checkbox explícito (requerido en jurisdicciones GDPR).
 */
import React, { useState } from "react";
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { Check } from "lucide-react-native";

import { colors } from "@/src/theme";

type Props = {
  /** "implicit" muestra solo la frase con links; "checkbox" agrega control. */
  mode?: "implicit" | "checkbox";
  /** Callback al cambiar checkbox (solo en mode="checkbox"). */
  onChange?: (checked: boolean) => void;
  /** Valor controlado del checkbox (solo en mode="checkbox"). */
  value?: boolean;
  /** Texto inicial. Default: "Al crear una cuenta, aceptas nuestros". */
  intro?: string;
  /** Si true, ajusta dark mode. */
  dark?: boolean;
};

export function LegalConsent({
  mode = "implicit",
  onChange,
  value,
  intro,
  dark = false,
}: Props) {
  const router = useRouter();
  const [internalChecked, setInternalChecked] = useState(false);
  const isControlled = typeof value === "boolean";
  const checked = isControlled ? value : internalChecked;

  const handleToggle = () => {
    const next = !checked;
    if (!isControlled) setInternalChecked(next);
    onChange?.(next);
  };

  const palette = dark
    ? {
        container: "rgba(255,255,255,0.05)",
        border: "rgba(255,255,255,0.12)",
        text: "#CBD5E1",
        link: "#93C5FD",
      }
    : {
        container: "#F1F5F9",
        border: "#E2E8F0",
        text: "#475569",
        link: colors.brand?.primary ?? "#1E40AF",
      };

  const introText =
    intro ??
    (mode === "checkbox"
      ? "Acepto los "
      : "Al crear una cuenta o iniciar sesión, aceptas nuestros ");

  const goTerms = () => router.push("/legal/terms" as any);
  const goPrivacy = () => router.push("/legal/privacy" as any);

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: palette.container, borderColor: palette.border },
      ]}
    >
      {mode === "checkbox" && (
        <Pressable
          onPress={handleToggle}
          hitSlop={10}
          accessibilityRole="checkbox"
          accessibilityState={{ checked }}
          style={[
            styles.checkbox,
            {
              backgroundColor: checked ? palette.link : "transparent",
              borderColor: checked ? palette.link : palette.border,
            },
          ]}
        >
          {checked ? <Check size={14} color="#FFFFFF" strokeWidth={3} /> : null}
        </Pressable>
      )}

      <Text style={[styles.text, { color: palette.text }]}>
        {introText}
        <Text
          onPress={goTerms}
          style={[styles.link, { color: palette.link }]}
          accessibilityRole="link"
        >
          Términos de Servicio
        </Text>
        <Text style={[styles.text, { color: palette.text }]}> y </Text>
        <Text
          onPress={goPrivacy}
          style={[styles.link, { color: palette.link }]}
          accessibilityRole="link"
        >
          Política de Privacidad
        </Text>
        <Text style={[styles.text, { color: palette.text }]}>.</Text>
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: 12,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 5,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
  text: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
    fontFamily: Platform.select({
      web: "Inter, system-ui, -apple-system, sans-serif",
      default: undefined,
    }) as string,
  },
  link: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "700",
    textDecorationLine: "underline",
  },
});
