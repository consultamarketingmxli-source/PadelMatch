"""Iter47 — Deep Linking (.well-known) + Push Token Registration tests.

Covers:
- GET /.well-known/apple-app-site-association  (backend direct + via public URL)
- GET /.well-known/assetlinks.json              (backend direct + via public URL)
- POST /api/register-push                        (happy path · status==pending_deploy
  while EMERGENT_PUSH_KEY=placeholder; idempotency upsert; pydantic 422 errors)
- DB audit row in `db.push_registrations` contains token_fingerprint (NOT full token)

NOTE: The .well-known endpoints are mounted on the FastAPI app WITHOUT the /api
prefix (Apple/Google require literal paths). The K8s preview ingress routes only
/api/* to backend (8001) — so via the public URL these paths hit the frontend
SPA. We assert correctness against the BACKEND DIRECTLY (localhost:8001) and
log the public-URL behavior as INFRASTRUCTURE_NOTE for the main agent.
"""
from __future__ import annotations

import asyncio
import os
import uuid

import pytest
import requests
from motor.motor_asyncio import AsyncIOMotorClient

BASE_URL = os.environ.get(
    "EXPO_PUBLIC_BACKEND_URL",
    "https://padel-tournament-hub-9.preview.emergentagent.com",
).rstrip("/")
BACKEND_DIRECT = "http://localhost:8001"

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


@pytest.fixture(scope="module")
def mongo_db():
    client = AsyncIOMotorClient(MONGO_URL)
    db = client[DB_NAME]
    yield db
    client.close()


# ============================================================
# Section 1 — .well-known endpoints (BACKEND DIRECT)
# ============================================================
class TestWellKnownBackendDirect:
    """AASA + assetlinks.json served by the FastAPI app at localhost:8001."""

    def test_aasa_status_and_content_type(self):
        r = requests.get(f"{BACKEND_DIRECT}/.well-known/apple-app-site-association", timeout=10)
        assert r.status_code == 200
        assert r.headers.get("content-type", "").startswith("application/json")

    def test_aasa_payload_structure(self):
        r = requests.get(f"{BACKEND_DIRECT}/.well-known/apple-app-site-association", timeout=10)
        data = r.json()
        assert "applinks" in data
        details = data["applinks"]["details"]
        assert isinstance(details, list) and len(details) >= 1
        assert "appIDs" in details[0] and isinstance(details[0]["appIDs"], list)
        # Components must include path /retas/*
        comps = details[0]["components"]
        assert any(c.get("/") == "/retas/*" for c in comps)

    def test_assetlinks_status_and_content_type(self):
        r = requests.get(f"{BACKEND_DIRECT}/.well-known/assetlinks.json", timeout=10)
        assert r.status_code == 200
        assert r.headers.get("content-type", "").startswith("application/json")

    def test_assetlinks_payload_structure(self):
        r = requests.get(f"{BACKEND_DIRECT}/.well-known/assetlinks.json", timeout=10)
        data = r.json()
        assert isinstance(data, list) and len(data) >= 1
        entry = data[0]
        assert entry["relation"] == ["delegate_permission/common.handle_all_urls"]
        tgt = entry["target"]
        assert tgt["namespace"] == "android_app"
        assert tgt["package_name"] == "com.padelappretas.app"
        assert isinstance(tgt["sha256_cert_fingerprints"], list)
        assert len(tgt["sha256_cert_fingerprints"]) >= 1


# ============================================================
# Section 2 — .well-known endpoints (PUBLIC URL · ingress reachability)
# ============================================================
class TestWellKnownPublicURL:
    """The K8s preview ingress only forwards /api/* to backend. Anything else
    goes to the Expo frontend on :3000. So via the public URL these paths
    currently return the SPA HTML. This is an INFRASTRUCTURE concern that the
    PRODUCTION DNS / ingress at padelappretas.app MUST resolve before
    Universal/App Links can work end-to-end on devices."""

    def test_aasa_public_url_returns_non_json(self):
        r = requests.get(f"{BASE_URL}/.well-known/apple-app-site-association", timeout=10,
                         allow_redirects=True)
        ct = r.headers.get("content-type", "")
        if r.status_code == 200 and ct.startswith("application/json"):
            # Production ingress already configured — great.
            assert "applinks" in r.json()
        else:
            # Preview state: SPA HTML or 404. Flag as info, not failure.
            pytest.skip(
                f"INFRA_NOTE: Public ingress does not route .well-known/* to "
                f"backend (got {r.status_code} {ct}). Backend serves it "
                f"correctly on direct hit. Production at padelappretas.app "
                f"must route /.well-known/* to backend."
            )

    def test_assetlinks_public_url_returns_non_json(self):
        r = requests.get(f"{BASE_URL}/.well-known/assetlinks.json", timeout=10,
                         allow_redirects=True)
        ct = r.headers.get("content-type", "")
        if r.status_code == 200 and ct.startswith("application/json"):
            assert isinstance(r.json(), list)
        else:
            pytest.skip(
                f"INFRA_NOTE: Public ingress does not route .well-known/* to "
                f"backend (got {r.status_code} {ct})."
            )


