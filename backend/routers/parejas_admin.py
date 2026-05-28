"""
Router admin para gestión de Retas de Parejas (Fase 4 — Admin Edge Cases).

Endpoints:
  • GET    /api/retas/{id}/free-agents
        Lista inscripciones aprobadas sin pareja (free-agents pendientes).
  • POST   /api/retas/{id}/free-agents/match
        Empareja DOS inscripciones (free-agents) en un mismo dúo.
        Body: { inscripcion_a_id, inscripcion_b_id }
  • DELETE /api/retas/{id}/inscripciones/{insc_id}?modo=duo|solo
        Cancela una inscripción. Si `modo=duo` y la inscripción es parte de
        una pareja, se cancela TODA la pareja y se liberan 2 cupos.
        Si `modo=solo` y es parte de una pareja, el otro miembro queda
        marcado como `es_free_agent` (pendiente de re-emparejar).
  • GET    /api/retas/{id}/duos
        Devuelve los dúos actuales (agrupados por pareja_grupo_id) con
        ambos miembros — útil para Mesa de Control con bloques visuales.
"""
from __future__ import annotations

import logging
import uuid
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from auth import get_current_admin
from core.concurrency import liberar_lugar
from core.db import db
from core.helpers import promover_lista_espera

logger = logging.getLogger("padelappretas-os")
router = APIRouter(prefix="/retas", tags=["parejas-admin"])


# -------------------- Schemas --------------------
class FreeAgentItem(BaseModel):
    inscripcion_id: str
    nombre: str
    telefono: str
    creado_en: Optional[str] = None


class DuoItem(BaseModel):
    pareja_grupo_id: str
    miembros: list[dict]  # [{inscripcion_id, nombre, telefono, estatus_pago}, ...]


class MatchPairRequest(BaseModel):
    inscripcion_a_id: str = Field(min_length=8)
    inscripcion_b_id: str = Field(min_length=8)


class MatchPairResponse(BaseModel):
    ok: bool
    pareja_grupo_id: str
    miembros: list[dict]


class CancelResponse(BaseModel):
    ok: bool
    eliminadas: int
    libres_creadas: int = 0
    cupos_liberados: int = 0
    promoted: bool = False


# -------------------- Helpers --------------------
async def _es_reta_de_parejas_or_404(reta_id: str) -> dict:
    reta = await db.retas.find_one({"id": reta_id}, {"_id": 0})
    if not reta:
        raise HTTPException(404, "Reta no encontrada")
    if reta.get("modalidad_registro", "individual") == "individual":
        raise HTTPException(
            400, "Esta reta es individual; no aplica gestión de parejas/free-agents.",
        )
    return reta


# -------------------- Endpoints --------------------
@router.get("/{reta_id}/free-agents", response_model=list[FreeAgentItem])
async def listar_free_agents(reta_id: str, current=Depends(get_current_admin)):
    """Lista inscripciones APROBADAS sin pareja (es_free_agent=True o
    pareja_grupo_id NULL en reta de parejas)."""
    await _es_reta_de_parejas_or_404(reta_id)
    cursor = db.inscripciones.find(
        {
            "reta_id": reta_id,
            "estatus_pago": "Aprobado",
            "$or": [
                {"es_free_agent": True},
                {"pareja_grupo_id": None},
                {"pareja_grupo_id": {"$exists": False}},
            ],
        },
        {"_id": 0, "id": 1, "nombre": 1, "telefono": 1, "creado_en": 1, "pareja_grupo_id": 1},
    ).sort("creado_en", 1).limit(200)

    out: list[FreeAgentItem] = []
    async for d in cursor:
        # Defensa: si el doc tiene pareja_grupo_id pero su pareja todavía
        # NO está aprobada, igual lo dejamos fuera de la bolsa (no es free-agent estricto).
        if d.get("pareja_grupo_id"):
            continue
        creado = d.get("creado_en")
        out.append(FreeAgentItem(
            inscripcion_id=d["id"],
            nombre=d["nombre"],
            telefono=d.get("telefono", ""),
            creado_en=str(creado) if creado else None,
        ))
    return out


@router.get("/{reta_id}/duos", response_model=list[DuoItem])
async def listar_duos(reta_id: str, current=Depends(get_current_admin)):
    """Lista todos los dúos (agrupados por pareja_grupo_id) con sus miembros."""
    await _es_reta_de_parejas_or_404(reta_id)
    cursor = db.inscripciones.find(
        {
            "reta_id": reta_id,
            "pareja_grupo_id": {"$ne": None, "$exists": True},
        },
        {"_id": 0, "id": 1, "nombre": 1, "telefono": 1, "estatus_pago": 1, "pareja_grupo_id": 1},
    ).limit(500)

    grupos: dict[str, list[dict]] = {}
    async for ins in cursor:
        gid = ins["pareja_grupo_id"]
        grupos.setdefault(gid, []).append({
            "inscripcion_id": ins["id"],
            "nombre": ins["nombre"],
            "telefono": ins.get("telefono", ""),
            "estatus_pago": ins.get("estatus_pago", "Pendiente"),
        })
    return [DuoItem(pareja_grupo_id=g, miembros=m) for g, m in grupos.items()]


