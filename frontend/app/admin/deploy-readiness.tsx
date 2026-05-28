/**
 * Admin → Estado de Deployment LIVE (Action Item #3).
 *
 * Muestra de un vistazo qué credenciales productivas faltan o están en
 * modo TEST. Lee /api/admin/deploy-readiness y renderiza cada integración
 * con su nivel de severidad (ok / warning / critical).
 *
 * Esta pantalla NO modifica credenciales. Solo es informativa y guía al
 * organizador a /app/memory/LIVE_DEPLOYMENT_KEYS.md.
 */
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
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import {
  AlertOctagon,
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  RefreshCw,
  Rocket,
  XCircle,
} from "lucide-react-native";

import { api } from "@/src/api";
import { Button } from "@/src/components/Button";
import { colors, radii, spacing, typography } from "@/src/theme";

type DeployReadiness = Awaited<ReturnType<typeof api.getDeployReadiness>>;
type Integration = DeployReadiness["integrations"][number];

export default function AdminDeployReadiness() {
  const router = useRouter();
  const [data, setData] = useState<DeployReadiness | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api.getDeployReadiness();
      setData(r);
    } catch (e: any) {
      Alert.alert("Error", e.message ?? "No se pudo cargar el estado de deployment");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  if (loading || !data) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}><ActivityIndicator color={colors.brand.primary} /></View>
      </SafeAreaView>
    );
  }

  const overall = data.overall;
  const overallInfo = overall === "ready"
    ? { color: colors.status.green, icon: <CheckCircle2 size={20} color={colors.status.green} />, label: "Listo para LIVE" }
    : overall === "missing"
      ? { color: colors.status.red, icon: <AlertOctagon size={20} color={colors.status.red} />, label: "Faltan credenciales críticas" }
      : { color: colors.status.amber, icon: <AlertTriangle size={20} color={colors.status.amber} />, label: "Modo TEST detectado" };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="deploy-back">
          <ArrowLeft size={18} color={colors.text.primary} />
        </TouchableOpacity>
        <Text style={styles.title}>Estado de Deployment</Text>
        <TouchableOpacity onPress={onRefresh} style={styles.iconBtn} testID="deploy-refresh">
          <RefreshCw size={16} color={colors.brand.primary} />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brand.primary} />}
      >
        {/* Hero estado */}
        <View style={[styles.hero, { borderColor: overallInfo.color + "60", backgroundColor: overallInfo.color + "10" }]} testID="deploy-hero">
          {overallInfo.icon}
          <View style={{ flex: 1 }}>
            <Text style={[styles.heroLabel, { color: overallInfo.color }]}>{overallInfo.label}</Text>
            <Text style={styles.heroSubtitle}>
              {data.summary.ok} listas · {data.summary.warning} en TEST · {data.summary.critical} críticas
            </Text>
          </View>
          <Rocket size={20} color={overallInfo.color} />
        </View>

        {/* Banner instrucciones */}
        <View style={styles.docBanner} testID="deploy-doc-banner">
          <Text style={styles.docTitle}>📚 Guía completa de transición</Text>
          <Text style={styles.docText}>
            Lee `/app/memory/LIVE_DEPLOYMENT_KEYS.md` para los pasos detallados de
            cada integración. Las credenciales se configuran en el panel de
            Emergent → Publish → Environment Variables.
          </Text>
        </View>

        {/* Lista integraciones */}
        {data.integrations.map((it) => (
          <IntegrationRow key={it.env} item={it} />
        ))}

        {/* Acción Publish (solo si ready) */}
        <View style={{ marginTop: spacing.md }}>
          {overall === "ready" ? (
            <View style={styles.readyBox}>
              <Text style={styles.readyTitle}>🚀 Listo para publicar</Text>
              <Text style={styles.readyText}>
                Todas las credenciales productivas están configuradas. Puedes
                hacer click en el botón &quot;Publish&quot; del panel de Emergent.
              </Text>
            </View>
          ) : (
            <View style={styles.howtoBox} testID="deploy-howto">
              <Text style={styles.howtoTitle}>¿Cómo cambiar a LIVE?</Text>
              <Text style={styles.howtoLine}>
                1. Abre el panel de Emergent → botón &quot;Publish&quot; (esquina superior derecha).
              </Text>
              <Text style={styles.howtoLine}>
                2. En la sección &quot;Environment Variables&quot;, sustituye los valores TEST
                por los productivos (las variables exactas están listadas arriba en cada card).
              </Text>
              <Text style={styles.howtoLine}>
                3. Guarda y haz click en &quot;Publish&quot; para regenerar el build.
              </Text>
              <Text style={styles.howtoLine}>
                4. Vuelve a esta pantalla y pulsa el botón refrescar para validar.
              </Text>
              <View style={{ height: spacing.sm }} />
              <Button
                title="Refrescar estado"
                variant="secondary"
                onPress={onRefresh}
                icon={<RefreshCw size={14} color={colors.brand.primary} />}
                loading={refreshing}
                testID="deploy-howto-refresh"
              />
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function IntegrationRow({ item }: { item: Integration }) {
  const sev = item.severity;
  const info = sev === "ok"
    ? { color: colors.status.green, icon: <CheckCircle2 size={16} color={colors.status.green} /> }
    : sev === "warning"
      ? { color: colors.status.amber, icon: <AlertTriangle size={16} color={colors.status.amber} /> }
      : { color: colors.status.red, icon: <XCircle size={16} color={colors.status.red} /> };

  const modeBadge = item.mode === "live"
    ? { txt: "LIVE", color: colors.status.green }
    : item.mode === "test"
      ? { txt: "TEST", color: colors.status.amber }
      : item.mode === "missing"
        ? { txt: "FALTA", color: colors.status.red }
        : { txt: "?", color: colors.text.tertiary };

  return (
    <View style={[styles.itemCard, { borderColor: info.color + "40" }]} testID={`integration-${item.env.split(" ")[0]}`}>
      <View style={styles.itemHead}>
        {info.icon}
        <Text style={styles.itemName}>{item.name}</Text>
        <View style={[styles.modeBadge, { backgroundColor: modeBadge.color + "15", borderColor: modeBadge.color + "40" }]}>
          <Text style={[styles.modeBadgeTxt, { color: modeBadge.color }]}>{modeBadge.txt}</Text>
        </View>
      </View>
      <Text style={styles.itemEnv}>{item.env}</Text>
      <Text style={styles.itemAdvice}>{item.advice}</Text>
      {item.extra && Object.keys(item.extra).length > 0 ? (
        <Text style={styles.itemExtra}>
          {Object.entries(item.extra)
            .map(([k, v]) => `${k}: ${String(v)}`)
            .join(" · ")}
        </Text>
      ) : null}
    </View>
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
    width: 40, height: 40, borderRadius: radii.md, backgroundColor: colors.bg.card,
    borderWidth: 1, borderColor: colors.border.default,
    alignItems: "center", justifyContent: "center",
  },
  title: { ...typography.h2, color: colors.text.primary, fontSize: 17 },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.md },

  hero: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    padding: spacing.md, borderRadius: radii.lg, borderWidth: 1,
  },
  heroLabel: { ...typography.h3, fontSize: 14, fontWeight: "800" },
  heroSubtitle: { color: colors.text.secondary, fontSize: 12, marginTop: 2 },

  docBanner: {
    padding: spacing.md, borderRadius: radii.md,
    backgroundColor: colors.brand.primarySoft,
    borderWidth: 1, borderColor: colors.brand.primaryBorder,
    borderStyle: "dashed",
  },
  docTitle: { ...typography.bodyBold, color: colors.brand.primary, marginBottom: 4, fontSize: 13 },
  docText: { color: colors.text.primary, fontSize: 12, lineHeight: 17 },

  itemCard: {
    backgroundColor: colors.bg.card,
    borderRadius: radii.md,
    borderWidth: 1,
    padding: spacing.md,
  },
  itemHead: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 },
  itemName: { flex: 1, ...typography.bodyBold, color: colors.text.primary, fontSize: 14 },
  modeBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: radii.sm, borderWidth: 1 },
  modeBadgeTxt: { fontSize: 10, fontWeight: "800", letterSpacing: 0.5 },
  itemEnv: { color: colors.text.tertiary, fontSize: 10, fontFamily: "monospace", marginBottom: 6 },
  itemAdvice: { color: colors.text.primary, fontSize: 12, lineHeight: 17 },
  itemExtra: { color: colors.text.secondary, fontSize: 10, marginTop: 6, fontStyle: "italic" },

  readyBox: {
    backgroundColor: colors.status.green + "10",
    borderWidth: 1, borderColor: colors.status.green + "40",
    borderRadius: radii.md, padding: spacing.md,
  },
  readyTitle: { ...typography.bodyBold, color: colors.status.green, fontSize: 14, marginBottom: 4 },
  readyText: { color: colors.text.primary, fontSize: 12, lineHeight: 17 },

  // How-to box (cuando NO ready) — instrucciones inline + botón refrescar.
  howtoBox: {
    backgroundColor: colors.bg.card,
    borderWidth: 1, borderColor: colors.brand.primaryBorder,
    borderStyle: "dashed",
    borderRadius: radii.md, padding: spacing.md,
  },
  howtoTitle: {
    ...typography.bodyBold, color: colors.brand.primary,
    fontSize: 14, marginBottom: spacing.sm,
  },
  howtoLine: {
    color: colors.text.primary, fontSize: 12,
    lineHeight: 18, marginBottom: 4,
  },
});
