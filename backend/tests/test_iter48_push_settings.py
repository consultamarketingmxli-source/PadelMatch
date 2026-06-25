"""Iter48 — Push Notification Settings (Opt-out / Opt-in) backend tests.

Covers:
- GET  /api/push-status            (4 states: never · registered · pending_deploy · disabled)
- POST /api/disable-push           (explicit opt-out, idempotent, shell-doc on never-registered)
- push_service.send_push() FILTER  (excludes notifications_enabled=false from upstream payload)
- End-to-end flow: register → status → disable → status → re-register → re-enabled
- Regression smoke (iter45/46/47): /api/, admin login, /api/public/retas/buscar,
  /.well-known/apple-app-site-association

Run:
  pytest /app/backend/tests/test_iter48_push_settings.py -v \
      --junitxml=/app/test_reports/pytest/iter48_push_settings.xml
"""
from __future__ import annotations

import asyncio
import os
import sys
import uuid
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import requests
from motor.motor_asyncio import AsyncIOMotorClient

# Make /app/backend importable to load push_service for unit-test of send_push().
sys.path.insert(0, str(Path("/app/backend").resolve()))

BASE_URL = os.environ.get(
    "EXPO_PUBLIC_BACKEND_URL",
    "https://padel-tournament-hub-9.preview.emergentagent.com",
).rstrip("/")
BACKEND_DIRECT = "http://localhost:8001"

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")

TEST_USER_PREFIX = "TEST_iter48_"


def _run(coro):
    """Robust async-coro runner (handles closed/missing loops on py3.11+)."""
    try:
        loop = asyncio.get_event_loop()
        if loop.is_closed():
            raise RuntimeError("closed")
    except RuntimeError:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
    return loop.run_until_complete(coro)


@pytest.fixture(scope="module")
def mongo_db():
    client = AsyncIOMotorClient(MONGO_URL)
    db = client[DB_NAME]
    yield db
    client.close()


@pytest.fixture(scope="module", autouse=True)
def cleanup(mongo_db):
    yield
    try:
        _run(mongo_db.push_registrations.delete_many(
            {"user_id": {"$regex": f"^{TEST_USER_PREFIX}"}}
        ))
    except Exception:
        pass


# ============================================================
# Section 1 — GET /api/push-status
# ============================================================
class TestPushStatusEndpoint:
    """GET /api/push-status?user_id=... · 4 logical states."""

    def test_status_never_registered(self):
        """User never registered → state='never', enabled=False, platform=None."""
        uid = f"{TEST_USER_PREFIX}never_{uuid.uuid4().hex[:8]}"
        r = requests.get(f"{BASE_URL}/api/push-status", params={"user_id": uid}, timeout=10)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["user_id"] == uid
        assert body["state"] == "never"
        assert body["notifications_enabled"] is False
        assert body["platform"] is None
        assert body["updated_at"] is None

    def test_status_registered_or_pending_deploy(self):
        """After register-push, state is 'registered' or 'pending_deploy' and enabled=True."""
        uid = f"{TEST_USER_PREFIX}reg_{uuid.uuid4().hex[:8]}"
        reg = requests.post(
            f"{BASE_URL}/api/register-push",
            json={"user_id": uid, "platform": "android",
                  "device_token": "tok_" + uuid.uuid4().hex},
            timeout=15,
        )
        assert reg.status_code == 201, reg.text

        r = requests.get(f"{BASE_URL}/api/push-status", params={"user_id": uid}, timeout=10)
        assert r.status_code == 200
        body = r.json()
        assert body["user_id"] == uid
        assert body["state"] in ("registered", "pending_deploy")
        assert body["notifications_enabled"] is True
        assert body["platform"] == "android"
        assert body["updated_at"] is not None

    def test_status_missing_user_id_422(self):
        """No query param → 422 from Pydantic Query validation."""
        r = requests.get(f"{BASE_URL}/api/push-status", timeout=10)
        assert r.status_code == 422, r.text
        detail = r.json()["detail"]
        assert any("user_id" in (d.get("loc") or []) for d in detail)

    def test_status_empty_user_id_422(self):
        """Empty string user_id → 422 (min_length=1)."""
        r = requests.get(f"{BASE_URL}/api/push-status", params={"user_id": ""}, timeout=10)
        assert r.status_code == 422

    def test_status_after_disable_is_disabled(self):
        """register → disable → status must be 'disabled' and enabled=False."""
        uid = f"{TEST_USER_PREFIX}dis_{uuid.uuid4().hex[:8]}"
        requests.post(
            f"{BASE_URL}/api/register-push",
            json={"user_id": uid, "platform": "ios", "device_token": "iostok_" + uuid.uuid4().hex},
            timeout=15,
        )
        d = requests.post(f"{BASE_URL}/api/disable-push", json={"user_id": uid}, timeout=10)
        assert d.status_code == 200

        r = requests.get(f"{BASE_URL}/api/push-status", params={"user_id": uid}, timeout=10)
        assert r.status_code == 200
        body = r.json()
        assert body["state"] == "disabled"
        assert body["notifications_enabled"] is False
        # platform fingerprint preserved from prior register
        assert body["platform"] == "ios"


