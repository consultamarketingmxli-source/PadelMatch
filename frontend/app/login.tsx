/**
 * login.tsx — Player Login (Iter60 · Redesign inmersivo full-screen).
 *
 * Post-Fase-3: sólo Google Sign-In + Email Magic Link (auth costo $0).
 *
 * ═══════════════ Diseño (aprobado por Lead Architect) ═══════════════
 *
 *  ┌──────────────────────────────────────────┐
 *  │  ██ court background (blur + darken)  ██ │  ← hero visual
 *  │                                          │
 *  │              [ LOGO 88pt ]               │
 *  │      Pádel. Conecta. Juega.              │  ← headline
 *  │  La comunidad de pádel más grande de Mx  │  ← subtitle
 *  │                                          │
 *  │  ────── gradient overlay dark ──────     │  ← contrast band
 *  │                                          │
 *  │   Tu próxima reta te espera              │  ← section header
 *  │                                          │
 *  │   ┌─ [G] Continuar con Google ─┐         │  ← primary CTA
 *  │   │      (solid white)         │         │
 *  │   └────────────────────────────┘         │
 *  │   ┌─ ✉  Continuar con Correo  ─┐         │  ← secondary CTA
 *  │   │      (ghost outline)       │         │
 *  │   └────────────────────────────┘         │
 *  │                                          │
 *  │   Al crear una cuenta, aceptas nuestros  │  ← legal (compact 1-line)
 *  │   Términos y Privacidad                  │
 *  │                                          │
 *  │   ¿Eres organizador? Ingresa acá         │  ← subtle organizer link
 *  └──────────────────────────────────────────┘
 *
 * Constraints:
 *   • Backend endpoints intactos (Iter59 audit verde).
 *   • Radios 12-16px (moderno, no aggresive).
 *   • Touch targets ≥48pt.
 *   • Zero-cost integrations (Google Emergent + Resend).
 */
