/**
 * Auditoría Routing — Fase 3: Lock síncrono por clave.
 *
 * Útil para CTAs que se renderizan en lista (un botón por fila), donde
 * `useDebouncedAction` no aplica porque cada fila tendría que tener su
 * propia instancia del hook. Aquí el lock vive en un único ref `Set<string>`
 * y se consulta sincrónicamente antes de cada disparo.
 *
 * Uso:
 *
 *   const lock = useSyncLock();
 *
 *   const saveScore = async (slotKey: string) => {
 *     if (!lock.tryAcquire(slotKey)) return;        // doble-click ignorado
 *     try {
 *       await api.upsertResultado(...);
 *     } finally {
 *       lock.release(slotKey);
 *     }
 *   };
 *
 * Diferencia clave vs `disabled={loading}`: este lock es SÍNCRONO
 * (es un Set en ref), no espera el ciclo de render de React. Cubre la
 * ventana de ~16-100ms entre el primer onPress y el repaint con disabled,
 * que es donde se cuelan los disparos duplicados clásicos.
 */
import { useCallback, useRef } from "react";

export function useSyncLock() {
  const locks = useRef<Set<string>>(new Set());

  const tryAcquire = useCallback((key: string): boolean => {
    if (locks.current.has(key)) return false;
    locks.current.add(key);
    return true;
  }, []);

  const release = useCallback((key: string) => {
    locks.current.delete(key);
  }, []);

  const isLocked = useCallback((key: string) => locks.current.has(key), []);

  return { tryAcquire, release, isLocked };
}
