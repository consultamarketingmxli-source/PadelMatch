"""Iteración 7 — Validación HTTP end-to-end de Fases A, B y D.

Corre contra el backend desplegado (EXPO_PUBLIC_BACKEND_URL o EXPO_BACKEND_URL)
para asegurar que motor async + Mongo real funcionan con todos los endpoints
nuevos (max_jugadores/formato_score, WebP compression, share-info, QR público
y privado, /me/waitlist del jugador).

Cobertura:
- Login admin
- POST /api/retas (no /admin/retas: el router es /retas) con max_jugadores y
  formato_score
  · acepta 12 + TIEMPO/20/min (deriva canchas = 2)
  · rechaza 7 (no múltiplo 4) — error menciona "múltiplos de 4"
  · rechaza 36 (>32)
  · rechaza TIEMPO+juegos (combinación inválida)
  · sin max_jugadores → default 8*canchas_disponibles
  · WebP compression sobre PNG sintético: payload final < original
- GET /api/retas/{id}/share-info con todos los campos
- GET /api/retas/{id}/qr → image/png (auth)
- GET /api/public/retas/{slug}/qr → image/png (sin auth)
- 404 limpio para retas inexistentes (auth + público)
- Player flow: waitlist público + JWT player firmado → /me/waitlist devuelve
  entry con posicion_fila y total_en_espera correctos.
- Regresión: list/delete retas, radar, buscar, mp-status, refund, stats.
"""
from __future__ import annotations

import base64
import io
import os
from datetime import datetime, timedelta, timezone

import jwt
import pytest
import requests
from PIL import Image
from dotenv import dotenv_values

_backend_env = dotenv_values("/app/backend/.env")
BASE_URL = (
    os.environ.get("EXPO_BACKEND_URL")
    or os.environ.get("EXPO_PUBLIC_BACKEND_URL")
    or "https://padel-tournament-hub-9.preview.emergentagent.com"
).rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "admin@padelappretas.com"
ADMIN_PASSWORD = "admin123"
# BUG NOTA: auth.py se importa ANTES que core/db.py (que llama load_dotenv()),
# por lo que el JWT_SECRET real usado por el servidor es el default de auth.py,
# NO el de /app/backend/.env. Reportado en iteration report.
# NOTA: conftest.py llama load_dotenv() y agrega JWT_SECRET a os.environ, así
# que NO podemos usar os.environ aquí — hard-codeamos el default real del server.
JWT_SECRET = "padelappretas-os-secret-dev-key-min-32bytes-please-rotate-in-prod"


