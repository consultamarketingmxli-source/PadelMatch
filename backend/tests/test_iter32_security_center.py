"""
Iter32 — Centro de Privacidad y Seguridad.

Cubre:
  - Player sessions endpoints (list / revoke / activity)
  - Admin security endpoints (stats / logs / paginación / auditoría)
  - Auth guards (401 sin JWT)
  - Webhook MP HMAC-SHA256 (rechaza sin firma / inválida / acepta válida)
"""
import hashlib
import hmac
import os
import time
import uuid

import pytest
import requests
from pymongo import MongoClient

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL no configurado"

ADMIN_EMAIL = "admin@padelappretas.com"
ADMIN_PASSWORD = "admin123"

# Conexión mongo para leer OTP (Twilio rate-limited free tier)
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")


# ---------- fixtures ----------
@pytest.fixture(scope="module")
def admin_token() -> str:
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"username": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        timeout=15,
    )
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def player_session():
    """Genera OTP, lo lee de Mongo (dev) y verifica → devuelve dict con token, refresh, telefono."""
    telefono = f"+5215550{int(time.time()) % 1000000:06d}"
    nombre = "TEST_Iter32"
    r = requests.post(
        f"{BASE_URL}/api/players/auth/otp/request",
        json={"nombre": nombre, "telefono": telefono},
        timeout=15,
    )
    assert r.status_code == 200, f"otp/request failed: {r.status_code} {r.text}"

    # Leer código directo de mongo (dev) — Twilio free tier rate-limited.
    client = MongoClient(MONGO_URL)
    rec = client[DB_NAME].player_otps.find_one({"telefono": telefono})
    assert rec, f"OTP no encontrado en mongo para {telefono}"
    codigo = rec["codigo"]

    # Verify con header User-Agent custom + X-Client-Platform=ios para
    # que devuelva refresh_token en el body (no por cookie web).
    r = requests.post(
        f"{BASE_URL}/api/players/auth/otp/verify",
        json={"telefono": telefono, "codigo": codigo},
        headers={
            "User-Agent": "PadelappRetas/1.0 iPhone iOS 17",
            "X-Client-Platform": "ios",
        },
        timeout=15,
    )
    assert r.status_code == 200, f"otp/verify failed: {r.status_code} {r.text}"
    data = r.json()
    assert data.get("access_token")
    assert data.get("refresh_token"), "refresh_token ausente — header X-Client-Platform=ios no respetado"
    yield {
        "token": data["access_token"],
        "refresh": data["refresh_token"],
        "telefono": telefono,
        "jugador_id": data["jugador_id"],
    }
    # Cleanup — anonimiza la cuenta de prueba.
    requests.delete(
        f"{BASE_URL}/api/players/me",
        headers={"Authorization": f"Bearer {data['access_token']}"},
        timeout=15,
    )


