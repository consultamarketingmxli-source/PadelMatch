"""
Soporte público + Alertas — Fase B (Soporte Integral y Operaciones en Vivo).

Endpoints públicos (sin auth, lo usa el jugador desde /retas/[slug]):
    POST /api/public/retas/{slug}/soporte/alertar-organizador
        Registra una alerta para que el organizador la vea en su dashboard,
        y SI tiene WhatsApp configurado, envía WhatsApp.
    POST /api/public/retas/{slug}/soporte/reportar-ausencia
        Marca la inscripción del jugador como `ausencia_reportada` y notifica
        al organizador.

Endpoints admin (auth requerida):
    GET   /api/admin/alertas/pendientes?reta_id=...     Lista alertas no leídas.
    PATCH /api/admin/alertas/{alerta_id}/leida          Marca como leída.
    PATCH /api/admin/me/whatsapp                        Setea el WhatsApp del admin.
    GET   /api/admin/me                                 Devuelve perfil admin.

Rate limit:
    Cada (slug, telefono_player, tipo) tiene cooldown de 60s en memoria.

Mascarado de teléfono:
    Nunca devolvemos el WhatsApp del organizador al cliente; solo `enviado: bool`
    y `canal: "whatsapp" | "ninguno"`.
"""
from __future__ import annotations

import logging
import time
import uuid
from datetime import datetime, timezone
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from auth import get_current_admin
from core.db import db
from core.validators import NombreStr, PhoneStr
from notifications import is_twilio_configured, send_whatsapp

logger = logging.getLogger("padelappretas-os")

router_public = APIRouter(prefix="/public/retas", tags=["soporte-public"])
router_admin = APIRouter(prefix="/admin", tags=["soporte-admin"])


# ============================================================================
# Pydantic — bodies/responses
# ============================================================================
class AlertarOrganizadorRequest(BaseModel):
    nombre: NombreStr
    telefono: PhoneStr
    motivo: str = Field(min_length=2, max_length=240)


class ReportarAusenciaRequest(BaseModel):
    nombre: NombreStr
    telefono: PhoneStr
    motivo: Optional[str] = Field(default=None, max_length=240)


class SoporteResponse(BaseModel):
    ok: bool
    enviado_whatsapp: bool
    canal: Literal["whatsapp", "registro"]
    mensaje: str
    alerta_id: str


class AdminWhatsappPatch(BaseModel):
    telefono_whatsapp: Optional[PhoneStr] = None  # None permite limpiar


# ============================================================================
# Rate limiter (en memoria, suficiente para MVP single-pod)
# ============================================================================
_RATE_LIMIT: dict[str, float] = {}
_COOLDOWN_S = 60


def _rate_check_or_429(key: str) -> None:
    now = time.time()
    # Cleanup oportunista (evita leak en proceso largo).
    if len(_RATE_LIMIT) > 5000:
        for k in [k for k, t in _RATE_LIMIT.items() if now - t > 600]:
            _RATE_LIMIT.pop(k, None)
    last = _RATE_LIMIT.get(key, 0.0)
    if now - last < _COOLDOWN_S:
        retry_in = int(_COOLDOWN_S - (now - last))
        raise HTTPException(
            status_code=429,
            detail=f"Espera {retry_in}s antes de volver a enviar otra alerta.",
        )
    _RATE_LIMIT[key] = now


# ============================================================================
# Helpers
# ============================================================================
async def _get_reta_by_slug_or_404(slug: str) -> dict:
    reta = await db.retas.find_one({"url_slug": slug}, {"_id": 0})
    if not reta:
        raise HTTPException(404, "Reta no encontrada")
    return reta


async def _get_organizador_phone(organizador_id: str) -> Optional[str]:
    """Devuelve el WhatsApp del organizador si lo tiene configurado."""
    # `organizador_id` es el sub del JWT — puede ser "admin" o un email.
    # Buscamos por id primero, fallback por email.
    admin = await db.admins.find_one(
        {"$or": [{"id": organizador_id}, {"email": organizador_id}]},
        {"_id": 0, "telefono_whatsapp": 1, "email": 1, "id": 1},
    )
    if not admin:
        return None
    raw = (admin.get("telefono_whatsapp") or "").strip()
    return raw if raw.startswith("+") and len(raw) >= 8 else None


