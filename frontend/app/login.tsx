/**
 * Login de Jugador — Iter57 · Fase 3.
 *
 * Post-purga de Twilio: sólo dos opciones de autenticación, ambas costo $0:
 *   1. Google Sign-In (Emergent-managed OAuth)
 *   2. Email Magic Link OTP (Resend vía Emergent)
 *
 * El flujo OTP-por-WhatsApp fue removido completamente (endpoints en backend
 * responden 410 Gone). Los usuarios que tenían JWTs viejos (`sub=telefono`)
 * pueden seguir usando la app hasta que expire su sesión — el backend
 * tolera ambos formatos de token vía `identity_kind` en `get_current_player`.
 *
 * UX:
 *   • Composición vertical simple, mobile-first, thumb-friendly.
 *   • Cada botón es CTA de tamaño 48pt.
 *   • Legal consent visible antes del primer tap (compliance).
 *   • Toast global para feedback de errores no-bloqueantes.
 */
import React, { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Mail } from "lucide-react-native";

import { BrandLogo } from "@/src/components/BrandLogo";
import { BrandWordmark } from "@/src/components/BrandWordmark";
import { Toast } from "@/src/components/Toast";
import { api } from "@/src/api";
import { decideNextRoute, getLastRole } from "@/src/utils/roleSelection";
import { colors, radii, spacing, typography } from "@/src/theme";
import { deepLinkStore } from "@/src/utils/deepLinkStore";
import { LegalConsent } from "@/src/components/LegalConsent";
import { acceptLegal } from "@/src/utils/legalConsent";
import { parseApiErrorMessage } from "@/src/utils/phoneFormat";
import { signInWithGoogle } from "@/src/utils/emergentAuth";

