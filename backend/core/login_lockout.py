"""
core/login_lockout.py — Defense-in-depth contra brute-force de credenciales.

ESTRATEGIA (P2 del committee audit · iter35):
    El rate-limit por IP (5/min) protege contra ataques desde una IP única,
    pero un atacante distribuido (botnet, proxy rotation) lo evade.
    Este módulo añade lockout PERSISTENTE por CUENTA:

      - Tras 5 fallos consecutivos en 15 min → cuenta bloqueada 30 min.
      - El lockout se almacena en `login_lockouts` con TTL automático.
      - Cuando la cuenta está bloqueada, /login responde 429 sin revelar
        si la password era correcta (defense in depth).
      - Un login exitoso resetea el contador.

ESCALADO DE BLOQUEO:
    threshold=5, window=15min, lockout=30min para admin login.
    Aplicable también a OTP verify si se desea (no implementado por ahora).
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional, Tuple

# Configurables — pueden externalizarse a env en el futuro.
MAX_FAILED_ATTEMPTS = 5          # disparador del lockout
FAILURE_WINDOW_MIN = 15          # ventana donde se cuentan los fallos
LOCKOUT_MIN = 30                 # duración del bloqueo
TTL_DOCUMENT_HOURS = 6           # ventana para auto-purga del doc


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


async def ensure_lockout_indices(db) -> None:
    """
    Idempotente. Crea índices necesarios en `login_lockouts`:
      - email (único)
      - locked_until (para queries rápidas y TTL passivo)
      - last_attempt_at TTL (auto-borra docs viejos)
    """
    coll = db.login_lockouts
    try:
        await coll.create_index("email", unique=True)
    except Exception:
        pass
    try:
        # TTL en 6h tras último intento (limpia históricos).
        await coll.create_index(
            "last_attempt_at",
            expireAfterSeconds=TTL_DOCUMENT_HOURS * 3600,
        )
    except Exception:
        pass


async def check_lockout(db, email: str) -> Tuple[bool, Optional[datetime]]:
    """
    Returns: (is_locked, locked_until_dt)
    - is_locked=True → bloquear el login (responder 429).
    - is_locked=False → continuar con verificación de credenciales.
    """
    if not email:
        return False, None
    doc = await db.login_lockouts.find_one({"email": email.lower()})
    if not doc:
        return False, None
    locked_until = doc.get("locked_until")
    if not locked_until:
        return False, None
    # MongoDB devuelve datetime con o sin tz dependiendo del cliente.
    if locked_until.tzinfo is None:
        locked_until = locked_until.replace(tzinfo=timezone.utc)
    if locked_until > _utc_now():
        return True, locked_until
    return False, None


async def register_failed_attempt(db, email: str) -> Tuple[int, Optional[datetime]]:
    """
    Incrementa el contador de fallos. Si llega al umbral en la ventana,
    aplica lockout.
    Returns: (failed_count_after, locked_until_dt_if_just_locked)
    """
    if not email:
        return 0, None
    e = email.lower()
    now = _utc_now()
    window_start = now - timedelta(minutes=FAILURE_WINDOW_MIN)

    # Upsert atómico — si el último fallo es viejo (fuera de ventana),
    # reseteamos el contador a 1; si está dentro, incrementamos.
    doc = await db.login_lockouts.find_one({"email": e})
    last_attempt = doc.get("last_attempt_at") if doc else None
    if last_attempt is not None and last_attempt.tzinfo is None:
        # MongoDB devuelve datetimes naive (UTC); normalizamos.
        last_attempt = last_attempt.replace(tzinfo=timezone.utc)
    if doc and last_attempt and last_attempt >= window_start:
        new_count = int(doc.get("failed_count", 0)) + 1
    else:
        new_count = 1

    update: dict = {
        "failed_count": new_count,
        "last_attempt_at": now,
    }
    locked_just_now: Optional[datetime] = None
    if new_count >= MAX_FAILED_ATTEMPTS:
        locked_just_now = now + timedelta(minutes=LOCKOUT_MIN)
        update["locked_until"] = locked_just_now
        update["failed_count"] = 0  # reseteamos para próximo ciclo
    await db.login_lockouts.update_one(
        {"email": e},
        {"$set": update},
        upsert=True,
    )
    return new_count, locked_just_now


async def clear_failures(db, email: str) -> None:
    """Login exitoso → limpia historial y desbloquea."""
    if not email:
        return
    await db.login_lockouts.delete_one({"email": email.lower()})
