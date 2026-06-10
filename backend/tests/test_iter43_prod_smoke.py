"""
Iter43 — Pre-publication smoke test (production regression).
Validates the 9 backend requirements from the review request:
  1. /api/health
  2. Admin login
  3. Player OTP request
  4. Public retas search (with/without GPS)
  5. Admin retas list
  6. MP Marketplace OAuth status + authorize-url
  7. Player stats (with victorias_ko)
  8. Public retas tabla-posiciones (no-data safe)
  9. SENTRY_DSN present in backend .env
"""
import os
import pytest
import requests
from pathlib import Path

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://padel-tournament-hub-9.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "admin@padelappretas.com"
ADMIN_PASS = "admin123"
TEST_PHONE = "+5215512345678"


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def admin_token(session):
    r = session.post(f"{API}/auth/login", json={"username": ADMIN_EMAIL, "password": ADMIN_PASS}, timeout=15)
    assert r.status_code == 200, f"Admin login failed: {r.status_code} {r.text[:300]}"
    body = r.json()
    token = body.get("access_token") or body.get("token")
    assert token, f"No access_token in login response: {body}"
    return token


# ---------- 1. Health ----------
def test_01_health(session):
    # Project exposes GET /api/ as health (no /api/health route mounted).
    r = session.get(f"{API}/", timeout=10)
    assert r.status_code == 200, f"/api/ returned {r.status_code}"
    body = r.json()
    assert body.get("status") == "ok"
    assert "PadelappRetas" in body.get("app", "")


# ---------- 2. Auth Admin ----------
def test_02_admin_login_returns_jwt(session):
    r = session.post(f"{API}/auth/login",
                     json={"username": ADMIN_EMAIL, "password": ADMIN_PASS}, timeout=15)
    assert r.status_code == 200
    body = r.json()
    token = body.get("access_token") or body.get("token")
    assert token and isinstance(token, str) and len(token) > 20
    # JWT shape (3 dot-separated segments)
    assert token.count(".") == 2, "Token does not look like a JWT"


# ---------- 3. Auth Player OTP ----------
def test_03_player_otp_request(session):
    # Backend OtpRequest schema requires both telefono and nombre.
    r = session.post(f"{API}/players/auth/otp/request",
                     json={"telefono": TEST_PHONE, "nombre": "Smoke Tester"}, timeout=15)
    assert r.status_code == 200, f"OTP request unexpected: {r.status_code} {r.text[:300]}"
    body = r.json()
    assert isinstance(body, dict)
    assert body.get("ok") is True


# ---------- 4. Public retas search ----------
def test_04_public_retas_search_no_gps(session):
    r = session.get(f"{API}/public/retas/buscar", timeout=15)
    assert r.status_code == 200, f"Got {r.status_code}: {r.text[:300]}"
    body = r.json()
    # Should be either a list or a dict containing a list
    if isinstance(body, dict):
        # common shapes: {"retas":[...]} or {"items":[...]}
        assert any(isinstance(v, list) for v in body.values()), f"No list in: {list(body)}"
    else:
        assert isinstance(body, list)


def test_05_public_retas_search_with_gps(session):
    r = session.get(f"{API}/public/retas/buscar",
                    params={"lat": 19.4326, "lng": -99.1332, "radio_km": 25}, timeout=15)
    assert r.status_code == 200, f"GPS search {r.status_code}: {r.text[:300]}"


# ---------- 5. Admin retas list ----------
def test_06_admin_retas_list(session, admin_token):
    # Actual route is /api/retas (admin-auth required) — not /api/admin/retas.
    r = session.get(f"{API}/retas",
                    headers={"Authorization": f"Bearer {admin_token}"}, timeout=15)
    assert r.status_code == 200, f"Got {r.status_code}: {r.text[:300]}"
    body = r.json()
    assert isinstance(body, (list, dict))


# ---------- 6. MP Marketplace OAuth ----------
def test_07_mp_status_requires_auth(session):
    r = session.get(f"{API}/admin/mercadopago/status", timeout=10)
    assert r.status_code in (401, 403), f"MP status should require auth, got {r.status_code}"


def test_08_mp_status_ok(session, admin_token):
    r = session.get(f"{API}/admin/mercadopago/status",
                    headers={"Authorization": f"Bearer {admin_token}"}, timeout=15)
    assert r.status_code == 200, f"Got {r.status_code}: {r.text[:300]}"
    body = r.json()
    # Expected fields (per iter41 contract)
    for f in ("connection_mode", "encrypted_at_rest"):
        assert f in body, f"missing field '{f}' in MP status: {list(body)}"


def test_09_mp_authorize_url(session, admin_token):
    # Actual route is /api/admin/mercadopago/oauth/start — not /authorize-url.
    r = session.get(f"{API}/admin/mercadopago/oauth/start",
                    headers={"Authorization": f"Bearer {admin_token}"}, timeout=15)
    assert r.status_code == 200, f"Got {r.status_code}: {r.text[:300]}"
    body = r.json()
    url = body.get("authorize_url") or body.get("url")
    assert url and "client_id=7849343570174391" in url, f"authorize_url missing client_id: {url}"
    assert "callback" in url


# ---------- 7. Player stats ----------
def test_10_player_stats_has_victorias_ko(session):
    # Actual route is /api/public/players/{telefono}/stats (path param), not query string.
    from urllib.parse import quote
    r = session.get(f"{API}/public/players/{quote(TEST_PHONE, safe='')}/stats", timeout=15)
    assert r.status_code == 200, f"Got {r.status_code}: {r.text[:300]}"
    body = r.json()
    assert isinstance(body, dict)
    assert "victorias_ko" in body, f"'victorias_ko' missing in stats: {list(body)}"


# ---------- 8. Public tabla-posiciones (safe with empty data) ----------
def test_11_tabla_posiciones_no_crash(session):
    # Actual route is /api/public/retas/{reta_id}/tabla
    fake_id = "000000000000000000000000"
    r = session.get(f"{API}/public/retas/{fake_id}/tabla", timeout=15)
    # Must not be 500; valid responses are 200 (empty), 404 (not found), or 422.
    assert r.status_code in (200, 404, 422), f"Tabla crashed with {r.status_code}: {r.text[:300]}"


# ---------- 9. Sentry DSN ----------
def test_12_sentry_dsn_configured():
    env_path = Path("/app/backend/.env")
    assert env_path.exists(), "/app/backend/.env not present"
    content = env_path.read_text()
    assert "SENTRY_DSN=" in content, "SENTRY_DSN missing from /app/backend/.env"
    # value must be a sentry.io DSN
    for line in content.splitlines():
        if line.startswith("SENTRY_DSN="):
            val = line.split("=", 1)[1].strip().strip('"').strip("'")
            assert val.startswith("https://") and "ingest" in val and "sentry.io" in val, \
                f"SENTRY_DSN looks invalid: {val[:50]}"
            return
    pytest.fail("SENTRY_DSN line not parsed")