export default function PlayerLogin() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<{
    visible: boolean;
    message: string;
    tone: "info" | "warn" | "error";
  }>({ visible: false, message: "", tone: "info" });

  const showToast = (
    message: string,
    tone: "info" | "warn" | "error" = "info",
  ) => setToast({ visible: true, message, tone });

  const signInGoogle = async () => {
    setLoading(true);
    try {
      const result = await signInWithGoogle();
      if (result.status === "cancelled") return;
      if (result.status === "error") {
        showToast(
          result.message || "No pudimos iniciar sesión con Google.",
          "error",
        );
        return;
      }
      // Success — el helper ya persistió el JWT.
      void acceptLegal(result.user.email ?? result.user.user_id);
      if (!result.user.profile_completed) {
        router.replace("/onboarding" as any);
        return;
      }
      try {
        const roles = await api.playerMyRoles(result.access_token);
        const lastRole = await getLastRole();
        const next = decideNextRoute(roles, lastRole);
        try {
          const pending = await deepLinkStore.consume();
          if (pending) {
            router.replace(pending as any);
            return;
          }
        } catch {
          /* swallow */
        }
        router.replace(next as any);
      } catch {
        router.replace("/mi-cuenta" as any);
      }
    } catch (e: unknown) {
      const parsed = parseApiErrorMessage(
        e,
        "Error inesperado en Google Sign-In.",
      );
      showToast(parsed.message, "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
        >
          {/* Hero — brand lockup */}
          <View style={styles.hero}>
            <BrandLogo size={64} />
            <BrandWordmark size="lg" />
            <Text style={styles.tagline}>Retas de pádel, sin complicaciones.</Text>
          </View>

          {/* Card con los dos CTAs de auth */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Iniciá sesión</Text>
            <Text style={styles.cardSub}>
              Elegí cómo querés entrar. Vas a poder acceder desde cualquier
              dispositivo.
            </Text>

            <TouchableOpacity
              onPress={signInGoogle}
              disabled={loading}
              activeOpacity={0.85}
              style={[styles.googleBtn, loading && { opacity: 0.6 }]}
              testID="google-signin-btn"
            >
              <Text style={styles.googleG}>G</Text>
              <Text style={styles.googleLabel}>Continuar con Google</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => router.push("/login-email" as any)}
              disabled={loading}
              activeOpacity={0.85}
              style={[styles.emailBtn, loading && { opacity: 0.6 }]}
              testID="email-signin-btn"
            >
              <Mail size={18} color={colors.text.primary} />
              <Text style={styles.emailLabel}>Continuar con Correo</Text>
            </TouchableOpacity>

            <View style={styles.legalWrap}>
              <LegalConsent />
            </View>

            <TouchableOpacity
              onPress={() => router.push("/admin/login" as any)}
              activeOpacity={0.7}
              style={styles.adminLink}
              testID="admin-login-link"
            >
              <Text style={styles.adminTxt}>¿Eres organizador? Ingresa acá</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>

        {/* Fondo decorativo — cancha de pádel */}
        <View pointerEvents="none" style={styles.decorativeCourt}>
          <LinearGradient
            colors={["transparent", colors.bg.app]}
            style={StyleSheet.absoluteFill}
            start={{ x: 0.5, y: 0 }}
            end={{ x: 0.5, y: 0.6 }}
          />
        </View>
      </KeyboardAvoidingView>

      <Toast
        visible={toast.visible}
        message={toast.message}
        tone={toast.tone}
        onHide={() => setToast((t) => ({ ...t, visible: false }))}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg.app },
  scroll: { padding: spacing.lg, gap: spacing.md, paddingBottom: 160 },
  hero: {
    alignItems: "center",
    marginTop: spacing.xl,
    marginBottom: spacing.lg,
    gap: 12,
  },
  tagline: {
    ...typography.body,
    color: colors.text.secondary,
    textAlign: "center",
    fontSize: 14,
    marginTop: 4,
  },
  card: {
    backgroundColor: colors.bg.card,
    borderWidth: 1,
    borderColor: colors.border.blueHairline,
    borderRadius: radii.lg,
    padding: spacing.lg,
    gap: spacing.sm,
    ...Platform.select({
      ios: { boxShadow: "0px 4px 12px rgba(15,23,42,0.06)" },
      android: { elevation: 2 },
      web: { boxShadow: "0 4px 12px rgba(15,23,42,0.06)" } as any,
    }),
  },
  cardTitle: {
    ...typography.h2,
    color: colors.text.primary,
    fontSize: 20,
  },
  cardSub: {
    color: colors.text.secondary,
    fontSize: 13,
    lineHeight: 19,
    marginBottom: spacing.sm,
  },
  googleBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    minHeight: 48,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: "#D1D5DB",
    backgroundColor: "#FFFFFF",
    paddingHorizontal: spacing.md,
    ...Platform.select({
      ios: { boxShadow: "0px 1px 2px rgba(0,0,0,0.06)" },
      android: { elevation: 1 },
      web: { boxShadow: "0 1px 2px rgba(0,0,0,0.06)" } as any,
    }),
  },
  googleG: {
    fontSize: 20,
    fontWeight: "700",
    color: "#4285F4",
    fontFamily: Platform.select({
      ios: "Georgia",
      android: "serif",
      default: "serif",
    }),
    lineHeight: 22,
  },
  googleLabel: {
    fontSize: 15,
    fontWeight: "600",
    color: "#1F1F1F",
    letterSpacing: 0.15,
  },
  emailBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    marginTop: spacing.xs,
    minHeight: 48,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border.blueHairline,
    backgroundColor: colors.bg.app,
    paddingHorizontal: spacing.md,
  },
  emailLabel: {
    fontSize: 15,
    fontWeight: "600",
    color: colors.text.primary,
    letterSpacing: 0.15,
  },
  legalWrap: { marginTop: spacing.md },
  adminLink: {
    marginTop: spacing.md,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  adminTxt: {
    color: colors.text.secondary,
    fontSize: 12,
    textDecorationLine: "underline",
  },
  decorativeCourt: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: 180,
  },
});
