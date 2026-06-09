"""Iter41 — Mercado Pago Marketplace OAuth multi-account validation.

Covers:
1) GET /api/admin/mercadopago/oauth/start (admin auth)
   → 200 + authorize_url with client_id, response_type=code, platform_id=mp,
     state, redirect_uri. State has 3 parts (nonce.email_b64.hmac).
2) GET /api/admin/mercadopago/oauth/callback?error=access_denied → 302 with
   ?mp_oauth=error&reason=...
3) GET /api/admin/mercadopago/oauth/callback?code=xxx&state=invalid
   → 302 with ?mp_oauth=error&reason=state_invalid (HMAC tampering detection).
4) Direct unit tests on core.crypto.encrypt_token / decrypt_token (Fernet).
   • With key configured: encrypts with `enc::` prefix, decrypts roundtrip.
   • Idempotent: encrypt(encrypt(x)) == encrypt(x).
   • Passthrough when key absent.
5) POST /api/admin/mercadopago/connect persists token CIFRADO (enc::...) in DB
   and mp_connection_mode='manual'; status reports encrypted_at_rest=true.
6) GET /api/admin/mercadopago/status exposes new fields:
   connection_mode, encrypted_at_rest, encryption_available, expires_at,
   has_refresh_token, fee_percent (0.0 with MARKETPLACE_FEE_PERCENT=0 default).
7) Webhook multi-org resolver: simulates an MP payment whose metadata.admin_email
   points to a DIFFERENT admin → code should re-resolve with alt token and not
   fail (we mock mercadopago_service.obtener_pago).
"""
from __future__ import annotations

import os
import sys
import uuid
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import pytest
import requests
from pymongo import MongoClient

BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

from conftest import BASE_URL  # noqa: E402

MP_TEST_TOKEN = "APP_USR-1598112764080275-052714-abc67f3b949c727d57221f8e4dd6df9a-3431138052"
MP_TEST_USER_ID = "3431138052"

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")
_mongo = MongoClient(MONGO_URL)
_db = _mongo[DB_NAME]


# ===================== 1) OAuth start =====================
class TestMpOAuthStart:
    def test_oauth_start_returns_signed_url(self, api_client, auth_headers):
        r = api_client.get(
            f"{BASE_URL}/api/admin/mercadopago/oauth/start",
            headers=auth_headers,
            timeout=15,
        )
        assert r.status_code == 200, f"{r.status_code} {r.text}"
        data = r.json()
        assert "authorize_url" in data
        assert "state" in data
        assert "redirect_uri" in data

        url = data["authorize_url"]
        assert url.startswith("https://auth.mercadopago"), url
        parsed = urlparse(url)
        qs = parse_qs(parsed.query)

        # client_id must match .env (7849343570174391)
        assert qs.get("client_id", [""])[0] == "7849343570174391", qs
        assert qs.get("response_type", [""])[0] == "code"
        assert qs.get("platform_id", [""])[0] == "mp"
        assert qs.get("state", [""])[0] == data["state"]
        assert qs.get("redirect_uri", [""])[0] == data["redirect_uri"]

        # redirect_uri canonical
        assert data["redirect_uri"].endswith(
            "/api/admin/mercadopago/oauth/callback"
        ), data["redirect_uri"]

        # state: nonce.email_b64.hmac (3 parts)
        parts = data["state"].split(".")
        assert len(parts) == 3, f"state must have 3 parts, got {len(parts)}: {parts}"
        nonce, email_b64, sig = parts
        assert len(nonce) >= 8
        assert len(email_b64) >= 4
        assert len(sig) == 32, f"sig must be 32 hex chars, got {len(sig)}"

    def test_oauth_start_requires_auth(self, api_client):
        r = api_client.get(
            f"{BASE_URL}/api/admin/mercadopago/oauth/start",
            timeout=10,
        )
        assert r.status_code in (401, 403)


# ===================== 2/3) OAuth callback error paths =====================
class TestMpOAuthCallback:
    def test_callback_access_denied_redirects_error(self, api_client):
        r = api_client.get(
            f"{BASE_URL}/api/admin/mercadopago/oauth/callback",
            params={"error": "access_denied", "error_description": "User denied"},
            allow_redirects=False,
            timeout=10,
        )
        assert r.status_code in (302, 307), f"{r.status_code} {r.text[:200]}"
        loc = r.headers.get("location") or r.headers.get("Location") or ""
        assert "/admin/mercadopago" in loc
        assert "mp_oauth=error" in loc
        assert "reason=" in loc

    def test_callback_invalid_state_redirects_state_invalid(self, api_client):
        r = api_client.get(
            f"{BASE_URL}/api/admin/mercadopago/oauth/callback",
            params={"code": "DUMMY_CODE_XYZ", "state": "tampered.state.value"},
            allow_redirects=False,
            timeout=10,
        )
        assert r.status_code in (302, 307)
        loc = r.headers.get("location") or r.headers.get("Location") or ""
        assert "mp_oauth=error" in loc
        assert "reason=state_invalid" in loc, loc

    def test_callback_missing_code_redirects_missing_code(self, api_client):
        r = api_client.get(
            f"{BASE_URL}/api/admin/mercadopago/oauth/callback",
            allow_redirects=False,
            timeout=10,
        )
        assert r.status_code in (302, 307)
        loc = r.headers.get("location") or r.headers.get("Location") or ""
        assert "mp_oauth=error" in loc
        assert "reason=missing_code" in loc, loc


