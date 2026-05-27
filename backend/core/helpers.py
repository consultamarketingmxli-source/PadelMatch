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
    """Adjunta inscritos_count, waitlist_count, capacidad_pct y semáforo a una reta."""
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


async def expirar_pendientes_vencidas(reta_id: str) -> None:
    """Marca como Expiradas las Pendientes con `bloqueado_hasta` vencido (de una reta)."""
    now_iso = datetime.now(timezone.utc).isoformat()
    await db.inscripciones.update_many(
        {"reta_id": reta_id, "estatus_pago": "Pendiente",
         "bloqueado_hasta": {"$lt": now_iso}},
        {"$set": {"estatus_pago": "Expirado"}},
    )


async def crear_inscripcion_pendiente(
    reta: dict, nombre: str, telefono: str, minutos_bloqueo: int = 5,
) -> Inscripcion:
    """Crea una inscripción Pendiente con bloqueo. Valida cupo. Lanza HTTPException 409 si lleno."""
    reta_id = reta["id"]
    await expirar_pendientes_vencidas(reta_id)

    ocupados = await db.inscripciones.count_documents({
        "reta_id": reta_id,
        "estatus_pago": {"$in": ["Aprobado", "Pendiente"]},
    })
    if ocupados >= reta["max_jugadores"]:
        raise HTTPException(409, "Reta llena. Únete a la lista de espera.")

    jugador_id = await upsert_jugador(nombre, telefono)
    bloqueado_hasta = (datetime.now(timezone.utc) + timedelta(minutes=minutos_bloqueo)).isoformat()
    insc = Inscripcion(
        reta_id=reta_id, jugador_id=jugador_id, nombre=nombre, telefono=telefono,
        estatus_pago="Pendiente", bloqueado_hasta=bloqueado_hasta,
    )
    doc = insc.model_dump()
    doc["creado_en"] = doc["creado_en"].isoformat()
    await db.inscripciones.insert_one(doc)
    return insc


async def promover_lista_espera(reta_id: str) -> Optional[Inscripcion]:
    """Toma al jugador en posición 1 no notificado, lo promueve a inscripción Pendiente
    con 5 min de bloqueo, y envía WhatsApp."""
    next_in_line = await db.lista_espera.find_one(
        {"reta_id": reta_id, "notificado": False},
        sort=[("posicion_fila", 1)],
    )
    if not next_in_line:
        return None

    bloqueado_hasta = (datetime.now(timezone.utc) + timedelta(minutes=5)).isoformat()
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
    await db.inscripciones.insert_one(doc)

    await db.lista_espera.update_one(
        {"id": next_in_line["id"]},
        {"$set": {"notificado": True}},
    )
    reta = await db.retas.find_one({"id": reta_id}, {"_id": 0})
    link = f"/retas/{reta['url_slug']}?inscripcion={insc.id}"
    msg = construir_mensaje_waitlist_promovido(insc.nombre, reta["nombre"], link)
    await send_whatsapp(insc.telefono, msg)
    return insc


async def expirar_bloqueos_pass(force_reta_id: Optional[str] = None) -> dict:
    """Una pasada de expiración. Si force_reta_id se da, expira TODAS las pendientes
    de esa reta. Retorna conteos."""
    now_iso = datetime.now(timezone.utc).isoformat()
    query: dict = {"estatus_pago": "Pendiente"}
    if force_reta_id:
        query["reta_id"] = force_reta_id
    else:
        query["bloqueado_hasta"] = {"$lt": now_iso}

    expiradas = db.inscripciones.find(query).limit(500)
    retas_afectadas: set[str] = set()
    eliminadas = 0
    async for ins in expiradas:
        await db.inscripciones.delete_one({"id": ins["id"]})
        retas_afectadas.add(ins["reta_id"])
        eliminadas += 1
    promovidos = 0
    for reta_id in retas_afectadas:
        nuevo = await promover_lista_espera(reta_id)
        if nuevo is not None:
            promovidos += 1
    return {
        "eliminadas": eliminadas,
        "promovidos": promovidos,
        "retas_afectadas": list(retas_afectadas),
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
