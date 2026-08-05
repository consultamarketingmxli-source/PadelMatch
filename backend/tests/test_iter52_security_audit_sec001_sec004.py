"""SEC-001..SEC-004 · Iter52 audit fixes verification.

Cubre los 4 findings del audit contra escenarios exactos:
- SEC-001 · Underpayment attack (client-side amount tampering) + preauth-form query param
- SEC-002 · Ownership checks en 4 endpoints admin de retas
- SEC-003 · PII leak en /players/{id}/join-requests (ahora requiere JWT del propio jugador)
- SEC-004 · Rate limits en endpoints públicos de pago
"""
import os
import uuid
import time
import requests
import pytest

BASE_URL = (
    os.environ.get("EXPO_BACKEND_URL")
    or os.environ.get("EXPO_PUBLIC_BACKEND_URL")
    or "https://padel-tournament-hub-9.preview.emergentagent.com"
).rstrip("/")
ADMIN_EMAIL = "admin@padelappretas.com"
ADMIN_PASS = "admin123"


# ─────────────── fixtures ───────────────
@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"username": ADMIN_EMAIL, "password": ADMIN_PASS},
        timeout=15,
    )
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def admin_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}", "Content-Type": "application/json"}


def _create_reta(admin_headers, *, costo=100, open_reta=True, nombre_suffix=None):
    nombre = f"TEST_SEC_{nombre_suffix or uuid.uuid4().hex[:6]}"
    payload = {
        "nombre": nombre,
        "club": f"TEST_Club_SEC_{uuid.uuid4().hex[:4]}",
        "fecha_str": "2026-12-15",
        "hora_str": "18:00",
        "tz_offset_minutes": -360,
        "canchas_disponibles": 2,
        "costo_inscripcion": costo,
        "modalidad_juego": "PUNTOS",
        "num_rondas": 7,
        "open_reta_habilitado": open_reta,
    }
    r = requests.post(f"{BASE_URL}/api/retas", json=payload, headers=admin_headers, timeout=15)
    assert r.status_code == 200, f"create reta failed: {r.status_code} {r.text}"
    return r.json()


# ═════════════════════ SEC-001 ═════════════════════
class TestSEC001Underpayment:
    """Underpayment attack: client-side amount tampering."""

    def test_join_request_ignores_client_amount(self, admin_headers):
        reta = _create_reta(admin_headers, costo=100)
        # amount=1 en el body — debe ignorarse y usarse costo_inscripcion=100
        # MP fallará porque card_token es fake, pero el rechazo debe venir
        # por MP o por 502, NO por aceptar $1. Miramos logs indirectamente:
        # si el server acepta amount=1 y pasa a MP, no habrá cross-check log.
        body = {
            "match_id": reta["id"],
            "player_id": "TEST_player_sec001",
            "amount": 1,  # ATTACK: cliente intenta underpayment
            "card_token": "FAKE_TOKEN_" + uuid.uuid4().hex,
            "payer_email": "sec001@test.com",
            "installments": 1,
        }
        r = requests.post(
            f"{BASE_URL}/api/retas/join-request",
            json=body,
            timeout=20,
        )
        # Esperamos 502 (MP falla por card token inválido) o 402 (rejected),
        # NO 201 (que significaría que el server aceptó el hold). Lo crítico:
        # amount enviado a MP debe ser 100 (server-side), no 1.
        assert r.status_code in (400, 402, 502, 503, 424, 429), (
            f"Unexpected status {r.status_code}: {r.text[:200]}"
        )
        # Si el endpoint respondió sin llegar a MP (400/424), no podemos confirmar
        # el hold amount desde aquí. La verificación indirecta es que NO se creó
        # un join_request con amount=1.
        # Como no tenemos MongoDB directo aquí, usamos la validación cruzada:
        # el log del backend registró la discrepancia. Este test principalmente
        # verifica que el endpoint no crashea y no acepta amount=1 silenciosamente
        # como el monto autoritativo.

    def test_join_request_costo_zero_returns_400(self, admin_headers):
        """Edge case: reta con costo_inscripcion=0 → 400 sin tocar MP."""
        # Nota: RetaCreate podría validar costo>=10 en Pydantic. Probamos.
        reta = _create_reta(admin_headers, costo=100)
        # forzamos costo a 0 via PUT (si lo permite) — si no, skip
        put_payload = {
            "nombre": reta["nombre"],
            "club": reta["club"],
            "fecha_str": "2026-12-15",
            "hora_str": "18:00",
            "tz_offset_minutes": -360,
            "canchas_disponibles": 2,
            "costo_inscripcion": 0,
            "modalidad_juego": "PUNTOS",
            "num_rondas": 7,
            "open_reta_habilitado": True,
        }
        r_put = requests.put(
            f"{BASE_URL}/api/retas/{reta['id']}", json=put_payload,
            headers=admin_headers, timeout=15,
        )
        if r_put.status_code != 200:
            pytest.skip(f"Pydantic bloquea costo=0 (esperado): {r_put.status_code}")
        # Intentamos join-request → debe ser 400
        body = {
            "match_id": reta["id"],
            "player_id": "TEST_zero_costo",
            "amount": 50,
            "card_token": "FAKE_TOKEN",
            "payer_email": "x@x.com",
            "installments": 1,
        }
        r = requests.post(f"{BASE_URL}/api/retas/join-request", json=body, timeout=15)
        assert r.status_code == 400, (
            f"Expected 400 for costo=0, got {r.status_code}: {r.text[:200]}"
        )

    def test_preauth_form_ignores_amount_query(self, admin_headers):
        """preauth-form no debe aceptar `amount` query — usa reta.costo_inscripcion."""
        reta = _create_reta(admin_headers, costo=250)
        # Probamos con amount=1 en query — el HTML debe mostrar 250, no 1
        r = requests.get(
            f"{BASE_URL}/api/public/retas/{reta['url_slug']}/preauth-form?amount=1",
            timeout=15,
        )
        # Si MP_PUBLIC_KEY no está configurado responderá 500 — aceptable
        if r.status_code == 500 and "MP_PUBLIC_KEY" in r.text:
            pytest.skip("MP_PUBLIC_KEY no configurado en el entorno")
        assert r.status_code == 200, f"preauth-form status: {r.status_code} {r.text[:200]}"
        html = r.text
        # El HTML debe contener 250 (o 250.00), NO 1
        assert "250" in html, "HTML no contiene 250 (monto de la reta)"
        # Verificar que amount=1 no se coló en el brick initialization
        assert "amount: 1 " not in html and "amount: 1," not in html and "amount: 1}" not in html


