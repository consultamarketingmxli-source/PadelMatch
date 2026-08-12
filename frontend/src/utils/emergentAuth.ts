/**
 * emergentAuth.ts — Cliente para Emergent-managed Google Auth (Iter56).
 *
 * Flujo (cross-platform: iOS / Android / Expo Go / Web):
 *
 *   1. Usuario tapea "Continuar con Google" → `signInWithGoogle()`.
 *   2. Calculamos `redirectUrl` según plataforma:
 *        • Mobile: `Linking.createURL('')` → `padelappretas://` o `exp://...`
 *        • Web:    `window.location.origin + '/'`
 *   3. Abrimos `https://auth.emergentagent.com/?redirect=<encodedRedirect>`:
 *        • Mobile: `WebBrowser.openAuthSessionAsync(url, redirectUrl)`
 *        • Web:    `window.location.href = url`
 *   4. Emergent hace OAuth con Google y redirige al `redirectUrl` con
 *      `#session_id=<xyz>` en el HASH FRAGMENT (nunca query params).
 *   5. Extraemos `session_id` con regex sobre el URL crudo (Linking.parse
 *      NO lee el hash — es un bug documentado).
 *   6. POST /api/auth/session con `{session_id}` → backend intercambia con
 *      Emergent, upserta usuario, emite JWT + refresh token.
 *   7. Guardamos JWT en el mismo store que usa el login OTP legacy
 *      (`playerTokenStore.set(access_token)`) para máxima compat.
 *
 * Reglas críticas del playbook:
 *   • Guard contra session_id duplicado (Android: WebBrowser + Linking
 *     listener disparan ambos para el mismo deep link).
 *   • NUNCA llamar directamente al backend de Emergent desde el cliente.
 *   • `WebBrowser.openAuthSessionAsync` en WEB abre popup que pierde el
 *     redirect — usamos redirect directo en web.
 *   • En Android, `result.url` a menudo es undefined pero el Linking
 *     listener sí captura la URL → siempre registramos el listener.
 */
import { Platform } from "react-native";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { api, setRefreshToken } from "@/src/api";
import { playerTokenStore } from "@/src/utils/playerTokenStore";

const EMERGENT_AUTH_URL = "https://auth.emergentagent.com/?redirect=";
const PLAYER_INFO_KEY = "padelappretas.player.info";

// Ejecutamos maybeCompleteAuthSession en module scope como recomienda Expo.
WebBrowser.maybeCompleteAuthSession();

// Guard sync contra reenvío del mismo session_id (Android emite el deep link
// desde WebBrowser + Linking listener al mismo tiempo).
const _processedSessionIds = new Set<string>();

export type EmergentAuthResult =
  | {
      status: "ok";
      access_token: string;
      user: {
        user_id: string;
        email: string | null;
        nombre: string;
        telefono: string | null;
        picture: string | null;
        preferred_side: string | null;
        skill_level: string | null;
        profile_completed: boolean;
      };
    }
  | { status: "cancelled" }
  | { status: "error"; message: string };

/**
 * Extrae `session_id` de un URL de callback (hash O query).
 * Usa regex sobre el string crudo porque Linking.parse().queryParams
 * NO lee el fragmento hash (limitación conocida).
 */
