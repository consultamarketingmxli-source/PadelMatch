"""Endpoints admin de Retas: CRUD + listar inscripciones + expirar pendientes + QR."""
import math
import os
from datetime import datetime
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel
from slugify import slugify

from auth import get_current_admin
from core.db import db
from core.helpers import compute_public, expirar_bloqueos_pass, strip_mongo
from core.image_utils import compress_logo_to_webp
from core.qr_utils import make_qr_png
from logica_torneo import construir_fecha_local_iso
from models import Inscripcion, Reta, RetaCreate, RetaPublic

router = APIRouter(prefix="/retas", tags=["retas"])


def _public_base_url() -> str:
    """URL pública del frontend (donde el invitado abrirá la reta).

    Convención del proyecto: usamos `APP_PUBLIC_URL` (igual que el resto del
    backend para success/cancel URLs de Stripe & MP). Como fallback intentamos
    `EXPO_PUBLIC_FRONTEND_URL`, y por último `EXPO_PUBLIC_BACKEND_URL` (mismo
    dominio en la preview de Emergent).
    """
    for var in ("APP_PUBLIC_URL", "EXPO_PUBLIC_FRONTEND_URL", "EXPO_PUBLIC_BACKEND_URL"):
        v = os.environ.get(var, "").strip().rstrip("/")
        if v:
            return v
    return ""


def _build_public_link(slug: str) -> str:
    base = _public_base_url()
    if not base:
        # último fallback — link relativo, igual sirve si el cliente ya conoce el host
        return f"/retas/{slug}"
    return f"{base}/retas/{slug}"


def _resolve_max_jugadores(body: RetaCreate) -> int:
    """Si el cliente manda max_jugadores explícito lo respeta (ya validado).
    Si NO lo manda, retrocompat: 8 jugadores por cancha (clientes antiguos)."""
    if body.max_jugadores is not None:
        return int(body.max_jugadores)
    return 8 * body.canchas_disponibles


def _derive_canchas(max_jugadores: int, declared: int) -> int:
    """Calcula cuántas canchas físicas hacen falta para `max_jugadores`.
    Cada cancha estándar = 8 jugadores; remanente de 4 = 1 cancha mini.
    Si el organizador declaró más canchas que las necesarias, las respeta."""
    necesarias = math.ceil(max_jugadores / 8)
    return max(int(declared), int(necesarias))


