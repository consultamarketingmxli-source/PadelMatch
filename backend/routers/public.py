"""Endpoints públicos (sin auth): radar, detalle por slug, stats de jugador."""
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Query

from core.db import db
from core.helpers import compute_public, strip_mongo
from logica_torneo import obtener_distancia_km
from models import PlayerStats, RetaPublic

router = APIRouter(prefix="/public", tags=["public"])


@router.get("/retas/radar", response_model=List[RetaPublic])
async def radar(
    lat: Optional[float] = Query(None),
    lng: Optional[float] = Query(None),
    radio_km: float = Query(30.0, gt=0, le=200),
):
    """Si lat/lng se proveen, filtra por radio. Si no, retorna todas las retas futuras."""
    cursor = db.retas.find().sort("fecha_evento", 1).limit(500)
    out = []
    async for r in cursor:
        strip_mongo(r)
        if lat is not None and lng is not None:
            if not r.get("latitud") or not r.get("longitud"):
                continue
            dist = obtener_distancia_km(lat, lng, r["latitud"], r["longitud"])
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