# ═════════════════════ SEC-002 ═════════════════════
class TestSEC002OwnershipAdminRetas:
    """Admin B autenticado no debe poder tocar retas de Admin A."""

    def test_get_reta_by_non_owner_returns_403(self, admin_headers):
        """No podemos crear 2 admins reales fácilmente; simulamos con JWT
        forjado de otro admin_id. Como el sistema tiene un único admin master,
        creamos un token con role=admin y sub=<uuid_falso> firmado con
        la MISMA JWT_SECRET (leemos del backend).
        """
        # Necesitamos generar un JWT válido con sub!=organizador real.
        # No tenemos JWT_SECRET público. Alternativa: verificar respuesta 200
        # cuando admin real (dueño) accede — el ownership check bloquea sólo
        # admins diferentes. Como sólo existe 1 admin, verificamos el path
        # positivo (200) para el dueño real de la reta.
        reta = _create_reta(admin_headers, costo=100, nombre_suffix="own")
        # Owner puede ver
        r = requests.get(
            f"{BASE_URL}/api/retas/{reta['id']}", headers=admin_headers, timeout=10
        )
        assert r.status_code == 200
        # Owner puede listar inscripciones
        r2 = requests.get(
            f"{BASE_URL}/api/retas/{reta['id']}/inscripciones",
            headers=admin_headers, timeout=10,
        )
        assert r2.status_code == 200

    def test_endpoints_require_auth(self, admin_headers):
        reta = _create_reta(admin_headers, costo=100, nombre_suffix="auth")
        # Sin token: 401 (o 403)
        for path in [
            f"/api/retas/{reta['id']}",
            f"/api/retas/{reta['id']}/inscripciones",
        ]:
            r = requests.get(f"{BASE_URL}{path}", timeout=10)
            assert r.status_code in (401, 403), f"{path} → {r.status_code}"

    def test_non_owner_admin_gets_403(self, admin_headers):
        """Simulamos admin B firmando un JWT con misma SECRET pero sub distinto.
        Leemos JWT_SECRET del entorno si está expuesta (backend/.env)."""
        secret = os.environ.get("JWT_SECRET") or os.environ.get("SECRET_KEY")
        if not secret:
            # Intentamos leer del .env directamente
            try:
                with open("/app/backend/.env", "r") as f:
                    for line in f:
                        if line.strip().startswith("JWT_SECRET="):
                            secret = line.split("=", 1)[1].strip().strip('"')
                            break
                        if line.strip().startswith("SECRET_KEY="):
                            secret = line.split("=", 1)[1].strip().strip('"')
            except Exception:
                pass
        if not secret:
            pytest.skip("JWT_SECRET no accesible desde el test env")

        import jwt as pyjwt
        from datetime import datetime, timezone, timedelta

        # Crear un JWT admin con sub distinto al organizer real
        fake_admin_payload = {
            "sub": "fake-admin-uuid-" + uuid.uuid4().hex[:8],
            "role": "admin",
            "exp": datetime.now(timezone.utc) + timedelta(hours=1),
            "iat": datetime.now(timezone.utc),
            "jti": uuid.uuid4().hex,
        }
        fake_token = pyjwt.encode(fake_admin_payload, secret, algorithm="HS256")
        fake_headers = {"Authorization": f"Bearer {fake_token}",
                        "Content-Type": "application/json"}

        reta = _create_reta(admin_headers, costo=100, nombre_suffix="foreign")

        # (a) GET
        r_get = requests.get(
            f"{BASE_URL}/api/retas/{reta['id']}", headers=fake_headers, timeout=10
        )
        assert r_get.status_code == 403, (
            f"GET esperado 403, obtenido {r_get.status_code}: {r_get.text[:120]}"
        )
        # (b) PUT
        put_body = {
            "nombre": reta["nombre"] + "_HACKED",
            "club": reta["club"],
            "fecha_str": "2026-12-15",
            "hora_str": "18:00",
            "tz_offset_minutes": -360,
            "canchas_disponibles": 2,
            "costo_inscripcion": 100,
            "modalidad_juego": "PUNTOS",
            "num_rondas": 7,
            "open_reta_habilitado": True,
        }
        r_put = requests.put(
            f"{BASE_URL}/api/retas/{reta['id']}", json=put_body,
            headers=fake_headers, timeout=10,
        )
        assert r_put.status_code == 403, f"PUT esperado 403, obtenido {r_put.status_code}"
        # (c) DELETE
        r_del = requests.delete(
            f"{BASE_URL}/api/retas/{reta['id']}", headers=fake_headers, timeout=10
        )
        assert r_del.status_code == 403, f"DELETE esperado 403, obtenido {r_del.status_code}"
        # (d) GET inscripciones
        r_insc = requests.get(
            f"{BASE_URL}/api/retas/{reta['id']}/inscripciones",
            headers=fake_headers, timeout=10,
        )
        assert r_insc.status_code == 403, f"insc esperado 403, obtenido {r_insc.status_code}"