async def _crear_alerta(
    reta: dict,
    tipo: Literal["alertar_organizador", "reportar_ausencia"],
    nombre: str,
    telefono: str,
    motivo: Optional[str],
    canal: Literal["whatsapp", "registro"],
    enviado_whatsapp: bool,
) -> str:
    alerta_id = str(uuid.uuid4())
    await db.alertas_organizador.insert_one({
        "id": alerta_id,
        "reta_id": reta["id"],
        "reta_nombre": reta.get("nombre", ""),
        "reta_slug": reta.get("url_slug", ""),
        "organizador_id": reta.get("organizador_id", "admin"),
        "tipo": tipo,
        "nombre_jugador": nombre,
        "telefono_jugador": telefono,
        "motivo": (motivo or "").strip()[:240],
        "canal": canal,
        "enviado_whatsapp": enviado_whatsapp,
        "leida": False,
        "creada_en": datetime.now(timezone.utc).isoformat(),
    })
    return alerta_id


# ============================================================================
# PÚBLICO — Alertar Organizador
# ============================================================================
@router_public.post(
    "/{slug}/soporte/alertar-organizador",
    response_model=SoporteResponse,
)
async def alertar_organizador(slug: str, body: AlertarOrganizadorRequest):
    reta = await _get_reta_by_slug_or_404(slug)

    _rate_check_or_429(f"alert:{slug}:{body.telefono}")

    org_phone = await _get_organizador_phone(reta.get("organizador_id", "admin"))
    enviado = False
    canal: Literal["whatsapp", "registro"] = "registro"

    if org_phone and is_twilio_configured():
        try:
            msg = (
                f"🔔 *Alerta de jugador*\n\n"
                f"Reta: *{reta.get('nombre', '')}*\n"
                f"Jugador: {body.nombre} ({body.telefono})\n"
                f"Motivo: {body.motivo}\n\n"
                f"Abre el panel admin para responder."
            )
            res = await send_whatsapp(org_phone, msg)
            if res.get("status") in {"sent", "queued", "delivered"} or (res.get("status") == "ok"):
                enviado = True
                canal = "whatsapp"
            else:
                logger.warning("alertar_organizador WhatsApp falló: %s", res)
        except Exception as e:
            logger.warning("alertar_organizador exception: %s", e)

    alerta_id = await _crear_alerta(
        reta, "alertar_organizador",
        body.nombre, body.telefono, body.motivo,
        canal, enviado,
    )

    return SoporteResponse(
        ok=True,
        enviado_whatsapp=enviado,
        canal=canal,
        mensaje=(
            "Listo. El organizador recibirá un WhatsApp en breve."
            if enviado
            else "Tu mensaje quedó registrado. El organizador lo verá en su panel."
        ),
        alerta_id=alerta_id,
    )


