"""Iter55 — Player OTP with Twilio Sandbox awareness.

Covers:
- POST /api/players/auth/otp/request accepts multiple phone formats
- Response includes sandbox_mode:true, sandbox_join_code, sandbox_number when
  TWILIO_WHATSAPP_FROM is Sandbox +14155238886.
- 422 for invalid inputs.
- Verify flow regression: happy path + wrong code = 401.
- Inline unit assertions for core.validators._validate_phone.
"""
from __future__ import annotations

import os
import sys
import time

import pytest
import requests

# Make backend importable for validator direct testing
sys.path.insert(0, "/app/backend")

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL") or os.environ.get(
    "EXPO_BACKEND_URL"
)
if not BASE_URL:
    # Fallback to the frontend .env value (single source of truth)
    with open("/app/frontend/.env") as fh:
        for line in fh:
            if line.strip().startswith("EXPO_PUBLIC_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip().strip('"')
                break

BASE_URL = (BASE_URL or "").rstrip("/")
assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL missing"

OTP_REQUEST = f"{BASE_URL}/api/players/auth/otp/request"
OTP_VERIFY = f"{BASE_URL}/api/players/auth/otp/verify"


# ---------------------------------------------------------------
# Section A — Backend endpoint POST /api/players/auth/otp/request
# ---------------------------------------------------------------
@pytest.fixture
def api_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _post_otp(api_client, body):
    return api_client.post(OTP_REQUEST, json=body, timeout=20)


# Small helper to avoid tripping the 5/min rate limit across tests.
def _sleep():
    time.sleep(0.6)


class TestOtpRequestPhoneNormalization:
    """All valid phone formats must return 200 + sandbox metadata."""

    def test_phone_without_plus_10_digits(self, api_client):
        r = _post_otp(api_client, {"nombre": "TEST_A", "telefono": "5512345678"})
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("enviado_por_sms") is True
        assert data.get("sandbox_mode") is True
        assert data.get("sandbox_join_code") == "join busy-crack"
        assert data.get("sandbox_number") == "+14155238886"
        assert isinstance(data.get("mensaje"), str) and data["mensaje"]
        _sleep()

    def test_phone_with_separators(self, api_client):
        r = _post_otp(
            api_client, {"nombre": "TEST_B", "telefono": "(55) 1234-5678"}
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("enviado_por_sms") is True
        assert d.get("sandbox_mode") is True
        _sleep()

    def test_phone_with_plus_e164(self, api_client):
        r = _post_otp(
            api_client,
            {"nombre": "TEST_C", "telefono": "+525512345678"},
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("enviado_por_sms") is True
        assert d.get("sandbox_mode") is True
        assert d.get("sandbox_join_code") == "join busy-crack"
        assert d.get("sandbox_number") == "+14155238886"
        _sleep()


class TestOtpRequestValidation:
    """Pydantic validation errors → 422."""

    def test_invalid_phone_abc(self, api_client):
        r = _post_otp(api_client, {"nombre": "TEST_D", "telefono": "abc"})
        assert r.status_code == 422, r.text
        body = r.text
        # Error message should mention "10 dígitos" per validators.py
        assert "10 dígitos" in body or "10 d" in body, body
        _sleep()

    def test_name_too_short(self, api_client):
        r = _post_otp(api_client, {"nombre": "A", "telefono": "5512345678"})
        assert r.status_code == 422, r.text
        _sleep()


class TestOtpVerifyFlow:
    """Regression: verify endpoint still returns access_token + jugador_id."""

    def test_verify_happy_path_and_wrong_code(self, api_client):
        # 1. Request OTP with a fresh test phone
        phone = "+525599990001"
        rr = _post_otp(api_client, {"nombre": "TEST_Verify", "telefono": phone})
        assert rr.status_code == 200, rr.text
        _sleep()

        # 2. Fetch actual OTP code straight from Mongo (Twilio Sandbox delivery
        # is best-effort — we cannot receive the WhatsApp message from CI).
        import asyncio

        from core.db import db  # noqa: E402

        async def _fetch():
            return await db.player_otps.find_one({"telefono": phone}, {"_id": 0})

        rec = asyncio.get_event_loop().run_until_complete(_fetch())
        assert rec, "OTP no persistido en Mongo"
        codigo_real = rec["codigo"]

        # 3. Wrong code → 401
        wr = api_client.post(
            OTP_VERIFY,
            json={"telefono": phone, "codigo": "000000"},
            timeout=15,
        )
        assert wr.status_code == 401, wr.text

        # 4. Real code → 200 + access_token
        ok = api_client.post(
            OTP_VERIFY,
            json={"telefono": phone, "codigo": codigo_real},
            timeout=15,
        )
        assert ok.status_code == 200, ok.text
        d = ok.json()
        for key in ("access_token", "jugador_id", "nombre", "telefono"):
            assert d.get(key), f"missing {key} in {d}"
        assert d["telefono"] == phone


# ---------------------------------------------------------------
# Section B — core.validators._validate_phone unit assertions
# ---------------------------------------------------------------
class TestValidatePhoneUnit:
    def test_accepts_all_formats(self):
        from core.validators import _validate_phone

        assert _validate_phone("+5215512345678") == "+5215512345678"
        assert _validate_phone("5215512345678") == "+5215512345678"
        assert _validate_phone("5512345678") == "+525512345678"
        assert _validate_phone("(55) 1234-5678") == "+525512345678"
        assert _validate_phone("+52 (55) 1234 5678") == "+525512345678"

    def test_rejects_invalid(self):
        from core.validators import _validate_phone

        for bad in ("abc", "", "+1", "+", "123"):
            with pytest.raises(ValueError):
                _validate_phone(bad)
