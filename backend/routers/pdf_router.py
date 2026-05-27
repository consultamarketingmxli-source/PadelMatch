"""Generación de PDF A4 con el rol Round Robin."""
import base64
import io
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from auth import get_current_admin
from core.db import db
from logica_torneo import generar_rol_multi_cancha
from models import PDFRequest
from pdf_generator import generar_pdf_rol

router = APIRouter(prefix="/retas", tags=["pdf"])


@router.post("/{reta_id}/pdf")
async def generar_pdf_reta(
    reta_id: str,
    body: Optional[PDFRequest] = None,
    current=Depends(get_current_admin),
):
    """Genera PDF A4 del rol. Si body.jugadores se omite, usa los inscritos aprobados."""
    reta = await db.retas.find_one({"id": reta_id}, {"_id": 0})
    if not reta:
        raise HTTPException(404, "Reta no encontrada")

    num_rondas = body.num_rondas if body else reta.get("num_rondas", 7)
    canchas = reta["canchas_disponibles"]
    required = canchas * 8

    if body and body.jugadores:
        jugadores = body.jugadores
    else:
        cursor = db.inscripciones.find(
            {"reta_id": reta_id, "estatus_pago": "Aprobado"},
            {"_id": 0},
        ).sort("creado_en", 1).limit(required)
        jugadores = []
        async for d in cursor:
            jugadores.append(d["nombre"])

    while len(jugadores) < required:
        jugadores.append(f"Jugador {len(jugadores)+1}")
    jugadores = jugadores[:required]

    rol_canchas = generar_rol_multi_cancha(jugadores, canchas, num_rondas)

    logo_bytes = None
    logo_url = reta.get("organizador_logo_url")
    if logo_url and logo_url.startswith("data:image"):
        try:
            b64 = logo_url.split(",", 1)[1]
            logo_bytes = base64.b64decode(b64)
        except Exception:
            logo_bytes = None

    pdf_bytes = generar_pdf_rol(reta, rol_canchas, logo_bytes)
    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="rol-{reta["url_slug"]}.pdf"',
        },
    )
