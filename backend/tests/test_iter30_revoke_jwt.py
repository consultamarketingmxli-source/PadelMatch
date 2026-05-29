"""
Iter30 — Validación E2E:
  • POST /api/auth/revoke-all-sessions (admin + player)
  • JWT iat/jti claims
  • h11 LocalProtocolError NO debe aumentar tras requests variadas
  • Rate limit sigue activo aunque SlowAPIMiddleware fue removido
  • Security headers en TODAS las responses
  • NoSQL injection sigue bloqueada
"""
import asyncio
import os
import time
import uuid
from pathlib import Path

import jwt
import pytest
import requests
from dotenv import load_dotenv

load_dotenv(Path("/app/backend/.env"))
load_dotenv(Path("/app/frontend/.env"))

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
ADMIN_EMAIL = "admin@padelappretas.com"
ADMIN_PASSWORD = "admin123"
JWT_SECRET = os.environ["JWT_SECRET"]


@pytest.fixture
def s():
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json"})
    return sess


def _login_admin(s, platform="native"):
    r = s.post(
        f"{BASE_URL}/api/auth/login",
        json={"username": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        headers={"X-Client-Platform": platform},
    )
    if r.status_code == 429:
        time.sleep(65)
        r = s.post(
            f"{BASE_URL}/api/auth/login",
            json={"username": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
            headers={"X-Client-Platform": platform},
        )
    assert r.status_code == 200, r.text
    return r


# ──────────────────────────────────────────────────────────────────
# JWT iat + jti
# ──────────────────────────────────────────────────────────────────
class TestJwtClaims:
    def test_access_token_has_iat_and_jti(self, s):
        d = _login_admin(s).json()
        token = d["access_token"]
        payload = jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
        assert "sub" in payload and payload["sub"] == ADMIN_EMAIL
        assert payload.get("role") == "admin"
        assert "exp" in payload
        assert "iat" in payload, f"Falta claim 'iat': {payload}"
        assert "jti" in payload, f"Falta claim 'jti': {payload}"
        assert isinstance(payload["jti"], str)
        assert len(payload["jti"]) == 32, f"jti len={len(payload['jti'])} (esperado 32 hex)"
        # iat <= now
        assert payload["iat"] <= int(time.time()) + 2

    def test_consecutive_tokens_differ_by_jti(self, s):
        d1 = _login_admin(s).json()
        time.sleep(0.05)
        d2 = _login_admin(s).json()
        p1 = jwt.decode(d1["access_token"], JWT_SECRET, algorithms=["HS256"])
        p2 = jwt.decode(d2["access_token"], JWT_SECRET, algorithms=["HS256"])
        assert p1["jti"] != p2["jti"], "jti debe ser único por emisión"


# ──────────────────────────────────────────────────────────────────
# POST /api/auth/revoke-all-sessions
# ──────────────────────────────────────────────────────────────────
class TestRevokeAllSessions:
    def test_missing_token_401(self, s):
        r = s.post(f"{BASE_URL}/api/auth/revoke-all-sessions")
        assert r.status_code == 401
        assert "Missing token" in r.text or "missing" in r.text.lower()

    def test_invalid_token_401(self, s):
        r = s.post(
            f"{BASE_URL}/api/auth/revoke-all-sessions",
            headers={"Authorization": "Bearer not.a.jwt"},
        )
        assert r.status_code == 401

    def test_admin_revoke_all_sessions(self, s):
        # Crear 2 sesiones distintas y verificar que ambas se revocan
        sess1 = requests.Session()
        sess1.headers.update({"Content-Type": "application/json"})
        sess2 = requests.Session()
        sess2.headers.update({"Content-Type": "application/json"})

        d1 = _login_admin(sess1).json()
        time.sleep(1)
        d2 = _login_admin(sess2).json()
        access_token = d2["access_token"]
        refresh_1 = d1["refresh_token"]
        refresh_2 = d2["refresh_token"]

        r = s.post(
            f"{BASE_URL}/api/auth/revoke-all-sessions",
            headers={"Authorization": f"Bearer {access_token}"},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("ok") is True
        assert body.get("sessions_revoked", 0) >= 2, f"Esperaba >=2 revocados: {body}"

        # Verificar que ambos refresh tokens fallan ahora
        r1 = sess1.post(
            f"{BASE_URL}/api/auth/refresh",
            headers={"X-Refresh-Token": refresh_1, "X-Client-Platform": "native"},
        )
        assert r1.status_code == 401, f"refresh_1 debería fallar: {r1.status_code}"
        r2 = sess2.post(
            f"{BASE_URL}/api/auth/refresh",
            headers={"X-Refresh-Token": refresh_2, "X-Client-Platform": "native"},
        )
        assert r2.status_code == 401, f"refresh_2 debería fallar: {r2.status_code}"

    def test_security_log_for_revoke_all(self, s):
        """Verifica que se escribe security_log con accion=revoke_all_sessions."""
        from motor.motor_asyncio import AsyncIOMotorClient

        d = _login_admin(s).json()
        token = d["access_token"]
        r = s.post(
            f"{BASE_URL}/api/auth/revoke-all-sessions",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r.status_code == 200
        revoked = r.json().get("sessions_revoked", 0)

        # Sleep para dar tiempo a la escritura asíncrona del log
        time.sleep(0.5)

        mongo_url = os.environ["MONGO_URL"]
        db_name = os.environ["DB_NAME"]

        async def _query():
            client = AsyncIOMotorClient(mongo_url)
            try:
                doc = await client[db_name].security_logs.find_one(
                    {"accion": "revoke_all_sessions", "id_usuario": ADMIN_EMAIL},
                    sort=[("timestamp", -1)],
                )
                return doc
            finally:
                client.close()

        doc = asyncio.run(_query())
        assert doc is not None, "No se encontró security_log con accion=revoke_all_sessions"
        assert doc.get("result") == "success"
        extra = doc.get("extra", {}) or {}
        assert extra.get("role") == "admin"
        assert extra.get("tokens_revoked", 0) == revoked

    def test_player_revoke_all_sessions(self, s):
        """Player JWT (telefono) también puede usar revoke-all-sessions."""
        from motor.motor_asyncio import AsyncIOMotorClient

        # 1) Solicitar OTP
        phone = f"+5219977{int(time.time()) % 100000:05d}"
        r = s.post(
            f"{BASE_URL}/api/players/auth/otp/request",
            json={"nombre": "TEST_RevokePlayer", "telefono": phone},
        )
        if r.status_code == 429:
            pytest.skip("Rate-limited en OTP request")
        assert r.status_code == 200, r.text

        mongo_url = os.environ["MONGO_URL"]
        db_name = os.environ["DB_NAME"]

        async def _get_otp():
            client = AsyncIOMotorClient(mongo_url)
            try:
                return await client[db_name].player_otps.find_one({"telefono": phone})
            finally:
                client.close()

        doc = asyncio.run(_get_otp())
        assert doc, "OTP no encontrado en Mongo"
        codigo = doc["codigo"]

        # 2) Verify → access + refresh (native)
        rv = s.post(
            f"{BASE_URL}/api/players/auth/otp/verify",
            json={"telefono": phone, "codigo": codigo},
            headers={"X-Client-Platform": "native"},
        )
        assert rv.status_code == 200, rv.text
        data = rv.json()
        access_token = data["access_token"]
        refresh_token = data.get("refresh_token")
        assert refresh_token, "Player native debe traer refresh_token"

        # 3) Revoke-all-sessions con el access player
        r = s.post(
            f"{BASE_URL}/api/auth/revoke-all-sessions",
            headers={"Authorization": f"Bearer {access_token}"},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("ok") is True
        assert body.get("sessions_revoked", 0) >= 1

        # 4) Refresh debe fallar
        r2 = s.post(
            f"{BASE_URL}/api/auth/refresh",
            headers={"X-Refresh-Token": refresh_token, "X-Client-Platform": "native"},
        )
        assert r2.status_code == 401, f"player refresh post-revoke debe fallar: {r2.status_code}"


# ──────────────────────────────────────────────────────────────────
# h11 LocalProtocolError — no debe aumentar
# ──────────────────────────────────────────────────────────────────
class TestH11NoNewErrors:
    H11_LOG_PATH = "/var/log/supervisor/backend.err.log"

    def _count_h11(self):
        try:
            with open(self.H11_LOG_PATH, "r") as f:
                return sum(1 for line in f if "Too much data for declared Content-Length" in line)
        except Exception:
            return -1

    def test_no_new_h11_after_30_varied_requests(self, s):
        before = self._count_h11()
        if before < 0:
            pytest.skip("No se puede leer backend.err.log")

        # 30 requests variadas
        for i in range(5):
            s.post(
                f"{BASE_URL}/api/auth/login",
                json={"username": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
            )
        # Login fail
        for i in range(3):
            s.post(
                f"{BASE_URL}/api/auth/login",
                json={"username": "bad@x.com", "password": "wrong"},
            )
        # Forzar rate limit
        for i in range(3):
            s.post(
                f"{BASE_URL}/api/auth/login",
                json={"username": f"x{i}@x.com", "password": "w"},
            )
        # GETs públicos
        for i in range(5):
            s.get(f"{BASE_URL}/api/")
            s.get(f"{BASE_URL}/api/public/retas/radar")
        # Refresh inválido
        for i in range(3):
            s.post(
                f"{BASE_URL}/api/auth/refresh",
                headers={"X-Refresh-Token": f"fake-{uuid.uuid4().hex}", "X-Client-Platform": "native"},
            )
        # NoSQL injection (400)
        for i in range(3):
            s.post(
                f"{BASE_URL}/api/auth/login",
                json={"username": {"$ne": None}, "password": "x"},
            )
        # Logout sin token
        for i in range(3):
            s.post(f"{BASE_URL}/api/auth/logout")

        time.sleep(0.5)
        after = self._count_h11()
        delta = after - before
        assert delta == 0, (
            f"h11 LocalProtocolError aumentó tras 30 requests: before={before}, after={after}, delta={delta}"
        )


# ──────────────────────────────────────────────────────────────────
# Rate limiting sigue funcionando aunque SlowAPIMiddleware fue removido
# ──────────────────────────────────────────────────────────────────
class TestRateLimitStillWorks:
    def test_login_5_per_minute(self):
        sess = requests.Session()
        sess.headers.update({"Content-Type": "application/json"})
        codes = []
        for i in range(8):
            r = sess.post(
                f"{BASE_URL}/api/auth/login",
                json={"username": f"badrl-{i}@x.com", "password": "bad"},
            )
            codes.append(r.status_code)
        assert any(c in (429, 503) for c in codes), f"Sin RL: {codes}"


# ──────────────────────────────────────────────────────────────────
# Security headers en TODAS las responses
# ──────────────────────────────────────────────────────────────────
class TestSecurityHeadersStillPresent:
    def test_headers_on_get(self, s):
        r = s.get(f"{BASE_URL}/api/")
        assert r.status_code == 200
        h = {k.lower(): v for k, v in r.headers.items()}
        assert "strict-transport-security" in h
        assert h.get("x-frame-options", "").upper() == "DENY"
        assert h.get("x-content-type-options", "").lower() == "nosniff"
        assert "referrer-policy" in h
        assert "permissions-policy" in h
        assert "x-padelapp-request-id" in h

    def test_headers_on_post_401(self, s):
        r = s.post(f"{BASE_URL}/api/auth/login", json={"username": "x@x.x", "password": "bad"})
        h = {k.lower(): v for k, v in r.headers.items()}
        assert "strict-transport-security" in h
        assert "x-padelapp-request-id" in h
        assert "no-store" in h.get("cache-control", "").lower()


# ──────────────────────────────────────────────────────────────────
# NoSQL Sanitizer sigue funcionando
# ──────────────────────────────────────────────────────────────────
class TestNoSqlStillBlocked:
    def test_dollar_ne_blocked(self, s):
        r = s.post(
            f"{BASE_URL}/api/auth/login",
            json={"username": {"$ne": None}, "password": "x"},
        )
        assert r.status_code == 400
        assert r.json().get("codigo") == "INVALID_PAYLOAD"
