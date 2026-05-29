/**
 * Auditoría Routing — Debounce de acciones primarias.
 *
 * Previene el doble-click clásico que duplica peticiones HTTP (e.g. aceptar
 * invitación, guardar marcador). Encapsula la lógica de loading + lock para
 * no tener que repetir try/finally en cada CTA custom.
 *
 * Ejemplo:
 *
 *   const { run, isRunning } = useDebouncedAction(async () => {
 *     await api.aceptarInvitacion(retaId);
 *   });
 *
 *   <TouchableOpacity onPress={run} disabled={isRunning}>...
 *
 * El lock se mantiene hasta que la promesa resuelve/rechaza. Adicionalmente,
 * si se llama múltiples veces dentro de `windowMs` (default 500ms), se
 * ignoran las llamadas posteriores incluso si la primera ya terminó.
 */
import { useCallback, useRef, useState } from "react";

export function useDebouncedAction<T = void>(
  fn: () => Promise<T> | T,
  opts: { windowMs?: number } = {},
) {
  const [isRunning, setIsRunning] = useState(false);
  const lastFireRef = useRef(0);
  const windowMs = opts.windowMs ?? 500;

  const run = useCallback(async () => {
    const now = Date.now();
    if (isRunning) return;
    if (now - lastFireRef.current < windowMs) return;
    lastFireRef.current = now;
    setIsRunning(true);
    try {
      await fn();
    } finally {
      setIsRunning(false);
    }
  }, [fn, isRunning, windowMs]);

  return { run, isRunning };
}
