/** WaitlistFullModal — Fase 5 (Sección 2) "Anti-Oversell".
 *
 * Se muestra cuando el checkout intenta reservar un cupo y el backend
 * responde 409 "Reta llena" (race condition / sold-out concurrente).
 *
 * Reglas UX:
 *  - Mensaje claro: "Justo se llenó mientras pagabas".
 *  - Ofrece sumarse a la lista de espera con 1 clic (reusa nombre/teléfono).
 *  - Indica que recibirá WhatsApp si se libera cupo.
 *
 * Este componente NO hace la llamada: el padre la maneja, así sigue siendo
 * presentacional y testeable.
 */
import React from "react";
import {
  ActivityIndicator,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Clock, Users, X } from "lucide-react-native";
import { colors, radii, shadows, spacing, typography } from "@/src/theme";

export type WaitlistFullModalProps = {
  visible: boolean;
  retaNombre?: string;
  /** Cuando true muestra spinner en el botón primario y bloquea acciones. */
  loading?: boolean;
  /** Si se muestra el flow de pareja (dúo). Cambia el copy. */
  esDuo?: boolean;
  onConfirm: () => void;
  onClose: () => void;
};

export function WaitlistFullModal({
  visible,
  retaNombre,
  loading,
  esDuo,
  onConfirm,
  onClose,
}: WaitlistFullModalProps) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={loading ? undefined : onClose}
    >
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <TouchableOpacity
            onPress={onClose}
            disabled={loading}
            style={styles.closeBtn}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            testID="waitlist-modal-close"
          >
            <X size={18} color={colors.text.muted} />
          </TouchableOpacity>

          <View style={styles.iconBubble}>
            <Users size={28} color={colors.brand.primary} />
          </View>

          <Text style={styles.title}>¡Ups! Justo se llenó</Text>
          <Text style={styles.subtitle}>
            Otra persona reservó el último cupo
            {esDuo ? " (o los últimos cupos disponibles para dúo)" : ""} mientras
            intentabas pagar
            {retaNombre ? ` ${retaNombre}` : ""}. Tu lugar fue liberado y no se
            cobró nada.
          </Text>

          <View style={styles.infoRow}>
            <Clock size={14} color={colors.text.secondary} />
            <Text style={styles.infoText}>
              Si alguien rechaza o no completa su pago, te avisamos por WhatsApp
              en orden de llegada.
            </Text>
          </View>

          <TouchableOpacity
            onPress={onConfirm}
            disabled={loading}
            style={[styles.primaryBtn, loading && { opacity: 0.7 }]}
            activeOpacity={0.85}
            testID="waitlist-modal-confirm"
          >
            {loading ? (
              <ActivityIndicator color={colors.text.inverse} size="small" />
            ) : (
              <Text style={styles.primaryBtnText}>Sumarme a la lista de espera</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            onPress={onClose}
            disabled={loading}
            style={styles.secondaryBtn}
            activeOpacity={0.7}
            testID="waitlist-modal-cancel"
          >
            <Text style={styles.secondaryBtnText}>Ahora no</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.55)",
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.lg,
  },
  card: {
    width: "100%",
    maxWidth: 420,
    backgroundColor: colors.surface.card,
    borderRadius: radii.lg,
    padding: spacing.lg,
    alignItems: "center",
    ...shadows.lg,
  },
  closeBtn: {
    position: "absolute",
    top: spacing.sm,
    right: spacing.sm,
    padding: 6,
    zIndex: 2,
  },
  iconBubble: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "rgba(37, 99, 235, 0.10)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.md,
  },
  title: {
    ...typography.h3,
    color: colors.text.primary,
    textAlign: "center",
    marginBottom: spacing.xs,
  },
  subtitle: {
    ...typography.body,
    color: colors.text.secondary,
    textAlign: "center",
    marginBottom: spacing.md,
    lineHeight: 20,
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    backgroundColor: colors.surface.subtle,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 10,
    marginBottom: spacing.lg,
  },
  infoText: {
    ...typography.bodySm,
    color: colors.text.secondary,
    flex: 1,
    lineHeight: 18,
  },
  primaryBtn: {
    width: "100%",
    backgroundColor: colors.brand.primary,
    borderRadius: radii.md,
    paddingVertical: 14,
    alignItems: "center",
    ...shadows.sm,
  },
  primaryBtnText: {
    ...typography.button,
    color: colors.text.inverse,
    fontWeight: "800",
  },
  secondaryBtn: {
    width: "100%",
    paddingVertical: 12,
    alignItems: "center",
    marginTop: spacing.xs,
  },
  secondaryBtnText: {
    ...typography.bodySm,
    color: colors.text.muted,
    fontWeight: "600",
  },
});
