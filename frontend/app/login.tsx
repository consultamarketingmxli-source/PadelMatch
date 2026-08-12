/**
 * login.tsx — Player Login (Iter64 · Light card-based layout).
 *
 * Post-Fase-3: sólo Google Sign-In + Email Magic Link (auth costo $0).
 *
 * ═══════════════ Composición (light, card-based) ═══════════════
 *
 *  ┌──────────────────────────────────────────┐
 *  │            (light bg #F4F6F8)            │
 *  │                                          │
 *  │            PadelAppRetas                 │  ← top title
 *  │              [LOGO 88pt]                 │  ← logo squircle
 *  │       JUEGA · COMPITE · MEJORA           │  ← tagline blue uppercase
 *  │                                          │
 *  │   ╭──────────── CARD ───────────────╮    │
 *  │   │  Inicia sesión                  │    │
 *  │   │  Tu próxima reta te espera      │    │
 *  │   │  Elige cómo quieres entrar...   │    │
 *  │   │  ┌─[G] Continuar con Google─┐   │    │  ← primary
 *  │   │  ┌─ ✉ Continuar con Correo─┐   │    │  ← secondary
 *  │   │  ┌────── legal box ────────┐   │    │
 *  │   ╰─────────────────────────────╯    │
 *  │                                          │
 *  │   ¿Eres organizador? Ingresa acá         │
 *  │                                          │
 *  │  ░░░ soft blue court gradient bottom ░░░ │  ← 20% bottom
 *  └──────────────────────────────────────────┘
 */
