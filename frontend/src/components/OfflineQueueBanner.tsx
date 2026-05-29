/**
 * OfflineQueueBanner — Indicador visual de estado de red + cola pendiente.
 *
 * Estados:
 *  • Online + sin cola → no renderiza (no hace ruido visual).
 *  • Offline → banner rojo: "Sin conexión. Tus cambios se guardarán al volver."
 *  • Online + cola pendiente → banner amber: "Sincronizando X cambios..."
 *  • Online + cola con fallidos → banner rojo: "X cambios no pudieron aplicarse"
 *    + botón Reintentar y opción de Descartar.
 *
 * UX:
 *  • Animación de aparición suave (no salta).
 *  • Touch para expandir lista de pendientes/fallidos.
 *  • Botón "Reintentar ahora" si hay pendientes y volvimos a estar online.
 */
import React, { useState } from "react";
import {
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  CheckCircle2,
  CloudOff,
  RefreshCw,
  WifiOff,
  AlertTriangle,
  X as XIcon,
} from "lucide-react-native";

import { colors, radii, spacing, typography } from "@/src/theme";
import {
  removeFailedAction,
  type QueuedAction,
} from "@/src/utils/offlineQueue";

interface Props {
  isOnline: boolean;
  pendingCount: number;
  failedCount: number;
  isFlushing: boolean;
  onRetry: () => void;
  queue: QueuedAction[];
}

export function OfflineQueueBanner({
  isOnline,
  pendingCount,
  failedCount,
  isFlushing,
  onRetry,
  queue,
}: Props) {
  const [expanded, setExpanded] = useState(false);

  // Si todo está bien, no renderizamos nada.
  if (isOnline && pendingCount === 0 && failedCount === 0) return null;

  // --- Caso 1: Offline ---
  if (!isOnline) {
    return (
      <Pressable
        onPress={() => setExpanded((v) => !v)}
        style={[styles.banner, styles.bannerOffline]}
        testID="offline-queue-banner"
      >
        <View style={styles.row}>
          <WifiOff size={16} color="#fff" />
          <Text style={styles.txtWhite}>
            Sin conexión
            {pendingCount > 0
              ? ` · ${pendingCount} cambio${pendingCount === 1 ? "" : "s"} en cola`
              : ""}
          </Text>
        </View>
        <Text style={styles.subWhite}>
          Tus cambios se guardarán automáticamente al recuperar señal.
        </Text>
        {expanded && pendingCount > 0 ? (
          <View style={styles.list}>
            {queue
              .filter((a) => a.status === "pending")
              .slice(0, 6)
              .map((a) => (
                <Text key={a.clientActionId} style={styles.listItem} numberOfLines={1}>
                  • {a.label}
                </Text>
              ))}
          </View>
        ) : null}
      </Pressable>
    );
  }

  // --- Caso 2: Online + sincronizando o cambios fallidos ---
  const hasFailed = failedCount > 0;
  return (
    <Pressable
      onPress={() => setExpanded((v) => !v)}
      style={[
        styles.banner,
        hasFailed ? styles.bannerFailed : styles.bannerSyncing,
      ]}
      testID="offline-queue-banner"
    >
      <View style={styles.row}>
        {hasFailed ? (
          <AlertTriangle size={16} color="#fff" />
        ) : isFlushing ? (
          <RefreshCw size={16} color="#fff" />
        ) : (
          <CloudOff size={16} color="#fff" />
        )}
        <Text style={styles.txtWhite}>
          {hasFailed
            ? `${failedCount} cambio${failedCount === 1 ? "" : "s"} no pudo aplicarse`
            : isFlushing
              ? `Sincronizando ${pendingCount} cambio${pendingCount === 1 ? "" : "s"}…`
              : `${pendingCount} cambio${pendingCount === 1 ? "" : "s"} pendiente${pendingCount === 1 ? "" : "s"} de sincronizar`}
        </Text>
        {!isFlushing && (pendingCount > 0 || hasFailed) ? (
          <Pressable
            onPress={(e) => {
              // Evitar que se expanda al tocar el botón.
              e.stopPropagation?.();
              onRetry();
            }}
            hitSlop={6}
            style={styles.retryBtn}
            testID="offline-queue-retry"
          >
            <RefreshCw size={12} color="#fff" />
            <Text style={styles.retryTxt}>Reintentar</Text>
          </Pressable>
        ) : null}
      </View>
      {expanded ? (
        <View style={styles.list}>
          {queue.slice(0, 8).map((a) => (
            <View key={a.clientActionId} style={styles.listRow}>
              {a.status === "failed" ? (
                <AlertTriangle size={10} color="#fee2e2" />
              ) : (
                <CheckCircle2 size={10} color="#fef3c7" />
              )}
              <Text style={styles.listItem} numberOfLines={1}>
                {a.label}
                {a.status === "failed" && a.lastError
                  ? ` — ${a.lastError.slice(0, 60)}`
                  : ""}
              </Text>
              {a.status === "failed" ? (
                <Pressable
                  onPress={() => {
                    Alert.alert(
                      "Descartar cambio",
                      `¿Eliminar “${a.label}” de la cola? Esta acción no se aplicará nunca.`,
                      [
                        { text: "Cancelar", style: "cancel" },
                        {
                          text: "Descartar",
                          style: "destructive",
                          onPress: () => removeFailedAction(a.clientActionId),
                        },
                      ],
                    );
                  }}
                  hitSlop={6}
                >
                  <XIcon size={11} color="#fee2e2" />
                </Pressable>
              ) : null}
            </View>
          ))}
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  banner: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    borderRadius: radii.md,
    gap: 4,
  },
  bannerOffline: { backgroundColor: "#dc2626" },
  bannerSyncing: { backgroundColor: "#d97706" },
  bannerFailed: { backgroundColor: "#b91c1c" },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  txtWhite: {
    color: "#fff",
    fontSize: typography.sm,
    fontWeight: "600",
    flex: 1,
  },
  subWhite: {
    color: "#fee2e2",
    fontSize: typography.xs,
    marginTop: 2,
  },
  retryBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(255,255,255,0.22)",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radii.sm,
  },
  retryTxt: { color: "#fff", fontSize: typography.xs, fontWeight: "700" },
  list: {
    marginTop: 6,
    paddingTop: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(255,255,255,0.4)",
    gap: 3,
  },
  listRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  listItem: {
    color: "#fff",
    fontSize: typography.xs,
    flex: 1,
  },
});
