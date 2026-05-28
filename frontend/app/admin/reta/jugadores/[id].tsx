/**
 * Distribución de Jugadores por Cancha — Drag & Drop (Fase C+).
 *
 * UX: Permite al organizador reorganizar manualmente la asignación de
 * jugadores a las distintas canchas mediante drag & drop. Útil para
 * balancear nivel, juntar amigos, o ajustar grupos antes de que arranque
 * el torneo.
 *
 * Reglas de negocio (espejo del backend):
 *   • Solo admin (token requerido).
 *   • Si ya hay resultados capturados → backend devuelve 409 y bloqueamos
 *     el reorden mostrando un banner ámbar persistente.
 *   • La lista nueva debe contener exactamente los mismos nombres que
 *     los inscritos aprobados (1:1).
 *   • Optimistic UI: se guarda visualmente al instante; si el PUT falla,
 *     revertimos al snapshot original y mostramos Alert con la razón.
 *
 * Implementación técnica:
 *   • `react-native-draggable-flatlist` con grupos visuales por cancha:
 *     primeros 8 → Cancha 1, siguientes 8 → Cancha 2, etc.
 *   • Indicadores separadores entre canchas (header sticky por grupo).
 *   • Si el rol tiene un grupo de 4 (mini-rota), se respeta el último.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import DraggableFlatList, {
  RenderItemParams,
  ScaleDecorator,
} from "react-native-draggable-flatlist";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  ArrowLeft,
  CheckCircle2,
  Eye,
  GripVertical,
  Lock,
  RotateCcw,
  Save,
  Shuffle,
} from "lucide-react-native";

import { Reta, RolResponse, api } from "@/src/api";
import { CourtLinesBackground } from "@/src/components/CourtLinesBackground";
import { PadelPalaIcon } from "@/src/components/PadelPalaIcon";
import { colors, radii, spacing, typography } from "@/src/theme";

type JugadorItem = {
  key: string;       // id estable
  nombre: string;
  isPlaceholder: boolean;
};

/** Devuelve la cantidad de jugadores asignados a cada cancha siguiendo
 *  la misma regla del backend (grupos de 8 + opcional grupo de 4). */
function gruposDeCancha(total: number): number[] {
  const grupos8 = Math.floor(total / 8);
  const grupo4 = (total % 8) === 4 ? 1 : 0;
  const arr = Array(grupos8).fill(8);
  if (grupo4) arr.push(4);
  return arr;
}

