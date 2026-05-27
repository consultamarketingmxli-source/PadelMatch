"""Endpoints admin de Retas: CRUD + listar inscripciones + expirar pendientes."""
from datetime import datetime
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from slugify import slugify

from auth import get_current_admin
from core.db import db
from core.helpers import compute_public, expirar_bloqueos_pass, strip_mongo
from logica_torneo import construir_fecha_local_iso
from models import Inscripcion, Reta, RetaCreate, RetaPublic

router = APIRouter(prefix="/retas", tags=["retas"])


@router.post("", response_model=Reta)
async def create_reta(body: RetaCreate, current=Depends(get_current_admin)):
    fecha_iso = construir_fecha_local_iso(body.fecha_str, body.hora_str, body.tz_offset_minutes)
    base_slug = slugify(f"{body.nombre}-{body.club}-{body.fecha_str}")
    slug = base_slug
    n = 1
    while await db.retas.find_one({"url_slug": slug}):
        n += 1
        slug = f"{base_slug}-{n}"

    reta = Reta(
        nombre=body.nombre,
        club=body.club,
        fecha_evento=fecha_iso,
        canchas_disponibles=body.canchas_disponibles,
        max_jugadores=8 * body.canchas_disponibles,
        costo_inscripcion=body.costo_inscripcion,
        modalidad_juego=body.modalidad_juego,
        num_rondas=body.num_rondas,
        url_slug=slug,
        organizador_logo_url=body.organizador_logo_url,
        observaciones_publicas=body.observaciones_publicas,
        latitud=body.latitud,
        longitud=body.longitud,
        organizador_id=current["sub"],
    )
    doc = reta.model_dump()
    doc["creado_en"] = (
        doc["creado_en"].isoformat() if isinstance(doc["creado_en"], datetime) else doc["creado_en"]
    )
    await db.retas.insert_one(doc)
    return reta


@router.get("", response_model=List[RetaPublic])
async def list_retas_admin(current=Depends(get_current_admin)):
    cursor = db.retas.find().sort("creado_en", -1).limit(500)
    out = []
    async for r in cursor:
        strip_mongo(r)
        await compute_public(r)
        out.append(RetaPublic(**r))
    return out


@router.get("/{reta_id}", response_model=RetaPublic)
async def get_reta_admin(reta_id: str, current=Depends(get_current_admin)):
    r = await db.retas.find_one({"id": reta_id}, {"_id": 0})
    if not r:
        raise HTTPException(404, "Reta no encontrada")
    await compute_public(r)
    return RetaPublic(**r)


@router.put("/{reta_id}", response_model=Reta)
async def update_reta(reta_id: str, body: RetaCreate, current=Depends(get_current_admin)):
    r = await db.retas.find_one({"id": reta_id})
    if not r:
        raise HTTPException(404, "Reta no encontrada")
    fecha_iso = construir_fecha_local_iso(body.fecha_str, body.hora_str, body.tz_offset_minutes)
    update = {
        "nombre": body.nombre,
        "club": body.club,
        "fecha_evento": fecha_iso,
        "canchas_disponibles": body.canchas_disponibles,
        "max_jugadores": 8 * body.canchas_disponibles,
        "costo_inscripcion": body.costo_inscripcion,
        "modalidad_juego": body.modalidad_juego,
        "num_rondas": body.num_rondas,
        "organizador_logo_url": body.organizador_logo_url,
        "observaciones_publicas": body.observaciones_publicas,
        "latitud": body.latitud,
        "longitud": body.longitud,
    }
    await db.retas.update_one({"id": reta_id}, {"$set": update})
    new = await db.retas.find_one({"id": reta_id}, {"_id": 0})
    return Reta(**new)


@router.delete("/{reta_id}")
async def delete_reta(reta_id: str, current=Depends(get_current_admin)):
    res = await db.retas.delete_one({"id": reta_id})
    if res.deleted_count == 0:
        raise HTTPException(404, "Reta no encontrada")
    await db.inscripciones.delete_many({"reta_id": reta_id})
    await db.lista_espera.delete_many({"reta_id": reta_id})
    await db.resultados.delete_many({"reta_id": reta_id})
    await db.stripe_transactions.delete_many({"reta_id": reta_id})
    return {"ok": True}


@router.get("/{reta_id}/inscripciones", response_model=List[Inscripcion])
async def list_inscripciones(reta_id: str, current=Depends(get_current_admin)):
    cursor = db.inscripciones.find({"reta_id": reta_id}, {"_id": 0}).sort("creado_en", 1).limit(500)
    out = []
    async for d in cursor:
        out.append(Inscripcion(**d))
    return out


@router.post("/{reta_id}/expirar-pendientes")
async def admin_expirar_pendientes(reta_id: str, current=Depends(get_current_admin)):
    """Liberación manual: elimina todas las inscripciones Pendientes (aunque
    aún no haya vencido el bloqueo) y promueve a quienes estén en cola."""
    reta = await db.retas.find_one({"id": reta_id}, {"_id": 0})
    if not reta:
        raise HTTPException(404, "Reta no encontrada")
    res = await expirar_bloqueos_pass(force_reta_id=reta_id)
    return {"ok": True, **res}
