"""
Router de Notificaciones admin (Action Item #2).

Endpoints:
  • POST /api/retas/{id}/notify/recordatorio-general
        Envía recordatorio "2h antes" a TODOS los inscritos Aprobados.
  • POST /api/retas/{id}/notify/proximo-partido?ronda=N&cancha=M
        Envía WhatsApp a los jugadores que juegan la ronda N en (opcional) cancha M.
        Pareja-aware: si la reta es de parejas, usa el rol de dúos fijos.
  • POST /api/retas/{id}/notify/lista-espera
        Notifica a TODOS los usuarios en lista de espera con la URL pública de la reta.

Cada respuesta incluye:
  { sent, mocked, failed, total_targets, items: [{nombre, telefono, status, ...}] }
"""
from __future__ import annotations

import logging
import os
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from auth import get_current_admin
from core.db import db
from logica_torneo import generar_rol_multi_cancha, generar_rol_multi_cancha_parejas
from notifications import (
    construir_mensaje_recordatorio,
    construir_mensaje_waitlist_promovido,
    is_twilio_configured,
    send_whatsapp,
)

logger = logging.getLogger("padelappretas-os")
router = APIRouter(prefix="/retas", tags=["notificaciones-admin"])
twilio_router = APIRouter(prefix="/admin/twilio", tags=["notificaciones-admin"])


# -------------------- helpers --------------------
def _es_reta_de_parejas(reta: dict) -> bool:
    return reta.get("modalidad_registro", "individual") != "individual"


async def _get_reta_or_404(reta_id: str) -> dict:
    reta = await db.retas.find_one({"id": reta_id}, {"_id": 0})
    if not reta:
        raise HTTPException(404, "Reta no encontrada")
    return reta


async def _approved_inscriptions(reta_id: str) -> list[dict]:
    cursor = db.inscripciones.find(
        {"reta_id": reta_id, "estatus_pago": "Aprobado"},
        {"_id": 0, "id": 1, "nombre": 1, "telefono": 1, "pareja_grupo_id": 1},
    ).sort("creado_en", 1).limit(500)
    return [d async for d in cursor]


async def _build_rol(reta: dict) -> list[dict]:
    canchas = int(reta.get("canchas_disponibles", 1))
    num_rondas = int(reta.get("num_rondas", 7))
    if _es_reta_de_parejas(reta):
        # Resolver dúos completos para esta reta.
        inscs = await _approved_inscriptions(reta["id"])
        grupos: dict[str, list[str]] = {}
        for ins in inscs:
            gid = ins.get("pareja_grupo_id")
            if not gid:
                continue
            grupos.setdefault(gid, []).append(ins["nombre"])
        duos = [m for m in grupos.values() if len(m) == 2]
        if len(duos) < 2:
            return []
        return generar_rol_multi_cancha_parejas(duos, canchas, num_rondas)
    # Individual.
    inscs = await _approved_inscriptions(reta["id"])
    jugadores = [i["nombre"] for i in inscs]
    required = canchas * 8
    while len(jugadores) < required:
        jugadores.append(f"Jugador {len(jugadores) + 1}")
    jugadores = jugadores[:required]
    return generar_rol_multi_cancha(jugadores, canchas, num_rondas)


async def _phone_lookup(reta_id: str) -> dict[str, str]:
    """nombre → teléfono (case-insensitive, primer match)."""
    inscs = await _approved_inscriptions(reta_id)
    out: dict[str, str] = {}
    for i in inscs:
        out[i["nombre"].strip().lower()] = i.get("telefono", "")
    return out


