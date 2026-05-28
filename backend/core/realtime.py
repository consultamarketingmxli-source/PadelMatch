"""
Realtime Connection Manager — WebSockets nativos por reta.

Cada reta tiene su "canal" (`reta_id`). Los jugadores aprobados y el admin
abren un WebSocket en `/api/ws/retas/{reta_id}?token=...` y reciben mensajes
JSON empujados por el servidor cuando hay cambios:

    {"type": "standings_updated", "reta_id": "...", "ts": "...iso..."}
    {"type": "match_saved", "match_id": "...", "ronda": N, "cancha": N}
    {"type": "match_deleted", "match_id": "..."}

Diseño:
    - In-memory por proceso (suficiente para 1 worker; con multi-worker hay
      que usar Redis pub/sub — flag de futuro).
    - `broadcast()` es thread-safe gracias al lock asíncrono.
    - `disconnect()` se llama tanto en cierre limpio como en excepción.
    - Cada socket tiene su propio `try/except` para que un cliente con red
      mala no tumbe al resto.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Dict, Set

from fastapi import WebSocket

logger = logging.getLogger("padelappretas-os.realtime")


class RetaConnectionManager:
    def __init__(self) -> None:
        self._rooms: Dict[str, Set[WebSocket]] = {}
        self._lock = asyncio.Lock()

    async def connect(self, reta_id: str, ws: WebSocket) -> None:
        await ws.accept()
        async with self._lock:
            self._rooms.setdefault(reta_id, set()).add(ws)
        logger.info(
            "WS connect reta=%s subs=%d",
            reta_id,
            len(self._rooms.get(reta_id, set())),
        )

    async def disconnect(self, reta_id: str, ws: WebSocket) -> None:
        async with self._lock:
            room = self._rooms.get(reta_id)
            if room and ws in room:
                room.discard(ws)
                if not room:
                    self._rooms.pop(reta_id, None)
        logger.info(
            "WS disconnect reta=%s subs=%d",
            reta_id,
            len(self._rooms.get(reta_id, set())),
        )

    def subscribers(self, reta_id: str) -> int:
        return len(self._rooms.get(reta_id, set()))

    async def broadcast(self, reta_id: str, payload: dict) -> int:
        """Envía `payload` (dict JSON-serializable) a todos los subs del canal.

        Devuelve número de envíos exitosos.

        Resiliencia:
            - Si un socket falla al enviar, lo removemos silenciosamente.
            - Nunca lanza excepción — el caller siempre puede continuar.
        """
        payload = {**payload, "ts": datetime.now(timezone.utc).isoformat()}
        async with self._lock:
            sockets = list(self._rooms.get(reta_id, set()))
        sent = 0
        dead: list[WebSocket] = []
        for ws in sockets:
            try:
                await ws.send_json(payload)
                sent += 1
            except Exception as e:  # noqa: BLE001
                logger.warning("WS send failed (will drop): %s", e)
                dead.append(ws)
        if dead:
            async with self._lock:
                room = self._rooms.get(reta_id)
                if room:
                    for d in dead:
                        room.discard(d)
        return sent


# Singleton compartido por la app
manager = RetaConnectionManager()
