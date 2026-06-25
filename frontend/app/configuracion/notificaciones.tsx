/**
 * Configuración de Notificaciones — Pantalla de control de Push.
 *
 * Permite al usuario:
 *   - Ver el estado actual (registered / pending_deploy / disabled / never)
 *   - Activar o desactivar las alertas con un Switch elegante
 *   - Si el SO bloqueó las notifs (canAskAgain=false), CTA "Abrir Ajustes"
 *
 * Fuente de verdad:
 *   El backend (`db.push_registrations.notifications_enabled`) ES la fuente
 *   autoritativa. Esta pantalla siempre consulta `GET /api/push-status` al
 *   montar y al hacer pull-to-refresh para evitar inconsistencias entre
 *   apps / dispositivos del mismo user.
 *
 * Flujos:
 *   - Toggle OFF → POST /api/disable-push → state=disabled
 *   - Toggle ON con permiso SO concedido → register-push (refresca token)
 *   - Toggle ON con permiso SO denegado → muestra CTA "Abrir Ajustes"
 *
 * Acceso: `/configuracion/notificaciones` (linkeado desde Mi Cuenta).
 */
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, Stack } from "expo-router";
import { Bell, BellOff, ChevronLeft, Settings as SettingsIcon } from "lucide-react-native";

import { colors, radii, shadows, spacing, typography } from "@/src/theme";
import { usePushRegistration } from "@/src/hooks/usePushRegistration";
import { getPlayerInfo } from "@/src/utils/playerInfo";

type ServerStatus = "loading" | "never" | "registered" | "pending_deploy" | "disabled";