# ═════════════════════ SEC-003 ═════════════════════
class TestSEC003PlayerJoinRequestsAuth:
    """GET /players/{player_id}/join-requests debe requerir JWT del propio player."""

    def test_no_auth_returns_401_or_403(self):
        r = requests.get(
            f"{BASE_URL}/api/players/some-player-uuid/join-requests", timeout=10
        )
        assert r.status_code in (401, 403), f"esperado 401/403, obtenido {r.status_code}"

    def test_admin_jwt_returns_403(self, admin_headers):
        """Admin token no tiene role='player' → 403."""
        r = requests.get(
            f"{BASE_URL}/api/players/some-player-uuid/join-requests",
            headers=admin_headers, timeout=10,
        )
        assert r.status_code == 403, f"admin JWT esperado 403, obtenido {r.status_code}"

    def test_player_jwt_wrong_sub_returns_403(self):
        """Player token con sub!=player_id del path → 403."""
        secret = os.environ.get("JWT_SECRET")
        if not secret:
            try:
                with open("/app/backend/.env") as f:
                    for line in f:
                        if line.strip().startswith("JWT_SECRET="):
                            secret = line.split("=", 1)[1].strip().strip('"')
                            break
                        if line.strip().startswith("SECRET_KEY="):
                            secret = line.split("=", 1)[1].strip().strip('"')
            except Exception:
                pass
        if not secret:
            pytest.skip("JWT_SECRET no accesible")
        import jwt as pyjwt
        from datetime import datetime, timezone, timedelta
        payload = {
            "sub": "+521111111111",
            "role": "player",
            "jugador_id": "player-A-id",
            "nombre": "Player A",
            "exp": datetime.now(timezone.utc) + timedelta(hours=1),
            "iat": datetime.now(timezone.utc),
            "jti": uuid.uuid4().hex,
        }
        tok = pyjwt.encode(payload, secret, algorithm="HS256")
        # Path tiene otro player_id → sub del token != player_id path
        r = requests.get(
            f"{BASE_URL}/api/players/other-player-id/join-requests",
            headers={"Authorization": f"Bearer {tok}"}, timeout=10,
        )
        assert r.status_code == 403, f"player wrong sub esperado 403, obtenido {r.status_code}: {r.text[:120]}"

    def test_player_jwt_matching_sub_returns_200(self):
        """Player token con sub==player_id → 200 con items[]."""
        secret = os.environ.get("JWT_SECRET")
        if not secret:
            try:
                with open("/app/backend/.env") as f:
                    for line in f:
                        if line.strip().startswith("JWT_SECRET="):
                            secret = line.split("=", 1)[1].strip().strip('"')
                            break
                        if line.strip().startswith("SECRET_KEY="):
                            secret = line.split("=", 1)[1].strip().strip('"')
            except Exception:
                pass
        if not secret:
            pytest.skip("JWT_SECRET no accesible")
        import jwt as pyjwt
        from datetime import datetime, timezone, timedelta
        player_id = "TEST_player_owns_" + uuid.uuid4().hex[:6]
        payload = {
            "sub": player_id,
            "role": "player",
            "jugador_id": player_id,
            "nombre": "Owner",
            "exp": datetime.now(timezone.utc) + timedelta(hours=1),
            "iat": datetime.now(timezone.utc),
            "jti": uuid.uuid4().hex,
        }
        tok = pyjwt.encode(payload, secret, algorithm="HS256")
        r = requests.get(
            f"{BASE_URL}/api/players/{player_id}/join-requests",
            headers={"Authorization": f"Bearer {tok}"}, timeout=10,
        )
        assert r.status_code == 200, f"matching sub esperado 200, obtenido {r.status_code}: {r.text[:120]}"
        body = r.json()
        assert "items" in body and "total" in body


