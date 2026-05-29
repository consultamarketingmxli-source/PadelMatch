/**
 * ClubAutocomplete — Selector híbrido de clubes de pádel.
 *
 * Comportamiento:
 *   - Input de texto libre. A medida que el organizador escribe (debounce 300ms)
 *     buscamos en el directorio y mostramos resultados con dirección secundaria.
 *   - Botón GPS opcional para ordenar por proximidad (timeout duro 5s).
 *   - Si el texto no coincide con ningún resultado, se ofrece al final del
 *     desplegable: "Usar '[texto]' como ubicación personalizada".
 *   - Permite siempre escribir libremente: nunca bloquea, nunca obliga.
 *
 * Props:
 *   - value: texto actual del nombre de club.
 *   - onChange: (texto, opcionalClubSeleccionado) => void
 *       * El segundo argumento sólo se envía cuando el usuario tap-eó un club
 *         del directorio; en ese caso el padre debe guardar club_id + dirección
 *         + lat/lng. Si selecciona "Usar como personalizada" o sigue escribiendo,
 *         el segundo argumento es null y club_id debe limpiarse.
 *
 * Anti-fallos:
 *   - GPS apagado/denegado/timeout → no crashea, sólo desactiva el icono.
 *   - Backend caído → render dropdown vacío, sigue funcionando el texto libre.
 *   - Coordenadas nulas → no se muestra distancia ni se filtra ese registro.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Locate, MapPin, Plus } from "lucide-react-native";
import * as Location from "expo-location";

import { ClubDir, api } from "@/src/api";
import { colors, radii, spacing, typography } from "@/src/theme";

type Props = {
  value: string;
  onChange: (texto: string, club: ClubDir | null) => void;
  label?: string;
  placeholder?: string;
  testID?: string;
  /** Limita búsqueda a este número de resultados. Default 8. */
  limit?: number;
};

type GpsState = "idle" | "loading" | "active" | "denied" | "error";

