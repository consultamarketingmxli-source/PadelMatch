"""
Helpers de concurrencia atómica para PadelappRetas OS.

Resuelve las race conditions de:
  - Reserva del último lugar de una reta (dos clics simultáneos al mismo cupo).
  - Asignación atómica de posición en lista de espera.

Patrón MongoDB: usamos `find_one_and_update` con condición `$expr` (equivalente
a `SELECT ... FOR UPDATE` en PostgreSQL). El motor garantiza atomicidad a nivel
de documento, por lo que dos requests concurrentes nunca incrementan dos veces
más allá del límite.

Campos en `retas`:
  - `inscritos_lock` : contador atómico de cupos efectivamente tomados (Pendientes + Aprobados).
  - `waitlist_seq`   : siguiente posición en lista de espera (autoincremental).

Ambos se autoinicializan si faltan.
"""
from __future__ import annotations

import logging
from typing import Optional

from pymongo import ReturnDocument

from core.db import db

logger = logging.getLogger("padelappretas-os")


async def _ensure_counters(reta_id: str) -> dict:
    """Garantiza que la reta tenga `inscritos_lock` y `waitlist_seq` inicializados
    a partir del estado real. Se llama una sola vez al primer uso del contador
    (idempotente, no destructivo).
    """
    reta = await db.retas.find_one({"id": reta_id})
    if not reta:
        return {}
    needs_init = "inscritos_lock" not in reta or "waitlist_seq" not in reta
    if not needs_init:
        return reta

    inscritos = await db.inscripciones.count_documents({
        "reta_id": reta_id,
        "estatus_pago": {"$in": ["Aprobado", "Pendiente"]},
    })
    wl_max = 0
    last = await db.lista_espera.find_one(
        {"reta_id": reta_id}, sort=[("posicion_fila", -1)],
    )
    if last:
        wl_max = int(last.get("posicion_fila", 0))

    update = {}
    if "inscritos_lock" not in reta:
        update["inscritos_lock"] = inscritos
    if "waitlist_seq" not in reta:
        update["waitlist_seq"] = wl_max
    if update:
        await db.retas.update_one(
            {"id": reta_id, **{k: {"$exists": False} for k in update}},
            {"$set": update},
        )
        reta = await db.retas.find_one({"id": reta_id}) or reta
    return reta


async def reservar_lugar_atomico(reta_id: str) -> Optional[dict]:
    """Intenta reservar un cupo en una reta de forma atómica.

    Returns:
      - dict (reta actualizada) si la reserva fue exitosa.
      - None si la reta está llena (rebote a lista de espera).
    """
    await _ensure_counters(reta_id)
    reta = await db.retas.find_one_and_update(
        {
            "id": reta_id,
            "$expr": {"$lt": ["$inscritos_lock", "$max_jugadores"]},
        },
        {"$inc": {"inscritos_lock": 1}},
        return_document=ReturnDocument.AFTER,
    )
    return reta


async def liberar_lugar(reta_id: str, n: int = 1) -> None:
    """Devuelve un cupo a la reta. Idempotente: nunca baja de 0.

    Llamar tras:
      - Pago fallido / cancelado (liberar lock del Pendiente).
      - Expiración por timeout (5 min sin pagar).
      - Insert fallido tras reserva (rollback).
    """
    if n <= 0:
        return
    # Decrementamos solo si inscritos_lock > 0 (clamp).
    res = await db.retas.update_one(
        {"id": reta_id, "inscritos_lock": {"$gt": 0}},
        {"$inc": {"inscritos_lock": -1}},
    )
    if res.modified_count == 0 and n > 0:
        # No quedó nada que liberar, normal.
        return
    if n > 1:
        await liberar_lugar(reta_id, n - 1)


async def siguiente_posicion_waitlist_atomica(reta_id: str) -> int:
    """Reserva la siguiente posición de waitlist de forma atómica.
    Nunca devuelve duplicados, incluso con N concurrentes.
    """
    await _ensure_counters(reta_id)
    reta = await db.retas.find_one_and_update(
        {"id": reta_id},
        {"$inc": {"waitlist_seq": 1}},
        return_document=ReturnDocument.AFTER,
    )
    if not reta:
        raise RuntimeError(f"Reta {reta_id} no existe.")
    return int(reta["waitlist_seq"])
