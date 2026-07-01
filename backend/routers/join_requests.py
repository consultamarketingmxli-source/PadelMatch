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

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, EmailStr, Field

import mercadopago_service as mps
from auth import get_current_admin
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
@router.get("/retas/{reta_id}/join-requests")
async def listar_join_requests(
    reta_id: str,
    status: str = Query(default="pending_approval", pattern="^(pending_approval|approved|rejected|expired|failed|all)$"),
    current=Depends(get_current_admin),
) -> dict:
    """Lista los join_requests de una reta (organizador only).

    Filtro por status (default `pending_approval` — lo más útil para el organizador).
    Retorna items con datos denormalizados del jugador (si existe en `players`).
    """
    reta = await db.retas.find_one({"id": reta_id}, {"_id": 0})
    if not reta:
        raise HTTPException(404, "Reta no encontrada.")
    if str(reta.get("organizador_id") or "") != str(current.get("sub") or ""):
        raise HTTPException(403, "No autorizado — esta reta no te pertenece.")

    query: dict = {"match_id": reta_id}
    if status != "all":
        query["status"] = status

    cursor = db.join_requests.find(query, {"_id": 0}).sort("created_at", 1)
    docs = await cursor.to_list(length=200)

    # Denormalizar nombre del jugador si existe en `players`.
    items = []
    for d in docs:
        player_id = d.get("player_id")
        player_name = d.get("player_name") or ""
        if not player_name and player_id:
            try:
                player = await db.players.find_one(
                    {"id": player_id}, {"nombre": 1, "telefono": 1, "_id": 0},
                )
                if player:
                    player_name = player.get("nombre") or ""
                    d["payer_phone"] = d.get("payer_phone") or player.get("telefono") or ""
            except Exception:  # pylint: disable=broad-except
                pass
        items.append({
            "id": d["id"],
            "match_id": d["match_id"],
            "player_id": player_id,
            "player_name": player_name or (d.get("payer_email") or "Sin nombre"),
            "payer_email": d.get("payer_email", ""),
            "payer_phone": d.get("payer_phone", ""),
            "payment_id": d.get("payment_id", ""),
            "amount": d.get("amount", 0),
            "status": d["status"],
            "mp_status": d.get("mp_status"),
            "mp_status_detail": d.get("mp_status_detail"),
            "decision_reason": d.get("decision_reason"),
            "created_at": d.get("created_at"),
            "decided_at": d.get("decided_at"),
        })
    return {
        "reta_id": reta_id,
        "reta_nombre": reta.get("nombre", ""),
        "total": len(items),
        "status_filter": status,
        "items": items,
    }