export function ClubAutocomplete({
  value,
  onChange,
  label = "Lugar / Club",
  placeholder = "Empieza a escribir: Padel...",
  testID = "club-autocomplete",
  limit = 8,
}: Props) {
  const [focused, setFocused] = useState(false);
  const [results, setResults] = useState<ClubDir[]>([]);
  const [loading, setLoading] = useState(false);
  const [gpsState, setGpsState] = useState<GpsState>("idle");
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  // Cuando el usuario tap-ea un club, lo marcamos para hidratar dirección.
  const [pickedClub, setPickedClub] = useState<ClubDir | null>(null);
  // Bandera de backend unavailable — degradación visible (no silenciosa).
  const [backendError, setBackendError] = useState<boolean>(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reqIdRef = useRef(0);
  // Token único por intento GPS — descartamos respuestas obsoletas si timeout.
  const gpsTokenRef = useRef(0);
  // Flag de desmontaje — evita setState tras unmount.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  // ===== Búsqueda con debounce =====
  const runSearch = useCallback(
    async (q: string, lat?: number, lng?: number) => {
      const myReq = ++reqIdRef.current;
      setLoading(true);
      try {
        const params: { q?: string; lat?: number; lng?: number; limit?: number } = { limit };
        if (q.trim()) params.q = q.trim();
        if (lat !== undefined && lng !== undefined) {
          params.lat = lat;
          params.lng = lng;
        }
        const res = await api.buscarClubes(params);
        if (!mountedRef.current) return;
        // Race-condition guard: ignora respuestas viejas.
        if (myReq !== reqIdRef.current) return;
        setResults(res?.results ?? []);
        // Si el backend reporta error, lo marcamos para mostrar hint visible.
        setBackendError(Boolean((res as any)?.error));
      } catch {
        // Backend caído / red intermitente — degradamos a lista vacía
        // pero AVISAMOS al usuario con un hint.
        if (mountedRef.current && myReq === reqIdRef.current) {
          setResults([]);
          setBackendError(true);
        }
      } finally {
        if (mountedRef.current && myReq === reqIdRef.current) setLoading(false);
      }
    },
    [limit],
  );

  // Trigger búsqueda cuando cambia value o coords (debounce 300ms).
  useEffect(() => {
    if (!focused) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void runSearch(value, coords?.lat, coords?.lng);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [value, focused, coords, runSearch]);

  // Disparar primera búsqueda al ganar foco aunque no haya texto.
  const handleFocus = () => {
    setFocused(true);
    if (!results.length) {
      void runSearch(value, coords?.lat, coords?.lng);
    }
  };

  const handleBlur = () => {
    // Pequeño delay para permitir el tap en una opción antes de cerrar.
    // 250ms es más holgado para mobile lento (era 180ms y a veces el tap
    // se perdía si el dispositivo tardaba en propagar el evento).
    setTimeout(() => {
      if (mountedRef.current) setFocused(false);
    }, 250);
  };

  // ===== GPS toggle con timeout duro 5s + cancellation token =====
  const toggleGps = async () => {
    // Si ya estaba activo lo apagamos.
    if (gpsState === "active") {
      setGpsState("idle");
      setCoords(null);
      void runSearch(value); // re-buscamos sin geo
      return;
    }
    const myToken = ++gpsTokenRef.current;
    setGpsState("loading");
    try {
      // En web, expo-location puede tardar; ponemos timeout duro 5s.
      const gpsPromise = (async () => {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== "granted") {
          return { kind: "denied" as const };
        }
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        return { kind: "ok" as const, pos };
      })();
      const timeoutPromise = new Promise<{ kind: "timeout" }>((resolve) =>
        setTimeout(() => resolve({ kind: "timeout" }), 5000),
      );
      const result: any = await Promise.race([gpsPromise, timeoutPromise]);
      // Si otro toggle se disparó entretanto, descartamos esta respuesta.
      if (!mountedRef.current || myToken !== gpsTokenRef.current) return;
      if (result.kind === "denied") {
        setGpsState("denied");
        return;
      }
      if (result.kind === "timeout") {
        setGpsState("error");
        return;
      }
      const c = { lat: result.pos.coords.latitude, lng: result.pos.coords.longitude };
      setCoords(c);
      setGpsState("active");
      void runSearch(value, c.lat, c.lng);
    } catch {
      if (mountedRef.current && myToken === gpsTokenRef.current) {
        setGpsState("error");
      }
    }
  };

  // ===== Handlers de selección =====
  const pickClub = (c: ClubDir) => {
    setPickedClub(c);
    setFocused(false);
    onChange(c.nombre, c);
  };

  const useCustom = () => {
    setPickedClub(null);
    setFocused(false);
    onChange(value.trim(), null);
  };

  const handleTextChange = (t: string) => {
    // Si el usuario cambia el texto después de haber seleccionado un club,
    // limpiamos el "picked" para que el padre sepa que ahora es libre.
    if (pickedClub && t !== pickedClub.nombre) {
      setPickedClub(null);
      onChange(t, null);
    } else {
      onChange(t, pickedClub);
    }
  };

  const showDropdown = focused && (results.length > 0 || (value.trim().length >= 2));
  const hasExactMatch = useMemo(
    () => results.some((r) => r.nombre.trim().toLowerCase() === value.trim().toLowerCase()),
    [results, value],
  );

  // ===== Render =====
  return (
    <View style={styles.wrap} testID={testID}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <View style={[styles.inputRow, focused && styles.inputRowFocused]}>
        <MapPin size={16} color={colors.text.secondary} />
        <TextInput
          value={value}
          onChangeText={handleTextChange}
          onFocus={handleFocus}
          onBlur={handleBlur}
          placeholder={placeholder}
          placeholderTextColor={colors.text.secondary + "80"}
          style={styles.input}
          autoCapitalize="words"
          autoCorrect={false}
          testID={`${testID}-input`}
        />
        <TouchableOpacity
          onPress={toggleGps}
          style={[
            styles.gpsBtn,
            gpsState === "active" && styles.gpsBtnActive,
            (gpsState === "denied" || gpsState === "error") && styles.gpsBtnDimmed,
          ]}
          activeOpacity={0.7}
          testID={`${testID}-gps`}
          accessibilityLabel="Ordenar por cercanía"
        >
          {gpsState === "loading" ? (
            <ActivityIndicator size="small" color={colors.brand.primary} />
          ) : (
            <Locate
              size={16}
              color={
                gpsState === "active"
                  ? "#fff"
                  : (gpsState === "denied" || gpsState === "error")
                  ? colors.text.secondary
                  : colors.brand.primary
              }
            />
          )}
        </TouchableOpacity>
      </View>

      {/* Hint de estado GPS — silencioso si todo OK */}
      {gpsState === "denied" ? (
        <Text style={styles.gpsHint} testID={`${testID}-gps-denied`}>
          GPS denegado. Puedes seguir buscando por texto.
        </Text>
      ) : gpsState === "error" ? (
        <Text style={styles.gpsHint} testID={`${testID}-gps-error`}>
          Ubicación no disponible. Búsqueda por texto activa.
        </Text>
      ) : gpsState === "active" ? (
        <Text style={[styles.gpsHint, { color: colors.brand.primary }]} testID={`${testID}-gps-active`}>
          📍 Ordenados por cercanía
        </Text>
      ) : null}

      {/* Hint de backend no disponible — directorio degradado, texto libre sigue funcionando */}
      {backendError && focused ? (
        <Text style={[styles.gpsHint, { color: colors.status.red }]} testID={`${testID}-backend-error`}>
          ⚠️ Directorio no disponible. Puedes escribir el nombre libremente.
        </Text>
      ) : null}

      {/* Dropdown de resultados */}
      {showDropdown ? (
        <View style={styles.dropdown} testID={`${testID}-dropdown`}>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            style={{ maxHeight: 260 }}
            nestedScrollEnabled
          >
            {loading && results.length === 0 ? (
              <View style={styles.row}>
                <ActivityIndicator size="small" color={colors.brand.primary} />
                <Text style={styles.rowSubMuted}>Buscando…</Text>
              </View>
            ) : results.length === 0 ? (
              <View style={styles.row}>
                <Text style={styles.rowSubMuted}>
                  No hay clubes con ese nombre. Puedes usar el texto que escribiste como ubicación personalizada.
                </Text>
              </View>
            ) : (
              results.map((c) => (
                <Pressable
                  key={c.id}
                  onPress={() => pickClub(c)}
                  style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                  testID={`${testID}-row-${c.id}`}
                >
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.rowName} numberOfLines={1}>{c.nombre}</Text>
                    {c.direccion_completa ? (
                      <Text style={styles.rowSub} numberOfLines={1}>{c.direccion_completa}</Text>
                    ) : null}
                  </View>
                  {c.distancia_km != null ? (
                    <Text style={styles.rowDist}>{c.distancia_km.toFixed(1)} km</Text>
                  ) : null}
                </Pressable>
              ))
            )}

            {/* Opción "Usar '[texto]' como ubicación personalizada" — al final */}
            {!hasExactMatch && value.trim().length >= 2 ? (
              <Pressable
                onPress={useCustom}
                style={({ pressed }) => [styles.customRow, pressed && styles.rowPressed]}
                testID={`${testID}-use-custom`}
              >
                <Plus size={14} color={colors.brand.primary} />
                <Text style={styles.customRowText}>
                  Usar “<Text style={{ fontWeight: "900" }}>{value.trim()}</Text>” como ubicación personalizada
                </Text>
              </Pressable>
            ) : null}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginBottom: spacing.md,
    position: "relative" as const,
    // CRÍTICO: stacking-context propio para que el dropdown absolute
    // se renderice POR ENCIMA de inputs hermanos en react-native-web.
    // Sin este zIndex, el input "Dirección" intercepta los taps.
    zIndex: Platform.OS === "web" ? 100 : 1,
    ...(Platform.OS === "web" ? ({ isolation: "isolate" } as any) : {}),
  },
  label: {
    ...typography.label,
    color: colors.text.secondary,
    marginBottom: 6,
    fontSize: 11,
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: colors.border.default,
    backgroundColor: colors.bg.card,
    borderRadius: radii.md,
    paddingHorizontal: 12,
    minHeight: 48,
  },
  inputRowFocused: {
    borderColor: colors.brand.primary,
  },
  input: {
    flex: 1,
    color: colors.text.primary,
    fontSize: 15,
    paddingVertical: Platform.OS === "ios" ? 12 : 8,
    outlineWidth: 0 as any, // web: quita el ring del navegador
  },
  gpsBtn: {
    width: 36,
    height: 36,
    borderRadius: radii.sm,
    backgroundColor: colors.bg.app,
    borderWidth: 1,
    borderColor: colors.border.default,
    alignItems: "center",
    justifyContent: "center",
  },
  gpsBtnActive: {
    backgroundColor: colors.brand.primary,
    borderColor: colors.brand.primary,
  },
  gpsBtnDimmed: {
    opacity: 0.55,
  },
  gpsHint: {
    color: colors.text.secondary,
    fontSize: 11,
    marginTop: 4,
    marginLeft: 2,
  },
  dropdown: {
    marginTop: 4,
    borderWidth: 1,
    borderColor: colors.border.default,
    backgroundColor: colors.bg.card,
    borderRadius: radii.md,
    overflow: "hidden",
    // En web flotamos por encima; en mobile queda inline (más fiable que absolute).
    ...(Platform.OS === "web"
      ? {
          position: "absolute" as const,
          top: 78,
          left: 0,
          right: 0,
          zIndex: 50,
          shadowColor: "#000",
          shadowOpacity: 0.08,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 4 },
        }
      : {}),
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border.default,
    backgroundColor: colors.bg.card,
  },
  rowPressed: {
    backgroundColor: colors.brand.primarySoft,
  },
  rowName: {
    color: colors.text.primary,
    fontSize: 14,
    fontWeight: "700",
  },
  rowSub: {
    color: colors.text.secondary,
    fontSize: 12,
    marginTop: 1,
  },
  rowSubMuted: {
    color: colors.text.secondary,
    fontSize: 12,
    fontStyle: "italic",
    flex: 1,
  },
  rowDist: {
    color: colors.brand.primary,
    fontSize: 11,
    fontWeight: "900",
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: radii.sm,
    backgroundColor: colors.brand.primarySoft,
  },
  customRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: colors.bg.app,
  },
  customRowText: {
    color: colors.text.primary,
    fontSize: 13,
    flex: 1,
  },
});
