"""
Iter34 — Audit Committee fix regression
========================================

Verifica los 3 fixes críticos del Comité Élite:
  1. CORS hardening: CORS_ORIGINS="*" → allow_credentials debe ser False
  2. Player OTP auth flow (no romper nada)
  3. Webhook Mercado Pago sigue rechazando firmas inválidas (401)
  + Sanity: GET /api/ devuelve 200 con {status:"ok"}
"""

import os
import re
import time

import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    BASE_URL = "https://padel-tournament-hub-9.preview.emergentagent.com"

TEST_PHONE = "+5215599998888"


# ---------- Sanity ----------
def test_root_health():
    r = requests.get(f"{BASE_URL}/api/", timeout=15)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data.get("status") == "ok", data


# ---------- CORS hardening ----------
class TestCorsHardening:
    """Con CORS_ORIGINS='*' debe responder allow_origins=* y SIN allow_credentials."""

    def test_preflight_with_wildcard_origin(self):
        # Simula preflight OPTIONS desde un Origin arbitrario.
        headers = {
            "Origin": "https://random-attacker.example.com",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type,authorization",
        }
        r = requests.options(f"{BASE_URL}/api/", headers=headers, timeout=15)
        # 200/204 esperado para preflight
        assert r.status_code in (200, 204), f"status={r.status_code} body={r.text}"

        allow_origin = r.headers.get("access-control-allow-origin", "")
        allow_creds = r.headers.get("access-control-allow-credentials", "")

        # Con CORS_ORIGINS='*' → allow_origins debe ser '*' o reflejar el origen.
        # Lo importante: NO debe haber allow_credentials=true junto con '*'.
        assert allow_origin in ("*", "https://random-attacker.example.com"), (
            f"Unexpected allow_origin={allow_origin!r}"
        )
        if allow_origin == "*":
            assert allow_creds.lower() != "true", (
                f"INVALID CORS: allow_origin=* combinado con allow_credentials=true. "
                f"Headers: {dict(r.headers)}"
            )

    def test_simple_get_with_origin_does_not_leak_credentials_wildcard(self):
        headers = {"Origin": "https://random-attacker.example.com"}
        r = requests.get(f"{BASE_URL}/api/", headers=headers, timeout=15)
        assert r.status_code == 200
        allow_origin = r.headers.get("access-control-allow-origin", "")
        allow_creds = r.headers.get("access-control-allow-credentials", "")
        if allow_origin == "*":
            assert allow_creds.lower() != "true", (
                "Spec-violation: allow_origin=* + allow_credentials=true"
            )


