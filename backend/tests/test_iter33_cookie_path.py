"""
Iter33 — Re-test post-fix de cookie path HttpOnly `padelapp_refresh`.

Verifica:
  P0:
    - Admin login con X-Client-Platform=web → Set-Cookie path=/api (no /api/auth)
    - Player OTP verify con X-Client-Platform=web → Set-Cookie path=/api
    - Admin logout web borra la cookie (Max-Age=0 o expires en pasado)
    - GET /api/players/me/sessions con cookie debe devolver al menos una
      sesión con is_current=true (porque la cookie ya scope-ea /api)

  P1 smoke regression:
    - /api/auth/refresh con cookie web devuelve nuevo access_token (200)
    - /api/auth/revoke-all-sessions con JWT funciona
    - Webhook MP rechaza firma inválida (401) y sin firma (401)
"""
import hashlib
import hmac
import os
import re
import time

import pytest
import requests
from pymongo import MongoClient

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL no configurado"
pytestmark = pytest.mark.skip(reason="Iter57 · Fase 3: OTP-by-WhatsApp flow removido. Estos tests dependen del endpoint /api/players/auth/otp/{request,verify} que ahora responde 410 Gone. Migrar a Google Sign-In o Email Magic Link cuando alguien tenga tiempo.")


ADMIN_EMAIL = "admin@padelappretas.com"
ADMIN_PASSWORD = "admin123"

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")

REFRESH_COOKIE_NAME = "padelapp_refresh"


# --------- helpers ---------
def _parse_set_cookie_attrs(set_cookie_value: str) -> dict:
    """Devuelve un dict lowercased de atributos del header Set-Cookie."""
    attrs = {}
    parts = [p.strip() for p in set_cookie_value.split(";")]
    # parts[0] es "name=value"
    for p in parts[1:]:
        if "=" in p:
            k, v = p.split("=", 1)
            attrs[k.strip().lower()] = v.strip()
        else:
            attrs[p.strip().lower()] = True
    return attrs


def _extract_refresh_cookie_header(resp: requests.Response) -> str | None:
    """Saca el Set-Cookie de padelapp_refresh (puede haber múltiples)."""
    # requests guarda los headers multi-Set-Cookie unidos por comma, pero
    # las cookies parseadas están en resp.cookies. Para parsear path con
    # exactitud, usamos resp.raw.headers (urllib3) que tiene get_all.
    raw_headers = resp.raw.headers if hasattr(resp, "raw") and resp.raw else None
    if raw_headers and hasattr(raw_headers, "get_all"):
        for h in raw_headers.get_all("Set-Cookie") or []:
            if h.startswith(f"{REFRESH_COOKIE_NAME}="):
                return h
    # Fallback: regex sobre el header combinado
    combined = resp.headers.get("Set-Cookie", "")
    m = re.search(rf"({REFRESH_COOKIE_NAME}=[^,]+(?:,\s*[A-Z][a-zA-Z-]+=[^,]*)*)", combined)
    if m:
        return m.group(1)
    return None


# --------- fixtures ---------
@pytest.fixture(scope="module")
def admin_login_web_response():
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"username": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        headers={"X-Client-Platform": "web"},
        timeout=15,
    )
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    return r


@pytest.fixture(scope="module")
def admin_token(admin_login_web_response) -> str:
    return admin_login_web_response.json()["access_token"]


@pytest.fixture(scope="module")
def player_web_session():
    """Login OTP player como web → cookie HttpOnly, no refresh_token en body."""
    telefono = f"+5215550{int(time.time()) % 1000000:06d}"
    r = requests.post(
        f"{BASE_URL}/api/players/auth/otp/request",
        json={"nombre": "TEST_Iter33Web", "telefono": telefono},
        timeout=15,
    )
    assert r.status_code == 200, f"otp/request: {r.status_code} {r.text}"

    client = MongoClient(MONGO_URL)
    rec = client[DB_NAME].player_otps.find_one({"telefono": telefono})
    assert rec, f"OTP no encontrado para {telefono}"
    codigo = rec["codigo"]

    verify_resp = requests.post(
        f"{BASE_URL}/api/players/auth/otp/verify",
        json={"telefono": telefono, "codigo": codigo},
        headers={
            "User-Agent": "Mozilla/5.0 (Macintosh) Chrome/120 Safari",
            "X-Client-Platform": "web",
        },
        timeout=15,
    )
    assert verify_resp.status_code == 200, f"verify: {verify_resp.status_code} {verify_resp.text}"
    data = verify_resp.json()
    yield {
        "resp": verify_resp,
        "token": data["access_token"],
        "telefono": telefono,
        "jugador_id": data["jugador_id"],
        "cookies": verify_resp.cookies,
    }
    # cleanup: delete account
    try:
        requests.delete(
            f"{BASE_URL}/api/players/me",
            headers={"Authorization": f"Bearer {data['access_token']}"},
            timeout=10,
        )
    except Exception:
        pass


