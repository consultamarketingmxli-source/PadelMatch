/** Dashboard admin con KPIs e ingresos. */
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
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import {
  ArrowLeft,
  BarChart3,
  Calendar,
  DollarSign,
  Gift,
  Rocket,
  RotateCcw,
  TrendingUp,
  Trophy,
  Users,
  Wallet,
} from "lucide-react-native";

import { AdminMetrics, RetaKPI, api } from "@/src/api";
import { colors, radii, spacing, typography } from "@/src/theme";

const fmtMxn = (v: number) =>
  v.toLocaleString("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 });

export default function AdminDashboard() {
  const router = useRouter();
  const [data, setData] = useState<AdminMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const m = await api.adminMetrics();
      setData(m);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  if (loading || !data) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}><ActivityIndicator color={colors.brand.primary} /></View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="dashboard-back">
          <ArrowLeft size={18} color={colors.text.primary} />
        </TouchableOpacity>
        <Text style={styles.title}>Panel de Control</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brand.primary} />}
      >
        {/* Acceso rápido a Mercado Pago */}
        <TouchableOpacity
          onPress={() => router.push("/admin/mercadopago" as any)}
          style={styles.mpCard}
          testID="mp-link-card"
        >
          <View style={styles.mpIcon}>
            <Wallet size={20} color="#fff" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.mpTitle}>Mercado Pago</Text>
            <Text style={styles.mpDesc}>
              Vincula tu cuenta para recibir pagos · 100% del cobro a ti
            </Text>
          </View>
          <Text style={styles.mpArrow}>›</Text>
        </TouchableOpacity>

        {/* Acceso a verificación pre-deployment (LIVE) */}
        <TouchableOpacity
          onPress={() => router.push("/admin/deploy-readiness" as any)}
          style={[styles.mpCard, { backgroundColor: colors.brand.primarySoft, borderColor: colors.brand.primaryBorder }]}
          testID="deploy-banner"
        >
          <View style={[styles.mpIcon, { backgroundColor: colors.brand.primary }]}>
            <Rocket size={20} color="#fff" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.mpTitle}>Estado de Deployment LIVE</Text>
            <Text style={styles.mpDesc}>
              Verifica credenciales productivas antes de publicar
            </Text>
          </View>
          <Text style={styles.mpArrow}>›</Text>
        </TouchableOpacity>

        {/* Marketing & Premios — Cupones */}
        <TouchableOpacity
          onPress={() => router.push("/admin/marketing" as any)}
          style={[styles.mpCard, { backgroundColor: "#FEF3C7", borderColor: "#F59E0B40" }]}
          testID="marketing-banner"
        >
          <View style={[styles.mpIcon, { backgroundColor: "#F59E0B" }]}>
            <Gift size={20} color="#fff" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.mpTitle}>Marketing & Premios</Text>
            <Text style={styles.mpDesc}>
              Emite cupones de retas gratis y compártelos por WhatsApp
            </Text>
          </View>
          <Text style={styles.mpArrow}>›</Text>
        </TouchableOpacity>

        {/* KPIs principales */}
        <View style={styles.kpiRow}>
          <KPICard
            label="Ingresos"
            value={fmtMxn(data.ingresos_totales_mxn)}
            icon={<DollarSign size={16} color={colors.brand.primary} />}
          />
          <KPICard
            label="Conversión"
            value={`${data.conversion_pct}%`}
            icon={<TrendingUp size={16} color={colors.brand.primary} />}
          />
        </View>
        <View style={styles.kpiRow}>
          <KPICard
            label="Pagos OK"
            value={String(data.pagos_aprobados)}
            icon={<Trophy size={16} color={colors.brand.primary} />}
          />
          <KPICard
            label="Reembolsos"
            value={fmtMxn(data.refunds_totales_mxn)}
            icon={<RotateCcw size={16} color={colors.status.amber} />}
          />
        </View>
        <View style={styles.kpiRow}>
          <KPICard
            label="Retas futuras"
            value={`${data.retas_futuras} / ${data.retas_totales}`}
            icon={<Calendar size={16} color={colors.brand.primary} />}
          />
          <KPICard
            label="Jugadores"
            value={String(data.jugadores_unicos)}
            icon={<Users size={16} color={colors.brand.primary} />}
          />
        </View>

        {/* Top retas por ingresos */}
        <Text style={styles.section}>Top retas por ingresos</Text>
        {data.top_retas.length === 0 ? (
          <Text style={styles.empty}>Aún no hay ingresos registrados.</Text>
        ) : (
          data.top_retas.map((r) => <RetaRow key={r.reta_id} k={r} router={router} />)
        )}

        {/* Próximas retas */}
        <Text style={styles.section}>Próximas retas</Text>
        {data.proximas_retas.length === 0 ? (
          <Text style={styles.empty}>No hay retas futuras programadas.</Text>
        ) : (
          data.proximas_retas.map((r) => <RetaRow key={r.reta_id} k={r} router={router} showCapacity />)
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function KPICard({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <View style={styles.kpi}>
      <View style={styles.kpiHead}>{icon}<Text style={styles.kpiLabel}>{label}</Text></View>
      <Text style={styles.kpiValue}>{value}</Text>
    </View>
  );
}

function RetaRow({ k, router, showCapacity }: { k: RetaKPI; router: any; showCapacity?: boolean }) {
  const semColor = k.semaforo === "VERDE" ? colors.status.green : k.semaforo === "AMARILLO" ? colors.status.amber : colors.status.red;
  return (
    <TouchableOpacity
      onPress={() => router.push(`/admin/reta/inscripciones/${k.reta_id}` as any)}
      style={styles.retaRow}
      testID={`reta-row-${k.reta_id}`}
    >
      <View style={[styles.semDot, { backgroundColor: semColor }]} />
      <View style={{ flex: 1 }}>
        <Text style={styles.retaName} numberOfLines={1}>{k.nombre}</Text>
        <Text style={styles.retaMeta} numberOfLines={1}>
          {k.club} · {k.inscritos}/{k.max_jugadores}
          {k.waitlist ? ` · ${k.waitlist} en espera` : ""}
          {showCapacity ? ` · ${k.capacidad_pct.toFixed(0)}%` : ""}
        </Text>
      </View>
      <View style={styles.retaMoney}>
        <Text style={styles.retaIngreso}>{fmtMxn(k.ingresos_mxn)}</Text>
        {k.refunds_mxn > 0 ? <Text style={styles.retaRefund}>-{fmtMxn(k.refunds_mxn)}</Text> : null}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg.app },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  topBar: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
  },
  iconBtn: {
    width: 40, height: 40, borderRadius: radii.md,
    backgroundColor: colors.bg.card, borderWidth: 1, borderColor: colors.border.default,
    alignItems: "center", justifyContent: "center",
  },
  title: { ...typography.h2, color: colors.text.primary, fontSize: 18 },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl },
  kpiRow: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.sm },
  kpi: {
    flex: 1, backgroundColor: colors.bg.card, borderWidth: 1, borderColor: colors.border.default,
    borderRadius: radii.md, padding: spacing.md,
  },
  kpiHead: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 },
  kpiLabel: { color: colors.text.secondary, fontSize: 11, fontWeight: "600" },
  kpiValue: { ...typography.monoLarge, color: colors.text.primary } as any,
  section: { ...typography.h2, color: colors.text.primary, fontSize: 16, marginTop: spacing.lg, marginBottom: spacing.sm },
  empty: { color: colors.text.secondary, padding: spacing.md, textAlign: "center", fontSize: 12 },
  retaRow: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    backgroundColor: colors.bg.card, borderWidth: 1, borderColor: colors.border.default,
    borderRadius: radii.md, padding: spacing.md, marginBottom: spacing.sm,
  },
  semDot: { width: 10, height: 10, borderRadius: 5 },
  retaName: { color: colors.text.primary, fontWeight: "700", fontSize: 14 },
  retaMeta: { color: colors.text.secondary, fontSize: 11, marginTop: 2 },
  retaMoney: { alignItems: "flex-end" },
  retaIngreso: { color: colors.brand.primary, fontWeight: "800", fontSize: 14 },
  retaRefund: { color: colors.status.red, fontSize: 10, marginTop: 2 },
  mpCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.brand.primarySoft,
    borderWidth: 1,
    borderColor: colors.brand.primaryBorder,
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  mpIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.brand.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  mpTitle: { color: colors.text.primary, fontWeight: "900", fontSize: 14, letterSpacing: -0.3 },
  mpDesc: { color: colors.text.secondary, fontSize: 11, marginTop: 2 },
  mpArrow: { color: colors.text.secondary, fontSize: 22, fontWeight: "300" },
});