@router.post("/{reta_id}/free-agents/match", response_model=MatchPairResponse)
async def emparejar_free_agents(
    reta_id: str,
    body: MatchPairRequest,
    current=Depends(get_current_admin),
):
    """Empareja DOS inscripciones (free-agents) en un mismo dúo.

    - Verifica que ambas pertenezcan a la misma reta.
    - Verifica que ninguna tenga ya `pareja_grupo_id`.
    - Asigna el mismo UUID a ambas y limpia el flag `es_free_agent`.
    - Cross-snapshots de nombre/teléfono entre ambas.
    """
    await _es_reta_de_parejas_or_404(reta_id)
    if body.inscripcion_a_id == body.inscripcion_b_id:
        raise HTTPException(400, "Debes seleccionar 2 jugadores DIFERENTES.")

    ids = [body.inscripcion_a_id, body.inscripcion_b_id]
    docs = [d async for d in db.inscripciones.find(
        {"reta_id": reta_id, "id": {"$in": ids}},
        {"_id": 0},
    )]
    if len(docs) != 2:
        raise HTTPException(
            404, "Una o ambas inscripciones no existen en esta reta.",
        )

    for d in docs:
        if d.get("pareja_grupo_id"):
            raise HTTPException(
                409,
                f"La inscripción de {d['nombre']} ya pertenece a una pareja. "
                "Cancela primero la asociación previa.",
            )
        if d.get("telefono") and d["telefono"] == docs[0]["telefono"] and d != docs[0]:
            raise HTTPException(400, "Ambos jugadores tienen el mismo teléfono.")

    # Asignar pareja_grupo_id compartido y snapshot cruzado.
    pareja_grupo_id = str(uuid.uuid4())
    a = docs[0]
    b = docs[1]
    await db.inscripciones.update_one(
        {"id": a["id"]},
        {"$set": {
            "pareja_grupo_id": pareja_grupo_id,
            "es_free_agent": False,
            "pareja_nombre": b["nombre"],
            "pareja_telefono": b.get("telefono", ""),
        }},
    )
    await db.inscripciones.update_one(
        {"id": b["id"]},
        {"$set": {
            "pareja_grupo_id": pareja_grupo_id,
            "es_free_agent": False,
            "pareja_nombre": a["nombre"],
            "pareja_telefono": a.get("telefono", ""),
        }},
    )

    return MatchPairResponse(
        ok=True,
        pareja_grupo_id=pareja_grupo_id,
        miembros=[
            {"inscripcion_id": a["id"], "nombre": a["nombre"]},
            {"inscripcion_id": b["id"], "nombre": b["nombre"]},
        ],
    )


@router.delete("/{reta_id}/inscripciones/{insc_id}", response_model=CancelResponse)
async def cancelar_inscripcion(
    reta_id: str,
    insc_id: str,
    modo: Literal["duo", "solo"] = Query(
        default="duo",
        description=(
            "Cómo manejar la cancelación si la inscripción pertenece a una "
            "pareja: 'duo' = cancela ambos miembros (libera 2 cupos). "
            "'solo' = cancela solo este miembro y deja al otro como "
            "free-agent pendiente de re-emparejar."
        ),
    ),
    current=Depends(get_current_admin),
):
    """Cancela una inscripción aprobada. Pareja-aware.

    No aplica reembolsos automáticos (el reembolso vive en el endpoint
    /admin/refund). Esta operación libera cupo y promueve waitlist.
    """
    reta = await db.retas.find_one({"id": reta_id}, {"_id": 0})
    if not reta:
        raise HTTPException(404, "Reta no encontrada")

    insc = await db.inscripciones.find_one(
        {"id": insc_id, "reta_id": reta_id}, {"_id": 0},
    )
    if not insc:
        raise HTTPException(404, "Inscripción no encontrada en esta reta.")

    grupo_id = insc.get("pareja_grupo_id")
    if not grupo_id or modo == "solo":
        # Borrado individual.
        await db.inscripciones.delete_one({"id": insc_id})
        # Si era parte de un dúo, el compañero queda libre.
        free_creadas = 0
        if grupo_id:
            res = await db.inscripciones.update_many(
                {"reta_id": reta_id, "pareja_grupo_id": grupo_id},
                {"$set": {
                    "pareja_grupo_id": None,
                    "pareja_nombre": None,
                    "pareja_telefono": None,
                    "es_free_agent": True,
                }},
            )
            free_creadas = res.modified_count
        await liberar_lugar(reta_id, 1)
        promoted = bool(await promover_lista_espera(reta_id))
        return CancelResponse(
            ok=True,
            eliminadas=1,
            libres_creadas=free_creadas,
            cupos_liberados=1,
            promoted=promoted,
        )

    # modo == "duo" y hay grupo_id → borramos ambos miembros.
    ids = [
        d["id"] async for d in db.inscripciones.find(
            {"reta_id": reta_id, "pareja_grupo_id": grupo_id},
            {"id": 1, "_id": 0},
        )
    ]
    if not ids:
        raise HTTPException(404, "No se encontraron miembros del dúo.")

    await db.inscripciones.delete_many({"id": {"$in": ids}})
    cupos = len(ids)
    await liberar_lugar(reta_id, cupos)
    # Solo promovemos 1 vez (la siguiente entrada de waitlist).
    promoted = bool(await promover_lista_espera(reta_id))
    return CancelResponse(
        ok=True,
        eliminadas=len(ids),
        libres_creadas=0,
        cupos_liberados=cupos,
        promoted=promoted,
    )
