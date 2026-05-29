/**
 * Cola Offline para acciones admin críticas (Fase C — Matriz de Blindaje).
 *
 * Garantías:
 *  • Acciones que fallan por red o porque el dispositivo está offline NO se
 *    pierden: quedan persistidas en AsyncStorage y se reintentan al volver online.
 *  • Cada acción tiene un `clientActionId` único — el backend trata la operación
 *    como idempotente (los endpoints PATCH `/admin/inscripciones/<id>/estatus` y
 *    `/inline` son naturalmente idempotentes; `/confirmar-manual` ya tiene su propio
 *    short-circuit por estatus_pago).
 *  • Si una acción supera MAX_RETRIES intentos, queda marcada como `failed`
 *    para que el admin la revise manualmente (no se elimina silenciosamente).
 *
 * USO:
 *  ```ts
 *  await runOrQueue({
 *    kind: 'setEstatus',
 *    label: 'Mover a lista_espera',
 *    payload: { inscId, estatus: 'lista_espera' },
 *  });
 *  ```
 *
 *  El módulo decide solo si ejecuta directo o encola. Si encola, no lanza
 *  excepción — devuelve `{queued: true}`. Caller debe respetar ese contrato.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

import { api } from "@/src/api";

const STORAGE_KEY = "padelapp:adminOfflineQueue:v1";
const MAX_RETRIES = 5;

export type QueuedActionKind =
  | "setEstatus"
  | "inscripcionInline"
  | "confirmarManual";

export interface QueuedAction {
  /** UUID corto generado en el cliente para deduplicación. */
  clientActionId: string;
  kind: QueuedActionKind;
  /** Texto humano para mostrar en el banner ("Mover a Lista de espera"). */
  label: string;
  /** Payload específico del kind. */
  payload: any;
  createdAt: number;
  retryCount: number;
  lastError?: string;
  status: "pending" | "failed";
}

// ============================================================================
// Listeners (para que el banner en UI re-renderice cuando cambia la cola)
// ============================================================================
type Listener = (queue: QueuedAction[]) => void;
const listeners = new Set<Listener>();

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  // Disparar inmediato con la cola actual.
  getQueue().then(listener).catch(() => {});
  return () => {
    listeners.delete(listener);
  };
}

async function broadcast() {
  const q = await getQueue();
  listeners.forEach((l) => {
    try {
      l(q);
    } catch {
      /* no-op */
    }
  });
}

// ============================================================================
// Persistencia
// ============================================================================
export async function getQueue(): Promise<QueuedAction[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as QueuedAction[];
  } catch {
    return [];
  }
}

async function setQueue(queue: QueuedAction[]) {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
  await broadcast();
}

export async function clearQueue() {
  await AsyncStorage.removeItem(STORAGE_KEY);
  await broadcast();
}

export async function removeFailedAction(clientActionId: string) {
  const q = await getQueue();
  await setQueue(q.filter((a) => a.clientActionId !== clientActionId));
}

// ============================================================================
// Ejecutor: invoca el endpoint correspondiente
// ============================================================================
async function execute(action: QueuedAction): Promise<void> {
  if (action.kind === "setEstatus") {
    const { inscId, estatus } = action.payload;
    await api.setEstatusInscripcion(inscId, estatus);
    return;
  }
  if (action.kind === "inscripcionInline") {
    const { inscId, body } = action.payload;
    await api.patchInscripcionInline(inscId, body);
    return;
  }
  if (action.kind === "confirmarManual") {
    const { inscId, nota } = action.payload;
    await api.confirmarInscripcionManual(inscId, nota);
    return;
  }
  throw new Error(`Unknown action kind: ${(action as any).kind}`);
}

// ============================================================================
// Detección de "error de red" (vs error de negocio)
// ============================================================================
/**
 * Devuelve `true` si el error parece ser por red (offline, timeout, DNS, etc.)
 * y NO un error del servidor (4xx/5xx). Esto evita encolar acciones que el
 * backend rechazó por razones legítimas (e.g. 403 reta cerrada — Fase C).
 */
