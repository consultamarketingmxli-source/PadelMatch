/**
 * paywall.tsx — Pantalla de conversión "PREMIUM DE POR VIDA".
 *
 * Identidad: fondo elegante oscuro #0f172a · acento eléctrico #2563eb · íconos Lucide.
 * Vincula el CTA principal a `simulatePurchase()` para auditoría visual del flujo Pro.
 */
import React, { useState } from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Check, Crown, ShieldCheck, Sparkles, X, Zap } from "lucide-react-native";
import { useUserPlan } from "@/src/stores/userPlanStore";
import { LEGAL_URLS, openExternalLink } from "@/src/utils/legalLinks";

const NAVY = "#0f172a";
const ELECTRIC = "#2563eb";
const ELECTRIC_GLOW = "rgba(37, 99, 235, 0.18)";
const TEXT = "#f1f5f9";
const MUTED = "#94a3b8";
const SUCCESS = "#22c55e";

export default function PaywallScreen() {
  const router = useRouter();
  const { isPro, simulationMode, purchasePremium, simulateRevoke, priceMxn } = useUserPlan();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const handlePurchase = async () => {
    setLoading(true);
    setResult(null);
    const res = await purchasePremium();
    setLoading(false);
    if (res.success) {
      setResult("¡Bienvenido, Miembro Premium! 🏆 Premium activado.");
      setTimeout(() => router.back(), 1500);
    } else {
      setResult(res.reason === "user_cancelled" ? "Compra cancelada" : `Error: ${res.reason}`);
    }
  };

  const handleRevoke = async () => {
    await simulateRevoke();
    setResult("Premium revocado (sólo testing).");
  };

  const benefits = [
    {
      icon: <X size={22} color={ELECTRIC} strokeWidth={2.5} />,
      title: "Cero Publicidad",
      desc: "Adiós a todos los banners. Disfruta de una experiencia limpia y enfocada en jugar.",
    },
    {
      icon: <ShieldCheck size={22} color={ELECTRIC} strokeWidth={2.5} />,
      title: "Filtros Anti-Flake",
      desc: "Crea retas exclusivas para jugadores con +90% de asistencia. Adiós a los flakers.",
    },
    {
      icon: <Crown size={22} color={ELECTRIC} strokeWidth={2.5} />,
      title: "Estatus Premium",
      desc: "Insignia exclusiva visible en tu perfil. Reconocimiento permanente en la comunidad.",
    },
  ];

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <TouchableOpacity style={styles.closeBtn} onPress={() => router.back()} testID="paywall-close">
          <X size={22} color={MUTED} />
        </TouchableOpacity>

        {/* Hero */}
        <View style={styles.heroIconWrap}>
          <View style={styles.heroIconGlow}>
            <Crown size={48} color={ELECTRIC} strokeWidth={2.5} />
          </View>
        </View>
        <Text style={styles.title}>Hazte Premium</Text>
        <Text style={styles.subtitle}>
          Una sola vez. Para siempre. Sin suscripciones.
        </Text>

        {/* Benefits list */}
        <View style={styles.benefits}>
          {benefits.map((b, i) => (
            <View key={i} style={styles.benefit}>
              <View style={styles.benefitIcon}>{b.icon}</View>
              <View style={{ flex: 1 }}>
                <Text style={styles.benefitTitle}>{b.title}</Text>
                <Text style={styles.benefitDesc}>{b.desc}</Text>
              </View>
            </View>
          ))}
        </View>

        {/* Price card */}
        <View style={styles.priceCard}>
          <View style={styles.priceTagRow}>
            <Sparkles size={14} color={ELECTRIC} />
            <Text style={styles.priceTag}>OFERTA DE LANZAMIENTO</Text>
          </View>
          <View style={styles.priceRow}>
            <Text style={styles.priceCurrency}>$</Text>
            <Text style={styles.priceAmount}>{priceMxn}</Text>
            <Text style={styles.priceCurrency}> MXN</Text>
          </View>
          <Text style={styles.priceSub}>Pago único · Acceso de por vida</Text>
        </View>

        {/* CTA */}
        {isPro ? (
          <View style={[styles.cta, styles.ctaActive]}>
            <Check size={20} color={SUCCESS} strokeWidth={3} />
            <Text style={styles.ctaActiveText}>Premium ACTIVO</Text>
          </View>
        ) : (
          <TouchableOpacity
            style={[styles.cta, loading && styles.ctaLoading]}
            onPress={handlePurchase}
            disabled={loading}
            activeOpacity={0.85}
            testID="paywall-purchase-btn"
          >
            <Zap size={18} color="#fff" strokeWidth={2.5} />
            <Text style={styles.ctaText}>
              {loading ? "Procesando..." : `Desbloquear de Por Vida por $${priceMxn} MXN`}
            </Text>
          </TouchableOpacity>
        )}

        {/* Feedback */}
        {result && (
          <Text style={[styles.feedback, result.includes("Error") && { color: "#ef4444" }]}>
            {result}
          </Text>
        )}

        {/* Modo banner */}
        {simulationMode && (
          <View style={styles.simBanner}>
            <Text style={styles.simBannerText}>
              MODO SANDBOX · Compra simulada sin cargo real
            </Text>
          </View>
        )}

        {/* Botón testing revoke (sólo en simulación) */}
        {simulationMode && isPro && (
          <TouchableOpacity onPress={handleRevoke} style={styles.revokeBtn} testID="paywall-revoke-btn">
            <Text style={styles.revokeText}>Revocar Premium (test)</Text>
          </TouchableOpacity>
        )}

        <Text style={styles.legal}>
          Al adquirir el Pase de Por Vida, aceptas nuestros{" "}
          <Text
            style={styles.legalLink}
            onPress={() => openExternalLink(LEGAL_URLS.terms)}
            testID="paywall-terms-link"
          >
            Términos de Servicio
          </Text>
          {" "}y{" "}
          <Text
            style={styles.legalLink}
            onPress={() => openExternalLink(LEGAL_URLS.privacy)}
            testID="paywall-privacy-link"
          >
            Política de Privacidad
          </Text>
          . Pago procesado por App Store / Google Play. Sin renovación automática.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: NAVY },
  scroll: { paddingHorizontal: 24, paddingTop: 12, paddingBottom: 48 },
  closeBtn: { alignSelf: "flex-end", padding: 8, marginBottom: 8 },
  heroIconWrap: { alignItems: "center", marginTop: 8, marginBottom: 24 },
  heroIconGlow: {
    width: 96, height: 96, borderRadius: 28,
    backgroundColor: ELECTRIC_GLOW,
    alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: "rgba(37,99,235,0.4)",
  },
  title: {
    fontSize: 30, fontWeight: "800", color: TEXT, textAlign: "center",
    letterSpacing: -0.6, marginBottom: 8,
    ...Platform.select({ default: { fontFamily: "PlusJakartaSans_800ExtraBold" }, web: {} }),
  },
  subtitle: {
    fontSize: 14, color: MUTED, textAlign: "center", marginBottom: 32,
    letterSpacing: 0.2, lineHeight: 20,
  },
  benefits: { gap: 18, marginBottom: 28 },
  benefit: { flexDirection: "row", gap: 14, alignItems: "flex-start" },
  benefitIcon: {
    width: 44, height: 44, borderRadius: 12,
    backgroundColor: ELECTRIC_GLOW, alignItems: "center", justifyContent: "center",
  },
  benefitTitle: {
    fontSize: 15, fontWeight: "700", color: TEXT, marginBottom: 3, letterSpacing: -0.2,
  },
  benefitDesc: { fontSize: 12.5, color: MUTED, lineHeight: 17, letterSpacing: 0.1 },
  priceCard: {
    backgroundColor: "rgba(37, 99, 235, 0.08)",
    borderWidth: 1, borderColor: "rgba(37, 99, 235, 0.3)",
    borderRadius: 16, padding: 20, alignItems: "center", marginBottom: 18,
  },
  priceTagRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 },
  priceTag: {
    fontSize: 10, fontWeight: "800", color: ELECTRIC,
    letterSpacing: 2, textTransform: "uppercase",
  },
  priceRow: { flexDirection: "row", alignItems: "baseline" },
  priceCurrency: { fontSize: 16, fontWeight: "700", color: TEXT },
  priceAmount: {
    fontSize: 56, fontWeight: "900", color: TEXT, letterSpacing: -2, lineHeight: 60,
  },
  priceSub: { fontSize: 12, color: MUTED, marginTop: 6 },
  cta: {
    backgroundColor: ELECTRIC, borderRadius: 14, paddingVertical: 16,
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    shadowColor: ELECTRIC, shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4, shadowRadius: 16, elevation: 8,
  },
  ctaLoading: { opacity: 0.7 },
  ctaActive: { backgroundColor: "rgba(34,197,94,0.18)", borderWidth: 1, borderColor: SUCCESS },
  ctaActiveText: { color: SUCCESS, fontSize: 16, fontWeight: "800", letterSpacing: 0.3 },
  ctaText: { color: "#fff", fontSize: 15, fontWeight: "800", letterSpacing: 0.2 },
  feedback: { marginTop: 14, fontSize: 13, color: SUCCESS, textAlign: "center", fontWeight: "600" },
  simBanner: {
    marginTop: 18, backgroundColor: "rgba(250,204,21,0.1)",
    borderWidth: 1, borderColor: "rgba(250,204,21,0.35)",
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8,
  },
  simBannerText: {
    fontSize: 10, color: "#facc15", textAlign: "center",
    fontWeight: "700", letterSpacing: 1.2, textTransform: "uppercase",
  },
  revokeBtn: { marginTop: 18, alignItems: "center", padding: 12 },
  revokeText: { color: MUTED, fontSize: 12, textDecorationLine: "underline" },
  legal: { fontSize: 10, color: "#475569", textAlign: "center", marginTop: 24, lineHeight: 15 },
  legalLink: {
    color: "#60a5fa",
    textDecorationLine: "underline",
    fontWeight: "600",
    opacity: 0.92,
  },
});
