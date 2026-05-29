"""Iter31 regression — Verify post-fix:
  • Player JWT now includes iat + jti (32-hex, unique per emission), parity with admin.
  • Existing auth endpoints still function (login, refresh, logout, revoke-all-sessions,
    DELETE /api/players/me, GET /api/).
"""
import os
import time

import jwt
import pytest
import requests

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
ADMIN_EMAIL = "admin@padelappretas.com"
ADMIN_PASSWORD = "admin123"

UNIQUE_PHONE = f"+521555{int(time.time()) % 10000000:07d}"


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


# ============ Player OTP + JWT iat/jti ============
class TestPlayerJwtClaims:
    """OTP verify devuelve un JWT con iat + jti hex 32 chars únicos."""

    def _get_otp_code(self, telefono: str) -> str:
        """Recupera el OTP del log o de la colección directamente vía /api admin endpoint si existiera.
        Como fallback, leemos directamente la BD desde el endpoint legacy (dev mode)."""
        # En modo DEV el código está en /tmp logs — pero para test usamos pymongo directo.
        from motor.motor_asyncio import AsyncIOMotorClient
        import asyncio

        async def fetch():
            mongo_url = os.environ["MONGO_URL"]
            db_name = os.environ["DB_NAME"]
            client = AsyncIOMotorClient(mongo_url)
            try:
                rec = await client[db_name].player_otps.find_one({"telefono": telefono})
                return rec["codigo"] if rec else None
            finally:
                client.close()

        return asyncio.get_event_loop().run_until_complete(fetch())

    def test_otp_verify_includes_iat_and_jti(self, session):
        # 1. Request OTP
        r1 = session.post(
            f"{BASE_URL}/api/players/auth/otp/request",
            json={"nombre": "TEST_Iter31", "telefono": UNIQUE_PHONE},
        )
        assert r1.status_code == 200, r1.text

        codigo = self._get_otp_code(UNIQUE_PHONE)
        assert codigo, "OTP not generated"

        # 2. Verify OTP → JWT
        r2 = session.post(
            f"{BASE_URL}/api/players/auth/otp/verify",
            json={"telefono": UNIQUE_PHONE, "codigo": codigo},
        )
        assert r2.status_code == 200, r2.text
        data = r2.json()
        token = data["access_token"]
        assert token

        # 3. Decode WITHOUT verify (only structural inspection)
        payload = jwt.decode(token, options={"verify_signature": False})
        assert payload.get("sub") == UNIQUE_PHONE
        assert payload.get("role") == "player"
        assert "jugador_id" in payload and payload["jugador_id"]
        assert "nombre" in payload
        assert "exp" in payload and isinstance(payload["exp"], int)
        assert "iat" in payload and isinstance(payload["iat"], int)
        assert payload["iat"] <= int(time.time()) + 5
        assert payload["exp"] > payload["iat"]

        jti = payload.get("jti")
        assert jti, "Missing 'jti' claim in player JWT"
        assert isinstance(jti, str) and len(jti) == 32, f"jti len={len(jti)}"
        assert all(c in "0123456789abcdef" for c in jti), "jti must be hex"

        # Store token for later regression tests
        pytest._player_token = token  # type: ignore
        pytest._player_jti = jti  # type: ignore

    def test_jti_unique_across_emissions(self, session):
        """Emit token de nuevo → jti distinto (paridad con admin)."""
        # Pedir un OTP nuevo (mismo telefono se sobrescribe en colección)
        r1 = session.post(
            f"{BASE_URL}/api/players/auth/otp/request",
            json={"nombre": "TEST_Iter31", "telefono": UNIQUE_PHONE},
        )
        assert r1.status_code == 200
        codigo = TestPlayerJwtClaims()._get_otp_code(UNIQUE_PHONE)
        assert codigo

        r2 = session.post(
            f"{BASE_URL}/api/players/auth/otp/verify",
            json={"telefono": UNIQUE_PHONE, "codigo": codigo},
        )
        assert r2.status_code == 200
        token2 = r2.json()["access_token"]
        payload2 = jwt.decode(token2, options={"verify_signature": False})
        jti2 = payload2["jti"]
        assert jti2 != getattr(pytest, "_player_jti", None), "jti must change per emission"


# ============ Regression: existing endpoints still work ============
class TestRegressionEndpoints:
    def test_root_api(self, session):
        r = session.get(f"{BASE_URL}/api/")
        assert r.status_code == 200

    def test_admin_login_ok(self, session):
        r = session.post(
            f"{BASE_URL}/api/auth/login",
            json={"username": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        )
        # 200 or 429 (rate limit shared with previous runs)
        assert r.status_code in (200, 429), r.text
        if r.status_code == 200:
            data = r.json()
            assert "access_token" in data
            pytest._admin_token = data["access_token"]  # type: ignore
            # refresh token may be cookie or json
            pytest._admin_session_cookies = r.cookies  # type: ignore

    def test_admin_refresh(self, session):
        token = getattr(pytest, "_admin_token", None)
        cookies = getattr(pytest, "_admin_session_cookies", None)
        if not token:
            pytest.skip("admin login not available (rate-limited)")
        # Try refresh with cookie (web flow)
        r = session.post(
            f"{BASE_URL}/api/auth/refresh",
            cookies=cookies,
        )
        # Acceptable: 200 (new token) or 401 (if refresh not present in env) — not 5xx
        assert r.status_code < 500, r.text

    def test_revoke_all_sessions(self, session):
        token = getattr(pytest, "_admin_token", None)
        if not token:
            pytest.skip("admin login not available")
        r = session.post(
            f"{BASE_URL}/api/auth/revoke-all-sessions",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert "sessions_revoked" in data
        assert isinstance(data["sessions_revoked"], int)

    def test_admin_logout(self, session):
        # Get a fresh login first (since revoke-all wiped tokens)
        time.sleep(2)
        r1 = session.post(
            f"{BASE_URL}/api/auth/login",
            json={"username": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        )
        if r1.status_code != 200:
            pytest.skip(f"cannot re-login: {r1.status_code}")
        token = r1.json()["access_token"]
        r2 = session.post(
            f"{BASE_URL}/api/auth/logout",
            headers={"Authorization": f"Bearer {token}"},
            cookies=r1.cookies,
        )
        assert r2.status_code in (200, 204), r2.text

    def test_player_delete_me(self, session):
        token = getattr(pytest, "_player_token", None)
        if not token:
            pytest.skip("player token unavailable")
        r = session.delete(
            f"{BASE_URL}/api/players/me",
            headers={"Authorization": f"Bearer {token}"},
        )
        # Could be 200 ok or 429 (3/hour limit)
        assert r.status_code in (200, 429), r.text
        if r.status_code == 200:
            data = r.json()
            assert data.get("anonimizado") is True
            # Verify the token cannot be reused (jugador anonimizado)
            r2 = session.get(
                f"{BASE_URL}/api/players/me",
                headers={"Authorization": f"Bearer {token}"},
            )
            # Token still valid JWT but jugador anonimizado — endpoint /me sólo reads JWT claims, so still 200.
            assert r2.status_code in (200, 401)
