/**
 * deepLinkStore — persistencia ligera de la última ruta destino
 * solicitada por un deep-link (Universal/App Link o esquema custom).
 *
 * Caso de uso CRÍTICO: el jugador toca un link de WhatsApp
 * (https://padelappretas.app/retas/<slug>) ANTES de loguearse. El handler
 * captura el path, lo persiste aquí, y el `/login` lo lee tras OTP exitoso
 * para hacer `router.replace(pendingPath)`.
 *
 * Persistencia: AsyncStorage (no SecureStore — no es información sensible y
 * queremos que sobreviva a hot-reload pero NO a re-instalación de la app).
 *
 * Expiración: 30 minutos. Si el usuario tardó más, el contexto seguramente
 * cambió (cupón caducado, reta llena, etc.) — lo descartamos.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "padelappretas.pendingDeepLink";
const TTL_MS = 30 * 60 * 1000; // 30 min

type StoredLink = {
  path: string;       // ruta relativa (ej. "/retas/abc?inscripcion=xyz")
  ts: number;         // timestamp ms
};

export const deepLinkStore = {
  /** Guarda la ruta pendiente. Si ya había una, la sobreescribe. */
  async set(path: string): Promise<void> {
    if (!path || typeof path !== "string") return;
    const v: StoredLink = { path, ts: Date.now() };
    try {
      await AsyncStorage.setItem(KEY, JSON.stringify(v));
    } catch {
      /* swallow — no es crítico */
    }
  },

  /** Lee + descarta la ruta pendiente. Retorna null si está expirada o ausente. */
  async consume(): Promise<string | null> {
    let raw: string | null = null;
    try {
      raw = await AsyncStorage.getItem(KEY);
    } catch {
      return null;
    }
    if (!raw) return null;
    try {
      const v = JSON.parse(raw) as StoredLink;
      // Limpiamos siempre tras leer (one-shot).
      await AsyncStorage.removeItem(KEY);
      if (!v?.path || Date.now() - v.ts > TTL_MS) return null;
      return v.path;
    } catch {
      await AsyncStorage.removeItem(KEY);
      return null;
    }
  },

  /** Limpieza explícita (logout, etc.). */
  async clear(): Promise<void> {
    try {
      await AsyncStorage.removeItem(KEY);
    } catch {
      /* swallow */
    }
  },
};

/**
 * Parsea una URL entrante (universal link o esquema custom) y retorna la
 * ruta interna `/retas/<slug>` si corresponde, o null si no la podemos manejar.
 *
 * Soporta:
 *   - https://padelappretas.app/retas/<slug>?inscripcion=<id>
 *   - https://www.padelappretas.app/retas/<slug>
 *   - padelappretas://retas/<slug>
 */
export function parseDeepLink(url: string): string | null {
  if (!url) return null;
  try {
    // Normaliza esquemas custom: padelappretas://retas/x  =>  /retas/x
    if (url.startsWith("padelappretas://")) {
      const rest = url.slice("padelappretas://".length);
      // rest = "retas/<slug>?inscripcion=..."
      return rest.startsWith("/") ? rest : `/${rest}`;
    }
    const u = new URL(url);
    const okHost =
      u.hostname === "padelappretas.app" ||
      u.hostname === "www.padelappretas.app";
    if (!okHost) return null;
    if (!u.pathname.startsWith("/retas/")) return null;
    // Mantenemos query (inscripcion, pago, etc.) para que el detalle lo lea.
    return `${u.pathname}${u.search}`;
  } catch {
    return null;
  }
}
