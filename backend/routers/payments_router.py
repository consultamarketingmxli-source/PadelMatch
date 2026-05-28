"""Stripe Checkout real: crear session, webhook, polling de status.

Fase 2 (parejas): soporte de checkout coordinado:
  • Reta individual → flujo clásico (1 inscripción, 1 cupo).
  • Reta de parejas con pareja_nombre+pareja_telefono → 2 inscripciones
    ligadas por pareja_grupo_id, 2 cupos atómicos, precio x2.
  • Reta de parejas + es_free_agent (si organizador lo permite) → 1 inscripción
    marcada free-agent.
"""
import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import Field

import payments_stripe
from core.concurrency import liberar_lugar
from core.db import db
from core.email_service import email_service
from core.helpers import (
    crear_inscripcion_free_agent_pendiente,
    crear_inscripcion_pareja_pendiente,
    crear_inscripcion_pendiente,
    promover_lista_espera,
)
from core.validators import NombreStr, PhoneStr
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
    """Crea inscripción Pendiente (1 o 2 según modalidad) + Stripe Checkout Session.

    Devuelve URL de pago. El monto se calcula en el servidor desde
    `reta.costo_inscripcion` (x2 si es inscripción de dúo).
    """
    if not payments_stripe.is_stripe_configured():
        raise HTTPException(503, "Stripe no está configurado en el servidor.")

    reta = await db.retas.find_one({"id": reta_id}, {"_id": 0})
    if not reta:
        raise HTTPException(404, "Reta no encontrada")
    if reta.get("costo_inscripcion", 0) < 10:
        raise HTTPException(400, "El costo de inscripción debe ser de al menos $10 MXN.")

    # ===== Detección de modalidad =====
    es_parejas = reta.get("modalidad_registro", "individual") != "individual"
    permite_indiv = bool(reta.get("permitir_individual_en_parejas", False))
    costo_unitario = float(reta["costo_inscripcion"])

    if not es_parejas:
        if body.pareja_nombre or body.es_free_agent:
            raise HTTPException(
                400, "Esta reta es individual; no admite pareja ni free-agent.",
            )
        insc = await crear_inscripcion_pendiente(
            reta, body.nombre, body.telefono, minutos_bloqueo=15,
        )
        cupos_reservados = 1
        costo_total = costo_unitario
        partner_insc_id: Optional[str] = None
    elif body.pareja_nombre and body.pareja_telefono:
        insc, insc_b = await crear_inscripcion_pareja_pendiente(
            reta, body.nombre, body.telefono,
            body.pareja_nombre, body.pareja_telefono,
            minutos_bloqueo=15,
        )
        cupos_reservados = 2
        costo_total = costo_unitario * 2
        partner_insc_id = insc_b.id
    elif body.es_free_agent and permite_indiv:
        insc = await crear_inscripcion_free_agent_pendiente(
            reta, body.nombre, body.telefono, minutos_bloqueo=15,
        )
        cupos_reservados = 1
        costo_total = costo_unitario
        partner_insc_id = None
    else:
        raise HTTPException(
            400,
            "Reta de parejas: debes inscribir a tu pareja o marcar 'inscribirme solo' "
            "(si el organizador lo permite).",
        )

    base = str(request.base_url).rstrip("/")
    success = body.success_url or (
        f"{base}/retas/{reta['url_slug']}?pago=ok&inscripcion={insc.id}&session_id={{CHECKOUT_SESSION_ID}}"
    )
    cancel = body.cancel_url or (
        f"{base}/retas/{reta['url_slug']}?pago=cancelado&inscripcion={insc.id}"
    )

    try:
        session = await payments_stripe.crear_session_checkout(
            monto_principal=float(costo_total),
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
        # Rollback pareja-aware
        if cupos_reservados == 2 and insc.pareja_grupo_id:
            await db.inscripciones.delete_many({"pareja_grupo_id": insc.pareja_grupo_id})
        else:
            await db.inscripciones.delete_one({"id": insc.id})
        await liberar_lugar(reta_id, cupos_reservados)
        raise HTTPException(502, f"Error con Stripe: {e}") from e

    tx = StripeTransaction(
        session_id=session.session_id, inscripcion_id=insc.id, reta_id=reta_id,
        jugador_id=insc.jugador_id, telefono=insc.telefono,
        amount=float(costo_total), currency="mxn",
    )
    tdoc = tx.model_dump()
    tdoc["creado_en"] = tdoc["creado_en"].isoformat()
    # Persist también atributos pareja-aware para rollback en webhook.
    tdoc["partner_inscripcion_id"] = partner_insc_id
    tdoc["pareja_grupo_id"] = insc.pareja_grupo_id
    tdoc["cupos_reservados"] = cupos_reservados
    await db.stripe_transactions.insert_one(tdoc)

    ids_a_actualizar = [insc.id]
    if partner_insc_id:
        ids_a_actualizar.append(partner_insc_id)
    await db.inscripciones.update_many(
        {"id": {"$in": ids_a_actualizar}},
        {"$set": {"stripe_session_id": session.session_id}},
    )

    return StripeCheckoutResponse(
        inscripcion_id=insc.id,
        checkout_url=session.url,
        session_id=session.session_id,
        monto_total=float(costo_total),
        cupos_reservados=int(cupos_reservados),
    )


async def _aplicar_resultado_pago(session_id: str, payment_status: str) -> dict:
    """Idempotente + pareja-aware: dado un session_id, actualiza la(s) inscripción(es)
    asociadas. Si la transacción incluye un partner_inscripcion_id (dúo), aplica
    el resultado a AMBAS inscripciones y libera/aprueba 2 cupos.
    """
    tx = await db.stripe_transactions.find_one({"session_id": session_id}, {"_id": 0})
    if not tx:
        return {"matched": False}

    if tx.get("payment_status") in ("paid", "failed", "expired"):
        return {"matched": True, "already": True, "estatus_pago": tx["payment_status"]}

    insc = await db.inscripciones.find_one({"id": tx["inscripcion_id"]}, {"_id": 0})

    # Resolver el conjunto de inscripciones afectadas (1 individual, 2 para pareja).
    cupos = int(tx.get("cupos_reservados") or 1)
    grupo_id = (insc or {}).get("pareja_grupo_id") or tx.get("pareja_grupo_id")
    if grupo_id:
        ids = [
            d["id"] async for d in db.inscripciones.find(
                {"pareja_grupo_id": grupo_id}, {"id": 1, "_id": 0},
            )
        ]
    else:
        ids = [tx["inscripcion_id"]] if insc else []

    if payment_status == "paid":
        if ids:
            await db.inscripciones.update_many(
                {"id": {"$in": ids}, "estatus_pago": "Pendiente"},
                {"$set": {"estatus_pago": "Aprobado", "bloqueado_hasta": None}},
            )
        await db.stripe_transactions.update_one(
            {"session_id": session_id}, {"$set": {"payment_status": "paid"}},
        )
        # Confirmación por email (fire-and-forget). Skip silencioso si no
        # tenemos email del comprador (Stripe puede no haberlo recolectado).
        try:
            reta = await db.retas.find_one({"id": tx["reta_id"]}, {"_id": 0})
            if reta and insc:
                await email_service.send_inscripcion_confirmada(
                    to=tx.get("payer_email"),
                    jugador=insc["nombre"],
                    reta_nombre=reta["nombre"],
                    club=reta.get("club", ""),
                    fecha_evento=str(reta.get("fecha_evento", "")),
                    inscripcion_id=tx["inscripcion_id"],
                    reta_slug=reta.get("url_slug", ""),
                )
        except Exception:
            logger.exception("email confirmación falló (no bloquea pago)")
        return {"matched": True, "estatus_pago": "Aprobado", "afectadas": len(ids)}

    if payment_status in ("failed", "expired", "unpaid"):
        if insc and ids:
            await db.inscripciones.delete_many({"id": {"$in": ids}})
            await liberar_lugar(tx["reta_id"], cupos)
            await promover_lista_espera(tx["reta_id"])
        await db.stripe_transactions.update_one(
            {"session_id": session_id}, {"$set": {"payment_status": payment_status}},
        )
        return {"matched": True, "estatus_pago": payment_status, "afectadas": len(ids)}

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
