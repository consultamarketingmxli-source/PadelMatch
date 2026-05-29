"""
RSVP — Retas Gratis / Entre Amigos (Fase A).

Endpoints públicos:
    POST /api/public/retas/{reta_id}/rsvp/aceptar  — Confirma asistencia (atómico)
    POST /api/public/retas/{reta_id}/rsvp/rechazar — Declina invitación

Endpoints admin:
    PATCH  /api/admin/inscripciones/{insc_id}/estatus  — Cambia estatus_confirmacion
    GET    /api/admin/retas/{reta_id}/asistencia        — Lista agrupada (3 columnas)

Reglas:
- Solo aplica para retas con `tipo_acceso = "gratis_amigos"`.
- Atomicidad con `reservar_lugar_atomico` (mismo motor que cupones/pagos).
- Si la reta está LLENA al aceptar, devuelve el inscripto a `lista_espera`
  automáticamente y se le notifica.
- Al rechazar/cancelar una inscripción "aceptado", si hay lista de espera
  promovemos el siguiente y le enviamos WhatsApp/SMS si Twilio está configurado.
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from auth import get_current_admin
from core.concurrency import liberar_lugar, reservar_lugar_atomico
from core.db import db
from core.helpers import assert_reta_no_cerrada, promover_lista_espera
from core.validators import NombreStr, PhoneStr

logger = logging.getLogger("padelappretas-os")

router_public = APIRouter(prefix="/public/retas", tags=["rsvp-public"])
router_admin = APIRouter(prefix="/admin", tags=["rsvp-admin"])


# ============================================================================
# Pydantic — Bodies / Responses
# ============================================================================

class RsvpRequest(BaseModel):
    """Body común de Aceptar / Rechazar."""
    nombre: NombreStr
    telefono: PhoneStr


class RsvpAcceptResponse(BaseModel):
    inscripcion_id: str
    estatus_confirmacion: Literal["aceptado", "lista_espera"]
    posicion_lista_espera: Optional[int] = None
    mensaje: str


class RsvpRejectResponse(BaseModel):
    ok: bool = True
    promoted: bool = False  # True si se promovió un waitlist
    promoted_player: Optional[str] = None


class EstatusPatch(BaseModel):
    estatus_confirmacion: Literal[
        "pendiente_invitacion", "aceptado", "rechazado", "lista_espera"
    ]


class AsistenciaResponse(BaseModel):
    reta_id: str
    confirmados: list[dict] = Field(default_factory=list)
    pendientes: list[dict] = Field(default_factory=list)
    lista_espera: list[dict] = Field(default_factory=list)
    rechazados: list[dict] = Field(default_factory=list)


# ============================================================================
# Helpers
# ============================================================================

async def _get_reta_or_404(reta_id: str) -> dict:
    r = await db.retas.find_one({"id": reta_id}, {"_id": 0})
    if not r:
        raise HTTPException(404, "Reta no encontrada")
    return r


def _ensure_gratis(reta: dict) -> None:
    if reta.get("tipo_acceso") != "gratis_amigos":
        raise HTTPException(
            400,
            "Esta reta es de PAGA. Usa el flujo de pago Stripe/MercadoPago en su lugar.",
        )


async def _capacidad_actual(reta_id: str) -> dict:
    """Devuelve {confirmados, max, libres}.
    Cuenta solo inscripciones con estatus_confirmacion=aceptado para retas gratis,
    o estatus_pago=Aprobado para retas paga (retrocompat)."""
    reta = await _get_reta_or_404(reta_id)
    cnt = await db.inscripciones.count_documents({
        "reta_id": reta_id,
        "$or": [
            {"estatus_confirmacion": "aceptado"},
            {"estatus_pago": "Aprobado"},  # legacy paga
        ],
    })
    return {
        "confirmados": cnt,
        "max": reta["max_jugadores"],
        "libres": max(0, reta["max_jugadores"] - cnt),
    }


# ============================================================================
# Endpoints PÚBLICOS (jugador)
# ============================================================================

@router_public.post("/{reta_id}/rsvp/aceptar", response_model=RsvpAcceptResponse)
async def rsvp_aceptar(reta_id: str, body: RsvpRequest):
    """Confirma asistencia atómicamente.

    Si la reta está llena cuando el jugador hace click en Aceptar:
      → devuelve `lista_espera` con la posición, NO se reserva cupo.

    Si hay cupos disponibles:
      → reserva 1 cupo atómicamente, crea inscripción con
        `estatus_confirmacion=aceptado` y `estatus_pago=Aprobado`
        (monto $0 — para que aparezca también en reportes de pago).

    Idempotencia (post-MVP): si el mismo teléfono ya aceptó esta reta,
    devolvemos esa inscripción sin duplicar.
    """
    reta = await _get_reta_or_404(reta_id)
    _ensure_gratis(reta)
    # Fase C — bloqueo de rondas pasadas
    assert_reta_no_cerrada(reta, accion="aceptar invitación a")

    telefono_norm = body.telefono.strip()
    nombre_norm = body.nombre.strip()

    # Idempotencia: ¿ya hay una inscripción aceptada con este teléfono?
    existing = await db.inscripciones.find_one(
        {"reta_id": reta_id, "telefono": telefono_norm,
         "estatus_confirmacion": {"$in": ["aceptado", "lista_espera"]}},
        {"_id": 0},
    )
    if existing:
        return RsvpAcceptResponse(
            inscripcion_id=existing["id"],
            estatus_confirmacion=existing["estatus_confirmacion"],
            mensaje="Ya habías respondido esta invitación. Te mantenemos en la misma posición.",
        )

    # Intentar reservar cupo atómicamente.
    reta_actual = await reservar_lugar_atomico(reta_id)
    if not reta_actual:
        # Llena — añadir a lista de espera (sin reservar cupo).
        wl_count = await db.lista_espera.count_documents({"reta_id": reta_id})
        pos = wl_count + 1
        await db.lista_espera.insert_one({
            "id": str(uuid.uuid4()),
            "reta_id": reta_id,
            "jugador_id": str(uuid.uuid4()),
            "nombre": nombre_norm,
            "telefono": telefono_norm,
            "posicion_fila": pos,
            "notificado": False,
            "creado_en": datetime.now(timezone.utc).isoformat(),
        })
        # También guardamos un "shadow" en inscripciones con estatus lista_espera
        # para que el panel admin lo vea en la columna correcta.
        insc_id = str(uuid.uuid4())
        await db.inscripciones.insert_one({
            "id": insc_id,
            "reta_id": reta_id,
            "jugador_id": str(uuid.uuid4()),
            "nombre": nombre_norm,
            "telefono": telefono_norm,
            "estatus_pago": "Pendiente",
            "estatus_confirmacion": "lista_espera",
            "monto_pagado": 0.0,
            "metodo_pago": "rsvp_gratis",
            "creado_en": datetime.now(timezone.utc).isoformat(),
        })
        return RsvpAcceptResponse(
            inscripcion_id=insc_id,
            estatus_confirmacion="lista_espera",
            posicion_lista_espera=pos,
            mensaje=f"La reta ya está llena, pero quedas en la lista de espera (posición #{pos}). Te avisaremos si se libera un cupo.",
        )

    # Hay cupo → crear inscripción "aceptado".
    insc_id = str(uuid.uuid4())
    try:
        await db.inscripciones.insert_one({
            "id": insc_id,
            "reta_id": reta_id,
            "jugador_id": str(uuid.uuid4()),
            "nombre": nombre_norm,
            "telefono": telefono_norm,
            "estatus_pago": "Aprobado",  # gratis = aprobado directo
            "estatus_confirmacion": "aceptado",
            "monto_pagado": 0.0,
            "metodo_pago": "rsvp_gratis",
            "creado_en": datetime.now(timezone.utc).isoformat(),
        })
    except Exception as e:
        # Rollback: liberar el cupo reservado.
        await liberar_lugar(reta_id, 1)
        logger.exception("Error creando inscripción RSVP: %s", e)
        raise HTTPException(500, "Error al confirmar tu asistencia. Intenta de nuevo.") from e

    return RsvpAcceptResponse(
        inscripcion_id=insc_id,
        estatus_confirmacion="aceptado",
        mensaje=f"¡Asistencia confirmada! Nos vemos en {reta['club']}.",
    )


@router_public.post("/{reta_id}/rsvp/rechazar", response_model=RsvpRejectResponse)
async def rsvp_rechazar(reta_id: str, body: RsvpRequest):
    """Marca la invitación como rechazada.

    Si previamente había aceptado: libera el cupo y promueve a la lista de espera.
    Si no había aceptado: registra el rechazo como auditoría.
    """
    reta = await _get_reta_or_404(reta_id)
    _ensure_gratis(reta)

    telefono_norm = body.telefono.strip()
    promoted_player: Optional[str] = None

    # ¿Tenía una inscripción aceptada? Si sí, la cancelamos.
    existing = await db.inscripciones.find_one(
        {"reta_id": reta_id, "telefono": telefono_norm,
         "estatus_confirmacion": "aceptado"},
        {"_id": 0},
    )
    if existing:
        await db.inscripciones.update_one(
            {"id": existing["id"]},
            {"$set": {"estatus_confirmacion": "rechazado"}},
        )
        await liberar_lugar(reta_id, 1)
        promoted = await promover_lista_espera(reta_id)
        if promoted:
            # promover_lista_espera devuelve un dict O modelo Inscripcion según versión.
            promoted_player = (
                promoted.get("nombre") if isinstance(promoted, dict) else getattr(promoted, "nombre", None)
            )
        return RsvpRejectResponse(
            ok=True,
            promoted=bool(promoted),
            promoted_player=promoted_player,
        )

    # No aceptó antes → solo registramos rechazo (sin reserva).
    await db.inscripciones.insert_one({
        "id": str(uuid.uuid4()),
        "reta_id": reta_id,
        "jugador_id": str(uuid.uuid4()),
        "nombre": body.nombre.strip(),
        "telefono": telefono_norm,
        "estatus_pago": "Pendiente",
        "estatus_confirmacion": "rechazado",
        "monto_pagado": 0.0,
        "metodo_pago": "rsvp_gratis",
        "creado_en": datetime.now(timezone.utc).isoformat(),
    })
    return RsvpRejectResponse(ok=True, promoted=False)


# ============================================================================
# Endpoints ADMIN
# ============================================================================

@router_admin.patch("/inscripciones/{insc_id}/estatus")
async def cambiar_estatus(
    insc_id: str, body: EstatusPatch, current=Depends(get_current_admin),
):
    """Cambia manualmente el estatus_confirmacion de una inscripción.

    Reglas:
      - Si pasa de cualquier estado → "aceptado": reserva atómicamente un cupo.
      - Si pasa de "aceptado" → otro: libera cupo y promueve waitlist.
      - "pendiente_invitacion" y "rechazado" NO reservan cupos.
      - "lista_espera" no reserva cupo (es promesa de cupo futuro).
    """
    insc = await db.inscripciones.find_one({"id": insc_id}, {"_id": 0})
    if not insc:
        raise HTTPException(404, "Inscripción no encontrada")

    # Fase C — bloqueo de rondas pasadas (admin no puede cambiar estatus
    # de inscripciones de retas ya cerradas — preserva la auditoría).
    reta_doc = await db.retas.find_one({"id": insc["reta_id"]}, {"_id": 0})
    if reta_doc:
        assert_reta_no_cerrada(reta_doc, accion="cambiar estatus de")

    old = insc.get("estatus_confirmacion", "aceptado")
    new = body.estatus_confirmacion
    if old == new:
        return {"ok": True, "estatus_confirmacion": new, "no_change": True}

    reta_id = insc["reta_id"]
    fue_aceptado = old == "aceptado"
    sera_aceptado = new == "aceptado"

    if sera_aceptado and not fue_aceptado:
        # Subir a aceptado: reservar cupo.
        ok = await reservar_lugar_atomico(reta_id)
        if not ok:
            raise HTTPException(
                409,
                "No se pudo aceptar: la reta ya está llena. Cambia a 'lista_espera' o libera un cupo antes.",
            )

    promoted: Optional[dict] = None
    if fue_aceptado and not sera_aceptado:
        # Baja desde aceptado: liberar cupo y promover waitlist.
        await liberar_lugar(reta_id, 1)
        promoted = await promover_lista_espera(reta_id)

    new_pago = "Aprobado" if sera_aceptado else (
        "Pendiente" if new in ("pendiente_invitacion", "lista_espera") else "Expirado"
    )
    await db.inscripciones.update_one(
        {"id": insc_id},
        {"$set": {"estatus_confirmacion": new, "estatus_pago": new_pago}},
    )

    return {
        "ok": True,
        "estatus_confirmacion": new,
        "estatus_pago": new_pago,
        "promoted": bool(promoted),
        "promoted_player": (
            promoted.get("nombre") if isinstance(promoted, dict) else getattr(promoted, "nombre", None)
        ) if promoted else None,
    }


@router_admin.get(
    "/retas/{reta_id}/asistencia", response_model=AsistenciaResponse,
)
async def asistencia_reta(reta_id: str, current=Depends(get_current_admin)):
    """Vista admin: lista agrupada de inscripciones por estado.
    3 columnas principales: Confirmados / Pendientes / Lista de espera.
    Bonus: Rechazados para auditoría.
    """
    reta = await _get_reta_or_404(reta_id)
    inscripciones = []
    async for i in db.inscripciones.find({"reta_id": reta_id}, {"_id": 0}):
        # Asegurar estatus_confirmacion por retro-compat (retas viejas paga).
        if "estatus_confirmacion" not in i:
            if i.get("estatus_pago") == "Aprobado":
                i["estatus_confirmacion"] = "aceptado"
            else:
                i["estatus_confirmacion"] = "pendiente_invitacion"
        inscripciones.append(i)

    def _trim(it):
        return {
            "id": it["id"],
            "nombre": it["nombre"],
            "telefono": it["telefono"],
            "estatus_confirmacion": it.get("estatus_confirmacion"),
            "estatus_pago": it.get("estatus_pago"),
            "metodo_pago": it.get("metodo_pago"),
            "creado_en": it.get("creado_en"),
            "es_free_agent": it.get("es_free_agent", False),
            "pareja_grupo_id": it.get("pareja_grupo_id"),
            "pareja_nombre": it.get("pareja_nombre"),
        }

    return AsistenciaResponse(
        reta_id=reta_id,
        confirmados=[_trim(i) for i in inscripciones if i["estatus_confirmacion"] == "aceptado"],
        pendientes=[_trim(i) for i in inscripciones if i["estatus_confirmacion"] == "pendiente_invitacion"],
        lista_espera=[_trim(i) for i in inscripciones if i["estatus_confirmacion"] == "lista_espera"],
        rechazados=[_trim(i) for i in inscripciones if i["estatus_confirmacion"] == "rechazado"],
    )
