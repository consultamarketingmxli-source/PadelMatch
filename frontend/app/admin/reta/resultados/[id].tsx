/**
 * Mesa de Control en Vivo (Fase C).
 *
 * UX para captura rápida en cancha:
 *   • Tarjetas grandes por partido — 1 por pareja con TouchTarget 44px+.
 *   • Inputs numéricos centrales con botones (−) y (+) gigantes (56px),
 *     pensados para dedos húmedos / con grip de raqueta.
 *   • Banner ámbar si el organizador intenta guardar con un input vacío:
 *     "Ingresa la puntuación de ambas parejas para procesar la ronda".
 *   • Botón "Empate" sólo visible en modalidad TIEMPO (formato_score.tipo === "TIEMPO").
 *   • Chip ✓ verde cuando el partido está cerrado, con opción a editar o
 *     eliminar (corregir error tipográfico).
 *   • Tabs por cancha + contador global "X / N partidos capturados".
 *
 * Robustez:
 *   • La UI nunca dispara la API si falta algún score (frontend gating).
 *   • Tras guardar, actualiza el state local optimista; si la API falla,
 *     revierte y muestra error específico.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  AlertCircle,
  ArrowLeft,
  BarChart2,
  Check,
  Equal,
  Minus,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react-native";

import { PartidoResultado, Reta, RolResponse, api } from "@/src/api";
import { CourtLinesBackground } from "@/src/components/CourtLinesBackground";
import { PadelPalaIcon } from "@/src/components/PadelPalaIcon";
import { FixtureMetadataBadge } from "@/src/components/FixtureMetadataBadge";
import { RecalcularRondasModal } from "@/src/components/RecalcularRondasModal";
import { useSyncLock } from "@/src/hooks/useSyncLock";
import { colors, radii, spacing, typography } from "@/src/theme";

type Slot = {
  a: string;
  b: string;
  resultId?: string;
  saved?: boolean;
  saving?: boolean;
  dirty?: boolean;
  error?: string | null;
};

const keyFor = (cancha: number, ronda: number, idx: number) => `${cancha}:${ronda}:${idx}`;

function snapInt(value: string, max = 99): string {
  const cleaned = value.replace(/[^0-9]/g, "").slice(0, 3);
  if (!cleaned) return "";
  const n = parseInt(cleaned, 10);
  if (Number.isNaN(n)) return "";
  return String(Math.max(0, Math.min(max, n)));
}

export default function CapturarResultados() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [reta, setReta] = useState<Reta | null>(null);
  const [rol, setRol] = useState<RolResponse | null>(null);
  const [slots, setSlots] = useState<Record<string, Slot>>({});
  const [loading, setLoading] = useState(true);
  const [canchaActiva, setCanchaActiva] = useState(1);
  const [recalcularVisible, setRecalcularVisible] = useState(false);

  // Auditoría Routing — Fase 3: lock síncrono por partido para prevenir
  // que un doble-tap rápido cree dos resultados (race entre setState y repaint).
  const saveLock = useSyncLock();
  const deleteLock = useSyncLock();

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const [retaData, rolData, existing] = await Promise.all([
        api.getRetaAdmin(id),
        api.getRol(id),
        api.listResultados(id),
      ]);
      setReta(retaData);
      setRol(rolData);
      const initial: Record<string, Slot> = {};
      existing.forEach((r: PartidoResultado) => {
        initial[keyFor(r.cancha, r.ronda, r.partido_idx)] = {
          a: String(r.score_a),
          b: String(r.score_b),
          resultId: r.id,
          saved: true,
          dirty: false,
        };
      });
      setSlots(initial);
    } catch (e: any) {
      Alert.alert("Error", e.message ?? "No se pudo cargar el rol");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const isTiempo = reta?.formato_score?.tipo === "TIEMPO" || reta?.modalidad_juego === "TIEMPO";
  const maxScore = isTiempo ? 99 : Math.max(20, (reta?.formato_score?.valor ?? 9) + 5);

  const setField = (k: string, field: "a" | "b", value: string) => {
    setSlots((s) => {
      const prev = s[k] ?? { a: "", b: "" };
      return {
        ...s,
        [k]: {
          ...prev,
          [field]: snapInt(value, maxScore),
          saved: false,
          dirty: true,
          error: null,
        },
      };
    });
  };

  const bump = (k: string, field: "a" | "b", delta: number) => {
    setSlots((s) => {
      const prev = s[k] ?? { a: "", b: "" };
      const cur = parseInt(prev[field] || "0", 10);
      const next = Math.max(0, Math.min(maxScore, cur + delta));
      return {
        ...s,
        [k]: {
          ...prev,
          [field]: String(next),
          saved: false,
          dirty: true,
          error: null,
        },
      };
    });
  };

  const setEmpate = (k: string) => {
    setSlots((s) => {
      const prev = s[k] ?? { a: "", b: "" };
      const cur = parseInt(prev.a || prev.b || "1", 10) || 1;
      return {
        ...s,
        [k]: { ...prev, a: String(cur), b: String(cur), saved: false, dirty: true, error: null },
      };
    });
  };

  const saveScore = async (
    cancha: number,
    ronda: number,
    idx: number,
    parejaA: string[],
    parejaB: string[],
  ) => {
    if (!id) return;
    const k = keyFor(cancha, ronda, idx);
    // Fase 3 — lock síncrono: si ya hay un guardado en vuelo para este slot,
    // descarta el segundo tap antes de tocar setState (que es async).
    if (!saveLock.tryAcquire(k)) return;
    const cur = slots[k];
    if (!cur || cur.a === "" || cur.b === "") {
      setSlots((s) => ({
        ...s,
        [k]: {
          ...(s[k] ?? { a: "", b: "" }),
          error: "Ingresa la puntuación de ambas parejas para procesar la ronda",
        },
      }));
      saveLock.release(k);
      return;
    }
    setSlots((s) => ({ ...s, [k]: { ...cur, saving: true, error: null } }));
    try {
      const res = await api.upsertResultado(id, {
        cancha,
        ronda,
        partido_idx: idx,
        pareja_a: parejaA,
        pareja_b: parejaB,
        score_a: parseInt(cur.a, 10),
        score_b: parseInt(cur.b, 10),
      });
      setSlots((s) => ({
        ...s,
        [k]: {
          a: String(res.score_a),
          b: String(res.score_b),
          resultId: res.id,
          saved: true,
          saving: false,
          dirty: false,
          error: null,
        },
      }));
    } catch (e: any) {
      setSlots((s) => ({
        ...s,
        [k]: { ...cur, saving: false, error: e.message ?? "No se pudo guardar" },
      }));
    } finally {
      saveLock.release(k);
    }
  };

  const deleteScore = async (k: string) => {
    if (!id) return;
    const slot = slots[k];
    if (!slot?.resultId) return;
    Alert.alert(
      "¿Eliminar marcador?",
      "Esto borrará el resultado y recalculará la tabla. ¿Continuar?",
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Eliminar",
          style: "destructive",
          onPress: async () => {
            // Fase 3 — lock síncrono por slot para borrado.
            if (!deleteLock.tryAcquire(k)) return;
            try {
              await api.deleteResultado(id, slot.resultId!);
              setSlots((s) => {
                const next = { ...s };
                delete next[k];
                return next;
              });
            } catch (e: any) {
              Alert.alert("Error", e.message ?? "No se pudo eliminar");
            } finally {
              deleteLock.release(k);
            }
          },
        },
      ],
    );
  };

  const totalPartidos = useMemo(() => {
    if (!rol) return 0;
    return rol.rol.reduce(
      (acc, c) => acc + c.rondas.reduce((a2, r) => a2 + r.partidos.length, 0),
      0,
    );
  }, [rol]);
  const guardados = useMemo(() => Object.values(slots).filter((s) => s.saved).length, [slots]);

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}><ActivityIndicator color={colors.brand.primary} /></View>
      </SafeAreaView>
    );
  }
  if (!rol) return null;

  const canchaData = rol.rol.find((c) => c.cancha === canchaActiva) ?? rol.rol[0];

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <CourtLinesBackground opacity={0.035} />
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1 }}
      >
        <View style={styles.topBar}>
          <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="resultados-back">
            <ArrowLeft size={18} color={colors.text.primary} />
          </TouchableOpacity>
          <View style={{ flex: 1, alignItems: "center" }}>
            <Text style={styles.title}>Mesa de Control</Text>
            <Text style={styles.subtle}>
              {guardados} / {totalPartidos} partidos
              {reta ? ` · ${reta.formato_score?.tipo === "TIEMPO" ? `${reta.formato_score?.valor}min` : `a ${reta.formato_score?.valor} ${reta.formato_score?.unidad ?? "juegos"}`}` : ""}
            </Text>
          </View>
          <View style={styles.topBarActions}>
            <TouchableOpacity
              onPress={() => setRecalcularVisible(true)}
              style={styles.iconBtn}
              testID="resultados-recalcular"
              accessibilityLabel="Recalcular rondas pendientes"
            >
              <RefreshCw size={18} color={colors.brand.primary} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => reta && router.push(`/retas/${reta.url_slug}/tabla` as any)}
              style={styles.iconBtn}
              testID="resultados-tabla"
            >
              <BarChart2 size={18} color={colors.brand.primary} />
            </TouchableOpacity>
          </View>
        </View>

        {rol.canchas > 1 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.canchasBar}
          >
            {rol.rol.map((c) => (
              <TouchableOpacity
                key={c.cancha}
                onPress={() => setCanchaActiva(c.cancha)}
                style={[styles.canchaTab, canchaActiva === c.cancha && styles.canchaTabActive]}
                testID={`cancha-tab-${c.cancha}`}
              >
                <Text style={[styles.canchaTabText, canchaActiva === c.cancha && styles.canchaTabTextActive]}>
                  Cancha {c.cancha}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        ) : null}

        {/* Fase D — Badge "Rol optimizado" si el motor aplicó alguna concesión */}
        <FixtureMetadataBadge metadata={rol.fixture_metadata} />

        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          {canchaData.rondas.map((ronda) => (
            <View key={ronda.ronda} style={styles.rondaWrap}>
              <View style={styles.rondaHead}>
                <PadelPalaIcon size={14} color={colors.brand.primary} />
                <Text style={styles.rondaTitle}>RONDA {ronda.ronda}</Text>
              </View>
              {ronda.partidos.map((p, idx) => {
                const k = keyFor(canchaData.cancha, ronda.ronda, idx);
                const st = slots[k] ?? { a: "", b: "" };
                const hasError = !!st.error;
                return (
                  <View
                    key={k}
                    style={[
                      styles.partidoCard,
                      st.saved && !st.dirty && styles.partidoCardSaved,
                      hasError && styles.partidoCardError,
                    ]}
                  >
                    {/* Pareja A */}
                    <View style={styles.parejaRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.parejaLabel}>PAREJA A</Text>
                        <Text style={styles.parejaText} numberOfLines={1}>
                          {p.pareja_a.join(" + ")}
                        </Text>
                      </View>
                      <ScoreStepper
                        value={st.a}
                        onChange={(v) => setField(k, "a", v)}
                        onMinus={() => bump(k, "a", -1)}
                        onPlus={() => bump(k, "a", +1)}
                        invalid={hasError && st.a === ""}
                        testID={`stepper-${k}-a`}
                      />
                    </View>

                    <View style={styles.vsRow}>
                      {isTiempo ? (
                        <TouchableOpacity
                          onPress={() => setEmpate(k)}
                          style={styles.empateBtn}
                          testID={`empate-${k}`}
                        >
                          <Equal size={12} color={colors.brand.primary} />
                          <Text style={styles.empateText}>Empate</Text>
                        </TouchableOpacity>
                      ) : (
                        <Text style={styles.vsText}>VS</Text>
                      )}
                    </View>

                    {/* Pareja B */}
                    <View style={styles.parejaRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.parejaLabel}>PAREJA B</Text>
                        <Text style={styles.parejaText} numberOfLines={1}>
                          {p.pareja_b.join(" + ")}
                        </Text>
                      </View>
                      <ScoreStepper
                        value={st.b}
                        onChange={(v) => setField(k, "b", v)}
                        onMinus={() => bump(k, "b", -1)}
                        onPlus={() => bump(k, "b", +1)}
                        invalid={hasError && st.b === ""}
                        testID={`stepper-${k}-b`}
                      />
                    </View>

                    {hasError ? (
                      <View style={styles.errorBanner}>
                        <AlertCircle size={14} color={colors.status.amber} />
                        <Text style={styles.errorText}>{st.error}</Text>
                      </View>
                    ) : null}

                    <View style={styles.actionRow}>
                      <TouchableOpacity
                        testID={`save-${k}`}
                        onPress={() => saveScore(canchaData.cancha, ronda.ronda, idx, p.pareja_a, p.pareja_b)}
                        disabled={!!st.saving || (st.saved === true && !st.dirty)}
                        style={[
                          styles.saveBtn,
                          st.saved && !st.dirty && styles.saveBtnDone,
                          st.saving && { opacity: 0.6 },
                        ]}
                      >
                        {st.saving ? (
                          <ActivityIndicator color={colors.text.inverse} size="small" />
                        ) : (
                          <>
                            <Check size={14} color={colors.text.inverse} />
                            <Text style={styles.saveBtnText}>
                              {st.saved && !st.dirty ? "✓ Guardado" : st.dirty && st.saved ? "Actualizar" : "Guardar marcador"}
                            </Text>
                          </>
                        )}
                      </TouchableOpacity>
                      {st.saved && st.resultId ? (
                        <TouchableOpacity
                          onPress={() => deleteScore(k)}
                          style={styles.deleteBtn}
                          testID={`delete-${k}`}
                        >
                          <Trash2 size={14} color={colors.status.red} />
                        </TouchableOpacity>
                      ) : null}
                    </View>
                  </View>
                );
              })}
            </View>
          ))}
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Fase D — Hito 3: Recálculo en caliente */}
      {id ? (
        <RecalcularRondasModal
          visible={recalcularVisible}
          retaId={id}
          jugadores={rol.jugadores ?? []}
          onClose={() => setRecalcularVisible(false)}
          onApplied={() => {
            // Refrescar rol + resultados para reflejar el nuevo ordenamiento.
            void load();
          }}
        />
      ) : null}
    </SafeAreaView>
  );
}

