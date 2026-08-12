/**
 * onboarding.tsx — Setup obligatorio post-primer-login (Iter56).
 *
 * Se muestra cuando el usuario acaba de autenticarse con Google/Email pero
 * su perfil todavía NO tiene `preferred_side` ni `skill_level`. Estos campos
 * son requeridos para que el matchmaking (asignación a canchas) funcione bien.
 *
 * UX:
 *   • 2 pasos con visual muy simple (chips seleccionables).
 *   • No permite volver atrás sin completar (guard en el layout raíz).
 *   • Al finalizar, POST /api/auth/profile-setup y router.replace() al home.
 */
import React, { useState } from "react";
import {
  Alert,
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

import { Button } from "@/src/components/Button";
import { Input } from "@/src/components/Input";
import { Toast } from "@/src/components/Toast";
import { api } from "@/src/api";
import { playerTokenStore } from "@/src/utils/playerTokenStore";
import { decideNextRoute, getLastRole } from "@/src/utils/roleSelection";
import { colors, radii, spacing, typography } from "@/src/theme";

type Side = "Drive" | "Revés" | "Ambos";
type Level = "Principiante" | "Intermedio" | "Avanzado" | "Pro";

const SIDES: { value: Side; label: string; hint: string }[] = [
  { value: "Drive", label: "Drive", hint: "Prefiero jugar del lado natural" },
  { value: "Revés", label: "Revés", hint: "Prefiero el revés" },
  { value: "Ambos", label: "Ambos", hint: "Me acomodo a cualquier lado" },
];

const LEVELS: { value: Level; label: string; hint: string }[] = [
  { value: "Principiante", label: "Principiante", hint: "Estoy empezando" },
  { value: "Intermedio", label: "Intermedio", hint: "Ya tengo cancha regular" },
  { value: "Avanzado", label: "Avanzado", hint: "Compito localmente" },
  { value: "Pro", label: "Pro", hint: "Torneos federados / ranking" },
];

export default function Onboarding() {
  const router = useRouter();
  const [nombre, setNombre] = useState("");
  const [side, setSide] = useState<Side | null>(null);
  const [level, setLevel] = useState<Level | null>(null);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<{
    visible: boolean;
    message: string;
    tone: "info" | "warn" | "error";
  }>({ visible: false, message: "", tone: "info" });

  const showToast = (message: string, tone: "info" | "warn" | "error" = "info") =>
    setToast({ visible: true, message, tone });

  const complete = async () => {
    if (!side) return showToast("Elegí tu lado preferido.", "warn");
    if (!level) return showToast("Elegí tu nivel de juego.", "warn");
    const token = await playerTokenStore.get();
    if (!token) {
      showToast("Sesión expirada. Volvé a iniciar sesión.", "error");
      router.replace("/login" as any);
      return;
    }
    setLoading(true);
    try {
      await api.emergentProfileSetup(token, {
        nombre: nombre.trim() || undefined,
        preferred_side: side,
        skill_level: level,
      });
      try {
        const roles = await api.playerMyRoles(token);
        const lastRole = await getLastRole();
        const next = decideNextRoute(roles, lastRole);
        router.replace(next as any);
      } catch {
        router.replace("/mi-cuenta" as any);
      }
    } catch (e: unknown) {
      Alert.alert(
        "Error",
        (e as { message?: string })?.message ?? "No pudimos guardar tu perfil.",
      );
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
          <View style={styles.hero}>
            <Text style={styles.heroBadge}>ÚLTIMO PASO</Text>
            <Text style={styles.heroTitle}>Contanos cómo jugás</Text>
            <Text style={styles.heroSub}>
              Usamos esto para armar retas más equilibradas.
            </Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.label}>Cómo querés que te vean (opcional)</Text>
            <Input
              value={nombre}
              onChangeText={setNombre}
              placeholder="Tu nombre visible"
              maxLength={80}
              testID="onboarding-nombre"
            />

            <Text style={[styles.label, { marginTop: spacing.md }]}>
              Lado preferido
            </Text>
            <View style={styles.chipRow}>
              {SIDES.map((s) => (
                <TouchableOpacity
                  key={s.value}
                  onPress={() => setSide(s.value)}
                  style={[styles.chip, side === s.value && styles.chipActive]}
                  activeOpacity={0.85}
                  testID={`side-${s.value}`}
                >
                  <Text
                    style={[
                      styles.chipLabel,
                      side === s.value && styles.chipLabelActive,
                    ]}
                  >
                    {s.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={[styles.label, { marginTop: spacing.md }]}>
              Nivel de juego
            </Text>
            <View style={styles.chipCol}>
              {LEVELS.map((l) => (
                <TouchableOpacity
                  key={l.value}
                  onPress={() => setLevel(l.value)}
                  style={[
                    styles.chipLevel,
                    level === l.value && styles.chipLevelActive,
                  ]}
                  activeOpacity={0.85}
                  testID={`level-${l.value}`}
                >
                  <View style={{ flex: 1 }}>
                    <Text
                      style={[
                        styles.chipLabel,
                        level === l.value && styles.chipLabelActive,
                      ]}
                    >
                      {l.label}
                    </Text>
                    <Text style={styles.chipHint}>{l.hint}</Text>
                  </View>
                  {level === l.value ? (
                    <Text style={styles.check}>✓</Text>
                  ) : null}
                </TouchableOpacity>
              ))}
            </View>

            <Button
              title="Guardar y continuar"
              onPress={complete}
              loading={loading}
              size="lg"
              testID="onboarding-save-btn"
            />
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
  hero: { marginTop: spacing.lg, marginBottom: spacing.md, gap: 6 },
  heroBadge: {
    ...typography.label,
    color: colors.brand.primary,
    fontSize: 11,
    letterSpacing: 2,
  },
  heroTitle: {
    ...typography.h1,
    color: colors.text.primary,
    fontSize: 24,
  },
  heroSub: {
    color: colors.text.secondary,
    fontSize: 14,
    lineHeight: 20,
  },
  card: {
    backgroundColor: colors.bg.card,
    borderWidth: 1,
    borderColor: colors.border.blueHairline,
    borderRadius: radii.lg,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  label: {
    color: colors.text.primary,
    fontSize: 13,
    fontWeight: "600",
    marginBottom: 4,
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  chip: {
    minHeight: 44,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border.blueHairline,
    backgroundColor: colors.bg.app,
    alignItems: "center",
    justifyContent: "center",
  },
  chipActive: {
    borderColor: colors.brand.primary,
    backgroundColor: colors.brand.primarySoft,
  },
  chipLabel: {
    color: colors.text.primary,
    fontSize: 14,
    fontWeight: "600",
  },
  chipLabelActive: {
    color: colors.brand.primary,
  },
  chipCol: {
    gap: spacing.sm,
  },
  chipLevel: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 56,
    padding: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border.blueHairline,
    backgroundColor: colors.bg.app,
  },
  chipLevelActive: {
    borderColor: colors.brand.primary,
    backgroundColor: colors.brand.primarySoft,
  },
  chipHint: {
    color: colors.text.secondary,
    fontSize: 12,
    marginTop: 2,
  },
  check: {
    color: colors.brand.primary,
    fontSize: 20,
    fontWeight: "700",
    marginLeft: spacing.sm,
  },
});
