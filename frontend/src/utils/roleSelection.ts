/**
 * Auditoría Routing — Bifurcación inteligente (Hub Organizador/Jugador).
 *
 * Persiste y consulta el rol elegido por el usuario tras el login para
 * implementar el "salto inteligente" definido por el spec:
 *
 *   • Si un usuario es estrictamente jugador (no tiene retas/clubes como
 *     organizador), saltamos el Hub y vamos directo a `/` (Radar).
 *   • Si tiene rol dual y ya eligió un ambiente antes, en próximos logins
 *     auto-redirige a ese ambiente sin pasar por el Hub (1 clic menos).
 *   • Si tiene rol dual y NO ha elegido, mostramos el Hub.
 *
 * El usuario siempre puede tocar "Cambiar ambiente" en cualquier header
 * para volver al Hub y elegir el otro rol.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

export type AppRole = "admin" | "player";

const LAST_ROLE_KEY = "padelappretas.last_role";

/** Devuelve el último rol elegido por el usuario, o null si nunca eligió. */
export async function getLastRole(): Promise<AppRole | null> {
  try {
    const v = await AsyncStorage.getItem(LAST_ROLE_KEY);
    if (v === "admin" || v === "player") return v;
    return null;
  } catch {
    return null;
  }
}

/** Persiste el rol elegido (llamar desde los CTAs del Hub). */
export async function setLastRole(role: AppRole): Promise<void> {
  try {
    await AsyncStorage.setItem(LAST_ROLE_KEY, role);
  } catch {
    /* no-op — preferimos seguir aunque storage falle. */
  }
}

/** Limpia la preferencia (forzar paso por el Hub la próxima vez). */
export async function clearLastRole(): Promise<void> {
  try {
    await AsyncStorage.removeItem(LAST_ROLE_KEY);
  } catch {
    /* no-op */
  }
}

export type Roles = {
  is_player: boolean;
  is_organizer: boolean;
  is_super_admin: boolean;
};

/**
 * Decide la siguiente ruta tras un login exitoso, según roles del backend
 * y preferencia previamente guardada (last_role).
 *
 * Reglas:
 *   • Si NO es organizador → siempre `/` (Radar).
 *   • Si es organizador y last_role === "admin" → `/admin`.
 *   • Si es organizador y last_role === "player" → `/`.
 *   • Si es organizador y last_role === null → `/seleccion`.
 */
export function decideNextRoute(
  roles: Pick<Roles, "is_organizer">,
  lastRole: AppRole | null,
): "/admin" | "/" | "/seleccion" {
  if (!roles.is_organizer) return "/";
  if (lastRole === "admin") return "/admin";
  if (lastRole === "player") return "/";
  return "/seleccion";
}
