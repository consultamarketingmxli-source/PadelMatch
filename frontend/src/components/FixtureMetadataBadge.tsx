/**
 * FixtureMetadataBadge — Badge sutil que informa al admin sobre cómo se generó
 * el rol Round Robin. Se renderiza SOLO cuando el motor aplicó alguna
 * optimización (descansos, rivales repetidos por límite combinatorio, etc.).
 *
 * Tipos visuales:
 *   • Rol PERFECTO (optimizacion_aplicada=false) → no se muestra nada.
 *   • Rol OPTIMIZADO → chip amber sutil con icono Info, texto del motivo.
 *
 * UX:
 *   • Tap → expande detalles técnicos (parejas repetidas, rivales extra,
 *     algoritmo usado).
 *   • Botón "Cerrar" para que no estorbe en sesiones largas.
 */
import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Info, X as XIcon, ChevronDown, ChevronUp } from "lucide-react-native";

import { colors, radii, spacing, typography } from "@/src/theme";

export interface FixtureMetadata {
  optimizacion_aplicada: boolean;
  parejas_repetidas: number;
  rivales_repetidos_extra: number;
  descansos_distribuidos: boolean;
  iteraciones_usadas: number;
  relax_level_final: number;
  motivo: string;
  algoritmo: string;
}

interface Props {
  metadata?: FixtureMetadata | null;
  /** Si true muestra el badge incluso si el rol es perfecto (modo debug). */
  showAlways?: boolean;
}

export function FixtureMetadataBadge({ metadata, showAlways = false }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;
  if (!metadata) return null;
  if (!metadata.optimizacion_aplicada && !showAlways) return null;

  return (
    <View style={styles.wrap} testID="fixture-metadata-badge">
      <Pressable
        style={styles.row}
        onPress={() => setExpanded((v) => !v)}
        hitSlop={6}
      >
        <Info size={14} color="#92400e" />
        <Text style={styles.titleText} numberOfLines={expanded ? undefined : 2}>
          {metadata.motivo || "Rol optimizado: ajustado de manera justa según el quórum de jugadores"}
        </Text>
        {expanded ? (
          <ChevronUp size={14} color="#92400e" />
        ) : (
          <ChevronDown size={14} color="#92400e" />
        )}
        <Pressable
          onPress={(e) => {
            e.stopPropagation?.();
            setDismissed(true);
          }}
          hitSlop={6}
          style={styles.closeBtn}
          testID="fixture-badge-close"
        >
          <XIcon size={12} color="#92400e" />
        </Pressable>
      </Pressable>
      {expanded ? (
        <View style={styles.details}>
          <DetailRow label="Algoritmo" value={metadata.algoritmo} />
          {metadata.parejas_repetidas > 0 ? (
            <DetailRow
              label="Parejas repetidas"
              value={`${metadata.parejas_repetidas}`}
              warning
            />
          ) : null}
          {metadata.rivales_repetidos_extra > 0 ? (
            <DetailRow
              label="Rivales repetidos (extra)"
              value={`${metadata.rivales_repetidos_extra}`}
            />
          ) : null}
          <DetailRow
            label="Descansos balanceados"
            value={metadata.descansos_distribuidos ? "Sí" : "No"}
            warning={!metadata.descansos_distribuidos}
          />
          {metadata.iteraciones_usadas > 0 ? (
            <DetailRow
              label="Iteraciones CSP"
              value={`${metadata.iteraciones_usadas}/500`}
            />
          ) : null}
          <View style={styles.divider} />
          <Text style={styles.footnote}>
            El motor garantiza siempre la igualdad de partidos por jugador.
            Cuando el número de inscritos no permite cumplir todas las reglas
            combinatorias a la vez, optimiza siguiendo la prioridad: igualdad ›
            no repetir pareja › no repetir rival.
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function DetailRow({
  label,
  value,
  warning = false,
}: {
  label: string;
  value: string;
  warning?: boolean;
}) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text
        style={[
          styles.detailValue,
          warning && { color: "#b91c1c", fontWeight: "700" },
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: "#fef3c7",
    borderWidth: 1,
    borderColor: "#fcd34d",
    borderRadius: radii.md,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  titleText: {
    flex: 1,
    color: "#92400e",
    fontSize: typography.sm,
    fontWeight: "600",
    lineHeight: 18,
  },
  closeBtn: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "rgba(146, 64, 14, 0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  details: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: "#fde68a",
    gap: 5,
  },
  detailRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  detailLabel: {
    color: "#78350f",
    fontSize: typography.xs,
  },
  detailValue: {
    color: "#451a03",
    fontSize: typography.xs,
    fontWeight: "600",
  },
  divider: {
    height: 1,
    backgroundColor: "#fde68a",
    marginVertical: 4,
  },
  footnote: {
    color: "#78350f",
    fontSize: typography.xs,
    lineHeight: 16,
    fontStyle: "italic",
  },
});
