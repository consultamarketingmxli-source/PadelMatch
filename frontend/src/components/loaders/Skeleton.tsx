/**
 * Skeleton primitives — placeholders animados premium (Rebrand v3 Sapphire/Azure).
 *
 * Implementación:
 *   - Pulso de color (sapphire 6% → azure 14%) corriendo en UI thread via Reanimated.
 *   - Sin gradientes (cero overhead en web).
 *   - API tipo Material/Telegram: <Skeleton.Box w h /> · <Skeleton.Line w h />
 *
 * Presets disponibles:
 *   - RetaCard       → réplica de RetaCardPremium (Home / lista de retas)
 *   - GenericCard    → card rectangular grande
 *   - RetaDetail     → header + chips + cta para pantalla de detalle
 *   - Profile        → header + grid de stats (perfil / mi-cuenta)
 *   - StatsGrid      → grid de N cards de stats
 *   - StandingsRow   → fila de la tabla de posiciones
 *   - Standings      → tabla completa (header + N filas)
 *
 * NOTA: Usar siempre vía <SmartLoader skeleton={<Skeleton.RetaCard/>}>
 *       para respetar el debounce 300ms / 800ms.
 */
import React, { useEffect } from "react";
import { StyleSheet, View, ViewStyle } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { colors, radii, spacing } from "@/src/theme";

// Shimmer Sapphire/Azure (rebrand v3) — 6% → 14%.
const BASE = "rgba(30,58,138,0.06)";
const HIGHLIGHT = "rgba(59,130,246,0.14)";

function usePulse() {
  const v = useSharedValue(0);
  useEffect(() => {
    v.value = withRepeat(
      withTiming(1, { duration: 1100, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
  }, [v]);
  return useAnimatedStyle(() => ({
    backgroundColor: v.value > 0.5 ? HIGHLIGHT : BASE,
    opacity: 0.65 + v.value * 0.3,
  }));
}

export type SkeletonBoxProps = {
  w?: number | `${number}%` | "100%";
  h?: number;
  radius?: number;
  style?: ViewStyle;
};

function Box({ w = "100%", h = 12, radius = 6, style }: SkeletonBoxProps) {
  const pulse = usePulse();
  return (
    <Animated.View
      style={[
        { width: w as any, height: h, borderRadius: radius, backgroundColor: BASE },
        pulse,
        style,
      ]}
    />
  );
}

function Line({ w = "60%", h = 10 }: SkeletonBoxProps) {
  return <Box w={w} h={h} radius={4} style={{ marginVertical: 4 }} />;
}

function Circle({ size = 40 }: { size?: number }) {
  return <Box w={size} h={size} radius={size / 2} />;
}

/**
 * RetaCard — réplica fiel de RetaCardPremium:
 * logo 56×56 + título/club + chips + statsRow (Fecha · Jugadores · Costo).
 */
function RetaCard() {
  return (
    <View style={styles.card}>
      {/* headerRow: logo 56 + title/club */}
      <View style={styles.headerRow}>
        <Box w={56} h={56} radius={radii.icon} />
        <View style={{ flex: 1, gap: 6 }}>
          <Box w="78%" h={16} radius={6} />
          <Box w="45%" h={11} radius={5} />
        </View>
      </View>
      {/* chipsRow */}
      <View style={styles.chipsRow}>
        <Box w={72} h={22} radius={11} />
        <Box w={86} h={22} radius={11} />
      </View>
      {/* statsRow */}
      <View style={styles.statsRow}>
        <View style={styles.statBlock}>
          <Box w="60%" h={9} radius={4} />
          <View style={{ height: 6 }} />
          <Box w="80%" h={14} radius={6} />
          <View style={{ height: 4 }} />
          <Box w="50%" h={10} radius={5} />
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statBlock}>
          <Box w="70%" h={9} radius={4} />
          <View style={{ height: 6 }} />
          <Box w="60%" h={18} radius={6} />
        </View>
        <View style={styles.statDivider} />
        <View style={[styles.statBlock, { alignItems: "flex-end" }]}>
          <Box w="50%" h={9} radius={4} />
          <View style={{ height: 6 }} />
          <Box w="70%" h={18} radius={6} />
        </View>
      </View>
    </View>
  );
}

/** Card preset genérica (rectangular grande). */
function GenericCard() {
  return (
    <View style={styles.card}>
      <Box w="50%" h={14} radius={6} />
      <View style={{ height: 8 }} />
      <Box w="80%" h={10} radius={5} />
      <View style={{ height: 6 }} />
      <Box w="60%" h={10} radius={5} />
    </View>
  );
}

/** Header + chips + cta. Para pantalla de detalle de reta. */
function RetaDetail() {
  return (
    <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.md, gap: spacing.md }}>
      {/* Hero card */}
      <View style={styles.card}>
        <Box w="40%" h={11} radius={5} />
        <View style={{ height: 10 }} />
        <Box w="90%" h={22} radius={8} />
        <View style={{ height: 8 }} />
        <Box w="65%" h={14} radius={6} />
        <View style={{ height: spacing.md }} />
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Box w={88} h={22} radius={11} />
          <Box w={70} h={22} radius={11} />
          <Box w={94} h={22} radius={11} />
        </View>
      </View>
      {/* Info card */}
      <View style={styles.card}>
        <Box w="35%" h={11} radius={5} />
        <View style={{ height: 10 }} />
        <Box w="100%" h={12} radius={6} />
        <View style={{ height: 6 }} />
        <Box w="80%" h={12} radius={6} />
        <View style={{ height: 6 }} />
        <Box w="60%" h={12} radius={6} />
      </View>
      {/* CTA */}
      <Box w="100%" h={52} radius={radii.lg} />
    </View>
  );
}

