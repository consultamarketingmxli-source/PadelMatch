/**
 * attendance.ts — Filtro anti-flake de asistencia.
 *
 * Función PURA `evaluateAttendanceRate(user)` con salvaguardas estrictas:
 *   - Si partidos_confirmados es 0, null o undefined → retorna 100 (nuevos usuarios pasan).
 *   - Si partidos_asistidos es null/undefined → retorna 0.
 *   - Previene división por cero, NaN, Infinity y casts de string.
 *
 * Helper `meetsAttendanceFilter(user, threshold)` para la lógica de admisión a retas.
 */

/** Subset del perfil de usuario requerido por la lógica de asistencia. */
export type AttendanceProfile = {
  partidos_confirmados?: number | null;
  partidos_asistidos?: number | null;
};

/**
 * Calcula el porcentaje de asistencia [0..100].
 * Defensivo contra inputs inválidos (null, undefined, strings, negativos).
 *
 * Ejemplos:
 *   evaluateAttendanceRate({})                                          → 100  (usuario nuevo)
 *   evaluateAttendanceRate({ partidos_confirmados: 0 })                 → 100  (sin historial)
 *   evaluateAttendanceRate({ partidos_confirmados: 10, partidos_asistidos: 9 })  → 90
 *   evaluateAttendanceRate({ partidos_confirmados: 5, partidos_asistidos: 5 })   → 100
 *   evaluateAttendanceRate({ partidos_confirmados: 10, partidos_asistidos: 0 })  → 0
 *   evaluateAttendanceRate({ partidos_confirmados: -5 })                → 100  (input inválido)
 */
export function evaluateAttendanceRate(user: AttendanceProfile | null | undefined): number {
  if (!user || typeof user !== "object") return 100;

  const confirmados = Number(user.partidos_confirmados);
  const asistidos = Number(user.partidos_asistidos);

  // Salvaguarda: nuevos usuarios o datos faltantes → pasan el filtro.
  if (!Number.isFinite(confirmados) || confirmados <= 0) return 100;
  if (!Number.isFinite(asistidos) || asistidos < 0) return 0;

  // Clamp: asistidos no puede exceder confirmados (datos corruptos).
  const safeAsistidos = Math.min(asistidos, confirmados);

  const rate = (safeAsistidos / confirmados) * 100;

  // Final defensive clamp [0..100] y redondeo a 1 decimal.
  return Math.max(0, Math.min(100, Math.round(rate * 10) / 10));
}

/**
 * Verifica si el usuario cumple con el filtro de asistencia mínimo.
 * Usado por los organizadores cuando activan el toggle "+90% asistencia".
 *
 * @param user Perfil con partidos_confirmados y partidos_asistidos.
 * @param thresholdPercent Umbral mínimo de asistencia (default 90%).
 * @returns true si el usuario puede inscribirse, false si está bloqueado.
 */
export function meetsAttendanceFilter(
  user: AttendanceProfile | null | undefined,
  thresholdPercent: number = 90,
): boolean {
  const rate = evaluateAttendanceRate(user);
  const safeThreshold = Math.max(0, Math.min(100, Number(thresholdPercent) || 90));
  return rate >= safeThreshold;
}

/**
 * Mensaje legible para mostrar al usuario cuando NO cumple el filtro.
 * Útil para toasts/alerts: "No puedes inscribirte: 75% asistencia (mínimo 90%)".
 */
export function attendanceBlockedMessage(
  user: AttendanceProfile | null | undefined,
  thresholdPercent: number = 90,
): string {
  const rate = evaluateAttendanceRate(user);
  return `No puedes inscribirte: ${rate}% asistencia (mínimo ${thresholdPercent}%). El organizador activó el filtro Anti-Flake para garantizar que todos los jugadores se presenten.`;
}
