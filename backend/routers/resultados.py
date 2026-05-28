"""Rol Round Robin + captura de resultados + tabla de posiciones.

Fase C — Mesa de Control en Vivo:
    - POST /api/retas/{id}/resultados → upsert atómico (admin only).
    - DELETE /api/retas/{id}/resultados/{result_id} → corregir error tipográfico.
    - GET /api/retas/{id}/resultados → admin: todos.
    - GET /api/public/retas/{id}/tabla → tabla pública (compat retrocompat).
    - GET /api/retas/{id}/clasificacion → tabla individual con auth admin
      o player aprobado (PG→DG→GF). Si el caller no está aprobado: 403.

Cualquier escritura (upsert / delete) emite un broadcast WS en el canal
`reta_id` con `{type:"standings_updated"}` para que la tabla viva se refresque
en TODOS los dispositivos conectados (jugadores aprobados + admin).
"""
from typing import List, Optional

from fastapi import APIRouter, Depends, Header, HTTPException

from auth import decode_token, get_current_admin
from core.db import db
from core.realtime import manager
from core.standings import compute_individual_standings
from logica_torneo import generar_rol_multi_cancha
from models import PartidoResultado, PartidoResultadoCreate, TablaPosicionEntry

router = APIRouter(tags=["resultados"])


# ---------- helpers ----------
def _calcular_ganador(score_a: int, score_b: int) -> str:
    if score_a > score_b:
        return "A"
    if score_b > score_a:
        return "B"
    return "EMPATE"


async def _broadcast_standings(reta_id: str, **extra) -> None:
    """Empuja un evento al canal de la reta. Nunca lanza."""
    try:
        await manager.broadcast(
            reta_id,
            {"type": "standings_updated", "reta_id": reta_id, **extra},
        )
    except Exception:
        # Defensivo: si el WS falla por cualquier razón, no rompemos el write.
        pass


async def _ensure_player_can_view(reta_id: str, auth_header: Optional[str]) -> dict:
    """Verifica que el caller tenga permiso para ver tabla en vivo.

    Permite:
        - Admin (cualquier admin) → token bearer admin estándar.
        - Player con inscripción 'Aprobado' en esta reta (token player JWT).

    Lanza:
        - 401 si no hay token.
        - 403 si el token es válido pero el caller no es admin ni player aprobado.
    """
    if not auth_header or not auth_header.lower().startswith("bearer "):
        raise HTTPException(401, "Token requerido para ver la tabla en vivo.")
    token = auth_header.split(" ", 1)[1]
    try:
        payload = decode_token(token)
    except Exception:
        raise HTTPException(401, "Token inválido o expirado.")

    role = payload.get("role")
    if role == "admin":
        return payload

    if role == "player":
        telefono = payload.get("sub")
        if not telefono:
            raise HTTPException(401, "Token de jugador inválido.")
        ins = await db.inscripciones.find_one(
            {"reta_id": reta_id, "telefono": telefono},
            {"_id": 0, "estatus_pago": 1},
        )
        if not ins:
            raise HTTPException(
                403,
                "No estás inscrito en esta reta. Solo los jugadores aprobados pueden ver la tabla en vivo.",
            )
        if ins.get("estatus_pago") != "Aprobado":
            raise HTTPException(
                403,
                "Tu pago aún no está aprobado. Cuando se confirme verás la tabla en vivo.",
            )
        return payload

    raise HTTPException(403, "No autorizado para ver la tabla.")


# ---------- ROL Round Robin ----------
async def _resolver_jugadores_de_reta(reta: dict) -> List[str]:
    """Devuelve la lista ordenada de jugadores de una reta.

    Prioridad:
      1. `reta.jugadores_orden_manual` si existe Y todos los nombres están
         entre los inscritos aprobados (asegura consistencia tras
         reasignación manual del organizador, p.ej. drag & drop de canchas).
      2. Orden cronológico de inscripción (creado_en ASC) — comportamiento legado.

    Siempre rellena con placeholders `Jugador N` hasta `max_jugadores`.
    """
    reta_id = reta["id"]
    canchas = reta["canchas_disponibles"]
    required = int(reta.get("max_jugadores") or canchas * 8)

    cursor = db.inscripciones.find(
        {"reta_id": reta_id, "estatus_pago": "Aprobado"}, {"_id": 0},
    ).sort("creado_en", 1).limit(required)
    aprobados = [d["nombre"] async for d in cursor]

    orden_manual = reta.get("jugadores_orden_manual")
    if orden_manual and isinstance(orden_manual, list):
        # Validación estricta: el orden manual debe contener exactamente
        # los mismos nombres aprobados (mismo set). Si difiere → fallback.
        if set(orden_manual) == set(aprobados) and len(orden_manual) == len(aprobados):
            jugadores = list(orden_manual)
        else:
            jugadores = list(aprobados)
    else:
        jugadores = list(aprobados)

    while len(jugadores) < required:
        jugadores.append(f"Jugador {len(jugadores)+1}")
    return jugadores[:required]


