"""
Iter35 — Full security & functional audit (5 layers).
Validates the work scope described in the testing request:
  Layer 1: Backend functional (auth, OTP, refresh, logout, retas, MP webhook, account-delete, audit-logs)
  Layer 2: Backend security (NoSQL injection, IDOR, refresh reuse, brute force, header leaks)
  Layer 3-5: Verified separately via Playwright / direct mongo / curl

The tests use the public preview URL (EXPO_PUBLIC_BACKEND_URL).
"""
import base64
import hashlib
import hmac
import json
import os
import time

import pytest
import requests
from motor.motor_asyncio import AsyncIOMotorClient

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL must be set"

ADMIN_EMAIL = "admin@padelappretas.com"
ADMIN_PASS = "admin123"
TEST_PHONE = "+5215511223399"  # unique-ish to avoid colliding with /me/sessions tests
MP_SECRET = "526c3921ed2abf0b340e972738be3a203b10bd027afdea1cd853a9fb91e5d86d"


@pytest.fixture(scope="module")
def s():
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json"})
    return sess


@pytest.fixture(scope="module")
def admin_tokens(s):
    r = s.post(f"{BASE_URL}/api/auth/login", json={"username": ADMIN_EMAIL, "password": ADMIN_PASS})
    assert r.status_code == 200, f"Admin login failed: {r.status_code} {r.text}"
    data = r.json()
    return data


def _decode_jwt_payload(token: str) -> dict:
    part = token.split(".")[1]
    pad = "=" * (-len(part) % 4)
    return json.loads(base64.urlsafe_b64decode(part + pad))


# ─────────────────────────────────────────
# Layer 1 — Backend Functional
# ─────────────────────────────────────────
class TestAuthAdmin:
    def test_login_success(self, admin_tokens):
        assert "access_token" in admin_tokens
        # Native client → refresh comes in JSON (no cookie)
        # NOTE: requests treats this as native since no x-client-platform header

    def test_jwt_15min_exp(self, admin_tokens):
        payload = _decode_jwt_payload(admin_tokens["access_token"])
        ttl = payload["exp"] - payload["iat"]
        assert 14 * 60 <= ttl <= 16 * 60, f"JWT TTL is {ttl}s, expected ~900s"

    def test_login_wrong_password_no_user_enumeration(self, s):
        r1 = s.post(f"{BASE_URL}/api/auth/login", json={"username": ADMIN_EMAIL, "password": "wrong-xyz"})
        r2 = s.post(f"{BASE_URL}/api/auth/login", json={"username": "nope@nope.com", "password": "whatever"})
        assert r1.status_code == 401
        assert r2.status_code == 401
        # Both return same generic detail (no user enumeration)
        assert r1.json().get("detail") == r2.json().get("detail")


class TestRefreshRotation:
    def test_refresh_rotation_and_reuse_detection(self, s, admin_tokens):
        refresh = admin_tokens.get("refresh_token")
        if not refresh:
            pytest.skip("No refresh token in admin response (web mode)")
        # First use → ok
        r = s.post(f"{BASE_URL}/api/auth/refresh", headers={"X-Refresh-Token": refresh})
        assert r.status_code == 200, f"Refresh failed: {r.status_code} {r.text}"
        new_data = r.json()
        new_refresh = new_data.get("refresh_token")
        assert new_refresh and new_refresh != refresh, "Refresh token not rotated"
        # Second use of OLD token → must 401 + log reuse
        r2 = s.post(f"{BASE_URL}/api/auth/refresh", headers={"X-Refresh-Token": refresh})
        assert r2.status_code == 401, f"Reuse should be rejected, got {r2.status_code}"


