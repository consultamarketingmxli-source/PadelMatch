"""
MÓDULO DE MARKETING — Motor de Cupones de Descuento (Vouchers 100% gratis).

Endpoints admin:
    POST   /api/admin/cupones                  — Crear cupón (genera código si se omite)
    GET    /api/admin/cupones                  — Lista cupones del organizador (filtros opc.)
    GET    /api/admin/cupones/{cupon_id}       — Detalle
    DELETE /api/admin/cupones/{cupon_id}       — Borrar (solo si no usado)
    POST   /api/admin/cupones/{cupon_id}/reactivar — Reactivar manualmente (desmarca usado)

Endpoints públicos:
    POST   /api/public/retas/{reta_id}/cupon/validar  — Pre-check (no consume)
    POST   /api/public/retas/{reta_id}/cupon/canjear  — Canje ATÓMICO (consume + inscribe)

Endpoint cancelación cupón-aware:
    DELETE /api/admin/inscripciones/{insc_id}/cancelar — Reactiva el cupón si la
        inscripción fue creada con cupón. Promueve lista de espera.

Atomicidad:
    El canje usa `findOneAndUpdate({codigo, usado: false}, {$set: {usado:true,...}})`
    que en MongoDB toma lock per-document. Si dos jugadores intentan canjear
    el MISMO código en paralelo, solo uno gana (el otro recibe 409).

    Si tras consumir el cupón falla la creación de la inscripción o la
    reserva de cupo, hacemos rollback explícito (`usado:false`) y liberamos
    el cupo reservado.

Reglas de negocio:
    1. organizador_id del cupón DEBE coincidir con organizador_id de la reta.
    2. Si reta_id_exclusivo está seteado, solo aplica para esa reta concreta.
    3. Si la reta está LLENA (semaforo ROJO o cupos < 1), el canje es rechazado.
    4. Al cancelar una inscripción canjeada con cupón, el cupón se reactiva
       automáticamente para que el jugador pueda reusarlo.
"""

import logging
import random
import string
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from auth import get_current_admin
from core.concurrency import liberar_lugar, reservar_lugar_atomico
from core.db import db
from core.helpers import promover_lista_espera
from core.security import limiter, write_security_log
from models import (
    Cupon,
    CuponCheckoutRequest,
    CuponCheckoutResponse,
    CuponCreate,
    CuponValidateRequest,
    CuponValidateResponse,
)

logger = logging.getLogger("padelappretas-os")

# Router admin (auth obligatoria).
router_admin = APIRouter(prefix="/admin/cupones", tags=["cupones-admin"])
# Router público (sin auth — solo lectura/canje con código).
router_public = APIRouter(prefix="/public/retas", tags=["cupones-public"])
# Cancelación cupón-aware (admin).
router_cancel = APIRouter(prefix="/admin/inscripciones", tags=["cupones-admin"])


# ============================================================================
# Helpers
# ============================================================================

def _generate_codigo() -> str:
    """Genera un código aleatorio tipo `PRO-X9K2A7` (alfanumérico, 9 chars)."""
    alphabet = string.ascii_uppercase + string.digits
    suffix = "".join(random.choices(alphabet, k=6))
    return f"PRO-{suffix}"


async def _get_reta_or_404(reta_id: str) -> dict:
    reta = await db.retas.find_one({"id": reta_id}, {"_id": 0})
    if not reta:
        raise HTTPException(404, "Reta no encontrada")
    return reta


async def _verify_admin_owns_reta(current, reta: dict) -> None:
    """Asegura que el admin actual es el organizador (o super-admin)."""
    organizador_id = reta.get("organizador_id") or ""
    if _admin_role(current) == "super_admin":
        return
    if _admin_id(current) != organizador_id:
        raise HTTPException(403, "No tienes permiso sobre este recurso.")


def _admin_id(current) -> str:
    """Devuelve el subject del JWT (email del admin)."""
    if hasattr(current, "get"):
        return current.get("sub", "") or ""
    return getattr(current, "sub", "") or ""


def _admin_role(current) -> str:
    if hasattr(current, "get"):
        return current.get("role", "") or ""
    return getattr(current, "role", "") or ""


def _admin_organizador_id(current) -> str:
    """Devuelve el organizador_id asociado al admin actual.
    Para un admin organizador, organizador_id == subject del JWT."""
    return _admin_id(current)


# ============================================================================
# Endpoints ADMIN
# ============================================================================