# ============================================================
# Section 2 — POST /api/disable-push
# ============================================================
class TestDisablePushEndpoint:
    """Opt-out flagging + idempotency + shell-doc on never-registered."""

    def test_disable_after_register_updates_doc(self, mongo_db):
        uid = f"{TEST_USER_PREFIX}disreg_{uuid.uuid4().hex[:8]}"
        requests.post(
            f"{BASE_URL}/api/register-push",
            json={"user_id": uid, "platform": "android",
                  "device_token": "t_" + uuid.uuid4().hex},
            timeout=15,
        )
        r = requests.post(f"{BASE_URL}/api/disable-push", json={"user_id": uid}, timeout=10)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body == {"status": "disabled", "user_id": uid}

        doc = _run(mongo_db.push_registrations.find_one({"user_id": uid}))
        assert doc is not None
        assert doc["notifications_enabled"] is False
        assert "disabled_at" in doc and doc["disabled_at"]
        assert "updated_at" in doc

    def test_disable_never_registered_creates_shell_doc(self, mongo_db):
        """user_id NUNCA registrado: crea shell doc con notifications_enabled=false (no crashea)."""
        uid = f"{TEST_USER_PREFIX}shell_{uuid.uuid4().hex[:8]}"
        # Sanity: no prior doc
        prior = _run(mongo_db.push_registrations.find_one({"user_id": uid}))
        assert prior is None

        r = requests.post(f"{BASE_URL}/api/disable-push", json={"user_id": uid}, timeout=10)
        assert r.status_code == 200
        assert r.json()["status"] == "disabled"

        doc = _run(mongo_db.push_registrations.find_one({"user_id": uid}))
        assert doc is not None
        assert doc["notifications_enabled"] is False
        assert doc["status"] == "disabled"
        assert doc["platform"] is None
        assert "disabled_at" in doc
        assert "created_at" in doc

        # And status endpoint reports 'disabled' (NOT 'never') because shell exists.
        s = requests.get(f"{BASE_URL}/api/push-status", params={"user_id": uid}, timeout=10)
        assert s.status_code == 200
        assert s.json()["state"] == "disabled"

    def test_disable_empty_user_id_422(self):
        r = requests.post(f"{BASE_URL}/api/disable-push", json={"user_id": ""}, timeout=10)
        assert r.status_code == 422

    def test_disable_missing_user_id_422(self):
        r = requests.post(f"{BASE_URL}/api/disable-push", json={}, timeout=10)
        assert r.status_code == 422

    def test_disable_idempotent_twice(self, mongo_db):
        """2 disable-push consecutivos → 2x 200 sin error, doc sigue notifications_enabled=False."""
        uid = f"{TEST_USER_PREFIX}idem_{uuid.uuid4().hex[:8]}"
        r1 = requests.post(f"{BASE_URL}/api/disable-push", json={"user_id": uid}, timeout=10)
        r2 = requests.post(f"{BASE_URL}/api/disable-push", json={"user_id": uid}, timeout=10)
        assert r1.status_code == 200 and r2.status_code == 200
        assert r1.json() == r2.json() == {"status": "disabled", "user_id": uid}
        count = _run(mongo_db.push_registrations.count_documents({"user_id": uid}))
        assert count == 1
        doc = _run(mongo_db.push_registrations.find_one({"user_id": uid}))
        assert doc["notifications_enabled"] is False