@router.get("/retas/{reta_id}/rol")
async def get_rol(reta_id: str, current=Depends(get_current_admin)):
    """Genera el rol Round Robin del torneo con los jugadores inscritos Aprobados.
    Rellena con placeholders si faltan jugadores."""
    reta = await db.retas.find_one({"id": reta_id}, {"_id": 0})
    if not reta:
        raise HTTPException(404, "Reta no encontrada")

    canchas = reta["canchas_disponibles"]
    num_rondas = reta.get("num_rondas", 7)
    jugadores = await _resolver_jugadores_de_reta(reta)

    rol = generar_rol_multi_cancha(jugadores, canchas, num_rondas)
    return {
        "reta_id": reta_id,
        "canchas": canchas,
        "num_rondas": num_rondas,
        "jugadores": jugadores,
        "rol": rol,
    }


# ---------- PREVIEW del rol sin persistir (drag & drop UX) ----------
@router.post("/retas/{reta_id}/rol/preview")
async def preview_rol(
    reta_id: str,
    body: dict,
    current=Depends(get_current_admin),
):
    """Calcula el rol Round Robin para un orden tentativo de jugadores
    SIN persistirlo. Usado por la pantalla de drag & drop para mostrar
    al organizador cómo quedará la distribución de partidos antes de
    guardar el reorden.

    Body: { "jugadores": ["Nombre A", "Nombre B", ...] }
      • Si la lista coincide 1:1 con los aprobados se usa tal cual.
      • Si la lista es más corta se rellena con placeholders.
      • Si la lista contiene duplicados → 422.
    """
    reta = await db.retas.find_one({"id": reta_id}, {"_id": 0})
    if not reta:
        raise HTTPException(404, "Reta no encontrada")

    canchas = reta["canchas_disponibles"]
    num_rondas = reta.get("num_rondas", 7)
    required = int(reta.get("max_jugadores") or canchas * 8)

    nuevos = body.get("jugadores")
    if not isinstance(nuevos, list) or not all(isinstance(n, str) for n in nuevos):
        raise HTTPException(422, "El campo 'jugadores' debe ser una lista de strings")
    if len(set(nuevos)) != len(nuevos):
        raise HTTPException(422, "La lista contiene nombres duplicados")

    jugadores = list(nuevos)
    # Relleno con placeholders si faltan plazas (mismo patrón que get_rol)
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
        "is_preview": True,
    }


# ---------- Reasignar jugadores entre canchas (Drag & Drop) ----------
@router.put("/retas/{reta_id}/jugadores/orden")
async def actualizar_orden_jugadores(
    reta_id: str,
    body: dict,
    current=Depends(get_current_admin),
):
    """Persiste el orden manual de jugadores (drag & drop entre canchas).

    Reglas de seguridad:
      • Solo admin.
      • Si ya existen resultados capturados → 409 Conflict (no se puede
        reorganizar canchas con partidos en curso porque romperíamos la
        trazabilidad histórica).
      • La lista debe contener exactamente los mismos nombres que los
        inscritos aprobados (1:1, sin duplicados ni faltantes).

    Body: { "jugadores": ["Nombre A", "Nombre B", ...] }
    """
    reta = await db.retas.find_one({"id": reta_id}, {"_id": 0})
    if not reta:
        raise HTTPException(404, "Reta no encontrada")

    nuevos = body.get("jugadores")
    if not isinstance(nuevos, list) or not all(isinstance(n, str) for n in nuevos):
        raise HTTPException(422, "El campo 'jugadores' debe ser una lista de strings")

    # Validar que no hay duplicados
    if len(set(nuevos)) != len(nuevos):
        raise HTTPException(422, "La lista contiene nombres duplicados")

    # Validar que no hay resultados capturados aún (safety)
    tiene_resultados = await db.resultados.count_documents({"reta_id": reta_id})
    if tiene_resultados > 0:
        raise HTTPException(
            409,
            "No se puede reorganizar las canchas: ya hay resultados capturados. "
            "Elimina los resultados antes de cambiar la distribución.",
        )

    # Validar que los nombres coinciden con los inscritos aprobados
    cursor = db.inscripciones.find(
        {"reta_id": reta_id, "estatus_pago": "Aprobado"}, {"_id": 0, "nombre": 1},
    )
    aprobados = {d["nombre"] async for d in cursor}
    if set(nuevos) != aprobados:
        raise HTTPException(
            422,
            "La lista de jugadores no coincide con los inscritos aprobados.",
        )

    await db.retas.update_one(
        {"id": reta_id},
        {"$set": {"jugadores_orden_manual": list(nuevos)}},
    )
    return {"ok": True, "jugadores": list(nuevos)}



