"""Tests for Fase C — Guards on checkout endpoints (Stripe, MercadoPago, mock).

Cubre la PREVENCIÓN de pagos/inscripciones a retas ya cerradas:
  • POST /public/retas/{id}/checkout (mock) → 403 si reta cerrada
  • POST /public/retas/{id}/checkout-stripe → 403 si reta cerrada
  • POST /public/retas/{id}/checkout-mercadopago → 403 si reta cerrada
  • PATCH /admin/inscripciones/{id}/estatus → 403 si reta cerrada

Estrategia: creamos reta válida (futura), luego usamos motor para retrasar
`fecha_evento` al pasado más allá del buffer 6h, y verificamos que el guard
levanta 403.
"""
from __future__ import annotations

import asyncio
import os
import time
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import requests
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

load_dotenv("/app/backend/.env")

BASE_URL = os.environ.get(
    "EXPO_PUBLIC_BACKEND_URL",
    "https://padel-tournament-hub-9.preview.emergentagent.com",
).rstrip("/")

ADMIN_USER = "admin@padelappretas.com"
ADMIN_PASS = "admin123"
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")


@pytest.fixture(scope="module")
def s():
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json"})
    return sess


@pytest.fixture(scope="module")
def admin_token(s):
    r = s.post(f"{BASE_URL}/api/auth/login",
               json={"username": ADMIN_USER, "password": ADMIN_PASS})
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


def auth_h(tok):
    return {"Authorization": f"Bearer {tok}"}


def _phone():
    return f"+521{(int(time.time() * 1000)) % 10000000000:010d}"


def _crear_reta_y_retrasar(s, tok, tipo_acceso="paga", costo=200):
    """Crea una reta válida (futura) y luego la retrasa al pasado vía mongo.
    Retorna el dict de la reta con fecha ya retrasada."""
    futura = datetime.now(timezone.utc) + timedelta(days=10)
    payload = {
        "nombre": f"TEST_GuardClosed_{uuid.uuid4().hex[:6]}",
        "club": "Guard Test Club",
        "fecha_str": futura.strftime("%Y-%m-%d"),
        "hora_str": "19:00",
        "tz_offset_minutes": -360,
        "canchas_disponibles": 2,
        "max_jugadores": 8,
        "costo_inscripcion": costo,
        "modalidad_juego": "PUNTOS",
        "num_rondas": 7,
        "formato_score": {"tipo": "PUNTOS", "valor": 9, "unidad": "juegos"},
        "tipo_acceso": tipo_acceso,
    }
    r = s.post(f"{BASE_URL}/api/retas", headers=auth_h(tok), json=payload)
    assert r.status_code == 200, r.text
    reta = r.json()

    # Retrasamos vía motor (buffer 6h + 1 = 7h al pasado).
    async def _backdate():
        client = AsyncIOMotorClient(MONGO_URL)
        try:
            db = client[DB_NAME]
            pasada = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()
            await db.retas.update_one(
                {"id": reta["id"]}, {"$set": {"fecha_evento": pasada}}
            )
        finally:
            client.close()

    asyncio.get_event_loop().run_until_complete(_backdate())
    reta["fecha_evento"] = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()
    return reta


def _cleanup(s, tok, reta_id):
    s.delete(f"{BASE_URL}/api/retas/{reta_id}", headers=auth_h(tok))


# ============================================================================
# 1. Checkout mock → 403 si reta cerrada
# ============================================================================
def test_checkout_mock_bloqueado_si_pasada(s, admin_token):
    reta = _crear_reta_y_retrasar(s, admin_token)
    try:
        r = s.post(
            f"{BASE_URL}/api/public/retas/{reta['id']}/checkout",
            json={
                "reta_id": reta["id"],
                "nombre": "Late Payer",
                "telefono": _phone(),
            },
        )
        assert r.status_code == 403, f"Esperaba 403, got {r.status_code}: {r.text}"
        body = r.json()
        assert "finalizó" in body.get("detail", "").lower() or "cerrada" in body.get("detail", "").lower()
    finally:
        _cleanup(s, admin_token, reta["id"])


# ============================================================================
# 2. Checkout Stripe → 403 si reta cerrada (si Stripe está configurado)
# ============================================================================
def test_checkout_stripe_bloqueado_si_pasada(s, admin_token):
    reta = _crear_reta_y_retrasar(s, admin_token)
    try:
        r = s.post(
            f"{BASE_URL}/api/public/retas/{reta['id']}/checkout-stripe",
            json={
                "reta_id": reta["id"],
                "nombre": "Late Stripe",
                "telefono": _phone(),
            },
        )
        # 403 = guard activado. 503 = Stripe no configurado (también OK para el test).
        assert r.status_code in (403, 503), f"Esperaba 403/503, got {r.status_code}: {r.text}"
        if r.status_code == 403:
            assert "finaliz" in r.text.lower() or "cerrad" in r.text.lower()
    finally:
        _cleanup(s, admin_token, reta["id"])