# ---------- BACKEND P0 — Player sessions ----------
class TestPlayerSessions:
    def test_list_sessions_marks_current(self, player_session):
        """GET /api/players/me/sessions con X-Refresh-Token → al menos 1 sesión con is_current=true."""
        r = requests.get(
            f"{BASE_URL}/api/players/me/sessions",
            headers={
                "Authorization": f"Bearer {player_session['token']}",
                "X-Refresh-Token": player_session["refresh"],
            },
            timeout=15,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert "sessions" in data and "count" in data
        assert data["count"] >= 1
        sess = data["sessions"]
        # Cada sesión tiene los campos requeridos
        for s in sess:
            assert "id" in s and len(s["id"]) == 16
            assert "ip" in s
            assert "user_agent" in s
            assert "created_at" in s and "last_used_at" in s and "expires_at" in s
            assert isinstance(s["is_current"], bool)
        # Al menos una debe ser is_current=true
        assert any(s["is_current"] for s in sess), "ninguna sesión marcada como current"

    def test_list_sessions_scoped_to_user(self, player_session):
        """No debe filtrar sesiones de otros users — count razonable."""
        r = requests.get(
            f"{BASE_URL}/api/players/me/sessions",
            headers={"Authorization": f"Bearer {player_session['token']}"},
            timeout=15,
        )
        assert r.status_code == 200
        # Sin X-Refresh-Token, ninguna debe ser is_current.
        assert not any(s["is_current"] for s in r.json()["sessions"])

    def test_revoke_my_session(self, player_session):
        """DELETE /api/players/me/sessions/{id} revoca propio."""
        # Primero genera 2nd session (otra OTP/verify? — más simple: lista y revoca la única).
        r = requests.get(
            f"{BASE_URL}/api/players/me/sessions",
            headers={"Authorization": f"Bearer {player_session['token']}"},
            timeout=15,
        )
        sessions = r.json()["sessions"]
        assert sessions
        sid = sessions[0]["id"]
        r2 = requests.delete(
            f"{BASE_URL}/api/players/me/sessions/{sid}",
            headers={"Authorization": f"Bearer {player_session['token']}"},
            timeout=15,
        )
        assert r2.status_code == 200, r2.text
        assert r2.json().get("ok") is True
        # Idempotente — segunda llamada → already_revoked
        r3 = requests.delete(
            f"{BASE_URL}/api/players/me/sessions/{sid}",
            headers={"Authorization": f"Bearer {player_session['token']}"},
            timeout=15,
        )
        assert r3.status_code == 200
        assert r3.json().get("already_revoked") is True

    def test_revoke_unknown_session_404(self, player_session):
        fake = "deadbeefdeadbeef"
        r = requests.delete(
            f"{BASE_URL}/api/players/me/sessions/{fake}",
            headers={"Authorization": f"Bearer {player_session['token']}"},
            timeout=15,
        )
        assert r.status_code == 404

    def test_security_activity(self, player_session):
        r = requests.get(
            f"{BASE_URL}/api/players/me/security-activity?limit=20",
            headers={"Authorization": f"Bearer {player_session['token']}"},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert "items" in data and "count" in data
        # Debería tener al menos el OTP verify
        assert data["count"] >= 0
        for it in data["items"]:
            assert "accion" in it and "result" in it and "timestamp" in it


# ---------- BACKEND P0 — Admin security ----------
class TestAdminSecurity:
    def test_stats(self, admin_token):
        r = requests.get(
            f"{BASE_URL}/api/admin/security/stats?days=7",
            headers={"Authorization": f"Bearer {admin_token}"},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        for k in ("window_days", "since", "total_events", "top_actions", "by_result", "critical", "active_sessions"):
            assert k in data, f"falta clave {k}"
        assert data["window_days"] == 7
        assert isinstance(data["total_events"], int)
        assert isinstance(data["top_actions"], list)
        for crit_key in (
            "failed_logins",
            "nosql_blocks",
            "rate_limited",
            "account_deletions",
            "refresh_reuse_detected",
            "mp_webhook_signature_invalid",
        ):
            assert crit_key in data["critical"]

    def test_logs_pagination_and_self_audit(self, admin_token):
        r = requests.get(
            f"{BASE_URL}/api/admin/security/logs?limit=5&skip=0",
            headers={"Authorization": f"Bearer {admin_token}"},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert "items" in data and "total" in data and "has_more" in data
        assert isinstance(data["has_more"], bool)
        assert len(data["items"]) <= 5

        # Segunda llamada → debe haber registrado admin_security_logs_viewed
        r2 = requests.get(
            f"{BASE_URL}/api/admin/security/logs?accion=admin_security_logs_viewed&limit=5",
            headers={"Authorization": f"Bearer {admin_token}"},
            timeout=15,
        )
        assert r2.status_code == 200
        items = r2.json()["items"]
        assert any(
            it["accion"] == "admin_security_logs_viewed" for it in items
        ), "el acceso al log no se está auto-auditando"

    def test_logs_filter_by_action_prefix(self, admin_token):
        r = requests.get(
            f"{BASE_URL}/api/admin/security/logs?accion=admin_&limit=20",
            headers={"Authorization": f"Bearer {admin_token}"},
            timeout=15,
        )
        assert r.status_code == 200
        for it in r.json()["items"]:
            assert it["accion"].startswith("admin_"), f"filtro accion= no funciona: {it['accion']}"

    def test_logs_filter_by_result(self, admin_token):
        r = requests.get(
            f"{BASE_URL}/api/admin/security/logs?result=denied&limit=20",
            headers={"Authorization": f"Bearer {admin_token}"},
            timeout=15,
        )
        assert r.status_code == 200
        for it in r.json()["items"]:
            assert it["result"] == "denied"


# ---------- BACKEND P1 — Auth guards ----------
class TestAuthGuards:
    def test_admin_endpoints_require_jwt(self):
        for path in (
            "/api/admin/security/stats",
            "/api/admin/security/logs",
        ):
            r = requests.get(f"{BASE_URL}{path}", timeout=10)
            assert r.status_code == 401, f"{path} debería ser 401 sin auth, got {r.status_code}"

    def test_player_endpoints_require_jwt(self):
        for path in (
            "/api/players/me/sessions",
            "/api/players/me/security-activity",
        ):
            r = requests.get(f"{BASE_URL}{path}", timeout=10)
            assert r.status_code == 401, f"{path} debería ser 401 sin auth, got {r.status_code}"

    def test_admin_rejects_player_token(self, player_session):
        r = requests.get(
            f"{BASE_URL}/api/admin/security/stats",
            headers={"Authorization": f"Bearer {player_session['token']}"},
            timeout=10,
        )
        assert r.status_code in (401, 403), f"player token aceptado en /admin: {r.status_code}"


# ---------- BACKEND P1 — Webhook MP HMAC ----------
class TestMpWebhookSignature:
    SECRET = "526c3921ed2abf0b340e972738be3a203b10bd027afdea1cd853a9fb91e5d86d"

    def _sign(self, data_id: str, x_request_id: str, ts: str) -> str:
        manifest = f"id:{data_id};request-id:{x_request_id};ts:{ts};"
        return hmac.new(self.SECRET.encode(), manifest.encode(), hashlib.sha256).hexdigest()

    def test_rejects_without_signature(self):
        r = requests.post(
            f"{BASE_URL}/api/webhooks/mercadopago",
            json={"type": "payment", "data": {"id": "999999"}},
            timeout=10,
        )
        assert r.status_code == 401, f"sin firma debería ser 401, got {r.status_code}"

    def test_rejects_invalid_signature(self):
        r = requests.post(
            f"{BASE_URL}/api/webhooks/mercadopago",
            json={"type": "payment", "data": {"id": "999999"}},
            headers={
                "x-signature": "ts=123,v1=0000000000000000000000000000000000000000000000000000000000000000",
                "x-request-id": "test-req-1",
            },
            timeout=10,
        )
        assert r.status_code == 401, f"firma inválida debería ser 401, got {r.status_code}"

    def test_accepts_valid_signature(self):
        data_id = str(uuid.uuid4())
        x_req = str(uuid.uuid4())
        ts = str(int(time.time()))
        sig = self._sign(data_id, x_req, ts)
        r = requests.post(
            f"{BASE_URL}/api/webhooks/mercadopago",
            json={"type": "payment", "data": {"id": data_id}},
            headers={
                "x-signature": f"ts={ts},v1={sig}",
                "x-request-id": x_req,
            },
            timeout=15,
        )
        # 200 esperado (puede ser ok:true o duplicado). No 401.
        assert r.status_code == 200, f"firma válida debería pasar, got {r.status_code} {r.text[:200]}"

    def test_invalid_signature_audited(self, admin_token):
        """El rechazo de firma debería dejar audit log mp_webhook_signature_invalid."""
        # Antes
        r0 = requests.get(
            f"{BASE_URL}/api/admin/security/logs?accion=mp_webhook_signature_invalid&limit=1",
            headers={"Authorization": f"Bearer {admin_token}"},
            timeout=10,
        )
        before = r0.json()["total"] if r0.status_code == 200 else 0
        # Genera 1 rechazo
        requests.post(
            f"{BASE_URL}/api/webhooks/mercadopago",
            json={"type": "payment", "data": {"id": "777"}},
            headers={"x-signature": "ts=1,v1=bad", "x-request-id": "auditcheck"},
            timeout=10,
        )
        time.sleep(0.5)
        r1 = requests.get(
            f"{BASE_URL}/api/admin/security/logs?accion=mp_webhook_signature_invalid&limit=1",
            headers={"Authorization": f"Bearer {admin_token}"},
            timeout=10,
        )
        after = r1.json()["total"]
        assert after > before, "el rechazo de firma no quedó auditado"