# ============================================================
# Section 3 — End-to-end flow (register → disable → re-register)
# ============================================================
class TestEndToEndOptInOut:

    def test_full_lifecycle(self, mongo_db):
        uid = f"{TEST_USER_PREFIX}e2e_{uuid.uuid4().hex[:8]}"

        # 1) register
        r = requests.post(
            f"{BASE_URL}/api/register-push",
            json={"user_id": uid, "platform": "android", "device_token": "tA_" + uuid.uuid4().hex},
            timeout=15,
        )
        assert r.status_code == 201
        s = requests.get(f"{BASE_URL}/api/push-status", params={"user_id": uid}, timeout=10).json()
        assert s["state"] in ("registered", "pending_deploy")
        assert s["notifications_enabled"] is True

        # 2) disable
        requests.post(f"{BASE_URL}/api/disable-push", json={"user_id": uid}, timeout=10)
        s = requests.get(f"{BASE_URL}/api/push-status", params={"user_id": uid}, timeout=10).json()
        assert s["state"] == "disabled"
        assert s["notifications_enabled"] is False

        # 3) re-register (opt-in implícito)
        r2 = requests.post(
            f"{BASE_URL}/api/register-push",
            json={"user_id": uid, "platform": "android", "device_token": "tB_" + uuid.uuid4().hex},
            timeout=15,
        )
        assert r2.status_code == 201
        s = requests.get(f"{BASE_URL}/api/push-status", params={"user_id": uid}, timeout=10).json()
        assert s["state"] in ("registered", "pending_deploy")
        assert s["notifications_enabled"] is True

        # DB sanity: disabled_at unset after re-activation
        doc = _run(mongo_db.push_registrations.find_one({"user_id": uid}))
        assert doc["notifications_enabled"] is True
        assert "disabled_at" not in doc


