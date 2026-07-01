/**
 * Iter51-P2 · OpenRetaHabilitadoToggle
 * ─────────────────────────────────────────────────────────────────────────
 * Toggle nativo (Switch) para que el organizador habilite / deshabilite la
 * modalidad "Open Reta" (solicitudes de unión con pre-autorización de pago).
 *
 * UX:
 *  - Reutiliza el estilo del `PermitirPagoCanchaToggle` de iter50 (misma tarjeta).
 *  - Optimistic update: el `onChange` se llama con el nuevo valor de inmediato;
 *    el `save()` del formulario padre persiste al backend.
 *  - Label + descripción alineados con la solicitud del arquitecto:
 *      "Permitir solicitudes de unión (Open Reta)"
 *      "Permite que jugadores fuera de tus grupos soliciten unirse mediante
 *       garantía de pago pre-autorizada".
 */
import React from "react";
import { StyleSheet, Switch, Text, View } from "react-native";
import { ShieldCheck } from "lucide-react-native";

import { colors, radii, spacing, typography } from "@/src/theme";

export function OpenRetaHabilitadoToggle({
  value,
  onChange,
  disabled,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <View style={[s.card, disabled && s.disabled]}>
      <View style={s.row}>
        <View style={{ flex: 1, paddingRight: spacing.md }}>
          <View style={s.header}>
            <ShieldCheck size={16} color={colors.brand.primary} />
            <Text style={s.label}>Permitir solicitudes de unión (Open Reta)</Text>
          </View>
          <Text style={s.hint}>
            Permite que jugadores fuera de tus grupos soliciten unirse mediante
            garantía de pago pre-autorizada. Tú apruebas o rechazas cada
            solicitud desde el panel de Inscripciones.
          </Text>
        </View>
        <Switch
          value={value}
          onValueChange={onChange}
          disabled={disabled}
          trackColor={{ false: "#CBD5E1", true: colors.brand.primary }}
          thumbColor="#fff"
          ios_backgroundColor="#CBD5E1"
          testID="switch-open-reta-habilitado"
        />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: colors.bg.card,
    borderRadius: radii.md,
    padding: spacing.md,
    marginTop: spacing.md,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  disabled: { opacity: 0.5 },
  row: { flexDirection: "row", alignItems: "center" },
  header: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 },
  label: {
    ...typography.body,
    fontWeight: "700",
    color: colors.text.primary,
    letterSpacing: -0.2,
    flexShrink: 1,
  },
  hint: {
    ...typography.caption,
    color: colors.text.secondary,
    lineHeight: 17,
  },
});
