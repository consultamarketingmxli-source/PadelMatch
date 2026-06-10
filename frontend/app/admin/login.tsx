/**
 * Login Admin — Split Grid 50/50 (Director de Arte v3).
 *
 * Composición precisa según spec:
 *
 *   BLOQUE SUPERIOR (50% de la pantalla)
 *     • bg-slate-50 (#F8FAFC)
 *     • Isotipo PadelAppRetas centrado (`Padel` font-bold slate-900 +
 *       `AppRetas` font-black text-emerald-600)
 *     • Tagline minimalista
 *     • Formulario express de acceso (Email + Password + CTA)
 *
 *   BLOQUE INFERIOR (50% de la pantalla)
 *     • Foto real Pexels: pista de pádel naranja/arcilla con red negra
 *       en primer plano y luz dorada (3/4 lateral).
 *     • Gradient mask: from-slate-50 (top) → transparent (bottom) — 35%
 *       de la altura del bloque, garantizando fusión limpia con el form.
 *     • Cinta inferior "PadelAppRetas" sobre la foto.
 */
import React, { useEffect, useState } from "react";
import {
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
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
import { LegalConsent } from "@/src/components/LegalConsent";
import { acceptLegal } from "@/src/utils/legalConsent";

/**
 * Foto cancha — v4: imagen iconográfica de cancha azul (vista cenital, completa).
 * Cargada desde assets locales para que se muestre IGUAL en web y nativo.
 */
const COURT_IMAGE = require("@/assets/brand/court-iconic.jpg");

export default function AdminLogin() {
  const router = useRouter();
  const [email, setEmail] = useState("admin@padelappretas.com");
  const [password, setPassword] = useState("admin123");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    (async () => {
      const t = await api.getToken();
      // Si ya hay token, vamos al Hub de bifurcación (no directamente a /admin)
      // para que el usuario pueda escoger ambiente o usar last_role.
      if (t) router.replace("/seleccion");
    })();
  }, [router]);

  const submit = async () => {
    setLoading(true);
    try {
      await api.login(email, password);
      // Registra consentimiento legal (Location A) — best-effort, no bloquea.
      void acceptLegal(email.trim().toLowerCase());
      // Tras el login NO pre-fijamos rol — el usuario lo elige en el Hub.
      // Si en sesiones anteriores tocó un CTA, la pantalla /seleccion
      // detectará el last_role y aplicará el "salto inteligente".
      router.replace("/seleccion");
    } catch (e: any) {
      Alert.alert("Acceso denegado", e.message ?? "Revisa tus credenciales");
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.root} testID="admin-login-screen">
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={{ flexGrow: 1 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          bounces={false}
        >
          {/* ================================================================
              BLOQUE SUPERIOR — 50% pantalla, bg slate-50, formulario.
              ================================================================ */}
          <View style={styles.topBlock}>
            <SafeAreaView edges={["top"]} style={styles.topInner}>
              {/* Isotipo unificado: Logo + Wordmark Padel / AppRetas */}
              <View style={styles.brandHeader}>
                <BrandLogo size={56} />
                <View style={styles.wordmarkSpace}>
                  <BrandWordmark size="xl" />
                </View>
                <Text style={styles.tag}>· PANEL ADMIN</Text>
              </View>

              {/* Formulario express */}
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
                  Demo: admin@padelappretas.com / admin123
                </Text>
                {/* Legal consent — Location A (Onboarding) */}
                <LegalConsent />
              </View>
            </SafeAreaView>
          </View>

          {/* ================================================================
              BLOQUE INFERIOR — 50% pantalla, foto inmersiva con mask.
              ================================================================ */}
          <View style={[styles.bottomBlock, { pointerEvents: "box-none" }]}>
            {/* Foto base */}
            <Image
              source={COURT_IMAGE}
              style={styles.heroPhoto}
              resizeMode="cover"
              accessibilityIgnoresInvertColors
              accessibilityLabel="Cancha de pádel con pelotas y pala"
            />
            {/* Gradient mask: top → slate-50 que se desvanece a transparente */}
            <LinearGradient
              colors={[
                "#F8FAFC",
                "rgba(248, 250, 252, 0.85)",
                "rgba(248, 250, 252, 0)",
              ]}
              locations={[0, 0.35, 1]}
              style={[styles.bottomGradient, { pointerEvents: "none" }]}
            />

            {/* Cinta inferior con isotipo */}
            <View style={[styles.footerStrip, { pointerEvents: "none" }]}>
              <View style={styles.footerBadge}>
                <BrandLogo size={18} />
                <BrandWordmark size="sm" />
              </View>
              <Text style={styles.footerKicker}>· Tournament OS · 2026</Text>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#F8FAFC" }, // slate-50

  // ===== BLOQUE SUPERIOR 50% =====
  topBlock: {
    minHeight: 500, // garantiza espacio para formulario en pantallas chicas
    backgroundColor: "#F8FAFC",
    paddingHorizontal: spacing.lg,
  },
  topInner: {
    flex: 1,
    alignItems: "center",
    paddingTop: spacing.lg,
  },
  brandHeader: {
    alignItems: "center",
    marginBottom: spacing.lg,
  },
  wordmarkSpace: { marginTop: spacing.sm },
  tag: {
    ...typography.label,
    color: colors.brand.primary,
    fontSize: 10,
    marginTop: spacing.xs,
    letterSpacing: 2,
  },

  // ===== Card formulario =====
  formCard: {
    width: "100%",
    maxWidth: 440,
    padding: spacing.lg,
    borderRadius: radii.xl,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: colors.border.hairline, // slate-200/60 — Director Arte spec
    ...(shadows.premium as object), // 0_8px_30px rgba(15,23,42,0.02)
  },
  formTitle: {
    ...typography.h3,
    color: colors.text.primary,
    marginBottom: spacing.md,
  },
  hint: {
    ...typography.mono,
    fontSize: 10,
    color: colors.text.muted,
    textAlign: "center",
    marginTop: spacing.md,
  },

  // ===== BLOQUE INFERIOR (foto cancha iconográfica completa) =====
  bottomBlock: {
    height: 320,
    position: "relative",
    overflow: "hidden",
    backgroundColor: "#F8FAFC",
  },
  heroPhoto: {
    ...StyleSheet.absoluteFillObject,
    width: "100%",
    height: "100%",
  },
  bottomGradient: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 80, // mucho más sutil — solo fusión con el form, NO cubre la imagen
  },
  footerStrip: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: "center",
    paddingBottom: spacing.lg + 4,
    gap: 6,
  },
  footerBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.pill,
    backgroundColor: "rgba(255, 255, 255, 0.94)",
    borderWidth: 1,
    borderColor: colors.border.hairline,
    ...(shadows.premium as object),
  },
  footerKicker: {
    ...typography.label,
    fontSize: 9,
    color: "#FFFFFF",
    letterSpacing: 2,
    ...Platform.select({
      web: { textShadow: "0px 1px 2px rgba(15,23,42,0.4)" } as any,
      default: {
        textShadowColor: "rgba(15,23,42,0.4)",
        textShadowOffset: { width: 0, height: 1 },
        textShadowRadius: 2,
      },
    }),
  },
});
