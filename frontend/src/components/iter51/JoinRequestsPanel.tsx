/**
 * Iter51 · JoinRequestsPanel
 * ─────────────────────────────────────────────────────────────────────────
 * Panel para el ORGANIZADOR que lista las solicitudes de unión (Open Reta)
 * en estado `pending_approval` y permite aprobar/rechazar con 1 tap.
 *
 * Ubicación de integración: `app/admin/reta/inscripciones/[id].tsx` (arriba
 * del listado principal). Se auto-oculta si no hay solicitudes pendientes.
 *
 * UX:
 *  - Optimistic update: al aprobar/rechazar removemos la row al instante.
 *    Si el backend responde error, la re-insertamos con toast de fallo.
 *  - `Reject` pide motivo (Alert.prompt en iOS, prompt en web, input inline
 *    en Android). Motivo se envía al backend y aparece en el email al jugador.
 *  - Estados: skeleton mientras carga · empty state · error banner.
 *  - Estilos siguen paleta iter50 (colors.brand.primary · shadows.card).
 */
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Check, RefreshCw, UserCheck, UserX, X } from "lucide-react-native";

import { api } from "@/src/api";
import { colors, radii, shadows, spacing, typography } from "@/src/theme";

type JoinRequest = {
  id: string;
  match_id: string;
  player_id: string;
  player_name: string;
  payer_email: string;
  payer_phone: string;
  payment_id: string;
  amount: number;
  status: "pending_approval" | "approved" | "rejected" | "expired" | "failed";
  created_at: string;
};

