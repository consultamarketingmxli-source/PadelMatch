/**
 * RsvpCard — Tarjeta de RSVP para retas gratuitas ("Entre Amigos").
 *
 * Extraído de `/app/retas/[slug].tsx` (Fase 4 — refactor de deuda técnica).
 *
 * El componente es PRESENTACIONAL: toda la lógica (POST a /api/rsvp/*) vive
 * en el componente padre. Aquí solo recibimos estado + handlers por props.
 *
 * Estados que renderiza:
 *   1. Formulario (nombre + teléfono + Aceptar/Rechazar)
 *   2. Resultado "aceptado" (PartyPopper)
 *   3. Resultado "lista_espera" (Hourglass + posición)
 *   4. Resultado "rechazado" (XCircle)
 */
import React from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import {
  Heart,
  PartyPopper,
  Hourglass,
  XCircle,
  CheckCircle2,
} from "lucide-react-native";
import { Input } from "@/src/components/Input";
import { colors, radii, spacing, typography } from "@/src/theme";

export type RsvpResult =
  | null
  | { tipo: "aceptado"; mensaje: string }
  | { tipo: "lista_espera"; mensaje: string; posicion?: number }
  | { tipo: "rechazado"; mensaje: string; promoted?: string | null };

type Props = {
  lleno: boolean;
  nombre: string;
  telefono: string;
  onChangeNombre: (v: string) => void;
  onChangeTelefono: (v: string) => void;
  rsvpAction: "aceptar" | "rechazar" | null;
  onAceptar: () => void;
  onRechazar: () => void;
  rsvpResult: RsvpResult;
  onReset: () => void;
};

