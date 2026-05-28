/**
 * Login Admin — Composición Híbrida de Alto Impacto.
 *
 * Director de Arte spec:
 *   • Split-screen vertical (~50/50 en desktop, 60/40 en mobile).
 *   • Mitad SUPERIOR (Identidad Limpia): bg-slate-50, logo + wordmark "Padel" +
 *     "AppRetas" + formulario minimalista.
 *   • Mitad INFERIOR (Inmersión Fotográfica Real): foto de cancha de pádel
 *     panorámica premium 3/4 con cristales templados, césped texturizado y red.
 *   • TRANSICIÓN: degradado linear `bg-gradient-to-t from-transparent to-slate-50`
 *     en la unión — sin cortes toscos.
 */
import React, { useEffect, useState } from "react";
import {
  Alert,
  Dimensions,
  Image,
  ImageBackground,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";

import { api } from "@/src/api";
import { Button } from "@/src/components/Button";
import { Input } from "@/src/components/Input";
import { BrandLogo } from "@/src/components/BrandLogo";
import { BrandWordmark } from "@/src/components/BrandWordmark";
import { colors, radii, shadows, spacing, typography } from "@/src/theme";

// Foto panorámica premium de cancha de pádel vacía con paredes de cristal.
// Fuente: Pexels CC0 — vista panorámica ideal para split layout.
// Pesa <80 KB con compresión automática del CDN.
const COURT_IMAGE_URI =
  "https://images.pexels.com/photos/32474981/pexels-photo-32474981.jpeg?auto=compress&cs=tinysrgb&w=1600&fit=crop&v=2";

export default function AdminLogin() {
  const router = useRouter();
  const [email, setEmail] = useState("admin@padelappretas.com");
  const [password, setPassword] = useState("admin123");
  const [loading, setLoading] = useState(false);
  const { height: screenH } = Dimensions.get("window");

  useEffect(() => {
    (async () => {
      const t = await api.getToken();
      if (t) router.replace("/admin");
    })();
  }, [router]);

  const submit = async () => {
    setLoading(true);
    try {
      await api.login(email, password);
      router.replace("/admin");
    } catch (e: any) {
      Alert.alert("Acceso denegado", e.message ?? "Revisa tus credenciales");
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.root}>
      {/* --- FONDO INFERIOR: foto cancha pádel (capa 0) --- */}
      <View style={styles.bgWrap} pointerEvents="none">
        <ImageBackground
          source={{ uri: COURT_IMAGE_URI }}
          style={styles.bgImage}
          resizeMode="cover"
        >
          {/* Velo oscuro sutil para legibilidad si en futuro hay overlays */}
          <View style={styles.bgVeil} />
        </ImageBackground>
        {/* Degradado de unión: from-transparent to-slate-50 */}
        <LinearGradient
          colors={["#F8FAFC", "rgba(248, 250, 252, 0.95)", "rgba(248, 250, 252, 0)"]}
          locations={[0, 0.55, 1]}
          style={styles.bgGradient}
        />
      </View>

      {/* --- CONTENIDO (capa 1) --- */}
      <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={{ flex: 1 }}
        >
          {/* === HERO TOP (identidad limpia) === */}
          <View style={styles.heroTop}>
            <View style={styles.brandRow}>
              <BrandLogo size={64} />
            </View>
            <View style={styles.wordmarkWrap}>
              <BrandWordmark size="xl" />
            </View>
            <Text style={styles.tag}>· PANEL ADMIN</Text>
            <Text style={styles.subtitle}>
              Acceso para organizadores de clubes de pádel.
            </Text>
          </View>

          {/* === CARD FORM === */}
          <View style={styles.formCard}>
            <Text style={styles.formTitle}>Ingresa al panel</Text>
            <Input
              label="Email"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              testID="admin-email-input"
            />
            <Input
              label="Password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              testID="admin-password-input"
            />
            <Button
              title="Entrar al panel"
              onPress={submit}
              loading={loading}
              testID="admin-login-btn"
            />
            <Text style={styles.hint}>
              Credenciales demo: admin@padelappretas.com / admin123
            </Text>
          </View>

          {/* === FOOTER: brand line sobre la foto === */}
          <View style={styles.footerBrand}>
            <View style={styles.footerBadge}>
              <BrandLogo size={20} />
              <BrandWordmark size="sm" />
            </View>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg.app },
  bgWrap: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  bgImage: { flex: 1 },
  bgVeil: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(15, 23, 42, 0.18)",
  },
  bgGradient: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    // Cubre los primeros 60% de la pantalla con fade → la foto queda visible
    // solo en el tramo inferior.
    height: "60%",
  },
  safe: { flex: 1 },

  // ===== Hero superior =====
  heroTop: {
    paddingTop: spacing.xl,
    paddingHorizontal: spacing.lg,
    alignItems: "center",
  },
  brandRow: { marginBottom: spacing.sm },
  wordmarkWrap: { marginVertical: spacing.xs },
  tag: {
    ...typography.label,
    color: colors.brand.primary,
    fontSize: 10,
    marginTop: spacing.xs,
  },
  subtitle: {
    ...typography.bodyRelaxed,
    color: colors.text.secondary,
    textAlign: "center",
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
  },

  // ===== Card formulario =====
  formCard: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.lg,
    padding: spacing.lg,
    borderRadius: radii.xl,
    backgroundColor: colors.bg.card,
    borderWidth: 1,
    borderColor: colors.border.soft80,
    ...(shadows.card as object),
  },
  formTitle: {
    ...typography.h3,
    color: colors.text.primary,
    marginBottom: spacing.md,
  },
  hint: {
    ...typography.caption,
    color: colors.text.muted,
    textAlign: "center",
    marginTop: spacing.md,
  },

  // ===== Footer brand (sobre la foto) =====
  footerBrand: {
    flex: 1,
    justifyContent: "flex-end",
    alignItems: "center",
    paddingBottom: spacing.xl,
  },
  footerBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.pill,
    backgroundColor: "rgba(255, 255, 255, 0.92)",
    borderWidth: 1,
    borderColor: colors.border.soft80,
  },
});