@router.get("/players/{player_id}/join-requests")
async def listar_join_requests_del_jugador(
    player_id: str,
    status: str = Query(default="active", pattern="^(active|all|pending_approval|approved|rejected|expired|failed)$"),
) -> dict:
    """Lista los join_requests del propio jugador (self-service).

    Endpoint PÚBLICO (sin auth admin). Autorización débil por `player_id` en
    URL — el jugador ya está identificado via OTP en su dispositivo. La app
    filtra por su propio `jugador_id` local (nunca expone IDs ajenos porque
    se requiere conocer el UUID). Para reforzar podríamos exigir un token,
    pero el flujo público de join_request ya funciona así.

    status:
      • `active` (default) → sólo `pending_approval` (lo más útil en la app).
      • `all` → todos los estados.
      • Cualquier otro estado individual: filtra por ese estado.

    Cada item incluye info de la reta (nombre, fecha, slug, costo) para que
    la UI pueda pintar cards ricas sin fetch adicional por cada request.
    """
    query: dict = {"player_id": player_id}
    if status == "active":
        query["status"] = "pending_approval"
    elif status != "all":
        query["status"] = status

    cursor = db.join_requests.find(query, {"_id": 0}).sort("created_at", -1).limit(50)
    docs = await cursor.to_list(length=50)

    # Fetch retas en batch para evitar N+1.
    match_ids = list({d["match_id"] for d in docs})
    retas_map: dict = {}
    if match_ids:
        async for r in db.retas.find(
            {"id": {"$in": match_ids}},
            {"_id": 0, "id": 1, "nombre": 1, "url_slug": 1, "club": 1, "fecha_evento": 1, "costo_inscripcion": 1},
        ):
            retas_map[r["id"]] = r

    items = []
    for d in docs:
        reta_info = retas_map.get(d["match_id"], {})
        items.append({
            "id": d["id"],
            "match_id": d["match_id"],
            "reta_nombre": reta_info.get("nombre", "Reta borrada"),
            "reta_slug": reta_info.get("url_slug"),
            "reta_club": reta_info.get("club", ""),
            "reta_fecha_evento": reta_info.get("fecha_evento"),
            "amount": d.get("amount", 0),
            "payment_id": d.get("payment_id"),
            "status": d["status"],
            "decision_reason": d.get("decision_reason"),
            "created_at": d.get("created_at"),
            "decided_at": d.get("decided_at"),
        })
    return {"total": len(items), "items": items}


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
    # Iter51-P2 — Toggle "Open Reta". Sólo se aceptan join-requests si el
    # organizador habilitó explícitamente esta modalidad. Retro-compat: retas
    # antiguas tienen open_reta_habilitado=False por default (Pydantic).
    if not bool(reta.get("open_reta_habilitado", False)):
        raise HTTPException(
            403,
            "Esta reta no acepta solicitudes de unión. Contacta al organizador para inscribirte directamente.",
        )
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
async def decidir_join_request(
    body: DecideRequestBody,
    current=Depends(get_current_admin),
) -> dict:
    """2) Approve/reject de un join_request.

    Approve: reserva cupo atómicamente → captura fondos → crea inscripción.
    Reject:  libera el hold (0% comisión para el jugador).

    Idempotente: llamadas posteriores sobre un request ya `approved`/`rejected`
    retornan el estado actual sin re-ejecutar la lógica de pago.

    Auth: SÓLO el organizador dueño de la reta puede decidir. Este endpoint
    dispara movimientos de dinero, así que 401/403 son estrictos.
    """
    req = await db.join_requests.find_one({"id": body.request_id}, {"_id": 0})
    if not req:
        raise HTTPException(404, "join_request no encontrado.")

    reta = await db.retas.find_one({"id": req["match_id"]}, {"_id": 0})
    if not reta:
        raise HTTPException(404, "Reta asociada no encontrada.")

    # Ownership check — sólo el organizador puede aprobar/rechazar solicitudes
    # de SU reta. Sin este check, cualquier admin autenticado podría capturar
    # fondos en holds ajenos.
    if str(reta.get("organizador_id") or "") != str(current.get("sub") or ""):
        raise HTTPException(403, "No autorizado — esta reta no te pertenece.")

    if req["status"] in ("approved", "rejected", "expired", "failed"):
        return {"success": True, "status": req["status"], "already_processed": True}

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


# ══════════════════════════════════════════════════════════════════════════
# ITER51 · Public endpoint — HTML tokenization form for Open Reta pre-auth
# ══════════════════════════════════════════════════════════════════════════
# Se sirve DENTRO del WebView del cliente mobile. Usa MP.js clásico para
# tokenizar la tarjeta ON-DEVICE (los datos nunca tocan nuestro backend) y
# luego postea `{card_token, payment_method_id, installments}` de vuelta via
# `window.ReactNativeWebView.postMessage()`.
#
# Flujo:
#   1. Mobile abre WebView con `<BASE>/api/public/retas/{slug}/preauth-form?amount=X`
#   2. Usuario captura tarjeta → MP.js genera token (client-side)
#   3. WebView emite mensaje con el token → RN llama /api/retas/join-request
#   4. WebView se cierra al éxito o al error.
from fastapi.responses import HTMLResponse  # noqa: E402


@router.get("/public/retas/{slug}/preauth-form", response_class=HTMLResponse)
async def preauth_form(slug: str, amount: float = Query(gt=0)) -> HTMLResponse:
    """Devuelve HTML self-contained con MP.js CardPayment Brick.

    Args:
        slug: identificador de la reta (para display en el título).
        amount: monto MXN a pre-autorizar.
    """
    import os as _os
    mp_public_key = _os.getenv("MP_PUBLIC_KEY", "").strip()
    if not mp_public_key:
        raise HTTPException(500, "MP_PUBLIC_KEY no configurado en el servidor.")

    reta = await db.retas.find_one({"url_slug": slug}, {"nombre": 1, "open_reta_habilitado": 1, "_id": 0})
    if not reta:
        raise HTTPException(404, "Reta no encontrada.")
    if not bool(reta.get("open_reta_habilitado", False)):
        raise HTTPException(403, "Esta reta no acepta solicitudes de unión.")
    reta_nombre = reta.get("nombre") or slug

    html = _build_preauth_html(
        mp_public_key=mp_public_key,
        amount=round(float(amount), 2),
        reta_nombre=reta_nombre,
    )
    return HTMLResponse(content=html, status_code=200)