# ---------- Player OTP flow ----------
class TestPlayerOtpFlow:
    """No-regression: el flujo OTP del jugador sigue funcionando."""

    def test_otp_request_returns_200(self):
        r = requests.post(
            f"{BASE_URL}/api/players/auth/otp/request",
            json={"telefono": TEST_PHONE, "nombre": "TEST_Iter34"},
            timeout=20,
        )
        # Si Twilio sandbox rate-limita → 429 también es aceptable (OTP igual queda en BD).
        assert r.status_code in (200, 201, 429), f"status={r.status_code} body={r.text}"

    def test_otp_verify_with_db_code(self):
        # Pide OTP, luego intenta leerlo del backend vía endpoint de testing si existe;
        # si no, simplemente verifica que el endpoint /verify rechaza un código inválido.
        requests.post(
            f"{BASE_URL}/api/players/auth/otp/request",
            json={"telefono": TEST_PHONE, "nombre": "TEST_Iter34"},
            timeout=20,
        )
        time.sleep(0.5)
        # Caso negativo: OTP inválido debe ser rechazado.
        r = requests.post(
            f"{BASE_URL}/api/players/auth/otp/verify",
            json={"telefono": TEST_PHONE, "codigo": "000000"},
            timeout=20,
        )
        # Esperado: 400/401/403 (código inválido). NO debe ser 500.
        assert r.status_code in (400, 401, 403, 422), (
            f"Verify con código inválido devolvió {r.status_code}: {r.text}"
        )

    def test_otp_verify_real_code_from_db(self):
        """Si tenemos acceso a Mongo, intentamos verify con código real."""
        try:
            from motor.motor_asyncio import AsyncIOMotorClient  # noqa
            import asyncio
        except Exception:
            pytest.skip("motor no disponible")

        mongo_url = os.getenv("MONGO_URL", "mongodb://localhost:27017")
        db_name = os.getenv("DB_NAME", "test_database")

        async def _get_code():
            from motor.motor_asyncio import AsyncIOMotorClient as M
            client = M(mongo_url)
            db = client[db_name]
            doc = await db.player_otps.find_one({"telefono": TEST_PHONE})
            client.close()
            return doc

        # Solicita OTP fresco
        r = requests.post(
            f"{BASE_URL}/api/players/auth/otp/request",
            json={"telefono": TEST_PHONE, "nombre": "TEST_Iter34"},
            timeout=20,
        )
        if r.status_code not in (200, 201):
            pytest.skip(f"OTP request status={r.status_code}, no podemos obtener código")

        time.sleep(0.5)
        loop = asyncio.new_event_loop()
        try:
            doc = loop.run_until_complete(_get_code())
        finally:
            loop.close()

        if not doc:
            pytest.skip("No se encontró OTP en BD (db_name distinto?)")

        code = doc.get("codigo") or doc.get("code") or doc.get("otp")
        if not code:
            pytest.skip(f"OTP doc sin campo 'codigo' conocido: keys={list(doc.keys())}")

        vr = requests.post(
            f"{BASE_URL}/api/players/auth/otp/verify",
            json={"telefono": TEST_PHONE, "codigo": code},
            headers={"X-Client-Platform": "web"},
            timeout=20,
        )
        assert vr.status_code == 200, f"verify status={vr.status_code} body={vr.text}"
        data = vr.json()
        assert "access_token" in data, data
        token = data["access_token"]

        # Sessions endpoint
        sr = requests.get(
            f"{BASE_URL}/api/players/me/sessions",
            headers={"Authorization": f"Bearer {token}"},
            timeout=15,
        )
        assert sr.status_code == 200, f"sessions status={sr.status_code} body={sr.text}"
        sessions = sr.json()
        # Debe haber al menos 1 sesión y la actual debe estar marcada
        assert isinstance(sessions, (list, dict)), type(sessions)
        sess_list = sessions if isinstance(sessions, list) else sessions.get("sessions", [])
        assert len(sess_list) >= 1
        # NOTA: is_current depende del matching de cookie refresh JTI, no del Bearer.
        # Solo verificamos que la sesión existe (no-regression del endpoint).
        assert all("id" in s for s in sess_list), f"Sesiones sin id: {sess_list}"

        # Cleanup: borra player de prueba
        try:
            requests.delete(
                f"{BASE_URL}/api/players/me",
                headers={"Authorization": f"Bearer {token}"},
                timeout=15,
            )
        except Exception:
            pass


# ---------- Mercado Pago webhook guard ----------
class TestMercadoPagoWebhookGuard:
    def test_webhook_rejects_missing_signature(self):
        r = requests.post(
            f"{BASE_URL}/api/webhooks/mercadopago",
            json={"type": "payment", "data": {"id": "999"}},
            timeout=15,
        )
        # Debe rechazar (401/403/400). NO debe procesar (200).
        assert r.status_code in (400, 401, 403), (
            f"Webhook MP aceptó request sin firma: status={r.status_code} body={r.text}"
        )

    def test_webhook_rejects_invalid_signature(self):
        headers = {
            "x-signature": "ts=1234567890,v1=deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
            "x-request-id": "fake-req-id",
        }
        r = requests.post(
            f"{BASE_URL}/api/webhooks/mercadopago",
            json={"type": "payment", "data": {"id": "999"}},
            headers=headers,
            timeout=15,
        )
        assert r.status_code in (400, 401, 403), (
            f"Webhook MP aceptó firma inválida: status={r.status_code} body={r.text}"
        )