# ---------- Upsert / Delete (admin) ----------
@router.post("/retas/{reta_id}/resultados", response_model=PartidoResultado)
async def registrar_resultado(
    reta_id: str,
    body: PartidoResultadoCreate,
    current=Depends(get_current_admin),
):
    """Registra o actualiza el score de un partido. Idempotente por
    (reta_id, cancha, ronda, partido_idx). Solo admin."""
    reta = await db.retas.find_one({"id": reta_id}, {"_id": 0})
    if not reta:
        raise HTTPException(404, "Reta no encontrada")

    if body.cancha < 1 or body.cancha > reta["canchas_disponibles"]:
        raise HTTPException(400, "Cancha fuera de rango")
    if body.ronda < 1 or body.ronda > reta.get("num_rondas", 7):
        raise HTTPException(400, "Ronda fuera de rango")

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
            "partido_jugado": True,
        }
        await db.resultados.update_one({"id": existing["id"]}, {"$set": update})
        existing.pop("_id", None)
        existing.update(update)
        await _broadcast_standings(
            reta_id,
            event="match_updated",
            match_id=existing["id"],
            ronda=body.ronda,
            cancha=body.cancha,
        )
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
        partido_jugado=True,
    )
    doc = res.model_dump()
    doc["creado_en"] = doc["creado_en"].isoformat()
    await db.resultados.insert_one(doc)
    await _broadcast_standings(
        reta_id,
        event="match_saved",
        match_id=res.id,
        ronda=body.ronda,
        cancha=body.cancha,
    )
    return res


@router.delete("/retas/{reta_id}/resultados/{result_id}")
async def borrar_resultado(
    reta_id: str,
    result_id: str,
    current=Depends(get_current_admin),
):
    """Borra un resultado por error tipográfico. Tras eliminar, recalcula y
    notifica a los suscriptores WS."""
    r = await db.resultados.find_one({"id": result_id, "reta_id": reta_id})
    if not r:
        raise HTTPException(404, "Resultado no encontrado")
    await db.resultados.delete_one({"id": result_id, "reta_id": reta_id})
    await _broadcast_standings(reta_id, event="match_deleted", match_id=result_id)
    return {"ok": True, "deleted": result_id}


@router.get("/retas/{reta_id}/resultados", response_model=List[PartidoResultado])
async def listar_resultados_admin(reta_id: str, current=Depends(get_current_admin)):
    cursor = db.resultados.find({"reta_id": reta_id}, {"_id": 0}).sort(
        [("cancha", 1), ("ronda", 1), ("partido_idx", 1)]
    ).limit(500)
    return [PartidoResultado(**d) async for d in cursor]


# ---------- Tabla pública (compat) y clasificación con auth ----------
async def _build_standings(reta_id: str) -> List[TablaPosicionEntry]:
    cursor = db.resultados.find({"reta_id": reta_id}, {"_id": 0}).limit(2000)
    docs = [d async for d in cursor]
    return compute_individual_standings(docs, ordenar=True)


@router.get("/public/retas/{reta_id}/tabla", response_model=List[TablaPosicionEntry])
async def tabla_posiciones(reta_id: str):
    """Tabla pública (retrocompat con la versión original). No requiere auth.

    Nota: La privacidad estricta vive en `/retas/{id}/clasificacion`. Este
    endpoint se mantiene por retrocompat con QR antiguos / clientes externos.
    """
    reta = await db.retas.find_one({"id": reta_id}, {"_id": 0})
    if not reta:
        raise HTTPException(404, "Reta no encontrada")
    return await _build_standings(reta_id)


@router.get("/retas/{reta_id}/clasificacion", response_model=List[TablaPosicionEntry])
async def clasificacion_individual(
    reta_id: str,
    authorization: Optional[str] = Header(default=None),
):
    """Clasificación individual con privacidad estricta.

    Visible solo para:
        - Admin (cualquier admin con token bearer).
        - Player con inscripción 'Aprobado' en esta reta.

    Cualquier otro → 403.
    """
    reta = await db.retas.find_one({"id": reta_id}, {"_id": 0})
    if not reta:
        raise HTTPException(404, "Reta no encontrada")
    await _ensure_player_can_view(reta_id, authorization)
    return await _build_standings(reta_id)