# ============================================================
# Section 4 — push_service.send_push() filtering opt-outs
# Unit tests with monkeypatched httpx.AsyncClient
# ============================================================
class TestSendPushFiltersOptOuts:
    """CRITICAL: send_push() must exclude users with notifications_enabled=False
    from the `recipients` payload sent to Emergent provider."""

    def _make_mock_resp(self, status=200, text="ok"):
        m = MagicMock()
        m.status_code = status
        m.text = text
        return m

    def test_filters_disabled_user_from_payload(self, mongo_db):
        """Mix of enabled+disabled user_ids → only enabled survives in payload.recipients."""
        from services import push_service

        uid_ok = f"{TEST_USER_PREFIX}ok_{uuid.uuid4().hex[:8]}"
        uid_off = f"{TEST_USER_PREFIX}off_{uuid.uuid4().hex[:8]}"
        # Seed: ok=enabled, off=disabled.
        _run(mongo_db.push_registrations.insert_one(
            {"user_id": uid_ok, "notifications_enabled": True, "status": "registered",
             "platform": "android"}
        ))
        _run(mongo_db.push_registrations.insert_one(
            {"user_id": uid_off, "notifications_enabled": False, "status": "disabled",
             "platform": "android"}
        ))

        # Reset module-level singleton client and patch a fake one.
        push_service._client = None
        fake_client = MagicMock()
        fake_client.post = AsyncMock(return_value=self._make_mock_resp(200, "ok"))

        with patch.object(push_service, "_get_client", return_value=fake_client):
            ok = _run(push_service.send_push(
                recipients=[uid_ok, uid_off],
                data={"title": "T", "message": "M"},
            ))
        assert ok is True
        # Validate that the provider call payload excludes the disabled user.
        assert fake_client.post.await_count == 1, "expected exactly one upstream call"
        called_args, called_kwargs = fake_client.post.call_args
        assert called_args[0] == "/api/v1/push/trigger"
        sent_payload = called_kwargs.get("json") or (called_args[1] if len(called_args) > 1 else None)
        assert sent_payload is not None
        assert uid_ok in sent_payload["recipients"]
        assert uid_off not in sent_payload["recipients"], \
            f"opt-out user leaked to provider · payload={sent_payload}"

    def test_all_disabled_returns_false_and_no_upstream_call(self, mongo_db):
        """If ALL recipients are disabled → send_push returns False without calling provider."""
        from services import push_service

        uid_a = f"{TEST_USER_PREFIX}alloff_a_{uuid.uuid4().hex[:8]}"
        uid_b = f"{TEST_USER_PREFIX}alloff_b_{uuid.uuid4().hex[:8]}"
        _run(mongo_db.push_registrations.insert_many([
            {"user_id": uid_a, "notifications_enabled": False, "status": "disabled"},
            {"user_id": uid_b, "notifications_enabled": False, "status": "disabled"},
        ]))

        push_service._client = None
        fake_client = MagicMock()
        fake_client.post = AsyncMock(return_value=self._make_mock_resp(200, "ok"))

        with patch.object(push_service, "_get_client", return_value=fake_client):
            ok = _run(push_service.send_push(
                recipients=[uid_a, uid_b],
                data={"title": "T", "message": "M"},
            ))
        assert ok is False
        assert fake_client.post.await_count == 0, \
            "Provider must NOT be called when all recipients are opt-out"

    def test_all_enabled_passes_full_list(self, mongo_db):
        """Sanity: when no one is disabled, payload.recipients is full list."""
        from services import push_service

        uid_x = f"{TEST_USER_PREFIX}on_x_{uuid.uuid4().hex[:8]}"
        uid_y = f"{TEST_USER_PREFIX}on_y_{uuid.uuid4().hex[:8]}"
        _run(mongo_db.push_registrations.insert_many([
            {"user_id": uid_x, "notifications_enabled": True, "status": "registered"},
            {"user_id": uid_y, "notifications_enabled": True, "status": "registered"},
        ]))

        push_service._client = None
        fake_client = MagicMock()
        fake_client.post = AsyncMock(return_value=self._make_mock_resp(200, "ok"))

        with patch.object(push_service, "_get_client", return_value=fake_client):
            ok = _run(push_service.send_push(
                recipients=[uid_x, uid_y],
                data={"title": "T", "message": "M"},
            ))
        assert ok is True
        sent = fake_client.post.call_args.kwargs["json"]
        assert set(sent["recipients"]) == {uid_x, uid_y}


# ============================================================
# Section 5 — Regression smoke (iter45/46/47 critical paths)
# ============================================================
class TestRegressionSmoke:

    def test_health(self):
        r = requests.get(f"{BASE_URL}/api/", timeout=10)
        assert r.status_code == 200
        assert r.json()["status"] == "ok"

    def test_admin_login(self):
        r = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"username": "admin@padelappretas.com", "password": "admin123"},
            timeout=15,
        )
        assert r.status_code == 200
        assert "access_token" in r.json()

    def test_public_buscar_retas(self):
        r = requests.get(f"{BASE_URL}/api/public/retas/buscar", timeout=10)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_aasa_backend_direct(self):
        # Public ingress may not route /.well-known; backend always serves it.
        r = requests.get(f"{BACKEND_DIRECT}/.well-known/apple-app-site-association", timeout=10)
        assert r.status_code == 200
        assert r.headers.get("content-type", "").startswith("application/json")
        assert "applinks" in r.json()
