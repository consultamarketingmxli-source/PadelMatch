/** Landing público: radar GPS de retas en 30km. */
import React, { useCallback, useEffect, useState } from "react";
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
import * as Location from "expo-location";
import { MapPin, Radar, User, ShieldCheck } from "lucide-react-native";

import { api, Reta } from "@/src/api";
import { RetaCard } from "@/src/components/RetaCard";
import { Button } from "@/src/components/Button";
import { colors, radii, spacing, typography } from "@/src/theme";

export default function HomeScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [retas, setRetas] = useState<Reta[]>([]);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [locStatus, setLocStatus] = useState<"unknown" | "granted" | "denied">("unknown");
  const [radius, setRadius] = useState(30);

  const fetchRetas = useCallback(
    async (lat?: number, lng?: number, rk = 30) => {
      try {
        const data = await api.radar(lat, lng, rk);
        setRetas(data);
      } catch (e) {
        console.warn("Error radar:", e);
        setRetas([]);
      }
    },
    [],
  );

  const requestGPS = useCallback(async () => {
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== "granted") {
        setLocStatus("denied");
        await fetchRetas();
        return;
      }
      setLocStatus("granted");
      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const c = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      setCoords(c);
      await fetchRetas(c.lat, c.lng, radius);
    } catch (e) {
      console.warn("GPS error, falling back to all retas:", e);
      setLocStatus("denied");
      await fetchRetas();
    }
  }, [fetchRetas, radius]);

  useEffect(() => {
    (async () => {
      console.log("[Home] fetch start");
      setLoading(true);
      try {
        await fetchRetas();
        console.log("[Home] fetch ok");
      } catch (e) {
        console.error("[Home] fetch err", e);
      } finally {
        setLoading(false);
        console.log("[Home] loading off");
      }
    })();
  }, [fetchRetas]);

  const onRefresh = async () => {
    setRefreshing(true);
    if (coords) await fetchRetas(coords.lat, coords.lng, radius);
    else await fetchRetas();
    setRefreshing(false);
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.header}>
        <View>
          <Text style={styles.brand} testID="app-brand">PADELAPPRETAS</Text>
          <Text style={styles.tagline}>Tu reta de pádel, a un toque de pala</Text>
        </View>
        <View style={{ flexDirection: "row", gap: spacing.sm }}>
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
        </View>
      </View>

      <View style={styles.radarBar}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flex: 1 }}>
          <Radar size={16} color={colors.brand.primary} />
          <Text style={styles.radarLabel}>
            {locStatus === "granted"
              ? `Radar activo · ${radius}km`
              : "Sin GPS · mostrando todas"}
          </Text>
        </View>
        {locStatus !== "granted" ? (
          <TouchableOpacity
            testID="enable-gps-btn"
            onPress={requestGPS}
            style={styles.gpsCta}
          >
            <MapPin size={12} color={colors.text.inverse} />
            <Text style={styles.gpsCtaText}>Activar GPS</Text>
          </TouchableOpacity>
        ) : null}
      </View>

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
              onRefresh={onRefresh}
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
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>Sin retas en el radar</Text>
              <Text style={styles.emptyText}>
                Ningún torneo de pádel cerca por ahora. Vuelve más tarde o pide a tu club que cree
                una reta.
              </Text>
              <Button
                title="Soy organizador"
                variant="secondary"
                onPress={() => router.push("/admin/login")}
                testID="empty-go-admin-btn"
              />
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
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  brand: {
    color: colors.brand.primary,
    fontWeight: "900",
    fontSize: 16,
    letterSpacing: 2,
  },
  tagline: {
    color: colors.text.secondary,
    fontSize: 13,
    marginTop: 2,
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
  radarBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    marginVertical: spacing.sm,
    padding: spacing.md,
    backgroundColor: colors.bg.card,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border.default,
  },
  radarLabel: { ...typography.label, color: colors.text.primary, fontSize: 11 },
  gpsCta: {
    backgroundColor: colors.brand.primary,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radii.sm,
  },
  gpsCtaText: { color: colors.text.inverse, fontWeight: "800", fontSize: 11 },
  listContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xl,
  },
  empty: {
    paddingVertical: spacing.xxl,
    paddingHorizontal: spacing.lg,
    alignItems: "center",
    gap: spacing.md,
  },
  emptyTitle: {
    ...typography.h2,
    color: colors.text.primary,
    textAlign: "center",
  },
  emptyText: {
    color: colors.text.secondary,
    textAlign: "center",
    lineHeight: 20,
  },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
});
