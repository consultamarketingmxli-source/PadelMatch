"""
Exportación CSV / PDF — Rol y Clasificación Final.

Endpoints (admin only):
  • GET /api/retas/{reta_id}/rol/csv           — CSV del Rol Round Robin completo
  • GET /api/retas/{reta_id}/clasificacion/csv — CSV de la clasificación final
  • GET /api/retas/{reta_id}/clasificacion/pdf — PDF A4 con podium + tabla

El PDF del rol ya existe en pdf_router.py (POST /retas/{id}/pdf). Aquí
agregamos el resto para cerrar la suite de exportación.
"""
from __future__ import annotations

import base64
import csv
import io
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from auth import get_current_admin
from core.db import db
from core.standings import compute_duo_standings, compute_individual_standings
from logica_torneo import generar_rol_multi_cancha, generar_rol_multi_cancha_parejas
from pdf_generator import generar_pdf_clasificacion

router = APIRouter(prefix="/retas", tags=["export"])


def _es_reta_de_parejas(reta: dict) -> bool:
    return reta.get("modalidad_registro", "individual") != "individual"


# ----------------------- helpers -----------------------

async def _get_reta_or_404(reta_id: str) -> dict:
    reta = await db.retas.find_one({"id": reta_id}, {"_id": 0})
    if not reta:
        raise HTTPException(404, "Reta no encontrada")
    return reta


async def _get_jugadores_aprobados(reta_id: str, required: int) -> List[str]:
    """Devuelve los nombres de los jugadores aprobados (en orden de creado_en)
    completando con placeholders 'Jugador X' si faltan."""
    cursor = db.inscripciones.find(
        {"reta_id": reta_id, "estatus_pago": "Aprobado"},
        {"_id": 0},
    ).sort("creado_en", 1).limit(required)
    jugadores: List[str] = []
    async for d in cursor:
        jugadores.append(d.get("nombre", "—"))
    while len(jugadores) < required:
        jugadores.append(f"Jugador {len(jugadores) + 1}")
    return jugadores[:required]


async def _get_duos_aprobados(reta_id: str) -> List[List[str]]:
    """Agrupa inscripciones aprobadas por `pareja_grupo_id` y devuelve dúos completos."""
    cursor = db.inscripciones.find(
        {"reta_id": reta_id, "estatus_pago": "Aprobado"},
        {"_id": 0, "nombre": 1, "pareja_grupo_id": 1, "creado_en": 1},
    ).sort("creado_en", 1).limit(500)
    grupos: dict[str, list[str]] = {}
    async for ins in cursor:
        gid = ins.get("pareja_grupo_id")
        if not gid:
            continue
        grupos.setdefault(gid, []).append(ins["nombre"])
    return [m for m in grupos.values() if len(m) == 2]


def _safe_slug(reta: dict) -> str:
    return (reta.get("url_slug") or reta.get("id") or "reta").replace("/", "-")


