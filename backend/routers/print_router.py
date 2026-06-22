"""
Print Router — Generación de PDFs profesionales con WeasyPrint.

Endpoints:
    GET  /api/admin/retas/{reta_id}/print-rol      — Hoja inicial (scores en blanco "___ - ___")
    GET  /api/admin/retas/{reta_id}/print-results  — Hoja final  (scores capturados + tabla)

Diseño: Clonado fiel de image_5.png (header simétrico, navy #1E3A8A,
tabla de posiciones final, bloques de rondas, footer institucional).

Stack:
    - WeasyPrint 69+ (HTML/CSS → PDF, sin Node)
    - Jinja2 (templating)
    - qrcode (Python lib, ya instalada) para el QR de resultados en vivo
"""
from __future__ import annotations

import base64
import io
import logging
import os
from datetime import datetime
from typing import Any, Dict, List, Optional

import qrcode
from fastapi import APIRouter, Depends, HTTPException, Response
from jinja2 import Environment, FileSystemLoader, select_autoescape
from weasyprint import HTML  # type: ignore

from auth import get_current_admin
from core.db import db
from logica_torneo import generar_rol_multi_cancha

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin/retas", tags=["print"])

# ──────────────────────────────────────────────────────────────────────────
# Jinja2 setup
# ──────────────────────────────────────────────────────────────────────────
_TEMPLATES_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "templates")
_env = Environment(
    loader=FileSystemLoader(_TEMPLATES_DIR),
    autoescape=select_autoescape(["html", "xml"]),
)


# ──────────────────────────────────────────────────────────────────────────
# Utilidades
# ──────────────────────────────────────────────────────────────────────────
def _qr_data_uri(payload: str, box_size: int = 6) -> str:
    """Genera un QR code PNG en base64 (data: URI) para incrustar en HTML."""
    qr = qrcode.QRCode(
        version=None,
        error_correction=qrcode.constants.ERROR_CORRECT_M,
        box_size=box_size,
        border=2,
    )
    qr.add_data(payload)
    qr.make(fit=True)
    img = qr.make_image(fill_color="#0F172A", back_color="white")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


def _format_fecha(iso_str: str) -> str:
    """Formato amigable para la hoja impresa: dd/mm/aaaa HH:MM-HH:MM."""
    try:
        dt = datetime.fromisoformat(iso_str.replace("Z", "+00:00"))
        return dt.strftime("%d/%m/%Y %H:%M")
    except Exception:
        return iso_str or ""


def _safe_pareja(nombre: Any) -> str:
    if isinstance(nombre, dict):
        return f"{nombre.get('jugador_a','?')} &amp; {nombre.get('jugador_b','?')}"
    if isinstance(nombre, list):
        return " &amp; ".join(str(x) for x in nombre)
    return str(nombre or "—")


async def _fetch_jugadores(reta: Dict[str, Any]) -> List[str]:
    """Obtiene la lista de jugadores aprobados ordenados por inscripción."""
    cursor = db.inscripciones.find(
        {"reta_id": reta["id"], "estatus_pago": "Aprobado"},
        {"_id": 0},
    ).sort("creado_en", 1)
    jugadores: List[str] = []
    async for d in cursor:
        jugadores.append(d.get("nombre", "—"))
    # Rellenar al múltiplo requerido (placeholder visual).
    required = reta["canchas_disponibles"] * 8
    while len(jugadores) < required:
        jugadores.append(f"Jugador {len(jugadores)+1}")
    return jugadores[:required]


async def _build_resultados_map(reta_id: str) -> Dict[str, str]:
    """Mapa {ronda_cancha: 'X - Y'} para inyectar scores en /print-results."""
    out: Dict[str, str] = {}
    async for r in db.resultados.find({"reta_id": reta_id}, {"_id": 0}):
        key = f"r{r.get('ronda')}_c{r.get('cancha')}_p{r.get('partido', 0)}"
        # Soporte para distintos esquemas de score
        score = None
        if "marcador1" in r and "marcador2" in r:
            score = f"{r['marcador1']} - {r['marcador2']}"
        elif "score" in r:
            score = str(r["score"])
        if score:
            out[key] = score
    return out


def _build_rondas(
    rol_data: List[Dict[str, Any]],
    resultados_map: Dict[str, str],
    num_rondas: int,
    horarios: Optional[List[str]] = None,
) -> List[Dict[str, Any]]:
    """Transforma el rol generado a la estructura plana que consume el template.

    rol_data esperado:  [{"cancha": 1, "rondas": [{"ronda": 1, "partidos": [...]}, ...]}, ...]
    Output:             [{"numero": 1, "horario": ...?, "partidos": [{cancha, pareja1, pareja2, score}], "descansan": "..."}]
    """
    out: List[Dict[str, Any]] = []
    # Indexar por ronda
    por_ronda: Dict[int, List[Dict[str, Any]]] = {n: [] for n in range(1, num_rondas + 1)}
    descansan_por_ronda: Dict[int, set] = {n: set() for n in range(1, num_rondas + 1)}

    for cancha_obj in rol_data:
        cancha = cancha_obj.get("cancha")
        for ronda in cancha_obj.get("rondas", []):
            n = ronda.get("ronda")
            for p in ronda.get("partidos", []):
                key = f"r{n}_c{cancha}_p{p.get('partido', 0)}"
                pareja1 = _safe_pareja(p.get("pareja1") or p.get("p1") or p.get("equipo1"))
                pareja2 = _safe_pareja(p.get("pareja2") or p.get("p2") or p.get("equipo2"))
                por_ronda.setdefault(n, []).append(
                    {
                        "cancha": cancha,
                        "pareja1": pareja1,
                        "pareja2": pareja2,
                        "score": resultados_map.get(key),
                    }
                )
            for d in ronda.get("descansan", []) or []:
                descansan_por_ronda.setdefault(n, set()).add(str(d))

    for n in range(1, num_rondas + 1):
        out.append(
            {
                "numero": n,
                "horario": horarios[n - 1] if horarios and n - 1 < len(horarios) else None,
                "partidos": por_ronda.get(n, []),
                "descansan": ", ".join(sorted(descansan_por_ronda.get(n, set()))),
            }
        )
    return out