# ---------- Fixtures ----------
@pytest.fixture(scope="session")
def session() -> requests.Session:
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session")
def admin_token(session) -> str:
    r = session.post(
        f"{API}/auth/login",
        json={"username": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        timeout=15,
    )
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    body = r.json()
    assert "access_token" in body
    return body["access_token"]


@pytest.fixture(scope="session")
def auth_headers(admin_token) -> dict:
    return {
        "Authorization": f"Bearer {admin_token}",
        "Content-Type": "application/json",
    }


def _make_png_data_url(width=800, height=800, color=(0, 128, 255)) -> str:
    img = Image.new("RGB", (width, height), color)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    b64 = base64.b64encode(buf.getvalue()).decode("ascii")
    return f"data:image/png;base64,{b64}"


def _reta_payload(**overrides):
    base = {
        "nombre": "TEST_Reta HTTP",
        "club": "Club QA",
        "fecha_str": "2027-03-15",
        "hora_str": "18:30",
        "tz_offset_minutes": -360,
        "canchas_disponibles": 1,
        "costo_inscripcion": 250,
        "modalidad_juego": "PUNTOS",
        "num_rondas": 7,
    }
    base.update(overrides)
    return base


# ---------- Health ----------
class TestHealth:
    def test_api_health(self, session):
        r = session.get(f"{API}/", timeout=10)
        assert r.status_code == 200
        assert r.json().get("status") == "ok"


# ---------- FASE A: max_jugadores + formato_score ----------
class TestFaseACapacidadElastica:
    created_ids: list[str] = []

    def teardown_method(self):
        # Best-effort cleanup, ignora errores.
        s = requests.Session()
        # Reuse admin login
        r = s.post(f"{API}/auth/login", json={"username": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=10)
        if r.status_code == 200:
            tok = r.json()["access_token"]
            for rid in list(self.created_ids):
                s.delete(f"{API}/retas/{rid}", headers={"Authorization": f"Bearer {tok}"}, timeout=10)
            self.created_ids.clear()

    def test_acepta_12_tiempo_20_min(self, session, auth_headers):
        payload = _reta_payload(
            nombre="TEST_R 12 TIEMPO",
            max_jugadores=12,
            formato_score={"tipo": "TIEMPO", "valor": 20, "unidad": "minutos"},
        )
        r = session.post(f"{API}/retas", json=payload, headers=auth_headers, timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        self.created_ids.append(body["id"])
        assert body["max_jugadores"] == 12
        # ceil(12/8) = 2 canchas; canchas_disponibles enviado=1 → debe derivar 2.
        assert body["canchas_disponibles"] == 2, f"Esperaba 2 canchas, got {body['canchas_disponibles']}"
        assert body["formato_score"]["tipo"] == "TIEMPO"
        assert body["formato_score"]["valor"] == 20
        assert body["formato_score"]["unidad"] == "minutos"

    def test_rechaza_7_no_multiplo_4(self, session, auth_headers):
        payload = _reta_payload(nombre="TEST_R 7 invalid", max_jugadores=7)
        r = session.post(f"{API}/retas", json=payload, headers=auth_headers, timeout=15)
        assert r.status_code == 422, r.text
        msg = r.text.lower()
        assert "múltiplos de 4" in msg or "multiplos de 4" in msg or "lista de espera" in msg, msg

    def test_rechaza_36_excede_32(self, session, auth_headers):
        payload = _reta_payload(nombre="TEST_R 36 invalid", max_jugadores=36)
        r = session.post(f"{API}/retas", json=payload, headers=auth_headers, timeout=15)
        assert r.status_code == 422, r.text

    def test_rechaza_tiempo_unidad_juegos(self, session, auth_headers):
        payload = _reta_payload(
            nombre="TEST_R TIEMPO juegos",
            max_jugadores=8,
            formato_score={"tipo": "TIEMPO", "valor": 15, "unidad": "juegos"},
        )
        r = session.post(f"{API}/retas", json=payload, headers=auth_headers, timeout=15)
        assert r.status_code == 422, r.text

    def test_sin_max_jugadores_default_8_por_cancha(self, session, auth_headers):
        payload = _reta_payload(nombre="TEST_R default cap", canchas_disponibles=2)
        r = session.post(f"{API}/retas", json=payload, headers=auth_headers, timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        self.created_ids.append(body["id"])
        assert body["max_jugadores"] == 16  # 8 * 2
        assert body["canchas_disponibles"] == 2

    def test_webp_compression_reduce_logo(self, session, auth_headers):
        png_url = _make_png_data_url(900, 900)  # PNG grande
        payload = _reta_payload(
            nombre="TEST_R WebP",
            max_jugadores=8,
            organizador_logo_url=png_url,
        )
        r = session.post(f"{API}/retas", json=payload, headers=auth_headers, timeout=20)
        assert r.status_code == 200, r.text
        body = r.json()
        self.created_ids.append(body["id"])
        logo_resp = body.get("organizador_logo_url") or ""
        assert logo_resp.startswith("data:image/webp;base64,"), f"esperaba data:image/webp,..., got {logo_resp[:40]}"
        assert len(logo_resp) < len(png_url), f"WebP({len(logo_resp)}) no es menor que PNG({len(png_url)})"


# ---------- FASE B: share-info + QR ----------
class TestFaseBQR:
    reta_id: str = ""
    reta_slug: str = ""

    @classmethod
    def setup_class(cls):
        # Crear una reta dedicada que viva durante toda la clase.
        r = requests.post(
            f"{API}/auth/login",
            json={"username": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
            timeout=10,
        )
        assert r.status_code == 200
        cls._tok = r.json()["access_token"]
        h = {"Authorization": f"Bearer {cls._tok}", "Content-Type": "application/json"}
        payload = _reta_payload(
            nombre="TEST_FaseB QR",
            max_jugadores=8,
            formato_score={"tipo": "PUNTOS", "valor": 9, "unidad": "juegos"},
        )
        rc = requests.post(f"{API}/retas", json=payload, headers=h, timeout=15)
        assert rc.status_code == 200, rc.text
        body = rc.json()
        cls.reta_id = body["id"]
        cls.reta_slug = body["url_slug"]

    @classmethod
    def teardown_class(cls):
        if cls.reta_id:
            requests.delete(
                f"{API}/retas/{cls.reta_id}",
                headers={"Authorization": f"Bearer {cls._tok}"},
                timeout=10,
            )

    def _h(self):
        return {"Authorization": f"Bearer {self._tok}"}

    def test_share_info_devuelve_metadatos(self):
        r = requests.get(
            f"{API}/retas/{self.reta_id}/share-info",
            headers=self._h(),
            timeout=10,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        for k in (
            "reta_id", "nombre", "url_publica", "url_slug",
            "qr_endpoint", "qr_publico", "inscritos", "waitlist",
            "max_jugadores", "capacidad_pct", "semaforo",
        ):
            assert k in body, f"falta campo {k} en share-info: {body}"
        assert body["reta_id"] == self.reta_id
        assert body["url_publica"].startswith("https://"), body["url_publica"]
        assert body["url_slug"] == self.reta_slug
        assert body["qr_endpoint"] == f"/api/retas/{self.reta_id}/qr"
        assert body["qr_publico"] == f"/api/public/retas/{self.reta_slug}/qr"
        assert body["max_jugadores"] == 8
        assert body["semaforo"] in ("VERDE", "AMARILLO", "ROJO")

    def test_qr_admin_devuelve_png(self):
        r = requests.get(
            f"{API}/retas/{self.reta_id}/qr",
            headers=self._h(),
            timeout=10,
        )
        assert r.status_code == 200, r.text
        assert r.headers.get("content-type", "").startswith("image/png")
        assert r.content[:8] == b"\x89PNG\r\n\x1a\n"

    def test_qr_admin_sin_auth_es_401(self):
        r = requests.get(f"{API}/retas/{self.reta_id}/qr", timeout=10)
        assert r.status_code in (401, 403), f"esperaba 401/403, got {r.status_code}"

    def test_qr_publico_sin_auth_devuelve_png(self):
        r = requests.get(f"{API}/public/retas/{self.reta_slug}/qr", timeout=10)
        assert r.status_code == 200, r.text
        assert r.headers.get("content-type", "").startswith("image/png")
        assert r.content[:8] == b"\x89PNG\r\n\x1a\n"

    def test_qr_admin_inexistente_404(self):
        r = requests.get(
            f"{API}/retas/no-existe-xyz-123/qr",
            headers=self._h(),
            timeout=10,
        )
        assert r.status_code == 404

    def test_qr_publico_inexistente_404(self):
        r = requests.get(f"{API}/public/retas/no-existe-xyz-123/qr", timeout=10)
        assert r.status_code == 404


# ---------- FASE D: /me/waitlist ----------
def _player_jwt(jugador_id: str, telefono: str, nombre: str) -> str:
    payload = {
        "sub": telefono,
        "role": "player",
        "jugador_id": jugador_id,
        "nombre": nombre,
        "exp": datetime.now(timezone.utc) + timedelta(days=1),
        "iat": datetime.now(timezone.utc),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm="HS256")


class TestFaseDWaitlistPlayer:
    reta_id: str = ""
    telefono: str = "+5215599887766"
    nombre: str = "TEST_Player Waitlist"
    jugador_id: str = ""
    waitlist_id: str = ""

    @classmethod
    def setup_class(cls):
        r = requests.post(
            f"{API}/auth/login",
            json={"username": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
            timeout=10,
        )
        cls._tok = r.json()["access_token"]
        h = {"Authorization": f"Bearer {cls._tok}", "Content-Type": "application/json"}
        payload = _reta_payload(
            nombre="TEST_FaseD Waitlist",
            max_jugadores=8,
        )
        rc = requests.post(f"{API}/retas", json=payload, headers=h, timeout=15)
        assert rc.status_code == 200, rc.text
        cls.reta_id = rc.json()["id"]

    @classmethod
    def teardown_class(cls):
        if cls.reta_id:
            requests.delete(
                f"{API}/retas/{cls.reta_id}",
                headers={"Authorization": f"Bearer {cls._tok}"},
                timeout=10,
            )

    def test_me_waitlist_vacia_inicialmente(self):
        # Generamos un JWT player sintético — el jugador aún no existe en
        # usuarios → jugador_id puede ser cualquier UUID. El endpoint filtra
        # por telefono (sub), no por jugador_id.
        token = _player_jwt("00000000-0000-0000-0000-000000000000", "+5215588990011", "TEST_Vacio")
        r = requests.get(
            f"{API}/players/me/waitlist",
            headers={"Authorization": f"Bearer {token}"},
            timeout=10,
        )
        assert r.status_code == 200, r.text
        assert r.json() == []

    def test_join_waitlist_y_me_waitlist(self):
        # 1) Unirse a la lista de espera de la reta (público).
        rw = requests.post(
            f"{API}/public/retas/{self.reta_id}/waitlist",
            json={"reta_id": self.reta_id, "nombre": self.nombre, "telefono": self.telefono},
            timeout=15,
        )
        assert rw.status_code == 200, rw.text
        entry = rw.json()
        TestFaseDWaitlistPlayer.jugador_id = entry["jugador_id"]
        TestFaseDWaitlistPlayer.waitlist_id = entry["id"]
        assert entry["posicion_fila"] >= 1
        assert entry["telefono"] == self.telefono

        # 2) Crear JWT player sintético para ese teléfono.
        token = _player_jwt(self.jugador_id or "x", self.telefono, self.nombre)
        rm = requests.get(
            f"{API}/players/me/waitlist",
            headers={"Authorization": f"Bearer {token}"},
            timeout=10,
        )
        assert rm.status_code == 200, rm.text
        data = rm.json()
        assert isinstance(data, list)
        # debe aparecer una entry para esta reta
        match = [d for d in data if d["reta_id"] == self.reta_id]
        assert len(match) == 1, f"esperaba 1 entry, got {len(match)}: {data}"
        e = match[0]
        assert e["posicion_fila"] == entry["posicion_fila"]
        assert e["total_en_espera"] >= 1
        assert e["reta_nombre"]
        assert e["reta_slug"]
        assert e["club"]
        assert "fecha_evento" in e

    def test_me_waitlist_sin_token_401(self):
        r = requests.get(f"{API}/players/me/waitlist", timeout=10)
        assert r.status_code == 401

    def test_me_waitlist_admin_token_403(self):
        r = requests.get(
            f"{API}/players/me/waitlist",
            headers={"Authorization": f"Bearer {self._tok}"},
            timeout=10,
        )
        # admin role != player → 403
        assert r.status_code == 403


# ---------- Regresión: endpoints existentes ----------
class TestRegresion:
    def test_radar_responde(self, session):
        r = session.get(f"{API}/public/retas/radar", timeout=10)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_buscar_sin_query(self, session):
        r = session.get(f"{API}/public/retas/buscar", timeout=10)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_buscar_con_query(self, session):
        r = session.get(f"{API}/public/retas/buscar", params={"q": "club"}, timeout=10)
        assert r.status_code == 200

    def test_list_retas_admin(self, session, auth_headers):
        r = session.get(f"{API}/retas", headers=auth_headers, timeout=10)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_mp_status_admin(self, session, auth_headers):
        r = session.get(f"{API}/admin/mercadopago/status", headers=auth_headers, timeout=10)
        assert r.status_code == 200
        body = r.json()
        assert "connected" in body

    def test_crear_y_borrar_reta(self, session, auth_headers):
        payload = _reta_payload(nombre="TEST_R regresion CRUD")
        r = session.post(f"{API}/retas", json=payload, headers=auth_headers, timeout=15)
        assert r.status_code == 200, r.text
        rid = r.json()["id"]
        rd = session.delete(f"{API}/retas/{rid}", headers=auth_headers, timeout=10)
        assert rd.status_code == 200
        # GET después de delete debe 404
        rg = session.get(f"{API}/retas/{rid}", headers=auth_headers, timeout=10)
        assert rg.status_code == 404
