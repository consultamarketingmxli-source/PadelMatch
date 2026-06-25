"""ACID Transaction wrapper con fallback automático para MongoDB standalone.

MongoDB transactions REQUIEREN replica set o sharded cluster. En standalone
fallan con `Transaction numbers are only allowed on a replica set member or mongos`.

Esta capa abstrae esa diferencia:

    async with safe_transaction() as session:
        ...

  • Si el server soporta transacciones → la operación corre dentro de una
    sesión transaccional real con rollback automático en excepción.
  • Si NO las soporta → el bloque ejecuta sin transacción y `session` es None.
    Las operaciones individuales siguen siendo atómicas a nivel de documento
    (que es lo que MongoDB garantiza por defecto), pero NO hay rollback
    cross-document si algo falla a mitad del bloque.

USO RECOMENDADO:
  - Pasar `session=session` a TODAS las llamadas mongo dentro del bloque
    cuando session no sea None (los wrappers helpers más abajo lo gestionan).
  - Si la lógica MUST-HAVE rollback (ej: refund + flip-status), preferir el
    patrón "best-effort" con verificación post-commit en lugar de depender
    estrictamente de la transacción.
"""
from __future__ import annotations

import contextlib
import logging
from typing import Optional

from core.db import client as _mongo_client

logger = logging.getLogger("padelappretas-os")

# Cache de capability detection (evita ping a Mongo en cada llamada).
_supports_tx: Optional[bool] = None


async def _detect_transactions_support() -> bool:
    """Detecta si el server actual soporta transacciones (one-shot, cacheado)."""
    global _supports_tx
    if _supports_tx is not None:
        return _supports_tx
    try:
        info = await _mongo_client.admin.command("hello")
        # Replica set tiene `setName`; sharded tiene `msg=='isdbgrid'`.
        is_replica = bool(info.get("setName"))
        is_sharded = info.get("msg") == "isdbgrid"
        _supports_tx = is_replica or is_sharded
        logger.info(
            "[tx] capability detected · replica=%s sharded=%s → tx=%s",
            is_replica, is_sharded, _supports_tx,
        )
    except Exception as e:  # pylint: disable=broad-except
        logger.warning("[tx] detection failed (%s) — degradando a no-tx", str(e)[:80])
        _supports_tx = False
    return _supports_tx


@contextlib.asynccontextmanager
async def safe_transaction():
    """Context manager que envuelve un bloque en transacción si es posible.

    Yields:
        AsyncIOMotorClientSession | None  — pasa este `session` a las llamadas
        Mongo (`update_one(..., session=session)`) cuando NO sea None para que
        formen parte del commit atómico.

    Si el server no soporta transacciones (standalone), yields None y el
    bloque se ejecuta sin transacción (atomicidad sólo a nivel de documento).
    """
    if not await _detect_transactions_support():
        yield None
        return

    async with await _mongo_client.start_session() as session:
        try:
            async with session.start_transaction():
                yield session
            # commit implícito al salir limpio del with start_transaction()
        except Exception:
            # rollback implícito ya emitido por motor; relanzamos.
            raise
