"""Iter39 — Fase 5: Anti-oversell (Mercado Pago + Cupones) + Waitlist UX.

Scope (from review request):
  1) POST /api/public/retas/{reta_id}/checkout-mercadopago on a FULL reta
     (max_jugadores Aprobados) MUST respond 409 with a message containing
     'lista de espera' or 'llen'.
  2) POST /api/public/retas/{reta_id}/cupon/canjear on a FULL reta MUST
     respond 409.
  3) POST /api/public/retas/{reta_id}/waitlist (joinWaitlist) AFTER the 409
     MUST respond 200/201 with posicion_fila >= 1.
  4) Race condition: fill reta to max_jugadores - 1 via direct DB Aprobado
     seeding. Fire 5 concurrent canjear/checkout requests.
     Only 1 must succeed, the other 4 must respond 409.

Setup notes:
  - We seed a fake `access_token_pasarela` on the admin doc so that
    checkout-mercadopago reaches the `crear_inscripcion_pendiente` path
    (which is where the 409 is raised). The actual MP call will fail later
    with 502 (no real token) — that's expected and validated separately.
  - Aprobado inscriptions are seeded directly in MongoDB using MONGO_URL
    from backend/.env. We also bump `inscritos_lock` so the atomic counter
    is in sync with the seeded data.
  - All TEST_ prefixed retas are deleted on teardown.
"""
from __future__ import annotations

import asyncio
import os
import time
import uuid
from datetime import datetime, timedelta, timezone

import httpx
import pytest
from motor.motor_asyncio import AsyncIOMotorClient


# ---------------------------------------------------------------------------
# Module-level helpers
# ---------------------------------------------------------------------------

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")


def _build_reta_payload(nombre: str, max_jugadores: int = 4, costo: float = 100.0):
    """Reta with costo >= $10 so checkout-mp doesn't short-circuit on price."""
    return {
        "nombre": nombre,
        "club": "TEST_Club_Iter39",
        "fecha_str": "2030-06-15",
        "hora_str": "10:00",
        "tz_offset_minutes": -360,
        "canchas_disponibles": 1,
        "max_jugadores": max_jugadores,
        "costo_inscripcion": costo,
        "modalidad_juego": "PUNTOS",
        "num_rondas": 5,
        "formato_score": {
            "tipo": "PUNTOS",
            "valor": 5,
            "unidad": "juegos",
            "cap_total": 5,
            "ko_enabled": True,
        },
        "num_ganadores_por_cancha": 1,
        "criterio_desempate": "A",
        "jugadores_por_cancha": 4,
    }


async def _seed_aprobados_in_db(reta_id: str, n: int) -> list[str]:
    """Insert N Aprobado inscriptions directly + bump inscritos_lock atomically.

    Returns the IDs created (for cleanup).
    """
    client = AsyncIOMotorClient(MONGO_URL)
    try:
        db = client[DB_NAME]
        ids: list[str] = []
        now_iso = datetime.now(timezone.utc).isoformat()
        for i in range(n):
            insc_id = str(uuid.uuid4())
            jugador_id = str(uuid.uuid4())
            await db.inscripciones.insert_one({
                "id": insc_id,
                "reta_id": reta_id,
                "jugador_id": jugador_id,
                "nombre": f"TEST_Seed_{i}",
                "telefono": f"+5215500000{i:03d}",
                "estatus_pago": "Aprobado",
                "monto_pagado": 100.0,
                "metodo_pago": "seed",
                "creado_en": now_iso,
                "bloqueado_hasta": None,
            })
            ids.append(insc_id)
        # Sync atomic counter so reservar_lugar_atomico sees the right value.
        await db.retas.update_one(
            {"id": reta_id},
            {"$inc": {"inscritos_lock": n}, "$setOnInsert": {"waitlist_seq": 0}},
            upsert=False,
        )
        # Force-set inscritos_lock to N if not yet initialized.
        reta = await db.retas.find_one({"id": reta_id})
        if reta and reta.get("inscritos_lock", 0) < n:
            await db.retas.update_one({"id": reta_id}, {"$set": {"inscritos_lock": n}})
        return ids
    finally:
        client.close()


async def _seed_mp_token_on_admin(admin_email: str = "admin@padelappretas.com") -> None:
    """Set a fake access_token_pasarela on the admin so checkout-mp reaches
    the 409 branch instead of failing earlier with 400 (MP not connected)."""
    client = AsyncIOMotorClient(MONGO_URL)
    try:
        db = client[DB_NAME]
        await db.admins.update_one(
            {"email": admin_email},
            {"$set": {
                "access_token_pasarela": "TEST_FAKE_TOKEN_iter39_for_409_only",
                "mp_user_id": "TEST_FAKE_USER",
                "mp_apply_fee": False,
            }},
        )
    finally:
        client.close()


