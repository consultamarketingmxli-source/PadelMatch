/**
 * useHybridSearch — Encapsula la lógica del motor de búsqueda híbrido.
 *
 * Tres vías combinables:
 *  A) GPS opcional con timeout duro 6s y Haversine 30km (configurable).
 *  B) Texto libre con debounce 350ms (trim + lowercase server-side).
 *  C) Fallback automático por fecha_evento ASC si ninguno de los anteriores.
 *
 * Estado expuesto:
 *  - retas, loading, refreshing
 *  - query (texto), setQuery
 *  - gpsState ('idle'|'active'|'loading'|'denied'), toggleGps
 *  - coords (lat/lng o null)
 *  - subtitle contextual listo para renderizar
 *  - toast { msg, tone } | null + dismissToast()
 *  - refresh() para pull-to-refresh
 *
 * El componente consumidor sólo se preocupa de renderizar.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import * as Location from "expo-location";
import { api, Reta } from "@/src/api";

export type GpsState = "idle" | "active" | "loading" | "denied";
export type ToastTone = "info" | "warn" | "error";
export type ToastState = { msg: string; tone: ToastTone } | null;

export type UseHybridSearchOptions = {
  radiusKm?: number;
  debounceMs?: number;
  gpsTimeoutMs?: number;
};

const DEFAULTS = {
  radiusKm: 30,
  debounceMs: 350,
  gpsTimeoutMs: 6000,
};

/** Race entre getCurrentPositionAsync y un timeout para no congelar la UI. */
const getPositionWithTimeout = (timeoutMs: number) =>
  Promise.race<Awaited<ReturnType<typeof Location.getCurrentPositionAsync>>>([
    Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("GPS_TIMEOUT")), timeoutMs),
    ) as Promise<never>,
  ]);

export function useHybridSearch(opts: UseHybridSearchOptions = {}) {
  const radiusKm = opts.radiusKm ?? DEFAULTS.radiusKm;
  const debounceMs = opts.debounceMs ?? DEFAULTS.debounceMs;
  const gpsTimeoutMs = opts.gpsTimeoutMs ?? DEFAULTS.gpsTimeoutMs;

  const [retas, setRetas] = useState<Reta[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState("");
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [gpsState, setGpsState] = useState<GpsState>("idle");
  const [toast, setToast] = useState<ToastState>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const didMountRef = useRef(false);

  /** Llama al backend con los parámetros actuales. */
  const fetchHybrid = useCallback(
    async (q: string, useCoords: { lat: number; lng: number } | null) => {
      try {
        const data = await api.buscarRetas({
          q,
          lat: useCoords?.lat,
          lng: useCoords?.lng,
          radioKm: radiusKm,
        });
        setRetas(data);
      } catch (e) {
        console.warn("[useHybridSearch] error:", e);
        setRetas([]);
      }
    },
    [radiusKm],
  );

  // Debounced search. Trim aplicado; cadenas vacías → fallback (string vacío).
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const cleaned = query.trim();
    debounceRef.current = setTimeout(() => {
      fetchHybrid(cleaned, coords);
    }, debounceMs);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, coords, fetchHybrid, debounceMs]);

  // Carga inicial (fallback C — sin coords, sin query).
  useEffect(() => {
    if (didMountRef.current) return;
    didMountRef.current = true;
    (async () => {
      setLoading(true);
      try {
        await fetchHybrid("", null);
      } finally {
        setLoading(false);
      }
    })();
  }, [fetchHybrid]);

  const toggleGps = useCallback(async () => {
    // Si ya está activo → apagar.
    if (gpsState === "active") {
      setCoords(null);
      setGpsState("idle");
      setToast({
        msg: "Radar desactivado. Mostrando todas las retas por fecha.",
        tone: "info",
      });
      return;
    }
    setGpsState("loading");
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== "granted") {
        setGpsState("denied");
        setCoords(null);
        setToast({
          msg: "Ubicación desactivada. Mostrando todos los resultados por fecha.",
          tone: "warn",
        });
        return;
      }
      const pos = await getPositionWithTimeout(gpsTimeoutMs);
      const c = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      setCoords(c);
      setGpsState("active");
      setToast({
        msg: `Radar activo · retas en ${radiusKm}km a la redonda.`,
        tone: "info",
      });
    } catch (e: any) {
      const msg =
        e?.message === "GPS_TIMEOUT"
          ? "Tu GPS tardó demasiado. Mostrando todos los resultados por fecha."
          : "No pudimos obtener tu ubicación. Mostrando todos los resultados por fecha.";
      setGpsState("denied");
      setCoords(null);
      setToast({ msg, tone: "warn" });
    }
  }, [gpsState, radiusKm, gpsTimeoutMs]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await fetchHybrid(query.trim(), coords);
    setRefreshing(false);
  }, [fetchHybrid, query, coords]);

  const subtitle = (() => {
    if (gpsState === "active") return `Radar activo · ${radiusKm} km`;
    if (gpsState === "loading") return "Detectando ubicación…";
    if (gpsState === "denied") return "Sin GPS · ordenado por fecha";
    return "Todas las retas · ordenado por fecha";
  })();

  return {
    retas,
    loading,
    refreshing,
    query,
    setQuery,
    coords,
    gpsState,
    toggleGps,
    toast,
    dismissToast: () => setToast(null),
    subtitle,
    radiusKm,
    refresh,
  } as const;
}
