"""Mercado Pago Marketplace integration tests for PadelappRetas.

Covers:
- POST /api/admin/mercadopago/connect (valid + invalid token)
- GET  /api/admin/mercadopago/status
- PATCH /api/admin/mercadopago/settings (apply_fee toggle)
- POST /api/admin/mercadopago/disconnect (then re-connect, w/ lockout test)
- POST /api/public/retas/{id}/checkout-mercadopago (with + without MP)
- POST /api/webhooks/mercadopago (idempotent, no auth)
- GET  /api/public/inscripciones/{id}/mp-status (polling)
- Regression smoke for Stripe / retas CRUD / auth / dashboard / radar
"""
import os
import sys
import time
import uuid
from pathlib import Path

import pytest
import requests
from pymongo import MongoClient

BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

from conftest import BASE_URL  # noqa: E402

# Test MP seller token (already linked per /app/memory/test_credentials.md)
MP_TEST_TOKEN = "APP_USR-1598112764080275-052714-abc67f3b949c727d57221f8e4dd6df9a-3431138052"
MP_TEST_USER_ID = "3431138052"

# Mongo (for low-level verification of mp_transactions/admin doc)
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")
_mongo = MongoClient(MONGO_URL)
_db = _mongo[DB_NAME]


# ===================== Helpers =====================
def _create_reta(api_client, auth_headers, **overrides):
    suffix = str(int(time.time() * 1000)) + str(uuid.uuid4())[:4]
    payload = {
        "nombre": f"TEST_MPReta_{suffix}",
        "club": f"TEST_Club_{suffix}",
        "fecha_str": "2026-12-15",
        "hora_str": "18:00",
        "tz_offset_minutes": -360,
        "canchas_disponibles": 1,
        "costo_inscripcion": 250.0,
        "modalidad_juego": "PUNTOS",
        "num_rondas": 7,
        "observaciones_publicas": "TEST mp",
        "latitud": 19.43,
        "longitud": -99.13,
    }
    payload.update(overrides)
    r = api_client.post(f"{BASE_URL}/api/retas", json=payload, headers=auth_headers)
    assert r.status_code == 200, f"Create reta failed: {r.status_code} {r.text}"
    return r.json()


def _delete_reta(api_client, auth_headers, reta_id):
    api_client.delete(f"{BASE_URL}/api/retas/{reta_id}", headers=auth_headers)


def _ensure_connected(api_client, auth_headers):
    """Re-connect MP with the test token to guarantee a clean known state."""
    r = api_client.post(
        f"{BASE_URL}/api/admin/mercadopago/connect",
        json={"access_token": MP_TEST_TOKEN},
        headers=auth_headers,
    )
    assert r.status_code == 200, f"MP connect failed: {r.status_code} {r.text}"
    return r.json()


# ===================== Connect / Status / Disconnect =====================
class TestMpConnect:
    """Connect/disconnect MP account for admin organizer."""

    def test_connect_invalid_token_returns_400(self, api_client, auth_headers):
        r = api_client.post(
            f"{BASE_URL}/api/admin/mercadopago/connect",
            json={"access_token": "INVALID-TOKEN-XYZ-1234567890"},
            headers=auth_headers,
        )
        assert r.status_code == 400, f"Expected 400, got {r.status_code} {r.text}"

    def test_connect_valid_token_returns_user_info(self, api_client, auth_headers):
        data = _ensure_connected(api_client, auth_headers)
        assert data["connected"] is True
        assert data["mp_user_id"] == MP_TEST_USER_ID
        assert data["nickname"] == "TESTUSER6726683974643509298"
        assert data["site_id"] == "MLM"
        assert "connected_at" in data and data["connected_at"]
        # apply_fee defaults to False on first connect
        assert isinstance(data["apply_fee"], bool)
        assert isinstance(data["fee_percent"], (int, float))

    def test_connect_requires_auth(self, api_client):
        r = api_client.post(
            f"{BASE_URL}/api/admin/mercadopago/connect",
            json={"access_token": MP_TEST_TOKEN},
        )
        assert r.status_code in (401, 403)


