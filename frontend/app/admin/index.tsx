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
import { BarChart3, Gift, LogOut, Plus, Wallet } from "lucide-react-native";

import { api, Reta } from "@/src/api";
import { RetaCard } from "@/src/components/RetaCard";
import { Button } from "@/src/components/Button";
import { BrandHeader } from "@/src/components/BrandHeader";
import { EmptyState } from "@/src/components/EmptyState";
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
      <BrandHeader
        testID="admin-header"
        wordmarkSize="md"
        logoSize={32}
        right={
          <>
            <TouchableOpacity onPress={() => router.push("/admin/mercadopago" as any)} style={styles.iconBtn} testID="mercadopago-btn">
              <Wallet size={18} color={colors.brand.primary} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => router.push("/admin/marketing" as any)} style={styles.iconBtn} testID="marketing-btn">
              <Gift size={18} color="#F59E0B" />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => router.push("/admin/dashboard" as any)} style={styles.iconBtn} testID="dashboard-btn">
              <BarChart3 size={18} color={colors.brand.primary} />
            </TouchableOpacity>
            <TouchableOpacity onPress={logout} style={styles.iconBtn} testID="logout-btn">
              <LogOut size={18} color={colors.status.red} />
            </TouchableOpacity>
          </>
        }
      />
      <View style={styles.subhead}>
        <Text style={styles.subheadLabel}>Panel admin</Text>
        <Text style={styles.subheadCount}>
          <Text style={styles.subheadCountNum}>{retas.length}</Text>
          {" reta"}{retas.length === 1 ? "" : "s"}{" activa"}{retas.length === 1 ? "" : "s"}
        </Text>
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
            <EmptyState
              testID="admin-empty"
              title="Sin retas todavía"
              subtitle="Crea tu primer torneo Round Robin para 8 jugadores."
            />
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg.app },
  subhead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: spacing.base,
    paddingBottom: spacing.sm,
  },
  subheadLabel: { ...typography.label, color: colors.text.secondary },
  subheadCount: { ...typography.bodySm, color: colors.text.secondary },
  subheadCountNum: { ...typography.monoBold, fontSize: 14, color: colors.text.primary },
  iconBtn: {
    width: 40, height: 40, borderRadius: radii.md,
    backgroundColor: colors.bg.card, borderWidth: 1, borderColor: colors.border.default,
    alignItems: "center", justifyContent: "center",
  },
  ctaBar: { paddingHorizontal: spacing.lg, marginBottom: spacing.sm },
  listContent: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.xxl },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
});
