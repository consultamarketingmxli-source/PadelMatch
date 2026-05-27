"""
Router Mercado Pago Marketplace.

Endpoints:
- POST /admin/mercadopago/connect       — admin pega su Access Token y lo guardamos
- POST /admin/mercadopago/disconnect    — limpia el token
- GET  /admin/mercadopago/status        — estado de la vinculación
- PATCH /admin/mercadopago/settings     — toggle apply_fee (futuro)
- POST /public/retas/{id}/checkout-mercadopago — crea preference y devuelve init_point
- POST /webhooks/mercadopago            — recibe notificaciones de MP
- GET  /public/inscripciones/{id}/mp-status — polling del pago

Reglas de negocio:
- Si un organizador (admin) NO tiene access_token_pasarela, NO se pueden vender
  inscripciones de sus retas (lockout 3a confirmado por el usuario).
- Por defecto: el 100% del pago va a la cuenta del organizador (sin marketplace_fee).
- El toggle `apply_fee` queda en BD para activar 10% de comisión a futuro sin redeploy.
"""
import logging
import os
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

import mercadopago_service as mps
from auth import get_current_admin
from core.db import db, ADMIN_EMAIL_DEFAULT
from core.helpers import crear_inscripcion_pendiente, promover_lista_espera

logger = logging.getLogger("padelappretas-os")
router = APIRouter(tags=["mercadopago"])


# ===================== Schemas =====================
class MpConnectRequest(BaseModel):
    access_token: str = Field(min_length=10, max_length=400)


class MpStatus(BaseModel):
    connected: bool
    mp_user_id: Optional[str] = None
    nickname: Optional[str] = None
    email: Optional[str] = None
    site_id: Optional[str] = None
    connected_at: Optional[str] = None
    apply_fee: bool = False
    fee_percent: float = 0.0


class MpSettingsUpdate(BaseModel):
    apply_fee: bool


class MpCheckoutCreate(BaseModel):
    nombre: str = Field(min_length=2, max_length=80)
    telefono: str = Field(min_length=6, max_length=20)
    success_url: Optional[str] = None
    cancel_url: Optional[str] = None
    payer_email: Optional[str] = None


class MpCheckoutResponse(BaseModel):
    inscripcion_id: str
    preference_id: str
    init_point: str
    sandbox_init_point: Optional[str] = None


class MpPaymentStatus(BaseModel):
    inscripcion_id: str
    estatus_pago: str
    mp_payment_id: Optional[str] = None
    mp_status: Optional[str] = None


# ===================== Helpers =====================
async def _admin_with_mp_for_reta(reta: dict) -> dict:
    """Recupera el documento de admin/organizador que cobra esta reta y
    que TIENE MP conectado. Si no, lanza 400 con mensaje claro."""
    organizador_id = reta.get("organizador_id") or "admin"
    # En el modelo actual solo hay un admin; lo identificamos por email default.
    admin = await db.admins.find_one({"email": ADMIN_EMAIL_DEFAULT}, {"_id": 0})
    if not admin:
        raise HTTPException(503, "Organizador no configurado.")
    if not admin.get("access_token_pasarela"):
        raise HTTPException(
            400,
            "Esta reta no puede recibir pagos: el organizador aún no ha vinculado su cuenta de Mercado Pago.",
        )
    return admin


# ===================== Endpoints admin =====================
@router.post("/admin/mercadopago/connect", response_model=MpStatus)
async def mp_connect(body: MpConnectRequest, current=Depends(get_current_admin)):
    """Vincula la cuenta MP del organizador validando su Access Token."""
    try:
        info = await mps.validar_access_token(body.access_token)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    except Exception as e:
        logger.exception("MP validate error")
        raise HTTPException(502, f"Mercado Pago no respondió: {e}") from e

    email = current.get("sub") or current.get("email")
    now_iso = datetime.now(timezone.utc).isoformat()
    update = {
        "access_token_pasarela": body.access_token.strip(),
        "mp_user_id": str(info.get("id")),
        "mp_nickname": info.get("nickname"),
        "mp_email": info.get("email"),
        "mp_site_id": info.get("site_id"),
        "mp_connected_at": now_iso,
    }
    # apply_fee se setea por defecto False solo en el connect inicial
    existing = await db.admins.find_one({"email": email}, {"mp_apply_fee": 1})
    if not existing or "mp_apply_fee" not in existing:
        update["mp_apply_fee"] = False

    await db.admins.update_one({"email": email}, {"$set": update})

    return MpStatus(
        connected=True,
        mp_user_id=update["mp_user_id"],
        nickname=update["mp_nickname"],
        email=update["mp_email"],
        site_id=update["mp_site_id"],
        connected_at=now_iso,
        apply_fee=update.get("mp_apply_fee", False),
        fee_percent=mps.PLATFORM_FEE_PERCENT,
    )