# -------------------- endpoints --------------------
@router.post("/{reta_id}/notify/recordatorio-general")
async def notify_recordatorio_general(reta_id: str, current=Depends(get_current_admin)):
    """Envía un WhatsApp recordatorio a TODOS los inscritos Aprobados.

    Pensado para usarse ~2h antes del evento (el organizador dispara manualmente).
    Si Twilio no está configurado, los mensajes se mockean (status='mocked').
    """
    reta = await _get_reta_or_404(reta_id)
    inscs = await _approved_inscriptions(reta_id)
    if not inscs:
        return {
            "sent": 0, "mocked": 0, "failed": 0, "total_targets": 0,
            "configured": is_twilio_configured(),
            "items": [],
        }

    fecha = reta.get("fecha_evento")
    try:
        from datetime import datetime as _dt
        if isinstance(fecha, str):
            fecha_dt = _dt.fromisoformat(fecha.replace("Z", "+00:00"))
        else:
            fecha_dt = fecha
        hora_str = fecha_dt.strftime("%H:%M") if fecha_dt else "—"
    except Exception:
        hora_str = "—"

    sent = mocked = failed = 0
    items: list[dict[str, Any]] = []
    for ins in inscs:
        body = construir_mensaje_recordatorio(
            ins["nombre"], reta["nombre"], reta.get("club", ""), hora_str,
            reta.get("observaciones_publicas", ""),
        )
        res = await send_whatsapp(ins.get("telefono", ""), body)
        st = res.get("status", "error")
        if st == "sent":
            sent += 1
        elif st == "mocked":
            mocked += 1
        else:
            failed += 1
        items.append({
            "inscripcion_id": ins["id"],
            "nombre": ins["nombre"],
            "telefono": ins.get("telefono", ""),
            "status": st,
            "twilio_code": res.get("twilio_code"),
            "needs_sandbox_join": res.get("needs_sandbox_join", False),
        })

    return {
        "sent": sent, "mocked": mocked, "failed": failed,
        "total_targets": len(inscs),
        "configured": is_twilio_configured(),
        "items": items,
    }


@router.post("/{reta_id}/notify/proximo-partido")
async def notify_proximo_partido(
    reta_id: str,
    ronda: int = Query(..., ge=1, le=7, description="Número de ronda (1..7)"),
    cancha: Optional[int] = Query(
        default=None, ge=1,
        description="Opcional: solo notifica esta cancha. Por defecto todas las canchas.",
    ),
    current=Depends(get_current_admin),
):
    """Envía aviso a los jugadores que juegan la ronda `ronda` (y opcional `cancha`).

    Para reta individual: 4 jugadores por partido (pareja_a + pareja_b son
    parejas rotativas).
    Para reta de parejas: los dúos son FIJOS; igual son 4 jugadores por
    partido.
    """
    reta = await _get_reta_or_404(reta_id)
    rol_canchas = await _build_rol(reta)
    if not rol_canchas:
        raise HTTPException(
            409,
            "No hay rol generado. Para reta de parejas: empareja free-agents primero.",
        )

    # Recolectamos partidos de la ronda (y opcional cancha).
    partidos_objetivo: list[dict] = []
    for cancha_data in rol_canchas:
        if cancha is not None and cancha_data["cancha"] != cancha:
            continue
        for ronda_data in cancha_data["rondas"]:
            if ronda_data["ronda"] != ronda:
                continue
            for p_idx, partido in enumerate(ronda_data["partidos"], start=1):
                partidos_objetivo.append({
                    "cancha": cancha_data["cancha"],
                    "ronda": ronda_data["ronda"],
                    "partido": p_idx,
                    "pareja_a": partido.get("pareja_a") or [],
                    "pareja_b": partido.get("pareja_b") or [],
                })

    if not partidos_objetivo:
        raise HTTPException(
            404,
            f"No se encontraron partidos en ronda {ronda}"
            + (f" cancha {cancha}." if cancha else "."),
        )

    phones = await _phone_lookup(reta_id)
    sent = mocked = failed = skipped = 0
    items: list[dict[str, Any]] = []

    for p in partidos_objetivo:
        rival_a_txt = " & ".join(p["pareja_a"])
        rival_b_txt = " & ".join(p["pareja_b"])
        for jugador in (p["pareja_a"] + p["pareja_b"]):
            tel = phones.get(jugador.strip().lower())
            if not tel:
                # Placeholder ("Jugador 5"..."Pareja 3A") no tiene teléfono real.
                skipped += 1
                items.append({"nombre": jugador, "status": "skipped_no_phone"})
                continue
            # Construimos el mensaje. Pareja del propio jugador es la del lado donde aparece.
            propia_pareja = p["pareja_a"] if jugador in p["pareja_a"] else p["pareja_b"]
            rival = rival_b_txt if jugador in p["pareja_a"] else rival_a_txt
            companero = [n for n in propia_pareja if n != jugador]
            comp_txt = f" con {companero[0]}" if companero else ""
            body = (
                f"¡{jugador}! 🎾 Te toca AHORA en {reta.get('club', '')}.\n"
                f"Ronda {p['ronda']} · Cancha {p['cancha']} · Partido {p['partido']}\n"
                f"Juegas{comp_txt}.\n"
                f"Rivales: {rival}.\n"
                f"¡Suerte!"
            )
            res = await send_whatsapp(tel, body)
            st = res.get("status", "error")
            if st == "sent":
                sent += 1
            elif st == "mocked":
                mocked += 1
            else:
                failed += 1
            items.append({
                "nombre": jugador, "telefono": tel, "cancha": p["cancha"],
                "ronda": p["ronda"], "partido": p["partido"],
                "status": st,
                "twilio_code": res.get("twilio_code"),
                "needs_sandbox_join": res.get("needs_sandbox_join", False),
            })

    return {
        "sent": sent, "mocked": mocked, "failed": failed, "skipped": skipped,
        "total_targets": len(items),
        "partidos_procesados": len(partidos_objetivo),
        "configured": is_twilio_configured(),
        "items": items,
    }


