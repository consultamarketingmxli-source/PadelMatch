"""Helpers compartidos: cálculo de capacidad, promoción de lista de espera,
limpieza de inscripciones expiradas, cronjobs y utilities Mongo.

Mantiene la lógica reusable entre routers para evitar import cíclicos.
"""
import asyncio
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import HTTPException

from core.db import db
from core.circuit import safe_run
from core.concurrency import (
    liberar_lugar,
    reservar_lugar_atomico,
)
from models import Inscripcion, Usuario
from notifications import (
    construir_mensaje_recordatorio,
    construir_mensaje_waitlist_promovido,
    send_whatsapp,
)

logger = logging.getLogger("padelappretas-os")


def strip_mongo(doc: dict) -> dict:
    if not doc:
        return doc
    doc.pop("_id", None)
    return doc


async def compute_public(r: dict) -> dict:
    """Adjunta inscritos_count, waitlist_count, capacidad_pct y semáforo a una reta.

    También ejecuta limpieza pasiva: cualquier inscripción Pendiente con
    `bloqueado_hasta` vencido se marca como Expirada y libera el cupo atómico.
    Esto garantiza que el cliente nunca vea cupos fantasma si el cronjob se atrasa.
    """
    # Limpieza pasiva primero (libera cupos vencidos).
    await expirar_pendientes_vencidas(r["id"])

    now_iso = datetime.now(timezone.utc).isoformat()
    pendientes_activos = await db.inscripciones.count_documents({
        "reta_id": r["id"],
        "estatus_pago": "Pendiente",
        "bloqueado_hasta": {"$gt": now_iso},
    })
    aprobados = await db.inscripciones.count_documents({
        "reta_id": r["id"],
        "estatus_pago": "Aprobado",
    })
    ocupados = aprobados + pendientes_activos
    # Solo contar jugadores aún en espera (no los ya promovidos)
    wl = await db.lista_espera.count_documents({"reta_id": r["id"], "notificado": False})

    capacidad_pct = (ocupados / r["max_jugadores"]) * 100 if r["max_jugadores"] else 0
    if ocupados >= r["max_jugadores"]:
        semaforo = "ROJO"
    elif capacidad_pct >= 50:
        semaforo = "AMARILLO"
    else:
        semaforo = "VERDE"

    r["inscritos_count"] = ocupados
    r["waitlist_count"] = wl
    r["capacidad_pct"] = round(capacidad_pct, 1)
    r["semaforo"] = semaforo
    return r


async def upsert_jugador(nombre: str, telefono: str) -> str:
    """Crea o reusa Usuario. Retorna jugador_id."""
    jugador = await db.usuarios.find_one({"telefono": telefono})
    if jugador:
        return jugador["id"]
    nuevo = Usuario(nombre=nombre, telefono=telefono)
    doc = nuevo.model_dump()
    doc["creado_en"] = doc["creado_en"].isoformat()
    await db.usuarios.insert_one(doc)
    return nuevo.id


async def expirar_pendientes_vencidas(reta_id: str) -> int:
    """Marca como Expiradas las Pendientes con `bloqueado_hasta` vencido (de una reta).
    Devuelve cuántas se expiraron. Libera los cupos en `inscritos_lock` de forma atómica.
    """
    now_iso = datetime.now(timezone.utc).isoformat()
    # Primero contamos las que se van a expirar para liberar cupos.
    a_expirar = await db.inscripciones.count_documents({
        "reta_id": reta_id, "estatus_pago": "Pendiente",
        "bloqueado_hasta": {"$lt": now_iso},
    })
    if a_expirar == 0:
        return 0
    await db.inscripciones.update_many(
        {"reta_id": reta_id, "estatus_pago": "Pendiente",
         "bloqueado_hasta": {"$lt": now_iso}},
        {"$set": {"estatus_pago": "Expirado"}},
    )
    # Liberamos cupos en el contador atómico.
    for _ in range(a_expirar):
        await liberar_lugar(reta_id, 1)
    return a_expirar


async def crear_inscripcion_pendiente(
    reta: dict, nombre: str, telefono: str, minutos_bloqueo: int = 5,
) -> Inscripcion:
    """Crea una inscripción Pendiente con bloqueo y reserva ATÓMICA de cupo.

    Garantías:
    - Dos usuarios concurrentes para el último cupo: solo uno gana, el otro recibe 409.
    - Si el insert de la inscripción falla, se libera el cupo automáticamente.
    - Antes de intentar reservar, se expiran las pendientes vencidas (limpieza pasiva).
    """
    reta_id = reta["id"]
    # 1) Limpieza pasiva: libera cupos que ya vencieron.
    await expirar_pendientes_vencidas(reta_id)

    # 2) Reserva atómica del cupo.
    reta_actual = await reservar_lugar_atomico(reta_id)
    if reta_actual is None:
        raise HTTPException(409, "Reta llena. Únete a la lista de espera.")

    # 3) Crear inscripción. Si falla, hacemos rollback del contador.
    try:
        jugador_id = await upsert_jugador(nombre, telefono)
        bloqueado_hasta = (
            datetime.now(timezone.utc) + timedelta(minutes=minutos_bloqueo)
        ).isoformat()
        insc = Inscripcion(
            reta_id=reta_id, jugador_id=jugador_id, nombre=nombre, telefono=telefono,
            estatus_pago="Pendiente", bloqueado_hasta=bloqueado_hasta,
        )
        doc = insc.model_dump()
        doc["creado_en"] = doc["creado_en"].isoformat()
        await db.inscripciones.insert_one(doc)
        return insc
    except Exception:
        # Rollback del cupo reservado.
        await liberar_lugar(reta_id, 1)
        raise