def _csv_response(rows: List[List[str]], filename: str) -> StreamingResponse:
    """Construye una StreamingResponse CSV (UTF-8 con BOM para Excel)."""
    buf = io.StringIO()
    # BOM hace que Excel detecte UTF-8 automáticamente.
    buf.write("\ufeff")
    writer = csv.writer(buf, delimiter=",", quoting=csv.QUOTE_MINIMAL)
    for row in rows:
        writer.writerow(row)
    data = buf.getvalue().encode("utf-8")
    return StreamingResponse(
        io.BytesIO(data),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ----------------------- CSV: Rol Round Robin -----------------------

@router.get("/{reta_id}/rol/csv")
async def export_rol_csv(reta_id: str, current=Depends(get_current_admin)):
    """CSV con el rol Round Robin completo (cancha, ronda, partido, parejas).
    Detecta si la reta es de parejas y usa el motor de dúos fijos."""
    reta = await _get_reta_or_404(reta_id)

    num_rondas = reta.get("num_rondas", 7)
    canchas = reta.get("canchas_disponibles", 1)

    if _es_reta_de_parejas(reta):
        duos = await _get_duos_aprobados(reta_id)
        # Rellenamos con dúos placeholder si faltan, en pares.
        max_jug = int(reta.get("max_jugadores") or canchas * 8)
        max_duos = max_jug // 2
        while len(duos) + 2 <= max_duos:
            duos.append([f"Pareja {len(duos)+1}A", f"Pareja {len(duos)+1}B"])
        if len(duos) < 2:
            raise HTTPException(
                409,
                "Aún no hay dúos completos para exportar. Inscribe parejas o "
                "empareja free-agents antes de exportar el rol.",
            )
        rol_canchas = generar_rol_multi_cancha_parejas(duos, canchas, num_rondas)
    else:
        required = canchas * 8
        jugadores = await _get_jugadores_aprobados(reta_id, required)
        rol_canchas = generar_rol_multi_cancha(jugadores, canchas, num_rondas)

    rows: List[List[str]] = [[
        "Cancha", "Ronda", "Partido",
        "Pareja A — Jugador 1", "Pareja A — Jugador 2",
        "Pareja B — Jugador 1", "Pareja B — Jugador 2",
    ]]
    for cancha_data in rol_canchas:
        cancha_num = cancha_data["cancha"]
        for ronda in cancha_data["rondas"]:
            ronda_num = ronda["ronda"]
            for p_idx, partido in enumerate(ronda["partidos"], start=1):
                pa = partido.get("pareja_a", ["—", "—"])
                pb = partido.get("pareja_b", ["—", "—"])
                pa = (pa + ["—", "—"])[:2]
                pb = (pb + ["—", "—"])[:2]
                rows.append([
                    str(cancha_num),
                    str(ronda_num),
                    str(p_idx),
                    pa[0], pa[1], pb[0], pb[1],
                ])

    filename = f"rol-{_safe_slug(reta)}.csv"
    return _csv_response(rows, filename)


# ----------------------- CSV: Clasificación final -----------------------

@router.get("/{reta_id}/clasificacion/csv")
async def export_clasificacion_csv(
    reta_id: str,
    current=Depends(get_current_admin),
):
    """CSV con la clasificación final (todas las columnas)."""
    reta = await _get_reta_or_404(reta_id)

    cursor = db.resultados.find({"reta_id": reta_id}, {"_id": 0}).limit(2000)
    docs = [d async for d in cursor]
    if _es_reta_de_parejas(reta):
        standings = compute_duo_standings(docs, ordenar=True, criterio=reta.get("criterio_desempate", "A"))
        col_titulo = "Pareja"
    else:
        standings = compute_individual_standings(docs, ordenar=True, criterio=reta.get("criterio_desempate", "A"))
        col_titulo = "Jugador"

    rows: List[List[str]] = [[
        "Posición", col_titulo,
        "PJ", "PG", "PE", "PP",
        "GF", "GC", "DG",
        "Efectividad (%)", "Puntos",
    ]]
    for idx, e in enumerate(standings, start=1):
        rows.append([
            str(idx),
            e.nombre,
            str(e.partidos_jugados),
            str(e.partidos_ganados),
            str(e.partidos_empatados),
            str(e.partidos_perdidos),
            str(e.juegos_a_favor),
            str(e.juegos_en_contra),
            f"{e.diferencia:+d}",
            f"{e.efectividad}",
            str(e.puntos),
        ])

    filename = f"clasificacion-{_safe_slug(reta)}.csv"
    return _csv_response(rows, filename)


# ----------------------- PDF: Clasificación final -----------------------

@router.get("/{reta_id}/clasificacion/pdf")
async def export_clasificacion_pdf(
    reta_id: str,
    current=Depends(get_current_admin),
):
    """PDF A4 con podium top-3 + tabla completa de clasificación."""
    reta = await _get_reta_or_404(reta_id)

    cursor = db.resultados.find({"reta_id": reta_id}, {"_id": 0}).limit(2000)
    docs = [d async for d in cursor]
    if _es_reta_de_parejas(reta):
        standings_entries = compute_duo_standings(docs, ordenar=True, criterio=reta.get("criterio_desempate", "A"))
    else:
        standings_entries = compute_individual_standings(docs, ordenar=True, criterio=reta.get("criterio_desempate", "A"))

    # Convertir a dicts simples para el generador (evita pydantic en pdf).
    standings = [
        {
            "nombre": e.nombre,
            "partidos_jugados": e.partidos_jugados,
            "partidos_ganados": e.partidos_ganados,
            "partidos_empatados": e.partidos_empatados,
            "partidos_perdidos": e.partidos_perdidos,
            "juegos_a_favor": e.juegos_a_favor,
            "juegos_en_contra": e.juegos_en_contra,
            "diferencia": e.diferencia,
            "efectividad": e.efectividad,
            "puntos": e.puntos,
        }
        for e in standings_entries
    ]

    logo_bytes: Optional[bytes] = None
    logo_url = reta.get("organizador_logo_url")
    if logo_url and logo_url.startswith("data:image"):
        try:
            b64 = logo_url.split(",", 1)[1]
            logo_bytes = base64.b64decode(b64)
        except Exception:
            logo_bytes = None

    pdf_bytes = generar_pdf_clasificacion(reta, standings, logo_bytes)
    filename = f"clasificacion-{_safe_slug(reta)}.pdf"
    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
