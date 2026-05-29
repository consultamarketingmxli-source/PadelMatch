/**
 * Centro de Privacidad y Seguridad (Player).
 *
 * Pantalla accesible desde /mi-cuenta. Muestra:
 *   - Sesiones activas con device/IP/last_used + botón revocar individual.
 *   - Mis últimas actividades de seguridad (logins, refresh, etc).
 *
 * Cumplimiento: GDPR "Right to access" + UX comparable a Google/GitHub.
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
  ArrowLeft,
  CheckCircle2,
  Clock,
  Globe,
  Monitor,
  ShieldAlert,
  Smartphone,
  X,
} from "lucide-react-native";

import { api } from "@/src/api";
import { PadelBallLoader } from "@/src/components/loaders";
import { colors, radii, spacing, typography } from "@/src/theme";
import { confirmAlert, infoAlert } from "@/src/utils/confirmAlert";

const PLAYER_TOKEN_KEY = "padelappretas.player.token";

type Session = {
  id: string;
  ip: string | null;
  user_agent: string;
  created_at: string | null;
  last_used_at: string | null;
  expires_at: string | null;
  is_current: boolean;
};

type Activity = {
  accion: string;
  result: string;
  ip: string | null;
  user_agent: string;
  timestamp: string | null;
};

// Etiquetas humanas para las acciones del audit log.
const ACTION_LABELS: Record<string, string> = {
  otp_request_success: "Solicitaste código OTP",
  otp_request_failed: "Falló envío de código",
  otp_verify_success: "Iniciaste sesión",
  otp_verify_failed: "Código OTP incorrecto",
  refresh_success: "Sesión renovada",
  refresh_expired: "Sesión expirada",
  refresh_reuse_detected: "⚠️ Token reutilizado — revisado",
  logout: "Cerraste sesión",
  revoke_all_sessions: "Cerraste todas las sesiones",
  player_session_revoked: "Revocaste una sesión",
  account_deletion_completed: "Eliminaste tu cuenta",
  rate_limit_exceeded: "Demasiados intentos",
};

function labelFor(accion: string): string {
  return ACTION_LABELS[accion] || accion.replace(/_/g, " ");
}

function formatRelative(iso: string | null): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    const diff = Math.floor((Date.now() - d.getTime()) / 1000);
    if (diff < 60) return "Hace unos segundos";
    if (diff < 3600) return `Hace ${Math.floor(diff / 60)} min`;
    if (diff < 86400) return `Hace ${Math.floor(diff / 3600)} h`;
    if (diff < 604800) return `Hace ${Math.floor(diff / 86400)} d`;
    return d.toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" });
  } catch {
    return iso.substring(0, 16);
  }
}

function deviceLabel(ua: string): string {
  if (!ua) return "Dispositivo desconocido";
  const lower = ua.toLowerCase();
  if (lower.includes("iphone")) return "iPhone";
  if (lower.includes("ipad")) return "iPad";
  if (lower.includes("android")) return "Android";
  if (lower.includes("chrome")) return "Chrome";
  if (lower.includes("safari")) return "Safari";
  if (lower.includes("firefox")) return "Firefox";
  if (lower.includes("edge")) return "Edge";
  if (lower.includes("curl") || lower.includes("python")) return "Script / API";
  return ua.substring(0, 32);
}

function isMobile(ua: string): boolean {
  const l = ua.toLowerCase();
  return l.includes("iphone") || l.includes("ipad") || l.includes("android");
}

export default function SeguridadScreen() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (t: string) => {
    try {
      const [s, a] = await Promise.all([
        api.playerMySessions(t).catch(() => ({ sessions: [], count: 0 })),
        api.playerSecurityActivity(t, 30).catch(() => ({ items: [], count: 0 })),
      ]);
      setSessions(s.sessions || []);
      setActivity(a.items || []);
    } catch {
      /* swallow — UI muestra estado vacío */
    }
  }, []);

  useEffect(() => {
    (async () => {
      const t = await AsyncStorage.getItem(PLAYER_TOKEN_KEY);
      if (!t) {
        router.replace("/login" as any);
        return;
      }
      setToken(t);
      await load(t);
      setLoading(false);
    })();
  }, [load, router]);

  const onRefresh = useCallback(async () => {
    if (!token) return;
    setRefreshing(true);
    await load(token);
    setRefreshing(false);
  }, [token, load]);

  const revokeSession = (s: Session) => {
    if (!token || s.is_current) return;
    confirmAlert({
      title: "Cerrar esta sesión",
      message: `Esta acción cerrará la sesión en ${deviceLabel(s.user_agent)}. El dispositivo deberá volver a iniciar sesión.`,
      confirmText: "Cerrar sesión",
      destructive: true,
      onConfirm: async () => {
        try {
          await api.playerRevokeSession(token, s.id);
          await load(token);
          infoAlert("Sesión cerrada", "El dispositivo ya no tiene acceso.");
        } catch {
          infoAlert("Error", "No se pudo cerrar la sesión.");
        }
      },
    });
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <PadelBallLoader size={48} label="Cargando tus sesiones..." />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <ArrowLeft size={20} color={colors.text.primary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Privacidad y Seguridad</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={{ paddingBottom: spacing.xl }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {/* === Sesiones activas === */}
        <Text style={styles.section}>
          Mis sesiones activas ({sessions.length})
        </Text>
        <Text style={styles.sectionHint}>
          Estos son los dispositivos donde has iniciado sesión. Si no reconoces
          alguno, ciérralo de inmediato.
        </Text>

        {sessions.length === 0 ? (
          <View style={styles.emptyCard}>
            <ShieldAlert size={24} color={colors.text.secondary} />
            <Text style={styles.emptyText}>No hay sesiones activas.</Text>
          </View>
        ) : (
          sessions.map((s) => (
            <View key={s.id} style={[styles.card, s.is_current && styles.cardCurrent]}>
              <View style={styles.cardRow}>
                {isMobile(s.user_agent) ? (
                  <Smartphone size={20} color={colors.brand.primary} />
                ) : (
                  <Monitor size={20} color={colors.brand.primary} />
                )}
                <View style={styles.cardInfo}>
                  <View style={styles.cardTitleRow}>
                    <Text style={styles.cardTitle}>{deviceLabel(s.user_agent)}</Text>
                    {s.is_current && (
                      <View style={styles.badge}>
                        <CheckCircle2 size={11} color={"#fff"} />
                        <Text style={styles.badgeText}>Este dispositivo</Text>
                      </View>
                    )}
                  </View>
                  <View style={styles.metaRow}>
                    <Globe size={11} color={colors.text.secondary} />
                    <Text style={styles.meta}>{s.ip || "IP desconocida"}</Text>
                  </View>
                  <View style={styles.metaRow}>
                    <Clock size={11} color={colors.text.secondary} />
                    <Text style={styles.meta}>Última actividad: {formatRelative(s.last_used_at)}</Text>
                  </View>
                </View>
              </View>
              {!s.is_current && (
                <TouchableOpacity
                  onPress={() => revokeSession(s)}
                  style={styles.revokeBtn}
                  testID={`revoke-session-${s.id}`}
                >
                  <X size={14} color={colors.status.red} />
                  <Text style={styles.revokeText}>Cerrar</Text>
                </TouchableOpacity>
              )}
            </View>
          ))
        )}

        {/* === Actividad reciente === */}
        <Text style={styles.section}>Actividad reciente de seguridad</Text>
        <Text style={styles.sectionHint}>
          Últimos {activity.length} eventos asociados a tu cuenta.
        </Text>

        {activity.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>Sin actividad registrada.</Text>
          </View>
        ) : (
          <View style={styles.activityList}>
            {activity.map((a, i) => (
              <View key={`${a.timestamp}-${i}`} style={styles.activityRow}>
                <View
                  style={[
                    styles.activityDot,
                    {
                      backgroundColor:
                        a.result === "success"
                          ? colors.status.green
                          : a.result === "denied"
                          ? colors.status.red
                          : colors.text.secondary,
                    },
                  ]}
                />
                <View style={{ flex: 1 }}>
                  <Text style={styles.activityLabel}>{labelFor(a.accion)}</Text>
                  <Text style={styles.activityMeta}>
                    {formatRelative(a.timestamp)} · {a.ip || "IP ?"}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg.app },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border.default,
  },
  backBtn: { padding: 8, width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: { ...typography.bodyBold, color: colors.text.primary, fontSize: 16 },
  scroll: { flex: 1, paddingHorizontal: spacing.md },

  section: {
    ...typography.bodyBold,
    fontSize: 14,
    color: colors.text.primary,
    marginTop: spacing.lg,
    marginBottom: 4,
  },
  sectionHint: {
    color: colors.text.secondary,
    fontSize: 12,
    marginBottom: spacing.sm,
    lineHeight: 17,
  },

  emptyCard: {
    backgroundColor: colors.bg.card,
    borderRadius: radii.md,
    padding: spacing.md,
    alignItems: "center",
    gap: 6,
  },
  emptyText: { color: colors.text.secondary, fontSize: 13 },

  card: {
    backgroundColor: colors.bg.card,
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderColor: colors.border.default,
  },
  cardCurrent: { borderColor: colors.brand.primary, borderWidth: 1.5 },
  cardRow: { flexDirection: "row", alignItems: "center", gap: 12, flex: 1 },
  cardInfo: { flex: 1 },
  cardTitleRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 2 },
  cardTitle: { ...typography.bodyBold, fontSize: 13, color: colors.text.primary },
  badge: {
    backgroundColor: colors.brand.primary,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radii.pill,
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
  },
  badgeText: { color: "#fff", fontSize: 9, fontWeight: "800" },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 1 },
  meta: { color: colors.text.secondary, fontSize: 11 },

  revokeBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.status.red,
  },
  revokeText: { color: colors.status.red, fontSize: 12, fontWeight: "700" },

  activityList: {
    backgroundColor: colors.bg.card,
    borderRadius: radii.md,
    padding: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border.default,
  },
  activityRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border.default,
  },
  activityDot: { width: 8, height: 8, borderRadius: 4 },
  activityLabel: { color: colors.text.primary, fontSize: 13 },
  activityMeta: { color: colors.text.secondary, fontSize: 11, marginTop: 1 },
});
