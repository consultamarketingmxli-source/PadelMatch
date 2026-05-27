/** Mi Perfil — stats del jugador por teléfono. */
import React, { useState } from "react";
import {
  ActivityIndicator,
  Image,
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
import { ArrowLeft, Trophy, Target, Activity } from "lucide-react-native";

import { api, PlayerStats } from "@/src/api";
import { Button } from "@/src/components/Button";
import { Input } from "@/src/components/Input";
import { colors, radii, spacing, typography } from "@/src/theme";

export default function ProfileScreen() {
  const router = useRouter();
  const [telefono, setTelefono] = useState("");
  const [stats, setStats] = useState<PlayerStats | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    if (!telefono.trim()) return;
    setLoading(true);
    try {
      const s = await api.playerStats(telefono.trim());
      setStats(s);
    } catch {
      setStats(null);
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
        <ScrollView contentContainerStyle={styles.scroll}>
          <View style={styles.topBar}>
            <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="back-btn">
              <ArrowLeft size={18} color={colors.text.primary} />
            </TouchableOpacity>
            <Text style={styles.brand}>MI PERFIL</Text>
            <View style={{ width: 40 }} />
          </View>

          <View style={styles.avatarWrap}>
            <Image
              source={{
                uri: "https://images.unsplash.com/photo-1549505415-e16dbd446231?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjA2MTJ8MHwxfHNlYXJjaHwzfHxhdGhsZXRlJTIwcG9ydHJhaXQlMjBkYXJrbmVzc3xlbnwwfHx8fDE3Nzk4MzgzMjV8MA&ixlib=rb-4.1.0&q=85",
              }}
              style={styles.avatar}
            />
            <Text style={styles.title}>
              {stats?.nombre || "Identifícate"}
            </Text>
            <Text style={styles.subtitle}>
              Consulta tus estadísticas históricas en PadelReta
            </Text>
          </View>

          <Input
            label="Tu teléfono"
            placeholder="+5215512345678"
            value={telefono}
            onChangeText={setTelefono}
            keyboardType="phone-pad"
            testID="profile-tel-input"
          />
          <Button title="Buscar mis stats" onPress={load} loading={loading} testID="profile-load-btn" />

          {loading ? (
            <ActivityIndicator color={colors.brand.primary} style={{ marginTop: spacing.lg }} />
          ) : stats ? (
            <View style={styles.statsWrap}>
              <StatCard
                icon={<Activity size={20} color={colors.brand.primary} />}
                label="Partidos jugados"
                value={stats.partidos_jugados}
              />
              <StatCard
                icon={<Trophy size={20} color={colors.brand.primary} />}
                label="Partidos ganados"
                value={stats.partidos_ganados}
              />
              <StatCard
                icon={<Target size={20} color={colors.brand.primary} />}
                label="Efectividad"
                value={`${stats.efectividad}%`}
                accent
              />
            </View>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function StatCard({
  icon, label, value, accent = false,
}: { icon: React.ReactNode; label: string; value: string | number; accent?: boolean }) {
  return (
    <View style={[styles.statCard, accent && styles.statAccent]}>
      <View style={styles.statHead}>
        {icon}
        <Text style={styles.statLabel}>{label}</Text>
      </View>
      <Text style={[styles.statValue, accent && { color: colors.brand.primary }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg.app },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl },
  topBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.lg },
  iconBtn: {
    width: 40, height: 40, borderRadius: radii.md,
    backgroundColor: colors.bg.card, borderWidth: 1, borderColor: colors.border.default,
    alignItems: "center", justifyContent: "center",
  },
  brand: { color: colors.brand.primary, fontWeight: "900", letterSpacing: 2, fontSize: 14 },
  avatarWrap: { alignItems: "center", marginBottom: spacing.lg, gap: 8 },
  avatar: {
    width: 88, height: 88, borderRadius: 44,
    borderWidth: 2, borderColor: colors.brand.primaryBorder,
    marginBottom: spacing.sm,
  },
  title: { ...typography.h2, color: colors.text.primary, textTransform: "uppercase" },
  subtitle: { color: colors.text.secondary, textAlign: "center", paddingHorizontal: spacing.lg },
  statsWrap: { marginTop: spacing.lg, gap: spacing.md },
  statCard: {
    backgroundColor: colors.bg.card, borderRadius: radii.md, padding: spacing.lg,
    borderWidth: 1, borderColor: colors.border.default,
  },
  statAccent: { borderColor: colors.brand.primaryBorder, backgroundColor: colors.brand.primarySoft },
  statHead: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: spacing.sm },
  statLabel: { ...typography.label, color: colors.text.secondary, fontSize: 11 },
  statValue: { color: colors.text.primary, fontSize: 32, fontWeight: "900" },
});
