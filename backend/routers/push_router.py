"""Push Notifications Router — Emergent-managed (SuprSend relay).

Flujo:
  Frontend (Expo) obtiene device_token con `getDevicePushTokenAsync()` y lo
  POSTea aquí. Nosotros lo reenviamos al Emergent push gateway que se
  encarga del enrutamiento a APNs (iOS) o FCM (Android).

No persistimos el `device_token` en MongoDB — la guía explícita del playbook
indica que SuprSend resuelve internamente los tokens vía `user_id`. Sí
guardamos un breve audit-trail (último platform/registro) para diagnóstico.
"""
from __future__ import annotations

import logging
import os
from datetime import datetime, timezone

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from core.db import db

logger = logging.getLogger("padelappretas-os")
router = APIRouter(tags=["push"])

PUSH_BASE_URL = "https://integrations.emergentagent.com"
PUSH_KEY = os.environ.get("EMERGENT_PUSH_KEY", "placeholder")

# Cliente compartido (singleton lazy-init para no romper hot-reload en dev).
_client: httpx.AsyncClient | None = None


def _get_client() -> httpx.AsyncClient:
    global _client
    if _client is None:
        _client = httpx.AsyncClient(
            base_url=PUSH_BASE_URL,
            headers={"X-Push-Key": PUSH_KEY},
            timeout=10.0,
        )
    return _client


class RegisterPushBody(BaseModel):
    user_id: str = Field(min_length=1, max_length=120)
    platform: str = Field(pattern="^(android|ios|web)$")
    device_token: str = Field(min_length=10, max_length=4096)


class RegisterPushResponse(BaseModel):
    status: str
    user_id: str


@router.post("/register-push", status_code=201, response_model=RegisterPushResponse)
async def register_push(body: RegisterPushBody) -> RegisterPushResponse:
    """Registra el push token del dispositivo para enviar notifs vía Emergent.

    Es idempotente: re-registrar el mismo `user_id` con un token nuevo
    actualiza el routing sin crear duplicados.
    """
    # 1) Relay a Emergent push gateway (SuprSend).
    try:
        resp = await _get_client().post(
            "/api/v1/push/users/register",
            json=body.model_dump(),
        )
    except httpx.RequestError as e:
        logger.warning("[push] register relay error: %s", str(e)[:120])
        raise HTTPException(502, "Push provider unavailable") from e

    if resp.status_code == 401:
        # EMERGENT_PUSH_KEY missing/invalid — esperado en preview pre-deploy.
        logger.warning("[push] register 401 · key placeholder? user=%s", body.user_id)
        # No crasheamos al cliente: el registro queda en "pendiente_deploy"
        # y el front continúa el flujo. El deployment_pipeliner inyectará
        # la key real y un re-register en próximo app-open lo activará.
        await _audit(body, status="pending_deploy")
        return RegisterPushResponse(status="pending_deploy", user_id=body.user_id)
    if resp.status_code >= 500:
        logger.warning("[push] register upstream 5xx · status=%s", resp.status_code)
        raise HTTPException(502, "Push provider unavailable")
    if resp.status_code >= 400:
        logger.warning(
            "[push] register upstream 4xx · status=%s body=%s",
            resp.status_code, resp.text[:160],
        )
        raise HTTPException(400, "Invalid push registration")

    await _audit(body, status="registered")
    return RegisterPushResponse(status="registered", user_id=body.user_id)


async def _audit(body: RegisterPushBody, status: str) -> None:
    """Upsert breve para diagnóstico (sin guardar device_token completo)."""
    try:
        await db.push_registrations.update_one(
            {"user_id": body.user_id},
            {
                "$set": {
                    "user_id": body.user_id,
                    "platform": body.platform,
                    "token_fingerprint": body.device_token[:8] + "...",
                    "status": status,
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                },
                "$setOnInsert": {"created_at": datetime.now(timezone.utc).isoformat()},
            },
            upsert=True,
        )
    except Exception as e:  # pylint: disable=broad-except
        logger.warning("[push] audit upsert failed: %s", str(e)[:120])
