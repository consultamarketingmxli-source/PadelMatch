/** Pantalla privada del jugador: historial + stats. */
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { LogOut, Trophy, Calendar, CheckCircle2, Clock, XCircle, ChevronRight } from "lucide-react-native";

import { PlayerInscripcion, PlayerStats, api } from "@/src/api";
import { colors, radii, spacing, typography } from "@/src/theme";

const PLAYER_TOKEN_KEY = "padelappretas.player.token";
const PLAYER_INFO_KEY = "padelappretas.player.info";

export default function MiCuenta() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [info, setInfo] = useState<{ nombre: string; telefono: string } | null>(null);
  const [inscripciones, setInscripciones] = useState<PlayerInscripcion[]>([]);
  const [stats, setStats] = useState<PlayerStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const t = await AsyncStorage.getItem(PLAYER_TOKEN_KEY);
    const i = await AsyncStorage.getItem(PLAYER_INFO_KEY);
    if (!t || !i) {
      router.replace("/login" as any);
      return;
    }
    setToken(t);
    setInfo(JSON.parse(i));
    try {
      const [ins, st] = await Promise.all([
        api.playerMyInscripciones(t),
        api.playerMyStats(t),
      ]);
      setInscripciones(ins);
      setStats(st);
    } catch (e: any) {
      // token expirado o inválido
      await AsyncStorage.removeItem(PLAYER_TOKEN_KEY);
      await AsyncStorage.removeItem(PLAYER_INFO_KEY);
      router.replace("/login" as any);
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => { void load(); }, [load]);
  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const logout = async () => {
    Alert.alert("Cerrar sesión", "¿Quieres salir de tu cuenta?", [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Salir",
        style: "destructive",
        onPress: async () => {
          await AsyncStorage.removeItem(PLAYER_TOKEN_KEY);
          await AsyncStorage.removeItem(PLAYER_INFO_KEY);
          router.replace("/" as any);
        },
      },
    ]);
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}><ActivityIndicator color={colors.brand.primary} /></View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brand.primary} />}
      >
        <View style={styles.topBar}>
          <View>
            <Text style={styles.hello}>¡Hola, {info?.nombre}!</Text>
            <Text style={styles.subtle}>{info?.telefono}</Text>
          </View>
          <TouchableOpacity onPress={logout} style={styles.iconBtn} testID="logout-btn">
            <LogOut size={16} color={colors.text.primary} />
          </TouchableOpacity>
        </View>

        {/* Stats */}
        <View style={styles.statsGrid}>
          <Stat label="Partidos" value={String(stats?.partidos_jugados ?? 0)} />
          <Stat label="Ganados" value={String(stats?.partidos_ganados ?? 0)} />
          <Stat label="Efectividad" value={`${stats?.efectividad ?? 0}%`} />
        </View>

        <Text style={styles.section}>Mis retas</Text>
        {inscripciones.length === 0 ? (
          <View style={styles.emptyCard}>
            <Trophy size={28} color={colors.brand.primary} />
            <Text style={styles.emptyTitle}>Aún no te inscribes a ninguna reta</Text>
            <Text style={styles.emptyText}>Encuentra retas cerca de ti en el radar.</Text>
            <TouchableOpacity onPress={() => router.push("/" as any)} style={styles.cta}>
              <Text style={styles.ctaText}>Ver radar</Text>
            </TouchableOpacity>
          </View>
        ) : (
          inscripciones.map((ins) => <InscRow key={ins.id} ins={ins} router={router} />)
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.statBox}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function InscRow({ ins, router }: { ins: PlayerInscripcion; router: any }) {
  const info = ins.estatus_pago === "Aprobado"
    ? { color: colors.status.green, icon: <CheckCircle2 size={14} color={colors.status.green} />, label: "Pagado" }
    : ins.estatus_pago === "Pendiente"
    ? { color: colors.status.amber, icon: <Clock size={14} color={colors.status.amber} />, label: "Pendiente" }
    : { color: colors.status.red, icon: <XCircle size={14} color={colors.status.red} />, label: ins.estatus_pago };
  const fecha = new Date(ins.fecha_evento);
  const fechaStr = fecha.toLocaleDateString("es-MX", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  return (
    <TouchableOpacity
      onPress={() => router.push(`/retas/${ins.reta_slug}` as any)}
      style={styles.insRow}
      testID={`mi-reta-${ins.id}`}
    >
      <Calendar size={18} color={colors.brand.primary} />
      <View style={{ flex: 1 }}>
        <Text style={styles.insName} numberOfLines={1}>{ins.reta_nombre}</Text>
        <Text style={styles.insMeta} numberOfLines={1}>{ins.club} · {fechaStr}</Text>
        <View style={styles.insEstatusRow}>
          {info.icon}
          <Text style={[styles.insEstatus, { color: info.color }]}>{info.label}</Text>
        </View>
      </View>
      <ChevronRight size={18} color={colors.text.muted} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg.app },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl },
  topBar: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    marginBottom: spacing.lg,
  },
  iconBtn: {
    width: 40, height: 40, borderRadius: radii.md, backgroundColor: colors.bg.card,
    borderWidth: 1, borderColor: colors.border.default, alignItems: "center", justifyContent: "center",
  },
  hello: { color: colors.text.primary, fontSize: 22, fontWeight: "900" },
  subtle: { color: colors.text.secondary, fontSize: 12, marginTop: 2 },
  statsGrid: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.lg },
  statBox: {
    flex: 1, backgroundColor: colors.bg.card, borderWidth: 1, borderColor: colors.border.default,
    borderRadius: radii.md, padding: spacing.md, alignItems: "center",
  },
  statValue: { color: colors.brand.primary, fontSize: 22, fontWeight: "900" },
  statLabel: { color: colors.text.secondary, fontSize: 11, marginTop: 2 },
  section: { ...typography.h2, color: colors.text.primary, fontSize: 16, marginBottom: spacing.sm },
  insRow: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    backgroundColor: colors.bg.card, borderWidth: 1, borderColor: colors.border.default,
    borderRadius: radii.md, padding: spacing.md, marginBottom: spacing.sm,
  },
  insName: { ...typography.bodyBold, color: colors.text.primary },
  insMeta: { color: colors.text.secondary, fontSize: 11, marginTop: 2 },
  insEstatusRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 6 },
  insEstatus: { fontSize: 11, fontWeight: "700" },
  emptyCard: {
    backgroundColor: colors.bg.card, borderWidth: 1, borderColor: colors.border.default,
    borderRadius: radii.md, padding: spacing.xl, alignItems: "center", gap: spacing.sm,
  },
  emptyTitle: { ...typography.h2, color: colors.text.primary, fontSize: 16, textAlign: "center" },
  emptyText: { color: colors.text.secondary, fontSize: 12, textAlign: "center" },
  cta: { backgroundColor: colors.brand.primary, paddingHorizontal: 18, paddingVertical: 10, borderRadius: radii.pill, marginTop: spacing.sm },
  ctaText: { color: colors.text.inverse, fontWeight: "800" },
});
