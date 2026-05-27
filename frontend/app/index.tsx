/**
 * Pantalla principal del jugador — Motor de búsqueda HÍBRIDO.
 *
 * Tres vías paralelas y combinables:
 *  A) GPS: botón con icono LocateFixed; si el usuario lo activa y acepta
 *     permisos, el backend filtra por radio Haversine (30km).
 *  B) Texto libre: input "Buscar por reta o club…" (debounce 350ms).
 *  C) Fallback automático: sin texto y sin GPS, lista TODAS las retas
 *     ordenadas por fecha_evento ASC.
 *
 * Blindaje de errores:
 *  - PERMISSION_DENIED / timeout 6s: toast informativo + fallback C.
 *  - Espacios vacíos en input: ignorados (no consulta backend).
 *  - Reta sin lat/lng: omitida del filtro geo en backend (no rompe la lista).
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
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
import { ShieldCheck, User } from "lucide-react-native";

import { api, Reta } from "@/src/api";
import { RetaCard } from "@/src/components/RetaCard";
import { BrandHeader } from "@/src/components/BrandHeader";
import { EmptyState } from "@/src/components/EmptyState";
import { SearchBar } from "@/src/components/SearchBar";
import { Toast } from "@/src/components/Toast";
import { colors, radii, spacing, typography } from "@/src/theme";

type GpsState = "idle" | "active" | "loading" | "denied";

export default function HomeScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [retas, setRetas] = useState<Reta[]>([]);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [gpsState, setGpsState] = useState<GpsState>("idle");
  const [query, setQuery] = useState("");
  const [radius] = useState(30);
  const [toast, setToast] = useState<{ msg: string; tone: "info" | "warn" | "error" } | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Llama al motor híbrido con los params actuales. */
  const fetchHybrid = useCallback(
    async (q: string, useCoords: { lat: number; lng: number } | null) => {
      try {
        const data = await api.buscarRetas({
          q,
          lat: useCoords?.lat,
          lng: useCoords?.lng,
          radioKm: radius,
        });
        setRetas(data);
      } catch (e) {
        console.warn("buscar error:", e);
        setRetas([]);
      }
    },
    [radius],
  );

  // Debounced text search. Ignora cadenas vacías / solo espacios.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const cleaned = query.trim();
    debounceRef.current = setTimeout(() => {
      fetchHybrid(cleaned, coords);
    }, 350);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, coords, fetchHybrid]);

  // Carga inicial (fallback C).
  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        await fetchHybrid("", null);
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Promesa con timeout duro para evitar congelar la UI si el GPS se cuelga. */
  const getPositionWithTimeout = async (timeoutMs: number) => {
    return Promise.race<Awaited<ReturnType<typeof Location.getCurrentPositionAsync>>>([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("GPS_TIMEOUT")), timeoutMs),
      ) as Promise<never>,
    ]);
  };

  const toggleGps = useCallback(async () => {
    // Si ya está activo → apagar y volver a fallback.
    if (gpsState === "active") {
      setCoords(null);
      setGpsState("idle");
      setToast({ msg: "Radar desactivado. Mostrando todas las retas por fecha.", tone: "info" });
      return;
    }
    setGpsState("loading");
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== "granted") {
        // PERMISSION_DENIED
        setGpsState("denied");
        setCoords(null);
        setToast({
          msg: "Ubicación desactivada. Mostrando todos los resultados por fecha.",
          tone: "warn",
        });
        return;
      }
      const pos = await getPositionWithTimeout(6000);
      const c = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      setCoords(c);
      setGpsState("active");
      setToast({ msg: `Radar activo · retas en ${radius}km a la redonda.`, tone: "info" });
    } catch (e: any) {
      const msg = e?.message === "GPS_TIMEOUT"
        ? "Tu GPS tardó demasiado. Mostrando todos los resultados por fecha."
        : "No pudimos obtener tu ubicación. Mostrando todos los resultados por fecha.";
      setGpsState("denied");
      setCoords(null);
      setToast({ msg, tone: "warn" });
    }
  }, [gpsState, radius]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchHybrid(query.trim(), coords);
    setRefreshing(false);
  };

  // Subtítulo contextual.
  const subtitle = (() => {
    if (gpsState === "active") return `Radar activo · ${radius} km`;
    if (gpsState === "loading") return "Detectando ubicación…";
    if (gpsState === "denied") return "Sin GPS · ordenado por fecha";
    return "Todas las retas · ordenado por fecha";
  })();

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
                  ? `Ningún torneo de pádel en ${radius} km a la redonda.`
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
        onHide={() => setToast(null)}
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