/** Grid de N cards de stats (default 4) — perfil / mi-cuenta. */
function StatsGrid({ count = 4 }: { count?: number }) {
  return (
    <View style={styles.statsGrid}>
      {Array.from({ length: count }).map((_, i) => (
        <View key={i} style={styles.statTile}>
          <Box w={36} h={36} radius={12} />
          <View style={{ height: 10 }} />
          <Box w="70%" h={10} radius={5} />
          <View style={{ height: 6 }} />
          <Box w="50%" h={18} radius={6} />
        </View>
      ))}
    </View>
  );
}

/** Profile (mi-cuenta) — hero + statsGrid + lista de inscripciones. */
function Profile() {
  return (
    <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.md, gap: spacing.md }}>
      {/* hero */}
      <View style={styles.card}>
        <Box w="40%" h={11} radius={5} />
        <View style={{ height: 8 }} />
        <Box w="70%" h={22} radius={8} />
        <View style={{ height: 6 }} />
        <Box w="55%" h={12} radius={6} />
      </View>
      {/* Stats grid */}
      <StatsGrid count={4} />
      {/* Lista */}
      <Box w="40%" h={12} radius={5} />
      <GenericCard />
      <GenericCard />
    </View>
  );
}

/** Fila de la tabla de posiciones (posición + nombre + pts/pj/pg/pp). */
function StandingsRow() {
  return (
    <View style={styles.standingsRow}>
      <Box w={28} h={28} radius={14} />
      <View style={{ flex: 1, marginLeft: spacing.sm, gap: 6 }}>
        <Box w="60%" h={13} radius={6} />
        <Box w="40%" h={10} radius={5} />
      </View>
      <View style={{ flexDirection: "row", gap: 10 }}>
        <Box w={28} h={22} radius={6} />
        <Box w={28} h={22} radius={6} />
        <Box w={28} h={22} radius={6} />
      </View>
    </View>
  );
}

/** Tabla de posiciones completa — header card + N rows (default 6). */
function Standings({ count = 6 }: { count?: number }) {
  return (
    <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.md, gap: spacing.sm }}>
      <View style={styles.card}>
        <Box w="60%" h={11} radius={5} />
        <View style={{ height: 6 }} />
        <Box w="80%" h={10} radius={5} />
      </View>
      {Array.from({ length: count }).map((_, i) => (
        <StandingsRow key={i} />
      ))}
    </View>
  );
}

export const Skeleton = {
  Box,
  Line,
  Circle,
  RetaCard,
  GenericCard,
  RetaDetail,
  StatsGrid,
  Profile,
  Standings,
  StandingsRow,
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.bg.card,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.border.blueHairline,
    padding: spacing.base,
    marginBottom: spacing.md,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  chipsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: spacing.md,
  },
  statsRow: {
    flexDirection: "row",
    alignItems: "stretch",
    marginTop: spacing.base,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border.blueHairline,
  },
  statBlock: {
    flex: 1,
    paddingHorizontal: 4,
  },
  statDivider: {
    width: 1,
    backgroundColor: colors.border.blueHairline,
    marginHorizontal: 4,
  },
  statsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  statTile: {
    width: "48%",
    backgroundColor: colors.bg.card,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border.blueHairline,
    padding: spacing.md,
  },
  standingsRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.bg.card,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border.blueHairline,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
});