export function JoinRequestsPanel({ retaId }: { retaId: string }) {
  const [items, setItems] = useState<JoinRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rejectModal, setRejectModal] = useState<{ id: string; player: string } | null>(null);
  const [rejectMotivo, setRejectMotivo] = useState("");

  const load = useCallback(async () => {
    try {
      setError(null);
      const r = await api.listJoinRequests(retaId, "pending_approval");
      setItems(r.items as JoinRequest[]);
    } catch (e: any) {
      setError(e?.message || "No se pudieron cargar las solicitudes.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [retaId]);

  useEffect(() => {
    void load();
  }, [load]);

  const refresh = useCallback(() => {
    setRefreshing(true);
    void load();
  }, [load]);

  const doDecide = useCallback(
    async (req: JoinRequest, action: "approve" | "reject", motivo?: string) => {
      setBusyId(req.id);
      // Optimistic: quitar de la lista.
      const snapshot = items;
      setItems((prev) => prev.filter((x) => x.id !== req.id));
      try {
        const res = await api.decideJoinRequest({
          request_id: req.id,
          action,
          motivo: motivo?.trim() || undefined,
        });
        if (res.success) {
          Alert.alert(
            action === "approve" ? "¡Aprobado!" : "Solicitud rechazada",
            action === "approve"
              ? `Cobramos $${req.amount.toFixed(2)} MXN a ${req.player_name}. Su cupo está confirmado.`
              : `Se liberó la retención en la tarjeta de ${req.player_name}. Sin cargo (0% comisión).`,
          );
        } else {
          throw new Error("Respuesta inesperada del servidor.");
        }
      } catch (e: any) {
        // Rollback local + mostrar error.
        setItems(snapshot);
        const msg = e?.message || "No se pudo procesar.";
        if (msg.includes("409") || /llen[ao]/i.test(msg)) {
          Alert.alert(
            "La reta se llenó",
            "Alguien tomó el último cupo antes de que aprobaras. La retención se liberó automáticamente.",
          );
          void load(); // refrescamos para reflejar estado real
        } else {
          Alert.alert("Error", msg);
        }
      } finally {
        setBusyId(null);
      }
    },
    [items, load],
  );

  const onApprove = useCallback(
    (req: JoinRequest) => {
      Alert.alert(
        "Aprobar solicitud",
        `Se cobrará $${req.amount.toFixed(2)} MXN a ${req.player_name} y ocupará 1 cupo de la reta. ¿Confirmas?`,
        [
          { text: "Cancelar", style: "cancel" },
          { text: "Sí, aprobar", onPress: () => doDecide(req, "approve") },
        ],
      );
    },
    [doDecide],
  );

  const onReject = useCallback((req: JoinRequest) => {
    setRejectMotivo("");
    setRejectModal({ id: req.id, player: req.player_name });
  }, []);

  const confirmReject = useCallback(() => {
    if (!rejectModal) return;
    const target = items.find((x) => x.id === rejectModal.id);
    if (!target) {
      setRejectModal(null);
      return;
    }
    const motivo = rejectMotivo.trim() || "El organizador no pudo confirmar tu lugar en esta ocasión.";
    setRejectModal(null);
    void doDecide(target, "reject", motivo);
  }, [rejectModal, rejectMotivo, items, doDecide]);

  // Skeleton mientras carga (primera vez).
  if (loading) {
    return (
      <View style={s.card}>
        <ActivityIndicator size="small" color={colors.brand.primary} />
      </View>
    );
  }

  // Error banner con retry.
  if (error) {
    return (
      <View style={[s.card, s.errorCard]}>
        <Text style={s.errorTitle}>Error cargando solicitudes</Text>
        <Text style={s.errorSub}>{error}</Text>
        <TouchableOpacity style={s.retryBtn} onPress={refresh}>
          <RefreshCw size={14} color={colors.brand.primary} />
          <Text style={s.retryBtnText}>Reintentar</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Empty state — sólo lo renderizamos si no hay items (permitimos ocultarnos
  // completamente para no ensuciar la UI si el organizador no usa Open Reta).
  if (items.length === 0) return null;

  return (
    <View style={s.card}>
      <View style={s.header}>
        <View style={s.badge}>
          <Text style={s.badgeText}>{items.length}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.title}>
            Solicitud{items.length === 1 ? "" : "es"} pendiente{items.length === 1 ? "" : "s"}
          </Text>
          <Text style={s.sub}>Jugadores con fondos retenidos esperando tu decisión</Text>
        </View>
        <TouchableOpacity onPress={refresh} disabled={refreshing} style={s.refreshBtn} testID="joinreq-refresh">
          {refreshing ? (
            <ActivityIndicator size="small" color={colors.text.secondary} />
          ) : (
            <RefreshCw size={16} color={colors.text.secondary} />
          )}
        </TouchableOpacity>
      </View>

      <View style={{ marginTop: spacing.sm }}>
        {items.map((req) => (
          <JoinRequestRow
            key={req.id}
            req={req}
            busy={busyId === req.id}
            onApprove={() => onApprove(req)}
            onReject={() => onReject(req)}
          />
        ))}
      </View>

      <View style={s.disclaimerBox}>
        <Text style={s.disclaimerText}>
          🔒 Los fondos están <Text style={s.disclaimerBold}>retenidos</Text> (no cobrados) hasta tu decisión.
          Si rechazas o expiran 2 h antes del partido, se liberan al 100% (0% comisión).
        </Text>
      </View>

      {/* Modal para capturar motivo de rechazo. */}
      <Modal
        visible={!!rejectModal}
        transparent
        animationType="fade"
        onRequestClose={() => setRejectModal(null)}
      >
        <Pressable style={s.modalBackdrop} onPress={() => setRejectModal(null)}>
          <Pressable style={s.modalCard} onPress={(e) => e.stopPropagation()}>
            <Text style={s.modalTitle}>Motivo del rechazo</Text>
            <Text style={s.modalSub}>
              Este mensaje se enviará por email a {rejectModal?.player ?? "el jugador"}.
              Opcional — si lo dejas vacío usamos un mensaje neutro.
            </Text>
            <TextInput
              value={rejectMotivo}
              onChangeText={setRejectMotivo}
              placeholder="Ej. Reta llena · no cumple nivel · ya jugaste antes conmigo…"
              placeholderTextColor={colors.text.tertiary}
              multiline
              numberOfLines={3}
              maxLength={240}
              style={s.modalInput}
              testID="joinreq-motivo-input"
            />
            <View style={s.modalFooter}>
              <TouchableOpacity style={s.btnSecondary} onPress={() => setRejectModal(null)}>
                <Text style={s.btnSecondaryText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.btnPrimary, { backgroundColor: colors.status.red }]}
                onPress={confirmReject}
                testID="joinreq-motivo-confirm"
              >
                <Text style={s.btnPrimaryText}>Rechazar y liberar</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

function JoinRequestRow({
  req,
  busy,
  onApprove,
  onReject,
}: {
  req: JoinRequest;
  busy: boolean;
  onApprove: () => void;
  onReject: () => void;
}) {
  const fecha = new Date(req.created_at);
  const fechaStr = fecha.toLocaleString("es-MX", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <View style={s.row}>
      <View style={{ flex: 1 }}>
        <Text style={s.rowName} numberOfLines={1}>
          {req.player_name}
        </Text>
        <Text style={s.rowMeta} numberOfLines={1}>
          {req.payer_email || req.payer_phone || "sin contacto"} · Solicitó {fechaStr}
        </Text>
        <View style={s.rowAmountPill}>
          <Text style={s.rowAmountText}>${req.amount.toFixed(2)} MXN retenidos</Text>
        </View>
      </View>
      <View style={s.rowActions}>
        <TouchableOpacity
          style={[s.actionBtn, s.rejectBtn, busy && s.disabled]}
          onPress={onReject}
          disabled={busy}
          testID={`joinreq-reject-${req.id}`}
        >
          {busy ? (
            <ActivityIndicator size="small" color={colors.status.red} />
          ) : (
            <>
              <X size={14} color={colors.status.red} />
              <Text style={s.rejectBtnText}>Rechazar</Text>
            </>
          )}
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.actionBtn, s.approveBtn, busy && s.disabled]}
          onPress={onApprove}
          disabled={busy}
          testID={`joinreq-approve-${req.id}`}
        >
          {busy ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <>
              <Check size={14} color="#fff" />
              <Text style={s.approveBtnText}>Aceptar</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: colors.bg.card,
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: "rgba(59,130,246,0.20)",
    ...shadows.card,
  },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  badge: {
    minWidth: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.brand.primary,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 8,
  },
  badgeText: { color: "#fff", fontWeight: "800", fontSize: 15 },
  title: {
    ...typography.body,
    fontWeight: "800",
    color: colors.text.primary,
    letterSpacing: -0.2,
  },
  sub: {
    ...typography.caption,
    color: colors.text.secondary,
    marginTop: 2,
  },
  refreshBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: colors.bg.elevated,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: "#F1F5F9",
  },
  rowName: {
    ...typography.body,
    fontWeight: "700",
    color: colors.text.primary,
  },
  rowMeta: {
    ...typography.caption,
    color: colors.text.tertiary,
    marginTop: 2,
    fontSize: 11,
  },
  rowAmountPill: {
    alignSelf: "flex-start",
    marginTop: 6,
    backgroundColor: "rgba(59,130,246,0.10)",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  rowAmountText: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.brand.primary,
    fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }),
  },
  rowActions: { flexDirection: "row", gap: 6, marginLeft: spacing.sm },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    minHeight: 34,
    minWidth: 78,
    justifyContent: "center",
  },
  approveBtn: { backgroundColor: colors.status.green },
  approveBtnText: { color: "#fff", fontWeight: "800", fontSize: 12 },
  rejectBtn: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: colors.status.red,
  },
  rejectBtnText: { color: colors.status.red, fontWeight: "800", fontSize: 12 },
  disabled: { opacity: 0.5 },
  disclaimerBox: {
    marginTop: spacing.sm,
    backgroundColor: "#F0FDF4",
    borderLeftWidth: 3,
    borderLeftColor: "#10B981",
    padding: 10,
    borderRadius: 8,
  },
  disclaimerText: {
    ...typography.caption,
    color: "#065F46",
    lineHeight: 17,
  },
  disclaimerBold: { fontWeight: "800" },
  // Error state
  errorCard: {
    backgroundColor: "#FEF2F2",
    borderColor: "#FECACA",
  },
  errorTitle: { ...typography.body, fontWeight: "700", color: "#991B1B" },
  errorSub: { ...typography.caption, color: "#7F1D1D", marginTop: 4 },
  retryBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: spacing.sm,
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: colors.brand.primary,
  },
  retryBtnText: { color: colors.brand.primary, fontWeight: "700", fontSize: 12 },
  // Modal reject motivo
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(15,23,42,0.55)",
    justifyContent: "center",
    padding: spacing.lg,
  },
  modalCard: {
    backgroundColor: "#fff",
    borderRadius: radii.lg,
    padding: spacing.lg,
    ...shadows.card,
  },
  modalTitle: {
    ...typography.h3,
    fontWeight: "800",
    color: colors.text.primary,
    marginBottom: 6,
  },
  modalSub: {
    ...typography.caption,
    color: colors.text.secondary,
    marginBottom: spacing.md,
    lineHeight: 18,
  },
  modalInput: {
    borderWidth: 1,
    borderColor: "#E2E8F0",
    borderRadius: radii.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: colors.text.primary,
    backgroundColor: "#F8FAFC",
    minHeight: 78,
    textAlignVertical: "top",
  },
  modalFooter: {
    flexDirection: "row",
    gap: 10,
    marginTop: spacing.md,
  },
  btnPrimary: {
    flex: 1,
    backgroundColor: colors.brand.primary,
    paddingVertical: 13,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 46,
  },
  btnPrimaryText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  btnSecondary: {
    flex: 1,
    backgroundColor: "#F1F5F9",
    paddingVertical: 13,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 46,
  },
  btnSecondaryText: { color: colors.text.secondary, fontWeight: "700", fontSize: 14 },
});

// Re-export lucide icons so importer can rely on them if needed later.
export { UserCheck, UserX };
