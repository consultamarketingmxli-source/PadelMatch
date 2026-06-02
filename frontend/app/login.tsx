/**
 * Login de jugador por OTP (WhatsApp) — Rediseño Director de Arte v3.
 *
 * Composición:
 *   • TOP (50%): formulario sobre fondo slate-50 limpio
 *       - BrandLockup (isotipo azul + wordmark elegante)
 *       - Inputs con border-blue-100 hairline
 *       - CTA blue-600 gradient
 *   • BOTTOM (50%): Imagen fotográfica de cancha de pádel azul
 *       (grip blanco, 3 pelotas amarillo flúor, red negra, césped azul vibrante)
 *     Difuminado superior con máscara `to top from-transparent via-slate-50/90 to-slate-50`.
 */
import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
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
import AsyncStorage from "@react-native-async-storage/async-storage";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { ArrowLeft, Phone, ShieldCheck } from "lucide-react-native";

import { Button } from "@/src/components/Button";
import { Input } from "@/src/components/Input";
import { BrandLogo } from "@/src/components/BrandLogo";
import { BrandWordmark } from "@/src/components/BrandWordmark";
import { api } from "@/src/api";
import { decideNextRoute, getLastRole } from "@/src/utils/roleSelection";
import { colors, radii, spacing, typography } from "@/src/theme";
import { playerTokenStore } from "@/src/utils/playerTokenStore";
import { LegalConsent } from "@/src/components/LegalConsent";
import { acceptLegal } from "@/src/utils/legalConsent";

const PLAYER_TOKEN_KEY = "padelappretas.player.token";
const PLAYER_INFO_KEY = "padelappretas.player.info";

// Fotografía cancha azul (vision_expert_agent — vibrant blue turf + grip + balls + net).
const COURT_IMG =
  "https://images.pexels.com/photos/31012869/pexels-photo-31012869.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=1200&w=800";

