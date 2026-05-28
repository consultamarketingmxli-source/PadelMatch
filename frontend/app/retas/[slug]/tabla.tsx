/**
 * Tabla de Clasificación en Vivo (Fase C).
 *
 * Ruta pública: `/retas/[slug]/tabla` (requiere jugador APROBADO o admin).
 *
 * Comportamiento:
 *   - Carga inicial: GET /retas/{id}/clasificacion con player token (o admin).
 *   - WebSocket: useRetaRealtime escucha `standings_updated` y refetch.
 *   - Si caller NO está aprobado → pantalla amigable de denegación con CTA.
 *   - Empty state visual cuando no hay partidos jugados aún.
 *
 * Diseño Club Pro Clean:
 *   - Cabecera fija sticky con columnas alineadas mono.
 *   - Líder (#1) con badge dorado.
 *   - DG verde esmeralda (positivo, "+12") / rojo suave (negativo, "-5") / gris (0).
 *   - Tipografía monoespaciada en columnas numéricas para alineación pixel-perfect.
 */
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  ArrowLeft,
  Award,
  Lock,
  Radio,
  RefreshCw,
  ShieldAlert,
  Trophy,
  Wifi,
  WifiOff,
} from "lucide-react-native";

import { Reta, TablaPosicionEntry, api } from "@/src/api";
import { CourtLinesBackground } from "@/src/components/CourtLinesBackground";
import { useRetaRealtime } from "@/src/hooks/useRetaRealtime";
import { storage } from "@/src/utils/storage";
import { colors, radii, spacing, typography } from "@/src/theme";

const ADMIN_TOKEN_KEY = "ppos.admin.token";
const PLAYER_TOKEN_KEY = "padelappretas.player.token";

const COLORS = {
  emerald: "#059669",  // text-emerald-600 equivalente
  rose: "#F43F5E",     // text-rose-500
  gold: "#D4A23B",
  goldBg: "#FBF1DD",
};

type AuthState =
  | { kind: "loading" }
  | { kind: "no-token" }
  | { kind: "not-approved"; reason: string }
  | { kind: "ok"; token: string; role: "admin" | "player" };