async def _clear_mp_token_on_admin(admin_email: str = "admin@padelappretas.com") -> None:
    client = AsyncIOMotorClient(MONGO_URL)
    try:
        db = client[DB_NAME]
        await db.admins.update_one(
            {"email": admin_email},
            {"$unset": {
                "access_token_pasarela": "",
                "mp_user_id": "",
                "mp_apply_fee": "",
            }},
        )
    finally:
        client.close()


async def _cleanup_inscripciones(reta_id: str) -> None:
    client = AsyncIOMotorClient(MONGO_URL)
    try:
        db = client[DB_NAME]
        await db.inscripciones.delete_many({"reta_id": reta_id})
        await db.lista_espera.delete_many({"reta_id": reta_id})
    finally:
        client.close()


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def reta_full(api_client, base_url, auth_headers):
    """Create a reta and fill it to max_jugadores via direct DB seeding.

    Yields the reta dict + a list of seeded inscripcion IDs.
    """
    payload = _build_reta_payload(
        nombre=f"TEST_Iter39_Full_{int(time.time())}",
        max_jugadores=4,
        costo=100.0,
    )
    r = api_client.post(
        f"{base_url}/api/retas", json=payload, headers=auth_headers, timeout=20
    )
    assert r.status_code == 200, f"Create reta failed: {r.status_code} {r.text}"
    reta = r.json()
    rid = reta["id"]

    # Fill to max_jugadores
    asyncio.run(_seed_aprobados_in_db(rid, reta["max_jugadores"]))
    asyncio.run(_seed_mp_token_on_admin())

    yield reta

    # Teardown
    asyncio.run(_cleanup_inscripciones(rid))
    asyncio.run(_clear_mp_token_on_admin())
    try:
        api_client.delete(f"{base_url}/api/retas/{rid}", headers=auth_headers, timeout=20)
    except Exception:
        pass


@pytest.fixture
def reta_one_left(api_client, base_url, auth_headers):
    """Create a reta and fill it to max_jugadores - 1 (one cupo left)."""
    payload = _build_reta_payload(
        nombre=f"TEST_Iter39_Race_{int(time.time())}",
        max_jugadores=4,
        costo=100.0,
    )
    r = api_client.post(
        f"{base_url}/api/retas", json=payload, headers=auth_headers, timeout=20
    )
    assert r.status_code == 200, f"Create reta failed: {r.status_code} {r.text}"
    reta = r.json()
    rid = reta["id"]

    asyncio.run(_seed_aprobados_in_db(rid, reta["max_jugadores"] - 1))
    asyncio.run(_seed_mp_token_on_admin())

    yield reta

    asyncio.run(_cleanup_inscripciones(rid))
    asyncio.run(_clear_mp_token_on_admin())
    try:
        api_client.delete(f"{base_url}/api/retas/{rid}", headers=auth_headers, timeout=20)
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class TestAntiOversellMP:
    """checkout-mercadopago anti-oversell behaviour."""

    def test_mp_full_returns_409_with_waitlist_message(
        self, api_client, base_url, reta_full
    ):
        rid = reta_full["id"]
        body = {
            "nombre": "TEST_Buyer",
            "telefono": "+5215599999999",
            "payer_email": "test@example.com",
        }
        r = api_client.post(
            f"{base_url}/api/public/retas/{rid}/checkout-mercadopago",
            json=body,
            timeout=20,
        )
        assert r.status_code == 409, (
            f"Expected 409, got {r.status_code} body={r.text}"
        )
        msg = (r.json().get("detail") or "").lower()
        assert ("lista de espera" in msg) or ("llen" in msg), (
            f"Message must include 'lista de espera' or 'llen', got: {msg!r}"
        )


