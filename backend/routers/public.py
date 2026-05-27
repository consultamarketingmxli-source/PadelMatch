"""Endpoints públicos (sin auth): radar, búsqueda híbrida, detalle por slug, stats de jugador, QR."""
import os
import re
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response

from core.db import db
from core.helpers import compute_public, strip_mongo
from core.qr_utils import make_qr_png
from logica_torneo import obtener_distancia_km
from models import PlayerStats, RetaPublic

router = APIRouter(prefix="/public", tags=["public"])


@router.get("/retas/radar", response_model=List[RetaPublic])
async def radar(
    lat: Optional[float] = Query(None),
    lng: Optional[float] = Query(None),
    radio_km: float = Query(30.0, gt=0, le=200),
):
    """Compatibilidad legacy. Equivalente a /retas/buscar sin `q`."""
    return await buscar(q=None, lat=lat, lng=lng, radio_km=radio_km)


@router.get("/retas/buscar", response_model=List[RetaPublic])
async def buscar(
    q: Optional[str] = Query(None, max_length=120),
    lat: Optional[float] = Query(None, ge=-90, le=90),
    lng: Optional[float] = Query(None, ge=-180, le=180),
    radio_km: float = Query(30.0, gt=0, le=200),
):
    """Motor de búsqueda híbrido (tres vías paralelas y combinables):

    - Opción A (GPS): si `lat`/`lng` se proveen, filtra por radio Haversine.
      Retas SIN lat/lng son omitidas del filtro (no producen 500).
    - Opción B (Texto): si `q` se provee tras `trim().lower()`, busca coincidencia
      parcial case-insensitive en `nombre` y `club` (regex sobre índice texto).
    - Opción C (Fallback): si no hay `q` ni coords útiles, devuelve TODAS las
      retas activas y públicas ordenadas por `fecha_evento ASC`.
    - A+B son combinables: GPS filtra geo y `q` filtra texto sobre ese subconjunto.
    """
    # Sanitización defensiva (también pasamos por aquí cuando viene de /radar).
    q_norm: Optional[str] = None
    if q is not None:
        q_norm = q.strip().lower()
        if not q_norm:
            q_norm = None  # texto vacío o solo espacios → ignorar

    # Filtro Mongo base.
    mongo_filter: dict = {}
    if q_norm:
        # Escapamos metacaracteres regex para no romper si el usuario escribe "(" o ".".
        safe = re.escape(q_norm)
        mongo_filter["$or"] = [
            {"nombre": {"$regex": safe, "$options": "i"}},
            {"club":   {"$regex": safe, "$options": "i"}},
        ]

    cursor = db.retas.find(mongo_filter).sort("fecha_evento", 1).limit(500)
    out: list = []
    async for r in cursor:
        strip_mongo(r)
        # Filtro geo: solo aplica si el usuario activó GPS.
        if lat is not None and lng is not None:
            # Defensa: una reta sin lat/lng se omite (no se cuenta como match geo).
            if r.get("latitud") is None or r.get("longitud") is None:
                continue
            try:
                dist = obtener_distancia_km(lat, lng, r["latitud"], r["longitud"])
            except Exception:
                # Coords corruptas (tipo string, NaN, etc.) → omitir, no romper.
                continue
            if dist > radio_km:
                continue
            r["distancia_km"] = round(dist, 2)
        await compute_public(r)
        out.append(RetaPublic(**r))
    return out


@router.get("/retas/{slug}", response_model=RetaPublic)
async def get_reta_by_slug(slug: str):
    r = await db.retas.find_one({"url_slug": slug}, {"_id": 0})
    if not r:
        raise HTTPException(404, "Reta no encontrada")
    await compute_public(r)
    return RetaPublic(**r)


@router.get("/retas/{slug}/qr")
async def public_reta_qr(slug: str):
    """PNG del QR (público, sin auth) — sirve para imprimir desde cualquier
    máquina sin necesidad de loguearse al admin."""
    r = await db.retas.find_one({"url_slug": slug}, {"url_slug": 1, "_id": 0})
    if not r:
        raise HTTPException(404, "Reta no encontrada")
    base = ""
    for var in ("APP_PUBLIC_URL", "EXPO_PUBLIC_FRONTEND_URL", "EXPO_PUBLIC_BACKEND_URL"):
        v = os.environ.get(var, "").strip().rstrip("/")
        if v:
            base = v
            break
    url = f"{base}/retas/{slug}" if base else f"/retas/{slug}"
    try:
        png = make_qr_png(url)
    except Exception as e:
        raise HTTPException(500, f"No se pudo generar QR: {e}")
    return Response(
        content=png,
        media_type="image/png",
        headers={
            "Cache-Control": "public, max-age=600",
            "Content-Disposition": f'inline; filename="qr-{slug}.png"',
        },
    )


@router.get("/players/{telefono}/stats", response_model=PlayerStats)
async def player_stats(telefono: str):
    user = await db.usuarios.find_one({"telefono": telefono}, {"_id": 0})
    if not user:
        return PlayerStats(
            jugador_id="", nombre="", partidos_jugados=0, partidos_ganados=0, efectividad=0.0,
        )

    nombre = user["nombre"]
    cursor = db.resultados.find(
        {"$or": [{"pareja_a": nombre}, {"pareja_b": nombre}]},
        {"_id": 0},
    ).limit(1000)
    total = 0
    ganados = 0
    async for r in cursor:
        total += 1
        en_a = nombre in r["pareja_a"]
        if en_a and r["ganador"] == "A":
            ganados += 1
        elif (not en_a) and r["ganador"] == "B":
            ganados += 1
    efectividad = (ganados / total * 100) if total else 0.0
    return PlayerStats(
        jugador_id=user["id"],
        nombre=nombre,
        partidos_jugados=total,
        partidos_ganados=ganados,
        efectividad=round(efectividad, 1),
    )