# ============================================================================
# PÚBLICO — Reportar Ausencia
# ============================================================================
@router_public.post(
    "/{slug}/soporte/reportar-ausencia",
    response_model=SoporteResponse,
)
async def reportar_ausencia(slug: str, body: ReportarAusenciaRequest):
    reta = await _get_reta_by_slug_or_404(slug)
    _rate_check_or_429(f"ausencia:{slug}:{body.telefono}")

    # Si la inscripción existe, la marcamos como ausencia.
    insc = await db.inscripciones.find_one(
        {"reta_id": reta["id"], "telefono": body.telefono},
        {"_id": 0, "id": 1},
    )
    if insc:
        await db.inscripciones.update_one(
            {"id": insc["id"]},
            {"$set": {
                "ausencia_reportada": True,
                "ausencia_motivo": (body.motivo or "").strip()[:240] or None,
                "ausencia_reportada_en": datetime.now(timezone.utc).isoformat(),
            }},
        )

    org_phone = await _get_organizador_phone(reta.get("organizador_id", "admin"))
    enviado = False
    canal: Literal["whatsapp", "registro"] = "registro"

    if org_phone and is_twilio_configured():
        try:
            msg = (
                f"🚫 *Ausencia reportada*\n\n"
                f"Reta: *{reta.get('nombre', '')}*\n"
                f"Jugador: {body.nombre} ({body.telefono})\n"
                + (f"Motivo: {body.motivo}\n" if body.motivo else "")
                + "\nConsidera reemplazar este lugar."
            )
            res = await send_whatsapp(org_phone, msg)
            if res.get("status") in {"sent", "queued", "delivered", "ok"}:
                enviado = True
                canal = "whatsapp"
        except Exception as e:
            logger.warning("reportar_ausencia exception: %s", e)

    alerta_id = await _crear_alerta(
        reta, "reportar_ausencia",
        body.nombre, body.telefono, body.motivo,
        canal, enviado,
    )

    return SoporteResponse(
        ok=True,
        enviado_whatsapp=enviado,
        canal=canal,
        mensaje=(
            "Gracias. El organizador fue notificado por WhatsApp."
            if enviado
            else "Gracias. Tu ausencia quedó registrada y el organizador la verá pronto."
        ),
        alerta_id=alerta_id,
    )


# ============================================================================
# ADMIN — Inbox de alertas
# ============================================================================
@router_admin.get("/alertas/pendientes")
async def alertas_pendientes(
    current=Depends(get_current_admin),
    reta_id: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=200),
):
    org_id = current["sub"]
    q: dict = {"organizador_id": org_id, "leida": False}
    if reta_id:
        q["reta_id"] = reta_id
    cursor = db.alertas_organizador.find(q, {"_id": 0}).sort("creada_en", -1).limit(limit)
    items = [a async for a in cursor]
    total = await db.alertas_organizador.count_documents(q)
    return {"items": items, "total_pendientes": total}


@router_admin.patch("/alertas/{alerta_id}/leida")
async def marcar_alerta_leida(alerta_id: str, current=Depends(get_current_admin)):
    res = await db.alertas_organizador.update_one(
        {"id": alerta_id, "organizador_id": current["sub"]},
        {"$set": {"leida": True, "leida_en": datetime.now(timezone.utc).isoformat()}},
    )
    if res.matched_count == 0:
        raise HTTPException(404, "Alerta no encontrada")
    return {"ok": True}


# ============================================================================
# ADMIN — Perfil (whatsapp para recibir alertas)
# ============================================================================
@router_admin.get("/me")
async def admin_me(current=Depends(get_current_admin)):
    org_id = current["sub"]
    admin = await db.admins.find_one(
        {"$or": [{"id": org_id}, {"email": org_id}]},
        {"_id": 0, "hashed_password": 0},
    )
    if not admin:
        return {"id": org_id, "email": org_id, "telefono_whatsapp": None}
    return {
        "id": admin.get("id", org_id),
        "email": admin.get("email", org_id),
        "telefono_whatsapp": admin.get("telefono_whatsapp"),
    }


@router_admin.patch("/me/whatsapp")
async def admin_set_whatsapp(body: AdminWhatsappPatch, current=Depends(get_current_admin)):
    org_id = current["sub"]
    update: dict = {"telefono_whatsapp": body.telefono_whatsapp}
    res = await db.admins.update_one(
        {"$or": [{"id": org_id}, {"email": org_id}]},
        {"$set": update},
    )
    if res.matched_count == 0:
        raise HTTPException(404, "Admin no encontrado")
    return {"ok": True, "telefono_whatsapp": body.telefono_whatsapp}


# ============================================================================
# ADMIN — Slide-Over Inline Edit (Fase B)
# ============================================================================
class InscripcionInlinePatch(BaseModel):
    """Edición rápida de una inscripción desde el panel admin (slide-over).

    Cualquier campo `None` se omite (PATCH parcial)."""
    nombre: Optional[NombreStr] = None
    telefono: Optional[PhoneStr] = None
    cancha_asignada: Optional[int] = Field(default=None, ge=1, le=20)


