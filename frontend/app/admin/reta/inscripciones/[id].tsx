/**
 * Inscripciones de una reta — vista dual:
 *  • Si `tipo_acceso = "gratis_amigos"` → 3 columnas RSVP
 *      (Confirmados / Pendientes / Lista de espera) con botones de override manual.
 *  • Si NO → lista legacy con acción de reembolso.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  ArrowLeft,
  RotateCcw,
  CheckCircle2,
  Clock,
  Upload,
  XCircle,
  Hourglass,
  MoreHorizontal,
  UserCheck,
  UserX,
  Heart,
} from "lucide-react-native";

import { Inscripcion, Reta, api } from "@/src/api";
import { ImportarJugadoresModal } from "@/src/components/ImportarJugadoresModal";
import { colors, radii, spacing, typography } from "@/src/theme";

type EstatusConfirm =
  | "pendiente_invitacion"
  | "aceptado"
  | "rechazado"
  | "lista_espera";

type AsistenciaItem = {
  id: string;
  nombre: string;
  telefono: string;
  estatus_confirmacion: EstatusConfirm;
  estatus_pago: string;
  metodo_pago?: string;
  creado_en?: string;
};

const estatusInfo = (s: string) => {
  if (s === "Aprobado") return { color: colors.status.green, icon: <CheckCircle2 size={14} color={colors.status.green} />, label: "Pagado" };
  if (s === "Pendiente") return { color: colors.status.amber, icon: <Clock size={14} color={colors.status.amber} />, label: "Pendiente" };
  return { color: colors.status.red, icon: <XCircle size={14} color={colors.status.red} />, label: s };
};

export default function AdminInscripciones() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [reta, setReta] = useState<Reta | null>(null);
  const [items, setItems] = useState<Inscripcion[]>([]);
  const [asistencia, setAsistencia] = useState<{
    confirmados: AsistenciaItem[];
    pendientes: AsistenciaItem[];
    lista_espera: AsistenciaItem[];
    rechazados: AsistenciaItem[];
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [refunding, setRefunding] = useState<string | null>(null);
  const [movingId, setMovingId] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const esGratisAmigos = reta?.tipo_acceso === "gratis_amigos";

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const r = await api.getRetaAdmin(id);
      setReta(r);
      if (r.tipo_acceso === "gratis_amigos") {
        const a = await api.getAsistencia(id);
        setAsistencia({
          confirmados: a.confirmados as AsistenciaItem[],
          pendientes: a.pendientes as AsistenciaItem[],
          lista_espera: a.lista_espera as AsistenciaItem[],
          rechazados: a.rechazados as AsistenciaItem[],
        });
      } else {
        const i = await api.listInscripciones(id);
        setItems(i);
      }
    } catch (e: any) {
      Alert.alert("Error", e.message ?? "No se pudieron cargar las inscripciones");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);
  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  // ===== Refund (modo paga) =====
  const onRefund = (insc: Inscripcion) => {
    Alert.alert(
      "Confirmar reembolso",
      `¿Reembolsar a ${insc.nombre} (${insc.telefono})? Su lugar se libera y se promueve a la siguiente persona en lista de espera.`,
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Reembolsar",
          style: "destructive",
          onPress: async () => {
            if (!id) return;
            setRefunding(insc.id);
            try {
              const res = await api.refundInscripcion(id, insc.id);
              Alert.alert(
                "Reembolso completado",
                `Stripe procesó ${res.amount_refunded_mxn ? `$${res.amount_refunded_mxn} MXN` : "el reembolso"}.${res.promoted ? "\nSe promovió al siguiente en lista de espera." : ""}`,
              );
              await load();
            } catch (e: any) {
              Alert.alert("Error", e.message ?? "No se pudo procesar el reembolso");
            } finally {
              setRefunding(null);
            }
          },
        },
      ],
    );
  };

  // ===== Cambio manual de estatus (modo gratis) =====
  const moveTo = async (insc: AsistenciaItem, target: EstatusConfirm) => {
    if (movingId) return;
    setMovingId(insc.id);
    try {
      const res = await api.setEstatusInscripcion(insc.id, target);
      if (res.promoted && res.promoted_player) {
        Alert.alert(
          "Lugar liberado",
          `Promovimos a ${res.promoted_player} desde lista de espera.`,
        );
      }
      await load();
    } catch (e: any) {
      Alert.alert("No se pudo cambiar", e.message ?? "Inténtalo de nuevo.");
    } finally {
      setMovingId(null);
    }
  };

  const confirmMove = (insc: AsistenciaItem, target: EstatusConfirm, label: string) => {
    Alert.alert(
      "Confirmar cambio",
      `Mover a ${insc.nombre} a “${label}”.`,
      [
        { text: "Cancelar", style: "cancel" },
        { text: "Sí, mover", onPress: () => void moveTo(insc, target) },
      ],
    );
  };

  const totales = useMemo(() => {
    if (!asistencia) return null;
    const max = reta?.max_jugadores ?? 0;
    return {
      confirmados: asistencia.confirmados.length,
      pendientes: asistencia.pendientes.length,
      lista: asistencia.lista_espera.length,
      rechazados: asistencia.rechazados.length,
      max,
    };
  }, [asistencia, reta]);

  // ============================================================
  // Render
  // ============================================================

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <View style={styles.center}><ActivityIndicator color={colors.brand.primary} /></View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="inscripciones-back">
          <ArrowLeft size={18} color={colors.text.primary} />
        </TouchableOpacity>
        <Text style={styles.title} numberOfLines={1}>
          {esGratisAmigos ? "Asistencia" : "Inscripciones"}
        </Text>
        <TouchableOpacity
          onPress={() => setImportOpen(true)}
          style={styles.importBtn}
          testID="import-open"
        >
          <Upload size={14} color={colors.brand.primary} />
          <Text style={styles.importBtnTxt}>Importar</Text>
        </TouchableOpacity>
      </View>

      {/* ============= MODO GRATIS_AMIGOS — 3 columnas ============= */}
      {esGratisAmigos && asistencia ? (
        <ScrollView
          contentContainerStyle={styles.scroll}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brand.primary} />}
        >
          {/* Banner verde + contadores */}
          <View style={styles.gratisBanner}>
            <View style={styles.gratisBadge}>
              <Heart size={11} color="#047857" />
              <Text style={styles.gratisBadgeTxt}>Evento gratuito · RSVP</Text>
            </View>
            <Text style={styles.bannerTitle}>
              {totales?.confirmados ?? 0}/{totales?.max ?? 0} confirmados
            </Text>
            <Text style={styles.bannerSub}>
              {totales?.pendientes ?? 0} pendiente{(totales?.pendientes ?? 0) === 1 ? "" : "s"} ·{" "}
              {totales?.lista ?? 0} en espera ·{" "}
              {totales?.rechazados ?? 0} rechazo{(totales?.rechazados ?? 0) === 1 ? "" : "s"}
            </Text>
          </View>

          {/* Columna 1: Confirmados */}
          <SectionColumn
            title="Confirmados"
            count={asistencia.confirmados.length}
            tone="green"
            icon={<UserCheck size={14} color="#047857" />}
            emptyText="Aún no hay confirmados. Comparte el link de la reta para empezar."
          >
            {asistencia.confirmados.map((it) => (
              <PersonRow
                key={it.id}
                item={it}
                isMoving={movingId === it.id}
                actions={[
                  { label: "Lista de espera", target: "lista_espera", tone: "amber" },
                  { label: "Rechazar", target: "rechazado", tone: "red" },
                ]}
                onMove={confirmMove}
              />
            ))}
          </SectionColumn>

          {/* Columna 2: Lista de espera */}
          <SectionColumn
            title="Lista de espera"
            count={asistencia.lista_espera.length}
            tone="amber"
            icon={<Hourglass size={14} color="#B45309" />}
            emptyText="Vacía. Si la reta se llena, los nuevos RSVP caerán aquí automáticamente."
          >
            {asistencia.lista_espera.map((it) => (
              <PersonRow
                key={it.id}
                item={it}
                isMoving={movingId === it.id}
                actions={[
                  { label: "Confirmar", target: "aceptado", tone: "green" },
                  { label: "Rechazar", target: "rechazado", tone: "red" },
                ]}
                onMove={confirmMove}
              />
            ))}
          </SectionColumn>

          {/* Columna 3: Pendientes (invitados que aún no responden) */}
          <SectionColumn
            title="Pendientes de respuesta"
            count={asistencia.pendientes.length}
            tone="slate"
            icon={<MoreHorizontal size={14} color={colors.text.secondary} />}
            emptyText="No hay invitaciones colgando. Todo el mundo respondió. ✨"
          >
            {asistencia.pendientes.map((it) => (
              <PersonRow
                key={it.id}
                item={it}
                isMoving={movingId === it.id}
                actions={[
                  { label: "Confirmar", target: "aceptado", tone: "green" },
                  { label: "Rechazar", target: "rechazado", tone: "red" },
                ]}
                onMove={confirmMove}
              />
            ))}
          </SectionColumn>

          {/* Columna 4 (auditoría, colapsable visualmente): Rechazados */}
          {asistencia.rechazados.length > 0 ? (
            <SectionColumn
              title="Rechazados"
              count={asistencia.rechazados.length}
              tone="red"
              icon={<UserX size={14} color={colors.status.red} />}
              emptyText=""
            >
              {asistencia.rechazados.map((it) => (
                <PersonRow
                  key={it.id}
                  item={it}
                  isMoving={movingId === it.id}
                  actions={[
                    { label: "Reactivar", target: "aceptado", tone: "green" },
                  ]}
                  onMove={confirmMove}
                />
              ))}
            </SectionColumn>
          ) : null}
        </ScrollView>
      ) : (
        // ============= MODO PAGA — lista legacy =============
        <FlatList
          data={items}
          keyExtractor={(i) => i.id}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brand.primary} />}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>Sin inscripciones</Text>
              <Text style={styles.emptyText}>Cuando jugadores se inscriban aparecerán aquí.</Text>
            </View>
          }
          renderItem={({ item }) => {
            const info = estatusInfo(item.estatus_pago);
            const canRefund = item.estatus_pago === "Aprobado";
            const isRefunding = refunding === item.id;
            return (
              <View style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>{item.nombre}</Text>
                  <Text style={styles.meta}>{item.telefono}</Text>
                  <View style={styles.estatusRow}>
                    {info.icon}
                    <Text style={[styles.estatus, { color: info.color }]}>{info.label}</Text>
                  </View>
                </View>
                {canRefund ? (
                  <TouchableOpacity
                    onPress={() => onRefund(item)}
                    disabled={isRefunding}
                    style={[styles.refundBtn, isRefunding && { opacity: 0.5 }]}
                    testID={`refund-${item.id}`}
                  >
                    {isRefunding ? (
                      <ActivityIndicator color={colors.text.inverse} size="small" />
                    ) : (
                      <>
                        <RotateCcw size={12} color={colors.text.inverse} />
                        <Text style={styles.refundBtnText}>Reembolsar</Text>
                      </>
                    )}
                  </TouchableOpacity>
                ) : null}
              </View>
            );
          }}
        />
      )}

      {/* Modal de Importación Masiva — paste CSV */}
      <ImportarJugadoresModal
        retaId={id || ""}
        visible={importOpen}
        onClose={() => setImportOpen(false)}
        onSuccess={() => void load()}
      />
    </SafeAreaView>
  );
}