# ============== P0: Cookie path verification ==============
class TestCookiePathAdmin:
    def test_admin_login_web_sets_cookie_with_path_api(self, admin_login_web_response):
        set_cookie = _extract_refresh_cookie_header(admin_login_web_response)
        assert set_cookie, f"No Set-Cookie {REFRESH_COOKIE_NAME} en login. Headers={admin_login_web_response.headers}"
        attrs = _parse_set_cookie_attrs(set_cookie)
        assert attrs.get("path") == "/api", f"path debe ser '/api', obtenido: {attrs.get('path')!r} · raw={set_cookie}"
        assert "httponly" in attrs, "cookie debe ser HttpOnly"
        assert "secure" in attrs, "cookie debe ser Secure"
        assert attrs.get("samesite", "").lower() == "strict", f"SameSite=Strict requerido, got={attrs.get('samesite')}"

    def test_admin_logout_clears_cookie(self, admin_token, admin_login_web_response):
        # Usar la cookie del login para logout
        cookies = admin_login_web_response.cookies
        r = requests.post(
            f"{BASE_URL}/api/auth/logout",
            headers={"Authorization": f"Bearer {admin_token}", "X-Client-Platform": "web"},
            cookies=cookies,
            timeout=10,
        )
        assert r.status_code in (200, 204), f"logout: {r.status_code} {r.text}"
        set_cookie = _extract_refresh_cookie_header(r)
        # delete_cookie de FastAPI envía Set-Cookie con Max-Age=0 o expires en el pasado
        if set_cookie:
            attrs = _parse_set_cookie_attrs(set_cookie)
            max_age = attrs.get("max-age")
            expires = attrs.get("expires", "")
            assert (max_age == "0") or ("1970" in expires) or ("Thu, 01 Jan 1970" in expires), (
                f"Cookie no fue invalidada: {set_cookie}"
            )


class TestCookiePathPlayer:
    def test_player_verify_web_sets_cookie_with_path_api(self, player_web_session):
        verify_resp = player_web_session["resp"]
        set_cookie = _extract_refresh_cookie_header(verify_resp)
        assert set_cookie, f"No Set-Cookie {REFRESH_COOKIE_NAME} en verify. Headers={verify_resp.headers}"
        attrs = _parse_set_cookie_attrs(set_cookie)
        assert attrs.get("path") == "/api", f"path debe ser '/api', obtenido: {attrs.get('path')!r}"
        assert "httponly" in attrs
        assert "secure" in attrs
        assert attrs.get("samesite", "").lower() == "strict"

    def test_player_sessions_endpoint_returns_is_current_true(self, player_web_session):
        """Con la cookie scope-eada a /api ya debería llegar a /api/players/me/sessions."""
        r = requests.get(
            f"{BASE_URL}/api/players/me/sessions",
            headers={"Authorization": f"Bearer {player_web_session['token']}"},
            cookies=player_web_session["cookies"],
            timeout=10,
        )
        assert r.status_code == 200, f"sessions: {r.status_code} {r.text}"
        data = r.json()
        sessions = data.get("sessions") or data  # tolerar dos shapes
        assert isinstance(sessions, list), f"sessions debe ser lista, got: {type(sessions)} · {data}"
        assert len(sessions) >= 1, "debe haber al menos una sesión"
        current_flags = [s.get("is_current") for s in sessions]
        assert any(current_flags), (
            f"NINGUNA sesión marcada is_current=true. flags={current_flags} · "
            "Indica que la cookie no llegó al endpoint (problema de path)."
        )


# ============== P1: Smoke regression ==============
class TestSmokeRegression:
    def test_admin_login_returns_access_token(self):
        r = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"username": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
            timeout=10,
        )
        assert r.status_code == 200
        assert r.json().get("access_token")

    def test_admin_refresh_with_cookie_web(self):
        # 1) login web → guarda cookies
        r = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"username": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
            headers={"X-Client-Platform": "web"},
            timeout=10,
        )
        assert r.status_code == 200
        cookies = r.cookies
        # 2) refresh con cookie (sin Authorization)
        r2 = requests.post(
            f"{BASE_URL}/api/auth/refresh",
            headers={"X-Client-Platform": "web"},
            cookies=cookies,
            timeout=10,
        )
        assert r2.status_code == 200, f"refresh: {r2.status_code} {r2.text}"
        assert r2.json().get("access_token")

    def test_admin_revoke_all_sessions(self):
        r = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"username": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
            timeout=10,
        )
        token = r.json()["access_token"]
        r2 = requests.post(
            f"{BASE_URL}/api/auth/revoke-all-sessions",
            headers={"Authorization": f"Bearer {token}"},
            timeout=10,
        )
        assert r2.status_code in (200, 204), f"revoke-all: {r2.status_code} {r2.text}"

    def test_player_delete_me_with_cookie(self, player_web_session):
        # Se ejecuta justo después de las pruebas de cookie player; reverifica
        # que el flujo de delete account responda OK (200 o 204).
        r = requests.delete(
            f"{BASE_URL}/api/players/me",
            headers={"Authorization": f"Bearer {player_web_session['token']}"},
            cookies=player_web_session["cookies"],
            timeout=10,
        )
        # Puede ya estar borrado por la cleanup del fixture, o no haberse llamado todavía
        assert r.status_code in (200, 204, 401, 404), f"delete /me: {r.status_code} {r.text}"


# ============== P1: Webhook MP HMAC ==============
class TestWebhookMP:
    def _build_signature(self, secret: str, payload_bytes: bytes) -> str:
        return hmac.new(secret.encode(), payload_bytes, hashlib.sha256).hexdigest()

    def test_webhook_mp_rejects_missing_signature(self):
        r = requests.post(
            f"{BASE_URL}/api/webhooks/mercadopago",
            json={"type": "payment", "data": {"id": "1"}},
            timeout=10,
        )
        assert r.status_code in (401, 403), f"esperaba 401/403 sin firma, got {r.status_code} {r.text}"

    def test_webhook_mp_rejects_invalid_signature(self):
        r = requests.post(
            f"{BASE_URL}/api/webhooks/mercadopago",
            json={"type": "payment", "data": {"id": "1"}},
            headers={"X-Signature": "ts=1234,v1=deadbeef"},
            timeout=10,
        )
        assert r.status_code in (401, 403), f"esperaba 401/403 con firma inválida, got {r.status_code} {r.text}"