import React, { useState } from "react";
import {
  Image,
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

import { Toast } from "@/src/components/Toast";
import { GoogleGIcon } from "@/src/components/GoogleGIcon";
import { api } from "@/src/api";
import { decideNextRoute, getLastRole } from "@/src/utils/roleSelection";
import { spacing } from "@/src/theme";
import { deepLinkStore } from "@/src/utils/deepLinkStore";
import { acceptLegal } from "@/src/utils/legalConsent";
import { parseApiErrorMessage } from "@/src/utils/phoneFormat";
import { signInWithGoogle } from "@/src/utils/emergentAuth";

const BRAND_ICON = require("../assets/images/icon.png");

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
          showsVerticalScrollIndicator={false}
        >
          {/* ═══ Hero — Title + Logo + Tagline ═══ */}
          <View style={styles.hero}>
            <Text style={styles.brandTitle}>
              Padel<Text style={styles.brandTitleAccent}>AppRetas</Text>
            </Text>

            <View style={styles.logoWrap}>
              <Image
                source={BRAND_ICON}
                style={styles.logo}
                resizeMode="contain"
              />
            </View>

            <Text style={styles.tagline}>JUEGA · COMPITE · MEJORA</Text>
          </View>

          {/* ═══ Floating card ═══ */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Inicia sesión</Text>
            <Text style={styles.cardTagline}>Tu próxima reta te espera</Text>
            <Text style={styles.cardSub}>
              Elige cómo quieres entrar. Vas a poder acceder desde cualquier
              dispositivo.
            </Text>

            {/* Primary CTA — Google */}
            <TouchableOpacity
              onPress={signInGoogle}
              disabled={loading}
              activeOpacity={0.88}
              style={[styles.googleBtn, loading && styles.btnDisabled]}
              testID="google-signin-btn"
            >
              <View style={styles.googleIconWrap}>
                <GoogleGIcon size={20} />
              </View>
              <Text style={styles.googleLabel}>Continuar con Google</Text>
            </TouchableOpacity>

            {/* Secondary CTA — Email */}
            <TouchableOpacity
              onPress={() => router.push("/login-email" as any)}
              disabled={loading}
              activeOpacity={0.85}
              style={[styles.emailBtn, loading && styles.btnDisabled]}
              testID="email-signin-btn"
            >
              <Mail size={18} color="#0F172A" strokeWidth={2} />
              <Text style={styles.emailLabel}>Continuar con Correo</Text>
            </TouchableOpacity>

            {/* Legal box */}
            <View style={styles.legalBox}>
              <Text style={styles.legalTxt}>
                Al crear una cuenta, aceptas nuestros{" "}
                <Text
                  style={styles.legalLink}
                  onPress={() => router.push("/legal/terms" as any)}
                >
                  Términos de Servicio
                </Text>{" "}
                y{" "}
                <Text
                  style={styles.legalLink}
                  onPress={() => router.push("/privacy" as any)}
                >
                  Política de Privacidad
                </Text>
                .
              </Text>
            </View>
          </View>

          {/* Organizer link (fuera de la card) */}
          <TouchableOpacity
            onPress={() => router.push("/admin/login" as any)}
            activeOpacity={0.7}
            style={styles.orgLink}
            testID="admin-login-link"
          >
            <Text style={styles.orgTxt}>¿Eres organizador? Ingresa acá</Text>
          </TouchableOpacity>
        </ScrollView>

        {/* Soft blue court gradient at bottom (behind content) */}
        <LinearGradient
          colors={[
            "rgba(219, 234, 254, 0)",   // transparent
            "rgba(191, 219, 254, 0.55)", // blue-200 soft
            "rgba(147, 197, 253, 0.75)", // blue-300 más fuerte al fondo
          ]}
          locations={[0, 0.55, 1]}
          style={styles.bottomBlueGradient}
          pointerEvents="none"
        />
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

// ═════════════════════════════════════════════════════════════════════════
// Styles
// ═════════════════════════════════════════════════════════════════════════
const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: "#F4F6F8", // off-white light
  },
  scroll: {
    padding: spacing.lg,
    paddingBottom: spacing.xl * 2,
    gap: spacing.md,
    minHeight: "100%",
  },

  // ═══ Hero (title + logo + tagline) ═══
  hero: {
    alignItems: "center",
    marginTop: spacing.md,
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  brandTitle: {
    fontSize: 22,
    fontWeight: "700",
    color: "#0F172A",
    letterSpacing: -0.3,
    textAlign: "center",
  },
  brandTitleAccent: {
    color: "#2563EB", // brand blue
    fontWeight: "700",
  },
  logoWrap: {
    width: 88,
    height: 88,
    borderRadius: 22,
    backgroundColor: "#FFFFFF",
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    padding: 6,
    marginTop: spacing.xs,
    ...Platform.select({
      ios: {
        shadowColor: "#0F172A",
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.10,
        shadowRadius: 12,
      },
      android: { elevation: 4 },
      web: { boxShadow: "0 4px 14px rgba(15,23,42,0.12)" } as any,
    }),
  },
  logo: {
    width: "100%",
    height: "100%",
  },
  tagline: {
    fontSize: 12,
    fontWeight: "700",
    color: "#2563EB",
    textAlign: "center",
    letterSpacing: 3,
    marginTop: spacing.xs,
  },

  // ═══ Floating Card ═══
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: "rgba(15,23,42,0.06)",
    gap: spacing.sm,
    marginTop: spacing.md,
    ...Platform.select({
      ios: {
        shadowColor: "#0F172A",
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.08,
        shadowRadius: 20,
      },
      android: { elevation: 4 },
      web: { boxShadow: "0 6px 24px rgba(15,23,42,0.08)" } as any,
    }),
  },
  cardTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: "#0F172A",
    letterSpacing: -0.2,
  },
  cardTagline: {
    fontSize: 13,
    fontWeight: "600",
    color: "#2563EB",
    letterSpacing: 0.2,
    marginTop: -spacing.xs,
  },
  cardSub: {
    fontSize: 13,
    fontWeight: "400",
    color: "#64748B",
    lineHeight: 19,
    marginBottom: spacing.sm,
  },

  // ── Google button (primary, solid white with border) ──
  googleBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    minHeight: 52,
    borderRadius: 14,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    paddingHorizontal: spacing.lg,
    ...Platform.select({
      ios: { boxShadow: "0px 2px 6px rgba(15,23,42,0.06)" },
      android: { elevation: 1 },
      web: { boxShadow: "0 2px 6px rgba(15,23,42,0.06)" } as any,
    }),
  },
  googleIconWrap: {
    width: 22,
    height: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  googleLabel: {
    fontSize: 15,
    fontWeight: "600",
    color: "#1F1F1F",
    letterSpacing: 0.15,
  },

  // ── Email button (secondary, subtle) ──
  emailBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    minHeight: 52,
    borderRadius: 14,
    backgroundColor: "#F8FAFC",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    paddingHorizontal: spacing.lg,
  },
  emailLabel: {
    fontSize: 15,
    fontWeight: "600",
    color: "#0F172A",
    letterSpacing: 0.15,
  },

  btnDisabled: {
    opacity: 0.55,
  },

  // ── Legal box (light gray container) ──
  legalBox: {
    backgroundColor: "#F1F5F9",
    borderRadius: 10,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  legalTxt: {
    fontSize: 11,
    color: "#64748B",
    lineHeight: 16,
    textAlign: "center",
  },
  legalLink: {
    color: "#2563EB",
    fontWeight: "600",
  },

  // ── Organizer link (outside card) ──
  orgLink: {
    marginTop: spacing.md,
    alignSelf: "center",
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  orgTxt: {
    fontSize: 12,
    color: "#64748B",
    textDecorationLine: "underline",
    letterSpacing: 0.2,
  },

  // ── Bottom blue court gradient ──
  bottomBlueGradient: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: "22%",
    zIndex: 0,
  },
});
