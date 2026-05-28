"""
Suplemento Fase C — cobertura de los escenarios del review_request que NO están
en test_phase_c_realtime.py:

  - WS suscrito + DELETE resultado → broadcast {type:'standings_updated',
    event:'match_deleted'}
  - WS con player APROBADO → conecta OK (recibe hello con role='player')
  - WS con player NO APROBADO (pendiente) → cierre 403
  - WS con player sin inscripción → cierre 403
  - Regresión rápida endpoints existentes: /api/, radar, retas CRUD,
    share-info, qr admin, /me/waitlist.
"""
from __future__ import annotations

import asyncio
import json
import os
import random
from datetime import datetime, timedelta, timezone


def _rand_tel() -> str:
    return f"+52155{random.randint(10000000, 99999999)}"

import jwt
import pytest
import requests
import websockets
from dotenv import dotenv_values


BASE_URL = os.environ.get("EXPO_BACKEND_URL", "http://localhost:8001").rstrip("/")
API = f"{BASE_URL}/api"
WS_BASE = BASE_URL.replace("http://", "ws://").replace("https://", "wss://")
_env = dotenv_values("/app/backend/.env")
JWT_SECRET = _env.get(
    "JWT_SECRET",
    "padelappretas-os-secret-dev-key-min-32bytes-please-rotate-in-prod",
)


def make_player_token(telefono: str) -> str:
    exp = datetime.now(timezone.utc) + timedelta(hours=2)
    return jwt.encode(
        {"sub": telefono, "role": "player", "nombre": "Sup Player",
         "jugador_id": "sup-id", "exp": exp},
        JWT_SECRET, algorithm="HS256",
    )


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(
        f"{API}/auth/login",
        json={"username": "admin@padelappretas.com", "password": "admin123"},
        timeout=10,
    )
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture
def reta(admin_token):
    r = requests.post(
        f"{API}/retas",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={
            "nombre": "TEST_FaseC Sup", "club": "Club Sup",
            "fecha_str": "2026-11-15", "hora_str": "20:00",
            "tz_offset_minutes": -360,
            "canchas_disponibles": 1, "max_jugadores": 4,
            "costo_inscripcion": 0,
            "modalidad_juego": "PUNTOS", "num_rondas": 5,
            "formato_score": {"tipo": "PUNTOS", "valor": 9, "unidad": "juegos"},
        }, timeout=15,
    )
    assert r.status_code == 200, r.text
    data = r.json()
    yield data
    requests.delete(
        f"{API}/retas/{data['id']}",
        headers={"Authorization": f"Bearer {admin_token}"}, timeout=10,
    )


# =============================================================================
# WS DELETE broadcast (gap del set original)
# =============================================================================
class TestWSDeleteBroadcast:
    @pytest.fixture
    def anyio_backend(self):
        return "asyncio"

    @pytest.mark.anyio
    async def test_ws_recibe_broadcast_delete(self, admin_token, reta):
        # 1) primero creamos un resultado via REST
        r = requests.post(
            f"{API}/retas/{reta['id']}/resultados",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={"cancha": 1, "ronda": 1, "partido_idx": 0,
                  "pareja_a": ["X1", "X2"], "pareja_b": ["Y1", "Y2"],
                  "score_a": 9, "score_b": 6},
            timeout=10,
        )
        assert r.status_code == 200, r.text
        result_id = r.json()["id"]

        uri = f"{WS_BASE}/api/ws/retas/{reta['id']}?token={admin_token}"
        async with websockets.connect(uri) as ws:
            await asyncio.wait_for(ws.recv(), timeout=5)  # hello

            async def delete_it():
                await asyncio.sleep(0.2)
                return await asyncio.to_thread(
                    requests.delete,
                    f"{API}/retas/{reta['id']}/resultados/{result_id}",
                    headers={"Authorization": f"Bearer {admin_token}"},
                    timeout=10,
                )

            task = asyncio.create_task(delete_it())
            msg = json.loads(await asyncio.wait_for(ws.recv(), timeout=5))
            resp = await task
            assert resp.status_code == 200, resp.text
            assert msg["type"] == "standings_updated"
            assert msg["reta_id"] == reta["id"]
            assert msg.get("event") == "match_deleted"
            assert msg.get("match_id") == result_id