@router_admin.post("", response_model=Cupon)
async def crear_cupon(body: CuponCreate, current=Depends(get_current_admin)):
    """Crea un cupón nuevo. Si `codigo` se omite o ya está tomado, se intenta
    autogenerar hasta 5 veces antes de rendirse."""
    organizador_id = _admin_organizador_id(current)

    # Si se pasa reta_id_exclusivo, validar que pertenezca al mismo organizador.
    reta_exclusiva: Optional[dict] = None
    if body.reta_id_exclusivo:
        reta_exclusiva = await db.retas.find_one(
            {"id": body.reta_id_exclusivo}, {"_id": 0, "id": 1, "organizador_id": 1, "nombre": 1},
        )
        if not reta_exclusiva:
            raise HTTPException(404, "Reta exclusiva no encontrada.")
        if reta_exclusiva.get("organizador_id") not in (organizador_id, None):
            raise HTTPException(
                403,
                "No puedes crear cupones para retas de otro organizador.",
            )

    # Resolver código (manual o autogenerado).
    intentos = 5
    while intentos > 0:
        codigo = (body.codigo or _generate_codigo()).strip().upper()
        existing = await db.cupones.find_one({"codigo": codigo}, {"_id": 0, "id": 1})
        if not existing:
            break
        if body.codigo:
            raise HTTPException(409, f"Ya existe un cupón con código '{codigo}'.")
        intentos -= 1
    else:
        raise HTTPException(500, "No se pudo generar un código único. Intenta de nuevo.")

    cupon = Cupon(
        codigo=codigo,
        organizador_id=organizador_id,
        descripcion=body.descripcion,
        reta_id_exclusivo=body.reta_id_exclusivo,
        creado_por_admin_id=_admin_id(current),
    )
    doc = cupon.model_dump()
    doc["fecha_creacion"] = doc["fecha_creacion"].isoformat()
    if doc.get("fecha_uso"):
        doc["fecha_uso"] = doc["fecha_uso"].isoformat()
    await db.cupones.insert_one(doc)
    return cupon


@router_admin.get("", response_model=list[Cupon])
async def listar_cupones(
    current=Depends(get_current_admin),
    reta_id: Optional[str] = Query(default=None, description="Filtra por reta exclusiva (o libres)"),
    solo_disponibles: bool = Query(default=False, description="Excluye los ya usados"),
    limit: int = Query(default=200, ge=1, le=1000),
):
    """Lista cupones del organizador actual."""
    organizador_id = _admin_organizador_id(current)
    q: dict = {"organizador_id": organizador_id}
    if reta_id is not None:
        # Permite filtrar por reta_id_exclusivo == reta_id O por libres (None).
        q["$or"] = [{"reta_id_exclusivo": reta_id}, {"reta_id_exclusivo": None}]
    if solo_disponibles:
        q["usado"] = False
    cursor = db.cupones.find(q, {"_id": 0}).sort("fecha_creacion", -1).limit(limit)
    return [Cupon(**c) async for c in cursor]


@router_admin.get("/{cupon_id}", response_model=Cupon)
async def detalle_cupon(cupon_id: str, current=Depends(get_current_admin)):
    cupon = await db.cupones.find_one({"id": cupon_id}, {"_id": 0})
    if not cupon:
        raise HTTPException(404, "Cupón no encontrado")
    if cupon["organizador_id"] != _admin_organizador_id(current):
        raise HTTPException(403, "Cupón pertenece a otro organizador.")
    return Cupon(**cupon)


@router_admin.delete("/{cupon_id}")
async def borrar_cupon(cupon_id: str, current=Depends(get_current_admin)):
    """Borra el cupón. NO permite borrar cupones ya usados (auditoría)."""
    cupon = await db.cupones.find_one({"id": cupon_id}, {"_id": 0})
    if not cupon:
        raise HTTPException(404, "Cupón no encontrado")
    if cupon["organizador_id"] != _admin_organizador_id(current):
        raise HTTPException(403, "No puedes borrar cupones de otro organizador.")
    if cupon.get("usado"):
        raise HTTPException(
            409,
            "No puedes borrar un cupón ya redimido (auditoría). "
            "Si necesitas reactivarlo, usa el endpoint /reactivar.",
        )
    await db.cupones.delete_one({"id": cupon_id})
    return {"ok": True, "deleted": 1}


