/**
 * login.tsx — Player Login (Iter65 · Dark immersive full-screen).
 *
 * Post-Fase-3: sólo Google Sign-In + Email Magic Link (auth costo $0).
 *
 * Composición:
 *   - Fondo full-screen: foto de cancha (ImageBackground flex:1).
 *   - Dark gradient overlay: transparent top → dark surface bottom.
 *   - Hero flotante: logo en círculo/squircle SIN caja blanca (transparent
 *     bg + drop shadow), headline light thin blanco, subtitle gris.
 *   - Auth sheet semi-transparente al fondo con Google + Email buttons.
 */
import React, { useState } from "react";
import {
  Image,
  ImageBackground,
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

const COURT_BG = require("../assets/brand/court-hero.jpg");
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
    <ImageBackground
      source={COURT_BG}
      resizeMode="cover"
      style={styles.bg}
      imageStyle={styles.bgImg}
    >
      {/* Dark gradient overlay: transparent top → dark bottom (contraste) */}
      <LinearGradient
        colors={[
          "rgba(0,0,0,0.25)",
          "rgba(15,23,42,0.55)",
          "rgba(15,23,42,0.92)",
        ]}
        locations={[0, 0.5, 1]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />

      <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={{ flex: 1 }}
        >
          <ScrollView
            contentContainerStyle={styles.scroll}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* ═══ Hero: logo flotante + headline + subtitle ═══ */}
            <View style={styles.hero}>
              <View style={styles.logoWrap}>
                <Image
                  source={BRAND_ICON}
                  style={styles.logo}
                  resizeMode="contain"
                />
              </View>

              <Text style={styles.headline}>Organiza · Juega · Mejora</Text>
              <Text style={styles.subtitle}>
                La comunidad de pádel más grande de México
              </Text>
            </View>

            {/* ═══ Auth sheet (semi-transparent dark) ═══ */}
            <View style={styles.authSheet}>
              <Text style={styles.sheetTitle}>Tu próxima reta te espera</Text>

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

              <TouchableOpacity
                onPress={() => router.push("/login-email" as any)}
                disabled={loading}
                activeOpacity={0.85}
                style={[styles.emailBtn, loading && styles.btnDisabled]}
                testID="email-signin-btn"
              >
                <Mail size={18} color="#F1F5F9" strokeWidth={2} />
                <Text style={styles.emailLabel}>Continuar con Correo</Text>
              </TouchableOpacity>

              <Text style={styles.legalTxt}>
                Al crear una cuenta, aceptas nuestros{" "}
                <Text
                  style={styles.legalLink}
                  onPress={() => router.push("/legal/terms" as any)}
                >
                  Términos
                </Text>{" "}
                y{" "}
                <Text
                  style={styles.legalLink}
                  onPress={() => router.push("/privacy" as any)}
                >
                  Privacidad
                </Text>
              </Text>

              <TouchableOpacity
                onPress={() => router.push("/admin/login" as any)}
                activeOpacity={0.7}
                style={styles.orgLink}
                testID="admin-login-link"
              >
                <Text style={styles.orgTxt}>
                  ¿Eres organizador? Ingresa acá
                </Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>

      <Toast
        visible={toast.visible}
        message={toast.message}
        tone={toast.tone}
        onHide={() => setToast((t) => ({ ...t, visible: false }))}
      />
    </ImageBackground>
  );
}

// ═════════════════════════════════════════════════════════════════════════
const styles = StyleSheet.create({
  bg: { flex: 1, backgroundColor: "#0F172A" },
  bgImg: { opacity: 0.85 },
  safe: { flex: 1 },
  scroll: {
    flexGrow: 1,
    padding: spacing.lg,
    paddingBottom: spacing.xl,
    justifyContent: "space-between",
    minHeight: "100%",
  },

  // ═══ Hero (top) ═══
  hero: {
    alignItems: "center",
    marginTop: spacing.xl,
    gap: spacing.sm,
  },
  logoWrap: {
    width: 80,
    height: 80,
    borderRadius: 20, // squircle
    overflow: "hidden",
    backgroundColor: "transparent", // sin caja
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.md,
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.4,
        shadowRadius: 12,
      },
      android: { elevation: 8 },
      web: {
        boxShadow: "0 6px 16px rgba(0,0,0,0.4)",
      } as any,
    }),
  },
  logo: { width: "100%", height: "100%" },
  headline: {
    color: "#FFFFFF",
    fontSize: 22,
    fontWeight: "300",
    letterSpacing: 1,
    textAlign: "center",
    fontFamily: Platform.select({
      ios: "System",
      android: "sans-serif-light",
      default: "System",
    }),
    ...Platform.select({
      ios: { textShadow: "0px 1px 8px rgba(0,0,0,0.6)" },
      web: { textShadow: "0 1px 8px rgba(0,0,0,0.6)" } as any,
    }),
  },
  subtitle: {
    color: "#A0AEC0",
    fontSize: 13,
    lineHeight: 19,
    textAlign: "center",
    maxWidth: 320,
    letterSpacing: 0.2,
    marginTop: 4,
    ...Platform.select({
      ios: { textShadow: "0px 1px 4px rgba(0,0,0,0.5)" },
      web: { textShadow: "0 1px 4px rgba(0,0,0,0.5)" } as any,
    }),
  },

  // ═══ Auth sheet (bottom, semi-transparent dark) ═══
  authSheet: {
    backgroundColor: "rgba(15,23,42,0.55)",
    borderRadius: 20,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  sheetTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: "rgba(255,255,255,0.85)",
    textAlign: "center",
    letterSpacing: 0.3,
    marginBottom: spacing.sm,
  },

  googleBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    minHeight: 54,
    borderRadius: 14,
    backgroundColor: "#FFFFFF",
    paddingHorizontal: spacing.lg,
    ...Platform.select({
      ios: { boxShadow: "0px 4px 16px rgba(0,0,0,0.25)" },
      android: { elevation: 3 },
      web: { boxShadow: "0 4px 16px rgba(0,0,0,0.25)" } as any,
    }),
  },
  googleIconWrap: {
    width: 24,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  googleLabel: {
    fontSize: 16,
    fontWeight: "600",
    color: "#1F1F1F",
    letterSpacing: 0.15,
  },

  emailBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    minHeight: 54,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.25)",
    backgroundColor: "rgba(255,255,255,0.06)",
    paddingHorizontal: spacing.lg,
  },
  emailLabel: {
    fontSize: 16,
    fontWeight: "600",
    color: "#F1F5F9",
    letterSpacing: 0.15,
  },

  btnDisabled: { opacity: 0.55 },

  legalTxt: {
    fontSize: 11,
    color: "rgba(255,255,255,0.55)",
    textAlign: "center",
    lineHeight: 16,
    marginTop: spacing.md,
  },
  legalLink: {
    color: "rgba(255,255,255,0.85)",
    textDecorationLine: "underline",
  },

  orgLink: {
    marginTop: spacing.sm,
    alignSelf: "center",
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  orgTxt: {
    fontSize: 12,
    color: "rgba(255,255,255,0.6)",
    textDecorationLine: "underline",
    letterSpacing: 0.2,
  },
});
