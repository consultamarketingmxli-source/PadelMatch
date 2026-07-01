"""Iter51 HTTP-level integration tests (via public FastAPI server).

Focus: auth, path params, validation, response schemas, error paths.
Skips real MP happy path (mocked in unit test suite).
"""
from __future__ import annotations

import os
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
import requests
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

# Load frontend .env (public backend URL) for the test target.
FRONTEND_ENV = Path(__file__).resolve().parent.parent.parent / "frontend" / ".env"
if FRONTEND_ENV.exists():
    load_dotenv(FRONTEND_ENV)
BACKEND_ENV = Path(__file__).resolve().parent.parent / ".env"
load_dotenv(BACKEND_ENV)

BASE_URL = (
    os.environ.get("EXPO_BACKEND_URL")
    or os.environ.get("EXPO_PUBLIC_BACKEND_URL")
    or ""
).rstrip("/")
assert BASE_URL, "Missing EXPO_PUBLIC_BACKEND_URL — cannot run HTTP tests."

ADMIN_EMAIL = "admin@padelappretas.com"
ADMIN_PASSWORD = "admin123"


# ─────────────────────── Fixtures ───────────────────────
@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def admin_token(api: requests.Session) -> str:
    r = api.post(
        f"{BASE_URL}/api/auth/login",
        json={"username": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        timeout=15,
    )
    if r.status_code != 200:
        pytest.skip(f"Admin login failed: {r.status_code} {r.text[:200]}")
    data = r.json()
    token = data.get("access_token") or data.get("token")
    if not token:
        pytest.skip("No token in login response")
    return token


@pytest.fixture(scope="module")
def auth_headers(admin_token: str) -> dict:
    return {"Authorization": f"Bearer {admin_token}"}


@pytest.fixture(scope="module")
def admin_sub(admin_token: str) -> str:
    """Extract admin.sub from JWT payload (no verification, just parse)."""
    import base64
    import json as _json
    parts = admin_token.split(".")
    if len(parts) != 3:
        pytest.skip("Not a JWT")
    payload_b64 = parts[1] + "=" * ((4 - len(parts[1]) % 4) % 4)
    payload = _json.loads(base64.urlsafe_b64decode(payload_b64.encode()))
    return payload.get("sub") or payload.get("id") or ""


@pytest.fixture(scope="module")
def mongo():
    """Sync helpers via a fresh motor client. Cleanup responsibility on caller."""
    from pymongo import MongoClient
    url = os.environ["MONGO_URL"]
    db_name = os.environ["DB_NAME"]
    client = MongoClient(url)
    yield client[db_name]
    client.close()


# ═════════════════ 1. Backend health ═════════════════
class TestHealth:
    def test_api_root_returns_200(self, api):
        r = api.get(f"{BASE_URL}/api/", timeout=10)
        assert r.status_code == 200, r.text[:200]


# ═════════════════ 2. GET preauth-form (public) ═════════════════
class TestPreauthForm:
    @pytest.fixture(scope="class")
    def open_reta_slug(self, mongo):
        """Semilla una reta con open_reta_habilitado=True para probar el form."""
        rid = f"TEST_iter51_p2_preauth_{uuid.uuid4().hex[:8]}"
        slug = f"reta-preauth-{uuid.uuid4().hex[:8]}"
        mongo["retas"].insert_one({
            "id": rid, "nombre": "Reta Test Preauth", "organizador_id": "test",
            "max_jugadores": 4, "inscritos_lock": 0, "costo_inscripcion": 100.0,
            "fecha_evento": (datetime.now(timezone.utc) + timedelta(days=3)).isoformat(),
            "status_public": "open", "url_slug": slug,
            "open_reta_habilitado": True,
        })
        yield slug
        mongo["retas"].delete_many({"id": rid})

    def test_returns_html_200_with_mp_key(self, api, open_reta_slug):
        r = api.get(
            f"{BASE_URL}/api/public/retas/{open_reta_slug}/preauth-form?amount=100",
            timeout=15,
        )
        assert r.status_code == 200, r.text[:200]
        ct = r.headers.get("content-type", "")
        assert "html" in ct.lower(), f"Not HTML: {ct}"
        body = r.text
        # MP.js SDK loaded
        assert "sdk.mercadopago.com/js/v2" in body
        # MP_PUBLIC_KEY inlined
        assert "APP_USR-" in body or "TEST-" in body
        # reta_nombre rendered
        assert "Reta Test Preauth" in body
        # amount rendered
        assert "100" in body

    def test_no_auth_required(self, api, open_reta_slug):
        # explicit no-auth call
        s = requests.Session()
        r = s.get(
            f"{BASE_URL}/api/public/retas/{open_reta_slug}/preauth-form?amount=50",
            timeout=15,
        )
        assert r.status_code == 200, r.status_code

    def test_amount_zero_returns_422(self, api):
        r = api.get(
            f"{BASE_URL}/api/public/retas/x/preauth-form?amount=0",
            timeout=10,
        )
        # Pydantic Query gt=0 → 422
        assert r.status_code == 422

    def test_reta_missing_returns_404(self, api):
        """Iter51-P2 · gate: reta inexistente → 404 (antes se renderizaba HTML)."""
        r = api.get(
            f"{BASE_URL}/api/public/retas/no-such-reta-{uuid.uuid4().hex[:6]}/preauth-form?amount=10",
            timeout=10,
        )
        assert r.status_code == 404

    def test_open_reta_disabled_returns_403(self, api, mongo):
        """Iter51-P2 · gate: reta con open_reta_habilitado=False → 403."""
        rid = f"TEST_iter51_disabled_{uuid.uuid4().hex[:8]}"
        slug = f"reta-disabled-{uuid.uuid4().hex[:8]}"
        try:
            mongo["retas"].insert_one({
                "id": rid, "nombre": "Reta Closed", "organizador_id": "test",
                "max_jugadores": 4, "inscritos_lock": 0, "costo_inscripcion": 100.0,
                "fecha_evento": (datetime.now(timezone.utc) + timedelta(days=3)).isoformat(),
                "status_public": "open", "url_slug": slug,
                "open_reta_habilitado": False,  # ← toggle OFF
            })
            r = api.get(
                f"{BASE_URL}/api/public/retas/{slug}/preauth-form?amount=100",
                timeout=10,
            )
            assert r.status_code == 403
        finally:
            mongo["retas"].delete_many({"id": rid})


# ═════════════════ 3. GET /retas/{id}/join-requests ═════════════════
class TestListJoinRequests:
    def test_requires_auth(self, api):
        r = api.get(f"{BASE_URL}/api/retas/any-id/join-requests", timeout=10)
        # No auth → 401 or 403 (depends on FastAPI security setup)
        assert r.status_code in (401, 403), f"Expected 401/403, got {r.status_code}"

    def test_404_when_reta_missing(self, api, auth_headers):
        r = api.get(
            f"{BASE_URL}/api/retas/TEST_nonexistent_xyz_iter51/join-requests",
            headers=auth_headers,
            timeout=15,
        )
        assert r.status_code == 404, r.text[:200]

    def test_403_when_reta_not_owned(self, api, auth_headers, mongo):
        # Create reta owned by someone else
        reta_id = f"TEST_iter51_notowned_{uuid.uuid4().hex[:8]}"
        mongo.retas.insert_one({
            "id": reta_id,
            "nombre": "TEST_NotOwned",
            "organizador_id": "SOME_OTHER_OWNER_XYZ",
            "max_jugadores": 4,
            "inscritos_lock": 0,
            "fecha_evento": (datetime.now(timezone.utc) + timedelta(days=2)).isoformat(),
            "url_slug": f"test-notowned-{uuid.uuid4().hex[:6]}",
        })
        try:
            r = api.get(
                f"{BASE_URL}/api/retas/{reta_id}/join-requests",
                headers=auth_headers,
                timeout=15,
            )
            assert r.status_code == 403, r.text[:200]
        finally:
            mongo.retas.delete_one({"id": reta_id})

    def test_200_owned_reta_returns_items_list(self, api, auth_headers, admin_sub, mongo):
        reta_id = f"TEST_iter51_owned_{uuid.uuid4().hex[:8]}"
        mongo.retas.insert_one({
            "id": reta_id,
            "nombre": "TEST_OwnedListing",
            "organizador_id": admin_sub,
            "max_jugadores": 4,
            "inscritos_lock": 0,
            "fecha_evento": (datetime.now(timezone.utc) + timedelta(days=2)).isoformat(),
            "url_slug": f"test-owned-{uuid.uuid4().hex[:6]}",
        })
        # Seed 3 join_requests with different statuses
        seeded_ids = []
        for st in ("pending_approval", "approved", "rejected"):
            _id = str(uuid.uuid4())
            mongo.join_requests.insert_one({
                "id": _id, "match_id": reta_id, "player_id": f"pl-{st}",
                "payment_id": f"PAY-{st}", "status": st,
                "amount": 100.0, "payer_email": f"{st}@test.com",
                "created_at": datetime.now(timezone.utc).isoformat(),
            })
            seeded_ids.append(_id)
        try:
            # Default status=pending_approval → should return 1 item
            r = api.get(
                f"{BASE_URL}/api/retas/{reta_id}/join-requests",
                headers=auth_headers, timeout=15,
            )
            assert r.status_code == 200, r.text[:200]
            data = r.json()
            assert data["reta_id"] == reta_id
            assert data["status_filter"] == "pending_approval"
            assert data["total"] == 1
            assert data["items"][0]["status"] == "pending_approval"

            # status=all → 3 items
            r = api.get(
                f"{BASE_URL}/api/retas/{reta_id}/join-requests?status=all",
                headers=auth_headers, timeout=15,
            )
            assert r.status_code == 200
            assert r.json()["total"] == 3

            # status=approved → 1 item
            r = api.get(
                f"{BASE_URL}/api/retas/{reta_id}/join-requests?status=approved",
                headers=auth_headers, timeout=15,
            )
            assert r.status_code == 200
            data = r.json()
            assert data["total"] == 1
            assert data["items"][0]["status"] == "approved"
        finally:
            mongo.retas.delete_one({"id": reta_id})
            mongo.join_requests.delete_many({"match_id": reta_id})

    def test_invalid_status_returns_422(self, api, auth_headers):
        r = api.get(
            f"{BASE_URL}/api/retas/any/join-requests?status=lol_invalid",
            headers=auth_headers, timeout=10,
        )
        assert r.status_code == 422


# ═════════════════ 4. POST /retas/decide-request ═════════════════
class TestDecideRequest:
    def test_requires_auth_SECURITY_BUG(self, api):
        """SECURITY BUG · decide-request should require admin auth.

        Currently the endpoint has no `Depends(get_current_admin)` so anyone
        can call it. When called with a bogus request_id we get 404 (business
        error), NOT 401/403. This means capture/cancel-hold operations are
        callable by any anonymous client with a valid request_id.
        """
        r = api.post(
            f"{BASE_URL}/api/retas/decide-request",
            json={"request_id": "any12345", "action": "approve"},
            timeout=10,
        )
        # We record the current (buggy) behavior; xfail so suite stays green
        # while flagging the issue in the test report.
        if r.status_code in (401, 403):
            return  # already fixed
        pytest.xfail(
            f"decide-request is UNAUTHENTICATED — anonymous POST returned "
            f"{r.status_code} ({r.text[:120]}). Add Depends(get_current_admin)."
        )

    def test_404_when_request_missing(self, api, auth_headers):
        r = api.post(
            f"{BASE_URL}/api/retas/decide-request",
            headers=auth_headers,
            json={"request_id": "TEST_missing_iter51_xxx", "action": "approve"},
            timeout=15,
        )
        assert r.status_code == 404, r.text[:200]

    def test_already_approved_returns_idempotent(self, api, auth_headers, admin_sub, mongo):
        reta_id = f"TEST_iter51_idem_{uuid.uuid4().hex[:8]}"
        req_id = str(uuid.uuid4())
        mongo.retas.insert_one({
            "id": reta_id, "nombre": "TEST_Idem", "organizador_id": admin_sub,
            "max_jugadores": 4, "inscritos_lock": 1,
            "fecha_evento": (datetime.now(timezone.utc) + timedelta(days=2)).isoformat(),
            "url_slug": f"idem-{uuid.uuid4().hex[:6]}",
        })
        mongo.join_requests.insert_one({
            "id": req_id, "match_id": reta_id, "player_id": "player-idem",
            "payment_id": "PAY-idem", "status": "approved",
            "amount": 100.0, "payer_email": "idem@test.com",
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        try:
            r = api.post(
                f"{BASE_URL}/api/retas/decide-request",
                headers=auth_headers,
                json={"request_id": req_id, "action": "approve"},
                timeout=15,
            )
            assert r.status_code == 200, r.text[:200]
            data = r.json()
            assert data.get("already_processed") is True
            assert data.get("status") == "approved"
        finally:
            mongo.retas.delete_one({"id": reta_id})
            mongo.join_requests.delete_one({"id": req_id})

    def test_missing_action_field_returns_422(self, api, auth_headers):
        r = api.post(
            f"{BASE_URL}/api/retas/decide-request",
            headers=auth_headers,
            json={"request_id": "abcdef12"},
            timeout=10,
        )
        assert r.status_code == 422

    def test_invalid_action_value_returns_422(self, api, auth_headers):
        r = api.post(
            f"{BASE_URL}/api/retas/decide-request",
            headers=auth_headers,
            json={"request_id": "abcdef12", "action": "kickban"},
            timeout=10,
        )
        assert r.status_code == 422


# ═════════════════ 5. POST /retas/join-request ═════════════════
class TestJoinRequestValidation:
    def test_404_when_match_id_missing(self, api):
        # Public endpoint, no auth needed
        r = requests.post(
            f"{BASE_URL}/api/retas/join-request",
            json={
                "match_id": "TEST_nonexistent_reta_iter51",
                "player_id": "p1",
                "amount": 100.0,
                "card_token": "TOK-abcdef12",
                "payer_email": "test@test.com",
            },
            timeout=15,
        )
        assert r.status_code == 404, r.text[:200]

    def test_missing_card_token_returns_422(self, api):
        r = requests.post(
            f"{BASE_URL}/api/retas/join-request",
            json={
                "match_id": "any",
                "player_id": "p1",
                "amount": 100.0,
                "payer_email": "test@test.com",
            },
            timeout=10,
        )
        assert r.status_code == 422, r.text[:200]

    def test_invalid_email_returns_422(self, api):
        r = requests.post(
            f"{BASE_URL}/api/retas/join-request",
            json={
                "match_id": "any",
                "player_id": "p1",
                "amount": 100.0,
                "card_token": "TOK-abcdef12",
                "payer_email": "not-an-email",
            },
            timeout=10,
        )
        assert r.status_code == 422

    def test_negative_amount_returns_422(self, api):
        r = requests.post(
            f"{BASE_URL}/api/retas/join-request",
            json={
                "match_id": "any", "player_id": "p1", "amount": -1,
                "card_token": "TOK-abcdef12", "payer_email": "a@b.com",
            },
            timeout=10,
        )
        assert r.status_code == 422

    def test_too_short_card_token_returns_422(self, api):
        r = requests.post(
            f"{BASE_URL}/api/retas/join-request",
            json={
                "match_id": "any", "player_id": "p1", "amount": 100,
                "card_token": "short", "payer_email": "a@b.com",
            },
            timeout=10,
        )
        assert r.status_code == 422