@router_admin.post("/{cupon_id}/reactivar", response_model=Cupon)
async def reactivar_cupon_manual(cupon_id: str, current=Depends(get_current_admin)):
    """Reactiva manualmente un cupón ya usado (admin recovery)."""
    cupon = await db.cupones.find_one({"id": cupon_id}, {"_id": 0})
    if not cupon:
        raise HTTPException(404, "Cupón no encontrado")
    if cupon["organizador_id"] != _admin_organizador_id(current):
        raise HTTPException(403, "No puedes modificar cupones de otro organizador.")
    await db.cupones.update_one(
        {"id": cupon_id},
        {"$set": {
            "usado": False,
            "fecha_uso": None,
            "inscripcion_id_uso": None,
            "jugador_nombre_uso": None,
        }},
    )
    cupon_doc = await db.cupones.find_one({"id": cupon_id}, {"_id": 0})
    return Cupon(**cupon_doc)


# ============================================================================
# Endpoints PÚBLICOS
# ============================================================================

async def _validar_cupon_para_reta(codigo: str, reta: dict) -> CuponValidateResponse:
    """Lógica compartida de validación. NO modifica DB."""
    codigo_n = codigo.strip().upper()
    cupon = await db.cupones.find_one({"codigo": codigo_n}, {"_id": 0})
    if not cupon:
        return CuponValidateResponse(valido=False, razon="Código de cupón no existe.")
    if cupon.get("usado"):
        return CuponValidateResponse(valido=False, razon="Este cupón ya fue redimido.")
    # Reta del MISMO organizador
    if cupon["organizador_id"] != reta.get("organizador_id"):
        return CuponValidateResponse(
            valido=False,
            razon="Este cupón no es válido para este club.",
        )
    # Si es exclusivo de una reta, debe coincidir.
    if cupon.get("reta_id_exclusivo") and cupon["reta_id_exclusivo"] != reta["id"]:
        return CuponValidateResponse(
            valido=False,
            razon="Este cupón es exclusivo de otra reta del mismo organizador.",
        )
    # OK válido.
    return CuponValidateResponse(
        valido=True,
        cupon={
            "codigo": cupon["codigo"],
            "descripcion": cupon.get("descripcion") or "Cupón de reta gratis",
        },
        monto_descuento=float(reta.get("costo_inscripcion", 0)),
        monto_final=0.0,
    )


@router_public.post("/{reta_id}/cupon/validar", response_model=CuponValidateResponse)
@limiter.limit("10/minute")
async def validar_cupon(request: Request, reta_id: str, body: CuponValidateRequest):
    """Pre-check sin consumir. Devuelve `valido` + `razon` legible si no.

    Rate limit 10/min para evitar brute-force de códigos promocionales.
    Tampoco valida cupos (eso es chequeo soft). El check duro se hace al canjear.
    """
    reta = await _get_reta_or_404(reta_id)
    result = await _validar_cupon_para_reta(body.codigo, reta)
    if not result.valido:
        await write_security_log(
            accion="cupon_validar_failed",
            request=request,
            result="denied",
            extra={"codigo": body.codigo[:20], "razon": result.razon, "reta_id": reta_id},
        )
    return result