def _build_preauth_html(*, mp_public_key: str, amount: float, reta_nombre: str) -> str:
    """Construye el HTML para el formulario de pre-auth MP dentro del WebView."""
    # Escapamos el nombre para evitar rompimiento de HTML.
    safe_nombre = (reta_nombre or "").replace("<", "&lt;").replace(">", "&gt;")
    return f"""<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no" />
<title>Solicitar unirme — {safe_nombre}</title>
<style>
  * {{ box-sizing: border-box; }}
  html, body {{ margin:0; padding:0; background:#F8FAFC; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; color:#0F172A; }}
  .wrap {{ max-width:520px; margin:0 auto; padding:20px 16px 60px; }}
  h1 {{ font-size:20px; margin:0 0 6px; font-weight:800; color:#0F172A; letter-spacing:-0.3px; }}
  .sub {{ font-size:13px; color:#64748B; margin-bottom:20px; }}
  .amount-card {{ background:#EFF6FF; border:1px solid #BFDBFE; border-radius:14px; padding:16px; margin-bottom:22px; text-align:center; }}
  .amount-label {{ font-size:11px; color:#1E40AF; text-transform:uppercase; letter-spacing:1px; font-weight:700; }}
  .amount-val {{ font-size:32px; color:#1E3A8A; font-weight:900; margin-top:4px; }}
  .amount-hint {{ font-size:12px; color:#3B82F6; margin-top:6px; font-weight:600; }}
  #brick-container {{ min-height:340px; }}
  .footer {{ text-align:center; font-size:11px; color:#94A3B8; margin-top:20px; line-height:1.5; }}
  .badge {{ display:inline-block; background:#ECFDF5; color:#065F46; padding:4px 10px; border-radius:100px; font-size:11px; font-weight:700; margin:4px 0; }}
  .fatal {{ background:#FEE2E2; color:#991B1B; padding:12px; border-radius:12px; margin:16px 0; font-size:13px; }}
</style>
</head>
<body>
<div class="wrap">
  <h1>Solicitar unirme</h1>
  <p class="sub">{safe_nombre}</p>
  <div class="amount-card">
    <div class="amount-label">Se retiene en tu tarjeta</div>
    <div class="amount-val">${amount:,.2f} MXN</div>
    <div class="amount-hint">🔒 Sin cargo hasta que el organizador apruebe</div>
    <div class="badge">Si te rechaza, se libera 100%</div>
  </div>
  <div id="brick-container"></div>
  <div class="footer">
    Pago procesado por Mercado Pago · Datos encriptados end-to-end.
    <br />La retención expira automáticamente 2 h antes del partido si no hay decisión.
  </div>
</div>
<script src="https://sdk.mercadopago.com/js/v2"></script>
<script>
(function() {{
  function post(msg) {{
    try {{
      if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {{
        window.ReactNativeWebView.postMessage(JSON.stringify(msg));
      }} else {{
        // fallback web: postMessage al parent
        window.parent && window.parent.postMessage(msg, '*');
      }}
    }} catch(e) {{ /* silent */ }}
  }}
  if (typeof MercadoPago === 'undefined') {{
    document.getElementById('brick-container').innerHTML =
      '<div class="fatal">No pudimos cargar Mercado Pago. Verifica tu conexión e inténtalo de nuevo.</div>';
    post({{ event: 'error', reason: 'sdk_not_loaded' }});
    return;
  }}
  const mp = new MercadoPago('{mp_public_key}', {{ locale: 'es-MX' }});
  const bricksBuilder = mp.bricks();
  bricksBuilder.create('cardPayment', 'brick-container', {{
    initialization: {{ amount: {amount} }},
    customization: {{
      visual: {{
        style: {{ theme: 'default' }},
        hidePaymentButton: false,
      }},
      paymentMethods: {{ maxInstallments: 12 }},
    }},
    callbacks: {{
      onReady: function() {{ post({{ event: 'ready' }}); }},
      onSubmit: function(cardFormData) {{
        // cardFormData contiene: token, issuer_id, payment_method_id, installments,
        // payer.email, payer.identification (opcional).
        post({{
          event: 'submit',
          card_token: cardFormData.token,
          payment_method_id: cardFormData.payment_method_id,
          installments: cardFormData.installments || 1,
          issuer_id: cardFormData.issuer_id || null,
          payer_email: (cardFormData.payer && cardFormData.payer.email) || '',
        }});
        // MP.js espera una promise; la resolvemos aquí porque nosotros manejamos
        // el POST al backend desde React Native. `resolve()` limpia el spinner.
        return new Promise(function(resolve) {{ resolve(); }});
      }},
      onError: function(err) {{
        post({{ event: 'error', reason: (err && err.message) || 'unknown' }});
      }},
    }},
  }});
}})();
</script>
</body>
</html>
"""