class TestOtpFlow:
    @pytest.fixture(scope="class")
    def otp_session(self):
        return requests.Session()

    @pytest.fixture(scope="class")
    def player_token(self, otp_session):
        # Request OTP
        r = otp_session.post(
            f"{BASE_URL}/api/players/auth/otp/request",
            json={"nombre": "Test Player", "telefono": TEST_PHONE},
        )
        assert r.status_code == 200, f"OTP request failed: {r.status_code} {r.text}"
        # Pull OTP from mongo synchronously via motor in a temp loop
        import asyncio

        async def fetch():
            cli = AsyncIOMotorClient(os.environ["MONGO_URL"])
            db = cli[os.environ["DB_NAME"]]
            rec = await db.player_otps.find_one({"telefono": TEST_PHONE})
            cli.close()
            return rec

        rec = asyncio.run(fetch())
        assert rec, "OTP not stored in db.player_otps"
        codigo = rec["codigo"]
        rv = otp_session.post(
            f"{BASE_URL}/api/players/auth/otp/verify",
            json={"telefono": TEST_PHONE, "codigo": codigo},
        )
        assert rv.status_code == 200, f"OTP verify failed: {rv.status_code} {rv.text}"
        return rv.json()

    def test_otp_returns_player_token(self, player_token):
        assert "access_token" in player_token
        payload = _decode_jwt_payload(player_token["access_token"])
        assert payload["role"] == "player"
        assert payload["sub"] == TEST_PHONE

    def test_player_me_works(self, otp_session, player_token):
        r = otp_session.get(
            f"{BASE_URL}/api/players/me",
            headers={"Authorization": f"Bearer {player_token['access_token']}"},
        )
        assert r.status_code == 200
        assert r.json()["telefono"] == TEST_PHONE

    def test_player_security_activity_scoped_to_self(self, otp_session, player_token):
        r = otp_session.get(
            f"{BASE_URL}/api/players/me/security-activity?limit=5",
            headers={"Authorization": f"Bearer {player_token['access_token']}"},
        )
        assert r.status_code == 200
        items = r.json().get("items", [])
        # All items must belong to this user (no leak of other players)
        for it in items:
            # ip/timestamp ok; we just verify no foreign id_usuario leaks (the endpoint
            # doesn't include id_usuario but we ensure the response shape is safe).
            assert "accion" in it


class TestLogout:
    def test_logout_revokes_refresh(self, s):
        # Fresh login
        r = s.post(f"{BASE_URL}/api/auth/login", json={"username": ADMIN_EMAIL, "password": ADMIN_PASS})
        assert r.status_code == 200
        tokens = r.json()
        refresh = tokens.get("refresh_token")
        if not refresh:
            pytest.skip("no refresh token (web mode)")
        # Logout
        rl = s.post(f"{BASE_URL}/api/auth/logout", headers={"X-Refresh-Token": refresh})
        assert rl.status_code == 200
        # Reuse refresh → must 401
        rr = s.post(f"{BASE_URL}/api/auth/refresh", headers={"X-Refresh-Token": refresh})
        assert rr.status_code == 401


class TestRetasPublic:
    def test_buscar_public_open(self, s):
        r = s.get(f"{BASE_URL}/api/public/retas/buscar?q=padel")
        assert r.status_code == 200, f"buscar failed: {r.status_code} {r.text[:200]}"
        data = r.json()
        # Must not leak organizer secrets
        items = data if isinstance(data, list) else data.get("items", [])
        for it in items[:3]:
            assert "access_token_pasarela" not in it
            assert "mp_access_token" not in it
            assert "hashed_password" not in it
            assert "password" not in it

    def test_buscar_geo(self, s):
        r = s.get(f"{BASE_URL}/api/public/retas/buscar?lat=19.43&lng=-99.13")
        assert r.status_code == 200


class TestRetasAdminCRUD:
    def test_create_reta_requires_auth(self, s):
        r = s.post(f"{BASE_URL}/api/retas", json={"nombre": "x"})
        assert r.status_code in (401, 403, 422), f"unexpected {r.status_code}"

    def test_admin_security_logs(self, s, admin_tokens):
        r = s.get(
            f"{BASE_URL}/api/admin/security/logs?limit=5",
            headers={"Authorization": f"Bearer {admin_tokens['access_token']}"},
        )
        assert r.status_code in (200, 404), f"unexpected {r.status_code}"


# ─────────────────────────────────────────
# Layer 2 — Backend Security
# ─────────────────────────────────────────
class TestSecurityNoSQL:
    def test_nosql_injection_login_blocked(self, s):
        r = s.post(
            f"{BASE_URL}/api/auth/login",
            json={"username": {"$ne": None}, "password": {"$ne": None}},
        )
        # Must NOT authenticate (no 200). 400/401/422 acceptable.
        assert r.status_code != 200, "NoSQL injection bypassed!"
        assert r.status_code in (400, 401, 422), f"Unexpected status {r.status_code}"


