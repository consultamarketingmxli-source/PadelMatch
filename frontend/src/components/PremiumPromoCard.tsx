/**
 * PremiumPromoCard — Card promocional entre retas pasadas en /mi-cuenta.
 *
 * Cortocircuito: si isPro === true → retorna null (no renderiza nada).
 * Si Free → muestra promo CTA "Elimina anuncios para siempre · $349 MXN"
 */
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Ban, ChevronRight } from "lucide-react-native";
import { useSubscription } from "@/src/hooks/useSubscription";

const NAVY = "#0f172a";
const ELECTRIC = "#2563eb";

export function PremiumPromoCard() {
  const router = useRouter();
  const { isPro } = useSubscription();
  if (isPro) return null;

  return (
    <Pressable
      onPress={() => router.push("/paywall" as never)}
      style={({ pressed }) => [styles.card, pressed && { opacity: 0.92 }]}
      testID="premium-promo-card"
    >
      <View style={styles.iconWrap}>
        <Ban size={20} color="#ffffff" strokeWidth={2.5} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>Elimina los anuncios para siempre</Text>
        <Text style={styles.subtitle}>
          Pago único de $349 MXN · acceso de por vida
        </Text>
      </View>
      <ChevronRight size={18} color="rgba(255,255,255,0.7)" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 14,
    paddingVertical: 13,
    paddingHorizontal: 14,
    marginVertical: 10,
    backgroundColor: NAVY,
    borderWidth: 1,
    borderColor: "rgba(37,99,235,0.4)",
  },
  iconWrap: {
    width: 38, height: 38, borderRadius: 10,
    backgroundColor: ELECTRIC,
    alignItems: "center", justifyContent: "center",
  },
  title: { color: "#fff", fontSize: 14, fontWeight: "700", letterSpacing: -0.1 },
  subtitle: { color: "rgba(255,255,255,0.7)", fontSize: 11, marginTop: 2, fontWeight: "500" },
});

export default PremiumPromoCard;
