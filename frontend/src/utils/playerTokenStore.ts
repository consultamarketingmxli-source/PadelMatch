/**
 * playerTokenStore — Almacenamiento seguro del access token de jugador.
 *
 * AUDIT FIX (DevSecOps · Comité Élite):
 *   Antes: el access JWT del player se guardaba en `AsyncStorage` plano.
 *     - Android: SharedPreferences (NO encriptado, accesible con root).
 *     - iOS: NSUserDefaults (NO encriptado, accesible en backups iCloud).
 *   Después: SecureStore en native (Keychain iOS / Keystore Android),
 *     localStorage en web (best-effort; el verdadero secreto vive en
 *     la cookie HttpOnly del refresh token).
 *
 * Esta capa es DROP-IN: misma signature de `getItem` / `setItem` / `removeItem`
 * que `AsyncStorage`, así que migrar call sites es 1-línea.
 *
 * MIGRACIÓN SILENCIOSA: la primera vez que se llama `.get()`, si encuentra
 * un token legado en AsyncStorage lo copia a SecureStore y lo borra del
 * almacenamiento plano. Esto evita exigir re-login a usuarios existentes.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { storage } from "@/src/utils/storage";

const PLAYER_TOKEN_KEY = "padelappretas.player.token";

let _migrated = false;

async function migrateOnceFromAsyncStorage(): Promise<string | null> {
  if (_migrated) return null;
  _migrated = true;
  try {
    const legacy = await AsyncStorage.getItem(PLAYER_TOKEN_KEY);
    if (legacy && legacy.length > 0) {
      await storage.secureSet(PLAYER_TOKEN_KEY, legacy);
      await AsyncStorage.removeItem(PLAYER_TOKEN_KEY);
      return legacy;
    }
  } catch {
    /* no-op: migración best-effort */
  }
  return null;
}

export const playerTokenStore = {
  /** Lee el access token del jugador. Devuelve `null` si no existe. */
  async get(): Promise<string | null> {
    const v = await storage.secureGet<string>(PLAYER_TOKEN_KEY, "");
    if (v && v.length > 0) return v;
    // Fallback: revisa AsyncStorage legado y migra si encuentra algo.
    return await migrateOnceFromAsyncStorage();
  },

  /** Guarda el access token del jugador de forma cifrada. */
  async set(token: string): Promise<void> {
    if (!token) {
      await this.remove();
      return;
    }
    await storage.secureSet(PLAYER_TOKEN_KEY, token);
    // Asegura que cualquier copia legada en AsyncStorage queda borrada.
    try {
      await AsyncStorage.removeItem(PLAYER_TOKEN_KEY);
    } catch {
      /* no-op */
    }
  },

  /** Elimina el access token (logout / 401). */
  async remove(): Promise<void> {
    await storage.secureRemove(PLAYER_TOKEN_KEY);
    try {
      await AsyncStorage.removeItem(PLAYER_TOKEN_KEY);
    } catch {
      /* no-op */
    }
  },
};

/** Re-export de la clave para compatibilidad con código legado. */
export const PLAYER_TOKEN_STORAGE_KEY = PLAYER_TOKEN_KEY;
