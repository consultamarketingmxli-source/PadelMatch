/** Tabla de posiciones pública de una reta. */
import React, { useCallback, useEffect, useState } from "react";
import {
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ArrowLeft, Crown, Trophy } from "lucide-react-native";

import { api, TablaPosicionEntry } from "@/src/api";
import { SmartLoader, Skeleton } from "@/src/components/loaders";
import { colors, radii, spacing, typography } from "@/src/theme";

export default function TablaPosicionesScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [data, setData] = useState<TablaPosicionEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const t = await api.tablaPosiciones(id);
      setData(t);
    } catch {
      setData([]);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="tabla-back">
          <ArrowLeft size={18} color={colors.text.primary} />
        </TouchableOpacity>
        <Text style={styles.title}>Tabla de Posiciones</Text>
        <View style={{ width: 40 }} />
      </View>

      {loading ? (
        <SmartLoader loading={loading} skeleton={<Skeleton.Standings count={6} />} />
      ) : (
        <FlatList
          data={data}
          keyExtractor={(d, idx) => `${d.nombre}-${idx}`}
          contentContainerStyle={styles.list}
          ListHeaderComponent={
            <View style={styles.headerCard}>
              <Trophy size={18} color={colors.brand.primary} />
              <Text style={styles.headerHint}>
                3 puntos por victoria · 1 por empate · 0 por derrota
              </Text>
            </View>
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>Sin resultados todavía</Text>
              <Text style={styles.emptyText}>
                Cuando el organizador capture los marcadores aparecerán aquí.
              </Text>
            </View>
          }
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brand.primary} />
          }
          renderItem={({ item, index }) => (
            <View style={[styles.row, index === 0 && styles.rowGold]}>
              <View style={styles.posWrap}>
                {index === 0 ? (
                  <Crown size={16} color={colors.brand.primary} />
                ) : (
                  <Text style={styles.posText}>{index + 1}</Text>
                )}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.name} numberOfLines={1}>{item.nombre}</Text>
                <Text style={styles.meta}>
                  PJ {item.partidos_jugados} · G {item.partidos_ganados} · E {item.partidos_empatados} · P {item.partidos_perdidos} · Dif {item.diferencia >= 0 ? `+${item.diferencia}` : item.diferencia}
                </Text>
              </View>
              <View style={styles.pointsBox}>
                <Text style={styles.pointsValue}>{item.puntos}</Text>
                <Text style={styles.pointsLabel}>pts</Text>
              </View>
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg.app },
  topBar: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
  },
  iconBtn: {
    width: 40, height: 40, borderRadius: radii.md,
    backgroundColor: colors.bg.card, borderWidth: 1, borderColor: colors.border.default,
    alignItems: "center", justifyContent: "center",
  },
  title: { ...typography.h2, color: colors.text.primary, fontSize: 18 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  list: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.sm },
  headerCard: {
    flexDirection: "row", gap: spacing.sm, alignItems: "center",
    backgroundColor: colors.brand.primarySoft, borderRadius: radii.md,
    padding: spacing.md, marginBottom: spacing.md,
    borderWidth: 1, borderColor: colors.brand.primaryBorder,
  },
  headerHint: { flex: 1, color: colors.text.secondary, fontSize: 12 },
  row: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    backgroundColor: colors.bg.card, borderRadius: radii.md,
    padding: spacing.md, borderWidth: 1, borderColor: colors.border.default,
  },
  rowGold: { borderColor: colors.brand.primaryBorder, backgroundColor: colors.brand.primarySoft },
  posWrap: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: colors.bg.elevated, alignItems: "center", justifyContent: "center",
  },
  posText: { color: colors.text.primary, fontWeight: "800", fontSize: 13 },
  name: { ...typography.bodyBold, color: colors.text.primary },
  meta: { color: colors.text.secondary, fontSize: 11, marginTop: 2 },
  pointsBox: { alignItems: "center", minWidth: 50 },
  pointsValue: { color: colors.brand.primary, fontSize: 22, fontWeight: "900" },
  pointsLabel: { color: colors.text.muted, fontSize: 10, letterSpacing: 1 },
  empty: { paddingVertical: spacing.xxl, alignItems: "center", gap: spacing.sm },
  emptyTitle: { ...typography.h2, color: colors.text.primary, fontSize: 18 },
  emptyText: { color: colors.text.secondary, textAlign: "center", paddingHorizontal: spacing.lg },
});