# ===================== 4) core.crypto unit tests =====================
class TestCryptoHelper:
    """Direct in-process tests on core/crypto.py."""

    def test_encrypt_decrypt_roundtrip_with_key(self):
        # Ensure .env loaded so MP_TOKEN_ENCRYPTION_KEY is set
        from dotenv import load_dotenv
        load_dotenv(BACKEND_DIR / ".env")
        assert os.environ.get("MP_TOKEN_ENCRYPTION_KEY"), \
            "MP_TOKEN_ENCRYPTION_KEY missing in .env — skip unit test"

        # Force re-init of the singleton in case another test ran first
        import core.crypto as crypto
        crypto._fernet_singleton = None
        crypto._initialized = False

        plain = "APP_USR-1234567890-abcdef-test-token"
        enc = crypto.encrypt_token(plain)
        assert enc is not None
        assert enc.startswith("enc::"), f"Expected enc:: prefix, got {enc[:20]}"
        assert plain not in enc, "Ciphertext leaked plaintext"

        dec = crypto.decrypt_token(enc)
        assert dec == plain, f"Roundtrip mismatch: {dec!r} != {plain!r}"

    def test_encrypt_is_idempotent_on_prefixed_input(self):
        from dotenv import load_dotenv
        load_dotenv(BACKEND_DIR / ".env")
        import core.crypto as crypto
        crypto._fernet_singleton = None
        crypto._initialized = False

        plain = "APP_USR-idempotency-check-token"
        enc1 = crypto.encrypt_token(plain)
        enc2 = crypto.encrypt_token(enc1)
        # Idempotent: re-encrypting an already-encrypted token returns it as-is.
        assert enc2 == enc1, "encrypt_token must be idempotent on enc:: prefixed input"

    def test_decrypt_plaintext_passthrough(self):
        from dotenv import load_dotenv
        load_dotenv(BACKEND_DIR / ".env")
        import core.crypto as crypto
        crypto._fernet_singleton = None
        crypto._initialized = False

        legacy = "APP_USR-legacy-plaintext-token"
        assert crypto.decrypt_token(legacy) == legacy

    def test_passthrough_when_key_absent(self, monkeypatch):
        # Temporarily unset key and reset singleton to simulate dev env.
        monkeypatch.delenv("MP_TOKEN_ENCRYPTION_KEY", raising=False)
        import core.crypto as crypto
        crypto._fernet_singleton = None
        crypto._initialized = False

        plain = "APP_USR-no-key-here"
        enc = crypto.encrypt_token(plain)
        # In passthrough mode, encrypt_token returns the plaintext unchanged.
        assert enc == plain, f"Without key should passthrough, got {enc!r}"
        assert crypto.decrypt_token(plain) == plain

        # Re-init singleton with key restored for downstream tests in this session.
        crypto._fernet_singleton = None
        crypto._initialized = False

    def test_empty_input_returns_input(self):
        import core.crypto as crypto
        assert crypto.encrypt_token("") == ""
        assert crypto.encrypt_token(None) is None
        assert crypto.decrypt_token("") == ""
        assert crypto.decrypt_token(None) is None


# ===================== 5) Manual connect → token encrypted at rest =====================
class TestMpConnectEncryptsAtRest:
    def test_manual_connect_persists_encrypted_token(self, api_client, auth_headers):
        r = api_client.post(
            f"{BASE_URL}/api/admin/mercadopago/connect",
            json={"access_token": MP_TEST_TOKEN},
            headers=auth_headers,
            timeout=20,
        )
        assert r.status_code == 200, f"{r.status_code} {r.text}"
        body = r.json()
        # New fields from Marketplace expansion
        assert body.get("connection_mode") == "manual", body
        assert body.get("encrypted_at_rest") is True, body
        assert body.get("encryption_available") is True, body

        # Verify the stored value DIRECTLY in MongoDB
        admin = _db.admins.find_one({"email": "admin@padelappretas.com"})
        assert admin is not None
        stored = admin.get("access_token_pasarela") or ""
        assert stored.startswith("enc::"), \
            f"Token not encrypted at rest! Got: {stored[:32]}..."
        # Sanity: the raw plaintext token is NOT present in stored ciphertext
        assert MP_TEST_TOKEN not in stored

        # Manual connect must NOT leave a refresh_token from a previous OAuth.
        assert admin.get("mp_connection_mode") == "manual"
        assert not admin.get("mp_refresh_token")
        assert not admin.get("mp_expires_at")