@router.post("/admin/mercadopago/disconnect")
async def mp_disconnect(current=Depends(get_current_admin)):
    """Desvincula la cuenta MP (borra el token y campos asociados)."""
    email = current.get("sub") or current.get("email")
    await db.admins.update_one(
        {"email": email},
        {"$unset": {
            "access_token_pasarela": "",
            "mp_user_id": "",
            "mp_nickname": "",
            "mp_email": "",
            "mp_site_id": "",
            "mp_connected_at": "",
        }},
    )
    return {"ok": True}


@router.get("/admin/mercadopago/status", response_model=MpStatus)
async def mp_status(current=Depends(get_current_admin)):
    email = current.get("sub") or current.get("email")
    admin = await db.admins.find_one({"email": email}, {"_id": 0}) or {}
    connected = bool(admin.get("access_token_pasarela"))
    return MpStatus(
        connected=connected,
        mp_user_id=admin.get("mp_user_id"),
        nickname=admin.get("mp_nickname"),
        email=admin.get("mp_email"),
        site_id=admin.get("mp_site_id"),
        connected_at=admin.get("mp_connected_at"),
        apply_fee=bool(admin.get("mp_apply_fee", False)),
        fee_percent=mps.PLATFORM_FEE_PERCENT,
    )


@router.patch("/admin/mercadopago/settings", response_model=MpStatus)
async def mp_update_settings(body: MpSettingsUpdate, current=Depends(get_current_admin)):
    email = current.get("sub") or current.get("email")
    await db.admins.update_one(
        {"email": email},
        {"$set": {"mp_apply_fee": bool(body.apply_fee)}},
    )
    return await mp_status(current)  # reuse


# ===================== Checkout público =====================
@router.post(
    "/public/retas/{reta_id}/checkout-mercadopago",
    response_model=MpCheckoutResponse,
)
async def checkout_mercadopago(reta_id: str, body: MpCheckoutCreate, request: Request):
    """Crea inscripción Pendiente + Preference MP del organizador.
    El dinero va 100% a la cuenta MP del organizador (no marketplace_fee por defecto).
    """
    reta = await db.retas.find_one({"id": reta_id}, {"_id": 0})
    if not reta:
        raise HTTPException(404, "Reta no encontrada")
    if float(reta.get("costo_inscripcion", 0)) < 10:
        raise HTTPException(400, "El costo de inscripción debe ser de al menos $10 MXN.")

    admin = await _admin_with_mp_for_reta(reta)
    access_token = admin["access_token_pasarela"]
    apply_fee = bool(admin.get("mp_apply_fee", False))

    insc = await crear_inscripcion_pendiente(reta, body.nombre, body.telefono, minutos_bloqueo=15)

    # MP rechaza localhost en back_urls. Usamos APP_PUBLIC_URL si está definido.
    public_base = os.getenv("APP_PUBLIC_URL", "").rstrip("/")
    base = public_base or str(request.base_url).rstrip("/")
    success = body.success_url or (
        f"{base}/retas/{reta['url_slug']}?pago=ok&inscripcion={insc.id}&provider=mp"
    )
    cancel = body.cancel_url or (
        f"{base}/retas/{reta['url_slug']}?pago=cancelado&inscripcion={insc.id}&provider=mp"
    )
    notification = f"{base}/api/webhooks/mercadopago"

    try:
        pref = await mps.crear_preferencia(
            access_token=access_token,
            nombre_reta=reta["nombre"],
            costo_mxn=float(reta["costo_inscripcion"]),
            success_url=success,
            cancel_url=cancel,
            notification_url=notification,
            external_reference=insc.id,
            payer_email=body.payer_email,
            apply_fee=apply_fee,
        )
    except Exception as e:
        logger.exception("MP preference error")
        await db.inscripciones.delete_one({"id": insc.id})
        raise HTTPException(502, f"Error con Mercado Pago: {e}") from e

    # Persistimos tracking server-side
    tx_doc = {
        "id": insc.id,  # reusamos id de inscripción como tracking principal
        "inscripcion_id": insc.id,
        "reta_id": reta_id,
        "jugador_id": insc.jugador_id,
        "telefono": insc.telefono,
        "amount": float(reta["costo_inscripcion"]),
        "currency": "MXN",
        "preference_id": pref["id"],
        "init_point": pref["init_point"],
        "sandbox_init_point": pref.get("sandbox_init_point"),
        "organizador_mp_user_id": admin.get("mp_user_id"),
        "apply_fee": apply_fee,
        "payment_status": "initiated",
        "creado_en": datetime.now(timezone.utc).isoformat(),
    }
    await db.mp_transactions.insert_one(tx_doc)

    await db.inscripciones.update_one(
        {"id": insc.id},
        {"$set": {"mp_preference_id": pref["id"]}},
    )

    # En sandbox el init_point real funciona igual; preferimos siempre init_point.
    return MpCheckoutResponse(
        inscripcion_id=insc.id,
        preference_id=pref["id"],
        init_point=pref["init_point"],
        sandbox_init_point=pref.get("sandbox_init_point"),
    )