@router_admin.patch("/inscripciones/{insc_id}/inline")
async def patch_inscripcion_inline(
    insc_id: str,
    body: InscripcionInlinePatch,
    current=Depends(get_current_admin),
):
    """Permite al admin corregir datos del jugador en linea (typo de nombre, número
    nuevo, reasignación de cancha). NO modifica estatus de pago/RSVP."""
    insc = await db.inscripciones.find_one({"id": insc_id}, {"_id": 0})
    if not insc:
        raise HTTPException(404, "Inscripción no encontrada")

    # Validar que la reta pertenece al admin actual.
    reta = await db.retas.find_one(
        {"id": insc["reta_id"]},
        {"_id": 0, "organizador_id": 1, "canchas_disponibles": 1},
    )
    if not reta:
        raise HTTPException(404, "Reta no encontrada")
    if reta.get("organizador_id") and reta["organizador_id"] != current["sub"]:
        raise HTTPException(403, "No puedes editar inscripciones de otra reta")

    update: dict = {}
    if body.nombre is not None:
        update["nombre"] = body.nombre
    if body.telefono is not None:
        # Si cambia el teléfono, verificamos que no choque con otro en la misma reta.
        if body.telefono != insc.get("telefono"):
            choque = await db.inscripciones.find_one({
                "reta_id": insc["reta_id"],
                "telefono": body.telefono,
                "id": {"$ne": insc_id},
                # FIX: el campo correcto es estatus_pago con casing Title-case.
                "estatus_pago": {"$in": ["Aprobado", "Pendiente"]},
            })
            if choque:
                raise HTTPException(409, "Ya hay otra inscripción aprobada/pendiente con ese teléfono en esta reta")
            update["telefono"] = body.telefono
    if body.cancha_asignada is not None:
        canchas_disp = int(reta.get("canchas_disponibles") or 1)
        if body.cancha_asignada > canchas_disp:
            raise HTTPException(
                400,
                f"Cancha {body.cancha_asignada} fuera de rango. Esta reta tiene {canchas_disp} canchas.",
            )
        update["cancha_asignada"] = body.cancha_asignada

    if not update:
        raise HTTPException(400, "Nada que actualizar")

    update["actualizada_en"] = datetime.now(timezone.utc).isoformat()
    await db.inscripciones.update_one({"id": insc_id}, {"$set": update})

    fresh = await db.inscripciones.find_one({"id": insc_id}, {"_id": 0})
    return {"ok": True, "inscripcion": fresh}


class ConfirmarManualRequest(BaseModel):
    """Confirma una inscripción sin pago real (admin override).
    Útil para pagos en efectivo o casos especiales."""
    nota: Optional[str] = Field(default=None, max_length=240)


@router_admin.post("/inscripciones/{insc_id}/confirmar-manual")
async def confirmar_inscripcion_manual(
    insc_id: str,
    body: ConfirmarManualRequest,
    current=Depends(get_current_admin),
):
    insc = await db.inscripciones.find_one({"id": insc_id}, {"_id": 0})
    if not insc:
        raise HTTPException(404, "Inscripción no encontrada")
    if insc.get("estatus_pago") == "Aprobado":
        return {"ok": True, "ya_aprobada": True}

    reta = await db.retas.find_one(
        {"id": insc["reta_id"]},
        {"_id": 0, "organizador_id": 1},
    )
    if reta and reta.get("organizador_id") and reta["organizador_id"] != current["sub"]:
        raise HTTPException(403, "No puedes confirmar inscripciones de otra reta")

    await db.inscripciones.update_one(
        {"id": insc_id},
        {"$set": {
            "estatus_pago": "Aprobado",
            "pago_manual": True,
            "pago_manual_nota": (body.nota or "").strip()[:240] or None,
            "pago_manual_por": current["sub"],
            "pago_manual_en": datetime.now(timezone.utc).isoformat(),
        }},
    )
    return {"ok": True, "confirmada_manualmente": True}