async def _is_reta_completed(reta_id: str, reta: Dict[str, Any]) -> bool:
    """Detecta si TODOS los partidos tienen score capturado.

    Heurística:
        - Total esperado = num_rondas × canchas × (partidos_por_ronda_cancha)
        - Para individual: 1 partido por cancha-ronda
        - Para parejas:    igual (1 partido cancha-ronda)
        - Comparamos contra docs en db.resultados.
    """
    expected = reta.get("num_rondas", 7) * reta.get("canchas_disponibles", 1)
    actual = await db.resultados.count_documents({"reta_id": reta_id})
    return actual >= expected and expected > 0


# ──────────────────────────────────────────────────────────────────────────
# Core render
# ──────────────────────────────────────────────────────────────────────────
async def _render_pdf(reta_id: str, mode: str) -> bytes:
    """Render común. mode = 'rol' | 'results'."""
    reta = await db.retas.find_one({"id": reta_id}, {"_id": 0})
    if not reta:
        raise HTTPException(404, "Reta no encontrada")

    # Activación condicional para "results"
    if mode == "results" and not await _is_reta_completed(reta_id, reta):
        raise HTTPException(
            409,
            "La reta aún no está completada — captura todos los scores antes "
            "de generar la hoja final.",
        )

    jugadores = await _fetch_jugadores(reta)
    rol_data = generar_rol_multi_cancha(
        jugadores,
        reta["canchas_disponibles"],
        reta.get("num_rondas", 7),
    )
    resultados_map = await _build_resultados_map(reta_id) if mode == "results" else {}
    rondas = _build_rondas(rol_data, resultados_map, reta.get("num_rondas", 7))

    standings = []
    if mode == "results":
        from routers.resultados import _build_standings  # import local — evitar circular
        entries = await _build_standings(reta_id)
        for e in entries:
            d = e.model_dump() if hasattr(e, "model_dump") else dict(e)
            standings.append(d)

    # QR — URL pública de la tabla en vivo.
    base_url = os.getenv("EMERGENT_FRONTEND_URL", "https://padel-tournament-hub-9.preview.emergentagent.com")
    qr_payload = f"{base_url.rstrip('/')}/retas/{reta.get('url_slug', reta_id)}/tabla"
    qr_uri = _qr_data_uri(qr_payload)

    # Logo del organizador (opcional)
    logo_uri: Optional[str] = None
    if reta.get("organizador_logo_url"):
        try:
            import httpx
            with httpx.Client(timeout=4.0) as cli:
                resp = cli.get(reta["organizador_logo_url"])
                if resp.status_code == 200:
                    mime = resp.headers.get("content-type", "image/png").split(";")[0]
                    logo_uri = f"data:{mime};base64,{base64.b64encode(resp.content).decode()}"
        except Exception as exc:
            logger.warning("No se pudo descargar logo: %s", exc)

    # Iconmark de PadelAppRetas para el footer
    footer_icon_uri: Optional[str] = None
    try:
        iconmark = "/app/frontend/assets/brand/iconmark-64.png"
        if os.path.exists(iconmark):
            with open(iconmark, "rb") as f:
                footer_icon_uri = f"data:image/png;base64,{base64.b64encode(f.read()).decode()}"
    except Exception:
        pass

    # Render Jinja
    template = _env.get_template("print_rol.html")
    titulo = "RESULTADOS FINAL" if mode == "results" else "ROL INICIAL"
    html_str = template.render(
        titulo=titulo,
        mode=mode,
        reta=reta,
        organizador=reta.get("organizador_nombre")
        or reta.get("organizador_id", "Organizador"),
        num_participantes=len([j for j in jugadores if not j.startswith("Jugador ")]),
        canchas_lista=", ".join(str(i + 1) for i in range(reta.get("canchas_disponibles", 1))),
        fecha_fmt=_format_fecha(reta.get("fecha_evento", "")),
        rondas=rondas,
        standings=standings,
        qr_data_uri=qr_uri,
        logo_data_uri=logo_uri,
        footer_icon_data_uri=footer_icon_uri,
    )

    # WeasyPrint → PDF bytes
    pdf_bytes: bytes = HTML(string=html_str, base_url=_TEMPLATES_DIR).write_pdf()
    return pdf_bytes


# ──────────────────────────────────────────────────────────────────────────
# Endpoints
# ──────────────────────────────────────────────────────────────────────────
@router.get("/{reta_id}/print-rol")
async def print_rol(reta_id: str, current=Depends(get_current_admin)):
    """Hoja inicial para llenar a mano en cancha."""
    pdf = await _render_pdf(reta_id, mode="rol")
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'inline; filename="rol-{reta_id[:8]}.pdf"',
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.get("/{reta_id}/print-results")
async def print_results(reta_id: str, current=Depends(get_current_admin)):
    """Hoja final con marcadores capturados + tabla de posiciones."""
    pdf = await _render_pdf(reta_id, mode="results")
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'inline; filename="resultados-{reta_id[:8]}.pdf"',
            "X-Content-Type-Options": "nosniff",
        },
    )