# ===================== Webhook =====================
async def _aplicar_resultado_pago(inscripcion_id: str, mp_payment_id: str, mp_status: str) -> dict:
    """Idempotente: actualiza inscripción + tracking según el estado del pago."""
    tx = await db.mp_transactions.find_one({"inscripcion_id": inscripcion_id}, {"_id": 0})
    if not tx:
        return {"matched": False}

    if tx.get("payment_status") in ("approved", "rejected", "cancelled"):
        return {"matched": True, "already": True, "payment_status": tx["payment_status"]}

    insc = await db.inscripciones.find_one({"id": inscripcion_id}, {"_id": 0})

    if mp_status == "approved":
        if insc and insc["estatus_pago"] == "Pendiente":
            await db.inscripciones.update_one(
                {"id": inscripcion_id},
                {"$set": {"estatus_pago": "Aprobado", "bloqueado_hasta": None}},
            )
        await db.mp_transactions.update_one(
            {"inscripcion_id": inscripcion_id},
            {"$set": {
                "payment_status": "approved",
                "mp_payment_id": mp_payment_id,
                "aprobado_en": datetime.now(timezone.utc).isoformat(),
            }},
        )
        return {"matched": True, "estatus_pago": "Aprobado"}

    if mp_status in ("rejected", "cancelled", "refunded", "charged_back"):
        if insc and insc["estatus_pago"] == "Pendiente":
            await db.inscripciones.delete_one({"id": inscripcion_id})
            await promover_lista_espera(tx["reta_id"])
        await db.mp_transactions.update_one(
            {"inscripcion_id": inscripcion_id},
            {"$set": {"payment_status": mp_status, "mp_payment_id": mp_payment_id}},
        )
        return {"matched": True, "estatus_pago": mp_status}

    # pending / in_process / authorized — no cerramos aún
    await db.mp_transactions.update_one(
        {"inscripcion_id": inscripcion_id},
        {"$set": {"mp_payment_id": mp_payment_id, "last_mp_status": mp_status}},
    )
    return {"matched": True, "estatus_pago": mp_status, "pending": True}


