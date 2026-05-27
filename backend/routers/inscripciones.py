"""Inscripciones via mock checkout legacy + lista de espera + webhook mock.

Mantiene compatibilidad hacia atrás con el endpoint /webhooks/payment mock.
El flujo real con Stripe está en payments_router.py.

Blindaje QA (race conditions):
- /public/retas/{id}/checkout usa `crear_inscripcion_pendiente` con reserva atómica.
- /public/retas/{id}/waitlist usa `siguiente_posicion_waitlist_atomica` para
  evitar posiciones duplicadas.
- /webhooks/payment libera el cupo atómico al borrar la inscripción.
"""
import logging

from fastapi import APIRouter, HTTPException

from core.db import db
from core.concurrency import (
    liberar_lugar,
    siguiente_posicion_waitlist_atomica,
)
from core.helpers import (
    crear_inscripcion_pendiente,
    promover_lista_espera,
)
from models import (
    Inscripcion,
    InscripcionCreate,
    PaymentWebhook,
    Usuario,
    WaitlistCreate,
    WaitlistEntry,
)

logger = logging.getLogger("padelappretas-os")
router = APIRouter(tags=["inscripciones"])


@router.post("/public/retas/{reta_id}/checkout", response_model=Inscripcion)
async def checkout_mock(reta_id: str, body: InscripcionCreate):
    """Bloquea el lugar por 5 minutos mientras se procesa el pago (mock legacy).
    Para Stripe real, usar /public/retas/{id}/checkout-stripe.

    Race condition protegida via `crear_inscripcion_pendiente` (atómico).
    """
    if body.reta_id != reta_id:
        raise HTTPException(400, "reta_id mismatch")

    reta = await db.retas.find_one({"id": reta_id}, {"_id": 0})
    if not reta:
        raise HTTPException(404, "Reta no encontrada")

    insc = await crear_inscripcion_pendiente(reta, body.nombre, body.telefono, minutos_bloqueo=5)
    return insc


@router.post("/webhooks/payment")
async def webhook_payment_mock(body: PaymentWebhook):
    """Endpoint mock para confirmar/cancelar pagos (compat con tests legacy).
    Idempotente: si la inscripción ya no existe, retorna ok.

    Race-safe: libera el cupo atómico cuando un pago se rechaza.
    """
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
        # Borramos la inscripción y liberamos el cupo atómico ANTES de promover.
        await db.inscripciones.delete_one({"id": body.inscripcion_id})
        await liberar_lugar(insc["reta_id"], 1)
        await promover_lista_espera(insc["reta_id"])
        return {"ok": True, "status": "Cancelado", "promoted": True}


@router.post("/public/retas/{reta_id}/waitlist", response_model=WaitlistEntry)
async def join_waitlist(reta_id: str, body: WaitlistCreate):
    """Une a un jugador a la lista de espera con posición ATÓMICA.

    Garantiza que dos clics simultáneos siempre obtengan posiciones distintas
    (sin retries, sin colisiones).
    """
    if body.reta_id != reta_id:
        raise HTTPException(400, "reta_id mismatch")
    reta = await db.retas.find_one({"id": reta_id})
    if not reta:
        raise HTTPException(404, "Reta no encontrada")

    # Si ya está en la lista, devolvemos la entrada existente (idempotente).
    existing = await db.lista_espera.find_one(
        {"reta_id": reta_id, "telefono": body.telefono}, {"_id": 0},
    )
    if existing:
        return WaitlistEntry(**existing)

    # Posición atómica (siempre única, race-safe).
    next_pos = await siguiente_posicion_waitlist_atomica(reta_id)

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
    doc = entry.model_dump()
    doc["creado_en"] = doc["creado_en"].isoformat()
    await db.lista_espera.insert_one(doc)
    return entry