class TestAntiOversellCupon:
    """cupon/canjear anti-oversell behaviour."""

    def _create_cupon(self, api_client, base_url, auth_headers, reta_id=None):
        body = {"descripcion": "TEST cupon iter39"}
        if reta_id:
            body["reta_id_exclusivo"] = reta_id
        r = api_client.post(
            f"{base_url}/api/admin/cupones", json=body, headers=auth_headers, timeout=20
        )
        assert r.status_code == 200, f"Create cupon failed: {r.status_code} {r.text}"
        return r.json()

    def test_cupon_canjear_full_reta_returns_409(
        self, api_client, base_url, auth_headers, reta_full
    ):
        rid = reta_full["id"]
        cupon = self._create_cupon(api_client, base_url, auth_headers, reta_id=rid)
        body = {
            "codigo": cupon["codigo"],
            "nombre": "TEST_Cupon_Buyer",
            "telefono": "+5215588888888",
        }
        r = api_client.post(
            f"{base_url}/api/public/retas/{rid}/cupon/canjear",
            json=body,
            timeout=20,
        )
        assert r.status_code == 409, (
            f"Expected 409 on full reta, got {r.status_code} body={r.text}"
        )
        msg = (r.json().get("detail") or "").lower()
        assert ("lista de espera" in msg) or ("llen" in msg) or ("cupo" in msg), (
            f"Message must reference waitlist/llen/cupos, got: {msg!r}"
        )

        # Cleanup cupon
        api_client.delete(
            f"{base_url}/api/admin/cupones/{cupon['id']}",
            headers=auth_headers,
            timeout=10,
        )


class TestWaitlistAfter409:
    """joinWaitlist works after a 409 (UX continuation)."""

    def test_join_waitlist_returns_position_ge_1(
        self, api_client, base_url, reta_full
    ):
        rid = reta_full["id"]
        # First — confirm the 409 happens
        r409 = api_client.post(
            f"{base_url}/api/public/retas/{rid}/checkout-mercadopago",
            json={
                "nombre": "TEST_Waitlister",
                "telefono": "+5215577777777",
                "payer_email": "wait@test.com",
            },
            timeout=20,
        )
        assert r409.status_code == 409, (
            f"Pre-cond: reta should be full, got {r409.status_code}: {r409.text}"
        )

        # Now — join waitlist
        wl = api_client.post(
            f"{base_url}/api/public/retas/{rid}/waitlist",
            json={
                "reta_id": rid,
                "nombre": "TEST_Waitlister",
                "telefono": "+5215577777777",
            },
            timeout=20,
        )
        assert wl.status_code in (200, 201), (
            f"joinWaitlist failed: {wl.status_code} {wl.text}"
        )
        data = wl.json()
        assert data.get("posicion_fila") and int(data["posicion_fila"]) >= 1, (
            f"posicion_fila must be >= 1, got {data}"
        )
        assert data.get("reta_id") == rid
        assert data.get("telefono") == "+5215577777777"


class TestRaceCondition:
    """5 concurrent canjear/checkout requests on the LAST cupo — only 1 wins."""

    def _create_n_cupones(self, api_client, base_url, auth_headers, reta_id, n):
        ids = []
        for _ in range(n):
            r = api_client.post(
                f"{base_url}/api/admin/cupones",
                json={"descripcion": "TEST race", "reta_id_exclusivo": reta_id},
                headers=auth_headers,
                timeout=15,
            )
            assert r.status_code == 200, f"Cupon create failed: {r.text}"
            ids.append(r.json())
        return ids

    def test_race_condition_only_one_wins(
        self, api_client, base_url, auth_headers, reta_one_left
    ):
        """Use cupon/canjear (no MP dependency) to validate the atomic reserve.

        We fire 5 concurrent canjear with DIFFERENT cupon codes — only the
        cupo reservation is racy. Only 1 should reserve the last cupo;
        the other 4 must respond 409 (and their cupons must NOT be consumed).
        """
        rid = reta_one_left["id"]
        cupones = self._create_n_cupones(api_client, base_url, auth_headers, rid, 5)

        async def _fire_one(codigo: str, i: int):
            async with httpx.AsyncClient(timeout=20) as client:
                resp = await client.post(
                    f"{base_url}/api/public/retas/{rid}/cupon/canjear",
                    json={
                        "codigo": codigo,
                        "nombre": f"TEST_Race_{i}",
                        "telefono": f"+5215566600{i:03d}",
                    },
                )
                return resp.status_code, resp.text

        async def _run():
            tasks = [_fire_one(c["codigo"], i) for i, c in enumerate(cupones)]
            return await asyncio.gather(*tasks)

        results = asyncio.run(_run())
        statuses = [s for s, _ in results]
        n_200 = sum(1 for s in statuses if s == 200)
        n_409 = sum(1 for s in statuses if s == 409)

        # Cleanup cupons (delete unused ones)
        for c in cupones:
            try:
                api_client.delete(
                    f"{base_url}/api/admin/cupones/{c['id']}",
                    headers=auth_headers,
                    timeout=10,
                )
            except Exception:
                pass

        assert n_200 == 1, (
            f"Expected exactly 1 success, got {n_200}. Statuses={statuses} "
            f"bodies={[b[:120] for _, b in results]}"
        )
        assert n_409 == 4, (
            f"Expected exactly 4 conflicts, got {n_409}. Statuses={statuses}"
        )