# ============================================================
# Section 3 — POST /api/register-push
# ============================================================
TEST_USER_PREFIX = "TEST_iter47_"


class TestRegisterPush:
    """Push token relay to Emergent gateway. While EMERGENT_PUSH_KEY=placeholder
    the upstream returns 401 and our backend converts it to 201 +
    status='pending_deploy'."""

    def test_register_push_android_pending_deploy(self):
        uid = f"{TEST_USER_PREFIX}{uuid.uuid4().hex[:10]}"
        r = requests.post(
            f"{BASE_URL}/api/register-push",
            json={"user_id": uid, "platform": "android",
                  "device_token": "androidtoken_" + uuid.uuid4().hex},
            timeout=15,
        )
        assert r.status_code == 201, r.text
        body = r.json()
        assert body["user_id"] == uid
        assert body["status"] in ("pending_deploy", "registered")

    def test_register_push_ios(self):
        uid = f"{TEST_USER_PREFIX}{uuid.uuid4().hex[:10]}"
        r = requests.post(
            f"{BASE_URL}/api/register-push",
            json={"user_id": uid, "platform": "ios",
                  "device_token": "iostoken_" + uuid.uuid4().hex},
            timeout=15,
        )
        assert r.status_code == 201
        assert r.json()["user_id"] == uid

    def test_register_push_web(self):
        uid = f"{TEST_USER_PREFIX}{uuid.uuid4().hex[:10]}"
        r = requests.post(
            f"{BASE_URL}/api/register-push",
            json={"user_id": uid, "platform": "web",
                  "device_token": "webtoken_" + uuid.uuid4().hex},
            timeout=15,
        )
        assert r.status_code == 201

    @pytest.mark.parametrize("payload,field", [
        ({"user_id": "", "platform": "android", "device_token": "abcdef1234567890zz"}, "user_id"),
        ({"user_id": "u1", "platform": "linux", "device_token": "abcdef1234567890zz"}, "platform"),
        ({"user_id": "u1", "platform": "android", "device_token": "short"}, "device_token"),
        ({"user_id": "u1", "platform": "android"}, "device_token"),  # missing
        ({"platform": "android", "device_token": "abcdef1234567890zz"}, "user_id"),  # missing
    ])
    def test_register_push_validation_422(self, payload, field):
        r = requests.post(f"{BASE_URL}/api/register-push", json=payload, timeout=10)
        assert r.status_code == 422, r.text
        detail = r.json()["detail"]
        assert any(field in (d.get("loc") or []) for d in detail), f"Expected {field} error · got {detail}"

    def test_register_push_idempotent_upsert(self, mongo_db):
        uid = f"{TEST_USER_PREFIX}idem_{uuid.uuid4().hex[:8]}"
        # First call
        r1 = requests.post(
            f"{BASE_URL}/api/register-push",
            json={"user_id": uid, "platform": "android", "device_token": "tokenA_" + uuid.uuid4().hex},
            timeout=15,
        )
        assert r1.status_code == 201
        # Second call (different token, same user_id)
        r2 = requests.post(
            f"{BASE_URL}/api/register-push",
            json={"user_id": uid, "platform": "android", "device_token": "tokenB_" + uuid.uuid4().hex},
            timeout=15,
        )
        assert r2.status_code == 201
        # Verify single document
        count = _run(mongo_db.push_registrations.count_documents({"user_id": uid}))
        assert count == 1, f"Expected 1 audit doc, got {count}"

    def test_audit_stores_fingerprint_not_full_token(self, mongo_db):
        uid = f"{TEST_USER_PREFIX}fp_{uuid.uuid4().hex[:8]}"
        full_token = "VERY_LONG_TOKEN_" + uuid.uuid4().hex + uuid.uuid4().hex
        r = requests.post(
            f"{BASE_URL}/api/register-push",
            json={"user_id": uid, "platform": "android", "device_token": full_token},
            timeout=15,
        )
        assert r.status_code == 201
        doc = _run(mongo_db.push_registrations.find_one({"user_id": uid}))
        assert doc is not None
        assert "token_fingerprint" in doc
        fp = doc["token_fingerprint"]
        # Must be the truncated form (first 8 chars + ellipsis), NOT the full token.
        assert fp == full_token[:8] + "..."
        assert full_token not in fp
        # Other fields
        assert doc["status"] in ("pending_deploy", "registered")
        assert doc["platform"] == "android"
        assert "created_at" in doc
        assert "updated_at" in doc


# ============================================================
# Section 4 — Regression smoke (iter45/iter46 critical paths)
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


# ============================================================
# Teardown — purge test docs
# ============================================================
@pytest.fixture(scope="module", autouse=True)
def cleanup(mongo_db):
    yield
    try:
        _run(mongo_db.push_registrations.delete_many(
            {"user_id": {"$regex": f"^{TEST_USER_PREFIX}"}}
        ))
    except Exception:
        pass
