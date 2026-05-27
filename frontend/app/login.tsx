/** Login de jugador por OTP (WhatsApp). */
import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { ArrowLeft, Phone, ShieldCheck } from "lucide-react-native";

import { Button } from "@/src/components/Button";
import { Input } from "@/src/components/Input";
import { api } from "@/src/api";
import { colors, radii, spacing, typography } from "@/src/theme";

const PLAYER_TOKEN_KEY = "padelreta.player.token";
const PLAYER_INFO_KEY = "padelreta.player.info";

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
      await AsyncStorage.setItem(PLAYER_TOKEN_KEY, r.access_token);
      await AsyncStorage.setItem(PLAYER_INFO_KEY, JSON.stringify({ jugador_id: r.jugador_id, nombre: r.nombre, telefono: r.telefono }));
      router.replace("/mi-cuenta" as any);
    } catch (e: any) {
      Alert.alert("Código incorrecto", e.message ?? "Inténtalo de nuevo o solicita uno nuevo.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
        <View style={styles.topBar}>
          <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="login-back">
            <ArrowLeft size={18} color={colors.text.primary} />
          </TouchableOpacity>
          <Text style={styles.title}>Entrar a Pixel Padel</Text>
          <View style={{ width: 40 }} />
        </View>

        <ScrollView contentContainerStyle={styles.scroll}>
          {step === "request" ? (
            <>
              <View style={styles.heroIcon}><Phone size={28} color={colors.brand.primary} /></View>
              <Text style={styles.heroTitle}>Identifícate con tu teléfono</Text>
              <Text style={styles.heroSub}>
                Te enviaremos un código de 6 dígitos por WhatsApp para confirmar que eres tú.
              </Text>
              <Input label="Tu nombre" value={nombre} onChangeText={setNombre} placeholder="Carlos Padel" />
              <Input label="Teléfono" value={telefono} onChangeText={setTelefono} placeholder="+5215512345678" keyboardType="phone-pad" />
              <Button title="Enviarme código" onPress={requestOtp} loading={loading} testID="otp-request-btn" />
            </>
          ) : (
            <>
              <View style={styles.heroIcon}><ShieldCheck size={28} color={colors.brand.primary} /></View>
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
              <Button title="Verificar" onPress={verifyOtp} loading={loading} testID="otp-verify-btn" />
              <TouchableOpacity onPress={() => { setStep("request"); setCodigo(""); }} style={{ alignItems: "center", padding: spacing.md }}>
                <Text style={styles.linkAlt}>Cambiar teléfono / pedir otro código</Text>
              </TouchableOpacity>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg.app },
  topBar: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
  },
  iconBtn: {
    width: 40, height: 40, borderRadius: radii.md, backgroundColor: colors.bg.card,
    borderWidth: 1, borderColor: colors.border.default, alignItems: "center", justifyContent: "center",
  },
  title: { ...typography.h2, color: colors.text.primary, fontSize: 18 },
  scroll: { padding: spacing.lg, gap: spacing.md },
  heroIcon: {
    width: 56, height: 56, borderRadius: 28, alignSelf: "center",
    backgroundColor: colors.brand.primarySoft, alignItems: "center", justifyContent: "center",
    marginTop: spacing.md, marginBottom: spacing.md,
  },
  heroTitle: { ...typography.h1, color: colors.text.primary, fontSize: 22, textAlign: "center" },
  heroSub: { color: colors.text.secondary, textAlign: "center", marginBottom: spacing.lg, fontSize: 13 },
  linkAlt: { color: colors.brand.primary, fontSize: 12, textDecorationLine: "underline" },
});
