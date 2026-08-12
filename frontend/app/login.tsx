/**
 * login.tsx — Player Login (Iter66 · White top + court fade bottom).
 *
 * Estructura por capas absolute-positioning:
 *   Layer 0: Root container white.
 *   Layer 1: Court image absolute bottom 35%.
 *   Layer 2: LinearGradient white→transparent sobre el top edge del court.
 *   Layer 3: Content (hero + card + orgLink) en flujo normal.
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
    <View style={styles.root}>
      {/* ═══ Layer 1: Court image absolute bottom 35% ═══ */}
      <Image
        source={COURT_BG}
        resizeMode="cover"
        style={styles.courtBg}
      />

      {/* ═══ Layer 2: Fade white → transparent sobre el top del court ═══ */}
      <LinearGradient
        colors={["#FFFFFF", "rgba(255,255,255,0)"]}
        locations={[0, 1]}
        style={styles.courtFade}
        pointerEvents="none"
      />

      {/* ═══ Layer 3: Content ═══ */}
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
            {/* Hero — top white area */}
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

              <Text style={styles.tagline}>ORGANIZA · JUEGA · MEJORA</Text>
            </View>

            {/* Floating card — overlays la zona de transición */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Inicia sesión</Text>
              <Text style={styles.cardTagline}>Tu próxima reta te espera</Text>
              <Text style={styles.cardSub}>
                Elige cómo quieres entrar. Vas a poder acceder desde cualquier
                dispositivo.
              </Text>

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
                <Mail size={18} color="#0F172A" strokeWidth={2} />
                <Text style={styles.emailLabel}>Continuar con Correo</Text>
              </TouchableOpacity>

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

            <TouchableOpacity
              onPress={() => router.push("/admin/login" as any)}
              activeOpacity={0.7}
              style={styles.orgLink}
              testID="admin-login-link"
            >
              <Text style={styles.orgTxt}>¿Eres organizador? Ingresa acá</Text>
            </TouchableOpacity>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>

      <Toast
        visible={toast.visible}
        message={toast.message}
        tone={toast.tone}
        onHide={() => setToast((t) => ({ ...t, visible: false }))}
      />
    </View>
  );
}

// ═════════════════════════════════════════════════════════════════════════
const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#FFFFFF", // root white
  },

  // ═══ Layer 1: Court image bottom 35% ═══
  courtBg: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: "35%",
    width: "100%",
  },

  // ═══ Layer 2: Fade white → transparent (top edge del court) ═══
  courtFade: {
    position: "absolute",
    bottom: "20%", // start del fade a 20% del bottom (encima del court 35%)
    left: 0,
    right: 0,
    height: "22%", // extiende el fade sobre el edge del court
  },

  // ═══ Layer 3: Content ═══
  safe: { flex: 1, zIndex: 2 },
  scroll: {
    flexGrow: 1,
    padding: spacing.lg,
    paddingBottom: spacing.xl * 2,
    gap: spacing.md,
    minHeight: "100%",
  },

  // Hero (top white area)
  hero: {
    alignItems: "center",
    marginTop: spacing.md,
    marginBottom: spacing.sm,
    gap: spacing.sm,
  },
  brandTitle: {
    fontSize: 22,
    fontWeight: "700",
    color: "#0D253C",
    letterSpacing: -0.3,
    textAlign: "center",
  },
  brandTitleAccent: {
    color: "#1E6091",
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
        shadowColor: "#0D253C",
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.10,
        shadowRadius: 12,
      },
      android: { elevation: 3 },
      web: { boxShadow: "0 4px 14px rgba(13,37,60,0.12)" } as any,
    }),
  },
  logo: { width: "100%", height: "100%" },
  tagline: {
    fontSize: 12,
    fontWeight: "600",
    color: "#1E6091",
    textAlign: "center",
    letterSpacing: 1.5,
    marginTop: spacing.sm,
  },

  // Floating card (overlays la transición)
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: "rgba(13,37,60,0.06)",
    gap: spacing.sm,
    marginTop: spacing.md,
    ...Platform.select({
      ios: {
        shadowColor: "#0D253C",
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.10,
        shadowRadius: 20,
      },
      android: { elevation: 5 },
      web: { boxShadow: "0 8px 24px rgba(13,37,60,0.10)" } as any,
    }),
  },
  cardTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: "#0D253C",
    letterSpacing: -0.2,
  },
  cardTagline: {
    fontSize: 13,
    fontWeight: "600",
    color: "#1E6091",
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
      ios: { boxShadow: "0px 2px 6px rgba(13,37,60,0.06)" },
      android: { elevation: 1 },
      web: { boxShadow: "0 2px 6px rgba(13,37,60,0.06)" } as any,
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

  btnDisabled: { opacity: 0.55 },

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
    color: "#1E6091",
    fontWeight: "600",
  },

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
    color: "#FFFFFF",
    textDecorationLine: "underline",
    letterSpacing: 0.2,
    ...Platform.select({
      ios: { textShadow: "0px 1px 3px rgba(0,0,0,0.5)" },
      web: { textShadow: "0 1px 3px rgba(0,0,0,0.5)" } as any,
    }),
  },
});
