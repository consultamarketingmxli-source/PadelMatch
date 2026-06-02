/**
 * Mi Cuenta (Fase D — Portal Jugador Premium).
 *
 * Lo nuevo respecto a la versión legacy:
 *   • Stats con tarjeta "win/loss/efectividad" en grid 3+1.
 *   • Sección "En lista de espera" con la posición exacta + total en cola.
 *   • Carga paralela de inscripciones + stats + waitlist (resiliente, no rompe si una falla).
 *   • Pull-to-refresh global.
 *
 * Diseño: tarjetas Club Pro Clean — espaciado 8/16/24, bordes radii.md,
 * tipografía monoLarge para los números.
 */
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
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
import {
  Calendar,
  CheckCircle2,
  ChevronRight,
  Clock,
  FileText,
  Hourglass,
  LogOut,
  ShieldOff,
  Trash2,
  Trophy,
  XCircle,
} from "lucide-react-native";

import { PlayerInscripcion, PlayerStats, PlayerWaitlistItem, api } from "@/src/api";
import { colors, radii, spacing, typography } from "@/src/theme";
import { confirmAlert, infoAlert } from "@/src/utils/confirmAlert";
import { playerTokenStore } from "@/src/utils/playerTokenStore";

const PLAYER_TOKEN_KEY = "padelappretas.player.token";
const PLAYER_INFO_KEY = "padelappretas.player.info";