export function extractSessionId(url: string | null | undefined): string | null {
  if (!url || typeof url !== "string") return null;
  const m = url.match(/[?#&]session_id=([^&#\s]+)/i);
  return m ? decodeURIComponent(m[1]) : null;
}

/**
 * Determina el `redirect_url` correcto según plataforma.
 *  - Mobile: exp://... (Expo Go) o padelappretas:// (native build)
 *  - Web:    origin actual con path raíz
 */
function computeRedirectUrl(): string {
  if (Platform.OS === "web" && typeof window !== "undefined") {
    return window.location.origin + "/";
  }
  // Linking.createURL('') genera la URL base correcta para dev/prod.
  return Linking.createURL("");
}

/**
 * Intercambia `session_id` con el backend y persiste el JWT.
 * Idempotente: bloquea el mismo session_id contra reenvíos.
 */
export async function exchangeSessionIdForJwt(
  sessionId: string,
): Promise<EmergentAuthResult> {
  if (_processedSessionIds.has(sessionId)) {
    return { status: "error", message: "session_id ya procesado" };
  }
  _processedSessionIds.add(sessionId);

  try {
    const r = await api.emergentExchangeSession(sessionId);
    // Persistimos JWT + refresh + info del usuario en los MISMOS stores que
    // usa el flujo OTP legacy — así el resto de la app funciona sin cambios.
    await playerTokenStore.set(r.access_token);
    if (r.refresh_token) {
      await setRefreshToken(r.refresh_token);
    }
    await AsyncStorage.setItem(
      PLAYER_INFO_KEY,
      JSON.stringify({
        jugador_id: r.user.user_id,
        nombre: r.user.nombre,
        telefono: r.user.telefono ?? "",
        email: r.user.email,
      }),
    );
    return { status: "ok", access_token: r.access_token, user: r.user };
  } catch (e: unknown) {
    return {
      status: "error",
      message: (e as { message?: string })?.message ?? "Error de autenticación",
    };
  }
}

/**
 * Inicia el flujo Google Sign-In con Emergent-managed OAuth.
 *
 * En MOBILE:
 *   - Abre WebBrowser con listener sobre Linking para capturar el deep link.
 *   - Intenta 3 fuentes para el callback URL: result.url → linking listener
 *     → getInitialURL(). En Android el resultado suele venir por listener.
 *
 * En WEB:
 *   - Redirige directamente a Emergent con window.location.href.
 *   - El callback lo maneja `handleWebCallbackOnMount()` en el layout raíz.
 *
 * @returns Un `EmergentAuthResult` (ok / cancelled / error).
 */
export async function signInWithGoogle(): Promise<EmergentAuthResult> {
  const redirectUrl = computeRedirectUrl();
  const authUrl = `${EMERGENT_AUTH_URL}${encodeURIComponent(redirectUrl)}`;

  if (Platform.OS === "web") {
    // Web: redirección directa. El callback se procesa en el mount del layout.
    if (typeof window !== "undefined") {
      window.location.href = authUrl;
    }
    // Nunca retornamos porque el flujo continúa en otra página.
    return { status: "cancelled" };
  }

  // Mobile: WebBrowser + escucha de Linking en paralelo.
  let listenerUrl: string | null = null;
  const sub = Linking.addEventListener("url", (evt) => {
    if (evt?.url) listenerUrl = evt.url;
  });

  try {
    const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUrl);

    // Prioridad de fuentes: result.url → listener → getInitialURL.
    let callbackUrl: string | null =
      (result as { url?: string })?.url ?? null;
    if (!callbackUrl) callbackUrl = listenerUrl;
    if (!callbackUrl) {
      try {
        callbackUrl = await Linking.getInitialURL();
      } catch {
        callbackUrl = null;
      }
    }

    const sessionId = extractSessionId(callbackUrl);
    if (!sessionId) {
      // No URL / no session_id — puede ser cancelación real o Android que
      // reabrió la app fresca. Tratamos como cancelación.
      if (result.type === "cancel" || result.type === "dismiss") {
        return { status: "cancelled" };
      }
      return {
        status: "error",
        message: "No se recibió session_id del proveedor.",
      };
    }

    return await exchangeSessionIdForJwt(sessionId);
  } finally {
    sub.remove();
  }
}

/**
 * Callback handler para el layout raíz en WEB.
 *
 * En web, tras el redirect, el usuario llega a `/` (o wherever redirectUrl
 * apuntaba) con `#session_id=xyz` en el URL. Este helper detecta y procesa.
 * Debe llamarse en el mount del layout raíz.
 *
 * @returns `EmergentAuthResult` si detectó session_id, o `null` si no había.
 */
export async function handleWebCallbackOnMount(): Promise<EmergentAuthResult | null> {
  if (Platform.OS !== "web" || typeof window === "undefined") return null;

  const fullUrl = window.location.href;
  const sessionId = extractSessionId(fullUrl);
  if (!sessionId) return null;

  const result = await exchangeSessionIdForJwt(sessionId);

  // Limpiar el session_id del URL SÓLO si el intercambio fue exitoso.
  if (result.status === "ok") {
    try {
      const url = new URL(window.location.href);
      // Remover del hash
      if (url.hash) {
        url.hash = url.hash.replace(/[#&]?session_id=[^&#]*/i, "");
        if (url.hash === "#") url.hash = "";
      }
      // Remover del search
      url.searchParams.delete("session_id");
      window.history.replaceState(
        window.history.state,
        "",
        url.toString(),
      );
    } catch {
      /* no-op */
    }
  }
  return result;
}
