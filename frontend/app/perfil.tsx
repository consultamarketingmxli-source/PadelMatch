/** Mi Perfil — stats del jugador por teléfono. */
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
import { ArrowLeft, Trophy, Target, Activity, Zap } from "lucide-react-native";

import { api, PlayerStats } from "@/src/api";
import { Input } from "@/src/components/Input";
import { HeroBanner } from "@/src/components/brand/HeroBanner";
import { CTAButton } from "@/src/components/brand/CTAButton";
import { SmartLoader, Skeleton } from "@/src/components/loaders";
import { colors, radii, shadows, spacing, typography } from "@/src/theme";

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

          <HeroBanner
            eyebrow="PADELAPPRETAS · PERFIL DE JUGADOR"
            title={stats?.nombre || "Identifícate"}
            subtitle="Consulta tus estadísticas históricas, partidos jugados, victorias y efectividad."
            height={180}
            style={{ marginBottom: spacing.lg }}
          />

          <Input
            label="Tu teléfono"
            placeholder="+5215512345678"
            value={telefono}
            onChangeText={setTelefono}
            keyboardType="phone-pad"
            testID="profile-tel-input"
          />
          <CTAButton
            label="Buscar mis stats"
            onPress={load}
            loading={loading}
            fullWidth
            size="lg"
            testID="profile-load-btn"
            style={{ marginTop: spacing.md }}
          />

          {loading ? (
            <View style={{ marginTop: spacing.lg }}>
              <SmartLoader
                loading={loading}
                skeleton={<Skeleton.StatsGrid count={4} />}
              />
            </View>
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
              {/* Fase 4 — Victorias por KO. Solo se muestra si hay >=1 KO. */}
              {typeof stats.victorias_ko === "number" && stats.victorias_ko > 0 ? (
                <StatCard
                  icon={<Zap size={20} color={colors.brand.primary} />}
                  label="Victorias por KO (3-0)"
                  value={stats.victorias_ko}
                  accent
                />
              ) : null}
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
    backgroundColor: colors.bg.card, borderWidth: 1, borderColor: colors.border.blueHairline,
    alignItems: "center", justifyContent: "center",
  },
  brand: { ...typography.label, color: colors.brand.azure, fontSize: 11, letterSpacing: 2 },
  statsWrap: { marginTop: spacing.lg, gap: spacing.md },
  statCard: {
    backgroundColor: colors.bg.card, borderRadius: radii.card, padding: spacing.lg,
    borderWidth: 1, borderColor: colors.border.blueHairline,
    ...(shadows.card as object),
  },
  statAccent: { borderColor: colors.brand.primaryBorder, backgroundColor: colors.brand.primarySoft },
  statHead: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: spacing.sm },
  statLabel: { ...typography.label, color: colors.text.secondary, fontSize: 11 },
  statValue: {
    fontFamily: typography.monoBold.fontFamily,
    fontVariant: ["tabular-nums"],
    color: colors.brand.sapphire,
    fontSize: 32,
    letterSpacing: -0.8,
  },
});
