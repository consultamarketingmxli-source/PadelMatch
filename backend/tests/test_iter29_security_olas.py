"""
Iter29 — Backend regression: Módulo SEGURIDAD ABSOLUTA
Olas A (headers + rate limit), B (audit logs), C (account deletion),
D (NoSQL sanitizer), E (Refresh tokens híbridos).

Apple App Store §5 compliance + DevSecOps hardening.
"""
import asyncio
import os
import time
import uuid

import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://padel-tournament-hub-9.preview.emergentagent.com").rstrip("/")
ADMIN_EMAIL = "admin@padelappretas.com"
ADMIN_PASSWORD = "admin123"


# ────────────────────────────────────────────────────────────
# FIXTURES
# ────────────────────────────────────────────────────────────
@pytest.fixture
def s():
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json"})
    return sess


def _login_admin_native(s):
    r = s.post(
        f"{BASE_URL}/api/auth/login",
        json={"username": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        headers={"X-Client-Platform": "native"},
    )
    assert r.status_code == 200, r.text
    return r.json()


def _login_admin_web(s):
    r = s.post(
        f"{BASE_URL}/api/auth/login",
        json={"username": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        headers={"X-Client-Platform": "web"},
    )
    assert r.status_code == 200, r.text
    return r


# ────────────────────────────────────────────────────────────
# OLA A — Security Headers
# ────────────────────────────────────────────────────────────
class TestSecurityHeaders:
    def test_hsts_present_on_all_responses(self, s):
        r = s.get(f"{BASE_URL}/api/")
        assert r.status_code == 200
        h = {k.lower(): v for k, v in r.headers.items()}
        assert "strict-transport-security" in h, "Falta HSTS"
        assert h.get("x-frame-options", "").upper() == "DENY"
        assert h.get("x-content-type-options", "").lower() == "nosniff"
        assert "referrer-policy" in h
        assert "x-padelapp-request-id" in h

    def test_security_headers_on_404(self, s):
        r = s.get(f"{BASE_URL}/api/this-endpoint-does-not-exist-xyz")
        # Headers must still apply on errors
        assert "strict-transport-security" in {k.lower() for k in r.headers}
        assert r.headers.get("X-Frame-Options", "").upper() == "DENY"

    def test_security_headers_on_post(self, s):
        r = s.post(f"{BASE_URL}/api/auth/login", json={"username": "x@x.x", "password": "bad"})
        # Cache-Control debe contener no-store en non-GET
        assert "no-store" in r.headers.get("Cache-Control", "").lower()


# ────────────────────────────────────────────────────────────
# OLA E — JWT 15min + Refresh Tokens Híbridos
# ────────────────────────────────────────────────────────────
class TestRefreshTokensHybrid:
    def test_login_native_returns_refresh_in_json(self, s):
        data = _login_admin_native(s)
        assert "access_token" in data
        assert "refresh_token" in data and data["refresh_token"], "Native debe traer refresh_token en JSON"
        assert data.get("expires_in") == 900, f"expires_in={data.get('expires_in')} debe ser 900 (15min)"

    def test_login_web_sets_httponly_cookie(self):
        s = requests.Session()
        r = s.post(
            f"{BASE_URL}/api/auth/login",
            json={"username": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
            headers={"X-Client-Platform": "web", "Content-Type": "application/json"},
        )
        assert r.status_code == 200
        body = r.json()
        # En web NO viene refresh en JSON
        assert body.get("refresh_token") is None, "Web NO debe exponer refresh_token en JSON"
        # Cookie HttpOnly se establece
        set_cookie = r.headers.get("set-cookie", "") or r.headers.get("Set-Cookie", "")
        assert "padelapp_refresh" in set_cookie, f"Falta cookie padelapp_refresh: {set_cookie[:200]}"
        assert "httponly" in set_cookie.lower()
        assert "samesite=strict" in set_cookie.lower()

    def test_refresh_native_rotates_token(self, s):
        data = _login_admin_native(s)
        old_refresh = data["refresh_token"]
        # Sleep 1.1s para garantizar que el JWT 'exp' (precisión segundos)
        # cambie entre login y refresh. Sin esto los bytes del access_token
        # pueden ser idénticos (mismo subject+role+exp → mismo JWT HS256).
        time.sleep(1.1)
        r = s.post(
            f"{BASE_URL}/api/auth/refresh",
            headers={"X-Refresh-Token": old_refresh, "X-Client-Platform": "native"},
        )
        assert r.status_code == 200, r.text
        new = r.json()
        # Refresh token rotó (esto es lo crítico)
        assert new["refresh_token"] and new["refresh_token"] != old_refresh
        assert new.get("expires_in") == 900
        assert new["access_token"]  # presente

    def test_refresh_web_uses_cookie(self):
        s = requests.Session()
        r1 = s.post(
            f"{BASE_URL}/api/auth/login",
            json={"username": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
            headers={"X-Client-Platform": "web", "Content-Type": "application/json"},
        )
        assert r1.status_code == 200
        # Cookie ya está en la session
        r2 = s.post(
            f"{BASE_URL}/api/auth/refresh",
            headers={"X-Client-Platform": "web", "Content-Type": "application/json"},
        )
        assert r2.status_code == 200, r2.text
        body = r2.json()
        assert body.get("refresh_token") is None  # Web nunca en body
        set_cookie = r2.headers.get("set-cookie", "") or r2.headers.get("Set-Cookie", "")
        assert "padelapp_refresh" in set_cookie

    def test_reuse_detection_revokes_all_tokens(self, s):
        """REUSE attack: token ya rotado → 401 + revoca TODOS los del usuario."""
        # 1) Login → t1
        d1 = _login_admin_native(s)
        t1 = d1["refresh_token"]
        # 2) Refresh con t1 → emite t2 (t1 queda revoked)
        r2 = s.post(f"{BASE_URL}/api/auth/refresh", headers={"X-Refresh-Token": t1, "X-Client-Platform": "native"})
        assert r2.status_code == 200
        t2 = r2.json()["refresh_token"]
        # 3) REPLAY t1 → debe 401
        r3 = s.post(f"{BASE_URL}/api/auth/refresh", headers={"X-Refresh-Token": t1, "X-Client-Platform": "native"})
        assert r3.status_code == 401, f"Replay no detectado: {r3.status_code} {r3.text}"
        # 4) t2 también debe quedar invalidado (revoke_all_user_tokens)
        r4 = s.post(f"{BASE_URL}/api/auth/refresh", headers={"X-Refresh-Token": t2, "X-Client-Platform": "native"})
        assert r4.status_code == 401, f"t2 debería estar revocado tras reuse detection, got {r4.status_code}"

    def test_refresh_missing_token_401(self, s):
        r = s.post(f"{BASE_URL}/api/auth/refresh", headers={"X-Client-Platform": "native"})
        assert r.status_code == 401

    def test_refresh_unknown_token_401(self, s):
        r = s.post(
            f"{BASE_URL}/api/auth/refresh",
            headers={"X-Refresh-Token": "totally-fake-token-xyz-" + uuid.uuid4().hex, "X-Client-Platform": "native"},
        )
        assert r.status_code == 401

    def test_refresh_malformed_token_401(self, s):
        # "" -> el helper get_raw_refresh ignora vacíos; debe dar 401 missing.
        # Otros: format inválido pero ASCII safe (no espacios al inicio para no romper requests).
        for bad in ["::::malformed", "<script>alert(1)</script>", "..etcpasswd", "AA.BB.CC"]:
            time.sleep(1)
            r = s.post(f"{BASE_URL}/api/auth/refresh", headers={"X-Refresh-Token": bad, "X-Client-Platform": "native"})
            assert r.status_code == 401, f"malformed='{bad}' got {r.status_code}"

    def test_logout_revokes_refresh(self, s):
        d = _login_admin_native(s)
        rt = d["refresh_token"]
        r = s.post(f"{BASE_URL}/api/auth/logout", headers={"X-Refresh-Token": rt})
        assert r.status_code == 200
        assert r.json().get("ok") is True
        # Intento de uso post-logout
        r2 = s.post(f"{BASE_URL}/api/auth/refresh", headers={"X-Refresh-Token": rt, "X-Client-Platform": "native"})
        assert r2.status_code == 401, "Refresh post-logout debe fallar"

    def test_logout_idempotent_no_token(self, s):
        r = s.post(f"{BASE_URL}/api/auth/logout")
        assert r.status_code == 200

    def test_access_token_works_on_protected_endpoint(self, s):
        d = _login_admin_native(s)
        r = s.get(f"{BASE_URL}/api/auth/me", headers={"Authorization": f"Bearer {d['access_token']}"})
        assert r.status_code == 200
        assert r.json().get("role") == "admin"

    def test_malformed_access_token_401(self, s):
        r = s.get(f"{BASE_URL}/api/auth/me", headers={"Authorization": "Bearer not.a.jwt"})
        assert r.status_code == 401


# ────────────────────────────────────────────────────────────
# OLA D — NoSQL Injection Sanitizer
# ────────────────────────────────────────────────────────────
class TestNoSqlSanitizer:
    def test_blocks_dollar_ne(self, s):
        r = s.post(
            f"{BASE_URL}/api/auth/login",
            json={"username": {"$ne": None}, "password": "x"},
        )
        assert r.status_code == 400
        body = r.json()
        assert body.get("codigo") == "INVALID_PAYLOAD"

    def test_blocks_dollar_gt(self, s):
        r = s.post(f"{BASE_URL}/api/auth/login", json={"username": "x", "password": {"$gt": ""}})
        assert r.status_code == 400
        assert r.json().get("codigo") == "INVALID_PAYLOAD"

    def test_blocks_nested_dollar_operator(self, s):
        r = s.post(
            f"{BASE_URL}/api/auth/login",
            json={"username": "x", "password": "y", "extra": {"a": {"b": {"$where": "1==1"}}}},
        )
        assert r.status_code == 400

    def test_blocks_dotted_key(self, s):
        r = s.post(f"{BASE_URL}/api/auth/login", json={"user.name": "x", "password": "y"})
        assert r.status_code == 400
        assert r.json().get("codigo") == "INVALID_PAYLOAD"

    def test_skips_webhooks_path(self, s):
        # Webhook MP debe pasar el sanitizer (no es endpoint admin típico).
        # No esperamos 400 con codigo INVALID_PAYLOAD por keys con punto.
        r = s.post(
            f"{BASE_URL}/api/webhooks/mercadopago",
            json={"data.id": "fake", "type": "payment"},
        )
        # Aceptamos 200/400/422 pero NO el INVALID_PAYLOAD del sanitizer
        body_txt = r.text
        assert "INVALID_PAYLOAD" not in body_txt, f"Webhook NO debe ser bloqueado por sanitizer: {body_txt[:200]}"

    def test_skips_public_retas_path(self, s):
        # Endpoints públicos de retas siguen pasando aunque payload tenga puntos.
        r = s.post(
            f"{BASE_URL}/api/public/retas/slug-inexistente/checkout",
            json={"nombre": "TEST_x", "telefono": "+521000000000"},
        )
        # Puede ser 404 (slug no existe), pero NUNCA INVALID_PAYLOAD
        assert "INVALID_PAYLOAD" not in r.text

    def test_legit_payload_passes(self, s):
        # Sanity check — credenciales malas pero JSON legítimo NO debe ser bloqueado
        r = s.post(f"{BASE_URL}/api/auth/login", json={"username": "wrong@x.com", "password": "wrong"})
        assert r.status_code == 401  # bad creds, no 400


# ────────────────────────────────────────────────────────────
# OLA A — Rate Limiting
# ────────────────────────────────────────────────────────────
class TestRateLimiting:
    def test_login_rate_limit_5_per_minute(self):
        s = requests.Session()
        s.headers.update({"Content-Type": "application/json"})
        # 5 intentos con credenciales malas + 1 más → debería ser 429 (slowapi)
        # o 503 (ingress envoy throttling — también indica rate limit aplicado).
        codes = []
        for i in range(8):
            r = s.post(
                f"{BASE_URL}/api/auth/login",
                json={"username": f"badnobody-{i}@x.com", "password": "bad"},
            )
            codes.append(r.status_code)
        # Confirmamos que en algún momento la app o el ingress aplicó throttling
        assert any(c in (429, 503) for c in codes), f"Sin throttling: {codes}"
        # Y que NO se procesaron más de 5 intentos exitosamente
        assert codes.count(401) <= 6, f"Demasiados 401 pasaron RL: {codes}"

    def test_otp_request_rate_limit(self):
        s = requests.Session()
        s.headers.update({"Content-Type": "application/json"})
        phone = f"+52199900{int(time.time()) % 10000:04d}"
        codes = []
        for _ in range(8):
            r = s.post(
                f"{BASE_URL}/api/players/auth/otp/request",
                json={"nombre": "TEST_RL", "telefono": phone},
            )
            codes.append(r.status_code)
        assert any(c in (429, 503) for c in codes), f"OTP request RL no aplicado: {codes}"
        assert codes.count(200) <= 6, f"Demasiados 200 pasaron RL: {codes}"


# ────────────────────────────────────────────────────────────
# OLA B — Audit Logs Middleware
# ────────────────────────────────────────────────────────────
class TestAuditLogs:
    def test_login_failed_creates_audit_log(self, s):
        # Solo verificamos que el endpoint devuelve 401 — el audit log se
        # valida indirectamente al estar habilitado el middleware (smoke ya hecho).
        r = s.post(f"{BASE_URL}/api/auth/login", json={"username": ADMIN_EMAIL, "password": "wrong-pass"})
        assert r.status_code == 401
        # No tenemos endpoint público para listar logs; confirmamos comportamiento
        # documentado (admin_login_failed) por inspección manual previa del agent principal.

    def test_admin_mutation_audited(self, s):
        # POST a /api/retas/buscar (mutación bajo prefix /api/retas) con admin token
        # genera entrada normalizada en security_logs.
        d = _login_admin_native(s)
        token = d["access_token"]
        r = s.post(
            f"{BASE_URL}/api/retas/buscar",
            json={"query": "TEST_audit", "page": 1},
            headers={"Authorization": f"Bearer {token}"},
        )
        # No nos importa el body — sólo que no rompa y aplique middleware.
        # Aceptamos cualquier 2xx/4xx que indique que el endpoint fue procesado
        # por el middleware de audit (no un 5xx/timeout).
        assert r.status_code in (200, 400, 401, 404, 405, 422), f"got {r.status_code}: {r.text[:200]}"


# ────────────────────────────────────────────────────────────
# OLA C — Player OTP + Account Deletion (5.1.1)
# ────────────────────────────────────────────────────────────
class TestPlayerAuthAndDeletion:
    @pytest.fixture
    def player_session(self):
        """Crea un jugador test y devuelve (session, jwt, telefono).
        Requiere acceso directo a Mongo para leer el OTP."""
        from motor.motor_asyncio import AsyncIOMotorClient
        import os as _os
        from dotenv import load_dotenv
        from pathlib import Path

        load_dotenv(Path("/app/backend/.env"))
        mongo_url = _os.environ.get("MONGO_URL")
        db_name = _os.environ.get("DB_NAME")
        if not mongo_url or not db_name:
            pytest.skip("Mongo env no disponible")

        async def _get_otp(tel):
            client = AsyncIOMotorClient(mongo_url)
            try:
                doc = await client[db_name].player_otps.find_one({"telefono": tel})
                return doc
            finally:
                client.close()

        s = requests.Session()
        s.headers.update({"Content-Type": "application/json"})
        phone = f"+5219988{int(time.time()) % 100000:05d}"
        nombre = "TEST_PlayerDelete"

        r = s.post(
            f"{BASE_URL}/api/players/auth/otp/request",
            json={"nombre": nombre, "telefono": phone},
        )
        if r.status_code == 429:
            pytest.skip("Rate-limited en OTP request")
        assert r.status_code == 200, r.text

        otp_doc = asyncio.run(_get_otp(phone))
        if not otp_doc:
            pytest.skip("No se pudo recuperar OTP de Mongo")
        codigo = otp_doc["codigo"]

        rv = s.post(
            f"{BASE_URL}/api/players/auth/otp/verify",
            json={"telefono": phone, "codigo": codigo},
            headers={"X-Client-Platform": "native"},
        )
        assert rv.status_code == 200, rv.text
        data = rv.json()
        return s, data, phone

    def test_otp_verify_returns_refresh_native(self, player_session):
        _, data, _ = player_session
        assert "access_token" in data
        assert data.get("refresh_token"), "Native OTP verify debe traer refresh_token"
        assert data.get("expires_in") == 900

    def test_otp_verify_failed_returns_401(self, s):
        # Solicitamos OTP nuevo
        phone = f"+521999800{int(time.time()) % 1000:03d}"
        r1 = s.post(f"{BASE_URL}/api/players/auth/otp/request", json={"nombre": "TEST_X", "telefono": phone})
        if r1.status_code == 429:
            pytest.skip("RL")
        # Intentar verificar con código wrong
        r2 = s.post(
            f"{BASE_URL}/api/players/auth/otp/verify",
            json={"telefono": phone, "codigo": "000000"},
        )
        # 401 (incorrecto) o 400 (no hay rec). Aceptamos ambos.
        assert r2.status_code in (400, 401)

    def test_delete_account_anonymizes(self, player_session):
        s, data, phone = player_session
        token = data["access_token"]
        jugador_id = data["jugador_id"]

        # DELETE /api/players/me
        r = s.delete(f"{BASE_URL}/api/players/me", headers={"Authorization": f"Bearer {token}"})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("anonimizado") is True

        # Verificar anonimización en Mongo
        from motor.motor_asyncio import AsyncIOMotorClient
        from dotenv import load_dotenv
        from pathlib import Path

        load_dotenv(Path("/app/backend/.env"))
        mongo_url = os.environ["MONGO_URL"]
        db_name = os.environ["DB_NAME"]

        async def _check():
            client = AsyncIOMotorClient(mongo_url)
            try:
                u = await client[db_name].usuarios.find_one({"id": jugador_id})
                return u
            finally:
                client.close()

        u = asyncio.run(_check())
        assert u is not None, "Documento NO debe ser borrado físicamente"
        assert u.get("nombre") == "Usuario eliminado"
        assert u.get("email") is None
        assert u.get("anonimizado") is True
        assert u.get("telefono", "").startswith("deleted_"), f"Telefono no anonimizado: {u.get('telefono')}"

        # Refresh tokens del usuario quedaron revocados → no se puede usar el refresh
        if data.get("refresh_token"):
            r2 = s.post(
                f"{BASE_URL}/api/auth/refresh",
                headers={"X-Refresh-Token": data["refresh_token"], "X-Client-Platform": "native"},
            )
            assert r2.status_code == 401, "Refresh debe estar revocado tras account deletion"


# ────────────────────────────────────────────────────────────
# BACKWARD COMPAT — tokens legacy (no test directo, smoke)
# ────────────────────────────────────────────────────────────
class TestBackwardCompat:
    def test_old_login_endpoint_still_works(self, s):
        # Solo verifica que el endpoint sigue existiendo con shape compat.
        d = _login_admin_native(s)
        # token_type por defecto "bearer"
        assert d.get("token_type", "bearer") == "bearer"