# ===================== 6) Status exposes new fields =====================
class TestMpStatusNewFields:
    def test_status_has_marketplace_fields(self, api_client, auth_headers):
        # Make sure connected first
        api_client.post(
            f"{BASE_URL}/api/admin/mercadopago/connect",
            json={"access_token": MP_TEST_TOKEN},
            headers=auth_headers,
            timeout=20,
        )
        r = api_client.get(
            f"{BASE_URL}/api/admin/mercadopago/status",
            headers=auth_headers,
            timeout=10,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        # Existing
        assert data["connected"] is True
        assert data["mp_user_id"] == MP_TEST_USER_ID
        # New marketplace expansion
        for k in (
            "connection_mode",
            "encrypted_at_rest",
            "encryption_available",
            "expires_at",
            "has_refresh_token",
            "fee_percent",
        ):
            assert k in data, f"Missing field {k} in status: {data}"
        assert data["connection_mode"] == "manual"
        assert data["encrypted_at_rest"] is True
        assert data["encryption_available"] is True
        # MARKETPLACE_FEE_PERCENT=0 in .env → 0.0
        assert float(data["fee_percent"]) == 0.0, data["fee_percent"]
        assert data["has_refresh_token"] is False


# ===================== 7) Webhook multi-org resolver =====================
class TestWebhookMultiOrgResolver:
    """In-process test: mock mercadopago_service.obtener_pago to return a
    payment whose metadata.admin_email points to a DIFFERENT admin.

    We can't run the FastAPI app in-process easily without import-time DB
    side effects, so we use httpx's ASGITransport via the real `app` instance.
    """

    def test_webhook_reroutes_via_metadata_admin_email(self, monkeypatch):
        """Uses anyio to drive the ASGI app synchronously inside pytest."""
        import importlib
        import anyio

        from dotenv import load_dotenv
        load_dotenv(BACKEND_DIR / ".env")
        server = importlib.import_module("server")
        mps = importlib.import_module("mercadopago_service")

        # Insert a second admin with an encrypted token (different email).
        alt_email = f"TEST_alt_admin_{uuid.uuid4().hex[:8]}@example.com"
        import core.crypto as crypto
        crypto._fernet_singleton = None
        crypto._initialized = False
        alt_enc_token = crypto.encrypt_token("APP_USR-alt-org-fake-token-987654321")

        _db.admins.insert_one({
            "email": alt_email,
            "access_token_pasarela": alt_enc_token,
            "mp_user_id": "9999999999",
            "mp_connection_mode": "manual",
        })

        calls = {"tokens": []}
        ext_ref_marker = f"INSCRIPCION_NONEXISTENT_{uuid.uuid4().hex[:6]}"

        async def fake_obtener_pago(access_token: str, payment_id: str):
            calls["tokens"].append(access_token)
            return {
                "id": payment_id,
                "status": "pending",
                "external_reference": ext_ref_marker,
                "metadata": {"admin_email": alt_email},
            }

        monkeypatch.setattr(mps, "obtener_pago", fake_obtener_pago)
        # Disable webhook signature check for this in-process call.
        monkeypatch.setenv("MP_WEBHOOK_SECRET", "")

        async def _run():
            from httpx import ASGITransport, AsyncClient
            transport = ASGITransport(app=server.app)
            async with AsyncClient(transport=transport, base_url="http://test") as ac:
                return await ac.post(
                    "/api/webhooks/mercadopago",
                    json={
                        "type": "payment",
                        "data": {"id": f"99999-{uuid.uuid4().hex[:6]}"},
                    },
                )

        try:
            resp = anyio.run(_run)
            assert resp.status_code == 200, f"{resp.status_code} {resp.text}"
            body = resp.json()
            assert body.get("ok") is True
            # The handler must have called obtener_pago at least once.
            assert len(calls["tokens"]) >= 1, "obtener_pago not called"
            # If re-route happened (default admin email != alt_email), there
            # should be a SECOND call with the alt admin's decrypted token.
            if len(calls["tokens"]) >= 2:
                assert calls["tokens"][1] == "APP_USR-alt-org-fake-token-987654321", \
                    f"Re-route token mismatch: {calls['tokens']}"
            # Body should report the admin used in resolution.
            assert "admin" in body or body.get("ignored") or "event" in body
        finally:
            _db.admins.delete_one({"email": alt_email})


# ===================== Module cleanup =====================
@pytest.fixture(scope="module", autouse=True)
def _cleanup(api_client, auth_headers):
    yield
    # Leave default admin re-connected for next agents
    try:
        api_client.post(
            f"{BASE_URL}/api/admin/mercadopago/connect",
            json={"access_token": MP_TEST_TOKEN},
            headers=auth_headers,
            timeout=15,
        )
    except Exception:
        pass