@router.post("", response_model=Reta)
async def create_reta(body: RetaCreate, current=Depends(get_current_admin)):
    fecha_iso = construir_fecha_local_iso(body.fecha_str, body.hora_str, body.tz_offset_minutes)
    base_slug = slugify(f"{body.nombre}-{body.club}-{body.fecha_str}")
    slug = base_slug
    n = 1
    while await db.retas.find_one({"url_slug": slug}):
        n += 1
        slug = f"{base_slug}-{n}"

    max_jug = _resolve_max_jugadores(body)
    canchas = _derive_canchas(max_jug, body.canchas_disponibles)
    logo_webp = compress_logo_to_webp(body.organizador_logo_url)

    reta = Reta(
        nombre=body.nombre,
        club=body.club,
        fecha_evento=fecha_iso,
        canchas_disponibles=canchas,
        max_jugadores=max_jug,
        costo_inscripcion=body.costo_inscripcion,
        modalidad_juego=body.modalidad_juego,
        num_rondas=body.num_rondas,
        formato_score=body.formato_score,
        url_slug=slug,
        organizador_logo_url=logo_webp,
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
    max_jug = _resolve_max_jugadores(body)
    canchas = _derive_canchas(max_jug, body.canchas_disponibles)
    logo_webp = compress_logo_to_webp(body.organizador_logo_url)
    update = {
        "nombre": body.nombre,
        "club": body.club,
        "fecha_evento": fecha_iso,
        "canchas_disponibles": canchas,
        "max_jugadores": max_jug,
        "costo_inscripcion": body.costo_inscripcion,
        "modalidad_juego": body.modalidad_juego,
        "num_rondas": body.num_rondas,
        "formato_score": body.formato_score.model_dump(),
        "organizador_logo_url": logo_webp,
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


# ----------------------------------------------------------------------
# Fase B — Compartir reta: link público, QR descargable, info elástica.
# ----------------------------------------------------------------------
class ShareInfo(BaseModel):
    reta_id: str
    nombre: str
    url_publica: str
    url_slug: str
    qr_endpoint: str  # ruta autenticada para descargar el PNG
    qr_publico: str   # ruta pública (sin auth) que también devuelve el PNG
    inscritos: int
    waitlist: int
    max_jugadores: int
    capacidad_pct: float
    semaforo: str
    sugerencia: str | None = None


def _sugerencia_capacidad(max_jug: int, inscritos: int) -> str | None:
    """Devuelve un consejo de UX sobre la capacidad declarada.

    Sembrar conciencia al organizador antes de que reciba inscripciones impares
    o sobrecapacidad. Mensajes cortos, listos para mostrar en banner.
    """
    if max_jug % 4 != 0:
        # No debería pasar (Pydantic ya lo bloquea), defensivo.
        sugerido = max(4, (max_jug // 4) * 4)
        return (
            f"Tu capacidad {max_jug} no es múltiplo de 4. Te sugerimos {sugerido} "
            "o habilitar lista de espera."
        )
    if inscritos >= max_jug:
        return (
            "Tu reta está al 100%. Nuevos jugadores entrarán automáticamente "
            "a la lista de espera (1 clic)."
        )
    libres = max_jug - inscritos
    if libres % 4 != 0:
        proximo_par = libres - (libres % 4)
        if proximo_par <= 0:
            return (
                "Pocos cupos restantes. Considera abrir lista de espera para "
                "no dejar a jugadores fuera."
            )
        return (
            f"Te quedan {libres} cupos. Idealmente cierras inscripciones cuando "
            f"queden múltiplos de 4 (faltan {libres - proximo_par} para el siguiente bloque)."
        )
    return None


@router.get("/{reta_id}/share-info", response_model=ShareInfo)
async def share_info(reta_id: str, current=Depends(get_current_admin)):
    """Devuelve metadatos para la pantalla 'Compartir reta' del admin."""
    r = await db.retas.find_one({"id": reta_id}, {"_id": 0})
    if not r:
        raise HTTPException(404, "Reta no encontrada")
    await compute_public(r)
    return ShareInfo(
        reta_id=r["id"],
        nombre=r["nombre"],
        url_publica=_build_public_link(r["url_slug"]),
        url_slug=r["url_slug"],
        qr_endpoint=f"/api/retas/{r['id']}/qr",
        qr_publico=f"/api/public/retas/{r['url_slug']}/qr",
        inscritos=r.get("inscritos_count", 0),
        waitlist=r.get("waitlist_count", 0),
        max_jugadores=r["max_jugadores"],
        capacidad_pct=r.get("capacidad_pct", 0.0),
        semaforo=r.get("semaforo", "VERDE"),
        sugerencia=_sugerencia_capacidad(r["max_jugadores"], r.get("inscritos_count", 0)),
    )


@router.get("/{reta_id}/qr")
async def reta_qr_png(reta_id: str, current=Depends(get_current_admin)):
    """PNG del QR codificando el link público de la reta. Admin-only."""
    r = await db.retas.find_one({"id": reta_id}, {"id": 1, "url_slug": 1, "_id": 0})
    if not r:
        raise HTTPException(404, "Reta no encontrada")
    url = _build_public_link(r["url_slug"])
    try:
        png = make_qr_png(url)
    except Exception as e:
        raise HTTPException(500, f"No se pudo generar QR: {e}")
    return Response(
        content=png,
        media_type="image/png",
        headers={
            "Cache-Control": "public, max-age=300",
            "Content-Disposition": f'inline; filename="qr-{r["url_slug"]}.png"',
        },
    )
