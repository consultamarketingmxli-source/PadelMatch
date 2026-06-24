/**
 * Centro de Seguridad (Admin).
 *
 * Visor del audit log + métricas. Permite filtrar por acción, usuario,
 * resultado y rango temporal. Paginación incremental (Cargar más).
 *
 * Acceso: solo admins. Auto-audita el acceso (admin_security_logs_viewed).
 */
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import {
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  Download,
  Filter,
  Globe,
  Lock,
  MapPin,
  RefreshCw,
  ShieldAlert,
  User,
  X,
} from "lucide-react-native";

import { api } from "@/src/api";
import { colors, radii, spacing, typography } from "@/src/theme";
import { HeroBanner } from "@/src/components/brand/HeroBanner";
import { useSubscription } from "@/src/hooks/useSubscription";
import { gateExport } from "@/src/utils/premiumGate";
import { infoAlert } from "@/src/utils/confirmAlert";
import { downloadAdminCsv } from "@/src/utils/downloadCsv";

type Stats = Awaited<ReturnType<typeof api.adminSecurityStats>>;
type LogItem = Awaited<ReturnType<typeof api.adminSecurityLogs>>["items"][number];

const RESULT_CHIPS = [
  { value: "", label: "Todos" },
  { value: "success", label: "OK" },
  { value: "denied", label: "Bloqueado" },
  { value: "rate_limited", label: "Rate-limit" },
];

const QUICK_FILTERS = [
  { value: "", label: "Todas las acciones" },
  { value: "admin_login", label: "Logins admin" },
  { value: "otp_", label: "OTP" },
  { value: "refresh_", label: "Refresh tokens" },
  { value: "nosql_", label: "NoSQL bloqueados" },
  { value: "rate_limit", label: "Rate limit" },
  { value: "account_deletion", label: "Eliminación de cuenta" },
  { value: "mp_webhook", label: "Webhooks MP" },
];

function formatRelative(iso: string | null): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    const diff = Math.floor((Date.now() - d.getTime()) / 1000);
    if (diff < 60) return `${diff}s`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
    return `${Math.floor(diff / 86400)}d`;
  } catch {
    return iso.substring(0, 16);
  }
}