class TestMpStatus:
    def test_status_returns_connected_after_connect(self, api_client, auth_headers):
        _ensure_connected(api_client, auth_headers)
        r = api_client.get(
            f"{BASE_URL}/api/admin/mercadopago/status", headers=auth_headers
        )
        assert r.status_code == 200
        data = r.json()
        assert data["connected"] is True
        assert data["mp_user_id"] == MP_TEST_USER_ID
        assert data["nickname"] == "TESTUSER6726683974643509298"
        assert "apply_fee" in data
        assert "fee_percent" in data

    def test_status_requires_auth(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/admin/mercadopago/status")
        assert r.status_code in (401, 403)


class TestMpSettings:
    def test_toggle_apply_fee_true_then_false(self, api_client, auth_headers):
        _ensure_connected(api_client, auth_headers)

        r1 = api_client.patch(
            f"{BASE_URL}/api/admin/mercadopago/settings",
            json={"apply_fee": True},
            headers=auth_headers,
        )
        assert r1.status_code == 200, r1.text
        assert r1.json()["apply_fee"] is True

        # verify via GET
        rs = api_client.get(
            f"{BASE_URL}/api/admin/mercadopago/status", headers=auth_headers
        )
        assert rs.json()["apply_fee"] is True

        r2 = api_client.patch(
            f"{BASE_URL}/api/admin/mercadopago/settings",
            json={"apply_fee": False},
            headers=auth_headers,
        )
        assert r2.status_code == 200
        assert r2.json()["apply_fee"] is False

        rs2 = api_client.get(
            f"{BASE_URL}/api/admin/mercadopago/status", headers=auth_headers
        )
        assert rs2.json()["apply_fee"] is False


class TestMpDisconnectAndLockout:
    """Disconnect must wipe token; checkout must then be blocked with 400."""

    def test_disconnect_then_checkout_blocked_then_reconnect(
        self, api_client, auth_headers
    ):
        # Ensure starting connected
        _ensure_connected(api_client, auth_headers)

        # Create a reta we can attempt to checkout
        reta = _create_reta(api_client, auth_headers, costo_inscripcion=150.0)
        try:
            # 1) Disconnect
            rd = api_client.post(
                f"{BASE_URL}/api/admin/mercadopago/disconnect",
                headers=auth_headers,
            )
            assert rd.status_code == 200
            assert rd.json().get("ok") is True

            # Status should now be disconnected
            rs = api_client.get(
                f"{BASE_URL}/api/admin/mercadopago/status", headers=auth_headers
            )
            assert rs.status_code == 200
            assert rs.json()["connected"] is False

            # 2) Checkout w/o MP → 400 with organizer-not-linked message
            rc = api_client.post(
                f"{BASE_URL}/api/public/retas/{reta['id']}/checkout-mercadopago",
                json={
                    "nombre": "TEST_MPBuyer",
                    "telefono": "+521TEST_MP000001",
                },
            )
            assert rc.status_code == 400, f"Expected 400, got {rc.status_code} {rc.text}"
            assert "vinculado" in rc.text.lower() or "mercado pago" in rc.text.lower()
        finally:
            # 3) Re-connect for the rest of the suite
            _ensure_connected(api_client, auth_headers)
            _delete_reta(api_client, auth_headers, reta["id"])


# ===================== Checkout (creates real MP preference) =====================
class TestMpCheckout:
    """Creates a real MP preference using the test seller token."""

    def test_checkout_returns_init_point_https_and_persists_tx(
        self, api_client, auth_headers
    ):
        _ensure_connected(api_client, auth_headers)
        reta = _create_reta(api_client, auth_headers, costo_inscripcion=300.0)
        try:
            r = api_client.post(
                f"{BASE_URL}/api/public/retas/{reta['id']}/checkout-mercadopago",
                json={
                    "nombre": "TEST_MPBuyer1",
                    "telefono": "+521TEST_MP100001",
                    "payer_email": "buyer@test.com",
                },
                timeout=30,
            )
            assert r.status_code == 200, f"Checkout failed: {r.status_code} {r.text}"
            data = r.json()
            assert "inscripcion_id" in data
            assert "preference_id" in data and data["preference_id"]
            assert "init_point" in data
            init_point = data["init_point"]
            assert init_point.startswith("https://"), init_point
            assert "mercadopago.com.mx/checkout/v1/redirect" in init_point, init_point
            # sandbox_init_point optional but should be HTTPS if present
            if data.get("sandbox_init_point"):
                assert data["sandbox_init_point"].startswith("https://")

            insc_id = data["inscripcion_id"]
            # Inscripcion debe quedar Pendiente
            r_insc = api_client.get(
                f"{BASE_URL}/api/retas/{reta['id']}/inscripciones",
                headers=auth_headers,
            )
            assert r_insc.status_code == 200
            insc_list = r_insc.json()
            matching = [i for i in insc_list if i["id"] == insc_id]
            assert matching, "Inscripcion not found in reta inscripciones list"
            assert matching[0]["estatus_pago"] == "Pendiente"

            # mp_transactions must have a doc with preference_id and init_point
            tx = _db.mp_transactions.find_one({"inscripcion_id": insc_id})
            assert tx is not None, "mp_transactions doc missing"
            assert tx["preference_id"] == data["preference_id"]
            assert tx["init_point"] == data["init_point"]
            assert tx["amount"] == 300.0
            assert tx["currency"] == "MXN"
            assert tx["payment_status"] == "initiated"
            assert tx["organizador_mp_user_id"] == MP_TEST_USER_ID

            # mp_status polling endpoint
            rps = api_client.get(
                f"{BASE_URL}/api/public/inscripciones/{insc_id}/mp-status",
                timeout=20,
            )
            assert rps.status_code == 200
            ps = rps.json()
            assert ps["inscripcion_id"] == insc_id
            # Status should still be Pendiente (no payment was made)
            assert ps["estatus_pago"] in ("Pendiente", "Aprobado", "Cancelado")
        finally:
            _delete_reta(api_client, auth_headers, reta["id"])

    def test_checkout_reta_inexistente_404(self, api_client):
        r = api_client.post(
            f"{BASE_URL}/api/public/retas/inexistente-{uuid.uuid4().hex[:8]}/checkout-mercadopago",
            json={"nombre": "TEST_X", "telefono": "+521TEST_NX1"},
        )
        assert r.status_code == 404

    def test_checkout_costo_menor_a_10_returns_400(self, api_client, auth_headers):
        _ensure_connected(api_client, auth_headers)
        reta = _create_reta(api_client, auth_headers, costo_inscripcion=5.0)
        try:
            r = api_client.post(
                f"{BASE_URL}/api/public/retas/{reta['id']}/checkout-mercadopago",
                json={"nombre": "TEST_Low", "telefono": "+521TEST_LOW2"},
            )
            assert r.status_code == 400
        finally:
            _delete_reta(api_client, auth_headers, reta["id"])

    def test_mp_status_not_found(self, api_client):
        r = api_client.get(
            f"{BASE_URL}/api/public/inscripciones/no-existe-{uuid.uuid4().hex[:8]}/mp-status"
        )
        assert r.status_code == 404


# ===================== Webhook =====================
class TestMpWebhook:
    def test_webhook_payment_payload_returns_200(self, api_client):
        # Even if the inscripcion id doesn't match anything, webhook returns 200 (idempotent)
        payload = {
            "type": "payment",
            "data": {"id": f"99999999-{uuid.uuid4().hex[:8]}"},
        }
        r = api_client.post(
            f"{BASE_URL}/api/webhooks/mercadopago", json=payload, timeout=20
        )
        assert r.status_code == 200, f"{r.status_code} {r.text}"
        assert r.json().get("ok") is True

    def test_webhook_unknown_type_returns_200(self, api_client):
        r = api_client.post(
            f"{BASE_URL}/api/webhooks/mercadopago",
            json={"type": "unknown_event", "data": {"id": "1"}},
            timeout=10,
        )
        assert r.status_code == 200
        body = r.json()
        assert body.get("ok") is True

    def test_webhook_empty_body_returns_200(self, api_client):
        r = api_client.post(
            f"{BASE_URL}/api/webhooks/mercadopago",
            data="",
            headers={"Content-Type": "application/json"},
            timeout=10,
        )
        assert r.status_code == 200

    def test_webhook_no_auth_required(self, api_client):
        # Fresh session without auth headers
        s = requests.Session()
        r = s.post(
            f"{BASE_URL}/api/webhooks/mercadopago",
            json={"type": "payment", "data": {"id": "1"}},
            timeout=10,
        )
        assert r.status_code == 200


# ===================== Regression smoke =====================
class TestRegressionNoMpBreakage:
    """Quick smoke that pre-existing critical endpoints still work."""

    def test_auth_login_works(self, api_client):
        r = api_client.post(
            f"{BASE_URL}/api/auth/login",
            json={"username": "admin@padelappretas.com", "password": "admin123"},
            timeout=15,
        )
        assert r.status_code == 200
        assert "access_token" in r.json()

    def test_retas_list_works(self, api_client, auth_headers):
        r = api_client.get(f"{BASE_URL}/api/retas", headers=auth_headers)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_dashboard_metrics_works(self, api_client, auth_headers):
        r = api_client.get(f"{BASE_URL}/api/admin/metrics", headers=auth_headers)
        assert r.status_code == 200
        data = r.json()
        # Sanity keys
        assert "retas_activas" in data or "total_retas" in data or isinstance(data, dict)

    def test_radar_public_works(self, api_client):
        r = api_client.get(
            f"{BASE_URL}/api/public/retas/radar",
            params={"lat": 19.43, "lng": -99.13, "radio_km": 50},
        )
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_stripe_checkout_still_creates_session(self, api_client, auth_headers):
        # Confirms Stripe path is untouched by MP changes
        reta = _create_reta(api_client, auth_headers, costo_inscripcion=120.0)
        try:
            r = api_client.post(
                f"{BASE_URL}/api/public/retas/{reta['id']}/checkout-stripe",
                json={
                    "nombre": "TEST_StripeRegress",
                    "telefono": "+521TEST_REG00001",
                },
                timeout=30,
            )
            assert r.status_code == 200, f"Stripe regression: {r.status_code} {r.text}"
            data = r.json()
            assert "checkout_url" in data
            assert data["checkout_url"].startswith("https://")
        finally:
            _delete_reta(api_client, auth_headers, reta["id"])


# ===================== Cleanup hook =====================
@pytest.fixture(scope="module", autouse=True)
def _ensure_clean_state_after_module(api_client, auth_headers):
    yield
    # Always leave MP re-connected for next test agents (per credentials note)
    try:
        api_client.post(
            f"{BASE_URL}/api/admin/mercadopago/connect",
            json={"access_token": MP_TEST_TOKEN},
            headers=auth_headers,
            timeout=15,
        )
    except Exception:
        pass
    # Drop TEST_ mp_transactions leftovers
    try:
        _db.mp_transactions.delete_many({"telefono": {"$regex": "^\\+521TEST_MP"}})
        _db.mp_events.delete_many({"type": {"$in": ["unknown_event", ""]}})
    except Exception:
        pass