function ScoreStepper(props: {
  value: string;
  onChange: (v: string) => void;
  onMinus: () => void;
  onPlus: () => void;
  invalid?: boolean;
  testID?: string;
}) {
  return (
    <View style={styles.stepper}>
      <TouchableOpacity
        onPress={props.onMinus}
        style={styles.stepBtn}
        activeOpacity={0.6}
        testID={props.testID ? `${props.testID}-minus` : undefined}
      >
        <Minus size={20} color={colors.text.primary} />
      </TouchableOpacity>
      <TextInput
        value={props.value}
        onChangeText={props.onChange}
        keyboardType="number-pad"
        maxLength={2}
        style={[styles.scoreInput, props.invalid && styles.scoreInputInvalid]}
        placeholder="—"
        placeholderTextColor={colors.text.muted}
        testID={props.testID}
      />
      <TouchableOpacity
        onPress={props.onPlus}
        style={styles.stepBtn}
        activeOpacity={0.6}
        testID={props.testID ? `${props.testID}-plus` : undefined}
      >
        <Plus size={20} color={colors.text.primary} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg.app },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  topBar: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
  },
  topBarActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  iconBtn: {
    width: 40, height: 40, borderRadius: radii.md,
    backgroundColor: colors.bg.card, borderWidth: 1, borderColor: colors.border.default,
    alignItems: "center", justifyContent: "center",
  },
  title: { ...typography.h2, color: colors.text.primary, fontSize: 17 },
  subtle: { color: colors.text.secondary, fontSize: 11, marginTop: 2 },
  canchasBar: { flexDirection: "row", gap: spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  canchaTab: {
    paddingHorizontal: spacing.md, paddingVertical: 8,
    borderRadius: radii.pill, borderWidth: 1, borderColor: colors.border.default,
    backgroundColor: colors.bg.card,
  },
  canchaTabActive: { backgroundColor: colors.brand.primary, borderColor: colors.brand.primary },
  canchaTabText: { color: colors.text.primary, fontWeight: "700", fontSize: 13 },
  canchaTabTextActive: { color: colors.text.inverse },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl },
  rondaWrap: { marginBottom: spacing.lg },
  rondaHead: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: spacing.sm },
  rondaTitle: {
    ...typography.label,
    color: colors.brand.primary,
    fontSize: 11,
    letterSpacing: 1.2,
  },
  partidoCard: {
    backgroundColor: colors.bg.card,
    borderWidth: 1,
    borderColor: colors.border.default,
    borderRadius: radii.lg,
    padding: spacing.md,
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  partidoCardSaved: {
    borderColor: colors.status.green,
    backgroundColor: "rgba(22, 163, 74, 0.04)",
  },
  partidoCardError: {
    borderColor: colors.status.amber,
    borderWidth: 2,
  },
  parejaRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  parejaLabel: {
    color: colors.text.muted,
    fontSize: 10,
    letterSpacing: 1.2,
    fontWeight: "700",
    marginBottom: 2,
  },
  parejaText: {
    color: colors.text.primary,
    fontWeight: "700",
    fontSize: 14,
    // Fase D — tipografía monospace para alineación impecable de nombres
    // (números de pista, scores y nombres comparten cadencia visual).
    fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }),
    letterSpacing: 0.2,
  },
  vsRow: { alignItems: "center", paddingVertical: 2 },
  vsText: {
    color: colors.text.muted, fontSize: 11, fontWeight: "700", letterSpacing: 1.5,
  },
  empateBtn: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 10, paddingVertical: 6,
    backgroundColor: "rgba(5, 150, 105, 0.08)",
    borderRadius: radii.pill,
    borderWidth: 1, borderColor: colors.brand.primaryBorder,
  },
  empateText: { color: colors.brand.primary, fontSize: 11, fontWeight: "700" },
  stepper: {
    flexDirection: "row", alignItems: "center", gap: 4,
  },
  stepBtn: {
    width: 44, height: 44, borderRadius: radii.md,
    backgroundColor: colors.bg.app,
    borderWidth: 1, borderColor: colors.border.default,
    alignItems: "center", justifyContent: "center",
  },
  scoreInput: {
    width: 56, height: 56, textAlign: "center",
    borderWidth: 2, borderColor: colors.border.default, borderRadius: radii.md,
    fontSize: 24, fontWeight: "900", color: colors.text.primary,
    backgroundColor: colors.bg.elevated,
  },
  scoreInputInvalid: { borderColor: colors.status.amber, backgroundColor: "#FFF8E1" },
  errorBanner: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: "#FFF8E1", borderRadius: radii.sm,
    paddingHorizontal: spacing.sm, paddingVertical: 6,
  },
  errorText: { flex: 1, color: colors.text.primary, fontSize: 11 },
  actionRow: { flexDirection: "row", gap: spacing.sm, alignItems: "center" },
  saveBtn: {
    flex: 1,
    backgroundColor: colors.brand.primary,
    paddingVertical: 14, borderRadius: radii.md,
    flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 6,
  },
  saveBtnDone: { backgroundColor: colors.status.green },
  saveBtnText: { color: colors.text.inverse, fontWeight: "800", fontSize: 13 },
  deleteBtn: {
    width: 44, height: 44, borderRadius: radii.md,
    borderWidth: 1, borderColor: colors.status.red,
    backgroundColor: "rgba(244, 63, 94, 0.06)",
    alignItems: "center", justifyContent: "center",
  },
});