export default function AdminSecurityScreen() {
  const router = useRouter();
  const { isPro } = useSubscription();
  const [stats, setStats] = useState<Stats | null>(null);
  const [items, setItems] = useState<LogItem[]>([]);
  const [total, setTotal] = useState(0);
  const [skip, setSkip] = useState(0);
  const [accion, setAccion] = useState("");
  const [result, setResult] = useState("");
  const [userFilter, setUserFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [exporting, setExporting] = useState(false);

  const PAGE = 25;

  const loadStats = useCallback(async () => {
    try {
      const s = await api.adminSecurityStats(7);
      setStats(s);
    } catch (e: any) {
      if (String(e?.message || "").startsWith("401")) {
        router.replace("/admin/login");
      }
    }
  }, [router]);

  const loadLogs = useCallback(
    async (resetSkip: boolean) => {
      const nextSkip = resetSkip ? 0 : skip;
      try {
        const r = await api.adminSecurityLogs({
          accion: accion || undefined,
          result: result || undefined,
          id_usuario: userFilter || undefined,
          limit: PAGE,
          skip: nextSkip,
        });
        setTotal(r.total);
        setItems(resetSkip ? r.items : [...items, ...r.items]);
        setSkip(nextSkip + r.items.length);
      } catch {
        infoAlert("Error", "No se pudo cargar el audit log.");
      }
    },
    [accion, result, userFilter, skip, items],
  );

  useEffect(() => {
    // Cleanup flag — previene setState en componente desmontado
    let alive = true;
    (async () => {
      await Promise.all([loadStats(), loadLogs(true)]);
      if (alive) setLoading(false);
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-cargar cuando cambian filtros.
  useEffect(() => {
    if (!loading) {
      setSkip(0);
      loadLogs(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accion, result, userFilter]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([loadStats(), loadLogs(true)]);
    setRefreshing(false);
  }, [loadStats, loadLogs]);

  const loadMore = async () => {
    if (loadingMore || items.length >= total) return;
    setLoadingMore(true);
    await loadLogs(false);
    setLoadingMore(false);
  };

  const onExportCsv = async () => {
    if (exporting) return;
    // Premium gate: exportar audit log es feature Pro (Sandbox Monetization)
    if (!gateExport(isPro, router)) return;
    setExporting(true);
    try {
      const path = api.adminSecurityLogsCsvPath({
        accion: accion || undefined,
        result: result || undefined,
        id_usuario: userFilter || undefined,
      });
      const r = await downloadAdminCsv(path);
      infoAlert(
        "Exportación lista",
        `Archivo ${r.filename} generado correctamente.`,
      );
    } catch (e: any) {
      infoAlert(
        "Error al exportar",
        String(e?.message || "No se pudo descargar el CSV."),
      );
    } finally {
      setExporting(false);
    }
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

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <ArrowLeft size={20} color={colors.text.primary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Centro de Seguridad</Text>
        <TouchableOpacity onPress={onRefresh} style={styles.backBtn}>
          <RefreshCw size={18} color={colors.brand.primary} />
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={{ paddingBottom: spacing.xl }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <HeroBanner
          eyebrow="PADELAPPRETAS · SEGURIDAD"
          title="Centro de Seguridad"
          subtitle={
            stats
              ? `${stats.total_events ?? 0} eventos · ${stats.active_sessions ?? 0} sesiones · ${stats.failed_logins ?? 0} fallidos (${stats.window_days}d)`
              : "Auditoría, sesiones y rate-limit"
          }
          height={172}
          style={{ marginTop: spacing.md, marginBottom: spacing.lg }}
        />
        {/* === KPIs Top === */}
        {stats && (
          <>
            <Text style={styles.section}>
              Resumen últimos {stats.window_days} días
            </Text>
            <View style={styles.kpiGrid}>
              <KpiCard
                icon={<BarChart3 size={16} color={colors.brand.primary} />}
                label="Eventos totales"
                value={stats.total_events.toLocaleString("es-MX")}
                color={colors.brand.primary}
              />
              <KpiCard
                icon={<Lock size={16} color={colors.status.green} />}
                label="Sesiones activas"
                value={stats.active_sessions.toLocaleString("es-MX")}
                color={colors.status.green}
              />
              <KpiCard
                icon={<AlertTriangle size={16} color={colors.status.red} />}
                label="Logins fallidos"
                value={stats.critical.failed_logins.toLocaleString("es-MX")}
                color={colors.status.red}
              />
              <KpiCard
                icon={<ShieldAlert size={16} color={colors.status.amber} />}
                label="NoSQL bloqueados"
                value={stats.critical.nosql_blocks.toLocaleString("es-MX")}
                color={colors.status.amber}
              />
              <KpiCard
                icon={<ShieldAlert size={16} color={colors.status.amber} />}
                label="Rate-limited"
                value={stats.critical.rate_limited.toLocaleString("es-MX")}
                color={colors.status.amber}
              />
              <KpiCard
                icon={<AlertTriangle size={16} color={colors.status.red} />}
                label="MP firma inválida"
                value={stats.critical.mp_webhook_signature_invalid.toLocaleString("es-MX")}
                color={colors.status.red}
              />
            </View>

            {/* Top acciones */}
            <Text style={styles.section}>Top acciones</Text>
            <View style={styles.topActions}>
              {stats.top_actions.slice(0, 6).map((a) => (
                <View key={a.accion} style={styles.topActionRow}>
                  <Text style={styles.topActionLabel} numberOfLines={1}>
                    {a.accion}
                  </Text>
                  <Text style={styles.topActionCount}>{a.count}</Text>
                </View>
              ))}
            </View>
          </>
        )}

        {/* === Filtros === */}
        <Text style={styles.section}>
          <Filter size={14} color={colors.text.primary} /> Audit Log
        </Text>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipsRow}
        >
          {QUICK_FILTERS.map((f) => (
            <TouchableOpacity
              key={f.value || "all"}
              onPress={() => setAccion(f.value)}
              style={[styles.chip, accion === f.value && styles.chipActive]}
            >
              <Text style={[styles.chipText, accion === f.value && styles.chipTextActive]}>
                {f.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipsRow}
        >
          {RESULT_CHIPS.map((f) => (
            <TouchableOpacity
              key={f.value || "any"}
              onPress={() => setResult(f.value)}
              style={[styles.chip, result === f.value && styles.chipActive]}
            >
              <Text style={[styles.chipText, result === f.value && styles.chipTextActive]}>
                {f.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <View style={styles.searchBox}>
          <User size={14} color={colors.text.secondary} />
          <TextInput
            placeholder="Filtrar por usuario (email / teléfono)"
            placeholderTextColor={colors.text.secondary}
            value={userFilter}
            onChangeText={setUserFilter}
            style={styles.searchInput}
            autoCapitalize="none"
          />
          {userFilter ? (
            <TouchableOpacity onPress={() => setUserFilter("")}>
              <X size={14} color={colors.text.secondary} />
            </TouchableOpacity>
          ) : null}
        </View>

        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>
            {total.toLocaleString("es-MX")} eventos
          </Text>
          <TouchableOpacity
            onPress={onExportCsv}
            disabled={exporting || items.length === 0}
            style={[
              styles.exportBtn,
              (exporting || items.length === 0) && styles.exportBtnDisabled,
            ]}
            testID="export-csv-btn"
          >
            {exporting ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <>
                <Download size={12} color="#fff" />
                <Text style={styles.exportBtnText}>Exportar CSV</Text>
              </>
            )}
          </TouchableOpacity>
        </View>

        {/* === Lista === */}
        {items.map((it, idx) => (
          <View key={`${it.timestamp}-${idx}`} style={styles.logCard}>
            <View style={styles.logHeader}>
              <View
                style={[
                  styles.logDot,
                  {
                    backgroundColor:
                      it.result === "success"
                        ? colors.status.green
                        : it.result === "denied"
                        ? colors.status.red
                        : it.result === "rate_limited"
                        ? colors.status.amber
                        : colors.text.secondary,
                  },
                ]}
              />
              <Text style={styles.logAction} numberOfLines={1}>
                {it.accion}
              </Text>
              <Text style={styles.logTime}>{formatRelative(it.timestamp)}</Text>
            </View>
            <View style={styles.logMetaRow}>
              {it.id_usuario && (
                <View style={styles.logMetaCell}>
                  <User size={10} color={colors.text.secondary} />
                  <Text style={styles.logMeta} numberOfLines={1}>
                    {it.id_usuario}
                  </Text>
                </View>
              )}
              {it.ip_origen && (
                <View style={styles.logMetaCell}>
                  <Globe size={10} color={colors.text.secondary} />
                  <Text style={styles.logMeta}>{it.ip_origen}</Text>
                </View>
              )}
              {it.location && it.location !== "—" && (
                <View style={styles.logMetaCell}>
                  <MapPin size={10} color={colors.brand.primary} />
                  <Text style={[styles.logMeta, { color: colors.brand.primary }]}>
                    {it.location}
                  </Text>
                </View>
              )}
            </View>
          </View>
        ))}

        {items.length < total && (
          <TouchableOpacity
            onPress={loadMore}
            disabled={loadingMore}
            style={styles.loadMoreBtn}
          >
            {loadingMore ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.loadMoreText}>
                Cargar más ({(total - items.length).toLocaleString("es-MX")} restantes)
              </Text>
            )}
          </TouchableOpacity>
        )}

        {items.length === 0 && (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>Sin resultados para los filtros aplicados.</Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function KpiCard({
  icon,
  label,
  value,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  color: string;
}) {
  return (
    <View style={[styles.kpi, { borderLeftColor: color }]}>
      <View style={styles.kpiHead}>
        {icon}
        <Text style={styles.kpiLabel}>{label}</Text>
      </View>
      <Text style={styles.kpiValue}>{value}</Text>
    </View>
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
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: { ...typography.bodyBold, color: colors.text.primary, fontSize: 16 },
  scroll: { flex: 1, paddingHorizontal: spacing.md },

  section: {
    ...typography.bodyBold,
    fontSize: 14,
    color: colors.text.primary,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },

  kpiGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  kpi: {
    backgroundColor: colors.bg.card,
    borderRadius: radii.md,
    padding: spacing.sm,
    flex: 1,
    minWidth: "30%",
    borderLeftWidth: 3,
  },
  kpiHead: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 },
  kpiLabel: { color: colors.text.secondary, fontSize: 10, flex: 1 },
  kpiValue: {
    color: colors.text.primary,
    fontSize: 20,
    fontWeight: "800",
    fontVariant: ["tabular-nums"],
  },

  topActions: {
    backgroundColor: colors.bg.card,
    borderRadius: radii.md,
    padding: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border.default,
  },
  topActionRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: colors.border.default,
  },
  topActionLabel: { flex: 1, color: colors.text.primary, fontSize: 12 },
  topActionCount: {
    color: colors.brand.primary,
    fontWeight: "800",
    fontVariant: ["tabular-nums"],
    fontSize: 12,
  },

  chipsRow: { gap: 6, paddingVertical: 6 },
  chip: {
    backgroundColor: colors.bg.card,
    borderRadius: radii.pill,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: colors.border.default,
  },
  chipActive: { backgroundColor: colors.brand.primary, borderColor: colors.brand.primary },
  chipText: { color: colors.text.primary, fontSize: 11, fontWeight: "600" },
  chipTextActive: { color: "#fff" },

  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.bg.card,
    borderRadius: radii.md,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginTop: spacing.sm,
    gap: 6,
    borderWidth: 1,
    borderColor: colors.border.default,
  },
  searchInput: { flex: 1, color: colors.text.primary, fontSize: 12, paddingVertical: 4 },

  totalLabel: {
    color: colors.text.secondary,
    fontSize: 11,
    marginTop: spacing.sm,
    marginBottom: 4,
  },
  totalRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: spacing.sm,
    marginBottom: 4,
  },
  exportBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.brand.primary,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radii.pill,
    minHeight: 28,
  },
  exportBtnDisabled: { opacity: 0.5 },
  exportBtnText: { color: "#fff", fontSize: 11, fontWeight: "800" },

  logCard: {
    backgroundColor: colors.bg.card,
    borderRadius: radii.sm,
    padding: 10,
    marginBottom: 6,
    borderLeftWidth: 2,
    borderLeftColor: colors.border.default,
  },
  logHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  logDot: { width: 8, height: 8, borderRadius: 4 },
  logAction: { flex: 1, color: colors.text.primary, fontSize: 12, fontWeight: "700" },
  logTime: {
    color: colors.text.secondary,
    fontSize: 10,
    fontVariant: ["tabular-nums"],
  },
  logMetaRow: { flexDirection: "row", gap: 12, marginTop: 4, paddingLeft: 16 },
  logMetaCell: { flexDirection: "row", alignItems: "center", gap: 3 },
  logMeta: { color: colors.text.secondary, fontSize: 10 },

  loadMoreBtn: {
    backgroundColor: colors.brand.primary,
    borderRadius: radii.pill,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
    marginTop: spacing.md,
    minHeight: 44,
  },
  loadMoreText: { color: "#fff", fontWeight: "800", fontSize: 13 },

  emptyCard: {
    backgroundColor: colors.bg.card,
    borderRadius: radii.md,
    padding: spacing.lg,
    alignItems: "center",
    marginTop: spacing.md,
  },
  emptyText: { color: colors.text.secondary, fontSize: 13 },
});