async def promover_lista_espera(reta_id: str) -> Optional[Inscripcion]:
    """Promueve a la siguiente persona de la lista de espera.

    Resiliencia: si Twilio falla notificando al jugador, NO bloqueamos el flujo.
    Se registra en logs y se salta al siguiente (con un máximo de 5 intentos
    para evitar promover toda la fila si todos los teléfonos están caídos).
    """
    max_intentos = 5
    for _ in range(max_intentos):
        next_in_line = await db.lista_espera.find_one(
            {"reta_id": reta_id, "notificado": False},
            sort=[("posicion_fila", 1)],
        )
        if not next_in_line:
            return None

        # Reserva atómica del cupo recién liberado.
        reta_actual = await reservar_lugar_atomico(reta_id)
        if reta_actual is None:
            # Otra inscripción tomó el cupo simultáneamente, nada que promover.
            return None

        bloqueado_hasta = (
            datetime.now(timezone.utc) + timedelta(minutes=5)
        ).isoformat()
        insc = Inscripcion(
            reta_id=reta_id,
            jugador_id=next_in_line["jugador_id"],
            nombre=next_in_line["nombre"],
            telefono=next_in_line["telefono"],
            estatus_pago="Pendiente",
            bloqueado_hasta=bloqueado_hasta,
        )
        doc = insc.model_dump()
        doc["creado_en"] = doc["creado_en"].isoformat()
        try:
            await db.inscripciones.insert_one(doc)
        except Exception:
            await liberar_lugar(reta_id, 1)
            raise

        await db.lista_espera.update_one(
            {"id": next_in_line["id"]},
            {"$set": {"notificado": True}},
        )

        reta = await db.retas.find_one({"id": reta_id}, {"_id": 0})
        link = f"/retas/{reta['url_slug']}?inscripcion={insc.id}"
        msg = construir_mensaje_waitlist_promovido(insc.nombre, reta["nombre"], link)

        # Circuit breaker: si Twilio falla 2 intentos, lo dejamos pasar.
        # El cronjob de expiración eventualmente recuperará el cupo y promoverá al siguiente.
        ok, _ = await safe_run(
            lambda: send_whatsapp(insc.telefono, msg),
            label=f"whatsapp:promover:{insc.telefono}",
            timeout_s=8.0,
            retries=1,
        )
        if not ok:
            logger.warning(
                "Twilio descartado para %s tras reintentos. La inscripción Pendiente "
                "sigue válida 5 min; si no confirma, el cronjob promoverá al siguiente.",
                insc.telefono,
            )
        return insc

    return None


async def expirar_bloqueos_pass(force_reta_id: Optional[str] = None) -> dict:
    """Una pasada de expiración. Si force_reta_id se da, expira TODAS las pendientes
    de esa reta. Libera cupos en el contador atómico antes de borrar, y promueve waitlist."""
    now_iso = datetime.now(timezone.utc).isoformat()
    query: dict = {"estatus_pago": "Pendiente"}
    if force_reta_id:
        query["reta_id"] = force_reta_id
    else:
        query["bloqueado_hasta"] = {"$lt": now_iso}

    expiradas = db.inscripciones.find(query).limit(500)
    retas_afectadas: dict[str, int] = {}
    async for ins in expiradas:
        await db.inscripciones.delete_one({"id": ins["id"]})
        retas_afectadas[ins["reta_id"]] = retas_afectadas.get(ins["reta_id"], 0) + 1

    # Liberar cupos atómicos por reta afectada.
    for rid, n in retas_afectadas.items():
        for _ in range(n):
            await liberar_lugar(rid, 1)

    promovidos = 0
    for reta_id in retas_afectadas:
        try:
            nuevo = await promover_lista_espera(reta_id)
            if nuevo is not None:
                promovidos += 1
        except Exception as e:  # noqa: BLE001
            # No queremos que un fallo en promover bloquee todo el cron.
            logger.exception("Error promoviendo waitlist en reta %s: %s", reta_id, e)
    return {
        "eliminadas": sum(retas_afectadas.values()),
        "promovidos": promovidos,
        "retas_afectadas": list(retas_afectadas.keys()),
    }


# ============== Cronjobs ==============
async def cronjob_recordatorios():
    """Cada 15 min: busca retas que arranquen en ~2h y manda WhatsApp."""
    while True:
        try:
            ahora = datetime.now(timezone.utc)
            ventana_ini = (ahora + timedelta(hours=2, minutes=-7)).isoformat()
            ventana_fin = (ahora + timedelta(hours=2, minutes=8)).isoformat()
            cursor = db.retas.find({
                "alertas_enviadas": False,
                "fecha_evento": {"$gte": ventana_ini, "$lte": ventana_fin},
            }).limit(200)
            async for r in cursor:
                inscripciones = db.inscripciones.find({
                    "reta_id": r["id"], "estatus_pago": "Aprobado",
                }).limit(500)
                async for ins in inscripciones:
                    msg = construir_mensaje_recordatorio(
                        ins["nombre"], r["nombre"], r["club"], r["fecha_evento"],
                        r.get("observaciones_publicas", ""),
                    )
                    await send_whatsapp(ins["telefono"], msg)
                await db.retas.update_one(
                    {"id": r["id"]}, {"$set": {"alertas_enviadas": True}},
                )
        except Exception as e:
            logger.exception("Error en cronjob recordatorios: %s", e)
        await asyncio.sleep(60 * 15)


async def cronjob_expirar_bloqueos():
    """Cada 30s: expira inscripciones con bloqueo vencido y promueve waitlist."""
    while True:
        try:
            await expirar_bloqueos_pass()
        except Exception as e:
            logger.exception("Error cronjob bloqueos: %s", e)
        await asyncio.sleep(30)