// ============================================================
// Subcomponents
// ============================================================

type Tone = "green" | "amber" | "red" | "slate";

const TONES: Record<Tone, { bg: string; border: string; fg: string }> = {
  green: { bg: "#ECFDF5", border: "#10B98140", fg: "#047857" },
  amber: { bg: "#FFFBEB", border: "#F59E0B40", fg: "#B45309" },
  red: { bg: "#FEF2F2", border: "#EF444440", fg: "#B91C1C" },
  slate: { bg: "#F1F5F9", border: "#94A3B840", fg: "#475569" },
};

function SectionColumn({
  title, count, tone, icon, emptyText, children,
}: {
  title: string;
  count: number;
  tone: Tone;
  icon: React.ReactNode;
  emptyText: string;
  children: React.ReactNode;
}) {
  const t = TONES[tone];
  const isEmpty = count === 0;
  return (
    <View style={styles.column}>
      <View style={[styles.columnHeader, { backgroundColor: t.bg, borderColor: t.border }]}>
        <View style={styles.columnHeadLeft}>
          {icon}
          <Text style={[styles.columnTitle, { color: t.fg }]}>{title}</Text>
        </View>
        <View style={[styles.countBubble, { backgroundColor: t.fg }]}>
          <Text style={styles.countBubbleText}>{count}</Text>
        </View>
      </View>
      {isEmpty ? (
        emptyText ? (
          <View style={styles.emptyColumn}>
            <Text style={styles.emptyColumnText}>{emptyText}</Text>
          </View>
        ) : null
      ) : (
        children
      )}
    </View>
  );
}