export function RsvpCard({
  lleno,
  nombre,
  telefono,
  onChangeNombre,
  onChangeTelefono,
  rsvpAction,
  onAceptar,
  onRechazar,
  rsvpResult,
  onReset,
}: Props) {
  return (
    <View style={styles.rsvpCard} testID="rsvp-card">
      <View style={styles.rsvpBadge}>
        <Heart size={12} color="#047857" />
        <Text style={styles.rsvpBadgeText}>Evento gratuito · sin cargo</Text>
      </View>

      {rsvpResult ? (
        <View style={styles.rsvpStateBox} testID={`rsvp-state-${rsvpResult.tipo}`}>
          {rsvpResult.tipo === "aceptado" ? (
            <>
              <View
                style={[
                  styles.rsvpStateIcon,
                  { backgroundColor: "#ECFDF5", borderColor: "#10B98155" },
                ]}
              >
                <PartyPopper size={28} color="#047857" />
              </View>
              <Text style={[styles.rsvpStateTitle, { color: "#047857" }]}>
                ¡Asistencia confirmada!
              </Text>
              <Text style={styles.rsvpStateMsg}>{rsvpResult.mensaje}</Text>
            </>
          ) : rsvpResult.tipo === "lista_espera" ? (
            <>
              <View
                style={[
                  styles.rsvpStateIcon,
                  { backgroundColor: "#FFFBEB", borderColor: "#F59E0B55" },
                ]}
              >
                <Hourglass size={28} color="#B45309" />
              </View>
              <Text style={[styles.rsvpStateTitle, { color: "#B45309" }]}>
                Quedaste en lista de espera
              </Text>
              <Text style={styles.rsvpStateMsg}>{rsvpResult.mensaje}</Text>
              {rsvpResult.posicion ? (
                <View style={styles.rsvpPosBadge}>
                  <Text style={styles.rsvpPosBadgeText}>Posición #{rsvpResult.posicion}</Text>
                </View>
              ) : null}
            </>
          ) : (
            <>
              <View
                style={[
                  styles.rsvpStateIcon,
                  { backgroundColor: "#F1F5F9", borderColor: colors.border.default },
                ]}
              >
                <XCircle size={28} color={colors.text.secondary} />
              </View>
              <Text style={[styles.rsvpStateTitle, { color: colors.text.primary }]}>
                Respuesta registrada
              </Text>
              <Text style={styles.rsvpStateMsg}>{rsvpResult.mensaje}</Text>
            </>
          )}
          <TouchableOpacity
            onPress={onReset}
            style={styles.rsvpResetBtn}
            testID="rsvp-reset-btn"
          >
            <Text style={styles.rsvpResetBtnText}>Cambiar respuesta</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          <Text style={styles.rsvpTitle}>
            {lleno ? "La reta ya está llena" : "¿Te apuntas?"}
          </Text>
          <Text style={styles.rsvpSubtitle}>
            {lleno
              ? "Puedes registrarte y te dejaremos en lista de espera. Si alguien cancela, te avisamos."
              : "Confirma tu nombre y teléfono. Un toque para aceptar o rechazar la invitación."}
          </Text>

          <Input
            label="Tu nombre completo"
            placeholder="Ej. Andrés Sánchez"
            value={nombre}
            onChangeText={onChangeNombre}
            autoCapitalize="words"
            testID="rsvp-nombre-input"
          />
          <Input
            label="Tu teléfono (WhatsApp)"
            placeholder="+5215512345678"
            value={telefono}
            onChangeText={onChangeTelefono}
            keyboardType="phone-pad"
            testID="rsvp-telefono-input"
          />

          <View style={styles.rsvpBtnRow}>
            <TouchableOpacity
              onPress={onAceptar}
              disabled={rsvpAction !== null}
              activeOpacity={0.85}
              style={[styles.rsvpAcceptBtn, rsvpAction !== null && { opacity: 0.5 }]}
              testID="rsvp-aceptar-btn"
            >
              {rsvpAction === "aceptar" ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <CheckCircle2 size={20} color="#fff" />
                  <Text style={styles.rsvpAcceptBtnText}>
                    {lleno ? "Unirme a lista de espera" : "Aceptar"}
                  </Text>
                </>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              onPress={onRechazar}
              disabled={rsvpAction !== null}
              activeOpacity={0.85}
              style={[styles.rsvpRejectBtn, rsvpAction !== null && { opacity: 0.5 }]}
              testID="rsvp-rechazar-btn"
            >
              {rsvpAction === "rechazar" ? (
                <ActivityIndicator color={colors.text.secondary} />
              ) : (
                <>
                  <XCircle size={18} color={colors.text.secondary} />
                  <Text style={styles.rsvpRejectBtnText}>Rechazar</Text>
                </>
              )}
            </TouchableOpacity>
          </View>

          <Text style={styles.rsvpFinePrint}>
            Sin pagos. Sin cargos ocultos. El organizador te confirmará por WhatsApp.
          </Text>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  rsvpCard: {
    backgroundColor: colors.bg.card,
    borderWidth: 1,
    borderColor: "#10B98140",
    borderRadius: radii.lg,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  rsvpBadge: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radii.sm,
    backgroundColor: "#ECFDF5",
    borderWidth: 1,
    borderColor: "#10B98140",
    marginBottom: spacing.md,
  },
  rsvpBadgeText: {
    color: "#047857",
    fontWeight: "800",
    fontSize: 11,
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  rsvpTitle: { ...typography.h3, color: colors.text.primary, marginBottom: 4 },
  rsvpSubtitle: {
    color: colors.text.secondary,
    fontSize: 13,
    lineHeight: 18,
    marginBottom: spacing.md,
  },
  rsvpBtnRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
  rsvpAcceptBtn: {
    flex: 2,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    minHeight: 52,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    backgroundColor: "#059669",
    boxShadow: "0px 4px 8px rgba(16,185,129,0.25)",
    elevation: 3,
  },
  rsvpAcceptBtnText: { color: "#fff", fontWeight: "900", fontSize: 15, letterSpacing: 0.3 },
  rsvpRejectBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    minHeight: 52,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.md,
    backgroundColor: colors.bg.app,
    borderWidth: 1,
    borderColor: colors.border.default,
  },
  rsvpRejectBtnText: { color: colors.text.secondary, fontWeight: "700", fontSize: 13 },
  rsvpFinePrint: {
    color: colors.text.secondary,
    fontSize: 11,
    textAlign: "center",
    marginTop: spacing.md,
    lineHeight: 16,
  },
  rsvpStateBox: { alignItems: "center", paddingVertical: spacing.md, gap: spacing.sm },
  rsvpStateIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  rsvpStateTitle: { ...typography.h3, fontSize: 18, textAlign: "center" },
  rsvpStateMsg: {
    color: colors.text.secondary,
    fontSize: 13,
    lineHeight: 19,
    textAlign: "center",
    paddingHorizontal: spacing.sm,
  },
  rsvpPosBadge: {
    marginTop: 4,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: radii.md,
    backgroundColor: "#FFFBEB",
    borderWidth: 1,
    borderColor: "#F59E0B55",
  },
  rsvpPosBadgeText: { color: "#B45309", fontWeight: "900", fontSize: 13, letterSpacing: 0.5 },
  rsvpResetBtn: {
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border.default,
    backgroundColor: colors.bg.app,
  },
  rsvpResetBtnText: { color: colors.text.secondary, fontWeight: "700", fontSize: 12 },
});
