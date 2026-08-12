"""Iter57 · Fases 2 + 3 — Email Magic Link + Twilio purge regression suite.

Backend-only tests. Cubre:

  Fase 2 (Email Magic Link OTP via Resend):
    * POST /api/auth/emergent/email/request → 200, 422, rate limiting, privacy.
    * POST /api/auth/emergent/email/verify → 401 wrong/expired, 5-attempts lockout,
      full end-to-end (inject OTP en Mongo → verify → JWT → /me).

  Fase 3 (Twilio purge):
    * POST /api/players/auth/otp/request → 410 con code=otp_deprecated.
    * POST /api/players/auth/otp/verify → 410 mismo shape.
    * /app/backend/notifications.py sigue importable, is_twilio_configured()==False,
      send_whatsapp() no-op no crashea.
    * TWILIO_ vars comentadas en /app/backend/.env.

  Regression Fase 1 (Iter56, ya verde — smoke check):
    * POST /api/auth/emergent/session con fake session_id → 401.
    * POST /api/auth/emergent/profile-setup con JWT nuevo → 200.

  Regression Admin:
    * POST /api/auth/login admin@padelappretas.com → 200.
    * GET  /api/auth/me con admin token → 200 admin data.

  Regression DB:
    * usuarios.email has partialFilterExpression:{email:{$type:string}}.
    * email_otps has TTL on expires_at.
    * Insertar 2 usuarios con telefono=None sin colisión.

  Integración roles endpoint:
    * /api/players/me/roles con JWT emitido por email verify → 200.

NOTA: El código plano nunca vive en Mongo (solo SHA256). Para tests inyectamos
docs directamente con el hash conocido, replicando fielmente el flujo real.
"""
from __future__ import annotations

import asyncio
import hashlib
import os
import sys
import time
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import requests

sys.path.insert(0, "/app/backend")

