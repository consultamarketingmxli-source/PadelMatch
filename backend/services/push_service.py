"""Push service — Emergent-managed high-priority push notifications.

NOTA CRÍTICA:
  - El push real sólo se activa cuando el `EMERGENT_PUSH_KEY` es reemplazado
    por su valor real en el deploy. Hasta entonces, queda como `placeholder` y
    el servicio actúa en modo no-op (logs only).
  - Expo Go NO soporta push nativas. Sólo funcionan tras build nativo
    (Android APK / iOS IPA).
  - El push token de cada jugador se guarda en `db.jugadores[].push_token` (ver
    `core/db.py`); este servicio lo recupera por `jugador_id`.
"""
from __future__ import annotations

import logging
import os
from typing import Optional

from core.db import db

logger = logging.getLogger("padelappretas.push")


async def send_high_priority_push(
    *,
    jugador_id: str,
    title: str,
    body: str,
    deeplink: Optional[str] = None,
    idempotency_key: Optional[str] = None,
) -> bool:
    """Envía push de alta prioridad al jugador.

    Modo no-op cuando `EMERGENT_PUSH_KEY=placeholder`. En build de producción
    el deploy inyecta el key real y este servicio dispara la API correspondiente.

    Returns:
        True si Emergent aceptó · False en cualquier otra situación.
    """
    push_key = os.getenv("EMERGENT_PUSH_KEY")
    if not push_key or push_key == "placeholder":
        logger.info(
            "[push] modo no-op (placeholder) · jugador=%s title='%s' deeplink=%s",
            jugador_id, title, deeplink,
        )
        return False

    # Recuperar push_token desde la colección de jugadores.
    jug = await db.jugadores.find_one(
        {"id": jugador_id}, {"_id": 0, "push_token": 1, "nombre": 1}
    )
    push_token = (jug or {}).get("push_token")
    if not push_token:
        logger.warning("[push] jugador %s sin push_token registrado", jugador_id)
        return False

    # Llamada al endpoint Emergent push (placeholder · se completa en deploy).
    # Cuando esté activo, este try lanza httpx.post() al endpoint correspondiente.
    try:
        import httpx
        payload = {
            "to": push_token,
            "title": title,
            "body": body,
            "priority": "high",
            "data": {"deeplink": deeplink, "idem": idempotency_key},
        }
        async with httpx.AsyncClient(timeout=8.0) as client:
            r = await client.post(
                "https://exp.host/--/api/v2/push/send",
                headers={"Authorization": f"Bearer {push_key}"},
                json=payload,
            )
            r.raise_for_status()
        logger.info(
            "[push] enviado · jugador=%s title='%s' idem=%s", jugador_id, title, idempotency_key,
        )
        return True
    except Exception as e:  # pylint: disable=broad-except
        logger.warning("[push] envío falló · jugador=%s err=%s", jugador_id, str(e)[:120])
        return False