export default function ConfiguracionNotificaciones() {
  const router = useRouter();
  const [userId, setUserId] = useState<string | null>(null);
  const [serverState, setServerState] = useState<ServerStatus>("loading");
  const [platformInfo, setPlatformInfo] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [osPermission, setOsPermission] = useState<{
    status: "undetermined" | "granted" | "denied";
    canAskAgain: boolean;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const push = usePushRegistration({ user_id: userId });

  // Estado derivado para el Switch: ON sólo si server-enabled Y SO permite.
  const switchValue =
    serverState === "registered" &&
    (Platform.OS === "web" || osPermission?.status === "granted");

  // ===== Carga inicial =====
  const reload = useCallback(async () => {
    setServerState((s) => (s === "loading" ? "loading" : s));
    try {
      const info = await getPlayerInfo();
      if (!info?.jugador_id) {
        setUserId(null);
        setServerState("never");
        return;
      }
      setUserId(info.jugador_id);

      // 1) Estado server-side
      const srv = await push.fetchServerStatus().catch(() => null);
      if (srv) {
        setServerState(srv.state);
        setPlatformInfo(srv.platform);
        setUpdatedAt(srv.updated_at);
      } else {
        setServerState("never");
      }

      // 2) Permisos OS-level (sólo nativo).
      if (Platform.OS !== "web") {
        try {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const Notifications = require("expo-notifications");
          const p = await Notifications.getPermissionsAsync();
          setOsPermission({
            status: p.status,
            canAskAgain: p.canAskAgain ?? true,
          });
        } catch {
          setOsPermission(null);
        }
      }
    } catch {
      setServerState("never");
    }
  }, [push]);

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await reload();
    } finally {
      setRefreshing(false);
    }
  };

  // ===== Toggle =====
  const handleToggle = async (next: boolean) => {
    if (!userId) {
      Alert.alert("Inicia sesión", "Necesitas estar autenticado para configurar notificaciones.");
      return;
    }
    if (busy) return;
    setBusy(true);
    try {
      if (next) {
        // ENCENDER: si SO no permite, redirige a Ajustes. Si permite, registrar.
        if (Platform.OS !== "web" && osPermission?.status === "denied" && !osPermission?.canAskAgain) {
          Alert.alert(
            "Notificaciones bloqueadas",
            "Las notificaciones están bloqueadas en los ajustes del sistema. " +
              "Ábrelos y activa las notificaciones para PadelAppRetas.",
            [
              { text: "Cancelar", style: "cancel" },
              { text: "Abrir Ajustes", onPress: () => Linking.openSettings() },
            ],
          );
          return;
        }
        const result = await push.enable();
        if (result.status === "registered" || result.status === "granted_no_token") {
          await reload();
        } else if (result.status === "denied") {
          Alert.alert(
            "Permiso denegado",
            result.message || "Concede permiso de notificaciones para recibir alertas.",
          );
        } else if (result.status === "unsupported") {
          Alert.alert("No disponible", result.message || "Plataforma no soportada.");
        } else {
          Alert.alert("Error", result.message || "No se pudo activar.");
        }
      } else {
        // APAGAR: opt-out server-side. NO revocamos el permiso SO porque
        // sólo el usuario puede hacerlo en Ajustes.
        const ok = await push.disable();
        if (ok) {
          await reload();
        } else {
          Alert.alert("Error", "No se pudo desactivar. Intenta de nuevo.");
        }
      }
    } finally {
      setBusy(false);
    }
  };

  // ===== Helpers de UI =====
  const stateLabel = (() => {
    if (serverState === "loading") return "Cargando…";
    if (serverState === "registered") return "Alertas activas";
    if (serverState === "pending_deploy") return "Pendiente de despliegue";
    if (serverState === "disabled") return "Alertas desactivadas";
    return "Sin configurar";
  })();

  const stateColor = (() => {
    if (serverState === "registered") return colors.status.green;
    if (serverState === "pending_deploy") return colors.status.amber;
    if (serverState === "disabled") return colors.status.red;
    return colors.text.tertiary;
  })();

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backBtn}
          accessibilityLabel="Volver"
          hitSlop={{ top: 12, right: 12, bottom: 12, left: 12 }}
        >
          <ChevronLeft size={24} color={colors.text.primary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Notificaciones</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.brand.primary} />
        }
      >
        {/* Hero — describe el valor */}
        <View style={styles.heroCard}>
          <View style={styles.heroIconCircle}>
            {switchValue ? (
              <Bell size={28} color={colors.brand.primary} />
            ) : (
              <BellOff size={28} color={colors.text.tertiary} />
            )}
          </View>
          <Text style={styles.heroTitle}>
            {switchValue ? "Alertas activas" : "Alertas apagadas"}
          </Text>
          <Text style={styles.heroSubtitle}>
            Cuando se libere un cupo en tu lista de espera, te avisamos al
            instante para que confirmes en menos de 15 minutos.
          </Text>
        </View>

        {/* Card del Switch */}
        <View style={styles.toggleCard}>
          <View style={styles.toggleRow}>
            <View style={{ flex: 1, paddingRight: spacing.md }}>
              <Text style={styles.toggleLabel}>Alertas de cupos liberados</Text>
              <Text style={[styles.toggleHint, { color: stateColor }]}>
                {stateLabel}
              </Text>
            </View>
            {busy ? (
              <ActivityIndicator color={colors.brand.primary} />
            ) : (
              <Switch
                value={!!switchValue}
                onValueChange={handleToggle}
                disabled={!userId || serverState === "loading"}
                trackColor={{ false: "#CBD5E1", true: colors.brand.primary }}
                thumbColor={Platform.OS === "android" ? "#fff" : undefined}
                ios_backgroundColor="#CBD5E1"
                accessibilityLabel="Alternar alertas de cupos"
                testID="toggle-push-notifications"
              />
            )}
          </View>
          {updatedAt ? (
            <Text style={styles.metaText}>
              Última actualización: {new Date(updatedAt).toLocaleString("es-MX")}
            </Text>
          ) : null}
          {platformInfo ? (
            <Text style={styles.metaText}>
              Dispositivo registrado: {platformInfo.toUpperCase()}
            </Text>
          ) : null}
        </View>

        {/* Banner para casos especiales */}
        {Platform.OS !== "web" &&
          osPermission?.status === "denied" &&
          !osPermission?.canAskAgain && (
            <View style={styles.warnBanner}>
              <Text style={styles.warnTitle}>Permiso bloqueado en el sistema</Text>
              <Text style={styles.warnBody}>
                Las notificaciones están desactivadas en los ajustes de tu
                dispositivo. Para reactivarlas necesitas abrir los Ajustes del
                sistema.
              </Text>
              <TouchableOpacity
                style={styles.openSettingsBtn}
                onPress={() => Linking.openSettings()}
                accessibilityLabel="Abrir ajustes del sistema"
              >
                <SettingsIcon size={16} color="#fff" />
                <Text style={styles.openSettingsText}>Abrir Ajustes</Text>
              </TouchableOpacity>
            </View>
          )}

        {serverState === "pending_deploy" && (
          <View style={styles.infoBanner}>
            <Text style={styles.infoTitle}>Configuración casi lista</Text>
            <Text style={styles.infoBody}>
              Tu dispositivo está registrado pero el servicio de notificaciones
              aún no fue activado en este entorno. Las alertas se habilitarán
              automáticamente cuando la aplicación se despliegue en producción.
            </Text>
          </View>
        )}

        {Platform.OS === "web" && (
          <View style={styles.infoBanner}>
            <Text style={styles.infoTitle}>Web</Text>
            <Text style={styles.infoBody}>
              Las notificaciones push sólo funcionan en la app instalada
              (iOS / Android). En la versión web, las alertas llegan por
              WhatsApp y correo electrónico.
            </Text>
          </View>
        )}

        {/* Detalle de canales activos */}
        <View style={styles.channelCard}>
          <Text style={styles.channelTitle}>Otros canales siempre activos</Text>
          <ChannelRow label="WhatsApp" active />
          <ChannelRow label="Correo electrónico" active />
          <ChannelRow
            label="Push (esta app)"
            active={!!switchValue}
            dim={!switchValue}
          />
        </View>

        <Text style={styles.disclaimer}>
          Apagar las notificaciones push no afecta los recordatorios por
          WhatsApp ni email. Puedes reactivarlas en cualquier momento sin
          perder tu posición en la lista de espera.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function ChannelRow({ label, active, dim }: { label: string; active: boolean; dim?: boolean }) {
  return (
    <View style={styles.channelRow}>
      <View
        style={[
          styles.channelDot,
          { backgroundColor: active ? colors.status.green : "#CBD5E1" },
        ]}
      />
      <Text style={[styles.channelLabel, dim && { color: colors.text.tertiary }]}>
        {label}
      </Text>
      <Text
        style={[
          styles.channelStatus,
          { color: active ? colors.status.green : colors.text.tertiary },
        ]}
      >
        {active ? "Activo" : "Apagado"}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg.app },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.bg.app,
  },
  backBtn: {
    width: 40,
    height: 40,
    justifyContent: "center",
    alignItems: "flex-start",
  },
  headerTitle: {
    flex: 1,
    textAlign: "center",
    ...typography.h3,
    color: colors.text.primary,
    fontWeight: "700",
  },
  scroll: { padding: spacing.md, paddingBottom: spacing.xl },

  heroCard: {
    backgroundColor: "#fff",
    borderRadius: radii.lg,
    padding: spacing.lg,
    alignItems: "center",
    marginBottom: spacing.md,
    ...shadows.card,
  },
  heroIconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "rgba(37, 99, 235, 0.10)",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: spacing.sm,
  },
  heroTitle: {
    ...typography.h3,
    color: colors.text.primary,
    fontWeight: "800",
    marginBottom: 4,
  },
  heroSubtitle: {
    ...typography.body,
    color: colors.text.secondary,
    textAlign: "center",
    lineHeight: 20,
  },

  toggleCard: {
    backgroundColor: "#fff",
    borderRadius: radii.lg,
    padding: spacing.md,
    marginBottom: spacing.md,
    ...shadows.sm,
  },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 48,
  },
  toggleLabel: {
    ...typography.body,
    color: colors.text.primary,
    fontWeight: "700",
    marginBottom: 2,
  },
  toggleHint: { ...typography.caption, fontWeight: "600" },
  metaText: {
    ...typography.caption,
    color: colors.text.tertiary,
    marginTop: spacing.xs,
  },

  warnBanner: {
    backgroundColor: "#FEF3C7",
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: "#FDE68A",
  },
  warnTitle: {
    ...typography.body,
    fontWeight: "700",
    color: "#92400E",
    marginBottom: 4,
  },
  warnBody: { ...typography.caption, color: "#78350F", lineHeight: 18 },
  openSettingsBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#B45309",
    borderRadius: radii.md,
    paddingVertical: spacing.sm + 2,
    marginTop: spacing.sm,
    gap: 6,
    minHeight: 44,
  },
  openSettingsText: { color: "#fff", fontWeight: "700" },

  infoBanner: {
    backgroundColor: "#EFF6FF",
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: "#BFDBFE",
  },
  infoTitle: {
    ...typography.body,
    fontWeight: "700",
    color: "#1E40AF",
    marginBottom: 4,
  },
  infoBody: { ...typography.caption, color: "#1E3A8A", lineHeight: 18 },

  channelCard: {
    backgroundColor: "#fff",
    borderRadius: radii.lg,
    padding: spacing.md,
    marginBottom: spacing.md,
    ...shadows.card,
  },
  channelTitle: {
    ...typography.body,
    fontWeight: "700",
    color: colors.text.primary,
    marginBottom: spacing.sm,
  },
  channelRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
  },
  channelDot: { width: 8, height: 8, borderRadius: 4, marginRight: 10 },
  channelLabel: { ...typography.body, color: colors.text.primary, flex: 1 },
  channelStatus: { ...typography.caption, fontWeight: "600" },

  disclaimer: {
    ...typography.caption,
    color: colors.text.tertiary,
    textAlign: "center",
    paddingHorizontal: spacing.md,
    lineHeight: 16,
  },
});