@router.post("/{reta_id}/notify/lista-espera")
async def notify_lista_espera(reta_id: str, current=Depends(get_current_admin)):
    """Notifica a TODOS los inscritos en lista de espera con el link público
    para que se preparen por si se abre cupo."""
    reta = await _get_reta_or_404(reta_id)
    slug = reta.get("url_slug", "")
    base_url = (
        (await db.config.find_one({"id": "global"}) or {}).get(
            "frontend_base_url", "",
        ) or ""
    )
    link = f"{base_url}/retas/{slug}" if slug else slug

    cursor = db.lista_espera.find(
        {"reta_id": reta_id}, {"_id": 0},
    ).sort("creado_en", 1).limit(200)

    sent = mocked = failed = 0
    items: list[dict[str, Any]] = []
    async for entry in cursor:
        body = construir_mensaje_waitlist_promovido(
            entry.get("nombre", "Jugador"), reta["nombre"],
            link or "(consulta con el organizador)",
        )
        res = await send_whatsapp(entry.get("telefono", ""), body)
        st = res.get("status", "error")
        if st == "sent":
            sent += 1
        elif st == "mocked":
            mocked += 1
        else:
            failed += 1
        items.append({
            "nombre": entry.get("nombre"),
            "telefono": entry.get("telefono"),
            "status": st,
            "twilio_code": res.get("twilio_code"),
            "needs_sandbox_join": res.get("needs_sandbox_join", False),
        })

    return {
        "sent": sent, "mocked": mocked, "failed": failed,
        "total_targets": len(items),
        "configured": is_twilio_configured(),
        "items": items,
    }


# ============================================================================
# Sandbox info — instrucciones para que el destinatario se una al bot Twilio.
# ============================================================================
@twilio_router.get("/sandbox-info")
async def twilio_sandbox_info(current=Depends(get_current_admin)):
    """Devuelve las instrucciones de unión al sandbox Twilio WhatsApp.

    Pensado para que el organizador pueda mostrar a sus jugadores el código
    de "join" en pantalla / WhatsApp Business si la cuenta es Sandbox.
    """
    from notifications import get_join_instructions, is_twilio_configured
    sandbox_num = (
        os.getenv("TWILIO_WHATSAPP_FROM", "whatsapp:+14155238886")
        .replace("whatsapp:", "")
    )
    join_code = os.getenv("TWILIO_JOIN_CODE", "").strip()
    return {
        "configured": is_twilio_configured(),
        "is_sandbox": bool(join_code),
        "sandbox_number": sandbox_num,
        "join_code": join_code or None,
        "instructions": get_join_instructions(),
    }
