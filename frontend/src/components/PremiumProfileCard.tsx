/**
 * PremiumProfileCard — Card en perfil del usuario (rebranding "Premium").
 *
 * Estados:
 *   - Free  → CTA brillante "Hazte Premium - Acceso de por Vida"
 *   - Pro   → Insignia "Miembro Premium" (azul navy + dorado sutil)
 *
 * Nota técnica:
 *   Los identificadores RevenueCat ('premium_access',
 *   'padelapp_fundadores_lifetime') permanecen intactos en el backend para
 *   evitar romper la persistencia y los registros históricos de suscripción.
 *   Este componente sólo limpia los copys de la interfaz de usuario.
 */
import React from "react";
import { Pressable, StyleSheet, Text, View, Platform } from "react-native";
import { useRouter } from "expo-router";
import { Crown, Sparkles, Zap } from "lucide-react-native";
import { useSubscription } from "@/src/hooks/useSubscription";

const NAVY = "#0f172a";
const ELECTRIC = "#2563eb";
const GOLD = "#fbbf24";
const PRO_BG = "#0f172a";
const FREE_GRADIENT_BG = "#1e40af";

export function PremiumProfileCard() {
  const router = useRouter();
  const { isPro } = useSubscription();

  if (isPro) {
    return (
      <View style={[styles.card, styles.cardPro]} testID="premium-badge-card">
        <View style={styles.proIconWrap}>
          <Crown size={22} color={GOLD} strokeWidth={2.5} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.proTitle}>Miembro Premium</Text>
          <Text style={styles.proSubtitle}>Acceso de por vida · todos los beneficios</Text>
        </View>
        <Sparkles size={18} color={GOLD} />
      </View>
    );
  }

  return (
    <Pressable
      onPress={() => router.push("/paywall" as never)}
      style={({ pressed }) => [styles.card, styles.cardFree, pressed && { opacity: 0.9 }]}
      testID="premium-cta-card"
    >
      <View style={styles.freeIconWrap}>
        <Crown size={22} color="#ffffff" strokeWidth={2.5} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.freeTitle}>Hazte Premium - Acceso de por Vida</Text>
        <Text style={styles.freeSubtitle}>Pase Premium · $349 MXN · pago único</Text>
      </View>
      <View style={styles.zapBtn}>
        <Zap size={14} color="#ffffff" strokeWidth={3} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginBottom: 16,
    ...Platform.select({
      ios: {
        shadowColor: NAVY,
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.18,
        shadowRadius: 14,
      },
      android: { elevation: 5 },
    }),
  },
  cardFree: {
    backgroundColor: FREE_GRADIENT_BG,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
  },
  cardPro: {
    backgroundColor: PRO_BG,
    borderWidth: 1.2,
    borderColor: GOLD,
  },
  freeIconWrap: {
    width: 44, height: 44, borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.18)",
    alignItems: "center", justifyContent: "center",
  },
  proIconWrap: {
    width: 44, height: 44, borderRadius: 12,
    backgroundColor: "rgba(251,191,36,0.16)",
    alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: "rgba(251,191,36,0.4)",
  },
  freeTitle: { color: "#fff", fontSize: 14, fontWeight: "800", letterSpacing: -0.2 },
  freeSubtitle: { color: "rgba(255,255,255,0.85)", fontSize: 11, marginTop: 2, fontWeight: "500" },
  proTitle: { color: "#fff", fontSize: 15, fontWeight: "800", letterSpacing: -0.2 },
  proSubtitle: { color: GOLD, fontSize: 11, marginTop: 2, fontWeight: "600", letterSpacing: 0.2 },
  zapBtn: {
    width: 32, height: 32, borderRadius: 10,
    backgroundColor: ELECTRIC,
    alignItems: "center", justifyContent: "center",
  },
});

export default PremiumProfileCard;
