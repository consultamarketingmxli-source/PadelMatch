/**
 * playerInfo — Helper centralizado para leer/escribir info del jugador logueado.
 *
 * Antes vivía duplicado como `PLAYER_INFO_KEY` en 3+ archivos. Centralizar
 * evita typos y facilita migraciones.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

export const PLAYER_INFO_KEY = "padelappretas.player.info";

export type PlayerInfo = {
  jugador_id: string;
  nombre?: string;
  telefono?: string;
};

export async function getPlayerInfo(): Promise<PlayerInfo | null> {
  try {
    const raw = await AsyncStorage.getItem(PLAYER_INFO_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as PlayerInfo;
    if (!v?.jugador_id) return null;
    return v;
  } catch {
    return null;
  }
}

export async function clearPlayerInfo(): Promise<void> {
  try {
    await AsyncStorage.removeItem(PLAYER_INFO_KEY);
  } catch {
    /* swallow */
  }
}
