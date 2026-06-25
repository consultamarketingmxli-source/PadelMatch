"""Push Notifications Router — Emergent-managed (SuprSend relay).

Flujo:
  Frontend (Expo) obtiene device_token con `getDevicePushTokenAsync()` y lo
  POSTea aquí. Nosotros lo reenviamos al Emergent push gateway que se
  encarga del enrutamiento a APNs (iOS) o FCM (Android).

No persistimos el `device_token` en MongoDB — la guía explícita del playbook
indica que SuprSend resuelve internamente los tokens vía `user_id`. Sí
guardamos un breve audit-trail (último platform/registro + flag de opt-in).

Endpoints:
  POST /register-push   — registra el token (idempotente, opt-in implícito)
  GET  /push-status     — lee el estado actual (registered / disabled / never)
  POST /disable-push    — opt-out explícito desde Settings (no manda más push)
"""
from __future__ import annotations

import logging
import os
from datetime import datetime, timezone

import httpx
from fastapi import APIRouter, HTTPException, Query
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


class DisablePushBody(BaseModel):
    user_id: str = Field(min_length=1, max_length=120)


class PushStatusResponse(BaseModel):
    user_id: str
    # never | registered | pending_deploy | disabled
    state: str
    platform: str | None = None
    notifications_enabled: bool
    updated_at: str | None = None


@router.post("/register-push", status_code=201, response_model=RegisterPushResponse)
async def register_push(body: RegisterPushBody) -> RegisterPushResponse:
    """Registra el push token del dispositivo para enviar notifs vía Emergent.

    Es idempotente: re-registrar el mismo `user_id` con un token nuevo
    actualiza el routing sin crear duplicados. CUALQUIER llamada exitosa
    reactiva `notifications_enabled=true` (opt-in implícito por design —
    si llegaste aquí es porque concediste permiso nativo).
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


@router.get("/push-status", response_model=PushStatusResponse)
async def push_status(user_id: str = Query(..., min_length=1, max_length=120)) -> PushStatusResponse:
    """Lee el estado del registro de push para un user_id (lectura propia).

    Returns:
        `state="never"` si no hay registro previo, `"disabled"` si el usuario
        hizo opt-out, `"registered"` o `"pending_deploy"` en otro caso.
    """
    doc = await db.push_registrations.find_one({"user_id": user_id}, {"_id": 0})
    if not doc:
        return PushStatusResponse(
            user_id=user_id, state="never",
            platform=None, notifications_enabled=False, updated_at=None,
        )
    enabled = bool(doc.get("notifications_enabled", True))
    raw_status = str(doc.get("status") or "")
    if not enabled:
        state = "disabled"
    elif raw_status == "registered":
        state = "registered"
    elif raw_status == "pending_deploy":
        state = "pending_deploy"
    else:
        state = raw_status or "registered"
    return PushStatusResponse(
        user_id=user_id,
        state=state,
        platform=doc.get("platform"),
        notifications_enabled=enabled,
        updated_at=doc.get("updated_at"),
    )


@router.post("/disable-push", status_code=200)
async def disable_push(body: DisablePushBody) -> dict:
    """Opt-out explícito desde la pantalla de Settings.

    No revoca el permiso nativo del SO (eso lo hace el usuario en Ajustes),
    solo marca `notifications_enabled=false` para que `send_push()` deje de
    enrutar mensajes a este user_id. Es idempotente — llamar varias veces es
    seguro.

    Re-encender: el frontend invoca `register-push` nuevamente y el
    `_audit()` re-pone `notifications_enabled=true`.
    """
    result = await db.push_registrations.update_one(
        {"user_id": body.user_id},
        {
            "$set": {
                "notifications_enabled": False,
                "disabled_at": datetime.now(timezone.utc).isoformat(),
                "updated_at": datetime.now(timezone.utc).isoformat(),
            },
        },
    )
    if result.matched_count == 0:
        # No existe registro previo. Insertamos uno "shell" con disabled=true
        # para que un futuro register-push tenga un doc sobre el que upsertar.
        await db.push_registrations.insert_one({
            "user_id": body.user_id,
            "notifications_enabled": False,
            "status": "disabled",
            "platform": None,
            "disabled_at": datetime.now(timezone.utc).isoformat(),
            "updated_at": datetime.now(timezone.utc).isoformat(),
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
    logger.info("[push] disable · user=%s", body.user_id)
    return {"status": "disabled", "user_id": body.user_id}


async def _audit(body: RegisterPushBody, status: str) -> None:
    """Upsert breve para diagnóstico (sin guardar device_token completo).

    En cada `register-push` exitoso re-activamos `notifications_enabled=true`
    (opt-in implícito), porque el usuario acaba de conceder permiso nativo
    y haber pasado por la UI de "Activar alertas".
    """
    try:
        await db.push_registrations.update_one(
            {"user_id": body.user_id},
            {
                "$set": {
                    "user_id": body.user_id,
                    "platform": body.platform,
                    "token_fingerprint": body.device_token[:8] + "...",
                    "status": status,
                    "notifications_enabled": True,
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                },
                "$setOnInsert": {"created_at": datetime.now(timezone.utc).isoformat()},
                # Limpiamos disabled_at si reactiva.
                "$unset": {"disabled_at": ""},
            },
            upsert=True,
        )
    except Exception as e:  # pylint: disable=broad-except
        logger.warning("[push] audit upsert failed: %s", str(e)[:120])