export default function TablaEnVivo() {
  const router = useRouter();
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const [reta, setReta] = useState<Reta | null>(null);
  const [tabla, setTabla] = useState<TablaPosicionEntry[]>([]);
  const [auth, setAuth] = useState<AuthState>({ kind: "loading" });
  const [refreshing, setRefreshing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // 1) Resolver reta por slug
  useEffect(() => {
    if (!slug) return;
    (async () => {
      try {
        const r = await api.getRetaBySlug(slug as string);
        setReta(r);
      } catch (e: any) {
        setErrorMsg(e.message ?? "No se pudo cargar la reta");
      }
    })();
  }, [slug]);

  // 2) Resolver token (admin o player) y probar acceso
  useEffect(() => {
    if (!reta) return;
    (async () => {
      const adminToken = await storage.secureGet<string>(ADMIN_TOKEN_KEY, "");
      const playerToken = await AsyncStorage.getItem(PLAYER_TOKEN_KEY);

      // Prioridad: si hay admin token, prueba ese (siempre concede acceso).
      if (adminToken) {
        try {
          const t = await api.getClasificacionAdmin(reta.id);
          setTabla(t);
          setAuth({ kind: "ok", token: adminToken, role: "admin" });
          return;
        } catch {
          // si admin token expirado, intentamos player
        }
      }
      if (playerToken) {
        try {
          const t = await api.getClasificacionPlayer(reta.id, playerToken);
          setTabla(t);
          setAuth({ kind: "ok", token: playerToken, role: "player" });
          return;
        } catch (e: any) {
          if (e.message?.startsWith("403")) {
            setAuth({
              kind: "not-approved",
              reason: e.message.includes("pago aún no")
                ? "Tu pago aún no está aprobado. Vuelve aquí cuando tu inscripción esté confirmada."
                : "Esta tabla solo es visible para jugadores aprobados en esta reta.",
            });
            return;
          }
        }
      }
      setAuth({ kind: "no-token" });
    })();
  }, [reta]);

  // 3) WebSocket realtime — solo activo cuando tenemos auth ok
  const refetch = useCallback(async () => {
    if (!reta || auth.kind !== "ok") return;
    try {
      const t = auth.role === "admin"
        ? await api.getClasificacionAdmin(reta.id)
        : await api.getClasificacionPlayer(reta.id, auth.token);
      setTabla(t);
    } catch {
      // silencioso: si el refetch falla, el siguiente broadcast la traerá
    }
  }, [reta, auth]);

  const { status: wsStatus } = useRetaRealtime(
    reta?.id,
    auth.kind === "ok" ? auth.token : null,
    {
      enabled: auth.kind === "ok",
      onUpdate: () => void refetch(),
    },
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  // ============== Render branches ==============
  if (errorMsg) {
    return <ErrorScreen title="No se pudo cargar" message={errorMsg} onBack={() => router.back()} />;
  }
  if (!reta || auth.kind === "loading") {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}><ActivityIndicator color={colors.brand.primary} /></View>
      </SafeAreaView>
    );
  }
  if (auth.kind === "no-token") {
    return (
      <DeniedScreen
        title="Inicia sesión"
        message="Para ver la tabla en vivo, ingresa con tu teléfono."
        icon={<Lock size={36} color={colors.brand.primary} />}
        ctaLabel="Ingresar"
        onCta={() => router.push("/login" as any)}
        onBack={() => router.back()}
      />
    );
  }
  if (auth.kind === "not-approved") {
    return (
      <DeniedScreen
        title="Acceso restringido"
        message={auth.reason}
        icon={<ShieldAlert size={36} color={colors.status.amber} />}
        ctaLabel="Volver a la reta"
        onCta={() => router.push(`/retas/${slug}` as any)}
        onBack={() => router.back()}
      />
    );
  }

  // ============== Tabla principal ==============
  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <CourtLinesBackground opacity={0.035} />
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="tabla-back">
          <ArrowLeft size={18} color={colors.text.primary} />
        </TouchableOpacity>
        <View style={{ flex: 1, alignItems: "center" }}>
          <Text style={styles.title}>Clasificación</Text>
          <Text style={styles.subtle} numberOfLines={1}>{reta.nombre}</Text>
        </View>
        <WsBadge status={wsStatus} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brand.primary} />
        }
      >
        {tabla.length === 0 ? (
          <View style={styles.emptyCard}>
            <Trophy size={36} color={colors.brand.primary} />
            <Text style={styles.emptyTitle}>Aún no hay partidos jugados</Text>
            <Text style={styles.emptyText}>
              La tabla se actualizará en vivo en cuanto el organizador capture el primer marcador.
            </Text>
            <View style={styles.liveDot}>
              <Radio size={12} color={colors.brand.primary} />
              <Text style={styles.liveDotText}>
                {wsStatus === "open" ? "Conectado en vivo" : "Reconectando…"}
              </Text>
            </View>
          </View>
        ) : (
          <TablaBody tabla={tabla} />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function TablaBody({ tabla }: { tabla: TablaPosicionEntry[] }) {
  return (
    <View style={styles.table}>
      {/* Cabecera */}
      <View style={[styles.row, styles.headerRow]}>
        <Text style={[styles.cellPos, styles.headCell]}>#</Text>
        <Text style={[styles.cellName, styles.headCell]}>JUGADOR</Text>
        <Text style={[styles.cellNum, styles.headCell]}>PJ</Text>
        <Text style={[styles.cellNum, styles.headCell]}>PG</Text>
        <Text style={[styles.cellNum, styles.headCell]}>GF</Text>
        <Text style={[styles.cellNum, styles.headCell]}>GC</Text>
        <Text style={[styles.cellNum, styles.headCell]}>DG</Text>
      </View>
      {tabla.map((e, i) => <TablaRow key={e.nombre + i} entry={e} pos={i + 1} />)}
    </View>
  );
}

function TablaRow({ entry, pos }: { entry: TablaPosicionEntry; pos: number }) {
  const isLeader = pos === 1;
  const dgColor =
    entry.diferencia > 0 ? COLORS.emerald
    : entry.diferencia < 0 ? COLORS.rose
    : colors.text.muted;
  const dgPrefix = entry.diferencia > 0 ? "+" : "";

  return (
    <View style={[styles.row, isLeader && styles.leaderRow]} testID={`row-pos-${pos}`}>
      <View style={styles.cellPos}>
        {isLeader ? (
          <View style={styles.leaderBadge}>
            <Award size={11} color={COLORS.gold} />
            <Text style={styles.leaderBadgeText}>1</Text>
          </View>
        ) : (
          <Text style={[styles.posText, pos <= 3 && { fontWeight: "900" }]}>{pos}º</Text>
        )}
      </View>
      <Text style={[styles.cellName, styles.nameText]} numberOfLines={1}>{entry.nombre}</Text>
      <Text style={[styles.cellNum, styles.monoText]}>{entry.partidos_jugados}</Text>
      <Text style={[styles.cellNum, styles.monoText, { fontWeight: "900" }]}>{entry.partidos_ganados}</Text>
      <Text style={[styles.cellNum, styles.monoText]}>{entry.juegos_a_favor}</Text>
      <Text style={[styles.cellNum, styles.monoText]}>{entry.juegos_en_contra}</Text>
      <Text style={[styles.cellNum, styles.monoText, { color: dgColor, fontWeight: "900" }]}>
        {dgPrefix}{entry.diferencia}
      </Text>
    </View>
  );
}

function WsBadge({ status }: { status: string }) {
  const open = status === "open";
  return (
    <View style={[styles.wsBadge, open ? styles.wsOpen : styles.wsClosed]} testID={`ws-${status}`}>
      {open ? <Wifi size={11} color={colors.status.green} /> : <WifiOff size={11} color={colors.text.muted} />}
      <Text style={[styles.wsBadgeText, { color: open ? colors.status.green : colors.text.muted }]}>
        {open ? "EN VIVO" : "…"}
      </Text>
    </View>
  );
}

function DeniedScreen(props: {
  title: string;
  message: string;
  icon: React.ReactNode;
  ctaLabel: string;
  onCta: () => void;
  onBack: () => void;
}) {
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={props.onBack} style={styles.iconBtn}>
          <ArrowLeft size={18} color={colors.text.primary} />
        </TouchableOpacity>
        <Text style={styles.title}>Clasificación</Text>
        <View style={{ width: 40 }} />
      </View>
      <View style={styles.deniedCard} testID="denied-card">
        <View style={styles.deniedIcon}>{props.icon}</View>
        <Text style={styles.deniedTitle}>{props.title}</Text>
        <Text style={styles.deniedText}>{props.message}</Text>
        <Pressable onPress={props.onCta} style={styles.deniedCta} testID="denied-cta">
          <Text style={styles.deniedCtaText}>{props.ctaLabel}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

function ErrorScreen({ title, message, onBack }: { title: string; message: string; onBack: () => void }) {
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={onBack} style={styles.iconBtn}>
          <ArrowLeft size={18} color={colors.text.primary} />
        </TouchableOpacity>
        <Text style={styles.title}>{title}</Text>
        <View style={{ width: 40 }} />
      </View>
      <View style={styles.center}>
        <RefreshCw size={32} color={colors.text.muted} />
        <Text style={[styles.deniedText, { marginTop: 16 }]}>{message}</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg.app },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl },
  topBar: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
  },
  iconBtn: {
    width: 40, height: 40, borderRadius: radii.md,
    backgroundColor: colors.bg.card, borderWidth: 1, borderColor: colors.border.default,
    alignItems: "center", justifyContent: "center",
  },
  title: { ...typography.h2, color: colors.text.primary, fontSize: 17 },
  subtle: { color: colors.text.secondary, fontSize: 11, marginTop: 2 },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl },

  // ===== WS Badge =====
  wsBadge: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 8, paddingVertical: 5,
    borderRadius: radii.pill, borderWidth: 1,
  },
  wsOpen: {
    backgroundColor: "rgba(22, 163, 74, 0.08)",
    borderColor: colors.status.green,
  },
  wsClosed: {
    backgroundColor: colors.bg.card,
    borderColor: colors.border.default,
  },
  wsBadgeText: { fontSize: 10, fontWeight: "800", letterSpacing: 0.5 },

  // ===== Tabla =====
  table: {
    backgroundColor: colors.bg.card,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border.default,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border.default,
  },
  headerRow: {
    backgroundColor: colors.bg.elevated,
    paddingVertical: 8,
  },
  leaderRow: {
    backgroundColor: COLORS.goldBg,
  },
  headCell: {
    color: colors.text.muted,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1,
  },
  cellPos: { width: 38, alignItems: "center", justifyContent: "center" },
  cellName: { flex: 1.6, paddingHorizontal: 4 },
  cellNum: {
    width: 32,
    textAlign: "center",
    fontSize: 12,
  },
  posText: { color: colors.text.secondary, fontSize: 13, fontWeight: "700" },
  leaderBadge: {
    flexDirection: "row", alignItems: "center", gap: 3,
    backgroundColor: COLORS.gold,
    borderRadius: radii.pill,
    paddingHorizontal: 8, paddingVertical: 3,
  },
  leaderBadgeText: { color: "#fff", fontWeight: "900", fontSize: 11 },
  nameText: { color: colors.text.primary, fontWeight: "700", fontSize: 13 },
  monoText: {
    color: colors.text.primary,
    fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }),
  },

  // ===== Empty =====
  emptyCard: {
    backgroundColor: colors.bg.card,
    borderWidth: 1, borderColor: colors.border.default,
    borderRadius: radii.lg, padding: spacing.xl,
    alignItems: "center", gap: spacing.sm,
  },
  emptyTitle: { ...typography.h2, color: colors.text.primary, fontSize: 16, textAlign: "center" },
  emptyText: { color: colors.text.secondary, fontSize: 12, textAlign: "center", lineHeight: 17 },
  liveDot: {
    flexDirection: "row", gap: 4, alignItems: "center", marginTop: spacing.md,
    paddingHorizontal: 10, paddingVertical: 5,
    backgroundColor: "rgba(5, 150, 105, 0.08)",
    borderRadius: radii.pill,
  },
  liveDotText: { color: colors.brand.primary, fontSize: 11, fontWeight: "700" },

  // ===== Denied =====
  deniedCard: {
    margin: spacing.lg,
    padding: spacing.xl,
    backgroundColor: colors.bg.card,
    borderWidth: 1, borderColor: colors.border.default,
    borderRadius: radii.lg,
    alignItems: "center", gap: spacing.md,
  },
  deniedIcon: {
    width: 80, height: 80,
    borderRadius: 40,
    backgroundColor: colors.bg.elevated,
    alignItems: "center", justifyContent: "center",
  },
  deniedTitle: { ...typography.h2, color: colors.text.primary, fontSize: 18, textAlign: "center" },
  deniedText: { color: colors.text.secondary, fontSize: 13, textAlign: "center", lineHeight: 19 },
  deniedCta: {
    backgroundColor: colors.brand.primary,
    paddingHorizontal: 22, paddingVertical: 12,
    borderRadius: radii.pill,
    marginTop: spacing.sm,
  },
  deniedCtaText: { color: colors.text.inverse, fontWeight: "800", fontSize: 14 },
});
