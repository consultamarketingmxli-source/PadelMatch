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
import { BrandHeader } from "@/src/components/BrandHeader";
import { EmptyState } from "@/src/components/EmptyState";
import { colors, radii, spacing, typography } from "@/src/theme";

export default function HomeScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [retas, setRetas] = useState<Reta[]>([]);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [locStatus, setLocStatus] = useState<"unknown" | "granted" | "denied" | "timeout">("unknown");
  const [radius, setRadius] = useState(30);
  const [query, setQuery] = useState("");

  const fetchRetas = useCallback(
    async (lat?: number, lng?: number, rk = 30) => {
      try {
        const data = await api.radar(lat, lng, rk);
        // Orden de fallback: fecha más próxima primero (cuando no hay GPS).
        const ordered = lat == null
          ? [...data].sort((a, b) => (a.fecha_evento || "").localeCompare(b.fecha_evento || ""))
          : data;
        setRetas(ordered);
      } catch (e) {
        console.warn("Error radar:", e);
        setRetas([]);
      }
    },
    [],
  );

  // Helper con timeout duro para getCurrentPositionAsync.
  // expo-location rara vez se cuelga, pero en navegadores con GPS lento o en
  // dispositivos con permisos parcialmente revocados puede quedar pendiente.
  const getPositionWithTimeout = async (timeoutMs: number) => {
    return Promise.race<Awaited<ReturnType<typeof Location.getCurrentPositionAsync>>>([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("GPS_TIMEOUT")), timeoutMs),
      ) as Promise<never>,
    ]);
  };

  const requestGPS = useCallback(async () => {
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== "granted") {
        setLocStatus("denied");
        // Fallback: lista completa por fecha más próxima.
        await fetchRetas();
        return;
      }
      setLocStatus("granted");
      try {
        const pos = await getPositionWithTimeout(6000);
        const c = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setCoords(c);
        await fetchRetas(c.lat, c.lng, radius);
      } catch (geoErr) {
        // Timeout o error de hardware: degradamos a lista completa sin congelar la app.
        console.warn("GPS timeout/err, fallback a lista completa:", geoErr);
        setLocStatus("timeout");
        await fetchRetas();
      }
    } catch (e) {
      console.warn("GPS denied/error, falling back to all retas:", e);
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

  // Filtro de búsqueda en cliente — siempre funciona aunque el GPS falle.
  const filteredRetas = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return retas;
    return retas.filter((r) =>
      (r.nombre || "").toLowerCase().includes(q) ||
      (r.club || "").toLowerCase().includes(q),
    );
  }, [retas, query]);

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <BrandHeader
        testID="home-header"
        wordmarkSize="md"
        logoSize={32}
        right={
          <>
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
      <Text style={styles.tagline}>Tu reta de pádel, a un toque de pala</Text>

      <View style={styles.searchBar}>
        <Search size={14} color={colors.text.tertiary} />
        <TextInput
          testID="search-input"
          style={styles.searchInput}
          placeholder="Buscar club, ciudad o nombre de reta"
          placeholderTextColor={colors.text.tertiary}
          value={query}
          onChangeText={setQuery}
          autoCorrect={false}
          maxLength={60}
          returnKeyType="search"
        />
      </View>

      <View style={styles.radarBar}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flex: 1 }}>
          <Radar size={16} color={colors.brand.primary} />
          <Text style={styles.radarLabel}>
            {locStatus === "granted"
              ? `Radar activo · ${radius}km`
              : locStatus === "timeout"
              ? "GPS lento · mostrando todas"
              : locStatus === "denied"
              ? "Sin GPS · mostrando todas"
              : "Detectando ubicación…"}
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
          data={filteredRetas}
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
            <EmptyState
              testID="empty-radar"
              title={query ? "Sin resultados" : "Sin retas en el radar"}
              subtitle={
                query
                  ? `No encontramos retas que coincidan con "${query}".`
                  : locStatus === "granted"
                  ? `Ningún torneo de pádel en ${radius}km a la redonda. Vuelve más tarde o pide a tu club que cree una reta.`
                  : "No hay retas activas en este momento. Vuelve más tarde o explora otros clubes."
              }
            />
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg.app },
  tagline: {
    ...typography.bodySm,
    color: colors.text.secondary,
    paddingHorizontal: spacing.base,
    paddingBottom: spacing.sm,
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    marginTop: spacing.xs,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.bg.card,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border.default,
  },
  searchInput: {
    flex: 1,
    fontFamily: typography.body.fontFamily as string,
    fontSize: 14,
    color: colors.text.primary,
    paddingVertical: 0,
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
  radarLabel: { ...typography.label, color: colors.text.primary },
  gpsCta: {
    backgroundColor: colors.brand.primary,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radii.sm,
  },
  gpsCtaText: { ...typography.button, color: colors.text.inverse, fontSize: 11 },
  listContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xl,
  },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
});