import React, { useState } from "react";
import {
  Dimensions,
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

const { height: SCREEN_HEIGHT } = Dimensions.get("window");

// Asset background — court real photo. Ya existe en assets/brand/court-hero.jpg
// (kept < 200KB para no impactar bundle). Si el asset falla, el gradient de
// fallback (colores brand) mantiene la composición.
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
      {/* ═════════════ Hero background (immersive) ═════════════ */}
      <ImageBackground
        source={COURT_BG}
        resizeMode="cover"
        style={styles.hero}
        imageStyle={styles.heroImg}
      >
        {/* Darken layer para contraste tipográfico */}
        <View style={styles.heroDim} pointerEvents="none" />

        {/* Gradient bottom → app bg color para transición suave */}
        <LinearGradient
          colors={[
            "rgba(15,23,42,0.0)",
            "rgba(15,23,42,0.35)",
            "rgba(15,23,42,0.85)",
            "rgba(15,23,42,1.0)",
          ]}
          locations={[0, 0.4, 0.75, 1]}
          style={styles.heroGradient}
          pointerEvents="none"
        />

        <SafeAreaView style={styles.heroContent} edges={["top"]}>
          <View style={styles.brandBlock}>
            <View style={styles.logoWrap}>
              <Image
                source={BRAND_ICON}
                style={styles.logo}
                resizeMode="contain"
              />
            </View>
            <Text style={styles.headline}>Pádel. Conecta. Juega.</Text>
            <Text style={styles.subtitle}>
              La comunidad de pádel más grande de México
            </Text>
          </View>
        </SafeAreaView>
      </ImageBackground>

      {/* ═════════════ Auth sheet (dark surface) ═════════════ */}
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.authSheet}
      >
        <ScrollView
          contentContainerStyle={styles.authInner}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.sectionHeader}>Tu próxima reta te espera</Text>

          {/* ── Primary CTA — Google (solid white, dominant) ── */}
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

          {/* ── Secondary CTA — Email (ghost outline) ── */}
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

          {/* ── Legal (compact 1-line) ── */}
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

          {/* ── Organizer link (subtle) ── */}
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
// Styles
// ═════════════════════════════════════════════════════════════════════════
const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#0F172A", // slate-900 fallback si el asset falla
  },

  // ═══ Hero ═══
  hero: {
    height: Math.max(SCREEN_HEIGHT * 0.48, 360),
    justifyContent: "flex-end",
    width: "100%",
  },
  heroImg: {
    // Ligero blur / brightness reduction (via CSS filter en web; sin efecto
    // real en nativo pero mantiene la fuente crisp).
    opacity: 0.85,
  },
  heroDim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(15,23,42,0.35)",
  },
  heroGradient: {
    ...StyleSheet.absoluteFillObject,
  },
  heroContent: {
    flex: 1,
    justifyContent: "flex-end",
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
    zIndex: 2,
  },
  brandBlock: {
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  logoWrap: {
    width: 88,
    height: 88,
    borderRadius: 22,
    overflow: "hidden",
    ...Platform.select({
      ios: {
        boxShadow: "0px 8px 24px rgba(0,0,0,0.35)",
      },
      android: { elevation: 8 },
      web: { boxShadow: "0 8px 24px rgba(0,0,0,0.35)" } as any,
    }),
    marginBottom: spacing.sm,
  },
  logo: {
    width: "100%",
    height: "100%",
  },
  headline: {
    fontSize: 30,
    fontWeight: "800",
    color: "#FFFFFF",
    textAlign: "center",
    letterSpacing: -0.5,
    lineHeight: 36,
    ...Platform.select({
      ios: { textShadow: "0px 2px 8px rgba(0,0,0,0.4)" },
      web: { textShadow: "0 2px 8px rgba(0,0,0,0.4)" } as any,
    }),
  },
  subtitle: {
    fontSize: 14,
    color: "rgba(255,255,255,0.88)",
    textAlign: "center",
    lineHeight: 20,
    maxWidth: 320,
    ...Platform.select({
      ios: { textShadow: "0px 1px 4px rgba(0,0,0,0.4)" },
      web: { textShadow: "0 1px 4px rgba(0,0,0,0.4)" } as any,
    }),
  },

  // ═══ Auth sheet ═══
  authSheet: {
    flex: 1,
    backgroundColor: "#0F172A",
    marginTop: -1, // evita hairline gap con el gradient
  },
  authInner: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl * 1.5,
    gap: spacing.sm,
  },
  sectionHeader: {
    fontSize: 15,
    fontWeight: "600",
    color: "rgba(255,255,255,0.72)",
    textAlign: "center",
    letterSpacing: 0.3,
    marginBottom: spacing.sm,
  },

  // ── Google button (primary, solid white) ──
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
      ios: { boxShadow: "0px 4px 16px rgba(0,0,0,0.18)" },
      android: { elevation: 3 },
      web: { boxShadow: "0 4px 16px rgba(0,0,0,0.18)" } as any,
    }),
  },
  googleIconWrap: {
    width: 24,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
    // Padding interno mínimo 1/6 del tamaño según Google Brand Guidelines.
  },
  googleLabel: {
    fontSize: 16,
    fontWeight: "600",
    color: "#1F1F1F",
    letterSpacing: 0.15,
  },

  // ── Email button (secondary, ghost outline) ──
  emailBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    minHeight: 54,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.22)",
    backgroundColor: "rgba(255,255,255,0.04)",
    paddingHorizontal: spacing.lg,
  },
  emailLabel: {
    fontSize: 16,
    fontWeight: "600",
    color: "#F1F5F9",
    letterSpacing: 0.15,
  },

  btnDisabled: {
    opacity: 0.55,
  },

  // ── Legal (compact) ──
  legalTxt: {
    fontSize: 11,
    color: "rgba(255,255,255,0.5)",
    textAlign: "center",
    lineHeight: 16,
    marginTop: spacing.md,
    paddingHorizontal: spacing.md,
  },
  legalLink: {
    color: "rgba(255,255,255,0.78)",
    textDecorationLine: "underline",
  },

  // ── Organizer link ──
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
    color: "rgba(255,255,255,0.55)",
    textDecorationLine: "underline",
    letterSpacing: 0.2,
  },
});
