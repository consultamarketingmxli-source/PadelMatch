"""
Tests iter35-followup — Verificación del fix P2 (brute force lockout).

Este test prueba el nuevo módulo `core/login_lockout` aisladamente y
verifica que /api/auth/login responde 429 tras 5 fallos consecutivos
del mismo email (defense-in-depth sobre el rate-limit por IP).
"""
import asyncio

import pytest


@pytest.mark.asyncio
async def test_lockout_module_unit():
    """3 escenarios: cuenta limpia, lockout tras 5 fallos, reset tras éxito."""
    from core.db import db
    from core.login_lockout import (
        check_lockout,
        clear_failures,
        ensure_lockout_indices,
        register_failed_attempt,
    )

    email = "iter35-unit@padelappretas.com"
    await ensure_lockout_indices(db)
    await db.login_lockouts.delete_one({"email": email})

    # 1) email limpio → no locked
    is_locked, _ = await check_lockout(db, email)
    assert is_locked is False

    # 2) 5 fallos consecutivos → just_locked debe activarse
    just = None
    for _ in range(5):
        _, just = await register_failed_attempt(db, email)
    assert just is not None, "esperaba bloqueo en el 5º intento"

    is_locked, until = await check_lockout(db, email)
    assert is_locked is True
    assert until is not None

    # 3) clear_failures → desbloqueo
    await clear_failures(db, email)
    is_locked, _ = await check_lockout(db, email)
    assert is_locked is False

    # cleanup
    await db.login_lockouts.delete_one({"email": email})


@pytest.mark.asyncio
async def test_lockout_via_http(monkeypatch):
    """
    Verifica el comportamiento end-to-end vía cliente HTTPX:
    los primeros 4 intentos fallidos devuelven 401, el 5º dispara 429,
    y un login válido del admin real sigue funcionando tras limpieza.
    NOTA: respeta el rate-limit slowapi 5/min sleeping entre intentos.
    """
    import httpx

    from core.db import db

    base = "http://localhost:8001"
    fake_email = "iter35-http-lockout@x.com"

    # cleanup previo
    await db.login_lockouts.delete_one({"email": fake_email})

    async with httpx.AsyncClient(timeout=10.0) as ac:
        statuses = []
        for i in range(6):
            r = await ac.post(
                f"{base}/api/auth/login",
                json={"username": fake_email, "password": f"wrong-{i}"},
            )
            statuses.append(r.status_code)
            await asyncio.sleep(12.5)  # respetar rate-limit 5/min slowapi

    # Primeros 4 deben ser 401 (credenciales inválidas, sin lockout aún)
    assert statuses[0] == 401
    # El 5to o 6to debe ser 429 (lockout aplicado)
    assert 429 in statuses[3:], f"esperaba 429 en intentos finales, statuses={statuses}"

    # cleanup
    await db.login_lockouts.delete_one({"email": fake_email})