@router_public.post("/{reta_id}/cupon/canjear", response_model=CuponCheckoutResponse)
async def canjear_cupon(reta_id: str, body: CuponCheckoutRequest):
    """Canje ATÓMICO del cupón. Crea inscripción Aprobada directo, sin pasarela.

    Orden de operaciones (con rollback explícito si algo falla):
      1. Validar reta abierta y cupos disponibles (reservar_lugar_atomico).
      2. Atomic find-and-update del cupón (usado:false → true).
      3. Crear inscripción Aprobada.
      4. Promover lista de espera (no aplica, fue Aprobado directo).

    Si paso 2 falla por race-condition → liberar cupo paso 1.
    Si paso 3 falla → rollback cupón (usado:false) + liberar cupo.
    """
    reta = await _get_reta_or_404(reta_id)

    # ---- Pre-check (sin consumir) — sirve para mejores mensajes de error ----
    pre = await _validar_cupon_para_reta(body.codigo, reta)
    if not pre.valido:
        raise HTTPException(400, pre.razon or "Cupón inválido.")

    # ---- 1. Reservar cupo atómicamente ----
    reta_actualizada = await reservar_lugar_atomico(reta_id)
    if not reta_actualizada:
        # Reta llena. NO consumimos el cupón.
        raise HTTPException(
            409,
            "Lo sentimos, el cupón es válido pero la reta ya no cuenta con "
            "cupos disponibles. Únete a la lista de espera.",
        )

    # ---- 2. Consumir cupón atómicamente ----
    codigo_n = body.codigo.strip().upper()
    ahora = datetime.now(timezone.utc)
    inscripcion_id = str(uuid.uuid4())
    cupon_actualizado = await db.cupones.find_one_and_update(
        {
            "codigo": codigo_n,
            "organizador_id": reta.get("organizador_id"),
            "usado": False,
        },
        {"$set": {
            "usado": True,
            "fecha_uso": ahora.isoformat(),
            "inscripcion_id_uso": inscripcion_id,
            "jugador_nombre_uso": body.nombre.strip(),
        }},
        projection={"_id": 0},
        return_document=True,  # ReturnDocument.AFTER en pymongo 4+
    )
    if not cupon_actualizado:
        # Race: otro jugador lo redimió primero. Liberamos cupo y respondemos.
        await liberar_lugar(reta_id, 1)
        raise HTTPException(
            409,
            "Este cupón acaba de ser redimido por otro jugador. Intenta con otro código.",
        )

    # ---- 3. Crear inscripción Aprobada (sin pasarela) ----
    try:
        inscripcion_doc = {
            "id": inscripcion_id,
            "reta_id": reta_id,
            "jugador_id": str(uuid.uuid4()),
            "nombre": body.nombre.strip(),
            "telefono": body.telefono.strip(),
            "estatus_pago": "Aprobado",
            "monto_pagado": 0.0,
            "metodo_pago": "cupon",
            "cupon_codigo": codigo_n,
            "cupon_id": cupon_actualizado["id"],
            "creado_en": ahora.isoformat(),
            "bloqueado_hasta": None,
        }
        await db.inscripciones.insert_one(inscripcion_doc)
    except Exception as e:
        # Rollback cupón + cupo.
        await db.cupones.update_one(
            {"id": cupon_actualizado["id"]},
            {"$set": {
                "usado": False, "fecha_uso": None,
                "inscripcion_id_uso": None, "jugador_nombre_uso": None,
            }},
        )
        await liberar_lugar(reta_id, 1)
        logger.exception("Error creando inscripción con cupón: %s", e)
        raise HTTPException(500, "Error al confirmar la inscripción. Tu cupón sigue activo.") from e

    return CuponCheckoutResponse(
        inscripcion_id=inscripcion_id,
        estatus_pago="Aprobado",
        monto_final=0.0,
        cupon_codigo=codigo_n,
        cupon_id=cupon_actualizado["id"],
    )


# ============================================================================
# Cancelación cupón-aware (admin) — reactiva cupón y promueve waitlist.
# ============================================================================

@router_cancel.delete("/{insc_id}/cancelar")
async def cancelar_inscripcion_cupon_aware(
    insc_id: str,
    current=Depends(get_current_admin),
):
    """Cancela una inscripción. Si fue creada con cupón, lo reactiva.
    Si la inscripción es parte de una pareja, USA el endpoint específico de
    parejas (`/api/retas/{id}/inscripciones/{id}?modo=duo|solo`). Este endpoint
    está pensado para inscripciones INDIVIDUALES.
    """
    insc = await db.inscripciones.find_one({"id": insc_id}, {"_id": 0})
    if not insc:
        raise HTTPException(404, "Inscripción no encontrada.")

    if insc.get("pareja_grupo_id"):
        raise HTTPException(
            400,
            "Esta inscripción pertenece a una pareja. Usa el endpoint "
            "/api/retas/{reta_id}/inscripciones/{id}?modo=duo|solo.",
        )

    reta_id = insc["reta_id"]
    reta = await db.retas.find_one({"id": reta_id}, {"_id": 0, "organizador_id": 1})
    if not reta:
        raise HTTPException(404, "Reta no encontrada.")
    if reta.get("organizador_id") != _admin_organizador_id(current):
        # super-admin pasa.
        role = getattr(current, "role", None) or current.get("role", "")
        if role != "super_admin":
            raise HTTPException(403, "No tienes permiso sobre esta inscripción.")

    # Reactivar cupón si aplica.
    cupon_reactivado = False
    cupon_id = insc.get("cupon_id")
    if cupon_id:
        res = await db.cupones.update_one(
            {"id": cupon_id, "inscripcion_id_uso": insc_id},
            {"$set": {
                "usado": False,
                "fecha_uso": None,
                "inscripcion_id_uso": None,
                "jugador_nombre_uso": None,
            }},
        )
        cupon_reactivado = res.modified_count > 0

    # Borrar inscripción + liberar cupo + promover waitlist.
    await db.inscripciones.delete_one({"id": insc_id})
    await liberar_lugar(reta_id, 1)
    promoted = bool(await promover_lista_espera(reta_id))

    return {
        "ok": True,
        "eliminadas": 1,
        "cupos_liberados": 1,
        "cupon_reactivado": cupon_reactivado,
        "promoted": promoted,
    }