function isNetworkError(err: any): boolean {
  if (!err) return false;
  const msg = (err.message ?? String(err)).toLowerCase();
  // fetch suele lanzar: "Network request failed", "Failed to fetch", "Load failed"
  // Timeouts: "aborted", "timeout"
  if (
    msg.includes("network") ||
    msg.includes("failed to fetch") ||
    msg.includes("load failed") ||
    msg.includes("timeout") ||
    msg.includes("aborted") ||
    msg.includes("connection")
  ) {
    return true;
  }
  // Si la api lanza con un código HTTP, NO es error de red.
  // Convención de api.ts: `Error X: ...` o status en err.
  return false;
}

// ============================================================================
// API pública
// ============================================================================
function genId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export interface RunOrQueueArgs {
  kind: QueuedActionKind;
  label: string;
  payload: any;
  /**
   * Si `true`, salta el intento directo y encola siempre (útil cuando ya
   * sabemos que estamos offline antes de tocar el botón).
   */
  forceQueue?: boolean;
}

export type RunOrQueueResult =
  | { queued: false; ok: true; data: any }
  | { queued: true; ok: false; reason: "offline" | "network_error" };

/**
 * Intenta ejecutar la acción ahora. Si falla por red, la encola para reintento.
 * Si falla por error de negocio (4xx/5xx), re-lanza el error.
 */
export async function runOrQueue(args: RunOrQueueArgs): Promise<RunOrQueueResult> {
  const action: QueuedAction = {
    clientActionId: genId(),
    kind: args.kind,
    label: args.label,
    payload: args.payload,
    createdAt: Date.now(),
    retryCount: 0,
    status: "pending",
  };

  if (args.forceQueue) {
    await enqueue(action);
    return { queued: true, ok: false, reason: "offline" };
  }

  try {
    await execute(action);
    return { queued: false, ok: true, data: undefined };
  } catch (err: any) {
    if (isNetworkError(err)) {
      await enqueue(action);
      return { queued: true, ok: false, reason: "network_error" };
    }
    // Error de negocio (403, 409, etc.) → propaga.
    throw err;
  }
}

async function enqueue(action: QueuedAction) {
  const q = await getQueue();
  q.push(action);
  await setQueue(q);
}

/**
 * Reintenta todas las acciones pendientes en orden FIFO. Para cuando una
 * vuelve a fallar por red (para no martillar el server). Las que fallan por
 * error de negocio se marcan como `failed` (no se reintentan más).
 *
 * Devuelve `{ ok: n, queued: n, failed: n }`.
 */
export async function flushQueue(): Promise<{ ok: number; queued: number; failed: number }> {
  const q = await getQueue();
  if (q.length === 0) return { ok: 0, queued: 0, failed: 0 };

  let ok = 0;
  let failed = 0;
  const remaining: QueuedAction[] = [];

  for (const action of q) {
    if (action.status === "failed") {
      remaining.push(action);
      failed++;
      continue;
    }
    try {
      await execute(action);
      ok++;
      // No se añade a remaining → se elimina de la cola.
    } catch (err: any) {
      const isNet = isNetworkError(err);
      const updated: QueuedAction = {
        ...action,
        retryCount: action.retryCount + 1,
        lastError: (err?.message ?? String(err)).slice(0, 180),
      };
      if (!isNet || updated.retryCount >= MAX_RETRIES) {
        // Error de negocio o ya superó intentos → marca como fallida.
        updated.status = "failed";
        failed++;
      }
      remaining.push(updated);
      // Si el primer fallo fue por red, paramos el flush para no martillar.
      if (isNet) {
        // Empuja el resto sin tocar.
        const idx = q.indexOf(action);
        remaining.push(...q.slice(idx + 1));
        break;
      }
    }
  }

  await setQueue(remaining);
  return { ok, queued: remaining.filter((a) => a.status === "pending").length, failed };
}
