/**
 * usePushRegistration — Hook que orquesta el registro de Push tokens vía
 * Emergent (SuprSend relay).
 *
 * Por diseño NUNCA es invasivo: si el usuario NO concede el permiso, el
 * resto de la app sigue funcionando con WhatsApp + email como canales
 * primarios. El push es "alta prioridad + opcional".
 *
 * UX contextual (Opción B confirmada por el usuario):
 *   - NO pedimos permisos al primer arranque.
 *   - Disparamos `requestAndRegister()` cuando el jugador se inscribe a
 *     una lista de espera por primera vez (mayor intent + conversión).
 *   - Estado se persiste en AsyncStorage para no repetir el prompt si
 *     ya fue concedido / denegado / no preguntar otra vez.
 *
 * Plataformas:
 *   - iOS / Android nativo: full flow.
 *   - Web: no-op (expo-notifications no soporta web push de este modo).
 *
 * Idempotencia: re-registrar la misma combinación (user_id + device_token)
 * es seguro — el backend hace upsert.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";

import { api } from "@/src/api";

const LAST_PROMPT_KEY = "padelappretas.push.lastPromptAt";
const PROMPT_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000; // 1 semana

export type PushStatus =
  | "unknown"
  | "unsupported"     // web o emulador sin Google Play Services
  | "denied"
  | "granted"
  | "granted_no_token"
  | "registered"
  | "failed";

export type PushRegistrationResult = {
  status: PushStatus;
  message?: string;
  device_token?: string;
};

export function usePushRegistration(opts: { user_id?: string | null }) {
  const { user_id } = opts;
  const [status, setStatus] = useState<PushStatus>("unknown");
  const [busy, setBusy] = useState(false);
  const inFlightRef = useRef(false);

  /**
   * Solicita permisos (si aún no se decidió), obtiene el device_token
   * nativo (NUNCA expo push token — el playbook lo prohíbe explícitamente)
   * y lo registra en el backend.
   *
   * Retorna el resultado para que el caller pueda mostrar feedback.
   */
  const requestAndRegister = useCallback(async (): Promise<PushRegistrationResult> => {
    // Guards de plataforma.
    if (Platform.OS === "web") {
      setStatus("unsupported");
      return { status: "unsupported", message: "Web no soporta push." };
    }
    if (!Device.isDevice) {
      setStatus("unsupported");
      return { status: "unsupported", message: "Push sólo funciona en dispositivos reales." };
    }
    if (!user_id) {
      return { status: "failed", message: "Sin user_id no podemos registrar el token." };
    }
    if (inFlightRef.current) {
      return { status, message: "Registro en curso" };
    }
    inFlightRef.current = true;
    setBusy(true);
    try {
      // 1) Permisos.
      const existing = await Notifications.getPermissionsAsync();
      let finalStatus = existing.status;
      if (existing.status !== "granted") {
        // Marcamos timestamp del prompt ANTES de pedir, para respetar el
        // cooldown incluso si el usuario lo deniega.
        await AsyncStorage.setItem(LAST_PROMPT_KEY, String(Date.now()));
        const req = await Notifications.requestPermissionsAsync();
        finalStatus = req.status;
      }
      if (finalStatus !== "granted") {
        setStatus("denied");
        return { status: "denied", message: "Permiso de notificaciones denegado." };
      }

      // 2) Token NATIVO (FCM en Android, APNs en iOS). NO Expo token.
      let device_token: string | undefined;
      try {
        const tk = await Notifications.getDevicePushTokenAsync();
        device_token = tk?.data;
      } catch (e: any) {
        // En Expo Go sin proyecto / sin google-services.json esto falla.
        // Es esperado en desarrollo. Mark granted_no_token para que el caller
        // sepa que el permiso está OK pero falta el archivo de producción.
        setStatus("granted_no_token");
        return {
          status: "granted_no_token",
          message:
            "Permiso concedido pero aún no se generó el token nativo. " +
            "Funcionará en build de producción.",
        };
      }
      if (!device_token) {
        setStatus("granted_no_token");
        return { status: "granted_no_token" };
      }

      // 3) Registrar en backend (Emergent relay).
      try {
        await api.post("/register-push", {
          user_id,
          platform: Platform.OS,
          device_token,
        });
        setStatus("registered");
        return { status: "registered", device_token };
      } catch (e: any) {
        // Backend respondió 4xx/5xx. Loggeamos pero NO bloqueamos UX.
        setStatus("failed");
        return {
          status: "failed",
          message: e?.message || "No se pudo registrar el token.",
          device_token,
        };
      }
    } finally {
      inFlightRef.current = false;
      setBusy(false);
    }
  }, [user_id, status]);

  /**
   * Re-registra silenciosamente en cada app-open si ya hubo permiso previo.
   * Los tokens rotan eventualmente; este patrón los mantiene frescos.
   */
  const silentRefreshIfGranted = useCallback(async () => {
    if (Platform.OS === "web" || !Device.isDevice || !user_id) return;
    try {
      const existing = await Notifications.getPermissionsAsync();
      if (existing.status !== "granted") return;
      const tk = await Notifications.getDevicePushTokenAsync();
      if (!tk?.data) return;
      await api.post("/register-push", {
        user_id,
        platform: Platform.OS,
        device_token: tk.data,
      });
      setStatus("registered");
    } catch {
      /* fail-soft */
    }
  }, [user_id]);

  // Refresh silencioso al montar (post-login) — sin pedir permisos nuevos.
  useEffect(() => {
    if (!user_id) return;
    void silentRefreshIfGranted();
  }, [user_id, silentRefreshIfGranted]);

  /**
   * Helper: ¿debo mostrar el prompt contextual ahora?
   * Verdad si:
   *   - Estamos en plataforma nativa
   *   - El permiso está en `undetermined` (jamás preguntado)
   *   - O está denegado pero pasó el cooldown (1 semana)
   */
  const shouldPromptNow = useCallback(async (): Promise<boolean> => {
    if (Platform.OS === "web" || !Device.isDevice) return false;
    const existing = await Notifications.getPermissionsAsync();
    if (existing.status === "granted") return false;
    if (existing.status === "undetermined") return true;
    // denied + canAskAgain false → no insistir, el usuario debe ir a Settings.
    if (!existing.canAskAgain) return false;
    // canAskAgain true + cooldown.
    const last = await AsyncStorage.getItem(LAST_PROMPT_KEY);
    if (!last) return true;
    return Date.now() - Number(last) > PROMPT_COOLDOWN_MS;
  }, []);

  return {
    status,
    busy,
    requestAndRegister,
    silentRefreshIfGranted,
    shouldPromptNow,
  };
}