function PersonRow({
  item, isMoving, actions, onMove,
}: {
  item: AsistenciaItem;
  isMoving: boolean;
  actions: { label: string; target: EstatusConfirm; tone: Tone }[];
  onMove: (insc: AsistenciaItem, target: EstatusConfirm, label: string) => void;
}) {
  return (
    <View style={styles.personRow} testID={`person-${item.id}`}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.personName} numberOfLines={1}>{item.nombre}</Text>
        <Text style={styles.personMeta} numberOfLines={1}>{item.telefono}</Text>
      </View>
      {isMoving ? (
        <ActivityIndicator size="small" color={colors.brand.primary} />
      ) : (
        <View style={styles.personActions}>
          {actions.map((a) => {
            const t = TONES[a.tone];
            return (
              <TouchableOpacity
                key={a.target}
                onPress={() => onMove(item, a.target, a.label)}
                style={[styles.actionChip, { backgroundColor: t.bg, borderColor: t.border }]}
                testID={`move-${item.id}-${a.target}`}
              >
                <Text style={[styles.actionChipText, { color: t.fg }]}>{a.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}
    </View>
  );
}

// ============================================================
// Styles
// ============================================================

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg.app },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  topBar: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: spacing.sm,
  },
  iconBtn: {
    width: 40, height: 40, borderRadius: radii.md, backgroundColor: colors.bg.card,
    borderWidth: 1, borderColor: colors.border.default, alignItems: "center", justifyContent: "center",
  },
  importBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: spacing.sm + 2, paddingVertical: 8,
    borderRadius: radii.md, borderWidth: 1,
    borderColor: colors.brand.primary + "40",
    backgroundColor: colors.brand.primary + "10",
  },
  importBtnTxt: {
    ...typography.button, fontSize: 12, color: colors.brand.primary,
  },
  title: { ...typography.h2, color: colors.text.primary, fontSize: 18, flex: 1, textAlign: "center" },

  // Modo paga (legacy)
  list: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.sm },
  row: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    backgroundColor: colors.bg.card, borderRadius: radii.md,
    padding: spacing.md, borderWidth: 1, borderColor: colors.border.default,
  },
  name: { ...typography.bodyBold, color: colors.text.primary },
  meta: { color: colors.text.secondary, fontSize: 11, marginTop: 2 },
  estatusRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 6 },
  estatus: { fontSize: 11, fontWeight: "700" },
  refundBtn: {
    backgroundColor: colors.status.red, borderRadius: radii.md,
    paddingHorizontal: 12, paddingVertical: 8,
    flexDirection: "row", alignItems: "center", gap: 4,
  },
  refundBtnText: { color: colors.text.inverse, fontSize: 12, fontWeight: "800" },
  empty: { paddingVertical: spacing.xxl, alignItems: "center", gap: spacing.sm },
  emptyTitle: { ...typography.h2, color: colors.text.primary, fontSize: 18 },
  emptyText: { color: colors.text.secondary, textAlign: "center", paddingHorizontal: spacing.lg },

  // Modo gratis_amigos
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.md },
  gratisBanner: {
    backgroundColor: colors.bg.card,
    borderWidth: 1,
    borderColor: "#10B98140",
    borderRadius: radii.md,
    padding: spacing.md,
    alignItems: "flex-start",
    gap: 4,
  },
  gratisBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radii.sm,
    backgroundColor: "#ECFDF5",
    borderWidth: 1,
    borderColor: "#10B98140",
    marginBottom: 4,
  },
  gratisBadgeTxt: {
    color: "#047857",
    fontWeight: "800",
    fontSize: 10,
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  bannerTitle: {
    ...typography.h2,
    color: colors.text.primary,
    fontSize: 22,
  },
  bannerSub: {
    color: colors.text.secondary,
    fontSize: 12,
  },
  column: {
    backgroundColor: colors.bg.card,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border.default,
    overflow: "hidden",
  },
  columnHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  columnHeadLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  columnTitle: {
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 0.3,
    textTransform: "uppercase",
  },
  countBubble: {
    minWidth: 24,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  countBubbleText: {
    color: "#fff",
    fontWeight: "900",
    fontSize: 11,
  },
  emptyColumn: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
  },
  emptyColumnText: {
    color: colors.text.secondary,
    fontSize: 12,
    fontStyle: "italic",
    lineHeight: 17,
  },
  personRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border.default,
  },
  personName: {
    ...typography.bodyBold,
    color: colors.text.primary,
    fontSize: 14,
  },
  personMeta: {
    color: colors.text.secondary,
    fontSize: 11,
    marginTop: 2,
  },
  personActions: {
    flexDirection: "row",
    gap: 4,
    flexShrink: 0,
  },
  actionChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radii.sm,
    borderWidth: 1,
  },
  actionChipText: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.2,
  },
});
