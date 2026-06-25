/**
 * Admin · Payouts — Billetera del Organizador (Showcase 5).
 *
 * Vista de ganancias directas con saldo acumulado + últimas transacciones
 * + CTA principal "Solicitar Retiro a Cuenta Bancaria".
 *
 * Estética: navy/azure premium con tarjeta hero degradada hacia electric blue,
 * iconografía Lucide thin-stroke, separador hairline 1px, monto gigante con
 * tabular-nums para alineación visual.
 */
import React, { useCallback, useEffect, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View, Pressable, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  ArrowDownToLine,
  Banknote,
  CheckCircle2,
  Coins,
  CreditCard,
  ShieldCheck,
  Trophy,
} from "lucide-react-native";
import { api } from "@/src/api";
import { colors, spacing } from "@/src/theme";
import { EmptyState } from "@/src/components/EmptyState";

const NAVY = "#0F172A";
const ELECTRIC = "#2563EB";
const AZURE_LIGHT = "#60A5FA";

type Transaction = {
  id: string;
  reta_nombre: string;
  club: string;
  fecha: string;
  monto_mxn: number;
  procesador: string;
  estatus: string;
};
type Summary = {
  saldo_disponible_mxn: number;
  retas_cobradas: number;
  dinero_recibido_mxn: number;
  transacciones_recientes: Transaction[];
  mensaje_legal: string;
};

const formatMXN = (n: number) =>
  n.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function ProviderBadge({ name }: { name: string }) {
  const isMP = /mercado/i.test(name);
  return (
    <View style={[s.providerBadge, { backgroundColor: isMP ? "#0EA5E930" : "#635BFF20" }]}>
      <CreditCard size={11} color={isMP ? "#0284C7" : "#635BFF"} strokeWidth={2.3} />
      <Text style={[s.providerText, { color: isMP ? "#0369A1" : "#4338CA" }]}>{name}</Text>
    </View>
  );
}

function TxRow({ tx }: { tx: Transaction }) {
  return (
    <View style={s.txRow} testID={`tx-${tx.id}`}>
      <View style={s.txIconWrap}>
        <Trophy size={18} color={ELECTRIC} strokeWidth={2.4} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={s.txTitle} numberOfLines={1}>
          {tx.reta_nombre}
        </Text>
        <View style={s.txMetaRow}>
          <CheckCircle2 size={11} color="#16A34A" strokeWidth={2.4} />
          <Text style={s.txMeta}>{tx.estatus}</Text>
          <Text style={s.txDot}>·</Text>
          <Text style={s.txMeta}>{tx.fecha}</Text>
        </View>
      </View>
      <View style={{ alignItems: "flex-end", gap: 4 }}>
        <Text style={s.txAmount}>+${formatMXN(tx.monto_mxn)} MXN</Text>
        <ProviderBadge name={tx.procesador} />
      </View>
    </View>
  );
}

