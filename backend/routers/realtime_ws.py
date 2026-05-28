"""
Realtime WebSocket endpoint — Fase C.

Cliente abre: `wss://<host>/api/ws/retas/{reta_id}?token=<JWT>`

Validaciones de auth (mismas reglas que el endpoint REST `/clasificacion`):
    - token rol "admin"  → ok.
    - token rol "player" + inscripcion.estatus_pago = "Aprobado" en esta reta → ok.
    - Cualquier otro → cierre 4403.

Códigos de cierre:
    - 4401: token faltante o inválido.
    - 4403: rol incorrecto / no aprobado.
    - 4404: reta no encontrada.
    - 4500: error interno.

Mensajes ENTRANTES (cliente → server):
    - {"type":"ping"} → server responde {"type":"pong"}.

Mensajes SALIENTES (server → cliente):
    - {"type":"hello","reta_id":"..."}                    al conectar
    - {"type":"standings_updated","reta_id":"...","ts":"...","event":"...",...}
    - {"type":"pong","ts":"..."}                          respuesta a ping
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect

from auth import decode_token
from core.db import db
from core.realtime import manager

logger = logging.getLogger("padelappretas-os.realtime.ws")

router = APIRouter()


async def _authorize(reta_id: str, token: str | None) -> dict | None:
    """Devuelve payload si el token autoriza ver esta reta. None si no."""
    if not token:
        return None
    try:
        payload = decode_token(token)
    except Exception:
        return None
    role = payload.get("role")
    if role == "admin":
        return payload
    if role == "player":
        telefono = payload.get("sub")
        if not telefono:
            return None
        ins = await db.inscripciones.find_one(
            {"reta_id": reta_id, "telefono": telefono},
            {"_id": 0, "estatus_pago": 1},
        )
        if not ins or ins.get("estatus_pago") != "Aprobado":
            return None
        return payload
    return None


@router.websocket("/ws/retas/{reta_id}")
async def reta_ws(
    websocket: WebSocket,
    reta_id: str,
    token: str | None = Query(default=None),
):
    # 1) Reta existe?
    reta = await db.retas.find_one({"id": reta_id}, {"_id": 0, "id": 1})
    if not reta:
        await websocket.close(code=4404, reason="Reta no encontrada")
        return

    # 2) Auth
    payload = await _authorize(reta_id, token)
    if not payload:
        await websocket.close(code=4403, reason="No autorizado")
        return

    # 3) Subscribe
    await manager.connect(reta_id, websocket)
    try:
        await websocket.send_json({
            "type": "hello",
            "reta_id": reta_id,
            "role": payload.get("role"),
            "ts": datetime.now(timezone.utc).isoformat(),
        })
        # Loop de recepción — sirve para mantener viva la conexión y responder pings.
        while True:
            try:
                msg = await asyncio.wait_for(websocket.receive_json(), timeout=60)
            except asyncio.TimeoutError:
                # Idle keepalive (ping del servidor cada 60s)
                await websocket.send_json({
                    "type": "ping",
                    "ts": datetime.now(timezone.utc).isoformat(),
                })
                continue
            if isinstance(msg, dict) and msg.get("type") == "ping":
                await websocket.send_json({
                    "type": "pong",
                    "ts": datetime.now(timezone.utc).isoformat(),
                })
    except WebSocketDisconnect:
        pass
    except Exception as e:  # noqa: BLE001
        logger.warning("WS reta=%s error inesperado: %s", reta_id, e)
    finally:
        await manager.disconnect(reta_id, websocket)