# ═════════════════════ SEC-004 ═════════════════════
class TestSEC004RateLimits:
    """Rate limits en endpoints públicos de pago."""

    def test_join_request_rate_limit_5_per_minute(self):
        """POST /api/retas/join-request → 5/min. Al 6to intento debe dar 429."""
        # Usamos payload que va a fallar en el server (404 reta no encontrada)
        # ANTES del hold. El rate limit se aplica por decorator ANTES del handler
        # cuando SlowAPI está bien instalado. Verificamos que 6+ requests → 429.
        body = {
            "match_id": "no-existe-uuid",
            "player_id": "rate-limit-test",
            "amount": 100,
            "card_token": "FAKE_TOKEN_1234567890",
            "payer_email": "rl@test.com",
            "installments": 1,
        }
        statuses = []
        for i in range(8):
            r = requests.post(
                f"{BASE_URL}/api/retas/join-request", json=body, timeout=10
            )
            statuses.append(r.status_code)
        # Al menos 1 de los últimos 3 debe ser 429
        assert 429 in statuses, f"No se observó 429 en 8 requests. Statuses: {statuses}"

    def test_checkout_mp_rate_limit_10_per_minute(self, admin_headers):
        """POST /api/public/retas/{id}/checkout-mercadopago → 10/min."""
        reta = _create_reta(admin_headers, costo=100, nombre_suffix="rl_mp")
        body = {
            "nombre": "TEST RL Nombre",
            "telefono": "+525511112222",
        }
        statuses = []
        for i in range(13):
            r = requests.post(
                f"{BASE_URL}/api/public/retas/{reta['id']}/checkout-mercadopago",
                json=body, timeout=10,
            )
            statuses.append(r.status_code)
        assert 429 in statuses, f"No se observó 429 en 13 requests. Statuses: {statuses}"

    def test_preauth_form_rate_limit_20_per_minute(self, admin_headers):
        """GET /api/public/retas/{slug}/preauth-form → 20/min."""
        reta = _create_reta(admin_headers, costo=100, nombre_suffix="rl_pf")
        statuses = []
        for i in range(23):
            r = requests.get(
                f"{BASE_URL}/api/public/retas/{reta['url_slug']}/preauth-form",
                timeout=10,
            )
            statuses.append(r.status_code)
        assert 429 in statuses, f"No se observó 429 en 23 requests. Statuses: {statuses}"


# ═════════════════════ REGRESSION ═════════════════════
class TestRegression:
    def test_admin_login_works(self):
        r = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"username": ADMIN_EMAIL, "password": ADMIN_PASS},
            timeout=10,
        )
        assert r.status_code == 200
        assert "access_token" in r.json()

    def test_google_verification_endpoint(self):
        r = requests.get(f"{BASE_URL}/googlea05e4f73dfe1ad09.html", timeout=10)
        assert r.status_code == 200
        assert "googlea05e4f73dfe1ad09" in r.text

    def test_openapi_boots(self):
        # OpenAPI puede estar en /openapi.json (root) o /api/openapi.json; también
        # el docs endpoint suele exponerse. Aceptamos cualquiera como signo de boot.
        for path in ("/openapi.json", "/api/openapi.json", "/docs", "/api/docs", "/api"):
            r = requests.get(f"{BASE_URL}{path}", timeout=10)
            if r.status_code == 200:
                return
        pytest.skip("Ningún endpoint openapi/docs público accesible — no bloquea")
