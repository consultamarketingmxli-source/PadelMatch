/** Login admin. */
import React, { useEffect, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { ShieldCheck } from "lucide-react-native";

import { api } from "@/src/api";
import { Button } from "@/src/components/Button";
import { Input } from "@/src/components/Input";
import { BrandLogo } from "@/src/components/BrandLogo";
import { BrandWordmark } from "@/src/components/BrandWordmark";
import { colors, radii, spacing, typography } from "@/src/theme";

export default function AdminLogin() {
  const router = useRouter();
  const [email, setEmail] = useState("admin@padelappretas.com");
  const [password, setPassword] = useState("admin123");
  const [loading, setLoading] = useState(false);

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
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1 }}
      >
        <View style={styles.container}>
          <View style={styles.brandWrap}>
            <BrandLogo size={72} />
            <View style={{ height: spacing.md }} />
            <BrandWordmark size="lg" />
            <Text style={styles.adminTag}>· Panel admin</Text>
          </View>
          <Text style={styles.subtitle}>
            Acceso para organizadores de clubes de pádel.
          </Text>

          <View style={styles.form}>
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
          </View>

          <Text style={styles.hint}>
            Credenciales demo: admin@padelappretas.com / admin123
          </Text>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg.app },
  container: { flex: 1, padding: spacing.lg, justifyContent: "center", gap: spacing.md },
  brandWrap: {
    alignItems: "center",
    marginBottom: spacing.base,
  },
  adminTag: {
    ...typography.label,
    color: colors.text.secondary,
    marginTop: spacing.xs,
  },
  subtitle: { ...typography.bodyRelaxed, color: colors.text.secondary, textAlign: "center", marginBottom: spacing.lg },
  form: { gap: 0 },
  hint: { ...typography.caption, color: colors.text.muted, marginTop: spacing.lg, textAlign: "center" },
});
