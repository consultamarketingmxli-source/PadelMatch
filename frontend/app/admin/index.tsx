/** Admin dashboard: lista de retas con filtros. */
import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { BarChart3, LogOut, Plus, Settings } from "lucide-react-native";

import { api, Reta } from "@/src/api";
import { RetaCard } from "@/src/components/RetaCard";
import { Button } from "@/src/components/Button";
import { colors, radii, spacing, typography } from "@/src/theme";

export default function AdminDashboard() {
  const router = useRouter();
  const [retas, setRetas] = useState<Reta[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api.listRetasAdmin();
      setRetas(data);
    } catch (e) {
      // Token expired probably
      router.replace("/admin/login");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const logout = async () => {
    await api.logout();
    router.replace("/admin/login");
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.header}>
        <View>
          <Text style={styles.brand}>PADELRETA · ADMIN</Text>
          <Text style={styles.tagline}>{retas.length} reta{retas.length === 1 ? "" : "s"} activas</Text>
        </View>
        <View style={{ flexDirection: "row", gap: spacing.sm }}>
          <TouchableOpacity onPress={() => router.push("/admin/dashboard" as any)} style={styles.iconBtn} testID="dashboard-btn">
            <BarChart3 size={18} color={colors.brand.primary} />
          </TouchableOpacity>
          <TouchableOpacity onPress={logout} style={styles.iconBtn} testID="logout-btn">
            <LogOut size={18} color={colors.status.red} />
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.ctaBar}>
        <Button
          title="Crear nueva reta"
          onPress={() => router.push("/admin/reta/new")}
          icon={<Plus size={14} color={colors.text.inverse} />}
          testID="create-reta-btn"
        />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.brand.primary} />
        </View>
      ) : (
        <FlatList
          testID="admin-retas-list"
          data={retas}
          keyExtractor={(r) => r.id}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brand.primary} />
          }
          renderItem={({ item }) => (
            <RetaCard
              reta={item}
              testID={`admin-reta-${item.url_slug}`}
              onPress={() => router.push(`/admin/reta/${item.id}` as any)}
            />
          )}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>Sin retas todavía</Text>
              <Text style={styles.emptyText}>
                Crea tu primer torneo Round Robin para 8 jugadores.
              </Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg.app },
  header: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm,
  },
  brand: { color: colors.brand.primary, fontWeight: "900", letterSpacing: 2, fontSize: 14 },
  tagline: { color: colors.text.secondary, fontSize: 13, marginTop: 4 },
  iconBtn: {
    width: 40, height: 40, borderRadius: radii.md,
    backgroundColor: colors.bg.card, borderWidth: 1, borderColor: colors.border.default,
    alignItems: "center", justifyContent: "center",
  },
  ctaBar: { paddingHorizontal: spacing.lg, marginBottom: spacing.sm },
  listContent: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.xxl },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  empty: { paddingVertical: spacing.xxl, alignItems: "center", gap: spacing.md },
  emptyTitle: { ...typography.h2, color: colors.text.primary, textAlign: "center" },
  emptyText: { color: colors.text.secondary, textAlign: "center", lineHeight: 20 },
});
