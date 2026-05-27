/**
 * Pantalla admin para capturar resultados de partidos del torneo.
 * Carga el rol Round Robin generado y permite ingresar el score por partido.
 * Cada update es un upsert atómico por (reta_id, cancha, ronda, partido_idx).
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
import { ArrowLeft, BarChart2, Check, Trophy } from "lucide-react-native";

import { api, PartidoResultado, RolResponse } from "@/src/api";
import { colors, radii, spacing, typography } from "@/src/theme";

type ScoreState = Record<string, { a: string; b: string; saving?: boolean; saved?: boolean }>;

const keyFor = (cancha: number, ronda: number, idx: number) => `${cancha}:${ronda}:${idx}`;

export default function CapturarResultados() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [rol, setRol] = useState<RolResponse | null>(null);
  const [scores, setScores] = useState<ScoreState>({});
  const [loading, setLoading] = useState(true);
  const [canchaActiva, setCanchaActiva] = useState(1);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const [rolData, existing] = await Promise.all([
        api.getRol(id),
        api.listResultados(id),
      ]);
      setRol(rolData);
      // Hidratar scores guardados
      const initial: ScoreState = {};
      existing.forEach((r: PartidoResultado) => {
        initial[keyFor(r.cancha, r.ronda, r.partido_idx)] = {
          a: String(r.score_a),
          b: String(r.score_b),
          saved: true,
        };
      });
      setScores(initial);
    } catch (e: any) {
      Alert.alert("Error", e.message ?? "No se pudo cargar el rol");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const updateScore = (k: string, field: "a" | "b", value: string) => {
    const cleaned = value.replace(/[^0-9]/g, "").slice(0, 2);
    setScores((s) => ({
      ...s,
      [k]: { ...(s[k] ?? { a: "", b: "" }), [field]: cleaned, saved: false },
    }));
  };

  const saveScore = async (
    cancha: number,
    ronda: number,
    idx: number,
    parejaA: [string, string],
    parejaB: [string, string],
  ) => {
    if (!id) return;
    const k = keyFor(cancha, ronda, idx);
    const cur = scores[k];
    if (!cur || cur.a === "" || cur.b === "") {
      Alert.alert("Captura incompleta", "Ingresa el marcador de ambas parejas.");
      return;
    }
    const sa = parseInt(cur.a, 10);
    const sb = parseInt(cur.b, 10);
    setScores((s) => ({ ...s, [k]: { ...cur, saving: true } }));
    try {
      await api.upsertResultado(id, {
        cancha,
        ronda,
        partido_idx: idx,
        pareja_a: parejaA,
        pareja_b: parejaB,
        score_a: sa,
        score_b: sb,
      });
      setScores((s) => ({ ...s, [k]: { a: String(sa), b: String(sb), saved: true } }));
    } catch (e: any) {
      Alert.alert("Error", e.message ?? "No se pudo guardar");
      setScores((s) => ({ ...s, [k]: { ...cur, saving: false, saved: false } }));
    }
  };

  const totalPartidos = useMemo(() => {
    if (!rol) return 0;
    return rol.rol.reduce((acc, c) => acc + c.rondas.reduce((a2, r) => a2 + r.partidos.length, 0), 0);
  }, [rol]);
  const guardados = useMemo(
    () => Object.values(scores).filter((s) => s.saved).length,
    [scores],
  );

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
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
        <View style={styles.topBar}>
          <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="resultados-back">
            <ArrowLeft size={18} color={colors.text.primary} />
          </TouchableOpacity>
          <View style={{ flex: 1, alignItems: "center" }}>
            <Text style={styles.title}>Resultados</Text>
            <Text style={styles.subtle}>{guardados} / {totalPartidos} partidos capturados</Text>
          </View>
          <TouchableOpacity
            onPress={() => router.push(`/retas/tabla/${id}` as any)}
            style={styles.iconBtn}
            testID="resultados-tabla"
          >
            <BarChart2 size={18} color={colors.brand.primary} />
          </TouchableOpacity>
        </View>

        {rol.canchas > 1 ? (
          <View style={styles.canchasBar}>
            {rol.rol.map((c) => (
              <TouchableOpacity
                key={c.cancha}
                onPress={() => setCanchaActiva(c.cancha)}
                style={[styles.canchaTab, canchaActiva === c.cancha && styles.canchaTabActive]}
              >
                <Text style={[styles.canchaTabText, canchaActiva === c.cancha && styles.canchaTabTextActive]}>
                  Cancha {c.cancha}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        ) : null}

        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          {canchaData.rondas.map((ronda) => (
            <View key={ronda.ronda} style={styles.rondaWrap}>
              <View style={styles.rondaHead}>
                <Trophy size={14} color={colors.brand.primary} />
                <Text style={styles.rondaTitle}>Ronda {ronda.ronda}</Text>
              </View>
              {ronda.partidos.map((p, idx) => {
                const k = keyFor(canchaData.cancha, ronda.ronda, idx);
                const st = scores[k] ?? { a: "", b: "" };
                const saving = st.saving;
                const saved = st.saved;
                return (
                  <View key={k} style={[styles.partidoCard, saved && styles.partidoCardSaved]}>
                    <View style={styles.parejaRow}>
                      <Text style={styles.parejaText} numberOfLines={1}>
                        {p.pareja_a.join(" + ")}
                      </Text>
                      <TextInput
                        testID={`score-${k}-a`}
                        value={st.a}
                        onChangeText={(v) => updateScore(k, "a", v)}
                        keyboardType="number-pad"
                        maxLength={2}
                        style={styles.scoreInput}
                        placeholder="—"
                        placeholderTextColor={colors.text.muted}
                      />
                    </View>
                    <View style={styles.vsRow}><Text style={styles.vsText}>vs</Text></View>
                    <View style={styles.parejaRow}>
                      <Text style={styles.parejaText} numberOfLines={1}>
                        {p.pareja_b.join(" + ")}
                      </Text>
                      <TextInput
                        testID={`score-${k}-b`}
                        value={st.b}
                        onChangeText={(v) => updateScore(k, "b", v)}
                        keyboardType="number-pad"
                        maxLength={2}
                        style={styles.scoreInput}
                        placeholder="—"
                        placeholderTextColor={colors.text.muted}
                      />
                    </View>
                    <TouchableOpacity
                      testID={`save-${k}`}
                      onPress={() => saveScore(canchaData.cancha, ronda.ronda, idx, p.pareja_a, p.pareja_b)}
                      disabled={!!saving}
                      style={[styles.saveBtn, saved && styles.saveBtnDone, saving && { opacity: 0.6 }]}
                    >
                      {saving ? (
                        <ActivityIndicator color={colors.text.inverse} size="small" />
                      ) : (
                        <>
                          <Check size={14} color={colors.text.inverse} />
                          <Text style={styles.saveBtnText}>{saved ? "Guardado" : "Guardar"}</Text>
                        </>
                      )}
                    </TouchableOpacity>
                  </View>
                );
              })}
            </View>
          ))}
        </ScrollView>
      </KeyboardAvoidingView>
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
    width: 40, height: 40, borderRadius: radii.md,
    backgroundColor: colors.bg.card, borderWidth: 1, borderColor: colors.border.default,
    alignItems: "center", justifyContent: "center",
  },
  title: { ...typography.h2, color: colors.text.primary },
  subtle: { color: colors.text.secondary, fontSize: 12, marginTop: 2 },
  canchasBar: {
    flexDirection: "row", gap: spacing.sm,
    paddingHorizontal: spacing.lg, paddingBottom: spacing.sm,
  },
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
  rondaTitle: { ...typography.label, color: colors.brand.primary, fontSize: 12 },
  partidoCard: {
    backgroundColor: colors.bg.card, borderWidth: 1, borderColor: colors.border.default,
    borderRadius: radii.md, padding: spacing.md, marginBottom: spacing.md,
    gap: spacing.sm,
  },
  partidoCardSaved: {
    borderColor: colors.status.green,
    backgroundColor: "rgba(22, 163, 74, 0.04)",
  },
  parejaRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  parejaText: { flex: 1, color: colors.text.primary, fontWeight: "600", fontSize: 14 },
  scoreInput: {
    width: 56, height: 44, textAlign: "center",
    borderWidth: 1, borderColor: colors.border.default, borderRadius: radii.md,
    fontSize: 18, fontWeight: "800", color: colors.text.primary,
    backgroundColor: colors.bg.elevated,
  },
  vsRow: { alignItems: "center" },
  vsText: { color: colors.text.muted, fontSize: 11, fontWeight: "700", letterSpacing: 1 },
  saveBtn: {
    marginTop: spacing.xs,
    backgroundColor: colors.brand.primary,
    paddingVertical: 10, borderRadius: radii.md,
    flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 6,
  },
  saveBtnDone: { backgroundColor: colors.status.green },
  saveBtnText: { color: colors.text.inverse, fontWeight: "800", fontSize: 13 },
});
