/**
 * WaitlistPushPrompt — Modal contextual que aparece la primera vez que el
 * jugador se une a una lista de espera. Le ofrecemos activar push para
 * notificarle al instante cuando se libere un cupo (mayor conversión).
 *
 * UX:
 *   • Visual premium navy/azure consistente con el resto de la app.
 *   • Botón primario "Activar alertas" → dispara `requestAndRegister`.
 *   • Botón secundario "Ahora no" → cierra (reintentará en cooldown).
 *   • Si el usuario denegó con `canAskAgain=false`, mostramos un CTA para
 *     abrir Settings.
 */
import React, { useEffect, useState } from "react";
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  ActivityIndicator,
  Linking,
  Platform,
} from "react-native";
import * as Notifications from "expo-notifications";
import { usePushRegistration, type PushRegistrationResult } from "@/src/hooks/usePushRegistration";

type Props = {
  visible: boolean;
  onClose: () => void;
  /** ID del jugador logueado (jugador_id). Si null, el modal no registra. */
  user_id?: string | null;
  /** Nombre de la reta para personalizar el copy. Opcional. */
  retaName?: string;
  /** Callback tras intento de registro (éxito o no). */
  onResult?: (result: PushRegistrationResult) => void;
};

export function WaitlistPushPrompt({ visible, onClose, user_id, retaName, onResult }: Props) {
  const { requestAndRegister, busy } = usePushRegistration({ user_id });
  const [needsSettings, setNeedsSettings] = useState(false);

  // Detecta el estado al abrir el modal: si está denegado con canAskAgain=false
  // mostramos el flujo de Settings en lugar del prompt nativo.
  useEffect(() => {
    if (!visible || Platform.OS === "web") return;
    (async () => {
      try {
        const p = await Notifications.getPermissionsAsync();
        setNeedsSettings(p.status === "denied" && !p.canAskAgain);
      } catch {
        setNeedsSettings(false);
      }
    })();
  }, [visible]);

  const handleEnable = async () => {
    const result = await requestAndRegister();
    onResult?.(result);
    if (result.status === "registered" || result.status === "granted_no_token") {
      onClose();
    } else if (result.status === "denied") {
      const p = await Notifications.getPermissionsAsync().catch(() => null);
      if (p && !p.canAskAgain) {
        setNeedsSettings(true);
      } else {
        onClose();
      }
    } else {
      onClose();
    }
  };

  const handleOpenSettings = () => {
    Linking.openSettings().catch(() => undefined);
    onClose();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.card} onPress={(e) => e.stopPropagation()}>
          <View style={styles.iconCircle}>
            <Text style={styles.iconEmoji}>⚡</Text>
          </View>
          <Text style={styles.title}>Te avisamos al instante</Text>
          <Text style={styles.subtitle}>
            Activa las alertas para que te notifiquemos en segundos cuando se
            libere un cupo{retaName ? ` en ${retaName}` : ""}. Tienes 15 minutos
            para confirmar tu lugar.
          </Text>

          {needsSettings ? (
            <>
              <Text style={styles.warn}>
                Las notificaciones están bloqueadas en los ajustes del sistema.
                {"\n\n"}Ábrelas y activa “Notificaciones” para PadelAppRetas.
              </Text>
              <TouchableOpacity style={styles.primary} onPress={handleOpenSettings}>
                <Text style={styles.primaryText}>Abrir Ajustes</Text>
              </TouchableOpacity>
            </>
          ) : (
            <TouchableOpacity
              style={[styles.primary, busy && { opacity: 0.6 }]}
              onPress={handleEnable}
              disabled={busy}
              accessibilityLabel="Activar alertas de cupo"
            >
              {busy ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.primaryText}>Activar alertas</Text>
              )}
            </TouchableOpacity>
          )}
          <TouchableOpacity style={styles.secondary} onPress={onClose}>
            <Text style={styles.secondaryText}>Ahora no</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.55)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  card: {
    width: "100%",
    maxWidth: 380,
    backgroundColor: "#FFFFFF",
    borderRadius: 22,
    padding: 24,
    alignItems: "center",
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "rgba(37, 99, 235, 0.10)",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 16,
  },
  iconEmoji: { fontSize: 30 },
  title: {
    fontSize: 20,
    fontWeight: "800",
    color: "#0F172A",
    marginBottom: 8,
    textAlign: "center",
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: 14,
    color: "#475569",
    lineHeight: 20,
    textAlign: "center",
    marginBottom: 20,
  },
  warn: {
    fontSize: 13,
    color: "#92400E",
    backgroundColor: "#FEF3C7",
    borderRadius: 10,
    padding: 12,
    textAlign: "center",
    marginBottom: 16,
  },
  primary: {
    width: "100%",
    backgroundColor: "#2563EB",
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
    marginBottom: 8,
    minHeight: 48,
    justifyContent: "center",
  },
  primaryText: { color: "#FFFFFF", fontSize: 15, fontWeight: "700" },
  secondary: {
    width: "100%",
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
    minHeight: 44,
    justifyContent: "center",
  },
  secondaryText: { color: "#64748B", fontSize: 14, fontWeight: "600" },
});