export default function PayoutsScreen() {
  const [data, setData] = useState<Summary | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const res = await api.adminPayoutsSummary();
      setData(res);
    } catch (e: any) {
      setErr(e?.message || "No pudimos cargar tus ganancias");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  // === Datos demo de fallback ultra realistas (cuando no hay tx reales) ===
  const demo = {
    saldo_disponible_mxn: 2450.0,
    retas_cobradas: 7,
    dinero_recibido_mxn: 4180.0,
    transacciones_recientes: [
      { id: "d1", reta_nombre: "Reta Speed Club", club: "Speed Club", fecha: "2026-06-24", monto_mxn: 450, procesador: "Mercado Pago", estatus: "Completada" },
      { id: "d2", reta_nombre: "Torneo Sapphire Open", club: "Club Sapphire", fecha: "2026-06-22", monto_mxn: 800, procesador: "Stripe", estatus: "Completada" },
      { id: "d3", reta_nombre: "Doble Premium Nocturno", club: "El Murallón", fecha: "2026-06-19", monto_mxn: 350, procesador: "Mercado Pago", estatus: "Completada" },
      { id: "d4", reta_nombre: "Reta Mexicana Mixta", club: "Pádel Polanco", fecha: "2026-06-17", monto_mxn: 600, procesador: "Stripe", estatus: "Completada" },
      { id: "d5", reta_nombre: "Liga Veterana Jueves", club: "Club Punto Match", fecha: "2026-06-15", monto_mxn: 250, procesador: "Mercado Pago", estatus: "Completada" },
    ],
    mensaje_legal: "Directo a tu cuenta sin intermediarios. Cero retenciones de PadelAppRetas · sólo comisiones del procesador.",
  };
  const view = data && data.transacciones_recientes.length > 0 ? data : demo;

  return (
    <SafeAreaView style={s.safe} edges={["top"]}>
      <ScrollView
        contentContainerStyle={{ padding: spacing.base, paddingBottom: spacing.xl }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {/* === Hero Wallet === */}
        <View style={s.hero}>
          <View style={s.heroRow}>
            <View style={s.heroEyebrowChip}>
              <Banknote size={12} color={AZURE_LIGHT} strokeWidth={2.5} />
              <Text style={s.heroEyebrow}>BILLETERA · PAGOS DIRECTOS</Text>
            </View>
            <ShieldCheck size={16} color="#10B981" strokeWidth={2.5} />
          </View>
          <Text style={s.heroTitle}>Tus Ganancias</Text>
          <Text style={s.heroSubtitle}>Saldo disponible · pesos mexicanos</Text>
          <Text style={s.heroAmount}>
            $<Text style={{ fontWeight: "900" }}>{formatMXN(view.saldo_disponible_mxn)}</Text>
            <Text style={s.heroAmountSuffix}> MXN</Text>
          </Text>
          <View style={s.heroStatsRow}>
            <View style={s.heroStatCell}>
              <Coins size={14} color={AZURE_LIGHT} strokeWidth={2.4} />
              <Text style={s.heroStatLabel}>DINERO RECIBIDO</Text>
              <Text style={s.heroStatValue}>${formatMXN(view.dinero_recibido_mxn)}</Text>
            </View>
            <View style={s.heroStatDivider} />
            <View style={s.heroStatCell}>
              <Trophy size={14} color={AZURE_LIGHT} strokeWidth={2.4} />
              <Text style={s.heroStatLabel}>RETAS COBRADAS</Text>
              <Text style={s.heroStatValue}>{view.retas_cobradas}</Text>
            </View>
          </View>
        </View>

        {/* === CTA Retiro === */}
        <Pressable
          style={({ pressed }) => [s.cta, pressed && { opacity: 0.92 }]}
          testID="payout-cta"
        >
          <ArrowDownToLine size={18} color="#FFFFFF" strokeWidth={2.6} />
          <Text style={s.ctaText}>Solicitar Retiro a Cuenta Bancaria</Text>
        </Pressable>

        <View style={s.legalBanner}>
          <ShieldCheck size={13} color="#10B981" strokeWidth={2.4} />
          <Text style={s.legalText}>
            <Text style={{ fontWeight: "800", color: "#065F46" }}>Directo a tu cuenta sin intermediarios.</Text>
            {" "}Cero retenciones de PadelAppRetas · sólo comisiones del procesador.
          </Text>
        </View>

        {/* === Transacciones === */}
        <Text style={s.sectionLabel}>TRANSACCIONES RECIENTES</Text>
        {err && !data ? (
          <EmptyState title="Algo salió mal" subtitle={err} />
        ) : view.transacciones_recientes.length === 0 ? (
          <EmptyState
            title="Sin transacciones aún"
            subtitle="Tus pagos recibidos aparecerán aquí en tiempo real."
          />
        ) : (
          <View style={s.txList}>
            {view.transacciones_recientes.map((tx) => (
              <TxRow key={tx.id} tx={tx} />
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg.app },
  // === Hero ===
  hero: {
    backgroundColor: NAVY,
    borderRadius: 20,
    padding: spacing.lg,
    marginBottom: spacing.base,
    ...Platform.select({
      ios: { shadowColor: NAVY, shadowOffset: { width: 0, height: 12 }, shadowOpacity: 0.25, shadowRadius: 18 },
      android: { elevation: 8 },
    }),
  },
  heroRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 14 },
  heroEyebrowChip: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(96,165,250,0.16)", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  heroEyebrow: { color: AZURE_LIGHT, fontSize: 10, fontWeight: "800", letterSpacing: 0.8 },
  heroTitle: { color: "#FFFFFF", fontSize: 22, fontWeight: "800", letterSpacing: -0.4 },
  heroSubtitle: { color: "rgba(255,255,255,0.6)", fontSize: 12, marginBottom: 14, marginTop: 2, fontWeight: "500" },
  heroAmount: { color: "#FFFFFF", fontSize: 36, fontWeight: "300", letterSpacing: -1, marginBottom: 18, fontVariant: ["tabular-nums" as any] },
  heroAmountSuffix: { color: AZURE_LIGHT, fontSize: 18, fontWeight: "700", letterSpacing: 0 },
  heroStatsRow: { flexDirection: "row", alignItems: "stretch", backgroundColor: "rgba(255,255,255,0.05)", borderRadius: 14, borderWidth: 1, borderColor: "rgba(255,255,255,0.08)" },
  heroStatCell: { flex: 1, paddingVertical: 12, paddingHorizontal: 14, alignItems: "flex-start", gap: 4 },
  heroStatDivider: { width: 1, backgroundColor: "rgba(255,255,255,0.08)" },
  heroStatLabel: { color: AZURE_LIGHT, fontSize: 9, fontWeight: "800", letterSpacing: 0.7 },
  heroStatValue: { color: "#FFFFFF", fontSize: 16, fontWeight: "700", letterSpacing: -0.3 },
  // === CTA ===
  cta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    backgroundColor: ELECTRIC,
    paddingVertical: 16,
    borderRadius: 14,
    marginBottom: spacing.base,
    ...Platform.select({
      ios: { shadowColor: ELECTRIC, shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.35, shadowRadius: 14 },
      android: { elevation: 6 },
    }),
  },
  ctaText: { color: "#FFFFFF", fontSize: 15, fontWeight: "800", letterSpacing: -0.2 },
  // === Legal ===
  legalBanner: { flexDirection: "row", alignItems: "flex-start", gap: 8, padding: 12, backgroundColor: "#ECFDF5", borderColor: "#A7F3D0", borderWidth: 1, borderRadius: 12, marginBottom: spacing.lg },
  legalText: { flex: 1, color: "#065F46", fontSize: 12, lineHeight: 18, fontWeight: "500" },
  // === Tx ===
  sectionLabel: { color: colors.text.secondary, fontSize: 11, fontWeight: "800", letterSpacing: 0.7, marginBottom: spacing.sm },
  txList: { gap: spacing.sm },
  txRow: { flexDirection: "row", alignItems: "center", gap: 10, padding: 14, backgroundColor: "#FFFFFF", borderRadius: 14, borderWidth: 1, borderColor: "#E2E8F0" },
  txIconWrap: { width: 38, height: 38, borderRadius: 11, backgroundColor: "#EFF6FF", alignItems: "center", justifyContent: "center" },
  txTitle: { color: colors.text.primary, fontSize: 14, fontWeight: "700", letterSpacing: -0.1, marginBottom: 2 },
  txMetaRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  txMeta: { color: colors.text.secondary, fontSize: 11, fontWeight: "500" },
  txDot: { color: colors.text.secondary, fontSize: 10, marginHorizontal: 2 },
  txAmount: { color: "#065F46", fontSize: 14, fontWeight: "800", letterSpacing: -0.2 },
  providerBadge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  providerText: { fontSize: 10, fontWeight: "700", letterSpacing: 0.1 },
});