BASE_URL = (
    os.environ.get("EXPO_PUBLIC_BACKEND_URL")
    or os.environ.get("EXPO_BACKEND_URL")
    or ""
)
if not BASE_URL:
    with open("/app/frontend/.env") as fh:
        for line in fh:
            if line.strip().startswith("EXPO_PUBLIC_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip().strip('"')
                break
BASE_URL = BASE_URL.rstrip("/")
assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL not set"

EMAIL_REQ = f"{BASE_URL}/api/auth/emergent/email/request"
EMAIL_VER = f"{BASE_URL}/api/auth/emergent/email/verify"
SESSION_URL = f"{BASE_URL}/api/auth/emergent/session"
ME_URL = f"{BASE_URL}/api/auth/emergent/me"
PROFILE_URL = f"{BASE_URL}/api/auth/emergent/profile-setup"
OTP_REQ_LEGACY = f"{BASE_URL}/api/players/auth/otp/request"
OTP_VER_LEGACY = f"{BASE_URL}/api/players/auth/otp/verify"
ADMIN_LOGIN = f"{BASE_URL}/api/auth/login"
ADMIN_ME = f"{BASE_URL}/api/auth/me"
ROLES_URL = f"{BASE_URL}/api/players/me/roles"


@pytest.fixture
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _sha256(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _run(coro):
    try:
        loop = asyncio.get_event_loop()
        if loop.is_closed():
            raise RuntimeError("closed")
    except RuntimeError:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
    return loop.run_until_complete(coro)


# ═══════════════════════════════════════════════════════════════
# Fase 2 — POST /api/auth/emergent/email/request
# ═══════════════════════════════════════════════════════════════
class TestEmailRequest:
    def test_valid_body_returns_200(self, api):
        email = f"test_iter57_{uuid.uuid4().hex[:8]}@example.com"
        r = api.post(EMAIL_REQ, json={"email": email, "nombre": "Tester"}, timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("ok") is True
        assert "message" in d
        assert d.get("expires_in_minutes") == 10

    def test_invalid_email_returns_422(self, api):
        r = api.post(EMAIL_REQ, json={"email": "not-an-email"}, timeout=15)
        assert r.status_code == 422, r.text

    def test_missing_email_returns_422(self, api):
        r = api.post(EMAIL_REQ, json={"nombre": "no-email"}, timeout=15)
        assert r.status_code == 422, r.text

    def test_privacy_no_leak_of_email_existence(self, api):
        """Whether email exists or not, response must be identical (privacy)."""
        real_email = f"test_privacy_{uuid.uuid4().hex[:6]}@example.com"
        # We don't have a "known existing" user readily, but the invariant is
        # that both responses have the same shape and 200.
        r1 = api.post(EMAIL_REQ, json={"email": real_email}, timeout=15)
        r2 = api.post(EMAIL_REQ, json={"email": f"nonexistent_{uuid.uuid4().hex}@x.com"}, timeout=15)
        # Both should be 200 with identical schema
        assert r1.status_code == 200 and r2.status_code == 200
        # Neither should contain 'exists' / 'not found' semantics
        for body in (r1.text.lower(), r2.text.lower()):
            for banned in ("no existe", "does not exist", "not found", "unknown"):
                assert banned not in body, f"privacy leak: {body}"


class TestEmailRequestRateLimitByEmail:
    """Cada email puede recibir max 3 OTPs / 15 min. Al 4to → throttled=True."""

    def test_throttle_after_3_requests(self, api):
        email = f"test_ratelimit_{uuid.uuid4().hex[:8]}@example.com"
        # Prime 3 OTPs directly in Mongo (bypass the SlowAPI IP limit)
        from core.db import db  # noqa

        async def _seed():
            now = _now()
            for _ in range(3):
                await db.email_otps.insert_one({
                    "email": email,
                    "codigo_hash": _sha256("000000"),
                    "created_at": now,
                    "expires_at": now + timedelta(minutes=10),
                    "attempts": 0,
                    "used": False,
                })

        _run(_seed())
        # 4th HTTP request: either SlowAPI 429 (IP limit hit by prior tests)
        # OR 200 with throttled=True (email limit hit). Both are valid rate-
        # limit signals per spec.
        r = api.post(EMAIL_REQ, json={"email": email}, timeout=15)
        if r.status_code == 429:
            assert "intentos" in r.text.lower() or "many" in r.text.lower()
        else:
            assert r.status_code == 200, r.text
            d = r.json()
            assert d.get("throttled") is True, d
        # cleanup
        _run(_cleanup_otps(email))


async def _cleanup_otps(email: str):
    from core.db import db  # noqa
    await db.email_otps.delete_many({"email": email})


# ═══════════════════════════════════════════════════════════════
# Fase 2 — POST /api/auth/emergent/email/verify
# ═══════════════════════════════════════════════════════════════
class TestEmailVerifyInvalid:
    def test_wrong_code_returns_401(self, api):
        email = f"test_wrong_{uuid.uuid4().hex[:8]}@example.com"

        async def _seed():
            from core.db import db
            now = _now()
            await db.email_otps.insert_one({
                "email": email,
                "codigo_hash": _sha256("123456"),
                "created_at": now,
                "expires_at": now + timedelta(minutes=10),
                "attempts": 0,
                "used": False,
            })

        _run(_seed())
        try:
            r = api.post(EMAIL_VER, json={"email": email, "codigo": "999999"}, timeout=15)
            assert r.status_code == 401, r.text
            assert "incorrecto" in r.text.lower() or "expirado" in r.text.lower()
        finally:
            _run(_cleanup_otps(email))

    def test_no_otp_present_returns_401(self, api):
        email = f"test_missing_{uuid.uuid4().hex[:8]}@example.com"
        r = api.post(EMAIL_VER, json={"email": email, "codigo": "123456"}, timeout=15)
        assert r.status_code == 401, r.text

    def test_expired_otp_returns_401(self, api):
        email = f"test_expired_{uuid.uuid4().hex[:8]}@example.com"

        async def _seed():
            from core.db import db
            now = _now()
            await db.email_otps.insert_one({
                "email": email,
                "codigo_hash": _sha256("123456"),
                "created_at": now - timedelta(minutes=30),
                "expires_at": now - timedelta(minutes=1),  # expired
                "attempts": 0,
                "used": False,
            })

        _run(_seed())
        try:
            r = api.post(EMAIL_VER, json={"email": email, "codigo": "123456"}, timeout=15)
            assert r.status_code == 401, r.text
        finally:
            _run(_cleanup_otps(email))

    def test_five_attempts_locks_otp(self, api):
        """Trigger the 5-attempt lockout via the HTTP endpoint itself so both
        sides operate on the same Mongo view."""
        email = f"test_lockout_{uuid.uuid4().hex[:8]}@example.com"

        async def _seed():
            from core.db import db
            now = _now()
            await db.email_otps.insert_one({
                "email": email,
                "codigo_hash": _sha256("123456"),
                "created_at": now,
                "expires_at": now + timedelta(minutes=10),
                "attempts": 0,
                "used": False,
            })

        _run(_seed())
        time.sleep(0.3)
        try:
            # 5 consecutive wrong tries
            last = None
            for _ in range(5):
                last = api.post(EMAIL_VER, json={"email": email, "codigo": "999999"}, timeout=15)
                assert last.status_code == 401, last.text
                time.sleep(0.1)
            # 6th try should say "Demasiados intentos"
            r = api.post(EMAIL_VER, json={"email": email, "codigo": "999999"}, timeout=15)
            assert r.status_code == 401, r.text
            assert "Demasiados intentos" in r.text, r.text
            # And OTP marked used
            async def _check():
                from core.db import db
                return await db.email_otps.find_one({"email": email})
            doc = _run(_check())
            assert doc is not None
            assert doc.get("used") is True
        finally:
            _run(_cleanup_otps(email))


# ═══════════════════════════════════════════════════════════════
# Fase 2 — End-to-end: inject OTP → verify → JWT → /me → /roles
# ═══════════════════════════════════════════════════════════════
@pytest.fixture(scope="module")
def email_verified_token():
    """Inyecta OTP con hash conocido, verify → JWT.

    NOTE: SlowAPI rate limit 10/min per IP for verify — usamos email único
    y no re-usamos verifies con mismo IP en rapid-fire.
    """
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    email = f"test_e2e_{uuid.uuid4().hex[:8]}@example.com"
    codigo = "654321"

    async def _seed():
        from core.db import db
        now = _now()
        await db.email_otps.insert_one({
            "email": email,
            "codigo_hash": _sha256(codigo),
            "created_at": now,
            "expires_at": now + timedelta(minutes=10),
            "attempts": 0,
            "used": False,
            "nombre_hint": "Tester Iter57",
        })

    _run(_seed())
    time.sleep(0.3)

    r = s.post(EMAIL_VER, json={"email": email, "codigo": codigo}, timeout=15)
    if r.status_code != 200:
        _run(_cleanup_otps(email))
        pytest.fail(f"verify failed: {r.status_code} {r.text[:300]}")
    data = r.json()
    yield {
        "token": data["access_token"],
        "refresh_token": data.get("refresh_token"),
        "user": data["user"],
        "email": email,
    }

    # cleanup
    async def _cleanup():
        from core.db import db
        await db.email_otps.delete_many({"email": email})
        await db.usuarios.delete_many({"email": email})

    _run(_cleanup())


class TestEmailVerifySuccess:
    def test_verify_returns_jwt_and_user(self, email_verified_token):
        t = email_verified_token
        assert t["token"]
        assert t["user"]["email"] == t["email"]
        assert t["user"].get("user_id")
        assert "nombre" in t["user"]

    def test_jwt_works_with_me_endpoint(self, api, email_verified_token):
        r = api.get(
            ME_URL,
            headers={"Authorization": f"Bearer {email_verified_token['token']}"},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["email"] == email_verified_token["email"]
        assert d.get("user_id") == email_verified_token["user"]["user_id"]


class TestEmailVerifyRolesEndpoint:
    """Regression: /api/players/me/roles con JWT emitido por email verify."""

    def test_roles_endpoint_with_new_jwt(self, api, email_verified_token):
        r = api.get(
            ROLES_URL,
            headers={"Authorization": f"Bearer {email_verified_token['token']}"},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("is_player") is True
        assert d.get("is_organizer") is False
        assert d.get("is_super_admin") is False
        assert isinstance(d.get("stats"), dict)

    def test_profile_setup_with_email_jwt(self, api, email_verified_token):
        r = api.post(
            PROFILE_URL,
            headers={"Authorization": f"Bearer {email_verified_token['token']}"},
            json={"preferred_side": "Drive", "skill_level": "Intermedio"},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("preferred_side") == "Drive"
        assert d.get("skill_level") == "Intermedio"
        assert d.get("profile_completed") is True


# ═══════════════════════════════════════════════════════════════
# Fase 3 — Twilio purge: OTP endpoints → 410 Gone
# ═══════════════════════════════════════════════════════════════
class TestOtpLegacy410:
    def test_otp_request_returns_410(self, api):
        r = api.post(
            OTP_REQ_LEGACY,
            json={"telefono": "+525599990099", "nombre": "TestLegacy"},
            timeout=15,
        )
        assert r.status_code == 410, r.text
        d = r.json()
        detail = d.get("detail")
        assert isinstance(detail, dict), detail
        assert detail.get("code") == "otp_deprecated", detail

    def test_otp_verify_returns_410(self, api):
        r = api.post(
            OTP_VER_LEGACY,
            json={"telefono": "+525599990099", "codigo": "123456"},
            timeout=15,
        )
        assert r.status_code == 410, r.text
        d = r.json()
        detail = d.get("detail")
        assert isinstance(detail, dict), detail
        assert detail.get("code") == "otp_deprecated", detail


# ═══════════════════════════════════════════════════════════════
# Fase 3 — Twilio purge: notifications.py no-op
# ═══════════════════════════════════════════════════════════════
class TestNotificationsNoOp:
    def test_module_importable(self):
        import notifications  # noqa: PLC0415
        assert hasattr(notifications, "send_whatsapp")
        assert hasattr(notifications, "is_twilio_configured")

    def test_is_twilio_configured_false(self):
        from notifications import is_twilio_configured  # noqa
        assert is_twilio_configured() is False

    def test_send_whatsapp_returns_mocked(self):
        from notifications import send_whatsapp  # noqa
        result = _run(send_whatsapp("+525512345678", "test message"))
        assert result["status"] == "mocked"
        assert result["to"] == "+525512345678"
        assert result["body"] == "test message"

    def test_dotenv_twilio_commented(self):
        with open("/app/backend/.env") as fh:
            for line in fh:
                stripped = line.strip()
                if "TWILIO_" in stripped:
                    # Must be a comment
                    assert stripped.startswith("#"), f"Twilio var not commented: {stripped}"


# ═══════════════════════════════════════════════════════════════
# Regression — Fase 1 (Iter56) sigue verde
# ═══════════════════════════════════════════════════════════════
class TestPhase1Regression:
    def test_session_fake_returns_401(self, api):
        fake = "fake_session_id_" + uuid.uuid4().hex
        r = api.post(SESSION_URL, json={"session_id": fake}, timeout=15)
        assert r.status_code == 401, r.text


# ═══════════════════════════════════════════════════════════════
# Regression — Admin login intacto
# ═══════════════════════════════════════════════════════════════
class TestAdminRegression:
    def test_admin_login(self, api):
        r = api.post(
            ADMIN_LOGIN,
            json={"username": "admin@padelappretas.com", "password": "admin123"},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        assert r.json().get("access_token")

    def test_admin_me(self, api):
        r = api.post(
            ADMIN_LOGIN,
            json={"username": "admin@padelappretas.com", "password": "admin123"},
            timeout=15,
        )
        token = r.json()["access_token"]
        me = api.get(ADMIN_ME, headers={"Authorization": f"Bearer {token}"}, timeout=15)
        assert me.status_code == 200, me.text
        d = me.json()
        assert d.get("email") == "admin@padelappretas.com"
        assert d.get("role") == "admin"


# ═══════════════════════════════════════════════════════════════
# Regression — DB Schema
# ═══════════════════════════════════════════════════════════════
class TestDbSchema:
    def test_usuarios_email_partial_index(self):
        from core.db import db  # noqa

        async def _get():
            return await db.usuarios.index_information()

        info = _run(_get())
        found = False
        for _, meta in info.items():
            keys = [k for k, _ in meta.get("key", [])]
            if keys == ["email"]:
                pfe = meta.get("partialFilterExpression")
                if pfe == {"email": {"$type": "string"}}:
                    found = True
                    break
        assert found, f"email partial index missing: {list(info.keys())}"

    def test_email_otps_ttl_index(self):
        from core.db import db  # noqa

        async def _get():
            return await db.email_otps.index_information()

        info = _run(_get())
        found_ttl = False
        for _, meta in info.items():
            keys = [k for k, _ in meta.get("key", [])]
            if keys == ["expires_at"] and meta.get("expireAfterSeconds") == 0:
                found_ttl = True
                break
        assert found_ttl, f"email_otps expires_at TTL missing: {info}"

    def test_multiple_null_telefono_users(self):
        """Regression Iter56 fix: dos usuarios email-only con telefono=None."""
        from core.db import db  # noqa

        async def _run_inner():
            u1 = f"TEST_iter57_{uuid.uuid4().hex}"
            u2 = f"TEST_iter57_{uuid.uuid4().hex}"
            e1 = f"a_{u1}@test.local"
            e2 = f"b_{u2}@test.local"
            docs = [
                {
                    "id": u1, "user_id": u1, "email": e1, "nombre": "TA",
                    "telefono": None, "auth_provider": "test",
                    "creado_en": "2026-01-01T00:00:00Z",
                },
                {
                    "id": u2, "user_id": u2, "email": e2, "nombre": "TB",
                    "telefono": None, "auth_provider": "test",
                    "creado_en": "2026-01-01T00:00:00Z",
                },
            ]
            try:
                await db.usuarios.insert_many(docs)
            finally:
                await db.usuarios.delete_many({"user_id": {"$in": [u1, u2]}})

        _run(_run_inner())  # must not raise DuplicateKeyError
