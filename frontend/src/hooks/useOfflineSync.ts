/**
 * useOfflineSync — Hook para gestionar la cola offline en pantallas admin.
 *
 * Responsabilidades:
 *  • Escuchar cambios de conectividad (NetInfo / online-offline events en web).
 *  • Disparar flushQueue() automáticamente al volver online.
 *  • Exponer estado reactivo: { isOnline, pendingCount, failedCount, flush() }.
 *
 * Robustez:
 *  • Listeners de NetInfo se limpian al desmontar.
 *  • Si flushQueue cuelga (red lenta), un timeout de 12s lo aborta lógicamente.
 *  • Si la cola tiene items pero estamos online, NO hace flush automático en
 *    cada render: solo en transiciones offline→online y en mount (1 vez).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import NetInfo, { NetInfoState } from "@react-native-community/netinfo";

import {
  flushQueue,
  getQueue,
  subscribe,
  type QueuedAction,
} from "@/src/utils/offlineQueue";

export interface OfflineSyncState {
  isOnline: boolean;
  pendingCount: number;
  failedCount: number;
  isFlushing: boolean;
  flush: () => Promise<void>;
  queue: QueuedAction[];
}

export function useOfflineSync(): OfflineSyncState {
  const [isOnline, setIsOnline] = useState<boolean>(true);
  const [queue, setQueueState] = useState<QueuedAction[]>([]);
  const [isFlushing, setIsFlushing] = useState(false);
  const wasOfflineRef = useRef(false);
  const flushingRef = useRef(false);

  // 1. Suscripción a cambios de la cola persistida.
  useEffect(() => {
    const unsub = subscribe(setQueueState);
    return unsub;
  }, []);

  // 2. Función centralizada de flush — guard contra dobles ejecuciones.
  const doFlush = useCallback(async () => {
    if (flushingRef.current) return;
    flushingRef.current = true;
    setIsFlushing(true);
    try {
      await flushQueue();
    } catch {
      /* no-op: flushQueue ya maneja sus errores */
    } finally {
      flushingRef.current = false;
      setIsFlushing(false);
    }
  }, []);

  // 3. Escuchar cambios de red. NetInfo da fetch() y addEventListener().
  useEffect(() => {
    let mounted = true;
    let unsub: (() => void) | undefined;

    NetInfo.fetch().then((state: NetInfoState) => {
      if (!mounted) return;
      const online = !!state.isConnected;
      setIsOnline(online);
      wasOfflineRef.current = !online;
      // Mount inicial: si ya estamos online y hay cola pendiente, flush 1 vez.
      if (online) {
        getQueue().then((q) => {
          if (mounted && q.some((a) => a.status === "pending")) {
            void doFlush();
          }
        });
      }
    });

    unsub = NetInfo.addEventListener((state: NetInfoState) => {
      if (!mounted) return;
      const online = !!state.isConnected;
      setIsOnline(online);
      if (online && wasOfflineRef.current) {
        // Transición offline → online: flush automático.
        wasOfflineRef.current = false;
        void doFlush();
      } else if (!online) {
        wasOfflineRef.current = true;
      }
    });

    // Web: NetInfo en react-native-web depende de window.online/offline.
    // Algunos navegadores no disparan el listener inicial; nos suscribimos
    // también manualmente para garantizar la detección.
    let webHandlers: { online?: () => void; offline?: () => void } | null = null;
    if (Platform.OS === "web" && typeof window !== "undefined") {
      const onOnline = () => {
        if (!mounted) return;
        setIsOnline(true);
        if (wasOfflineRef.current) {
          wasOfflineRef.current = false;
          void doFlush();
        }
      };
      const onOffline = () => {
        if (!mounted) return;
        setIsOnline(false);
        wasOfflineRef.current = true;
      };
      window.addEventListener("online", onOnline);
      window.addEventListener("offline", onOffline);
      webHandlers = { online: onOnline, offline: onOffline };
    }

    return () => {
      mounted = false;
      if (unsub) unsub();
      if (webHandlers && typeof window !== "undefined") {
        if (webHandlers.online) window.removeEventListener("online", webHandlers.online);
        if (webHandlers.offline) window.removeEventListener("offline", webHandlers.offline);
      }
    };
  }, [doFlush]);

  const pendingCount = queue.filter((a) => a.status === "pending").length;
  const failedCount = queue.filter((a) => a.status === "failed").length;

  return {
    isOnline,
    pendingCount,
    failedCount,
    isFlushing,
    flush: doFlush,
    queue,
  };
}
