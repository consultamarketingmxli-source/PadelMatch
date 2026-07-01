"""Iter51 — Open Reta Pre-authorization workflow (MP hold + capture).

Flow:
  1. `POST /api/retas/join-request`  → hold funds (capture=False) + insert doc.
  2. `POST /api/retas/decide-request` → approve (capture) o reject (cancel hold).
  3. Background job `join_request_auto_expire` corre 2h antes del match
     y auto-rechaza cualquier request que siga en pending_approval
     (liberando la retención en tarjeta al 0% de comisión).

Concurrency safety:
  • approve dispara `reservar_lugar_atomico(reta_id)` que usa `$inc + $expr <`
    para prevenir race conditions en el último cupo (patrón ya probado en 78 tests).
  • Si la reserva falla → refund del hold + 409 al cliente.
  • Si el capture MP falla después de la reserva → rollback (`liberar_lugar`).
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Literal, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, EmailStr, Field

import mercadopago_service as mps
from core.concurrency import liberar_lugar, reservar_lugar_atomico
from core.db import db
from core.crypto import decrypt_token
from services import email_service, push_service
from services.jobs_worker import enqueue

logger = logging.getLogger("padelappretas-os")
router = APIRouter(tags=["join-requests"])

# Nombre del handler registrado en jobs_worker (ver server.py).
JOB_AUTO_EXPIRE = "join_request_auto_expire"
# Ventana antes del match en la que auto-expiramos requests pendientes.
AUTO_EXPIRE_LEAD_HOURS = 2


# ───────────────────────────── Pydantic models ─────────────────────────────
class JoinRequestCreate(BaseModel):
    match_id: str = Field(min_length=1, max_length=64)
    player_id: str = Field(min_length=1, max_length=64)
    amount: float = Field(gt=0, le=100000)
    card_token: str = Field(min_length=8, max_length=128)
    payer_email: EmailStr
    installments: int = Field(default=1, ge=1, le=12)
    payment_method_id: Optional[str] = None  # opcional (visa/master/amex...)


class DecideRequestBody(BaseModel):
    request_id: str = Field(min_length=8, max_length=64)
    action: Literal["approve", "reject"]
    motivo: Optional[str] = Field(default=None, max_length=240)


class JoinRequestOut(BaseModel):
    id: str
    match_id: str
    player_id: str
    payment_id: str
    status: str
    created_at: str


# ─────────────────────────────── Helpers ──────────────────────────────────
async def _resolve_organizer_token(reta: dict) -> str:
    """Obtiene el access_token de MP del organizador dueno de la reta.

    El token vive encriptado en `admins.access_token_pasarela` con Fernet.
    Reutilizamos el mismo helper `decrypt_token` que el resto del stack.
    """
    org_id = reta.get("organizador_id")
    if not org_id:
        raise HTTPException(400, "Reta sin organizador asignado.")
    admin = await db.admins.find_one({"id": org_id}, {"_id": 0})
    if not admin:
        # Fallback: buscar por email default (single-tenant setups).
        admin = await db.admins.find_one(
            {"email": "admin@padelappretas.com"}, {"_id": 0},
        )
    if not admin or not admin.get("access_token_pasarela"):
        raise HTTPException(
            424,
            "El organizador no tiene Mercado Pago conectado. Contacta al organizador.",
        )
    token = decrypt_token(admin["access_token_pasarela"])
    if not token:
        raise HTTPException(500, "No se pudo desencriptar el token MP.")
    return token


def _parse_iso(dt: str | None) -> Optional[datetime]:
    if not dt:
        return None
    try:
        return datetime.fromisoformat(dt.replace("Z", "+00:00"))
    except Exception:  # pylint: disable=broad-except
        return None


# ───────────────────────────── Endpoints ───────────────────────────────
@router.post("/retas/join-request", status_code=201, response_model=JoinRequestOut)
async def crear_join_request(body: JoinRequestCreate) -> JoinRequestOut:
    """1) Retiene fondos en tarjeta (capture=False) y persiste el join_request.

    Idempotencia: `player_id + match_id + created_within_1h` — si ya existe uno
    pendiente para este par, retornamos 409 en lugar de duplicar hold.

    Programa auto-expiración via jobs_queue con delay = (fecha_evento - 2h - now).
    """
    reta = await db.retas.find_one({"id": body.match_id}, {"_id": 0})
    if not reta:
        raise HTTPException(404, "Reta no encontrada.")
    if str(reta.get("status_public") or reta.get("status") or "open").lower() in ("cancelled", "full"):
        raise HTTPException(409, "La reta ya no acepta pre-autorizaciones.")

    # Anti-duplicación: no permitir dos holds pendientes del mismo player para
    # la misma reta (evita bloquear 2x el mismo dinero por error de UI).
    existing = await db.join_requests.find_one({
        "match_id": body.match_id, "player_id": body.player_id,
        "status": "pending_approval",
    }, {"_id": 0})
    if existing:
        raise HTTPException(
            409,
            f"Ya tienes un join_request pendiente para esta reta "
            f"(payment_id={existing.get('payment_id')}).",
        )

    access_token = await _resolve_organizer_token(reta)

    # Hold via MP con capture=False. Idempotency-Key evita doble cargo en retries.
    idem = f"join-{body.player_id}-{body.match_id}-{uuid.uuid4().hex[:8]}"
    try:
        payment = await mps.hold_funds(
            access_token=access_token,
            amount=body.amount,
            card_token=body.card_token,
            payer_email=str(body.payer_email),
            installments=body.installments,
            payment_method_id=body.payment_method_id,
            idempotency_key=idem,
            metadata={
                "match_id": body.match_id, "player_id": body.player_id,
                "flow": "open_reta_preauth",
            },
        )
    except Exception as e:  # pylint: disable=broad-except
        logger.exception("[join-request] MP hold_funds falló: %s", str(e)[:160])
        raise HTTPException(502, f"Error de Mercado Pago: {str(e)[:180]}") from e

    # MP devuelve status="authorized" (o "in_process") cuando el hold tuvo éxito.
    # Cualquier otro status significa rechazo/error → no persistimos.
    if payment.get("status") not in ("authorized", "in_process", "pending"):
        raise HTTPException(
            402,
            f"Tarjeta rechazada: {payment.get('status_detail') or payment.get('status')}",
        )

    now = datetime.now(timezone.utc)
    doc = {
        "id": str(uuid.uuid4()),
        "match_id": body.match_id,
        "player_id": body.player_id,
        "payment_id": str(payment["id"]),
        "amount": body.amount,
        "payer_email": str(body.payer_email),
        "status": "pending_approval",
        "mp_status": payment.get("status"),
        "mp_status_detail": payment.get("status_detail"),
        "created_at": now.isoformat(),
        "idempotency_key": idem,
    }
    await db.join_requests.insert_one(doc)

    # Programa auto-expire 2h antes del match.
    fecha_evento = _parse_iso(str(reta.get("fecha_evento") or reta.get("start_time") or ""))
    if fecha_evento:
        if fecha_evento.tzinfo is None:
            fecha_evento = fecha_evento.replace(tzinfo=timezone.utc)
        delay = max(0, int((fecha_evento - now).total_seconds()) - AUTO_EXPIRE_LEAD_HOURS * 3600)
        await enqueue(
            job_type=JOB_AUTO_EXPIRE,
            payload={"request_id": doc["id"]},
            delay_seconds=delay,
            idempotency_key=f"expire-{doc['id']}",
        )

    logger.info(
        "[join-request] creado · request=%s match=%s player=%s payment=%s hold=%s MXN",
        doc["id"], body.match_id, body.player_id, doc["payment_id"], body.amount,
    )
    return JoinRequestOut(
        id=doc["id"], match_id=doc["match_id"], player_id=doc["player_id"],
        payment_id=doc["payment_id"], status=doc["status"], created_at=doc["created_at"],
    )


@router.post("/retas/decide-request")
async def decidir_join_request(body: DecideRequestBody) -> dict:
    """2) Approve/reject de un join_request.

    Approve: reserva cupo atómicamente → captura fondos → crea inscripción.
    Reject:  libera el hold (0% comisión para el jugador).

    Idempotente: llamadas posteriores sobre un request ya `approved`/`rejected`
    retornan el estado actual sin re-ejecutar la lógica de pago.
    """
    req = await db.join_requests.find_one({"id": body.request_id}, {"_id": 0})
    if not req:
        raise HTTPException(404, "join_request no encontrado.")
    if req["status"] in ("approved", "rejected", "expired", "failed"):
        return {"success": True, "status": req["status"], "already_processed": True}

    reta = await db.retas.find_one({"id": req["match_id"]}, {"_id": 0})
    if not reta:
        raise HTTPException(404, "Reta asociada no encontrada.")

    access_token = await _resolve_organizer_token(reta)

    if body.action == "approve":
        # 1) Reserva cupo (evita race condition en el último lugar).
        reservada = await reservar_lugar_atomico(req["match_id"])
        if not reservada:
            # Reta llena → rollback automático del hold + reject.
            try:
                await mps.cancel_hold(access_token=access_token, payment_id=req["payment_id"])
            except Exception:  # pylint: disable=broad-except
                logger.exception("[decide] cancel_hold falló tras reta llena")
            await db.join_requests.update_one(
                {"id": req["id"]},
                {"$set": {
                    "status": "rejected",
                    "decided_at": datetime.now(timezone.utc).isoformat(),
                    "decision_reason": "reta_llena_al_decidir",
                }},
            )
            raise HTTPException(409, "La reta se llenó antes de aprobar. Hold liberado.")

        # 2) Captura fondos en MP.
        try:
            captured = await mps.capture_funds(
                access_token=access_token, payment_id=req["payment_id"],
            )
        except Exception as e:  # pylint: disable=broad-except
            # Rollback del cupo si el capture falló.
            await liberar_lugar(req["match_id"], 1)
            await db.join_requests.update_one(
                {"id": req["id"]},
                {"$set": {
                    "status": "failed",
                    "decided_at": datetime.now(timezone.utc).isoformat(),
                    "decision_reason": f"capture_failed: {str(e)[:180]}",
                }},
            )
            raise HTTPException(502, f"MP capture falló: {str(e)[:180]}") from e

        # 3) Persistir status + crear inscripción Aprobada.
        now_iso = datetime.now(timezone.utc).isoformat()
        await db.join_requests.update_one(
            {"id": req["id"]},
            {"$set": {
                "status": "approved", "decided_at": now_iso,
                "mp_captured_at": now_iso,
                "mp_status": captured.get("status"),
            }},
        )
        insc_id = str(uuid.uuid4())
        await db.inscripciones.insert_one({
            "id": insc_id,
            "reta_id": req["match_id"],
            "jugador_id": req["player_id"],
            "nombre": req.get("player_name") or req["player_id"],
            "telefono": req.get("payer_phone") or "",
            "estatus_pago": "Aprobado",
            "tipo_inscripcion": "DIRECTA_APP",
            "metodo_pago": "online",
            "origen_join_request_id": req["id"],
            "creado_en": now_iso,
        })

        # 4) Notificaciones (fire-and-forget).
        try:
            await email_service.send_join_request_approved(
                to=req["payer_email"], reta_nombre=reta.get("nombre", "tu reta"),
                fecha_evento=str(reta.get("fecha_evento", "")),
                amount=req["amount"],
            )
            await push_service.send_high_priority_push(
                jugador_id=req["player_id"],
                title="¡Aprobado! Tu cupo está confirmado",
                body=f"El organizador aprobó tu solicitud para {reta.get('nombre', 'la reta')}.",
                deeplink=f"padelappretas://retas/{reta.get('url_slug', req['match_id'])}",
            )
        except Exception:  # pylint: disable=broad-except
            logger.exception("[decide] notif approve falló (no bloquea)")

        return {"success": True, "status": "approved", "inscripcion_id": insc_id}

    # ─── action == "reject" ───
    try:
        await mps.cancel_hold(access_token=access_token, payment_id=req["payment_id"])
    except Exception as e:  # pylint: disable=broad-except
        logger.exception("[decide] cancel_hold falló: %s", str(e)[:160])
        raise HTTPException(502, f"MP cancel_hold falló: {str(e)[:180]}") from e

    now_iso = datetime.now(timezone.utc).isoformat()
    await db.join_requests.update_one(
        {"id": req["id"]},
        {"$set": {
            "status": "rejected", "decided_at": now_iso,
            "decision_reason": body.motivo or "organizer_rejected",
        }},
    )
    try:
        await email_service.send_join_request_rejected(
            to=req["payer_email"], reta_nombre=reta.get("nombre", "tu reta"),
            motivo=body.motivo,
        )
    except Exception:  # pylint: disable=broad-except
        logger.exception("[decide] notif reject falló (no bloquea)")

    return {"success": True, "status": "rejected"}


# ───────────────────────────── Handler para jobs_worker ──────────────────────────
async def handle_join_request_auto_expire(payload: dict) -> None:
    """Job handler: expira un join_request si sigue pendiente 2h antes del match.

    Se registra en `server.py` bajo el tipo `join_request_auto_expire`.
    Ejecuta el mismo flujo que un reject manual (cancel_hold + status update).
    """
    request_id = payload.get("request_id")
    if not request_id:
        logger.warning("[auto-expire] payload sin request_id: %s", payload)
        return
    req = await db.join_requests.find_one({"id": request_id}, {"_id": 0})
    if not req:
        return  # ya limpiado
    if req["status"] != "pending_approval":
        return  # ya fue decidido manualmente

    reta = await db.retas.find_one({"id": req["match_id"]}, {"_id": 0})
    if not reta:
        # Reta borrada — forzamos expired sin llamar MP.
        await db.join_requests.update_one(
            {"id": req["id"]},
            {"$set": {
                "status": "expired", "decided_at": datetime.now(timezone.utc).isoformat(),
                "decision_reason": "reta_deleted_before_decision",
            }},
        )
        return

    try:
        access_token = await _resolve_organizer_token(reta)
        await mps.cancel_hold(access_token=access_token, payment_id=req["payment_id"])
    except Exception as e:  # pylint: disable=broad-except
        logger.exception("[auto-expire] cancel_hold falló (marcamos expired igual): %s", str(e)[:120])

    await db.join_requests.update_one(
        {"id": req["id"]},
        {"$set": {
            "status": "expired",
            "decided_at": datetime.now(timezone.utc).isoformat(),
            "decision_reason": f"auto_expired_{AUTO_EXPIRE_LEAD_HOURS}h_before_match",
        }},
    )
    try:
        await email_service.send_join_request_rejected(
            to=req["payer_email"], reta_nombre=reta.get("nombre", "tu reta"),
            motivo="El organizador no aprobó tu solicitud a tiempo. Tu hold fue liberado.",
        )
    except Exception:  # pylint: disable=broad-except
        pass
    logger.info("[auto-expire] request=%s expirado (2h pre-match)", request_id)
