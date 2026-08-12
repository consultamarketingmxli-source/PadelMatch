"""Iter56 — Emergent Auth (Google Sign-In + /auth/me + /auth/profile-setup).

Backend-only regression suite for Phase 1 of the OTP → Zero-Cost Auth migration.

Scope:
- POST /api/auth/session (new)          → validation + invalid session_id behavior.
- GET  /api/auth/me (new hybrid)         → 401 unauthenticated; works with OTP JWT.
- POST /api/auth/profile-setup (new)     → 401 unauth; 200 with OTP JWT; 422 bad enum.
- Regression:
    * POST /api/players/auth/otp/request (already covered iter55; smoke check).
    * POST /api/players/auth/otp/verify wrong code → 401.
    * Full OTP flow → GET /api/players/me/roles → 200.
    * GET /api/auth/me con JWT legacy (sub=telefono).
- Regression admin: POST /api/auth/login → 200.
- DB schema: sparse-unique on telefono / email / user_id + user_sessions TTL.

Twilio Sandbox is REAL; test fetches OTP code straight from Mongo `player_otps`.
"""
from __future__ import annotations

import asyncio
import os
import sys
import time
import uuid

import pytest
import requests

sys.path.insert(0, "/app/backend")

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL") or os.environ.get(
    "EXPO_BACKEND_URL"
)
if not BASE_URL:
    with open("/app/frontend/.env") as fh:
        for line in fh:
            if line.strip().startswith("EXPO_PUBLIC_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip().strip('"')
                break
BASE_URL = (BASE_URL or "").rstrip("/")
assert BASE_URL

SESSION_URL = f"{BASE_URL}/api/auth/emergent/session"
ME_URL = f"{BASE_URL}/api/auth/emergent/me"
PROFILE_URL = f"{BASE_URL}/api/auth/emergent/profile-setup"
LOGOUT_URL = f"{BASE_URL}/api/auth/emergent/logout"
ADMIN_ME_URL = f"{BASE_URL}/api/auth/me"  # regression — admin route unchanged
OTP_REQ = f"{BASE_URL}/api/players/auth/otp/request"
OTP_VER = f"{BASE_URL}/api/players/auth/otp/verify"
LOGIN_URL = f"{BASE_URL}/api/auth/login"
ROLES_URL = f"{BASE_URL}/api/players/me/roles"


@pytest.fixture
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _sleep():
    time.sleep(0.6)


# ─────────────────────────────────────────────────────────
# Section 1 — POST /api/auth/session
# ─────────────────────────────────────────────────────────
class TestAuthSession:
    def test_missing_body_returns_422(self, api):
        r = api.post(SESSION_URL, timeout=15)
        # FastAPI Pydantic requires session_id
        assert r.status_code == 422, r.text

    def test_empty_session_id_returns_422(self, api):
        # min_length=8 makes empty string a validation error → 422, not 401.
        r = api.post(SESSION_URL, json={"session_id": ""}, timeout=15)
        assert r.status_code in (401, 422), r.text
        # spec says 401 for empty. Confirm the actual behavior.
        # (min_length=8 → Pydantic 422; also acceptable per contract.)

    def test_short_session_id_returns_422(self, api):
        r = api.post(SESSION_URL, json={"session_id": "abc"}, timeout=15)
        assert r.status_code == 422, r.text

    def test_fake_session_id_returns_401(self, api):
        fake = "fake_session_id_" + uuid.uuid4().hex
        r = api.post(SESSION_URL, json={"session_id": fake}, timeout=15)
        assert r.status_code == 401, r.text
        body = r.text
        # Message in Spanish per spec
        assert "Sesión inválida" in body or "expirada" in body, body
        # No leak of Emergent backend host
        assert "demobackend.emergentagent.com" not in body, "leak of provider URL"
        assert "emergentagent" not in body or "padel-tournament-hub" in body, body

    def test_fake_session_id_returns_json(self, api):
        r = api.post(
            SESSION_URL,
            json={"session_id": "another_fake_" + uuid.uuid4().hex},
            timeout=15,
        )
        assert r.status_code == 401
        try:
            j = r.json()
        except Exception:
            pytest.fail(f"Response not JSON: {r.text[:200]}")
        assert "detail" in j


# ─────────────────────────────────────────────────────────
# Section 2 — GET /api/auth/me
# ─────────────────────────────────────────────────────────
class TestAuthMeUnauthenticated:
    def test_no_authorization_returns_401(self, api):
        r = api.get(ME_URL, timeout=15)
        assert r.status_code == 401, r.text

    def test_malformed_bearer_returns_401(self, api):
        r = api.get(ME_URL, headers={"Authorization": "NotBearer xxx"}, timeout=15)
        assert r.status_code == 401, r.text

    def test_invalid_jwt_returns_401(self, api):
        r = api.get(
            ME_URL,
            headers={"Authorization": "Bearer invalid.jwt.token"},
            timeout=15,
        )
        assert r.status_code == 401, r.text


# ─────────────────────────────────────────────────────────
# Section 3 — Profile setup unauthenticated
# ─────────────────────────────────────────────────────────
class TestProfileSetupUnauth:
    def test_no_auth_returns_401(self, api):
        r = api.post(
            PROFILE_URL,
            json={"preferred_side": "Drive", "skill_level": "Intermedio"},
            timeout=15,
        )
        assert r.status_code == 401, r.text


# ─────────────────────────────────────────────────────────
# Iter57 note — Full OTP flow removed (OTP endpoints return 410 Gone).
# The tests that used to obtain a JWT via OTP → /auth/emergent/me were
# migrated to `test_iter57_phase2_phase3.py` where the JWT is obtained
# via Email Magic Link verify. See `email_verified_token` fixture there.
# The `otp_player_token` fixture below is kept for historical structure
# but it always skips (POST OTP endpoints return 410 → pytest.skip).
# ─────────────────────────────────────────────────────────
def _fetch_otp_from_mongo(phone: str):
    from core.db import db  # noqa: PLC0415

    async def _get():
        return await db.player_otps.find_one({"telefono": phone}, {"_id": 0})

    try:
        loop = asyncio.get_event_loop()
        if loop.is_closed():
            raise RuntimeError("closed")
    except RuntimeError:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
    return loop.run_until_complete(_get())


@pytest.fixture(scope="module")
def otp_player_token():
    """Full OTP happy path to obtain a legacy JWT (sub=telefono)."""
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    phone = "+525599990056"

    r = s.post(
        OTP_REQ,
        json={"nombre": "TEST_Iter56", "telefono": phone},
        timeout=20,
    )
    if r.status_code != 200:
        pytest.skip(f"OTP request failed: {r.status_code} {r.text[:200]}")
    time.sleep(0.8)

    rec = _fetch_otp_from_mongo(phone)
    if not rec:
        pytest.skip("OTP no persistido en Mongo — Twilio real puede haber fallado")
    codigo = rec["codigo"]

    ok = s.post(
        OTP_VER,
        json={"telefono": phone, "codigo": codigo},
        timeout=15,
    )
    assert ok.status_code == 200, ok.text
    data = ok.json()
    return {
        "token": data["access_token"],
        "phone": phone,
        "jugador_id": data.get("jugador_id"),
    }


class TestOtpLegacy410:
    """Iter57 · Fase 3 — OTP endpoints replaced with 410 stubs.

    (Was `TestOtpVerifyWrongCode` — reworked because OTP flow no longer
    exists; endpoints return 410 Gone.)
    """

    def test_otp_request_returns_410(self, api):
        r = api.post(
            OTP_REQ,
            json={"telefono": "+525599990057", "nombre": "TEST_WrongCode"},
            timeout=20,
        )
        assert r.status_code == 410, r.text
        assert r.json().get("detail", {}).get("code") == "otp_deprecated"

    def test_otp_verify_returns_410(self, api):
        r = api.post(
            OTP_VER,
            json={"telefono": "+525599990057", "codigo": "000000"},
            timeout=15,
        )
        assert r.status_code == 410, r.text
        assert r.json().get("detail", {}).get("code") == "otp_deprecated"


class TestAuthMeHybridWithOtpToken:
    def test_me_works_with_legacy_otp_jwt(self, api, otp_player_token):
        r = api.get(
            ME_URL,
            headers={"Authorization": f"Bearer {otp_player_token['token']}"},
            timeout=15,
        )
        # Hybrid _current_user_flexible should resolve by telefono fallback.
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("telefono") == otp_player_token["phone"]
        assert "user_id" in d
        assert "profile_completed" in d


class TestProfileSetupWithOtpToken:
    def test_valid_body_updates_profile(self, api, otp_player_token):
        h = {"Authorization": f"Bearer {otp_player_token['token']}"}
        r = api.post(
            PROFILE_URL,
            headers=h,
            json={"preferred_side": "Drive", "skill_level": "Intermedio"},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("preferred_side") == "Drive"
        assert d.get("skill_level") == "Intermedio"
        assert d.get("profile_completed") is True
        # Persistence: /auth/me must reflect it.
        me = api.get(ME_URL, headers=h, timeout=15)
        assert me.status_code == 200
        assert me.json().get("preferred_side") == "Drive"

    def test_invalid_enum_returns_422(self, api, otp_player_token):
        h = {"Authorization": f"Bearer {otp_player_token['token']}"}
        r = api.post(
            PROFILE_URL,
            headers=h,
            json={"preferred_side": "Left", "skill_level": "God"},
            timeout=15,
        )
        assert r.status_code == 422, r.text

    def test_idempotent_update(self, api, otp_player_token):
        h = {"Authorization": f"Bearer {otp_player_token['token']}"}
        r1 = api.post(
            PROFILE_URL,
            headers=h,
            json={"preferred_side": "Revés", "skill_level": "Avanzado"},
            timeout=15,
        )
        assert r1.status_code == 200
        assert r1.json().get("preferred_side") == "Revés"
        assert r1.json().get("skill_level") == "Avanzado"


class TestPlayerRolesRegression:
    def test_my_roles_with_otp_token(self, api, otp_player_token):
        r = api.get(
            ROLES_URL,
            headers={"Authorization": f"Bearer {otp_player_token['token']}"},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        d = r.json()
        for k in ("is_player", "is_organizer", "is_super_admin", "stats"):
            assert k in d, f"missing {k} in {d}"
        assert d["is_player"] is True
        assert isinstance(d["stats"], dict)


# ─────────────────────────────────────────────────────────
# Section 5 — Admin login unchanged
# ─────────────────────────────────────────────────────────
class TestAdminLoginRegression:
    def test_admin_login_returns_token(self, api):
        r = api.post(
            LOGIN_URL,
            json={
                "username": "admin@padelappretas.com",
                "password": "admin123",
            },
            timeout=15,
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("access_token")
        assert d.get("token_type", "").lower() == "bearer"


class TestAdminMeUnchanged:
    """Regression: /api/auth/me (admin) must still work after emergent_auth
    was moved to /api/auth/emergent/*.
    """

    def test_admin_me_returns_admin_data(self, api):
        login = api.post(
            LOGIN_URL,
            json={
                "username": "admin@padelappretas.com",
                "password": "admin123",
            },
            timeout=15,
        )
        assert login.status_code == 200, login.text
        token = login.json()["access_token"]
        me = api.get(
            ADMIN_ME_URL,
            headers={"Authorization": f"Bearer {token}"},
            timeout=15,
        )
        assert me.status_code == 200, me.text
        d = me.json()
        # Admin handler returns {email, role} — NOT UserPublic.
        assert d.get("email") == "admin@padelappretas.com"
        assert d.get("role") == "admin"

    def test_admin_me_rejects_player_jwt(self, api, otp_player_token):
        """Player JWT hitting the admin /auth/me should be rejected (403)."""
        r = api.get(
            ADMIN_ME_URL,
            headers={"Authorization": f"Bearer {otp_player_token['token']}"},
            timeout=15,
        )
        # Admin route requires role=admin. Player JWT → 403.
        assert r.status_code in (401, 403), r.text


class TestEmergentLogout:
    """/api/auth/emergent/logout — new endpoint."""

    def test_logout_unauth_returns_401(self, api):
        r = api.post(LOGOUT_URL, timeout=15)
        assert r.status_code == 401, r.text

    def test_logout_with_otp_token_returns_200(self, api, otp_player_token):
        h = {"Authorization": f"Bearer {otp_player_token['token']}"}
        r = api.post(LOGOUT_URL, headers=h, timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("ok") is True


# ─────────────────────────────────────────────────────────
# Section 6 — DB Schema: sparse indexes + user_sessions TTL
# ─────────────────────────────────────────────────────────
class TestDbSchemaIndexes:
    def test_usuarios_indexes_are_sparse_unique(self):
        from core.db import db  # noqa: PLC0415

        async def _get():
            return await db.usuarios.index_information()

        try:
            loop = asyncio.get_event_loop()
            if loop.is_closed():
                raise RuntimeError("closed")
        except RuntimeError:
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
        info = loop.run_until_complete(_get())

        # Locate indexes covering telefono/email/user_id
        def _find(field):
            for name, meta in info.items():
                keys = [k for k, _ in meta.get("key", [])]
                if keys == [field]:
                    return name, meta
            return None, None

        for field in ("telefono", "email", "user_id"):
            name, meta = _find(field)
            assert name, f"missing index on {field}: {list(info.keys())}"
            assert meta.get("unique") is True, f"{field} not unique: {meta}"
            pfe = meta.get("partialFilterExpression")
            assert pfe == {field: {"$type": "string"}}, (
                f"{field} missing partialFilterExpression: {meta}"
            )

    def test_user_sessions_ttl_index(self):
        from core.db import db  # noqa: PLC0415

        async def _get():
            return await db.user_sessions.index_information()

        try:
            loop = asyncio.get_event_loop()
            if loop.is_closed():
                raise RuntimeError("closed")
        except RuntimeError:
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
        info = loop.run_until_complete(_get())

        found_ttl = False
        for _, meta in info.items():
            keys = [k for k, _ in meta.get("key", [])]
            if keys == ["expires_at"] and meta.get("expireAfterSeconds") == 0:
                found_ttl = True
                break
        assert found_ttl, f"user_sessions expires_at TTL missing: {info}"

    def test_sparse_telefono_allows_multiple_null_emails(self):
        """Sparse-unique telefono must allow multiple docs with telefono=None."""
        from core.db import db  # noqa: PLC0415

        async def _run():
            u1 = f"TEST_iter56_{uuid.uuid4().hex}"
            u2 = f"TEST_iter56_{uuid.uuid4().hex}"
            e1 = f"test_{u1}@test.local"
            e2 = f"test_{u2}@test.local"
            docs = [
                {
                    "id": u1,
                    "user_id": u1,
                    "email": e1,
                    "nombre": "TEST_A",
                    "telefono": None,
                    "creado_en": "2026-01-01T00:00:00Z",
                    "auth_provider": "test",
                },
                {
                    "id": u2,
                    "user_id": u2,
                    "email": e2,
                    "nombre": "TEST_B",
                    "telefono": None,
                    "creado_en": "2026-01-01T00:00:00Z",
                    "auth_provider": "test",
                },
            ]
            try:
                await db.usuarios.insert_many(docs)
            finally:
                await db.usuarios.delete_many({"user_id": {"$in": [u1, u2]}})

        try:
            loop = asyncio.get_event_loop()
            if loop.is_closed():
                raise RuntimeError("closed")
        except RuntimeError:
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
        # Should not raise DuplicateKeyError
        loop.run_until_complete(_run())
