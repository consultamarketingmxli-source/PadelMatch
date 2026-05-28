/**
 * useRetaRealtime — Hook que mantiene una conexión WebSocket viva al canal
 * `/api/ws/retas/{retaId}` y dispara `onUpdate()` cada vez que el servidor
 * emite `{type: "standings_updated"}`.
 *
 * Características:
 *   - Reconexión automática con backoff exponencial (1s → 2s → 4s → 8s, máx 15s).
 *   - Maneja cierre limpio al desmontar.
 *   - Maneja foco/blur (no esencial: el browser pausa WS al hibernar
 *     y reconectamos al volver).
 *   - Ping cada 30s al servidor para mantener conexión NAT-friendly.
 *   - Expone `status: "connecting" | "open" | "closed" | "error"`.
 *
 * Uso:
 *   const { status } = useRetaRealtime(retaId, token, {
 *     onUpdate: () => refetch(),
 *     enabled: !!token,
 *   });
 */
import { useEffect, useRef, useState } from "react";
import { AppState } from "react-native";

import { api } from "@/src/api";

export type RealtimeStatus = "idle" | "connecting" | "open" | "closed" | "error";

export type RealtimeMessage =
  | { type: "hello"; reta_id: string; role: string; ts: string }
  | { type: "standings_updated"; reta_id: string; event?: string; ts: string }
  | { type: "ping" | "pong"; ts: string };

type Options = {
  /** Si false, no abre la conexión (útil para gating por auth pendiente). */
  enabled?: boolean;
  /** Callback cuando llega un standings_updated. */
  onUpdate?: (msg: RealtimeMessage) => void;
  /** Callback genérico para cualquier mensaje (debug). */
  onMessage?: (msg: RealtimeMessage) => void;
};

const PING_INTERVAL_MS = 30_000;
const RECONNECT_MAX_MS = 15_000;

export function useRetaRealtime(
  retaId: string | null | undefined,
  token: string | null | undefined,
  opts: Options = {},
) {
  const { enabled = true, onUpdate, onMessage } = opts;
  const [status, setStatus] = useState<RealtimeStatus>("idle");
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Cb refs para no recrear el efecto en cada render
  const onUpdateRef = useRef(onUpdate);
  const onMessageRef = useRef(onMessage);
  onUpdateRef.current = onUpdate;
  onMessageRef.current = onMessage;

  useEffect(() => {
    if (!enabled || !retaId || !token) {
      setStatus("idle");
      return;
    }

    let cancelled = false;

    function cleanupTimers() {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (pingTimerRef.current) {
        clearInterval(pingTimerRef.current);
        pingTimerRef.current = null;
      }
    }

    function connect() {
      if (cancelled) return;
      cleanupTimers();
      setStatus("connecting");
      let ws: WebSocket;
      try {
        const url = api.getRealtimeWsUrl(retaId!, token!);
        ws = new WebSocket(url);
      } catch (e) {
        setStatus("error");
        scheduleReconnect();
        return;
      }
      wsRef.current = ws;

      ws.onopen = () => {
        if (cancelled) return;
        setStatus("open");
        reconnectAttemptRef.current = 0;
        // Start app-side keepalive
        pingTimerRef.current = setInterval(() => {
          try {
            ws.send(JSON.stringify({ type: "ping" }));
          } catch {
            // ignore — el onerror/onclose disparará el reconnect
          }
        }, PING_INTERVAL_MS);
      };

      ws.onmessage = (ev: MessageEvent) => {
        if (cancelled) return;
        let msg: RealtimeMessage | null = null;
        try {
          msg = JSON.parse(String(ev.data));
        } catch {
          return;
        }
        if (!msg) return;
        onMessageRef.current?.(msg);
        if (msg.type === "standings_updated") {
          onUpdateRef.current?.(msg);
        }
      };

      ws.onerror = () => {
        if (cancelled) return;
        setStatus("error");
      };

      ws.onclose = () => {
        if (cancelled) return;
        setStatus("closed");
        scheduleReconnect();
      };
    }

    function scheduleReconnect() {
      if (cancelled) return;
      const n = reconnectAttemptRef.current;
      reconnectAttemptRef.current = n + 1;
      const delay = Math.min(RECONNECT_MAX_MS, 1000 * Math.pow(2, n));
      reconnectTimerRef.current = setTimeout(connect, delay);
    }

    // Reconectar al volver del background
    const appSub = AppState.addEventListener("change", (state) => {
      if (state === "active" && wsRef.current?.readyState !== WebSocket.OPEN) {
        // forzar reconnect inmediato
        reconnectAttemptRef.current = 0;
        if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
        connect();
      }
    });

    connect();

    return () => {
      cancelled = true;
      appSub.remove();
      cleanupTimers();
      try {
        wsRef.current?.close(1000, "unmount");
      } catch {
        // ignore
      }
      wsRef.current = null;
    };
  }, [retaId, token, enabled]);

  return { status };
}
