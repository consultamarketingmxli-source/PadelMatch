/**
 * RecalcularRondasModal — Fase D, Hito 3 UI.
 *
 * Permite al admin recalcular las rondas FUTURAS de un torneo en curso,
 * preservando las rondas con marcadores ya guardados.
 *
 * Flujo UX:
 *   1. Lista todos los jugadores activos con checkbox.
 *   2. Admin marca quién se excluye (lesión, no presentado, etc.).
 *   3. Tap "Vista previa" → invoca POST /rol/recalcular-pendientes.
 *   4. Muestra:
 *      • Resumen: # rondas bloqueadas, # recalculadas, badge optimización.
 *      • Lista de rondas con etiqueta (Bloqueada — con score / Recalculada).
 *   5. El admin puede cerrar y volver a la mesa de control (la pantalla
 *      principal se refrescará vía `onApplied`).
 *
 * Robustez:
 *   • Confirmación antes de aplicar (confirmDialog).
 *   • Manejo de 409 (pocos jugadores) y errores genéricos.
 *   • No persiste datos — el cambio se materializa cuando el admin guarda
 *     los próximos scores (los partidos ya se generaron con el nuevo
 *     ordenamiento desde el backend, así que se "aplican" naturalmente).
 */
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import {
  AlertTriangle,
  CheckCircle2,
  Lock,
  RefreshCw,
  Users,
  X as XIcon,
} from "lucide-react-native";

import { api } from "@/src/api";
import { FixtureMetadataBadge } from "@/src/components/FixtureMetadataBadge";
import { confirmDialog, notifyDialog } from "@/src/utils/confirmDialog";
import { colors, radii, spacing, typography } from "@/src/theme";

interface Props {
  visible: boolean;
  retaId: string;
  jugadores: string[];
  onClose: () => void;
  /** Se llama después de un recálculo exitoso para refrescar la vista padre. */
  onApplied?: () => void;
}