export default function PlayerLogin() {
  const router = useRouter();
  const [step, setStep] = useState<"request" | "verify">("request");
  const [nombre, setNombre] = useState("");
  const [telefono, setTelefono] = useState("");
  const [codigo, setCodigo] = useState("");
  const [loading, setLoading] = useState(false);
  const [hint, setHint] = useState<string | null>(null);

  const requestOtp = async () => {
    if (nombre.trim().length < 2) return Alert.alert("Datos", "Ingresa tu nombre.");
    if (telefono.trim().length < 8) return Alert.alert("Datos", "Ingresa un teléfono válido.");
    setLoading(true);
    try {
      const r = await api.playerRequestOtp({ nombre: nombre.trim(), telefono: telefono.trim() });
      setHint(r.mensaje);
      setStep("verify");
    } catch (e: any) {
      Alert.alert("Error", e.message ?? "No se pudo enviar el código");
    } finally {
      setLoading(false);
    }
  };

  const verifyOtp = async () => {
    if (codigo.trim().length < 4) return Alert.alert("Código", "Ingresa el código de 6 dígitos.");
    setLoading(true);
    try {
      const r = await api.playerVerifyOtp({ telefono: telefono.trim(), codigo: codigo.trim() });
      await playerTokenStore.set(r.access_token);
      await AsyncStorage.setItem(
        PLAYER_INFO_KEY,
        JSON.stringify({ jugador_id: r.jugador_id, nombre: r.nombre, telefono: r.telefono }),
      );
      // Registra consentimiento legal (implícito al crear cuenta / iniciar sesión)
      // — Location A del flujo de cumplimiento. Best-effort, no bloquea login.
      void acceptLegal(r.telefono);
      try {
        const roles = await api.playerMyRoles(r.access_token);
        const lastRole = await getLastRole();
        const next = decideNextRoute(roles, lastRole);
        router.replace(next as any);
      } catch {
        router.replace("/mi-cuenta" as any);
      }
    } catch (e: any) {
      Alert.alert("Código incorrecto", e.message ?? "Inténtalo de nuevo o solicita uno nuevo.");
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
        {/* TOP BAR */}
        <View style={styles.topBar}>
          <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="login-back">
            <ArrowLeft size={18} color={colors.text.primary} />
          </TouchableOpacity>
          <BrandWordmark size="md" />
          <View style={{ width: 40 }} />
        </View>

        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          {/* HERO IDENTIDAD */}
          <View style={styles.identityHero}>
            <BrandLogo size={64} variant="light" />
            <Text style={styles.heroSubBadge}>JUEGA · COMPITE · GANA</Text>
          </View>

          {/* FORM PANEL */}
          <View style={styles.formPanel}>
            {step === "request" ? (
              <>
                <View style={styles.formIconWrap}>
                  <Phone size={22} color={colors.brand.primary} />
                </View>
                <Text style={styles.heroTitle}>Identifícate con tu teléfono</Text>
                <Text style={styles.heroSub}>
                  Te enviaremos un código de 6 dígitos por WhatsApp para confirmar que eres tú.
                </Text>
                <Input label="Tu nombre" value={nombre} onChangeText={setNombre} placeholder="Carlos Padel" />
                <Input
                  label="Teléfono"
                  value={telefono}
                  onChangeText={setTelefono}
                  placeholder="+5215512345678"
                  keyboardType="phone-pad"
                />
                <Button
                  title="Enviarme código"
                  onPress={requestOtp}
                  loading={loading}
                  testID="otp-request-btn"
                  size="lg"
                />
              </>
            ) : (
              <>
                <View style={styles.formIconWrap}>
                  <ShieldCheck size={22} color={colors.brand.primary} />
                </View>
                <Text style={styles.heroTitle}>Ingresa el código</Text>
                <Text style={styles.heroSub}>
                  Enviado a {telefono}
                  {hint ? `\n\n${hint}` : ""}
                </Text>
                <Input
                  label="Código de 6 dígitos"
                  value={codigo}
                  onChangeText={(v) => setCodigo(v.replace(/[^0-9]/g, "").slice(0, 6))}
                  keyboardType="number-pad"
                  placeholder="123456"
                />
                <Button
                  title="Verificar"
                  onPress={verifyOtp}
                  loading={loading}
                  testID="otp-verify-btn"
                  size="lg"
                />
                <TouchableOpacity
                  onPress={() => {
                    setStep("request");
                    setCodigo("");
                  }}
                  style={{ alignItems: "center", padding: spacing.md }}
                >
                  <Text style={styles.linkAlt}>Cambiar teléfono / pedir otro código</Text>
                </TouchableOpacity>
              </>
            )}
            {/* Legal consent — Location A (Onboarding) */}
            <LegalConsent />
          </View>

          {/* FOTO INMERSIVA — cancha azul (pie del scroll) */}
          <View style={styles.courtImageWrap} pointerEvents="none">
            <Image
              source={{ uri: COURT_IMG }}
              style={styles.courtImage}
              resizeMode="cover"
            />
            {/* Máscara de degradado inverso: transparente abajo → slate-50 arriba.
                Fusiona la foto con el formulario sin cortes toscos. */}
            <LinearGradient
              colors={[
                colors.bg.app,                       // 100% slate-50 arriba (oculta borde superior)
                "rgba(248, 250, 252, 0.85)",         // slate-50/85 — transición fluida
                "rgba(248, 250, 252, 0.0)",          // transparente al fondo
              ]}
              locations={[0, 0.35, 1]}
              style={styles.courtGradient}
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg.app },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: radii.md,
    backgroundColor: colors.bg.card,
    borderWidth: 1,
    borderColor: colors.border.blueHairline,
    alignItems: "center",
    justifyContent: "center",
  },
  scroll: { padding: spacing.lg, gap: spacing.md, paddingBottom: 320 },
  identityHero: {
    alignItems: "center",
    marginTop: spacing.sm,
    marginBottom: spacing.lg,
    gap: 10,
  },
  heroSubBadge: {
    ...typography.label,
    color: colors.brand.primary,
    fontSize: 10,
    letterSpacing: 2.2,
  },
  formPanel: {
    backgroundColor: colors.bg.card,
    borderWidth: 1,
    borderColor: colors.border.blueHairline,
    borderRadius: radii.lg,
    padding: spacing.lg,
    gap: spacing.sm,
    // Premium shadow V2 (Director de Arte): "shadow-[0_12px_40px_-6px_rgba(30,41,59,0.04)]"
    ...Platform.select({
      ios: {
        shadowColor: "#1E293B",
        shadowOffset: { width: 0, height: 12 },
        shadowOpacity: 0.04,
        shadowRadius: 40,
      },
      android: { elevation: 2 },
      web: { boxShadow: "0 12px 40px -6px rgba(30,41,59,0.04)" } as any,
    }),
  },
  formIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignSelf: "center",
    backgroundColor: colors.brand.primarySoft,
    borderWidth: 1,
    borderColor: colors.brand.primaryBorder,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  heroTitle: {
    ...typography.h2,
    color: colors.text.primary,
    fontSize: 20,
    textAlign: "center",
  },
  heroSub: {
    color: colors.text.secondary,
    textAlign: "center",
    marginBottom: spacing.md,
    fontSize: 13,
    lineHeight: 19,
  },
  linkAlt: { color: colors.brand.primary, fontSize: 12, textDecorationLine: "underline" },

  // ── Foto cancha azul (pie de pantalla) ─────────────────────────
  courtImageWrap: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: 320,
    overflow: "hidden",
  },
  courtImage: {
    width: "100%",
    height: "100%",
  },
  courtGradient: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 180,
  },
});