@router.post("/webhooks/mercadopago")
async def webhook_mercadopago(request: Request):
    """Recibe notificaciones de MP. Idempotente.
    Estructuras soportadas:
      - { type: 'payment', data: { id: '...' } }
      - query params ?type=payment&data.id=...  (IPN legacy)
      - { topic: 'merchant_order', resource: 'https://.../merchant_orders/XXX' }
    """
    body_bytes = await request.body()
    try:
        payload = await request.json() if body_bytes else {}
    except Exception:
        payload = {}

    qp = dict(request.query_params)
    event_type = (
        payload.get("type")
        or payload.get("topic")
        or qp.get("type")
        or qp.get("topic")
        or ""
    ).lower()

    # event id para idempotencia
    event_id = payload.get("id") or qp.get("id") or f"{event_type}-{datetime.now(timezone.utc).timestamp()}"
    seen = await db.mp_events.find_one({"event_id": str(event_id)})
    if seen and event_id and "-" not in str(event_id):
        return {"ok": True, "duplicate": True}
    await db.mp_events.insert_one({
        "event_id": str(event_id),
        "type": event_type,
        "payload": payload,
        "query": qp,
        "creado_en": datetime.now(timezone.utc).isoformat(),
    })

    # Necesitamos el access_token del organizador. Lo obtenemos del admin único.
    admin = await db.admins.find_one({"email": ADMIN_EMAIL_DEFAULT}, {"_id": 0})
    if not admin or not admin.get("access_token_pasarela"):
        logger.warning("Webhook MP recibido pero no hay organizador conectado.")
        return {"ok": True, "ignored": True}
    access_token = admin["access_token_pasarela"]

    # 1) Payment notifications
    if event_type == "payment":
        payment_id = (
            (payload.get("data") or {}).get("id")
            or qp.get("data.id")
            or qp.get("id")
        )
        if not payment_id:
            return {"ok": True, "ignored": True}
        try:
            payment = await mps.obtener_pago(access_token, str(payment_id))
        except Exception as e:
            logger.exception("MP payment fetch failed: %s", e)
            return {"ok": True, "error": str(e)}
        ext_ref = payment.get("external_reference")
        status = payment.get("status")
        if ext_ref and status:
            result = await _aplicar_resultado_pago(ext_ref, str(payment_id), status)
            return {"ok": True, "event": "payment", **result}
        return {"ok": True, "ignored": True}

    # 2) merchant_order: contiene lista de pagos. Tomamos el último aprobado.
    if event_type == "merchant_order":
        order_id = (payload.get("data") or {}).get("id") or qp.get("id") or qp.get("data.id")
        resource = payload.get("resource") or ""
        if not order_id and resource:
            order_id = resource.rstrip("/").split("/")[-1]
        if not order_id:
            return {"ok": True, "ignored": True}
        try:
            mo = await mps.obtener_merchant_order(access_token, str(order_id))
        except Exception as e:
            logger.exception("MP merchant_order fetch failed")
            return {"ok": True, "error": str(e)}
        ext_ref = mo.get("external_reference")
        if not ext_ref:
            return {"ok": True, "ignored": True}
        # Buscamos el pago más relevante
        best_status = None
        best_payment_id = None
        for p in mo.get("payments", []) or []:
            s = p.get("status")
            if s == "approved":
                best_status, best_payment_id = s, str(p.get("id"))
                break
            if s in ("rejected", "cancelled") and not best_status:
                best_status, best_payment_id = s, str(p.get("id"))
        if best_status and best_payment_id:
            result = await _aplicar_resultado_pago(ext_ref, best_payment_id, best_status)
            return {"ok": True, "event": "merchant_order", **result}
        return {"ok": True, "ignored": True}

    return {"ok": True, "ignored": True, "type": event_type}


# ===================== Polling status =====================
@router.get(
    "/public/inscripciones/{inscripcion_id}/mp-status",
    response_model=MpPaymentStatus,
)
async def mp_payment_status(inscripcion_id: str):
    insc = await db.inscripciones.find_one({"id": inscripcion_id}, {"_id": 0})
    tx = await db.mp_transactions.find_one({"inscripcion_id": inscripcion_id}, {"_id": 0})

    if not insc and not tx:
        raise HTTPException(404, "Inscripción no encontrada")

    # Proactivo: si todavía está Pendiente y tenemos preference_id, intentamos buscar pagos.
    if insc and insc["estatus_pago"] == "Pendiente" and tx and tx.get("preference_id"):
        admin = await db.admins.find_one({"email": ADMIN_EMAIL_DEFAULT}, {"_id": 0})
        access_token = admin.get("access_token_pasarela") if admin else None
        if access_token:
            try:
                import httpx
                async with httpx.AsyncClient(timeout=8.0) as client:
                    resp = await client.get(
                        f"{mps.MP_API_BASE}/v1/payments/search",
                        params={"external_reference": inscripcion_id},
                        headers={"Authorization": f"Bearer {access_token}"},
                    )
                if resp.status_code == 200:
                    results = resp.json().get("results", []) or []
                    # Priorizamos approved
                    chosen = None
                    for p in results:
                        if p.get("status") == "approved":
                            chosen = p
                            break
                    if not chosen and results:
                        chosen = results[0]
                    if chosen:
                        await _aplicar_resultado_pago(
                            inscripcion_id, str(chosen.get("id")), chosen.get("status"),
                        )
                        insc = await db.inscripciones.find_one({"id": inscripcion_id}, {"_id": 0}) or insc
                        tx = await db.mp_transactions.find_one({"inscripcion_id": inscripcion_id}, {"_id": 0}) or tx
            except Exception as e:
                logger.warning("MP poll search error: %s", e)

    return MpPaymentStatus(
        inscripcion_id=inscripcion_id,
        estatus_pago=(insc or {}).get("estatus_pago", "Cancelado"),
        mp_payment_id=(tx or {}).get("mp_payment_id"),
        mp_status=(tx or {}).get("payment_status") or (tx or {}).get("last_mp_status"),
    )
