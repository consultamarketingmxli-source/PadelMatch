import React from "react";
import { Image, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Calendar, MapPin, Users, DollarSign } from "lucide-react-native";
import { Reta } from "@/src/api";
import { colors, radii, spacing, typography } from "@/src/theme";
import { TrafficLight } from "./TrafficLight";

type Props = {
  reta: Reta;
  onPress?: () => void;
  testID?: string;
};

export function RetaCard({ reta, onPress, testID }: Props) {
  const fecha = new Date(reta.fecha_evento);
  const fechaStr = fecha.toLocaleDateString("es-MX", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
  return (
    <TouchableOpacity
      testID={testID}
      onPress={onPress}
      activeOpacity={0.85}
      style={styles.card}
    >
      <View style={styles.headerRow}>
        <View style={styles.logoBox}>
          {reta.organizador_logo_url ? (
            <Image
              source={{ uri: reta.organizador_logo_url }}
              style={styles.logo}
            />
          ) : (
            <Text style={styles.logoFallback}>P·OS</Text>
          )}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={1}>{reta.nombre}</Text>
          <View style={styles.metaRow}>
            <MapPin size={12} color={colors.text.secondary} />
            <Text style={styles.metaText} numberOfLines={1}>{reta.club}</Text>
          </View>
        </View>
        <TrafficLight
          status={reta.semaforo}
          capacidadPct={reta.capacidad_pct}
          size="sm"
        />
      </View>

      <View style={styles.statsGrid}>
        <Stat icon={<Calendar size={14} color={colors.brand.primary} />} label={fechaStr} />
        <Stat icon={<Users size={14} color={colors.brand.primary} />} label={`${reta.inscritos_count}/${reta.max_jugadores}`} />
        <Stat icon={<DollarSign size={14} color={colors.brand.primary} />} label={`$${reta.costo_inscripcion}`} />
      </View>

      {reta.observaciones_publicas ? (
        <View style={styles.obsBox}>
          <Text style={styles.obsLabel}>NOTA DEL ORGANIZADOR</Text>
          <Text style={styles.obsText} numberOfLines={3}>
            {reta.observaciones_publicas}
          </Text>
        </View>
      ) : null}
    </TouchableOpacity>
  );
}

function Stat({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <View style={styles.stat}>
      {icon}
      <Text style={styles.statText} numberOfLines={1}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.bg.card,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border.default,
    padding: spacing.base,
    marginBottom: spacing.md,
  },
  headerRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  logoBox: {
    width: 48,
    height: 48,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.brand.primaryBorder,
    backgroundColor: colors.brand.primarySoft,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  logo: { width: 48, height: 48, resizeMode: "cover" },
  logoFallback: {
    color: colors.brand.primary,
    fontWeight: "900",
    fontSize: 14,
    letterSpacing: 0.5,
  },
  title: {
    ...typography.h3,
    color: colors.text.primary,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 2,
  },
  metaText: {
    ...typography.caption,
    color: colors.text.secondary,
  },
  statsGrid: {
    flexDirection: "row",
    gap: spacing.md,
    marginTop: spacing.base,
    flexWrap: "wrap",
  },
  stat: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.bg.elevated,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: radii.sm,
  },
  statText: {
    ...typography.caption,
    color: colors.text.primary,
    fontWeight: "600",
  },
  obsBox: {
    marginTop: spacing.md,
    borderWidth: 1,
    borderColor: colors.brand.primaryBorder,
    backgroundColor: colors.brand.primarySoft,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderStyle: "dashed",
  },
  obsLabel: {
    ...typography.label,
    color: colors.brand.primary,
    fontSize: 10,
    marginBottom: 4,
  },
  obsText: {
    color: colors.text.primary,
    fontSize: 13,
    lineHeight: 18,
  },
});
