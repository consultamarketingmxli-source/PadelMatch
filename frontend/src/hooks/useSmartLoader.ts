/**
 * useSmartLoader — Lógica condicional de loaders.
 *
 * Reglas (brief Lead Arquitectura FE):
 *   - Si `loading` se resuelve en < 300ms      → NO mostrar nada (UI fluida).
 *   - Si `loading` está entre 300–800ms        → mostrar SKELETON.
 *   - Si `loading` supera 800ms                → mostrar LOADER crítico (pelota).
 *
 * El hook devuelve flags reactivos `{showSkeleton, showCriticalLoader}`.
 * Si `loading` se vuelve `false` antes de los 300ms, ningún flag se
 * activó jamás → transición instantánea al contenido.
 */
import { useEffect, useRef, useState } from "react";

const DEBOUNCE_MS = 300;
const CRITICAL_MS = 800;

export type SmartLoaderState = {
  showSkeleton: boolean;
  showCriticalLoader: boolean;
};

export function useSmartLoader(loading: boolean): SmartLoaderState {
  const [showSkeleton, setShowSkeleton] = useState(false);
  const [showCriticalLoader, setShowCriticalLoader] = useState(false);

  // Timers id refs para limpiar entre toggles.
  const skeletonTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const criticalTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (loading) {
      // Arrancamos los dos timers. Si loading termina antes, los limpiamos.
      skeletonTimer.current = setTimeout(() => {
        setShowSkeleton(true);
      }, DEBOUNCE_MS);
      criticalTimer.current = setTimeout(() => {
        setShowCriticalLoader(true);
        setShowSkeleton(false); // promueve a crítico
      }, CRITICAL_MS);
    } else {
      // Cancelamos timers + reseteamos flags.
      if (skeletonTimer.current) clearTimeout(skeletonTimer.current);
      if (criticalTimer.current) clearTimeout(criticalTimer.current);
      setShowSkeleton(false);
      setShowCriticalLoader(false);
    }
    return () => {
      if (skeletonTimer.current) clearTimeout(skeletonTimer.current);
      if (criticalTimer.current) clearTimeout(criticalTimer.current);
    };
  }, [loading]);

  return { showSkeleton, showCriticalLoader };
}