export default function MiCuenta() {
  const router = useRouter();
  const [info, setInfo] = useState<{ nombre: string; telefono: string } | null>(null);
  const [inscripciones, setInscripciones] = useState<PlayerInscripcion[]>([]);
  const [stats, setStats] = useState<PlayerStats | null>(null);
  const [waitlist, setWaitlist] = useState<PlayerWaitlistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const t = await playerTokenStore.get();
    const i = await AsyncStorage.getItem(PLAYER_INFO_KEY);
    if (!t || !i) {
      router.replace("/login" as any);
      return;
    }
    setInfo(JSON.parse(i));
    // settleAll: si una API falla no rompemos la pantalla entera.
    const [insRes, stRes, wlRes] = await Promise.allSettled([
      api.playerMyInscripciones(t),
      api.playerMyStats(t),
      api.playerMyWaitlist(t),
    ]);
    // Si el token está expirado, las 3 fallarán con 401 → forzamos logout.
    if (insRes.status === "rejected" && stRes.status === "rejected" && wlRes.status === "rejected") {
      await playerTokenStore.remove();
      await AsyncStorage.removeItem(PLAYER_INFO_KEY);
      router.replace("/login" as any);
      return;
    }
    if (insRes.status === "fulfilled") setInscripciones(insRes.value);
    if (stRes.status === "fulfilled") setStats(stRes.value);
    if (wlRes.status === "fulfilled") setWaitlist(wlRes.value);
    setLoading(false);
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const logout = () => {
    confirmAlert({
      title: "Cerrar sesión",
      message: "¿Quieres salir de tu cuenta?",
      confirmText: "Salir",
      destructive: true,
      onConfirm: async () => {
        await api.playerLogout();
        await playerTokenStore.remove();
        await AsyncStorage.removeItem(PLAYER_INFO_KEY);
        router.replace("/" as any);
      },
    });
  };

  /**
   * Apple App Store 5.1.1(v) — Eliminación de cuenta visible y de un paso.
   *
   * Aplicamos **doble confirmación** para prevenir tap accidental, pero la
   * acción en sí es de un solo paso una vez confirmada (sin redirección
   * a soporte, sin email manual). El backend anonimiza irreversiblemente.
   * Usa `confirmAlert` (cross-platform: window.confirm en web, Alert.alert nativo).
   */
  const handleDeleteAccount = async () => {
    const t = await playerTokenStore.get();
    if (!t) {
      router.replace("/login" as any);
      return;
    }
    confirmAlert({
      title: "Eliminar mi cuenta",
      message:
        "Se borrarán tu nombre, teléfono y datos personales de forma irreversible. " +
        "Tus partidos jugados se mantendrán como 'Usuario eliminado' para preservar " +
        "el histórico de torneos. ¿Continuar?",
      confirmText: "Eliminar definitivamente",
      destructive: true,
      onConfirm: () => {
        // Segunda confirmación.
        confirmAlert({
          title: "Confirmación final",
          message: "Esta acción no se puede deshacer. ¿Eliminar mi cuenta y datos personales?",
          confirmText: "Sí, eliminar",
          destructive: true,
          onConfirm: async () => {
            try {
              const res = await api.playerDeleteMyAccount(t);
              await playerTokenStore.remove();
              await AsyncStorage.removeItem(PLAYER_INFO_KEY);
              infoAlert(
                "Cuenta eliminada",
                res.mensaje || "Tus datos personales han sido eliminados.",
                () => router.replace("/" as any),
              );
            } catch (e: any) {
              const msg = String(e?.message || "");
              if (msg.startsWith("429")) {
                infoAlert(
                  "Demasiados intentos",
                  "Por seguridad, espera 1 hora antes de volver a intentarlo.",
                );
              } else {
                infoAlert(
                  "Error",
                  "No se pudo eliminar la cuenta. Intenta más tarde.",
                );
              }
            }
          },
        });
      },
    });
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <ActivityIndicator color={colors.brand.primary} />
        </View>
      </SafeAreaView>
    );
  }

  const jugados = stats?.partidos_jugados ?? 0;
  const ganados = stats?.partidos_ganados ?? 0;
  const perdidos = Math.max(0, jugados - ganados);
  const efect = stats?.efectividad ?? 0;

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.brand.primary}
          />
        }
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

        {/* Stats hero — efectividad gigante */}
        <View style={styles.heroCard}>
          <Text style={styles.heroLabel}>EFECTIVIDAD</Text>
          <Text style={styles.heroValue} testID="hero-efectividad">{efect}%</Text>
          <View style={styles.heroBarBg}>
            <View style={[styles.heroBarFg, { width: `${Math.min(100, efect)}%` }]} />
          </View>
          <Text style={styles.heroSub}>
            {jugados === 0 ? "Aún no has jugado partidos" : `${ganados}G · ${perdidos}P · ${jugados} totales`}
          </Text>
        </View>

        <View style={styles.statsGrid}>
          <Stat label="Jugados" value={String(jugados)} testID="stat-jugados" />
          <Stat label="Ganados" value={String(ganados)} accent={colors.status.green} testID="stat-ganados" />
          <Stat label="Perdidos" value={String(perdidos)} accent={colors.status.red} testID="stat-perdidos" />
        </View>

        {/* Lista de espera activa */}
        {waitlist.length > 0 ? (
          <>
            <Text style={styles.section}>
              <Hourglass size={14} color={colors.status.amber} />
              {"  "}En lista de espera ({waitlist.length})
            </Text>
            {waitlist.map((w) => (
              <WaitlistRow key={w.waitlist_id} w={w} router={router} />
            ))}
          </>
        ) : null}

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

        {/* === Privacidad y Seguridad (Apple App Store 5.1.1) === */}
        <Text style={styles.section}>Privacidad y seguridad</Text>

        <TouchableOpacity
          onPress={() => router.push("/seguridad" as any)}
          style={styles.linkCard}
          testID="btn-ir-seguridad"
        >
          <ShieldOff size={18} color={colors.brand.primary} />
          <View style={{ flex: 1 }}>
            <Text style={styles.linkTitle}>Centro de Privacidad y Seguridad</Text>
            <Text style={styles.linkHint}>
              Ver mis sesiones activas, actividad reciente y configuración.
            </Text>
          </View>
          <ChevronRight size={16} color={colors.text.tertiary} />
        </TouchableOpacity>

        {/* === Legal y Cumplimiento (Location B) === */}
        <TouchableOpacity
          onPress={() => router.push("/legal" as any)}
          style={styles.linkCard}
          testID="btn-ir-legal"
          accessibilityLabel="Legal y Cumplimiento"
        >
          <FileText size={18} color={colors.brand.primary} />
          <View style={{ flex: 1 }}>
            <Text style={styles.linkTitle}>Legal y Cumplimiento</Text>
            <Text style={styles.linkHint}>
              Términos, privacidad, licencias y versión de la app.
            </Text>
          </View>
          <ChevronRight size={16} color={colors.text.tertiary} />
        </TouchableOpacity>

        <View style={styles.privacyCard}>
          <View style={styles.privacyHead}>
            <ShieldOff size={18} color={colors.status.red} />
            <Text style={styles.privacyTitle}>Eliminar mi cuenta y datos personales</Text>
          </View>
          <Text style={styles.privacyText}>
            Tu nombre, teléfono e información personal serán borrados de forma
            permanente. Las inscripciones y resultados pasados se conservan como
            “Usuario eliminado” para no romper el histórico de los torneos.
          </Text>
          <TouchableOpacity
            onPress={handleDeleteAccount}
            style={styles.dangerBtn}
            testID="btn-eliminar-cuenta"
            accessibilityLabel="Eliminar mi cuenta y datos personales"
          >
            <Trash2 size={16} color="#fff" />
            <Text style={styles.dangerBtnText}>Eliminar mi cuenta</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Stat({
  label,
  value,
  accent,
  testID,
}: {
  label: string;
  value: string;
  accent?: string;
  testID?: string;
}) {
  return (
    <View style={styles.statBox} testID={testID}>
      <Text style={[styles.statValue, accent ? { color: accent } : null]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function WaitlistRow({ w, router }: { w: PlayerWaitlistItem; router: any }) {
  const fecha = new Date(w.fecha_evento);
  const fechaStr = fecha.toLocaleDateString("es-MX", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
  return (
    <TouchableOpacity
      onPress={() => router.push(`/retas/${w.reta_slug}` as any)}
      style={[styles.insRow, styles.waitRow]}
      testID={`mi-waitlist-${w.waitlist_id}`}
    >
      <View style={styles.posBadge}>
        <Text style={styles.posBadgeNum}>#{w.posicion_fila}</Text>
        <Text style={styles.posBadgeTot}>de {w.total_en_espera}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.insName} numberOfLines={1}>{w.reta_nombre}</Text>
        <Text style={styles.insMeta} numberOfLines={1}>{w.club} · {fechaStr}</Text>
        <View style={styles.insEstatusRow}>
          <Hourglass size={12} color={colors.status.amber} />
          <Text style={[styles.insEstatus, { color: colors.status.amber }]}>
            En lista de espera
          </Text>
        </View>
      </View>
      <ChevronRight size={18} color={colors.text.muted} />
    </TouchableOpacity>
  );
}

function InscRow({ ins, router }: { ins: PlayerInscripcion; router: any }) {
  const info =
    ins.estatus_pago === "Aprobado"
      ? { color: colors.status.green, icon: <CheckCircle2 size={14} color={colors.status.green} />, label: "Pagado" }
      : ins.estatus_pago === "Pendiente"
        ? { color: colors.status.amber, icon: <Clock size={14} color={colors.status.amber} />, label: "Pendiente" }
        : { color: colors.status.red, icon: <XCircle size={14} color={colors.status.red} />, label: ins.estatus_pago };
  const fecha = new Date(ins.fecha_evento);
  const fechaStr = fecha.toLocaleDateString("es-MX", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
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
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.lg,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: radii.md,
    backgroundColor: colors.bg.card,
    borderWidth: 1,
    borderColor: colors.border.default,
    alignItems: "center",
    justifyContent: "center",
  },
  hello: { color: colors.text.primary, fontSize: 22, fontWeight: "900" },
  subtle: { color: colors.text.secondary, fontSize: 12, marginTop: 2 },

  heroCard: {
    backgroundColor: colors.bg.card,
    borderWidth: 1,
    borderColor: colors.brand.primaryBorder,
    borderRadius: radii.lg,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  heroLabel: {
    ...typography.label,
    color: colors.text.secondary,
    fontSize: 11,
    marginBottom: 4,
  },
  heroValue: {
    color: colors.brand.primary,
    fontSize: 48,
    fontWeight: "900",
    letterSpacing: -1,
    lineHeight: 52,
  },
  heroBarBg: {
    height: 8,
    backgroundColor: colors.border.default,
    borderRadius: 4,
    marginTop: spacing.sm,
    overflow: "hidden",
  },
  heroBarFg: { height: "100%", backgroundColor: colors.brand.primary },
  heroSub: { color: colors.text.secondary, fontSize: 12, marginTop: 6 },

  statsGrid: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.lg },
  statBox: {
    flex: 1,
    backgroundColor: colors.bg.card,
    borderWidth: 1,
    borderColor: colors.border.default,
    borderRadius: radii.md,
    padding: spacing.md,
    alignItems: "center",
  },
  statValue: { color: colors.text.primary, fontSize: 22, fontWeight: "900" },
  statLabel: { color: colors.text.secondary, fontSize: 11, marginTop: 2 },

  section: {
    ...typography.h2,
    color: colors.text.primary,
    fontSize: 16,
    marginBottom: spacing.sm,
    marginTop: spacing.sm,
  },

  insRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.bg.card,
    borderWidth: 1,
    borderColor: colors.border.default,
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  waitRow: {
    borderColor: colors.status.amber,
    backgroundColor: "#FFFCF2",
  },
  posBadge: {
    width: 52,
    paddingVertical: 6,
    backgroundColor: colors.status.amber,
    borderRadius: radii.sm,
    alignItems: "center",
  },
  posBadgeNum: { color: "#fff", fontWeight: "900", fontSize: 16, lineHeight: 18 },
  posBadgeTot: { color: "#fff", fontSize: 9, opacity: 0.9 },

  insName: { ...typography.bodyBold, color: colors.text.primary },
  insMeta: { color: colors.text.secondary, fontSize: 11, marginTop: 2 },
  insEstatusRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 6 },
  insEstatus: { fontSize: 11, fontWeight: "700" },

  emptyCard: {
    backgroundColor: colors.bg.card,
    borderWidth: 1,
    borderColor: colors.border.default,
    borderRadius: radii.md,
    padding: spacing.xl,
    alignItems: "center",
    gap: spacing.sm,
  },
  emptyTitle: { ...typography.h2, color: colors.text.primary, fontSize: 16, textAlign: "center" },
  emptyText: { color: colors.text.secondary, fontSize: 12, textAlign: "center" },
  cta: {
    backgroundColor: colors.brand.primary,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: radii.pill,
    marginTop: spacing.sm,
  },
  ctaText: { color: colors.text.inverse, fontWeight: "800" },

  // === Privacy / Apple 5.1.1 ===
  linkCard: {
    backgroundColor: colors.bg.card,
    borderRadius: radii.md,
    padding: spacing.md,
    marginTop: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    borderColor: colors.border.default,
  },
  linkTitle: { ...typography.bodyBold, fontSize: 13, color: colors.text.primary },
  linkHint: { color: colors.text.secondary, fontSize: 11, marginTop: 1 },
  privacyCard: {
    backgroundColor: "#FFF5F5",
    borderWidth: 1,
    borderColor: colors.status.red,
    borderRadius: radii.md,
    padding: spacing.md,
    marginTop: spacing.sm,
    marginBottom: spacing.lg,
  },
  privacyHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 6,
  },
  privacyTitle: {
    ...typography.bodyBold,
    color: colors.status.red,
    fontSize: 14,
    flex: 1,
  },
  privacyText: {
    color: colors.text.secondary,
    fontSize: 12,
    lineHeight: 17,
    marginBottom: spacing.sm,
  },
  dangerBtn: {
    backgroundColor: colors.status.red,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: radii.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    minHeight: 44,
  },
  dangerBtnText: {
    color: "#fff",
    fontWeight: "800",
    fontSize: 14,
  },
});
