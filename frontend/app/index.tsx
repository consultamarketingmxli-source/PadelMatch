/**
 * Pantalla principal del jugador — Motor de búsqueda HÍBRIDO.
 *
 * Toda la lógica de búsqueda (texto + GPS + fallback + GPS timeout + toasts)
 * vive en `useHybridSearch`. Esta vista sólo renderiza.
 */
import React from "react";
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
import { useRouter } from "expo-router";
import { ShieldCheck, Repeat, User } from "lucide-react-native";

import { RetaCard } from "@/src/components/RetaCard";
import { BrandHeader } from "@/src/components/BrandHeader";
import { EmptyState } from "@/src/components/EmptyState";
import { SearchBar } from "@/src/components/SearchBar";
import { Toast } from "@/src/components/Toast";
import { useHybridSearch } from "@/src/hooks/useHybridSearch";
import { getLastRole, clearLastRole } from "@/src/utils/roleSelection";
import { colors, radii, spacing, typography } from "@/src/theme";

export default function HomeScreen() {
  const router = useRouter();
  const [hasDualRole, setHasDualRole] = React.useState(false);
  const {
    retas,
    loading,
    refreshing,
    query,
    setQuery,
    gpsState,
    toggleGps,
    toast,
    dismissToast,
    subtitle,
    radiusKm,
    refresh,
  } = useHybridSearch();

  // Detectar acceso al hub: si el usuario tiene last_role guardado o un
  // token de admin, mostramos el icono "Cambiar de ambiente" en el header.
  React.useEffect(() => {
    (async () => {
      const last = await getLastRole();
      if (last) {
        setHasDualRole(true);
        return;
      }
      // Fallback: si tiene token admin, también consideramos dual.
      try {
        const AsyncStorage = require("@react-native-async-storage/async-storage").default;
        const adminTok = await AsyncStorage.getItem("ppos.admin.token");
        if (adminTok) setHasDualRole(true);
      } catch {
        /* no-op */
      }
    })();
  }, []);

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <BrandHeader
        testID="home-header"
        wordmarkSize="md"
        logoSize={32}
        right={
          <>
            {hasDualRole ? (
              <TouchableOpacity
                testID="nav-switch-role-btn"
                onPress={async () => {
                  await clearLastRole();
                  router.replace("/seleccion" as any);
                }}
                style={styles.iconBtn}
                accessibilityLabel="Cambiar de ambiente"
              >
                <Repeat size={18} color={colors.text.secondary} />
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity
              testID="nav-mi-cuenta-btn"
              onPress={async () => {
                const AsyncStorage = require("@react-native-async-storage/async-storage").default;
                const tok = await AsyncStorage.getItem("padelappretas.player.token");
                router.push(tok ? ("/mi-cuenta" as any) : ("/login" as any));
              }}
              style={styles.iconBtn}
            >
              <User size={18} color={colors.brand.primary} />
            </TouchableOpacity>
            <TouchableOpacity
              testID="nav-admin-btn"
              onPress={() => router.push("/admin/login")}
              style={styles.iconBtn}
            >
              <ShieldCheck size={18} color={colors.brand.primary} />
            </TouchableOpacity>
          </>
        }
      />

      <SearchBar
        value={query}
        onChangeText={setQuery}
        gpsState={gpsState}
        onTogglePress={toggleGps}
      />
      <Text style={styles.contextLine}>{subtitle}</Text>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.brand.primary} />
        </View>
      ) : (
        <FlatList
          testID="retas-list"
          data={retas}
          keyExtractor={(r) => r.id}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={refresh}
              tintColor={colors.brand.primary}
            />
          }
          renderItem={({ item }) => (
            <RetaCard
              reta={item}
              testID={`reta-card-${item.url_slug}`}
              onPress={() => router.push(`/retas/${item.url_slug}` as any)}
            />
          )}
          ListEmptyComponent={
            <EmptyState
              testID="empty-radar"
              title={
                query.trim()
                  ? "Sin resultados"
                  : gpsState === "active"
                  ? "Sin retas en el radar"
                  : "No hay retas activas"
              }
              subtitle={
                query.trim()
                  ? `No encontramos retas que coincidan con "${query.trim()}".`
                  : gpsState === "active"
                  ? `Ningún torneo de pádel en ${radiusKm} km a la redonda.`
                  : "Vuelve más tarde o pide a tu club que cree una reta."
              }
            />
          }
        />
      )}

      <Toast
        visible={!!toast}
        message={toast?.msg ?? ""}
        tone={toast?.tone}
        onHide={dismissToast}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg.app },
  contextLine: {
    ...typography.label,
    color: colors.text.secondary,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border.default,
    backgroundColor: colors.bg.card,
    alignItems: "center",
    justifyContent: "center",
  },
  listContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xl,
  },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
});