export default function DistribucionJugadores() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [reta, setReta] = useState<Reta | null>(null);
  const [rol, setRol] = useState<RolResponse | null>(null);
  const [jugadores, setJugadores] = useState<JugadorItem[]>([]);
  const [originalSnapshot, setOriginalSnapshot] = useState<JugadorItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [bloqueado, setBloqueado] = useState(false); // si hay resultados ya capturados

  // === Preview del rol Round Robin ===
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewData, setPreviewData] = useState<
    Array<{ cancha: number; rondas: Array<{ ronda: number; partidos: Array<{ pareja_a: string[]; pareja_b: string[] }> }> }>
  >([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const previewReqIdRef = useRef(0);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const [retaData, rolData, resultados] = await Promise.all([
        api.getRetaAdmin(id),
        api.getRol(id),
        api.listResultados(id),
      ]);
      setReta(retaData);
      setRol(rolData);

      // Bloqueamos drag si ya hay marcadores cargados (el backend también lo valida).
      if (resultados && resultados.length > 0) {
        setBloqueado(true);
      }

      const items: JugadorItem[] = rolData.jugadores.map((n, idx) => ({
        key: `j-${idx}-${n}`,
        nombre: n,
        isPlaceholder: /^Jugador \d+$/.test(n),
      }));
      setJugadores(items);
      setOriginalSnapshot(items);
    } catch (e: any) {
      Alert.alert("Error", e.message ?? "No se pudo cargar la distribución");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Agrupa los items en bandas (canchas) usando el patrón del backend. */
  const bandas = useMemo(() => {
    if (!jugadores.length) return [] as { cancha: number; start: number; end: number }[];
    const tam = gruposDeCancha(jugadores.length);
    const out: { cancha: number; start: number; end: number }[] = [];
    let cursor = 0;
    tam.forEach((n, i) => {
      out.push({ cancha: i + 1, start: cursor, end: cursor + n });
      cursor += n;
    });
    return out;
  }, [jugadores.length]);

  /** Marca si la lista actual difiere del snapshot original — para habilitar guardar. */
  const hayCambios = useMemo(() => {
    if (jugadores.length !== originalSnapshot.length) return false;
    for (let i = 0; i < jugadores.length; i++) {
      if (jugadores[i].nombre !== originalSnapshot[i].nombre) return true;
    }
    return false;
  }, [jugadores, originalSnapshot]);

  /** Detectar la cancha (banda) de un índice dado. */
  const canchaDelIndex = useCallback(
    (i: number) => bandas.find((b) => i >= b.start && i < b.end)?.cancha ?? 0,
    [bandas],
  );

  const reset = () => setJugadores(originalSnapshot);

  /** Solicita el preview del rol con el orden actual (incluye placeholders).
   *  Se ejecuta cuando el modal abre o cuando cambia el orden con modal abierto.
   *  Usa req-id pattern para descartar respuestas obsoletas (race conditions). */
  const fetchPreview = useCallback(async () => {
    if (!id) return;
    const reqId = ++previewReqIdRef.current;
    setPreviewLoading(true);
    try {
      const data = await api.previewRol(
        id,
        jugadores.map((j) => j.nombre),
      );
      if (reqId === previewReqIdRef.current) {
        setPreviewData(data.rol as any);
      }
    } catch (e: any) {
      if (reqId === previewReqIdRef.current) {
        setPreviewData([]);
      }
    } finally {
      if (reqId === previewReqIdRef.current) {
        setPreviewLoading(false);
      }
    }
  }, [id, jugadores]);

  // Auto-refresh del preview cuando se abre el modal o cambia el orden.
  useEffect(() => {
    if (previewOpen) {
      const t = setTimeout(() => void fetchPreview(), 200);
      return () => clearTimeout(t);
    }
  }, [previewOpen, fetchPreview]);

  const abrirPreview = () => setPreviewOpen(true);
  const cerrarPreview = () => setPreviewOpen(false);

  const guardar = async () => {
    if (!id || saving || bloqueado) return;
    // Solo enviamos los nombres reales (no placeholders) — coinciden con aprobados.
    const reales = jugadores.filter((j) => !j.isPlaceholder).map((j) => j.nombre);
    if (reales.length === 0) {
      Alert.alert(
        "Sin jugadores reales",
        "Aún no hay inscritos aprobados. No hay nada que reorganizar.",
      );
      return;
    }
    setSaving(true);
    try {
      await api.updateJugadoresOrden(id, reales);
      // Re-sincroniza snapshot tras éxito
      setOriginalSnapshot(jugadores);
      Alert.alert(
        "✓ Distribución guardada",
        "La nueva asignación de canchas se aplicará al generar el rol.",
      );
    } catch (e: any) {
      const msg = String(e.message ?? "");
      // Revertir UI ante error de backend
      setJugadores(originalSnapshot);
      if (msg.includes("409") || msg.includes("resultados capturados")) {
        setBloqueado(true);
        Alert.alert(
          "Bloqueado",
          "Ya hay resultados capturados. Para cambiar canchas, elimina primero los marcadores.",
        );
      } else {
        Alert.alert("Error al guardar", msg || "No se pudo guardar");
      }
    } finally {
      setSaving(false);
    }
  };

  const renderItem = useCallback(
    ({ item, drag, isActive, getIndex }: RenderItemParams<JugadorItem>) => {
      const indexNum = getIndex() ?? 0;
      const cancha = canchaDelIndex(indexNum);
      const banda = bandas.find((b) => b.cancha === cancha);
      const isFirstOfBand = banda?.start === indexNum;

      return (
        <View>
          {/* Header sticky de cancha */}
          {isFirstOfBand ? (
            <View style={styles.bandaHeader}>
              <PadelPalaIcon size={14} color={colors.brand.primary} />
              <Text style={styles.bandaTitle}>Cancha {cancha}</Text>
              <View style={styles.bandaCount}>
                <Text style={styles.bandaCountText}>{banda?.end! - banda?.start!} jug.</Text>
              </View>
            </View>
          ) : null}

          <ScaleDecorator activeScale={1.04}>
            <TouchableOpacity
              onLongPress={!bloqueado ? drag : undefined}
              disabled={bloqueado}
              activeOpacity={0.85}
              delayLongPress={120}
              style={[
                styles.item,
                isActive && styles.itemActive,
                item.isPlaceholder && styles.itemPlaceholder,
                bloqueado && styles.itemBloqueado,
              ]}
              testID={`drag-item-${indexNum}`}
            >
              <GripVertical
                size={18}
                color={bloqueado ? colors.text.muted : colors.text.secondary}
              />
              <View style={{ flex: 1 }}>
                <Text
                  style={[
                    styles.itemName,
                    item.isPlaceholder && styles.itemNamePlaceholder,
                  ]}
                  numberOfLines={1}
                >
                  {item.nombre}
                </Text>
                <Text style={styles.itemMeta}>
                  Posición {indexNum + 1} · Cancha {cancha}
                </Text>
              </View>
              {item.isPlaceholder ? (
                <View style={styles.placeholderBadge}>
                  <Text style={styles.placeholderBadgeText}>Vacante</Text>
                </View>
              ) : null}
            </TouchableOpacity>
          </ScaleDecorator>
        </View>
      );
    },
    [bandas, canchaDelIndex, bloqueado],
  );

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <ActivityIndicator color={colors.brand.primary} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.bg.app }}>
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <CourtLinesBackground opacity={0.03} />
        <View style={styles.topBar}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={styles.iconBtn}
            testID="jugadores-back"
          >
            <ArrowLeft size={18} color={colors.text.primary} />
          </TouchableOpacity>
          <View style={{ flex: 1, alignItems: "center" }}>
            <Text style={styles.title}>Distribución por Cancha</Text>
            <Text style={styles.subtle}>
              {reta?.nombre ?? "—"} · {bandas.length} cancha{bandas.length === 1 ? "" : "s"}
            </Text>
          </View>
          <View style={styles.iconBtn}>
            <Shuffle size={18} color={colors.brand.primary} />
          </View>
        </View>

        {/* Hint UX */}
        {bloqueado ? (
          <View style={styles.bannerLock}>
            <Lock size={14} color={colors.status.amberText} />
            <Text style={styles.bannerLockText}>
              Distribución bloqueada: ya hay resultados capturados. Elimina los
              marcadores en "Mesa de Control" para reorganizar canchas.
            </Text>
          </View>
        ) : (
          <View style={styles.bannerInfo}>
            <Text style={styles.bannerInfoText}>
              Mantén presionado un jugador y arrastra para cambiarlo de cancha
              o posición.
            </Text>
          </View>
        )}

        <View style={{ flex: 1, paddingHorizontal: spacing.lg }}>
          <DraggableFlatList
            data={jugadores}
            keyExtractor={(item) => item.key}
            renderItem={renderItem}
            onDragEnd={({ data }) => setJugadores(data)}
            contentContainerStyle={{ paddingVertical: spacing.md, paddingBottom: 120 }}
            activationDistance={Platform.OS === "web" ? 1 : 12}
          />
        </View>

        {/* Footer fijo con acciones */}
        <View style={styles.footer}>
          <TouchableOpacity
            onPress={reset}
            disabled={!hayCambios || saving || bloqueado}
            style={[
              styles.resetBtn,
              (!hayCambios || saving || bloqueado) && { opacity: 0.4 },
            ]}
            testID="jugadores-reset"
          >
            <RotateCcw size={14} color={colors.text.primary} />
            <Text style={styles.resetBtnText}>Deshacer</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={abrirPreview}
            disabled={saving}
            style={[styles.previewBtn, saving && { opacity: 0.4 }]}
            testID="jugadores-preview"
          >
            <Eye size={14} color={colors.brand.primary} />
            <Text style={styles.previewBtnText}>Vista previa</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={guardar}
            disabled={!hayCambios || saving || bloqueado}
            style={[
              styles.saveBtn,
              (!hayCambios || saving || bloqueado) && { opacity: 0.5 },
            ]}
            testID="jugadores-save"
          >
            {saving ? (
              <ActivityIndicator color={colors.text.inverse} size="small" />
            ) : (
              <>
                {hayCambios ? (
                  <Save size={16} color={colors.text.inverse} />
                ) : (
                  <CheckCircle2 size={16} color={colors.text.inverse} />
                )}
                <Text style={styles.saveBtnText}>
                  {hayCambios ? "Guardar distribución" : "Sin cambios"}
                </Text>
              </>
            )}
          </TouchableOpacity>
        </View>

        {/* ============ Modal de Vista Previa del Rol Round Robin ============ */}
        {previewOpen ? (
          <View style={styles.modalBackdrop} pointerEvents="auto">
            <View style={styles.modalCard}>
              <View style={styles.modalHeader}>
                <Eye size={16} color={colors.brand.primary} />
                <Text style={styles.modalTitle}>Vista previa del rol</Text>
                <TouchableOpacity
                  onPress={cerrarPreview}
                  style={styles.modalCloseBtn}
                  testID="preview-close"
                >
                  <Text style={styles.modalCloseTxt}>Cerrar</Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.modalSubtitle}>
                Round Robin generado con la distribución actual ·{" "}
                {hayCambios ? "Sin guardar" : "Guardado"}
              </Text>

              {previewLoading ? (
                <View style={{ paddingVertical: spacing.xl }}>
                  <ActivityIndicator color={colors.brand.primary} />
                </View>
              ) : (
                <ScrollView
                  style={{ maxHeight: 480 }}
                  contentContainerStyle={{ paddingBottom: spacing.lg }}
                  showsVerticalScrollIndicator={false}
                >
                  {previewData.length === 0 ? (
                    <Text style={styles.modalEmpty}>
                      No se pudo generar el preview.
                    </Text>
                  ) : (
                    previewData.map((cancha) => (
                      <View key={`pc-${cancha.cancha}`} style={styles.previewCanchaBlock}>
                        <View style={styles.previewCanchaHeader}>
                          <Text style={styles.previewCanchaTitle}>
                            Cancha {cancha.cancha}
                          </Text>
                          <Text style={styles.previewCanchaMeta}>
                            {cancha.rondas.length} rondas
                          </Text>
                        </View>
                        {cancha.rondas.map((r) => (
                          <View key={`pr-${cancha.cancha}-${r.ronda}`} style={styles.previewRonda}>
                            <Text style={styles.previewRondaLabel}>
                              Ronda {r.ronda}
                            </Text>
                            {r.partidos.map((p, idx) => (
                              <View
                                key={`pp-${cancha.cancha}-${r.ronda}-${idx}`}
                                style={styles.previewPartido}
                              >
                                <Text style={styles.previewPair} numberOfLines={1}>
                                  {p.pareja_a.join(" + ")}
                                </Text>
                                <Text style={styles.previewVs}>VS</Text>
                                <Text
                                  style={styles.previewPair}
                                  numberOfLines={1}
                                >
                                  {p.pareja_b.join(" + ")}
                                </Text>
                              </View>
                            ))}
                          </View>
                        ))}
                      </View>
                    ))
                  )}
                </ScrollView>
              )}
            </View>
          </View>
        ) : null}
      </SafeAreaView>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg.app },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.bg.card,
  },
  title: { ...typography.h2 },
  subtle: { ...typography.caption, color: colors.text.secondary },
  bannerInfo: {
    marginHorizontal: spacing.lg,
    marginVertical: spacing.sm,
    backgroundColor: colors.bg.elevated,
    borderRadius: radii.md,
    padding: spacing.sm,
  },
  bannerInfoText: {
    ...typography.caption,
    color: colors.text.secondary,
    textAlign: "center",
  },
  bannerLock: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.xs,
    marginHorizontal: spacing.lg,
    marginVertical: spacing.sm,
    backgroundColor: colors.status.amberBg,
    borderColor: colors.status.amberBorder,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.sm,
  },
  bannerLockText: {
    ...typography.caption,
    color: colors.status.amberText,
    flex: 1,
    lineHeight: 16,
  },
  bandaHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.xs,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
  },
  bandaTitle: {
    ...typography.label,
    fontSize: 11,
    letterSpacing: 1.4,
    color: colors.brand.primary,
    fontWeight: "800",
    flex: 1,
  },
  bandaCount: {
    backgroundColor: colors.brand.primary + "15",
    borderRadius: radii.pill,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  bandaCountText: {
    ...typography.mono,
    fontSize: 10,
    color: colors.brand.primary,
    fontWeight: "800",
  },
  item: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.bg.card,
    borderRadius: radii.md,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    marginVertical: 4,
    borderWidth: 1,
    borderColor: colors.border.subtle,
  },
  itemActive: {
    borderColor: colors.brand.primary,
    backgroundColor: colors.brand.primary + "08",
    ...Platform.select({
      web: { boxShadow: "0 6px 16px rgba(5,150,105,0.18)" as any },
      ios: {
        shadowColor: colors.brand.primary,
        shadowOpacity: 0.18,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 4 },
      },
      android: { elevation: 4 },
    }),
  },
  itemPlaceholder: {
    borderStyle: "dashed",
    backgroundColor: "transparent",
  },
  itemBloqueado: {
    opacity: 0.7,
  },
  itemName: {
    ...typography.body,
    fontWeight: "700",
    color: colors.text.primary,
  },
  itemNamePlaceholder: {
    color: colors.text.muted,
    fontStyle: "italic",
    fontWeight: "500",
  },
  itemMeta: {
    ...typography.caption,
    color: colors.text.secondary,
    marginTop: 2,
  },
  placeholderBadge: {
    backgroundColor: colors.bg.elevated,
    borderRadius: radii.pill,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  placeholderBadgeText: {
    ...typography.label,
    fontSize: 9,
    color: colors.text.muted,
    letterSpacing: 1,
  },
  footer: {
    flexDirection: "row",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.bg.app,
    borderTopWidth: 1,
    borderTopColor: colors.border.subtle,
  },
  resetBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    backgroundColor: colors.bg.card,
  },
  resetBtnText: { ...typography.button, fontSize: 13 },
  saveBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: spacing.sm + 2,
    borderRadius: radii.md,
    backgroundColor: colors.brand.primary,
  },
  saveBtnText: {
    ...typography.button,
    color: colors.text.inverse,
    fontSize: 14,
  },
  // ===== Botón "Vista previa" en el footer =====
  previewBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.brand.primary + "40",
    backgroundColor: colors.brand.primary + "10",
  },
  previewBtnText: {
    ...typography.button,
    fontSize: 13,
    color: colors.brand.primary,
  },
  // ===== Modal de Vista Previa =====
  modalBackdrop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(15,23,42,0.5)",
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.lg,
    zIndex: 1000,
  },
  modalCard: {
    width: "100%",
    maxWidth: 500,
    backgroundColor: colors.bg.card,
    borderRadius: radii.lg,
    padding: spacing.lg,
    ...Platform.select({
      web: { boxShadow: "0 20px 50px rgba(0,0,0,0.25)" as any },
      ios: {
        shadowColor: "#000",
        shadowOpacity: 0.25,
        shadowRadius: 24,
        shadowOffset: { width: 0, height: 12 },
      },
      android: { elevation: 12 },
    }),
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  modalTitle: {
    ...typography.h3,
    flex: 1,
  },
  modalSubtitle: {
    ...typography.caption,
    color: colors.text.secondary,
    marginTop: 2,
    marginBottom: spacing.md,
  },
  modalCloseBtn: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: radii.pill,
    backgroundColor: colors.bg.elevated,
  },
  modalCloseTxt: {
    ...typography.label,
    fontSize: 11,
    color: colors.text.primary,
  },
  modalEmpty: {
    ...typography.body,
    color: colors.text.secondary,
    textAlign: "center",
    paddingVertical: spacing.lg,
  },
  previewCanchaBlock: {
    marginBottom: spacing.md,
  },
  previewCanchaHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingBottom: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.border.subtle,
    marginBottom: spacing.sm,
  },
  previewCanchaTitle: {
    ...typography.label,
    fontSize: 11,
    letterSpacing: 1.4,
    color: colors.brand.primary,
    fontWeight: "800",
  },
  previewCanchaMeta: {
    ...typography.caption,
    color: colors.text.muted,
  },
  previewRonda: {
    marginBottom: spacing.sm,
    backgroundColor: colors.bg.elevated,
    borderRadius: radii.md,
    padding: spacing.sm,
  },
  previewRondaLabel: {
    ...typography.label,
    fontSize: 10,
    color: colors.text.secondary,
    letterSpacing: 1,
    marginBottom: 4,
  },
  previewPartido: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingVertical: 4,
  },
  previewPair: {
    ...typography.caption,
    fontSize: 13,
    flex: 1,
    color: colors.text.primary,
    fontWeight: "600",
  },
  previewVs: {
    ...typography.label,
    fontSize: 9,
    color: colors.text.muted,
    paddingHorizontal: 4,
  },
});
