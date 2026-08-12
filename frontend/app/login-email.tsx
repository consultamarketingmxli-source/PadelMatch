/**
 * login-email.tsx — Login por Email Magic Link OTP (Iter57 · Fase 2).
 *
 * Flujo:
 *   1. Usuario ingresa email + nombre opcional → tapea "Enviar código".
 *   2. Backend genera código de 6 dígitos, lo guarda hasheado y lo envía
 *      por Resend a `email`.
 *   3. Usuario ingresa código → backend verifica → devuelve JWT + user.
 *   4. Persistimos JWT igual que Google/OTP, redirigimos al home/onboarding.
 *
 * Reutiliza los mismos stores (`playerTokenStore`, `PLAYER_INFO_KEY`) y la
 * misma lógica de routing por rol que login.tsx — cero drift.
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
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { ArrowLeft, Mail } from "lucide-react-native";

import { Button } from "@/src/components/Button";
import { Input } from "@/src/components/Input";
import { Toast } from "@/src/components/Toast";
import { api, setRefreshToken } from "@/src/api";
import { playerTokenStore } from "@/src/utils/playerTokenStore";
import { deepLinkStore } from "@/src/utils/deepLinkStore";
import { decideNextRoute, getLastRole } from "@/src/utils/roleSelection";
import { acceptLegal } from "@/src/utils/legalConsent";
import { parseApiErrorMessage } from "@/src/utils/phoneFormat";
import { colors, radii, spacing, typography } from "@/src/theme";

const PLAYER_INFO_KEY = "padelappretas.player.info";

export default function LoginEmail() {
  const router = useRouter();
  const [step, setStep] = useState<"request" | "verify">("request");
  const [email, setEmail] = useState("");
  const [nombre, setNombre] = useState("");
  const [codigo, setCodigo] = useState("");
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<{
    visible: boolean;
    message: string;
    tone: "info" | "warn" | "error";
  }>({ visible: false, message: "", tone: "info" });

  const showToast = (message: string, tone: "info" | "warn" | "error" = "info") =>
    setToast({ visible: true, message, tone });

  const requestOtp = async () => {
    const trimmed = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(trimmed)) {
      showToast("Ingresá un email válido.", "warn");
      return;
    }
    setLoading(true);
    try {
      const r = await api.emergentEmailRequest({
        email: trimmed,
        nombre: nombre.trim() || undefined,
      });
      setEmail(trimmed);
      setStep("verify");
      showToast(
        r.throttled
          ? "Ya se envió un código recientemente. Revisá tu bandeja."
          : `Código enviado. Revisá tu correo. Vence en ${r.expires_in_minutes ?? 10} min.`,
        "info",
      );
    } catch (e: unknown) {
      const parsed = parseApiErrorMessage(
        e,
        "No pudimos enviar el código. Intentá de nuevo.",
      );
      showToast(parsed.message, "error");
    } finally {
      setLoading(false);
    }
  };

  const verifyOtp = async () => {
    const c = codigo.trim();
    if (c.length < 4) {
      showToast("Ingresá el código de 6 dígitos.", "warn");
      return;
    }
    setLoading(true);
    try {
      const r = await api.emergentEmailVerify({ email, codigo: c });
      // Persistencia idéntica a Google Auth / OTP legacy.
      await playerTokenStore.set(r.access_token);
      if (r.refresh_token) await setRefreshToken(r.refresh_token);
      await AsyncStorage.setItem(
        PLAYER_INFO_KEY,
        JSON.stringify({
          jugador_id: r.user.user_id,
          nombre: r.user.nombre,
          telefono: r.user.telefono ?? "",
          email: r.user.email,
        }),
      );
      void acceptLegal(r.user.email ?? r.user.user_id);

      // Onboarding si el perfil está incompleto.
      if (!r.user.profile_completed) {
        router.replace("/onboarding" as any);
        return;
      }
      try {
        const roles = await api.playerMyRoles(r.access_token);
        const lastRole = await getLastRole();
        const next = decideNextRoute(roles, lastRole);
        try {
          const pending = await deepLinkStore.consume();
          if (pending) {
            router.replace(pending as any);
            return;
          }
        } catch {
          /* no-op */
        }
        router.replace(next as any);
      } catch {
        router.replace("/mi-cuenta" as any);
      }
    } catch (e: unknown) {
      const parsed = parseApiErrorMessage(
        e,
        "Código incorrecto o expirado.",
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
          <TouchableOpacity
            onPress={() => (step === "verify" ? setStep("request") : router.back())}
            style={styles.backBtn}
            activeOpacity={0.7}
            testID="back-btn"
          >
            <ArrowLeft size={22} color={colors.text.primary} />
            <Text style={styles.backTxt}>Volver</Text>
          </TouchableOpacity>

          <View style={styles.card}>
            <View style={styles.iconWrap}>
              <Mail size={26} color={colors.brand.primary} />
            </View>

            {step === "request" ? (
              <>
                <Text style={styles.heroTitle}>Ingresá con tu correo</Text>
                <Text style={styles.heroSub}>
                  Te enviaremos un código de 6 dígitos para verificar.
                </Text>

                <Input
                  label="Tu email"
                  value={email}
                  onChangeText={setEmail}
                  placeholder="tucorreo@gmail.com"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  testID="email-input"
                />
                <Input
                  label="Tu nombre (opcional)"
                  value={nombre}
                  onChangeText={setNombre}
                  placeholder="Carlos Padel"
                  maxLength={80}
                  testID="nombre-input"
                />
                <Button
                  title="Enviar código"
                  onPress={requestOtp}
                  loading={loading}
                  size="lg"
                  testID="email-request-btn"
                />
              </>
            ) : (
              <>
                <Text style={styles.heroTitle}>Ingresá el código</Text>
                <Text style={styles.heroSub}>
                  Enviado a {email}. Revisá tu bandeja y spam.
                </Text>
                <Input
                  label="Código de 6 dígitos"
                  value={codigo}
                  onChangeText={(v) => setCodigo(v.replace(/\D/g, "").slice(0, 8))}
                  placeholder="123456"
                  keyboardType="number-pad"
                  maxLength={8}
                  testID="codigo-input"
                />
                <Button
                  title="Verificar y entrar"
                  onPress={verifyOtp}
                  loading={loading}
                  size="lg"
                  testID="email-verify-btn"
                />
                <TouchableOpacity
                  onPress={() => setStep("request")}
                  activeOpacity={0.7}
                  style={styles.resendLink}
                >
                  <Text style={styles.resendTxt}>Pedir otro código</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </ScrollView>
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
  scroll: { padding: spacing.lg, gap: spacing.md, paddingBottom: 120 },
  backBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    marginTop: spacing.xs,
    minHeight: 44,
    alignSelf: "flex-start",
  },
  backTxt: { color: colors.text.primary, fontSize: 15, fontWeight: "500" },
  card: {
    backgroundColor: colors.bg.card,
    borderWidth: 1,
    borderColor: colors.border.blueHairline,
    borderRadius: radii.lg,
    padding: spacing.lg,
    gap: spacing.md,
    marginTop: spacing.md,
  },
  iconWrap: {
    alignSelf: "center",
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.brand.primarySoft,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.xs,
  },
  heroTitle: {
    ...typography.h1,
    color: colors.text.primary,
    fontSize: 22,
    textAlign: "center",
  },
  heroSub: {
    color: colors.text.secondary,
    fontSize: 13,
    lineHeight: 19,
    textAlign: "center",
    marginBottom: spacing.sm,
  },
  resendLink: {
    alignSelf: "center",
    padding: spacing.sm,
    minHeight: 44,
  },
  resendTxt: {
    color: colors.brand.primary,
    fontSize: 13,
    textDecorationLine: "underline",
  },
});