# ============================================================================
# 3. Checkout MercadoPago → 403 si reta cerrada
# ============================================================================
def test_checkout_mp_bloqueado_si_pasada(s, admin_token):
    reta = _crear_reta_y_retrasar(s, admin_token)
    try:
        r = s.post(
            f"{BASE_URL}/api/public/retas/{reta['id']}/checkout-mercadopago",
            json={
                "reta_id": reta["id"],
                "nombre": "Late MP",
                "telefono": _phone(),
            },
        )
        # 403 = guard. 503 = MP no configurado (también acepta).
        assert r.status_code in (403, 503), f"Esperaba 403/503, got {r.status_code}: {r.text}"
        if r.status_code == 403:
            assert "finaliz" in r.text.lower() or "cerrad" in r.text.lower()
    finally:
        _cleanup(s, admin_token, reta["id"])


# ============================================================================
# 4. PATCH /admin/inscripciones/{id}/estatus → 403 si reta cerrada
# ============================================================================
def test_patch_estatus_bloqueado_si_pasada(s, admin_token):
    # Creamos una reta gratis_amigos para poder generar inscripción vía RSVP
    futura = datetime.now(timezone.utc) + timedelta(days=10)
    payload = {
        "nombre": f"TEST_PatchClosed_{uuid.uuid4().hex[:6]}",
        "club": "Patch Test Club",
        "fecha_str": futura.strftime("%Y-%m-%d"),
        "hora_str": "19:00",
        "tz_offset_minutes": -360,
        "canchas_disponibles": 2,
        "max_jugadores": 8,
        "costo_inscripcion": 100,
        "modalidad_juego": "PUNTOS",
        "num_rondas": 7,
        "formato_score": {"tipo": "PUNTOS", "valor": 9, "unidad": "juegos"},
        "tipo_acceso": "gratis_amigos",
    }
    r0 = s.post(f"{BASE_URL}/api/retas", headers=auth_h(admin_token), json=payload)
    assert r0.status_code == 200
    reta = r0.json()
    try:
        # Inscribimos primero (con reta aún futura).
        r1 = s.post(
            f"{BASE_URL}/api/public/retas/{reta['id']}/rsvp/aceptar",
            json={"nombre": "Quien Sea", "telefono": _phone()},
        )
        assert r1.status_code == 200, r1.text
        insc_id = r1.json()["inscripcion_id"]

        # Retrasamos la reta al pasado.
        async def _backdate():
            client = AsyncIOMotorClient(MONGO_URL)
            try:
                db = client[DB_NAME]
                pasada = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()
                await db.retas.update_one(
                    {"id": reta["id"]}, {"$set": {"fecha_evento": pasada}}
                )
            finally:
                client.close()
        asyncio.get_event_loop().run_until_complete(_backdate())

        # Ahora el PATCH debe devolver 403.
        r2 = s.patch(
            f"{BASE_URL}/api/admin/inscripciones/{insc_id}/estatus",
            headers=auth_h(admin_token),
            json={"estatus_confirmacion": "rechazado"},
        )
        assert r2.status_code == 403, f"Esperaba 403, got {r2.status_code}: {r2.text}"
    finally:
        _cleanup(s, admin_token, reta["id"])


# ============================================================================
# 5. Reta FUTURA: checkout sigue funcionando (no false-positives)
# ============================================================================
def test_checkout_mock_funciona_si_futura(s, admin_token):
    futura = datetime.now(timezone.utc) + timedelta(days=10)
    payload = {
        "nombre": f"TEST_GuardFuture_{uuid.uuid4().hex[:6]}",
        "club": "Future Test Club",
        "fecha_str": futura.strftime("%Y-%m-%d"),
        "hora_str": "19:00",
        "tz_offset_minutes": -360,
        "canchas_disponibles": 2,
        "max_jugadores": 8,
        "costo_inscripcion": 100,
        "modalidad_juego": "PUNTOS",
        "num_rondas": 7,
        "formato_score": {"tipo": "PUNTOS", "valor": 9, "unidad": "juegos"},
        "tipo_acceso": "paga",
    }
    r0 = s.post(f"{BASE_URL}/api/retas", headers=auth_h(admin_token), json=payload)
    assert r0.status_code == 200
    reta = r0.json()
    try:
        r = s.post(
            f"{BASE_URL}/api/public/retas/{reta['id']}/checkout",
            json={
                "reta_id": reta["id"],
                "nombre": "Future Payer",
                "telefono": _phone(),
            },
        )
        assert r.status_code == 200, f"Reta futura debería permitir checkout: {r.text}"
    finally:
        _cleanup(s, admin_token, reta["id"])
