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
import { colors, radii, spacing, typography } from "@/src/theme";

export default function AdminLogin() {
  const router = useRouter();
  const [email, setEmail] = useState("admin@pixelpadel.com");
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
          <View style={styles.iconWrap}>
            <ShieldCheck size={28} color={colors.brand.primary} />
          </View>
          <Text style={styles.title}>ADMIN · CONTROL</Text>
          <Text style={styles.subtitle}>
            Acceso restringido a organizadores autorizados de Pixel Padel OS.
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
            Credenciales demo: admin@pixelpadel.com / admin123
          </Text>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg.app },
  container: { flex: 1, padding: spacing.lg, justifyContent: "center", gap: spacing.md },
  iconWrap: {
    width: 56, height: 56, borderRadius: radii.lg,
    borderWidth: 1, borderColor: colors.brand.primaryBorder,
    backgroundColor: colors.brand.primarySoft,
    alignItems: "center", justifyContent: "center",
    marginBottom: spacing.sm,
  },
  title: { ...typography.h1, color: colors.text.primary, fontSize: 28 },
  subtitle: { color: colors.text.secondary, lineHeight: 20, marginBottom: spacing.lg },
  form: { gap: 0 },
  hint: { color: colors.text.muted, fontSize: 12, marginTop: spacing.lg, textAlign: "center" },
});
