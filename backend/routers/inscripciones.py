"""Inscripciones via mock checkout legacy + lista de espera + webhook mock.

Mantiene compatibilidad hacia atrás con el endpoint /webhooks/payment mock.
El flujo real con Stripe está en payments_router.py."""
import asyncio
import logging
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException

from core.db import db
from core.helpers import (
    expirar_pendientes_vencidas,
    promover_lista_espera,
    upsert_jugador,
)
from models import (
    Inscripcion,
    InscripcionCreate,
    PaymentWebhook,
    Usuario,
    WaitlistCreate,
    WaitlistEntry,
)

logger = logging.getLogger("pixel-padel-os")
router = APIRouter(tags=["inscripciones"])


@router.post("/public/retas/{reta_id}/checkout", response_model=Inscripcion)
async def checkout_mock(reta_id: str, body: InscripcionCreate):
    """Bloquea el lugar por 5 minutos mientras se procesa el pago (mock legacy).
    Para Stripe real, usar /public/retas/{id}/checkout-stripe."""
    if body.reta_id != reta_id:
        raise HTTPException(400, "reta_id mismatch")

    reta = await db.retas.find_one({"id": reta_id}, {"_id": 0})
    if not reta:
        raise HTTPException(404, "Reta no encontrada")

    await expirar_pendientes_vencidas(reta_id)

    ocupados = await db.inscripciones.count_documents({
        "reta_id": reta_id,
        "estatus_pago": {"$in": ["Aprobado", "Pendiente"]},
    })
    if ocupados >= reta["max_jugadores"]:
        raise HTTPException(409, "Reta llena. Únete a la lista de espera.")

    jugador_id = await upsert_jugador(body.nombre, body.telefono)
    bloqueado_hasta = (datetime.now(timezone.utc) + timedelta(minutes=5)).isoformat()
    insc = Inscripcion(
        reta_id=reta_id,
        jugador_id=jugador_id,
        nombre=body.nombre,
        telefono=body.telefono,
        estatus_pago="Pendiente",
        bloqueado_hasta=bloqueado_hasta,
    )
    doc = insc.model_dump()
    doc["creado_en"] = doc["creado_en"].isoformat()
    await db.inscripciones.insert_one(doc)
    return insc


@router.post("/webhooks/payment")
async def webhook_payment_mock(body: PaymentWebhook):
    """Endpoint mock para confirmar/cancelar pagos (compat con tests legacy).
    Idempotente: si la inscripción ya no existe (caso failed repetido), retorna ok."""
    insc = await db.inscripciones.find_one({"id": body.inscripcion_id})
    if not insc:
        return {"ok": True, "status": "already_processed"}

    if body.status == "approved":
        await db.inscripciones.update_one(
            {"id": body.inscripcion_id},
            {"$set": {"estatus_pago": "Aprobado", "bloqueado_hasta": None}},
        )
        return {"ok": True, "status": "Aprobado"}
    else:
        await db.inscripciones.delete_one({"id": body.inscripcion_id})
        await promover_lista_espera(insc["reta_id"])
        return {"ok": True, "status": "Cancelado", "promoted": True}


@router.post("/public/retas/{reta_id}/waitlist", response_model=WaitlistEntry)
async def join_waitlist(reta_id: str, body: WaitlistCreate):
    if body.reta_id != reta_id:
        raise HTTPException(400, "reta_id mismatch")
    reta = await db.retas.find_one({"id": reta_id})
    if not reta:
        raise HTTPException(404, "Reta no encontrada")

    existing = await db.lista_espera.find_one({"reta_id": reta_id, "telefono": body.telefono})
    if existing:
        existing.pop("_id", None)
        return WaitlistEntry(**existing)

    for attempt in range(10):
        last = await db.lista_espera.find_one(
            {"reta_id": reta_id}, sort=[("posicion_fila", -1)]
        )
        next_pos = (last["posicion_fila"] if last else 0) + 1

        jugador = await db.usuarios.find_one({"telefono": body.telefono})
        if not jugador:
            nuevo = Usuario(nombre=body.nombre, telefono=body.telefono)
            doc = nuevo.model_dump()
            doc["creado_en"] = doc["creado_en"].isoformat()
            await db.usuarios.insert_one(doc)
            jugador_id = nuevo.id
        else:
            jugador_id = jugador["id"]

        entry = WaitlistEntry(
            reta_id=reta_id,
            jugador_id=jugador_id,
            nombre=body.nombre,
            telefono=body.telefono,
            posicion_fila=next_pos,
        )
        try:
            doc = entry.model_dump()
            doc["creado_en"] = doc["creado_en"].isoformat()
            await db.lista_espera.insert_one(doc)
            return entry
        except Exception as e:
            logger.warning("Reintento waitlist (intento %d): %s", attempt + 1, e)
            await asyncio.sleep(0.05)
    raise HTTPException(500, "No se pudo unir a la lista de espera tras múltiples intentos")
