/**
 * Panel admin de gestión de PAREJAS (Fase 4).
 *
 * Permite al organizador:
 *   1. Ver la lista de DÚOS completos (parejas ya emparejadas).
 *   2. Ver la BOLSA de FREE-AGENTS (jugadores que pagaron sin pareja).
 *   3. Emparejar 2 free-agents en un nuevo dúo (atómico).
 *   4. Cancelar una inscripción:
 *       - modo "duo" (recomendado por default): borra ambos miembros y libera 2 cupos.
 *       - modo "solo": borra solo este miembro, el compañero queda como free-agent.
 *
 * Pre-requisito: la reta debe ser de modalidad "parejas_libres" o "parejas_mixtas".
 * Si es "individual", se muestra estado vacío con CTA para volver.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
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
  CheckCircle2,
  Link as LinkIcon,
  Phone,
  Trash2,
  UserPlus,
  Users,
  XCircle,
} from "lucide-react-native";

import { Reta, api } from "@/src/api";
import { Button } from "@/src/components/Button";
import { colors, radii, spacing, typography } from "@/src/theme";

type Duo = {
  pareja_grupo_id: string;
  miembros: { inscripcion_id: string; nombre: string; telefono: string; estatus_pago: string }[];
};
type FreeAgent = {
  inscripcion_id: string;
  nombre: string;
  telefono: string;
  creado_en?: string | null;
};

export default function AdminRetaParejas() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const retaId = id ?? "";

  const [reta, setReta] = useState<Reta | null>(null);
  const [duos, setDuos] = useState<Duo[]>([]);
  const [freeAgents, setFreeAgents] = useState<FreeAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);

  // Selección para emparejar (max 2 free-agents).
  const [selected, setSelected] = useState<string[]>([]);

  // Modal de cancelación de inscripción.
  const [cancelTarget, setCancelTarget] = useState<{ duo: Duo; member?: { inscripcion_id: string; nombre: string } } | null>(null);

  const esParejas = useMemo(() => {
    const m = reta?.modalidad_registro ?? "individual";
    return m === "parejas_libres" || m === "parejas_mixtas";
  }, [reta?.modalidad_registro]);

  const load = useCallback(async () => {
    if (!retaId) return;
    try {
      const r = await api.getReta(retaId);
      setReta(r);
      const modal = r.modalidad_registro ?? "individual";
      if (modal === "parejas_libres" || modal === "parejas_mixtas") {
        const [d, fa] = await Promise.all([
          api.listDuos(retaId),
          api.listFreeAgents(retaId),
        ]);
        setDuos(d);
        setFreeAgents(fa);
      }
    } catch (e: any) {
      Alert.alert("Error", e.message ?? "No se pudo cargar la información");
    } finally {
      setLoading(false);
    }
  }, [retaId]);

  useEffect(() => { void load(); }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  // Toggle selección free-agent (max 2).
  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 2) {
        Alert.alert("Solo 2", "Solo puedes emparejar 2 jugadores a la vez. Deselecciona uno primero.");
        return prev;
      }
      return [...prev, id];
    });
  };

  const onMatch = async () => {
    if (selected.length !== 2) return;
    setBusy(true);
    try {
      const res = await api.matchFreeAgents(retaId, selected[0], selected[1]);
      Alert.alert(
        "Pareja creada",
        `${res.miembros[0].nombre} & ${res.miembros[1].nombre} quedaron emparejados.`,
      );
      setSelected([]);
      await load();
    } catch (e: any) {
      Alert.alert("Error", e.message ?? "No se pudo emparejar");
    } finally {
      setBusy(false);
    }
  };

  const askCancel = (duo: Duo, member?: { inscripcion_id: string; nombre: string }) => {
    setCancelTarget({ duo, member });
  };

  const doCancel = async (modo: "duo" | "solo") => {
    if (!cancelTarget) return;
    const inscId = cancelTarget.member?.inscripcion_id ?? cancelTarget.duo.miembros[0]?.inscripcion_id;
    if (!inscId) {
      setCancelTarget(null);
      return;
    }
    setBusy(true);
    try {
      const res = await api.cancelInscripcionPareja(retaId, inscId, modo);
      Alert.alert(
        "Listo",
        `Cancelaste ${res.eliminadas} inscripción(es). Cupos liberados: ${res.cupos_liberados}.${res.libres_creadas ? `\nSe creó ${res.libres_creadas} free-agent.` : ""}${res.promoted ? "\nSe promovió a alguien de la lista de espera." : ""}`,
      );
      setCancelTarget(null);
      await load();
    } catch (e: any) {
      Alert.alert("Error", e.message ?? "No se pudo cancelar");
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}><ActivityIndicator color={colors.brand.primary} /></View>
      </SafeAreaView>
    );
  }

  // Si la reta es individual → estado vacío con CTA.
  if (!esParejas) {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <View style={styles.topBar}>
          <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="parejas-back">
            <ArrowLeft size={18} color={colors.text.primary} />
          </TouchableOpacity>
          <Text style={styles.title}>Gestión de parejas</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.emptyHero} testID="parejas-empty-hero">
          <Users size={40} color={colors.text.tertiary} />
          <Text style={styles.emptyTitle}>Reta individual</Text>
          <Text style={styles.emptyText}>
            Esta reta NO es de parejas. Cambia la modalidad de registro a “parejas_libres”
            o “parejas_mixtas” en el formulario de edición para usar este panel.
          </Text>
          <View style={{ height: spacing.lg }} />
          <Button
            title="Volver a editar reta"
            onPress={() => router.replace(`/admin/reta/${retaId}` as any)}
            variant="primary"
            testID="parejas-empty-back-btn"
          />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="parejas-back">
          <ArrowLeft size={18} color={colors.text.primary} />
        </TouchableOpacity>
        <Text style={styles.title}>Parejas y free-agents</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brand.primary} />}
      >
        {/* ===== HEADER STATS ===== */}
        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{duos.length}</Text>
            <Text style={styles.statLabel}>Dúos completos</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{freeAgents.length}</Text>
            <Text style={styles.statLabel}>Free-agents</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{duos.length * 2 + freeAgents.length}</Text>
            <Text style={styles.statLabel}>Total inscritos</Text>
          </View>
        </View>

        {/* ===== FREE AGENTS ===== */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <UserPlus size={16} color={colors.brand.primary} />
            <Text style={styles.sectionTitle}>Bolsa de free-agents</Text>
          </View>
          <Text style={styles.sectionHint}>
            Selecciona 2 jugadores y crea un dúo. Su pareja_grupo_id quedará compartido.
          </Text>

          {freeAgents.length === 0 ? (
            <View style={styles.emptyMini}>
              <Text style={styles.emptyMiniTxt}>No hay free-agents pendientes.</Text>
            </View>
          ) : freeAgents.length === 1 ? (
            <View style={styles.emptyMini} testID="free-agent-singleton">
              <Text style={styles.emptyMiniTxt}>
                Hay 1 jugador sin pareja. Necesitas al menos 2 free-agents para
                poder emparejarlos. Espera más registros o ajusta inscripciones.
              </Text>
            </View>
          ) : (
            <View style={{ gap: spacing.sm }}>
              {freeAgents.map((fa) => {
                const isSel = selected.includes(fa.inscripcion_id);
                return (
                  <Pressable
                    key={fa.inscripcion_id}
                    onPress={() => toggleSelect(fa.inscripcion_id)}
                    style={({ pressed }) => [
                      styles.faRow,
                      isSel && styles.faRowSel,
                      pressed && { opacity: 0.85 },
                    ]}
                    testID={`fa-row-${fa.inscripcion_id}`}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.faName}>{fa.nombre}</Text>
                      <View style={styles.faMetaRow}>
                        <Phone size={11} color={colors.text.secondary} />
                        <Text style={styles.faMeta}>{fa.telefono}</Text>
                      </View>
                    </View>
                    {isSel ? (
                      <View style={styles.faCheckOn} testID={`fa-check-${fa.inscripcion_id}`}>
                        <CheckCircle2 size={20} color={colors.brand.primary} />
                      </View>
                    ) : (
                      <View style={styles.faCheckOff} />
                    )}
                  </Pressable>
                );
              })}
            </View>
          )}

          {/* Acción Match */}
          {freeAgents.length >= 2 ? (
            <View style={{ marginTop: spacing.md }}>
              <Button
                title={selected.length === 2 ? "Crear dúo con los seleccionados" : `Selecciona ${2 - selected.length} más`}
                onPress={onMatch}
                variant="primary"
                icon={<LinkIcon size={14} color={"#fff"} />}
                disabled={selected.length !== 2 || busy}
                loading={busy && selected.length === 2}
                testID="match-btn"
              />
            </View>
          ) : null}
        </View>

        {/* ===== DÚOS ===== */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Users size={16} color={colors.brand.primary} />
            <Text style={styles.sectionTitle}>Dúos registrados</Text>
          </View>

          {duos.length === 0 ? (
            <View style={styles.emptyMini}>
              <Text style={styles.emptyMiniTxt}>Aún no hay dúos. Empareja free-agents arriba o espera registros públicos.</Text>
            </View>
          ) : (
            <View style={{ gap: spacing.sm }}>
              {duos.map((duo) => (
                <View key={duo.pareja_grupo_id} style={styles.duoCard} testID={`duo-${duo.pareja_grupo_id}`}>
                  <View style={styles.duoHeaderRow}>
                    <Text style={styles.duoTitle}>
                      {duo.miembros.map((m) => m.nombre).join(" & ")}
                    </Text>
                    <TouchableOpacity
                      onPress={() => askCancel(duo)}
                      style={styles.cancelBtn}
                      testID={`cancel-duo-${duo.pareja_grupo_id}`}
                    >
                      <Trash2 size={12} color={"#fff"} />
                      <Text style={styles.cancelBtnTxt}>Cancelar</Text>
                    </TouchableOpacity>
                  </View>
                  {duo.miembros.map((m) => {
                    const aprobado = m.estatus_pago === "Aprobado";
                    return (
                      <View key={m.inscripcion_id} style={styles.duoMemberRow}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.duoMemberName}>{m.nombre}</Text>
                          <Text style={styles.duoMemberMeta}>{m.telefono}</Text>
                        </View>
                        <View style={[styles.statusPill, aprobado ? styles.pillOk : styles.pillPending]}>
                          {aprobado
                            ? <CheckCircle2 size={11} color={colors.status.green} />
                            : <XCircle size={11} color={colors.status.amber} />}
                          <Text style={[styles.statusPillTxt, { color: aprobado ? colors.status.green : colors.status.amber }]}>
                            {aprobado ? "Pagado" : m.estatus_pago}
                          </Text>
                        </View>
                      </View>
                    );
                  })}
                </View>
              ))}
            </View>
          )}
        </View>
      </ScrollView>

      {/* ===== MODAL CANCELACIÓN ===== */}
      <Modal
        visible={!!cancelTarget}
        transparent
        animationType={Platform.OS === "ios" ? "slide" : "fade"}
        onRequestClose={() => setCancelTarget(null)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard} testID="cancel-modal">
            <Text style={styles.modalTitle}>¿Cómo deseas cancelar?</Text>
            <Text style={styles.modalSub}>
              {cancelTarget ? cancelTarget.duo.miembros.map((m) => m.nombre).join(" & ") : ""}
            </Text>
            <View style={{ height: spacing.md }} />
            <Button
              title="Cancelar dúo completo (libera 2 cupos)"
              onPress={() => void doCancel("duo")}
              variant="danger"
              loading={busy}
              testID="confirm-cancel-duo"
            />
            <View style={{ height: spacing.sm }} />
            <Button
              title="Cancelar solo 1 jugador (deja al otro como free-agent)"
              onPress={() => void doCancel("solo")}
              variant="secondary"
              loading={busy}
              testID="confirm-cancel-solo"
            />
            <View style={{ height: spacing.sm }} />
            <TouchableOpacity onPress={() => setCancelTarget(null)} style={styles.modalCloseBtn} testID="cancel-modal-close">
              <Text style={styles.modalCloseTxt}>No, mantener inscripción</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg.app },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  topBar: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
  },
  iconBtn: {
    width: 40, height: 40, borderRadius: radii.md, backgroundColor: colors.bg.card,
    borderWidth: 1, borderColor: colors.border.default,
    alignItems: "center", justifyContent: "center",
  },
  title: { ...typography.h2, color: colors.text.primary, fontSize: 17 },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.lg },

  // Empty hero (reta individual).
  emptyHero: {
    flex: 1, alignItems: "center", justifyContent: "center",
    paddingHorizontal: spacing.lg, gap: spacing.sm,
  },
  emptyTitle: { ...typography.h2, color: colors.text.primary, marginTop: spacing.md },
  emptyText: { color: colors.text.secondary, textAlign: "center", lineHeight: 20 },

  // Stats row.
  statsRow: { flexDirection: "row", gap: spacing.sm },
  statCard: {
    flex: 1, backgroundColor: colors.bg.card,
    borderWidth: 1, borderColor: colors.border.default,
    borderRadius: radii.md, padding: spacing.md, alignItems: "center",
  },
  statValue: { ...typography.h2, color: colors.brand.primary, fontSize: 22 },
  statLabel: { color: colors.text.secondary, fontSize: 11, marginTop: 4, textAlign: "center" },

  // Section.
  section: {
    backgroundColor: colors.bg.card,
    borderRadius: radii.lg,
    borderWidth: 1, borderColor: colors.border.default,
    padding: spacing.md,
  },
  sectionHeader: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 },
  sectionTitle: { ...typography.h3, color: colors.text.primary, fontSize: 15 },
  sectionHint: { color: colors.text.secondary, fontSize: 12, marginBottom: spacing.md, lineHeight: 16 },

  emptyMini: {
    paddingVertical: spacing.md, paddingHorizontal: spacing.sm,
    backgroundColor: colors.bg.app, borderRadius: radii.sm,
    borderWidth: 1, borderStyle: "dashed", borderColor: colors.border.default,
  },
  emptyMiniTxt: { color: colors.text.secondary, fontSize: 12, textAlign: "center" },

  // Free agent row.
  faRow: {
    flexDirection: "row", alignItems: "center",
    padding: spacing.sm + 2,
    borderRadius: radii.md,
    borderWidth: 1, borderColor: colors.border.default,
    backgroundColor: colors.bg.app,
  },
  faRowSel: {
    borderColor: colors.brand.primary,
    backgroundColor: colors.brand.primarySoft,
  },
  faName: { ...typography.bodyBold, color: colors.text.primary, fontSize: 14 },
  faMetaRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 3 },
  faMeta: { color: colors.text.secondary, fontSize: 11 },
  faCheckOn: { width: 28, alignItems: "center" },
  faCheckOff: {
    width: 18, height: 18, borderRadius: 9,
    borderWidth: 1.5, borderColor: colors.border.default,
  },

  // Duo card.
  duoCard: {
    backgroundColor: colors.bg.app,
    borderRadius: radii.md,
    borderWidth: 1, borderColor: colors.border.default,
    padding: spacing.sm + 2, gap: spacing.sm,
  },
  duoHeaderRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
  },
  duoTitle: { ...typography.bodyBold, color: colors.brand.primary, fontSize: 14, flex: 1 },
  duoMemberRow: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    paddingVertical: 4,
  },
  duoMemberName: { color: colors.text.primary, fontWeight: "600", fontSize: 13 },
  duoMemberMeta: { color: colors.text.secondary, fontSize: 11, marginTop: 1 },
  statusPill: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: radii.sm,
    borderWidth: 1,
  },
  statusPillTxt: { fontSize: 10, fontWeight: "700" },
  pillOk: { backgroundColor: colors.status.green + "10", borderColor: colors.status.green + "40" },
  pillPending: { backgroundColor: colors.status.amber + "10", borderColor: colors.status.amber + "40" },

  cancelBtn: {
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: colors.status.red,
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: radii.sm, marginLeft: spacing.sm,
  },
  cancelBtnTxt: { color: "#fff", fontSize: 11, fontWeight: "800" },

  // Modal.
  modalBackdrop: {
    flex: 1, backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  modalCard: {
    backgroundColor: colors.bg.card,
    borderTopLeftRadius: radii.lg, borderTopRightRadius: radii.lg,
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  modalTitle: { ...typography.h3, color: colors.text.primary, marginBottom: 4 },
  modalSub: { color: colors.text.secondary, fontSize: 13 },
  modalCloseBtn: {
    alignItems: "center", paddingVertical: spacing.sm,
  },
  modalCloseTxt: { color: colors.text.secondary, fontSize: 13, fontWeight: "600" },
});
