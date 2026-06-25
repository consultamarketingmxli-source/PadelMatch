"""Push service — Emergent-managed push notifications (SuprSend relay).

ARQUITECTURA (alineada con el playbook oficial):
  - El TOKEN del dispositivo lo guarda Emergent vía `POST /register-push`.
  - El BACKEND llama a `send_push(recipients=[user_id], data={...})` con el
    `user_id` propio de PadelAppRetas. Emergent resuelve internamente a
    APNs/FCM y entrega la notif.
  - El upstream usa header `X-Push-Key: $EMERGENT_PUSH_KEY` (placeholder en
    dev/preview; deployer lo reemplaza por la key real en producción).

API pública:
  • `send_high_priority_push(jugador_id, title, body, deeplink=...)` —
    helper compatible con la firma usada por `core/helpers.py::promover_lista_espera`.
  • `send_push(recipients, data, idempotency_key=...)` — primitivo bajo nivel.

Resiliencia: cualquier fallo es no-op para el flow (log warning + return False).
"""
from __future__ import annotations

import logging
import os
from typing import Optional

import httpx

logger = logging.getLogger("padelappretas.push")

PUSH_BASE_URL = "https://integrations.emergentagent.com"
PUSH_KEY = os.environ.get("EMERGENT_PUSH_KEY", "placeholder")

_client: httpx.AsyncClient | None = None


def _get_client() -> httpx.AsyncClient:
    """Lazy-init httpx client compartido. Permite hot-reload sin leak."""
    global _client
    if _client is None:
        _client = httpx.AsyncClient(
            base_url=PUSH_BASE_URL,
            headers={"X-Push-Key": PUSH_KEY},
            timeout=10.0,
        )
    return _client


async def send_push(
    recipients: list[str],
    data: dict,
    idempotency_key: Optional[str] = None,
) -> bool:
    """Dispara una notif push a uno o más user_ids vía Emergent relay.

    Args:
        recipients: lista de user_ids (jugador_id en PadelAppRetas).
                    Max 100 por llamada (Emergent limit).
        data: dict con `title` (req), `message` (req), `subtext`, `image_url`,
              `action_url` (recomendado para tap-to-navigate).
        idempotency_key: opcional, recomendado para retries.

    Returns:
        True si Emergent aceptó · False en cualquier otra situación (no-op).
        Jamás lanza excepción.
    """
    if not recipients:
        return False
    if len(recipients) > 100:
        logger.warning("[push] >100 recipients en 1 send — corta antes de llamar.")
        recipients = recipients[:100]
    if "title" not in data or "message" not in data:
        logger.warning("[push] send abortado: faltan title/message en data")
        return False

    payload: dict = {"recipients": recipients, "data": data}
    if idempotency_key:
        payload["$idempotency_key"] = idempotency_key

    try:
        resp = await _get_client().post("/api/v1/push/trigger", json=payload)
    except httpx.RequestError as e:
        logger.warning("[push] send relay error: %s", str(e)[:120])
        return False

    if resp.status_code == 401:
        # Key placeholder pre-deploy → no-op silencioso (esperado en preview).
        logger.info(
            "[push] modo no-op (401 placeholder) · recipients=%d title='%s'",
            len(recipients), data.get("title", "")[:40],
        )
        return False
    if resp.status_code >= 500:
        logger.warning("[push] upstream 5xx · status=%s", resp.status_code)
        return False
    if resp.status_code >= 400:
        logger.warning(
            "[push] upstream 4xx · status=%s body=%s",
            resp.status_code, resp.text[:160],
        )
        return False

    logger.info(
        "[push] enviado · recipients=%d title='%s' idem=%s",
        len(recipients), data.get("title", "")[:40], idempotency_key,
    )
    return True


async def send_high_priority_push(
    *,
    jugador_id: str,
    title: str,
    body: str,
    deeplink: Optional[str] = None,
    idempotency_key: Optional[str] = None,
) -> bool:
    """Helper compat con la firma usada por `core/helpers.py`.

    Mapea `body` → `data.message` y `deeplink` → `data.action_url` (que el
    handler del frontend lee para navegar).
    """
    data: dict = {"title": title, "message": body}
    if deeplink:
        data["action_url"] = deeplink
    return await send_push(
        recipients=[jugador_id],
        data=data,
        idempotency_key=idempotency_key,
    )
