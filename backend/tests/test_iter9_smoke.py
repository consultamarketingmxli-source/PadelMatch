"""Iter9 smoke — endpoints críticos para validación E2E Fase C+D."""
import os
import pytest
import requests

BASE = (os.environ.get("EXPO_BACKEND_URL") or os.environ.get("EXPO_PUBLIC_BACKEND_URL") or "https://padel-tournament-hub-9.preview.emergentagent.com").rstrip("/")
ADMIN_EMAIL = "admin@padelappretas.com"
ADMIN_PASS = "admin123"
RETA_ID = "6012defc-2e74-4b14-abc2-313787a3d3e7"
RETA_SLUG = "reta-demo-padel-club-cdmx-2026-06-15"


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{BASE}/api/auth/login", json={"username": ADMIN_EMAIL, "password": ADMIN_PASS}, timeout=10)
    assert r.status_code == 200, f"login failed {r.status_code} {r.text}"
    data = r.json()
    assert "access_token" in data
    return data["access_token"]


@pytest.fixture
def auth_headers(token):
    return {"Authorization": f"Bearer {token}"}


# ===== AUTH =====
def test_admin_login_ok():
    r = requests.post(f"{BASE}/api/auth/login", json={"username": ADMIN_EMAIL, "password": ADMIN_PASS}, timeout=10)
    assert r.status_code == 200
    assert r.json().get("token_type", "").lower() == "bearer"


def test_admin_login_bad_password():
    r = requests.post(f"{BASE}/api/auth/login", json={"username": ADMIN_EMAIL, "password": "wrong"}, timeout=10)
    assert r.status_code in (400, 401, 403, 422)


# ===== RETAS ADMIN =====
def test_list_retas_admin(auth_headers):
    r = requests.get(f"{BASE}/api/retas", headers=auth_headers, timeout=10)
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data, list)


# ===== PUBLIC SEARCH =====
def test_buscar_sin_params():
    r = requests.get(f"{BASE}/api/public/retas/buscar", timeout=10)
    assert r.status_code == 200
    assert isinstance(r.json(), list)


def test_buscar_con_texto():
    r = requests.get(f"{BASE}/api/public/retas/buscar?q=padel", timeout=10)
    assert r.status_code == 200


# ===== PUBLIC RETA BY SLUG =====
def test_get_reta_by_slug():
    r = requests.get(f"{BASE}/api/public/retas/{RETA_SLUG}", timeout=10)
    # 200 si la reta demo existe; 404 si fue borrada
    assert r.status_code in (200, 404), f"got {r.status_code}: {r.text[:200]}"
    if r.status_code == 200:
        data = r.json()
        assert data.get("url_slug") == RETA_SLUG


# ===== CLASIFICACIÓN (admin) =====
def test_clasificacion_admin(auth_headers):
    r = requests.get(f"{BASE}/api/retas/{RETA_ID}/clasificacion", headers=auth_headers, timeout=10)
    # 200 si reta existe, 404 si no
    assert r.status_code in (200, 404), f"got {r.status_code}: {r.text[:200]}"
    if r.status_code == 200:
        assert isinstance(r.json(), list)


def test_clasificacion_sin_token():
    r = requests.get(f"{BASE}/api/retas/{RETA_ID}/clasificacion", timeout=10)
    assert r.status_code in (401, 403)


# ===== RESULTADOS =====
def test_listar_resultados_admin(auth_headers):
    r = requests.get(f"{BASE}/api/retas/{RETA_ID}/resultados", headers=auth_headers, timeout=10)
    assert r.status_code in (200, 404)
    if r.status_code == 200:
        assert isinstance(r.json(), list)


# ===== ROL =====
def test_rol_admin(auth_headers):
    r = requests.get(f"{BASE}/api/retas/{RETA_ID}/rol", headers=auth_headers, timeout=15)
    # 200 OK, 400 si no hay jugadores aprobados suficientes, 404 si reta no existe
    assert r.status_code in (200, 400, 404), f"got {r.status_code}: {r.text[:200]}"


# ===== WS smoke (handshake) =====
def test_ws_endpoint_requires_token():
    """Solo verificamos que el endpoint exista (devuelve 403 sin token, no 404)."""
    import websocket
    url = BASE.replace("https://", "wss://").replace("http://", "ws://") + f"/api/ws/retas/{RETA_ID}"
    ws = websocket.WebSocket()
    try:
        ws.connect(url, timeout=5)
        # si conecta sin token, es bug
        ws.close()
        pytest.fail("WS aceptó conexión sin token")
    except websocket.WebSocketBadStatusException as e:
        # esperado: 403 o 4403
        assert e.status_code in (401, 403), f"got {e.status_code}"
    except Exception as e:
        # Otros (timeout, conn reset) — toleramos
        msg = str(e).lower()
        assert "403" in msg or "401" in msg or "handshake" in msg or "rejected" in msg, f"unexpected: {e}"


def test_ws_connects_with_admin_token(token):
    import json
    import websocket
    url = BASE.replace("https://", "wss://").replace("http://", "ws://") + f"/api/ws/retas/{RETA_ID}?token={token}"
    ws = websocket.WebSocket()
    try:
        ws.connect(url, timeout=10)
        ws.settimeout(5)
        msg = ws.recv()
        data = json.loads(msg)
        assert data.get("type") == "hello"
        assert data.get("role") == "admin"
    finally:
        try:
            ws.close()
        except Exception:
            pass