export function RecalcularRondasModal({
  visible,
  retaId,
  jugadores,
  onClose,
  onApplied,
}: Props) {
  const [excluidos, setExcluidos] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<Awaited<
    ReturnType<typeof api.recalcularRondasPendientes>
  > | null>(null);

  // Reset al abrir.
  useEffect(() => {
    if (visible) {
      setExcluidos(new Set());
      setPreview(null);
    }
  }, [visible]);

  const toggle = (n: string) => {
    setExcluidos((prev) => {
      const next = new Set(prev);
      if (next.has(n)) next.delete(n);
      else next.add(n);
      return next;
    });
    setPreview(null); // invalidar preview al cambiar selección
  };

  const numActivos = jugadores.length - excluidos.size;
  const puedeRecalcular = numActivos >= 4;

  const handlePreview = async () => {
    setLoading(true);
    try {
      const res = await api.recalcularRondasPendientes(
        retaId,
        Array.from(excluidos),
      );
      setPreview(res);
    } catch (e: any) {
      const msg = e?.message ?? "No se pudo calcular el recálculo";
      if (msg.includes("409") || msg.toLowerCase().includes("activos")) {
        await notifyDialog(
          "Muy pocos jugadores",
          "Necesitas al menos 4 jugadores activos. Reduce las exclusiones.",
        );
      } else {
        await notifyDialog("Error", msg);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleAplicar = async () => {
    if (!preview) return;
    const ok = await confirmDialog({
      title: "Aplicar recálculo",
      message:
        `Se recalcularán ${preview.rondas_pendientes_recalculadas} ronda(s) pendiente(s). ` +
        `Las ${preview.rondas_bloqueadas.length} rondas con marcador guardado permanecerán intactas.\n\n` +
        `¿Continuar?`,
      confirmText: "Aplicar",
      cancelText: "Cancelar",
    });
    if (!ok) return;
    // El recálculo es no destructivo en backend (no persiste hasta capturar
    // nuevos resultados). Simplemente cerramos y refrescamos.
    onApplied?.();
    onClose();
  };

  const totalRondas = useMemo(() => {
    if (!preview) return 0;
    return preview.rol_actualizado.reduce(
      (acc, c) => acc + c.rondas.length,
      0,
    );
  }, [preview]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          {/* Header */}
          <View style={styles.header}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flex: 1 }}>
              <RefreshCw size={18} color={colors.brand.primary} />
              <Text style={styles.title}>Recalcular rondas pendientes</Text>
            </View>
            <TouchableOpacity onPress={onClose} hitSlop={6} testID="recalcular-close">
              <XIcon size={20} color={colors.text.secondary} />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
            {/* Descripción */}
            <Text style={styles.desc}>
              Excluye a los jugadores que no continuarán (lesión, no se presentó, etc.).
              Las rondas con marcadores guardados se respetarán; las futuras se
              redistribuirán manteniendo la igualdad de partidos.
            </Text>

            {/* Lista de jugadores */}
            <View style={styles.section}>
              <View style={styles.sectionHead}>
                <Users size={14} color={colors.text.secondary} />
                <Text style={styles.sectionTitle}>
                  Jugadores ({numActivos} activos / {jugadores.length})
                </Text>
              </View>
              {jugadores.map((j) => {
                const excluido = excluidos.has(j);
                return (
                  <Pressable
                    key={j}
                    onPress={() => toggle(j)}
                    style={[
                      styles.playerRow,
                      excluido && styles.playerRowExcluido,
                    ]}
                    testID={`recalc-toggle-${j}`}
                  >
                    <Text
                      style={[
                        styles.playerName,
                        excluido && styles.playerNameExcluido,
                      ]}
                      numberOfLines={1}
                    >
                      {j}
                    </Text>
                    <View
                      style={[
                        styles.checkbox,
                        excluido && styles.checkboxExcluido,
                      ]}
                    >
                      {excluido ? <XIcon size={12} color="#fff" /> : null}
                    </View>
                  </Pressable>
                );
              })}
              {numActivos < 4 ? (
                <View style={styles.warning}>
                  <AlertTriangle size={12} color="#b91c1c" />
                  <Text style={styles.warningTxt}>
                    Mínimo 4 jugadores activos requeridos.
                  </Text>
                </View>
              ) : null}
            </View>

            {/* Botón preview */}
            <TouchableOpacity
              onPress={handlePreview}
              disabled={!puedeRecalcular || loading}
              style={[
                styles.primaryBtn,
                (!puedeRecalcular || loading) && { opacity: 0.5 },
              ]}
              testID="recalc-preview"
            >
              {loading ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <>
                  <RefreshCw size={14} color="#fff" />
                  <Text style={styles.primaryBtnTxt}>
                    Vista previa del recálculo
                  </Text>
                </>
              )}
            </TouchableOpacity>

            {/* Preview */}
            {preview ? (
              <View style={styles.previewWrap}>
                {/* Resumen */}
                <View style={styles.summaryRow}>
                  <View style={styles.summaryItem}>
                    <Text style={styles.summaryNum}>{preview.rondas_bloqueadas.length}</Text>
                    <Text style={styles.summaryLabel}>bloqueadas</Text>
                  </View>
                  <View style={styles.summaryDivider} />
                  <View style={styles.summaryItem}>
                    <Text style={styles.summaryNum}>{preview.rondas_pendientes_recalculadas}</Text>
                    <Text style={styles.summaryLabel}>recalculadas</Text>
                  </View>
                  <View style={styles.summaryDivider} />
                  <View style={styles.summaryItem}>
                    <Text style={styles.summaryNum}>{totalRondas}</Text>
                    <Text style={styles.summaryLabel}>total</Text>
                  </View>
                </View>

                {/* Metadata badge si aplica */}
                <FixtureMetadataBadge metadata={preview.fixture_metadata} />

                {/* Listado de rondas por cancha */}
                {preview.rol_actualizado.map((c) => (
                  <View key={c.cancha} style={styles.canchaWrap}>
                    <Text style={styles.canchaTitle}>Cancha {c.cancha}</Text>
                    {c.rondas.map((r) => (
                      <View
                        key={`${c.cancha}-${r.ronda}`}
                        style={[
                          styles.rondaRow,
                          r.bloqueada && styles.rondaRowBloqueada,
                        ]}
                      >
                        <View style={styles.rondaIcon}>
                          {r.bloqueada ? (
                            <Lock size={11} color="#92400e" />
                          ) : (
                            <CheckCircle2 size={11} color={colors.brand.primary} />
                          )}
                        </View>
                        <Text style={styles.rondaTxt}>
                          R{r.ronda} · {r.partidos.length} partido{r.partidos.length !== 1 ? "s" : ""}
                        </Text>
                        <Text
                          style={[
                            styles.rondaBadge,
                            r.bloqueada ? styles.rondaBadgeBloqueada : styles.rondaBadgeNueva,
                          ]}
                        >
                          {r.bloqueada ? "Bloqueada" : "Recalculada"}
                        </Text>
                      </View>
                    ))}
                  </View>
                ))}

                {/* Botón aplicar */}
                <TouchableOpacity
                  onPress={handleAplicar}
                  style={styles.applyBtn}
                  testID="recalc-apply"
                >
                  <CheckCircle2 size={14} color="#fff" />
                  <Text style={styles.applyBtnTxt}>
                    Aplicar y volver a Mesa de Control
                  </Text>
                </TouchableOpacity>
              </View>
            ) : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: "#fff",
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    maxHeight: "92%",
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingBottom: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border.light,
    marginBottom: spacing.md,
  },
  title: {
    fontSize: typography.md,
    fontWeight: "700",
    color: colors.text.primary,
  },
  desc: {
    fontSize: typography.sm,
    color: colors.text.secondary,
    lineHeight: 19,
    marginBottom: spacing.md,
  },
  section: { marginBottom: spacing.md },
  sectionHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: typography.sm,
    fontWeight: "700",
    color: colors.text.primary,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  playerRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.border.light,
    marginBottom: 6,
    backgroundColor: "#fff",
  },
  playerRowExcluido: {
    backgroundColor: "#fee2e2",
    borderColor: "#fca5a5",
  },
  playerName: {
    flex: 1,
    fontSize: typography.sm,
    color: colors.text.primary,
    fontWeight: "600",
    fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }),
  },
  playerNameExcluido: {
    color: "#7f1d1d",
    textDecorationLine: "line-through",
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.border.light,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxExcluido: {
    borderColor: "#dc2626",
    backgroundColor: "#dc2626",
  },
  warning: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 8,
    padding: 8,
    backgroundColor: "#fee2e2",
    borderRadius: radii.sm,
  },
  warningTxt: { color: "#b91c1c", fontSize: typography.xs, fontWeight: "600" },
  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: colors.brand.primary,
    paddingVertical: 14,
    borderRadius: radii.md,
    marginTop: spacing.sm,
  },
  primaryBtnTxt: { color: "#fff", fontWeight: "700", fontSize: typography.sm },
  previewWrap: { marginTop: spacing.md, gap: spacing.sm },
  summaryRow: {
    flexDirection: "row",
    backgroundColor: "#f1f5f9",
    borderRadius: radii.md,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  summaryItem: { flex: 1, alignItems: "center" },
  summaryDivider: {
    width: StyleSheet.hairlineWidth,
    backgroundColor: colors.border.light,
  },
  summaryNum: {
    fontSize: 20,
    fontWeight: "800",
    color: colors.text.primary,
    fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }),
  },
  summaryLabel: {
    fontSize: typography.xs,
    color: colors.text.secondary,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginTop: 2,
  },
  canchaWrap: { gap: 4, marginTop: 6 },
  canchaTitle: {
    fontSize: typography.xs,
    fontWeight: "700",
    color: colors.text.secondary,
    textTransform: "uppercase",
    letterSpacing: 0.7,
    marginTop: 8,
  },
  rondaRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: radii.sm,
    backgroundColor: "#f8fafc",
    gap: 8,
  },
  rondaRowBloqueada: { backgroundColor: "#fef3c7" },
  rondaIcon: { width: 16, alignItems: "center" },
  rondaTxt: {
    flex: 1,
    fontSize: typography.sm,
    color: colors.text.primary,
    fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }),
  },
  rondaBadge: {
    fontSize: 10,
    fontWeight: "700",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    overflow: "hidden",
    textTransform: "uppercase",
  },
  rondaBadgeBloqueada: { backgroundColor: "#fde68a", color: "#78350f" },
  rondaBadgeNueva: { backgroundColor: "#dbeafe", color: "#1e3a8a" },
  applyBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#16a34a",
    paddingVertical: 14,
    borderRadius: radii.md,
    marginTop: spacing.md,
  },
  applyBtnTxt: { color: "#fff", fontWeight: "700", fontSize: typography.sm },
});
