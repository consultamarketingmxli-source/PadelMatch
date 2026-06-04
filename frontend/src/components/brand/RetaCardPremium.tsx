/**
 * RetaCardPremium — Tarjeta de Reta premium (rebrand v3 Sapphire/Azure).
 *
 * Diseño:
 *   • Card blanca, radio 24, shadow Sapphire (tinte azul profundo).
 *   • Header con logo del club + nombre + chip semaforo (cupo).
 *   • Meta-row con club y fecha (ícono + texto secundario).
 *   • Stats premium: jugadores (mono) + precio (mono color Sapphire grande).
 *   • Chips: nivel + estado de cupo. Hairline azul tenue.
 *
 * COMPATIBILIDAD: mismo `Reta` y mismas props que `RetaCard` existente,
 * así puede usarse como reemplazo drop-in en cualquier lista.
 */
import React from "react";
import {
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Calendar, MapPin } from "lucide-react-native";
import { Reta } from "@/src/api";
import {
  chipPalette,
  colors,
  radii,
  shadows,
  spacing,
  typography,
} from "@/src/theme";
import { Chip } from "./Chip";
import { PadelPalaShape } from "./PadelPalaShape";

type Props = {
  reta: Reta;
  onPress?: () => void;
  testID?: string;
};

function getNivelVariant(nivel?: string | null): keyof typeof chipPalette {
  if (!nivel) return "mid";
  const k = nivel.toLowerCase();
  if (k.includes("princip") || k.includes("begin")) return "beginner";
  if (k.includes("avan") || k.includes("advan")) return "advanced";
  if (k.includes("elite") || k.includes("pro")) return "elite";
  return "mid";
}

function getCupoVariant(
  semaforo?: string | null,
  pct?: number | null,
): { variant: keyof typeof chipPalette; label: string } {
  const p = pct ?? 0;
  if (semaforo === "red" || p >= 100) return { variant: "full", label: "Lleno" };
  if (semaforo === "yellow" || p >= 75)
    return { variant: "premium", label: "Últimos" };
  return { variant: "available", label: "Disponible" };
}

export function RetaCardPremium({ reta, onPress, testID }: Props) {
  const fecha = new Date(reta.fecha_evento);
  const fechaStr = fecha.toLocaleDateString("es-MX", {
    weekday: "short",
    day: "2-digit",
    month: "short",
  });
  const horaStr = fecha.toLocaleTimeString("es-MX", {
    hour: "2-digit",
    minute: "2-digit",
  });

  const nivelVariant = getNivelVariant((reta as any).nivel_descripcion);
  const cupo = getCupoVariant(reta.semaforo, reta.capacidad_pct);

  return (
    <TouchableOpacity
      testID={testID}
      onPress={onPress}
      activeOpacity={0.92}
      style={[styles.card, shadows.card as object]}
    >
      {/* Header — logo + nombre + chips */}
      <View style={styles.headerRow}>
        <View style={styles.logoBox}>
          {reta.organizador_logo_url ? (
            <Image
              source={{ uri: reta.organizador_logo_url }}
              style={styles.logo}
            />
          ) : (
            <PadelPalaShape size={36} color={colors.brand.sapphire} />
          )}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={2}>
            {reta.nombre}
          </Text>
          <View style={styles.metaRow}>
            <MapPin size={11} color={colors.text.secondary} />
            <Text style={styles.metaText} numberOfLines={1}>
              {reta.club}
            </Text>
          </View>
        </View>
      </View>

      {/* Chips row — nivel + cupo */}
      <View style={styles.chipsRow}>
        {(reta as any).nivel_descripcion ? (
          <Chip
            label={(reta as any).nivel_descripcion}
            variant={nivelVariant}
            dot
          />
        ) : null}
        <Chip label={cupo.label} variant={cupo.variant} dot />
      </View>

      {/* Stats — fecha + jugadores + precio */}
      <View style={styles.statsRow}>
        <View style={styles.statBlock}>
          <View style={styles.statHeader}>
            <Calendar size={11} color={colors.text.secondary} />
            <Text style={styles.statLabel}>Fecha</Text>
          </View>
          <Text style={styles.statValue} numberOfLines={1}>
            {fechaStr}
          </Text>
          <Text style={styles.statValueSub} numberOfLines={1}>
            {horaStr}
          </Text>
        </View>

        <View style={styles.statDivider} />

        <View style={styles.statBlock}>
          <View style={styles.statHeader}>
            <Text style={styles.statLabel}>Jugadores</Text>
          </View>
          <Text style={styles.statMono}>
            {reta.inscritos_count}
            <Text style={styles.statMonoMuted}>/{reta.max_jugadores}</Text>
          </Text>
        </View>

        <View style={styles.statDivider} />

        <View style={[styles.statBlock, { alignItems: "flex-end" }]}>
          <Text style={styles.statLabel}>Costo</Text>
          <Text style={styles.priceMono}>
            ${reta.costo_inscripcion.toLocaleString("es-MX")}
          </Text>
        </View>
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

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.bg.card,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.border.blueHairline,
    padding: spacing.base,
    marginBottom: spacing.md,
    overflow: "hidden",
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  logoBox: {
    width: 56,
    height: 56,
    borderRadius: radii.icon,
    backgroundColor: colors.brand.primarySoft,
    borderWidth: 1,
    borderColor: colors.brand.primaryBorder,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  logo: { width: 56, height: 56 },
  title: {
    ...typography.h3,
    fontSize: 17,
    lineHeight: 21,
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
  statHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginBottom: 4,
  },
  statLabel: {
    ...typography.label,
    fontSize: 9.5,
    color: colors.text.secondary,
    letterSpacing: 1,
  },
  statValue: {
    ...typography.bodyBold,
    fontSize: 13,
    color: colors.text.primary,
    textTransform: "capitalize",
  },
  statValueSub: {
    ...typography.caption,
    color: colors.text.secondary,
  },
  statMono: {
    fontFamily: typography.monoBold.fontFamily,
    fontSize: 17,
    fontVariant: ["tabular-nums"],
    color: colors.text.primary,
  },
  statMonoMuted: {
    fontFamily: typography.mono.fontFamily,
    fontSize: 13,
    color: colors.text.tertiary,
  },
  priceMono: {
    fontFamily: typography.monoBold.fontFamily,
    fontSize: 18,
    fontVariant: ["tabular-nums"],
    color: colors.brand.sapphire,
    letterSpacing: -0.4,
  },
  obsBox: {
    marginTop: spacing.md,
    borderWidth: 1,
    borderColor: colors.brand.primaryBorder,
    backgroundColor: colors.brand.primarySoft,
    borderRadius: radii.input,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderStyle: "dashed",
  },
  obsLabel: {
    ...typography.label,
    color: colors.brand.azure,
    fontSize: 9.5,
    marginBottom: 4,
  },
  obsText: {
    color: colors.text.primary,
    fontSize: 13,
    lineHeight: 18,
  },
});
