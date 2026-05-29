/**
 * useOfflineQueue — Fase C (Matriz de Blindaje).
 *
 * Cola persistente de acciones admin que deben ejecutarse en backend pero
 * pueden fallar por red intermitente. La cola sobrevive cierres de app
 * (AsyncStorage) y reintenta automáticamente cuando la red vuelve.
 *
 * Acciones soportadas (cada una se valida server-side al replay):
 *   - patchInscripcionInline(insc_id, body)
 *   - confirmarInscripcionManual(insc_id, nota?)
 *   - marcarAlertaLeida(alerta_id)
 *
 * Detección de red:
 *   - Web: `navigator.onLine` + eventos `online`/`offline`.
 *   - Mobile: poll best-effort cada 15s o trigger por AppState change.
 *     (Nota: para production, integrar @react-native-community/netinfo;
 *     por ahora usamos un fetch HEAD al backend como ping.)
 *
 * UX:
 *   - El badge `pendientes` se muestra en el admin header.
 *   - Toast "Sincronizado N cambios" cuando la cola se vacía exitosamente.
 *   - Errores 4xx del backend NO se reintentan (son válidos: data inválida).
 *   - Errores 5xx o de red SÍ se reintentan, hasta `MAX_ATTEMPTS`.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { api } from "@/src/api";

const STORAGE_KEY = "padelapp.offline_queue.v1";
const MAX_ATTEMPTS = 5;
// Endpoint barato del backend para ping de conectividad.
// Usamos `/api/` (root del API) que devuelve 200 sin tocar BD.
const PING_URL = (process.env.EXPO_BACKEND_URL || "") + "/api/";

export type QueueOp =
  | {
      kind: "patchInscripcionInline";
      payload: { inscId: string; body: { nombre?: string; telefono?: string; cancha_asignada?: number } };
    }
  | {
      kind: "confirmarInscripcionManual";
      payload: { inscId: string; nota?: string };
    }
  | {
      kind: "marcarAlertaLeida";
      payload: { alertaId: string };
    };

export type QueueItem = {
  id: string;
  op: QueueOp;
  /** Cuántos retries se han intentado (incluye el fallido original). */
  attempts: number;
  /** ISO timestamp. */
  enqueuedAt: string;
  /** Mensaje del último error si aplica. */
  lastError?: string;
};

// ============================================================================
// Storage helpers — JSON serializado manualmente (storage util no acepta arrays)
// ============================================================================
async function loadQueue(): Promise<QueueItem[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function saveQueue(items: QueueItem[]): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // Si AsyncStorage está lleno o falla, no podemos hacer mucho.
  }
}

// ============================================================================
// Ejecutor: traduce QueueOp → llamada api real
// ============================================================================
async function executeOp(op: QueueOp): Promise<void> {
  switch (op.kind) {
    case "patchInscripcionInline":
      await api.patchInscripcionInline(op.payload.inscId, op.payload.body);
      return;
    case "confirmarInscripcionManual":
      await api.confirmarInscripcionManual(op.payload.inscId, op.payload.nota);
      return;
    case "marcarAlertaLeida":
      await api.marcarAlertaLeida(op.payload.alertaId);
      return;
  }
}

/** Detecta si un error es "client-side" (4xx) y por tanto NO reintenta. */
function isClientError(e: any): boolean {
  const status = e?.status ?? e?.body?.status;
  return typeof status === "number" && status >= 400 && status < 500;
}

// ============================================================================
// Hook principal
// ============================================================================
export function useOfflineQueue() {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [online, setOnline] = useState<boolean>(true);
  const [syncing, setSyncing] = useState(false);
  const itemsRef = useRef<QueueItem[]>([]);

  // Mantener ref sincronizado para usar en callbacks sin recrearlos
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  // ===== Cargar cola al montar =====
  useEffect(() => {
    let alive = true;
    void loadQueue().then((q) => {
      if (alive) setItems(q);
    });
    return () => {
      alive = false;
    };
  }, []);

  // ===== Detectar online/offline =====
  useEffect(() => {
    if (Platform.OS === "web" && typeof window !== "undefined") {
      const onOnline = () => setOnline(true);
      const onOffline = () => setOnline(false);
      // Estado inicial
      setOnline(typeof navigator !== "undefined" ? navigator.onLine !== false : true);
      window.addEventListener("online", onOnline);
      window.addEventListener("offline", onOffline);
      return () => {
        window.removeEventListener("online", onOnline);
        window.removeEventListener("offline", onOffline);
      };
    }
    // Mobile: ping cada 20s + reaccionar a AppState
    let pingTimer: ReturnType<typeof setInterval> | null = null;
    const ping = async () => {
      try {
        const res = await fetch(PING_URL, { method: "HEAD" });
        setOnline(res.ok);
      } catch {
        setOnline(false);
      }
    };
    void ping();
    pingTimer = setInterval(ping, 20000);
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active") void ping();
    });
    return () => {
      if (pingTimer) clearInterval(pingTimer);
      sub.remove();
    };
  }, []);

  // ===== Encolar acción =====
  const enqueue = useCallback(async (op: QueueOp): Promise<QueueItem> => {
    const item: QueueItem = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      op,
      attempts: 0,
      enqueuedAt: new Date().toISOString(),
    };
    const updated = [...itemsRef.current, item];
    setItems(updated);
    await saveQueue(updated);
    return item;
  }, []);

  // ===== Procesar cola (drain) =====
  const flush = useCallback(async (): Promise<{ ok: number; fail: number }> => {
    if (syncing) return { ok: 0, fail: 0 };
    setSyncing(true);
    let ok = 0;
    let fail = 0;
    try {
      const snapshot = [...itemsRef.current];
      const remaining: QueueItem[] = [];
      for (const it of snapshot) {
        try {
          await executeOp(it.op);
          ok += 1;
          // No lo agregamos a remaining: queda eliminado.
        } catch (e: any) {
          if (isClientError(e)) {
            // 4xx — descartamos (el servidor dice que no es válido).
            fail += 1;
          } else {
            // 5xx / red — incrementamos attempts y reencolamos si <MAX_ATTEMPTS.
            const attempts = it.attempts + 1;
            if (attempts < MAX_ATTEMPTS) {
              remaining.push({
                ...it,
                attempts,
                lastError: e?.message || String(e),
              });
            } else {
              fail += 1;
            }
          }
        }
      }
      setItems(remaining);
      await saveQueue(remaining);
    } finally {
      setSyncing(false);
    }
    return { ok, fail };
  }, [syncing]);

  // ===== Auto-flush cuando volvemos online =====
  const prevOnline = useRef(online);
  useEffect(() => {
    if (!prevOnline.current && online && itemsRef.current.length > 0) {
      void flush();
    }
    prevOnline.current = online;
  }, [online, flush]);

  return {
    items,
    online,
    syncing,
    pendientes: items.length,
    enqueue,
    flush,
  };
}