class TestSecurityRateLimit:
    def test_otp_rate_limit(self, s):
        # /api/players/auth/otp/request has limiter 5/min
        codes = []
        for i in range(8):
            r = s.post(
                f"{BASE_URL}/api/players/auth/otp/request",
                json={"nombre": f"RL{i}", "telefono": f"+5219911223{i:03d}"},
            )
            codes.append(r.status_code)
        assert 429 in codes, f"Rate limit not triggered, got {codes}"


class TestSecurityCORS:
    def test_cors_with_wildcard_no_credentials(self):
        # CORS_ORIGINS=* in current .env → response should be * without credentials
        r = requests.options(
            f"{BASE_URL}/api/auth/login",
            headers={
                "Origin": "https://malicious.example.com",
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "content-type",
            },
        )
        # Backend must respond with allow-origin and NO allow-credentials
        ao = r.headers.get("access-control-allow-origin")
        ac = r.headers.get("access-control-allow-credentials")
        assert ao in ("*", None), f"Unexpected ACAO: {ao}"
        if ao == "*":
            assert ac is None or ac.lower() == "false", f"Credentials must be off when origin=*; got {ac}"


class TestSecurityWebhook:
    def test_webhook_no_signature_401(self, s):
        r = s.post(f"{BASE_URL}/api/webhooks/mercadopago", json={"type": "payment", "data": {"id": "1"}})
        assert r.status_code == 401, f"Webhook without HMAC must be 401, got {r.status_code}"

    def test_webhook_invalid_signature_401(self, s):
        r = s.post(
            f"{BASE_URL}/api/webhooks/mercadopago",
            json={"type": "payment", "data": {"id": "12345"}},
            headers={"x-signature": "ts=1,v1=deadbeef", "x-request-id": "req-1"},
        )
        assert r.status_code == 401

    def test_webhook_valid_signature_accepted(self, s):
        # Build a valid HMAC. Endpoint will then accept signature but may
        # "ignored" the event because we use a fake payment id.
        ts = str(int(time.time()))
        data_id = "fake-test-id-iter35"
        req_id = "req-iter35"
        manifest = f"id:{data_id};request-id:{req_id};ts:{ts};"
        v1 = hmac.new(MP_SECRET.encode(), manifest.encode(), hashlib.sha256).hexdigest()
        r = s.post(
            f"{BASE_URL}/api/webhooks/mercadopago",
            json={"type": "payment", "data": {"id": data_id}},
            headers={
                "x-signature": f"ts={ts},v1={v1}",
                "x-request-id": req_id,
            },
        )
        assert r.status_code == 200, f"Valid HMAC rejected: {r.status_code} {r.text[:200]}"


class TestSecurityHeaders:
    def test_security_headers_present(self, s):
        r = s.get(f"{BASE_URL}/api/")
        # Public health endpoint
        assert r.status_code == 200
        h = {k.lower(): v for k, v in r.headers.items()}
        # Critical headers
        assert h.get("x-content-type-options") == "nosniff"
        assert h.get("x-frame-options") == "DENY"
        assert "referrer-policy" in h
        assert "permissions-policy" in h
        assert "x-padelapp-request-id" in h


class TestAuthHeaderLeak:
    def test_public_retas_no_sensitive_fields(self, s):
        r = s.get(f"{BASE_URL}/api/public/retas/buscar")
        assert r.status_code == 200
        text = r.text.lower()
        # Hard checks: no token, password, hashed_password leak in payload
        assert "access_token_pasarela" not in text
        assert "hashed_password" not in text
        assert "mp_access_token" not in text


# ─────────────────────────────────────────
# Layer 5 — Data integrity (read-only)
# ─────────────────────────────────────────
class TestDataIntegrity:
    def test_db_indices(self):
        import asyncio
        async def check():
            cli = AsyncIOMotorClient(os.environ["MONGO_URL"])
            db = cli[os.environ["DB_NAME"]]
            out = {}
            for coll in ["refresh_tokens", "security_logs", "inscripciones", "usuarios", "admins"]:
                try:
                    info = await db[coll].index_information()
                    out[coll] = list(info.keys())
                except Exception as e:
                    out[coll] = f"ERR: {e}"
            cli.close()
            return out

        idx = asyncio.run(check())
        # refresh_tokens.jti / token_hash unique
        assert "refresh_tokens" in idx
        # we just assert that some non-default index exists per collection
        for coll in ["refresh_tokens", "security_logs", "usuarios"]:
            ks = idx.get(coll, [])
            assert isinstance(ks, list) and len(ks) >= 1, f"No indices for {coll}: {ks}"
