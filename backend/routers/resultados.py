"""Rol Round Robin + captura de resultados + tabla de posiciones."""
from typing import List

from fastapi import APIRouter, Depends, HTTPException

from auth import get_current_admin
from core.db import db
from logica_torneo import generar_rol_multi_cancha
from models import PartidoResultado, PartidoResultadoCreate, TablaPosicionEntry

router = APIRouter(tags=["resultados"])


def _calcular_ganador(score_a: int, score_b: int) -> str:
    if score_a > score_b:
        return "A"
    if score_b > score_a:
        return "B"
    return "EMPATE"


@router.get("/retas/{reta_id}/rol")
async def get_rol(reta_id: str, current=Depends(get_current_admin)):
    """Genera el rol Round Robin del torneo con los jugadores inscritos Aprobados.
    Rellena con placeholders si faltan jugadores."""
    reta = await db.retas.find_one({"id": reta_id}, {"_id": 0})
    if not reta:
        raise HTTPException(404, "Reta no encontrada")

    canchas = reta["canchas_disponibles"]
    num_rondas = reta.get("num_rondas", 7)
    required = canchas * 8

    cursor = db.inscripciones.find(
        {"reta_id": reta_id, "estatus_pago": "Aprobado"}, {"_id": 0},
    ).sort("creado_en", 1).limit(required)
    jugadores = [d["nombre"] async for d in cursor]
    while len(jugadores) < required:
        jugadores.append(f"Jugador {len(jugadores)+1}")
    jugadores = jugadores[:required]

    rol = generar_rol_multi_cancha(jugadores, canchas, num_rondas)
    return {
        "reta_id": reta_id,
        "canchas": canchas,
        "num_rondas": num_rondas,
        "jugadores": jugadores,
        "rol": rol,
    }


@router.post("/retas/{reta_id}/resultados", response_model=PartidoResultado)
async def registrar_resultado(
    reta_id: str,
    body: PartidoResultadoCreate,
    current=Depends(get_current_admin),
):
    """Registra o actualiza el score de un partido. Idempotente por
    (reta_id, cancha, ronda, partido_idx)."""
    reta = await db.retas.find_one({"id": reta_id}, {"_id": 0})
    if not reta:
        raise HTTPException(404, "Reta no encontrada")

    if body.cancha < 1 or body.cancha > reta["canchas_disponibles"]:
        raise HTTPException(400, "Cancha fuera de rango")
    if body.ronda < 1 or body.ronda > reta.get("num_rondas", 7):
        raise HTTPException(400, "Ronda fuera de rango")
    if len(body.pareja_a) != 2 or len(body.pareja_b) != 2:
        raise HTTPException(400, "Cada pareja debe tener exactamente 2 jugadores")

    ganador = _calcular_ganador(body.score_a, body.score_b)

    existing = await db.resultados.find_one({
        "reta_id": reta_id,
        "cancha": body.cancha,
        "ronda": body.ronda,
        "partido_idx": body.partido_idx,
    })

    if existing:
        update = {
            "pareja_a": body.pareja_a,
            "pareja_b": body.pareja_b,
            "score_a": body.score_a,
            "score_b": body.score_b,
            "ganador": ganador,
        }
        await db.resultados.update_one(
            {"id": existing["id"]}, {"$set": update}
        )
        existing.pop("_id", None)
        existing.update(update)
        return PartidoResultado(**existing)

    res = PartidoResultado(
        reta_id=reta_id,
        cancha=body.cancha,
        ronda=body.ronda,
        partido_idx=body.partido_idx,
        pareja_a=body.pareja_a,
        pareja_b=body.pareja_b,
        score_a=body.score_a,
        score_b=body.score_b,
        ganador=ganador,
    )
    doc = res.model_dump()
    doc["creado_en"] = doc["creado_en"].isoformat()
    await db.resultados.insert_one(doc)
    return res


@router.get("/retas/{reta_id}/resultados", response_model=List[PartidoResultado])
async def listar_resultados_admin(reta_id: str, current=Depends(get_current_admin)):
    cursor = db.resultados.find({"reta_id": reta_id}, {"_id": 0}).sort(
        [("cancha", 1), ("ronda", 1), ("partido_idx", 1)]
    ).limit(500)
    return [PartidoResultado(**d) async for d in cursor]


@router.get("/public/retas/{reta_id}/tabla", response_model=List[TablaPosicionEntry])
async def tabla_posiciones(reta_id: str):
    """Tabla de posiciones individual del torneo basada en resultados capturados."""
    reta = await db.retas.find_one({"id": reta_id}, {"_id": 0})
    if not reta:
        raise HTTPException(404, "Reta no encontrada")

    stats: dict[str, TablaPosicionEntry] = {}

    def _get(name: str) -> TablaPosicionEntry:
        if name not in stats:
            stats[name] = TablaPosicionEntry(nombre=name)
        return stats[name]

    cursor = db.resultados.find({"reta_id": reta_id}, {"_id": 0}).limit(500)
    async for r in cursor:
        for n in r["pareja_a"]:
            e = _get(n)
            e.partidos_jugados += 1
            e.juegos_a_favor += r["score_a"]
            e.juegos_en_contra += r["score_b"]
            if r["ganador"] == "A":
                e.partidos_ganados += 1
                e.puntos += 3
            elif r["ganador"] == "EMPATE":
                e.partidos_empatados += 1
                e.puntos += 1
            else:
                e.partidos_perdidos += 1
        for n in r["pareja_b"]:
            e = _get(n)
            e.partidos_jugados += 1
            e.juegos_a_favor += r["score_b"]
            e.juegos_en_contra += r["score_a"]
            if r["ganador"] == "B":
                e.partidos_ganados += 1
                e.puntos += 3
            elif r["ganador"] == "EMPATE":
                e.partidos_empatados += 1
                e.puntos += 1
            else:
                e.partidos_perdidos += 1

    for e in stats.values():
        e.diferencia = e.juegos_a_favor - e.juegos_en_contra
        e.efectividad = (
            round(e.partidos_ganados / e.partidos_jugados * 100, 1)
            if e.partidos_jugados else 0.0
        )

    ordenado = sorted(
        stats.values(),
        key=lambda e: (-e.puntos, -e.diferencia, -e.juegos_a_favor, e.nombre),
    )
    return ordenado
