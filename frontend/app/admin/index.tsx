/** Admin dashboard: lista de retas con filtros. */
import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { BarChart3, Gift, LogOut, Plus, Repeat, ShieldOff, Wallet } from "lucide-react-native";

import { api, Reta } from "@/src/api";
import { storage } from "@/src/utils/storage";
import { RetaCard } from "@/src/components/RetaCard";
import { Button } from "@/src/components/Button";
import { BrandHeader } from "@/src/components/BrandHeader";
import { EmptyState } from "@/src/components/EmptyState";
import { AdminPanicButton } from "@/src/components/AdminPanicButton";
import { useRequireAdmin } from "@/src/hooks/useRequireAdmin";
import { clearLastRole } from "@/src/utils/roleSelection";
import { colors, radii, spacing, typography } from "@/src/theme";

export default function AdminDashboard() {
  const router = useRouter();
  useRequireAdmin();
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
    await clearLastRole();
    router.replace("/admin/login");
  };

  /**
   * Cierra sesión en TODOS los dispositivos del admin actual.
   * Revoca todos los refresh tokens en backend. Cualquier sesión activa
   * (incluso esta) quedará invalidada al expirar su access token (15min).
   */
  const revokeAllSessions = async () => {
    Alert.alert(
      "Cerrar sesión global",
      "Vas a cerrar sesión en TODOS los dispositivos donde ingresaste con esta cuenta de admin. Los tokens activos se invalidarán automáticamente en máximo 15 minutos.",
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Cerrar todo",
          style: "destructive",
          onPress: async () => {
            try {
              const token = await storage.secureGet<string>("ppos.admin.token", "");
              if (!token) {
                router.replace("/admin/login");
                return;
              }
              const r = await api.revokeAllSessions(token);
              await clearLastRole();
              Alert.alert(
                "Sesiones cerradas",
                `Se cerraron ${r.sessions_revoked} sesiones activas. Inicia sesión nuevamente.`,
                [{ text: "OK", onPress: () => router.replace("/admin/login") }],
              );
            } catch {
              Alert.alert("Error", "No se pudo cerrar las sesiones. Intenta más tarde.");
            }
          },
        },
      ],
    );
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
            <TouchableOpacity
              onPress={async () => {
                await clearLastRole();
                router.replace("/seleccion");
              }}
              style={styles.iconBtn}
              testID="admin-switch-role-btn"
              accessibilityLabel="Cambiar de ambiente"
            >
              <Repeat size={18} color={colors.text.secondary} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => router.push("/admin/mercadopago" as any)} style={styles.iconBtn} testID="mercadopago-btn">
              <Wallet size={18} color={colors.brand.primary} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => router.push("/admin/marketing" as any)} style={styles.iconBtn} testID="marketing-btn">
              <Gift size={18} color="#F59E0B" />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => router.push("/admin/dashboard" as any)} style={styles.iconBtn} testID="dashboard-btn">
              <BarChart3 size={18} color={colors.brand.primary} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={revokeAllSessions}
              style={styles.iconBtn}
              testID="revoke-all-sessions-btn"
              accessibilityLabel="Cerrar sesión en todos los dispositivos"
            >
              <ShieldOff size={18} color={colors.status.red} />
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

      {/* Fase 4 — Asistente de Operación: botón de pánico flotante.
          Pasa la primera reta activa como atajo directo a Mesa de Control. */}
      <AdminPanicButton activeRetaId={retas.length > 0 ? retas[0].id : undefined} />
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