# =============================================================================
# WS player approved / pending / not enrolled
# =============================================================================
class TestWSPlayerAuth:
    @pytest.fixture
    def anyio_backend(self):
        return "asyncio"

    @pytest.mark.anyio
    async def test_ws_player_aprobado_conecta(self, admin_token, reta):
        tel = _rand_tel()
        # checkout
        c = requests.post(
            f"{API}/public/retas/{reta['id']}/checkout",
            json={"reta_id": reta['id'], "nombre": "Sup OK", "telefono": tel},
            timeout=10,
        )
        assert c.status_code == 200, c.text
        ins_id = c.json()["id"]
        # aprobar pago
        w = requests.post(
            f"{API}/webhooks/payment",
            json={"inscripcion_id": ins_id, "status": "approved"}, timeout=10,
        )
        assert w.status_code == 200, w.text

        token = make_player_token(telefono=tel)
        uri = f"{WS_BASE}/api/ws/retas/{reta['id']}?token={token}"
        async with websockets.connect(uri) as ws:
            hello = json.loads(await asyncio.wait_for(ws.recv(), timeout=5))
            assert hello["type"] == "hello"
            assert hello["role"] == "player"

    @pytest.mark.anyio
    async def test_ws_player_pendiente_cierra_403(self, reta):
        tel = _rand_tel()
        c = requests.post(
            f"{API}/public/retas/{reta['id']}/checkout",
            json={"reta_id": reta['id'], "nombre": "Sup Pend", "telefono": tel},
            timeout=10,
        )
        assert c.status_code == 200, c.text
        # NO aprobar — queda Pendiente
        token = make_player_token(telefono=tel)
        uri = f"{WS_BASE}/api/ws/retas/{reta['id']}?token={token}"
        try:
            async with websockets.connect(uri) as ws:
                await ws.recv()
            pytest.fail("Player pendiente NO debería conectar")
        except websockets.exceptions.InvalidStatus as e:
            assert e.response.status_code == 403
        except websockets.exceptions.ConnectionClosed as e:
            assert e.rcvd.code in (4403, 1011)

    @pytest.mark.anyio
    async def test_ws_player_sin_inscripcion_cierra_403(self, reta):
        tel = _rand_tel()  # nunca se inscribe
        token = make_player_token(telefono=tel)
        uri = f"{WS_BASE}/api/ws/retas/{reta['id']}?token={token}"
        try:
            async with websockets.connect(uri) as ws:
                await ws.recv()
            pytest.fail("Player sin inscripción NO debería conectar")
        except websockets.exceptions.InvalidStatus as e:
            assert e.response.status_code == 403
        except websockets.exceptions.ConnectionClosed as e:
            assert e.rcvd.code in (4403, 1011)


# =============================================================================
# Regresión rápida — endpoints existentes
# =============================================================================
class TestRegresionEndpoints:
    def test_health(self):
        r = requests.get(f"{API}/", timeout=10)
        assert r.status_code == 200
        assert r.json().get("status") == "ok"

    def test_radar_publico(self):
        r = requests.get(
            f"{API}/public/retas/radar",
            params={"lat": 19.4326, "lng": -99.1332, "radio_km": 50}, timeout=10,
        )
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_retas_crud_y_share_info_y_qr(self, admin_token):
        # CREATE
        r = requests.post(
            f"{API}/retas",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={
                "nombre": "TEST_FaseC RegrCRUD", "club": "Club Regr",
                "fecha_str": "2026-12-01", "hora_str": "18:00",
                "tz_offset_minutes": -360,
                "canchas_disponibles": 1, "max_jugadores": 4,
                "costo_inscripcion": 0, "modalidad_juego": "PUNTOS",
                "num_rondas": 5,
                "formato_score": {"tipo": "PUNTOS", "valor": 9, "unidad": "juegos"},
            }, timeout=15,
        )
        assert r.status_code == 200, r.text
        rid = r.json()["id"]
        try:
            # share-info
            si = requests.get(
                f"{API}/retas/{rid}/share-info",
                headers={"Authorization": f"Bearer {admin_token}"}, timeout=10,
            )
            assert si.status_code == 200
            sij = si.json()
            assert "url_publica" in sij
            assert "max_jugadores" in sij

            # QR admin PNG
            qr = requests.get(
                f"{API}/retas/{rid}/qr",
                headers={"Authorization": f"Bearer {admin_token}"}, timeout=10,
            )
            assert qr.status_code == 200
            assert qr.headers.get("content-type", "").startswith("image/")
        finally:
            d = requests.delete(
                f"{API}/retas/{rid}",
                headers={"Authorization": f"Bearer {admin_token}"}, timeout=10,
            )
            assert d.status_code in (200, 204)

    def test_checkout_publico_y_waitlist_basico(self, admin_token):
        r = requests.post(
            f"{API}/retas",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={
                "nombre": "TEST_FaseC Regr Checkout", "club": "Club Chk",
                "fecha_str": "2026-12-02", "hora_str": "18:00",
                "tz_offset_minutes": -360,
                "canchas_disponibles": 1, "max_jugadores": 4,
                "costo_inscripcion": 0, "modalidad_juego": "PUNTOS",
                "num_rondas": 5,
                "formato_score": {"tipo": "PUNTOS", "valor": 9, "unidad": "juegos"},
            }, timeout=15,
        )
        rid = r.json()["id"]
        try:
            tel = _rand_tel()
            c = requests.post(
                f"{API}/public/retas/{rid}/checkout",
                json={"reta_id": rid, "nombre": "Regr User", "telefono": tel},
                timeout=10,
            )
            assert c.status_code == 200, c.text
            assert "id" in c.json()

            # /me/waitlist con player token
            tok = make_player_token(telefono=tel)
            mw = requests.get(
                f"{API}/players/me/waitlist",
                headers={"Authorization": f"Bearer {tok}"}, timeout=10,
            )
            assert mw.status_code == 200, mw.text
            assert isinstance(mw.json(), list)
        finally:
            requests.delete(
                f"{API}/retas/{rid}",
                headers={"Authorization": f"Bearer {admin_token}"}, timeout=10,
            )
