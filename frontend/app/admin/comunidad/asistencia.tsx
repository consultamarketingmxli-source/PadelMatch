/**
 * Admin · Comunidad — Asistencia de Jugadores.
 *
 * Lista única de jugadores con su rate histórico de asistencia + badge de
 * confiabilidad (Élite Confiable / Jugador Cumplido / Asistencia Regular /
 * Necesita Mejorar / Nuevo). Ordenada por confiabilidad descendente.
 *
 * Diseño premium navy/azure consistente con la línea de marca:
 *   - HeroBanner premium en el top.
 *   - FlashList con cards (border hairline + radius lg).
 *   - Badge categórico con paleta semaforo (success / warn / danger / new).
 *   - Plus Jakarta Sans heredada del theme.
 */
import React, { useEffect, useState, useCallback } from "react";
import { RefreshControl, StyleSheet, Text, View } from "react-native";
import { FlashList } from "@shopify/flash-list";
import { SafeAreaView } from "react-native-safe-area-context";
import { Award, ShieldCheck, AlertCircle, Sparkles, TrendingDown } from "lucide-react-native";

import { api } from "@/src/api";
import { HeroBanner } from "@/src/components/brand/HeroBanner";
import { EmptyState } from "@/src/components/EmptyState";
import { colors, radii, spacing } from "@/src/theme";

type Member = {
  nombre: string;
  telefono: string;
  rate_pct: number;
  sample_size: number;
  badge_label: string;
  badge_tone: "elite" | "ok" | "warn" | "danger" | "new";
};

type ToneStyle = { bg: string; border: string; text: string; icon: any };

const TONE: Record<Member["badge_tone"], ToneStyle> = {
  elite: { bg: "#FEF3C7", border: "#FBBF24", text: "#92400E", icon: Award },
  ok: { bg: colors.status.greenBg, border: colors.status.greenBorder, text: colors.status.greenText, icon: ShieldCheck },
  warn: { bg: colors.status.amberBg, border: colors.status.amberBorder, text: colors.status.amberText, icon: AlertCircle },
  danger: { bg: colors.status.redBg, border: colors.status.redBorder, text: colors.status.redText, icon: TrendingDown },
  new: { bg: "#E0E7FF", border: "#C7D2FE", text: "#3730A3", icon: Sparkles },
};

function MemberRow({ m }: { m: Member }) {
  const ts = TONE[m.badge_tone];
  const Icon = ts.icon;
  const initials = m.nombre
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <View style={s.row} testID={`member-row-${m.telefono}`}>
      <View style={s.avatar}>
        <Text style={s.avatarText}>{initials}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={s.name}>{m.nombre}</Text>
        <Text style={s.meta}>
          {m.sample_size > 0 ? `${m.sample_size} retas pasadas` : "Sin retas pasadas"}
          {m.sample_size > 0 ? ` · ${m.rate_pct}% asistencia` : ""}
        </Text>
      </View>
      <View style={[s.badge, { backgroundColor: ts.bg, borderColor: ts.border }]}>
        <Icon size={13} color={ts.text} strokeWidth={2.4} />
        <Text style={[s.badgeText, { color: ts.text }]}>{m.badge_label}</Text>
      </View>
    </View>
  );
}

export default function ComunidadAsistencia() {
  const [data, setData] = useState<Member[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const res = await api.adminCommunityAttendance();
      setData(res);
    } catch (e: any) {
      setErr(e?.message || "No pudimos cargar la comunidad");
    }
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!alive) return;
      await load();
    })();
    return () => {
      alive = false;
    };
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  return (
    <SafeAreaView style={s.safe} edges={["top"]}>
      <FlashList
        data={data || []}
        keyExtractor={(m) => m.telefono}
        estimatedItemSize={84}
        contentContainerStyle={{ padding: spacing.base, paddingBottom: spacing.xl }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brand.primary} />
        }
        renderItem={({ item }) => <MemberRow m={item} />}
        ListHeaderComponent={
          <View>
            <HeroBanner
              eyebrow="ADMIN · COMUNIDAD"
              title="Asistencia de Jugadores"
              subtitle="Identifica a tus jugadores cumplidos y mitiga cancelaciones de última hora."
              height={170}
              style={{ marginBottom: spacing.base }}
            />
            <Text style={s.sectionLabel}>
              {data ? `${data.length} jugadores en tu comunidad` : ""}
            </Text>
          </View>
        }
        ListEmptyComponent={
          err ? (
            <EmptyState title="Algo salió mal" subtitle={err} />
          ) : data === null ? (
            <View>
              {[1, 2, 3, 4, 5].map((i) => (
                <View key={i} style={[s.row, { backgroundColor: "#F1F5F9", borderColor: "#E2E8F0" }]}>
                  <View style={[s.avatar, { backgroundColor: "#CBD5E1" }]} />
                  <View style={{ flex: 1 }}>
                    <View style={{ height: 12, width: "60%", backgroundColor: "#E2E8F0", borderRadius: 4, marginBottom: 6 }} />
                    <View style={{ height: 10, width: "40%", backgroundColor: "#E2E8F0", borderRadius: 4 }} />
                  </View>
                </View>
              ))}
            </View>
          ) : (
            <EmptyState
              title="Sin jugadores aún"
              subtitle="Cuando los jugadores comiencen a inscribirse a tus retas, aparecerán aquí con su rate de asistencia."
            />
          )
        }
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg.app },
  sectionLabel: {
    color: colors.text.secondary,
    marginBottom: spacing.sm,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.6,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.base,
    paddingHorizontal: spacing.base,
    backgroundColor: colors.bg.card,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    marginBottom: spacing.sm,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#0f172a",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    color: "#FFFFFF",
    fontWeight: "800",
    fontSize: 14,
    letterSpacing: 0.4,
  },
  name: {
    color: colors.text.primary,
    fontWeight: "700",
    fontSize: 14.5,
    marginBottom: 2,
    letterSpacing: -0.1,
  },
  meta: {
    color: colors.text.secondary,
    fontSize: 12,
    fontWeight: "500",
  },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.1,
  },
});
