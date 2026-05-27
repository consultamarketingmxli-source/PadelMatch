"""Stripe Checkout real: crear session, webhook, polling de status."""
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Request

import payments_stripe
from core.db import db
from core.helpers import crear_inscripcion_pendiente, promover_lista_espera
from models import (
    PaymentStatus,
    StripeCheckoutCreate,
    StripeCheckoutResponse,
    StripeTransaction,
)

logger = logging.getLogger("padelappretas-os")
router = APIRouter(tags=["payments"])


@router.post(
    "/public/retas/{reta_id}/checkout-stripe",
    response_model=StripeCheckoutResponse,
)
async def checkout_stripe(reta_id: str, body: StripeCheckoutCreate, request: Request):
    """Crea inscripción Pendiente + Stripe Checkout Session. Devuelve URL de pago.
    El monto se calcula en el servidor desde reta.costo_inscripcion."""
    if not payments_stripe.is_stripe_configured():
        raise HTTPException(503, "Stripe no está configurado en el servidor.")

    reta = await db.retas.find_one({"id": reta_id}, {"_id": 0})
    if not reta:
        raise HTTPException(404, "Reta no encontrada")
    if reta.get("costo_inscripcion", 0) < 10:
        raise HTTPException(400, "El costo de inscripción debe ser de al menos $10 MXN.")

    insc = await crear_inscripcion_pendiente(reta, body.nombre, body.telefono, minutos_bloqueo=15)

    base = str(request.base_url).rstrip("/")
    success = body.success_url or (
        f"{base}/retas/{reta['url_slug']}?pago=ok&inscripcion={insc.id}&session_id={{CHECKOUT_SESSION_ID}}"
    )
    cancel = body.cancel_url or (
        f"{base}/retas/{reta['url_slug']}?pago=cancelado&inscripcion={insc.id}"
    )

    try:
        session = await payments_stripe.crear_session_checkout(
            monto_principal=float(reta["costo_inscripcion"]),
            moneda="mxn",
            nombre_reta=reta["nombre"],
            success_url=success,
            cancel_url=cancel,
            inscripcion_id=insc.id,
            reta_id=reta_id,
            jugador_id=insc.jugador_id,
            telefono=insc.telefono,
        )
    except Exception as e:
        logger.exception("Stripe checkout error: %s", e)
        await db.inscripciones.delete_one({"id": insc.id})
        raise HTTPException(502, f"Error con Stripe: {e}") from e

    tx = StripeTransaction(
        session_id=session.session_id, inscripcion_id=insc.id, reta_id=reta_id,
        jugador_id=insc.jugador_id, telefono=insc.telefono,
        amount=float(reta["costo_inscripcion"]), currency="mxn",
    )
    tdoc = tx.model_dump()
    tdoc["creado_en"] = tdoc["creado_en"].isoformat()
    await db.stripe_transactions.insert_one(tdoc)

    await db.inscripciones.update_one(
        {"id": insc.id},
        {"$set": {"stripe_session_id": session.session_id}},
    )

    return StripeCheckoutResponse(
        inscripcion_id=insc.id,
        checkout_url=session.url,
        session_id=session.session_id,
    )


async def _aplicar_resultado_pago(session_id: str, payment_status: str) -> dict:
    """Idempotente: dado un session_id y un payment_status reciente, actualiza la inscripción."""
    tx = await db.stripe_transactions.find_one({"session_id": session_id}, {"_id": 0})
    if not tx:
        return {"matched": False}

    if tx.get("payment_status") in ("paid", "failed", "expired"):
        return {"matched": True, "already": True, "estatus_pago": tx["payment_status"]}

    insc = await db.inscripciones.find_one({"id": tx["inscripcion_id"]}, {"_id": 0})

    if payment_status == "paid":
        if insc and insc["estatus_pago"] == "Pendiente":
            await db.inscripciones.update_one(
                {"id": tx["inscripcion_id"]},
                {"$set": {"estatus_pago": "Aprobado", "bloqueado_hasta": None}},
            )
        await db.stripe_transactions.update_one(
            {"session_id": session_id}, {"$set": {"payment_status": "paid"}},
        )
        return {"matched": True, "estatus_pago": "Aprobado"}

    if payment_status in ("failed", "expired", "unpaid"):
        if insc:
            await db.inscripciones.delete_one({"id": tx["inscripcion_id"]})
            await promover_lista_espera(tx["reta_id"])
        await db.stripe_transactions.update_one(
            {"session_id": session_id}, {"$set": {"payment_status": payment_status}},
        )
        return {"matched": True, "estatus_pago": payment_status}

    return {"matched": True, "estatus_pago": payment_status, "ignored": True}


@router.post("/webhooks/stripe")
async def webhook_stripe(request: Request):
    """Webhook real de Stripe. Verifica firma (si STRIPE_WEBHOOK_SECRET está) y
    aplica el resultado del pago a la inscripción de forma idempotente."""
    body = await request.body()
    signature = request.headers.get("stripe-signature") or request.headers.get("Stripe-Signature")
    try:
        evt = await payments_stripe.procesar_webhook(body, signature)
    except Exception as e:
        logger.warning("Webhook Stripe rechazado: %s", e)
        raise HTTPException(400, f"Webhook inválido: {e}") from e

    if evt.event_id:
        seen = await db.stripe_events.find_one({"event_id": evt.event_id})
        if seen:
            return {"ok": True, "duplicate": True}
        await db.stripe_events.insert_one({
            "event_id": evt.event_id, "type": evt.event_type,
            "creado_en": datetime.now(timezone.utc).isoformat(),
        })

    result = {"matched": False}
    if evt.session_id and evt.payment_status:
        result = await _aplicar_resultado_pago(evt.session_id, evt.payment_status)

    return {"ok": True, "event": evt.event_type, **result}


@router.get(
    "/public/inscripciones/{inscripcion_id}/payment-status",
    response_model=PaymentStatus,
)
async def get_payment_status(inscripcion_id: str):
    """Polling para que el cliente sepa si Stripe ya confirmó el pago.
    Si la inscripción está Pendiente y existe session_id, hace refresh proactivo
    desde Stripe (sin esperar al webhook). Idempotente."""
    insc = await db.inscripciones.find_one({"id": inscripcion_id}, {"_id": 0})
    if not insc:
        tx = await db.stripe_transactions.find_one({"inscripcion_id": inscripcion_id}, {"_id": 0})
        if tx:
            return PaymentStatus(
                inscripcion_id=inscripcion_id,
                estatus_pago="Cancelado",
                session_id=tx.get("session_id"),
                stripe_payment_status=tx.get("payment_status"),
            )
        raise HTTPException(404, "Inscripción no encontrada")

    session_id = insc.get("stripe_session_id")
    if (
        session_id
        and insc["estatus_pago"] == "Pendiente"
        and payments_stripe.is_stripe_configured()
    ):
        try:
            status = await payments_stripe.obtener_status_sesion(session_id)
            if status.payment_status in ("paid", "failed", "unpaid"):
                await _aplicar_resultado_pago(session_id, status.payment_status)
                insc = await db.inscripciones.find_one({"id": inscripcion_id}, {"_id": 0}) or insc
        except Exception as e:
            logger.warning("No se pudo consultar Stripe status: %s", e)

    return PaymentStatus(
        inscripcion_id=inscripcion_id,
        estatus_pago=insc["estatus_pago"],
        session_id=session_id,
    )
