"""
Protocolo anti-caídas para APIs externas (Twilio, Mercado Pago, Stripe).

Provee:
  - `with_timeout_and_retry`: ejecuta un coroutine con timeout duro y reintentos
    con backoff exponencial. Si falla todos los intentos, propaga la excepción
    original útil para el caller.
  - `safe_run`: variante "fire-and-forget seguro" — nunca propaga, retorna
    `(ok: bool, result_or_error)`. Para notificaciones donde si falla queremos
    seguir con el flujo.
  - `run_in_threadpool_with_timeout`: corre código síncrono (SDKs no-async)
    con timeout enforced desde el lado async.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any, Awaitable, Callable, Optional, Tuple, TypeVar

logger = logging.getLogger("padelappretas-os.circuit")

T = TypeVar("T")

DEFAULT_TIMEOUT_S = 8.0


async def with_timeout_and_retry(
    fn: Callable[[], Awaitable[T]],
    *,
    label: str,
    timeout_s: float = DEFAULT_TIMEOUT_S,
    retries: int = 1,
    backoff_base: float = 0.4,
) -> T:
    """Corre `fn` con timeout y hasta `retries` reintentos.

    Si tras todos los intentos sigue fallando, propaga la última excepción.
    Útil cuando el caller necesita saber si una operación crítica funcionó.
    """
    last_err: Optional[BaseException] = None
    attempts = retries + 1
    for i in range(attempts):
        try:
            return await asyncio.wait_for(fn(), timeout=timeout_s)
        except asyncio.TimeoutError as e:
            last_err = e
            logger.warning("[%s] timeout (intento %d/%d, %.1fs)", label, i + 1, attempts, timeout_s)
        except Exception as e:  # noqa: BLE001
            last_err = e
            logger.warning("[%s] falló (intento %d/%d): %s", label, i + 1, attempts, e)
        if i < retries:
            await asyncio.sleep(backoff_base * (2 ** i))
    assert last_err is not None
    raise last_err


async def safe_run(
    fn: Callable[[], Awaitable[T]],
    *,
    label: str,
    timeout_s: float = DEFAULT_TIMEOUT_S,
    retries: int = 1,
) -> Tuple[bool, Any]:
    """Versión "a prueba de balas": nunca lanza excepción.

    Returns (ok, value_or_error_str). Úsalo cuando el fallo no debe romper
    el flujo principal (notificaciones WhatsApp del waitlist, etc.).
    """
    try:
        val = await with_timeout_and_retry(
            fn, label=label, timeout_s=timeout_s, retries=retries,
        )
        return True, val
    except Exception as e:  # noqa: BLE001
        logger.error("[%s] descartado tras agotar reintentos: %s", label, e)
        return False, str(e)


async def run_sync_with_timeout(
    fn: Callable[..., T],
    *args: Any,
    label: str,
    timeout_s: float = DEFAULT_TIMEOUT_S,
) -> T:
    """Ejecuta una función síncrona en threadpool con timeout enforced."""
    loop = asyncio.get_event_loop()
    coro = loop.run_in_executor(None, fn, *args)
    return await asyncio.wait_for(coro, timeout=timeout_s)
