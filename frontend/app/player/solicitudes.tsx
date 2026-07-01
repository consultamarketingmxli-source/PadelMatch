/**
 * Iter51-P2 · Player "Mis Solicitudes" (Open Reta status view)
 * ─────────────────────────────────────────────────────────────────────────
 * Ruta: /player/solicitudes
 *
 * Pantalla self-service para que el jugador consulte el estado de sus
 * solicitudes de unión Open Reta (fondos retenidos MP capture=False).
 *
 * UX:
 *  - Fetch `GET /api/players/{player_id}/join-requests?status=active` al montar.
 *  - Pull-to-refresh.
 *  - Cada card muestra:
 *      • Nombre + club + fecha de la reta
 *      • Monto retenido
 *      • Countdown en tiempo real hasta la expiración automática
 *        (2 h antes del match_start_time). El tick es cada 1 s.
 *      • Estado (pending / approved / rejected / expired).
 *  - Empty state amigable + link a "Buscar retas".
 *  - Sin auth token en headers — endpoint es público filtrado por `player_id`.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { router, Stack } from "expo-router";
import { AlertTriangle, Check, Clock, Search, ShieldCheck, X } from "lucide-react-native";

import { api } from "@/src/api";
import { colors, radii, shadows, spacing, typography } from "@/src/theme";
import { getPlayerInfo } from "@/src/utils/playerInfo";

type JoinRequestItem = {
  id: string;
  match_id: string;
  reta_nombre: string;
  reta_slug?: string;
  reta_club: string;
  reta_fecha_evento?: string;
  amount: number;
  payment_id?: string;
  status: "pending_approval" | "approved" | "rejected" | "expired" | "failed";
  decision_reason?: string | null;
  created_at: string;
  decided_at?: string | null;
};

export default function MisSolicitudesScreen() {
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [items, setItems] = useState<JoinRequestItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Cargar player desde storage al montar.
  useEffect(() => {
    (async () => {
      const info = await getPlayerInfo();
      setPlayerId(info?.jugador_id ?? null);
    })();
  }, []);

  const load = useCallback(async () => {
    if (!playerId) {
      setLoading(false);
      return;
    }
    try {
      setError(null);
      const r = await api.listMyJoinRequests(playerId, "all");
      setItems(r.items as JoinRequestItem[]);
    } catch (e: any) {
      setError(e?.message || "No se pudieron cargar las solicitudes.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [playerId]);

  useEffect(() => {
    if (playerId !== null) void load();
  }, [playerId, load]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void load();
  }, [load]);

  // ═══════════════════ Render states ═══════════════════
  if (!playerId && !loading) {
    return (
      <SafeAreaView style={s.container} edges={["top", "bottom"]}>
        <Stack.Screen options={{ title: "Mis solicitudes" }} />
        <EmptyStateAuth />
      </SafeAreaView>
    );
  }

  if (loading) {
    return (
      <SafeAreaView style={s.container} edges={["top", "bottom"]}>
        <Stack.Screen options={{ title: "Mis solicitudes" }} />
        <View style={s.center}>
          <ActivityIndicator size="large" color={colors.brand.primary} />
        </View>
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={s.container} edges={["top", "bottom"]}>
        <Stack.Screen options={{ title: "Mis solicitudes" }} />
        <View style={s.center}>
          <AlertTriangle size={40} color={colors.status.red} />
          <Text style={s.errorTitle}>No pudimos cargar tus solicitudes</Text>
          <Text style={s.errorSub}>{error}</Text>
          <TouchableOpacity style={s.retryBtn} onPress={onRefresh}>
            <Text style={s.retryBtnText}>Reintentar</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.container} edges={["top", "bottom"]}>
      <Stack.Screen options={{ title: "Mis solicitudes" }} />
      <FlatList
        data={items}
        keyExtractor={(x) => x.id}
        contentContainerStyle={s.listContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brand.primary} />
        }
        ListHeaderComponent={
          <View style={s.header}>
            <View style={s.headerIcon}>
              <ShieldCheck size={22} color="#fff" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.headerTitle}>Solicitudes Open Reta</Text>
              <Text style={s.headerSub}>
                Fondos retenidos, sin cargo hasta la decisión del organizador.
              </Text>
            </View>
          </View>
        }
        ListEmptyComponent={<EmptyStateNoRequests />}
        renderItem={({ item }) => <SolicitudCard req={item} />}
      />
    </SafeAreaView>
  );
}

// ══════════════════════════════ SolicitudCard ══════════════════════════════
function SolicitudCard({ req }: { req: JoinRequestItem }) {
  const countdown = useCountdownTo2hBeforeMatch(req.reta_fecha_evento);
  const isPending = req.status === "pending_approval";
  const badge = getStatusBadge(req.status);

  return (
    <View style={s.card}>
      <View style={s.cardHeader}>
        <View style={{ flex: 1 }}>
          <Text style={s.retaNombre} numberOfLines={1}>{req.reta_nombre}</Text>
          <Text style={s.retaMeta} numberOfLines={1}>
            {req.reta_club || "Sin club"}
            {req.reta_fecha_evento ? ` · ${formatFecha(req.reta_fecha_evento)}` : ""}
          </Text>
        </View>
        <View style={[s.badge, { backgroundColor: badge.bg }]}>
          {badge.icon}
          <Text style={[s.badgeText, { color: badge.fg }]}>{badge.label}</Text>
        </View>
      </View>

      <View style={s.amountRow}>
        <Text style={s.amountLabel}>
          {req.status === "approved" ? "Cobrado" : req.status === "pending_approval" ? "Retenido" : "Liberado"}
        </Text>
        <Text style={[s.amountValue, req.status === "rejected" && s.amountValueMuted]}>
          ${req.amount.toFixed(2)} MXN
        </Text>
      </View>

      {isPending && countdown && (
        <View style={[s.countdownBox, countdown.critical && s.countdownBoxCritical]}>
          <Clock size={14} color={countdown.critical ? colors.status.red : colors.brand.primary} />
          <Text
            style={[
              s.countdownText,
              countdown.critical && s.countdownTextCritical,
            ]}
          >
            {countdown.expired
              ? "⏰ Expira en breve — se liberará automáticamente"
              : `Expira en ${countdown.pretty} si el organizador no decide`}
          </Text>
        </View>
      )}

      {req.decision_reason && !isPending && (
        <View style={s.reasonBox}>
          <Text style={s.reasonLabel}>
            {req.status === "rejected" ? "Motivo:" : "Nota:"}
          </Text>
          <Text style={s.reasonText}>{req.decision_reason}</Text>
        </View>
      )}
    </View>
  );
}

// ══════════════════════════ Countdown hook ══════════════════════════
/** Devuelve el tiempo restante hasta 2 h antes del match_start_time. */
function useCountdownTo2hBeforeMatch(fechaEventoIso?: string) {
  const [now, setNow] = useState(() => Date.now());
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    // tick cada 1 s mientras la card esté montada
    intervalRef.current = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  return useMemo(() => {
    if (!fechaEventoIso) return null;
    const matchStart = new Date(fechaEventoIso).getTime();
    if (isNaN(matchStart)) return null;
    const cutoff = matchStart - 2 * 60 * 60 * 1000; // 2 h antes
    const remainMs = cutoff - now;
    if (remainMs <= 0) return { pretty: "0m", expired: true, critical: true, remainMs: 0 };

    const totalSec = Math.floor(remainMs / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const sec = totalSec % 60;

    const pretty =
      h > 0
        ? `${h}h ${m}m`
        : m > 0
        ? `${m}m ${sec}s`
        : `${sec}s`;

    return {
      pretty,
      expired: false,
      // Crítico si quedan menos de 30 min → destacamos en rojo.
      critical: remainMs < 30 * 60 * 1000,
      remainMs,
    };
  }, [fechaEventoIso, now]);
}

// ══════════════════════════ Empty states ══════════════════════════
function EmptyStateNoRequests() {
  return (
    <View style={s.emptyBox}>
      <View style={s.emptyIconWrap}>
        <ShieldCheck size={44} color={colors.brand.primary} />
      </View>
      <Text style={s.emptyTitle}>Aún no has solicitado unirte a retas</Text>
      <Text style={s.emptySub}>
        Cuando encuentres una reta abierta, solicita unirte con pre-autorización.
        Sin cargo hasta que el organizador te apruebe.
      </Text>
      <TouchableOpacity
        style={s.emptyCta}
        onPress={() => router.push("/buscar-reta" as any)}
        testID="empty-buscar-retas"
      >
        <Search size={16} color="#fff" />
        <Text style={s.emptyCtaText}>Buscar retas</Text>
      </TouchableOpacity>
    </View>
  );
}

function EmptyStateAuth() {
  return (
    <View style={s.center}>
      <ShieldCheck size={40} color={colors.text.secondary} />
      <Text style={s.errorTitle}>Verifica tu teléfono</Text>
      <Text style={s.errorSub}>
        Necesitas iniciar sesión con tu teléfono para ver tus solicitudes.
      </Text>
      <TouchableOpacity style={s.retryBtn} onPress={() => router.push("/buscar-reta" as any)}>
        <Text style={s.retryBtnText}>Ir a buscar retas</Text>
      </TouchableOpacity>
    </View>
  );
}

// ══════════════════════════ Helpers ══════════════════════════
function getStatusBadge(status: JoinRequestItem["status"]) {
  switch (status) {
    case "pending_approval":
      return { bg: "#FEF3C7", fg: "#92400E", label: "Pendiente", icon: <Clock size={11} color="#92400E" /> };
    case "approved":
      return { bg: "#D1FAE5", fg: "#065F46", label: "Aprobado", icon: <Check size={11} color="#065F46" /> };
    case "rejected":
      return { bg: "#FEE2E2", fg: "#991B1B", label: "Rechazado", icon: <X size={11} color="#991B1B" /> };
    case "expired":
      return { bg: "#F3F4F6", fg: "#4B5563", label: "Expirado", icon: <Clock size={11} color="#4B5563" /> };
    default:
      return { bg: "#FEE2E2", fg: "#991B1B", label: "Falló", icon: <AlertTriangle size={11} color="#991B1B" /> };
  }
}

function formatFecha(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString("es-MX", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

// ══════════════════════════ Styles ══════════════════════════
const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg.app },
  center: { flex: 1, justifyContent: "center", alignItems: "center", padding: spacing.lg },
  listContent: { padding: spacing.md, paddingBottom: 40 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.bg.card,
    padding: spacing.md,
    borderRadius: radii.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.brand.primaryBorder,
  },
  headerIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.brand.primary,
    justifyContent: "center",
    alignItems: "center",
  },
  headerTitle: { ...typography.body, fontWeight: "800", color: colors.text.primary },
  headerSub: { ...typography.caption, color: colors.text.secondary, marginTop: 2 },
  // Card
  card: {
    backgroundColor: colors.bg.card,
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: "#F1F5F9",
    ...shadows.card,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  retaNombre: { ...typography.body, fontWeight: "800", color: colors.text.primary, letterSpacing: -0.2 },
  retaMeta: { ...typography.caption, color: colors.text.secondary, marginTop: 2 },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 100,
  },
  badgeText: { fontSize: 11, fontWeight: "800" },
  amountRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 6,
    borderTopWidth: 1,
    borderTopColor: "#F1F5F9",
  },
  amountLabel: { ...typography.caption, color: colors.text.tertiary, fontWeight: "600" },
  amountValue: { fontSize: 18, fontWeight: "800", color: colors.brand.primary },
  amountValueMuted: { color: colors.text.tertiary, textDecorationLine: "line-through" },
  // Countdown
  countdownBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 8,
    padding: 8,
    borderRadius: 8,
    backgroundColor: colors.brand.primaryMuted,
  },
  countdownBoxCritical: { backgroundColor: "#FEE2E2" },
  countdownText: { ...typography.caption, color: colors.brand.primary, fontWeight: "700", flex: 1 },
  countdownTextCritical: { color: colors.status.red },
  // Reason
  reasonBox: { marginTop: 8, padding: 8, borderRadius: 8, backgroundColor: "#F8FAFC" },
  reasonLabel: { fontSize: 11, fontWeight: "800", color: colors.text.tertiary, marginBottom: 2 },
  reasonText: { ...typography.caption, color: colors.text.body, lineHeight: 17 },
  // Error state
  errorTitle: { ...typography.h3, fontWeight: "800", color: colors.text.primary, marginTop: 12, textAlign: "center" },
  errorSub: {
    ...typography.body,
    color: colors.text.secondary,
    textAlign: "center",
    marginTop: 8,
    lineHeight: 20,
  },
  retryBtn: {
    marginTop: spacing.md,
    backgroundColor: colors.brand.primary,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 12,
  },
  retryBtnText: { color: "#fff", fontWeight: "700" },
  // Empty
  emptyBox: { alignItems: "center", padding: spacing.xl, paddingTop: 40 },
  emptyIconWrap: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: colors.brand.primaryMuted,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: spacing.md,
  },
  emptyTitle: { ...typography.h3, fontWeight: "800", color: colors.text.primary, textAlign: "center" },
  emptySub: {
    ...typography.body,
    color: colors.text.secondary,
    marginTop: 6,
    textAlign: "center",
    lineHeight: 20,
  },
  emptyCta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: spacing.lg,
    backgroundColor: colors.brand.primary,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 12,
  },
  emptyCtaText: { color: "#fff", fontWeight: "800", fontSize: 15 },
});
