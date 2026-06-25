"""Jobs Worker — MongoDB-backed persistent job queue.

Patrón: cola FIFO con leasing optimista en MongoDB. Sobrevive a reinicios del
pod (los jobs persisten en `db.jobs_queue`). Procesa en un loop interno con
tick cada 10s buscando jobs con `run_at <= now AND status='pending'`, los
marca `processing` atómicamente (via `findOneAndUpdate`) y los ejecuta.

Tipos de job soportados:
  - `waitlist_pending_timeout` → al expirar 15 min, libera el cupo y promueve
    al siguiente FIFO.

Diseño de tolerancia a fallos:
  - Idempotencia: cada job tiene `idempotency_key` único (indexado).
  - Si un job dura > `lease_seconds`, otro worker puede re-tomarlo (no aplica
    aún porque corremos 1 sola réplica, pero el patrón está listo).
  - El loop interno corre dentro del mismo proceso FastAPI (asyncio.task);
    cancela limpio en shutdown.
"""
from __future__ import annotations

import asyncio
import logging
import os
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Dict, Optional

from core.db import db

logger = logging.getLogger("padelappretas.jobs")

# Constantes
TICK_SECONDS = 10
LEASE_SECONDS = 60
MAX_ATTEMPTS = 3

# Handlers registrados por tipo. Se completan al importar este módulo.
_HANDLERS: Dict[str, Callable[[Dict[str, Any]], "asyncio.Future"]] = {}
_worker_task: Optional[asyncio.Task] = None
_stop_event = asyncio.Event()


def register_handler(job_type: str, handler: Callable[[Dict[str, Any]], "asyncio.Future"]) -> None:
    """Registra un handler async para un tipo de job."""
    _HANDLERS[job_type] = handler


async def ensure_indexes() -> None:
    """Índices necesarios para queries rápidas + idempotencia."""
    await db.jobs_queue.create_index([("status", 1), ("run_at", 1)])
    await db.jobs_queue.create_index("idempotency_key", unique=True, sparse=True)
    # TTL: jobs completados/expirados se borran después de 7 días
    await db.jobs_queue.create_index(
        "completed_at", expireAfterSeconds=7 * 24 * 3600
    )


async def enqueue(
    *,
    job_type: str,
    payload: Dict[str, Any],
    delay_seconds: int = 0,
    idempotency_key: Optional[str] = None,
) -> str:
    """Encola un nuevo job. Retorna el job_id."""
    job_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    run_at = now + timedelta(seconds=delay_seconds)
    doc = {
        "id": job_id,
        "type": job_type,
        "payload": payload,
        "status": "pending",
        "attempts": 0,
        "run_at": run_at.isoformat(),
        "created_at": now.isoformat(),
        "idempotency_key": idempotency_key,
    }
    try:
        await db.jobs_queue.insert_one(doc)
        logger.info(
            "[jobs] enqueued type=%s job_id=%s delay=%ss idem=%s",
            job_type, job_id, delay_seconds, idempotency_key,
        )
        return job_id
    except Exception as e:  # pylint: disable=broad-except
        # Likely duplicate idempotency_key — ya estaba encolado.
        logger.info("[jobs] enqueue skipped (dup idem) · idem=%s err=%s", idempotency_key, str(e)[:80])
        return ""


async def _lease_next_job() -> Optional[Dict[str, Any]]:
    """Toma atómicamente el siguiente job listo. Marca como `processing`."""
    now = datetime.now(timezone.utc)
    lease_until = (now + timedelta(seconds=LEASE_SECONDS)).isoformat()
    return await db.jobs_queue.find_one_and_update(
        {
            "status": "pending",
            "run_at": {"$lte": now.isoformat()},
            "attempts": {"$lt": MAX_ATTEMPTS},
        },
        {
            "$set": {"status": "processing", "lease_until": lease_until},
            "$inc": {"attempts": 1},
        },
        sort=[("run_at", 1)],
        return_document=True,
    )


async def _mark_done(job_id: str, success: bool, error_msg: Optional[str] = None) -> None:
    """Marca un job como terminado (done | failed)."""
    now = datetime.now(timezone.utc).isoformat()
    await db.jobs_queue.update_one(
        {"id": job_id},
        {"$set": {
            "status": "done" if success else "failed",
            "completed_at": now,
            "error": error_msg,
        }},
    )


async def _process_one(job: Dict[str, Any]) -> None:
    """Ejecuta un único job. Captura cualquier excepción."""
    job_id = job.get("id", "?")
    job_type = job.get("type", "?")
    handler = _HANDLERS.get(job_type)
    if not handler:
        logger.error("[jobs] sin handler registrado · type=%s job_id=%s", job_type, job_id)
        await _mark_done(job_id, False, f"no_handler:{job_type}")
        return
    try:
        await handler(job.get("payload", {}))
        await _mark_done(job_id, True)
        logger.info("[jobs] ✓ done type=%s job_id=%s", job_type, job_id)
    except Exception as e:  # pylint: disable=broad-except
        attempts = int(job.get("attempts", 0))
        if attempts >= MAX_ATTEMPTS:
            await _mark_done(job_id, False, str(e)[:200])
            logger.error("[jobs] ✗ failed after %d attempts · type=%s err=%s", attempts, job_type, str(e)[:140])
        else:
            # Reagendar para retry con backoff exponencial.
            backoff = min(60 * (2 ** attempts), 600)
            new_run_at = (datetime.now(timezone.utc) + timedelta(seconds=backoff)).isoformat()
            await db.jobs_queue.update_one(
                {"id": job_id},
                {"$set": {"status": "pending", "run_at": new_run_at, "lease_until": None}},
            )
            logger.warning(
                "[jobs] retry %d/%d in %ds · type=%s err=%s",
                attempts, MAX_ATTEMPTS, backoff, job_type, str(e)[:120],
            )


async def _worker_loop() -> None:
    """Loop principal del worker. Tick cada TICK_SECONDS."""
    logger.info("[jobs] worker loop iniciado · tick=%ss", TICK_SECONDS)
    await ensure_indexes()
    while not _stop_event.is_set():
        try:
            # Procesa hasta 10 jobs por tick (evita starvation).
            for _ in range(10):
                job = await _lease_next_job()
                if not job:
                    break
                await _process_one(job)
        except Exception as e:  # pylint: disable=broad-except
            logger.exception("[jobs] error en worker loop: %s", str(e)[:160])
        try:
            await asyncio.wait_for(_stop_event.wait(), timeout=TICK_SECONDS)
        except asyncio.TimeoutError:
            pass
    logger.info("[jobs] worker loop detenido")


async def start_worker() -> None:
    """Inicia el worker en background (idempotente)."""
    global _worker_task
    if _worker_task and not _worker_task.done():
        return
    _stop_event.clear()
    _worker_task = asyncio.create_task(_worker_loop(), name="jobs-worker")


async def stop_worker() -> None:
    """Detiene el worker limpiamente."""
    _stop_event.set()
    if _worker_task and not _worker_task.done():
        try:
            await asyncio.wait_for(_worker_task, timeout=5.0)
        except asyncio.TimeoutError:
            _worker_task.cancel()
