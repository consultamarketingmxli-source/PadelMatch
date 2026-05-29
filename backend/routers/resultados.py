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
from core.fixture_engine import generar_fixture, generar_fixture_parejas
from core.realtime import manager
from core.standings import compute_duo_standings, compute_individual_standings
from logica_torneo import generar_rol_multi_cancha, generar_rol_multi_cancha_parejas
from models import PartidoResultado, PartidoResultadoCreate, TablaPosicionEntry

router = APIRouter(tags=["resultados"])


def _es_reta_de_parejas(reta: dict) -> bool:
    return reta.get("modalidad_registro", "individual") != "individual"


async def _resolver_duos_de_reta(reta: dict) -> List[List[str]]:
    """Devuelve lista de dúos (lista de [nombreA, nombreB]) de una reta de parejas.

    Agrupa inscripciones aprobadas por `pareja_grupo_id`. Las inscripciones
    sin pareja (es_free_agent=True sin emparejar, o jugadores legacy sin
    pareja_grupo_id) se omiten — el organizador debe emparejarlas en Fase 4
    desde la bolsa de free-agents para que aparezcan en el rol.

    El orden de los dúos respeta `creado_en` ASC del PRIMER miembro de cada
    pareja, salvo que exista `reta.duos_orden_manual` consistente (futuro).
    """
    reta_id = reta["id"]
    cursor = db.inscripciones.find(
        {"reta_id": reta_id, "estatus_pago": "Aprobado"},
        {"_id": 0, "id": 1, "nombre": 1, "pareja_grupo_id": 1, "creado_en": 1, "es_free_agent": 1},
    ).sort("creado_en", 1).limit(500)

    grupos: dict[str, list[dict]] = {}
    async for ins in cursor:
        gid = ins.get("pareja_grupo_id")
        if not gid:
            # Sin pareja_grupo_id → no participa en el rol de parejas todavía.
            continue
        grupos.setdefault(gid, []).append(ins)

    # Solo aceptamos dúos COMPLETOS (exactamente 2 inscritos aprobados).
    duos: List[List[str]] = []
    for gid, miembros in grupos.items():
        if len(miembros) == 2:
            duos.append([miembros[0]["nombre"], miembros[1]["nombre"]])
    return duos


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
    """Genera el rol Round Robin del torneo.

    • Reta INDIVIDUAL → Round Robin tradicional 8 jugadores/cancha.
    • Reta de PAREJAS → Round Robin de dúos fijos (4 dúos = 8 jugadores/cancha).
      Solo se incluyen dúos COMPLETOS (con `pareja_grupo_id` y 2 inscritos
      aprobados). Free-agents sin emparejar se quedan fuera hasta que el
      organizador los empareje (Fase 4).
    """
    reta = await db.retas.find_one({"id": reta_id}, {"_id": 0})
    if not reta:
        raise HTTPException(404, "Reta no encontrada")

    canchas = reta["canchas_disponibles"]
    num_rondas = reta.get("num_rondas", 7)

    if _es_reta_de_parejas(reta):
        duos = await _resolver_duos_de_reta(reta)
        # Si no hay aún suficientes dúos completos, devolvemos rol vacío con
        # info útil para que el organizador sepa qué falta. No fallamos.
        if len(duos) < 2:
            return {
                "reta_id": reta_id,
                "canchas": canchas,
                "num_rondas": num_rondas,
                "jugadores": [p for d in duos for p in d],
                "duos": duos,
                "rol": [],
                "es_parejas": True,
                "mensaje": (
                    "Aún no hay suficientes dúos completos para generar el rol. "
                    "Empareja a los free-agents desde el panel de administración."
                ),
            }
        # Rellenamos con dúos placeholder si faltan (mantener simetría visual).
        max_jug = int(reta.get("max_jugadores") or canchas * 8)
        max_duos = max_jug // 2
        # Aseguramos un # par (mínimo 2 dúos) para que el generador no falle.
        while len(duos) < max_duos and len(duos) % 2 != 0:
            duos.append([f"Pareja {len(duos)+1}A", f"Pareja {len(duos)+1}B"])
        # Si aún quedan plazas, rellenamos de a 2 dúos hasta cubrir.
        while len(duos) + 2 <= max_duos:
            duos.append([f"Pareja {len(duos)+1}A", f"Pareja {len(duos)+1}B"])
        rol = generar_rol_multi_cancha_parejas(duos, canchas, num_rondas)
        # Fase D — añadimos metadata del motor (badge UI).
        try:
            res_motor = generar_fixture_parejas(duos, num_rondas)
            fixture_meta = res_motor["metadata"]
        except Exception:
            fixture_meta = {"algoritmo": "estatico", "optimizacion_aplicada": False, "motivo": ""}
        return {
            "reta_id": reta_id,
            "canchas": canchas,
            "num_rondas": num_rondas,
            "jugadores": [p for d in duos for p in d],
            "duos": duos,
            "rol": rol,
            "es_parejas": True,
            "fixture_metadata": fixture_meta,
        }

    # Flujo INDIVIDUAL clásico.
    jugadores = await _resolver_jugadores_de_reta(reta)
    rol = generar_rol_multi_cancha(jugadores, canchas, num_rondas)
    # Fase D — metadata del motor para badge UI.
    try:
        res_motor = generar_fixture(jugadores, num_rondas)
        fixture_meta = res_motor["metadata"]
    except Exception:
        fixture_meta = {"algoritmo": "estatico", "optimizacion_aplicada": False, "motivo": ""}
    return {
        "reta_id": reta_id,
        "canchas": canchas,
        "num_rondas": num_rondas,
        "jugadores": jugadores,
        "rol": rol,
        "es_parejas": False,
        "fixture_metadata": fixture_meta,
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


# ---------- Fase D — Recálculo en CALIENTE de rondas pendientes ----------
@router.post("/retas/{reta_id}/rol/recalcular-pendientes")
async def recalcular_rondas_pendientes(
    reta_id: str,
    body: dict | None = None,
    current=Depends(get_current_admin),
):
    """Recalcula las rondas FUTURAS de un torneo en curso preservando las
    rondas ya jugadas (con marcadores guardados).

    Casos de uso:
      • Un jugador se lesiona a mitad del torneo → admin lo excluye y los
        partidos pendientes se redistribuyen entre los demás manteniendo
        las Reglas A/B/C aplicables.
      • Un jugador no se presenta y queda registrado como "rechazado" →
        idem.

    Body opcional:
      {
        "excluir_jugadores": ["NombreA", "NombreB"]?  // exclusión adicional manual
      }

    Lock optimista: si dos admins llaman a este endpoint simultáneamente,
    el primero gana; el segundo recibe la nueva versión y debe recalcular.
    NO modifica los resultados ya guardados — éstos son inmutables (Fase C).

    Returns:
      {
        rol_actualizado: [{cancha, rondas: [{ronda, partidos, bloqueada: bool}]}],
        rondas_bloqueadas: [{cancha, ronda}],
        jugadores_activos: [str],
        jugadores_excluidos: [str],
        fixture_metadata: {...},
        rondas_pendientes_recalculadas: int
      }
    """
    reta = await db.retas.find_one({"id": reta_id}, {"_id": 0})
    if not reta:
        raise HTTPException(404, "Reta no encontrada")

    canchas = reta["canchas_disponibles"]
    num_rondas = reta.get("num_rondas", 7)
    body = body or {}
    excluir_extras = body.get("excluir_jugadores", []) or []
    if not isinstance(excluir_extras, list):
        raise HTTPException(422, "excluir_jugadores debe ser una lista")

    # 1. Resolver jugadores activos (los aprobados de la reta).
    if _es_reta_de_parejas(reta):
        # Para parejas, el "jugador" excluido se reinterpreta como dúo entero.
        duos_full = await _resolver_duos_de_reta(reta)
        # Eliminamos cualquier dúo donde uno de sus miembros esté excluido.
        duos = [d for d in duos_full if not any(p in excluir_extras for p in d)]
        excluidos = [p for d in duos_full for p in d if p in excluir_extras]
        # Necesitamos al menos 2 dúos para un fixture válido.
        if len(duos) < 2:
            raise HTTPException(
                409,
                f"Solo quedan {len(duos)} dúos activos tras la exclusión. "
                "Se requieren al menos 2 dúos completos.",
            )
        rol_nuevo_resp = generar_fixture_parejas(duos, num_rondas)
    else:
        jugadores_full = await _resolver_jugadores_de_reta(reta)
        jugadores = [j for j in jugadores_full if j not in excluir_extras]
        excluidos = [j for j in jugadores_full if j in excluir_extras]
        if len(jugadores) < 4:
            raise HTTPException(
                409,
                f"Solo quedan {len(jugadores)} jugadores activos tras la exclusión. "
                "Se requieren al menos 4 jugadores.",
            )
        rol_nuevo_resp = generar_fixture(jugadores, num_rondas)

    rol_nuevo = rol_nuevo_resp["rol"]
    fixture_meta = rol_nuevo_resp["metadata"]

    # 2. Obtener resultados ya guardados (rondas bloqueadas).
    resultados_cursor = db.resultados.find({"reta_id": reta_id}, {"_id": 0})
    rondas_bloqueadas: set[tuple[int, int]] = set()
    async for r in resultados_cursor:
        rondas_bloqueadas.add((int(r["cancha"]), int(r["ronda"])))

    # 3. Generar el rol VIEJO también (con la lista original) para preservar
    # exactamente los partidos en las rondas bloqueadas.
    if _es_reta_de_parejas(reta):
        rol_viejo = generar_rol_multi_cancha_parejas(duos_full, canchas, num_rondas)
    else:
        rol_viejo = generar_rol_multi_cancha(jugadores_full, canchas, num_rondas)

    # 4. Combinar: rondas bloqueadas vienen del rol VIEJO; las pendientes del NUEVO.
    rol_combinado: List[dict] = []
    rondas_recalculadas = 0
    for cancha_idx, cancha_nueva in enumerate(rol_nuevo):
        cancha_num = cancha_nueva.get("cancha", cancha_idx + 1)
        cancha_vieja = next(
            (c for c in rol_viejo if c.get("cancha") == cancha_num),
            {"cancha": cancha_num, "rondas": []},
        )
        rondas_out = []
        rondas_nuevas_dict = {r["ronda"]: r for r in cancha_nueva.get("rondas", [])}
        rondas_viejas_dict = {r["ronda"]: r for r in cancha_vieja.get("rondas", [])}
        all_rondas = sorted(set(rondas_nuevas_dict.keys()) | set(rondas_viejas_dict.keys()))
        for r_num in all_rondas:
            is_bloqueada = (cancha_num, r_num) in rondas_bloqueadas
            if is_bloqueada and r_num in rondas_viejas_dict:
                # Mantener el partido ORIGINAL para respetar los marcadores.
                ronda_data = dict(rondas_viejas_dict[r_num])
                ronda_data["bloqueada"] = True
            else:
                # Usar el partido nuevo (recalculado).
                ronda_data = dict(rondas_nuevas_dict.get(r_num, rondas_viejas_dict.get(r_num, {"ronda": r_num, "partidos": []})))
                ronda_data["bloqueada"] = False
                if not is_bloqueada:
                    rondas_recalculadas += 1
            rondas_out.append(ronda_data)
        rol_combinado.append({"cancha": cancha_num, "rondas": rondas_out})

    return {
        "reta_id": reta_id,
        "canchas": canchas,
        "num_rondas": num_rondas,
        "rol_actualizado": rol_combinado,
        "rondas_bloqueadas": [{"cancha": c, "ronda": r} for (c, r) in sorted(rondas_bloqueadas)],
        "jugadores_activos": [p for d in duos for p in d] if _es_reta_de_parejas(reta) else jugadores,
        "jugadores_excluidos": excluidos,
        "fixture_metadata": fixture_meta,
        "rondas_pendientes_recalculadas": rondas_recalculadas,
        "es_parejas": _es_reta_de_parejas(reta),
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
    """Construye standings. Si la reta es de parejas, agrupa por dúo fijo
    ("PlayerA & PlayerB"). Si es individual, agrupa por jugador.
    """
    reta = await db.retas.find_one({"id": reta_id}, {"_id": 0})
    cursor = db.resultados.find({"reta_id": reta_id}, {"_id": 0}).limit(2000)
    docs = [d async for d in cursor]
    if reta and _es_reta_de_parejas(reta):
        return compute_duo_standings(docs, ordenar=True)
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
