"""
Tests Fase C — Mesa de Control + Tabla individual + Realtime.

Cubren:
  - compute_individual_standings: cascada PG→DG→GF→nombre, empates, defensa.
  - Endpoint POST /retas/{id}/resultados: validación no-self-play.
  - Endpoint GET /retas/{id}/clasificacion: auth player aprobado / admin / 403.
  - Endpoint DELETE /retas/{id}/resultados/{result_id}: borrado.
  - WebSocket /ws/retas/{id}: auth, hello, broadcast post-write, ping/pong.
"""
from __future__ import annotations

import asyncio
import json
import os
from datetime import datetime, timedelta, timezone

import jwt
import pytest
import requests
from dotenv import dotenv_values

from core.standings import compute_individual_standings


BASE_URL = os.environ.get("EXPO_BACKEND_URL", "http://localhost:8001").rstrip("/")
API = f"{BASE_URL}/api"
_env = dotenv_values("/app/backend/.env")
JWT_SECRET = _env.get("JWT_SECRET", "padelappretas-os-secret-dev-key-min-32bytes-please-rotate-in-prod")


# =============================================================================
# Helpers
# =============================================================================
def make_player_token(telefono: str = "+5215512345678") -> str:
    exp = datetime.now(timezone.utc) + timedelta(hours=2)
    return jwt.encode(
        {"sub": telefono, "role": "player", "nombre": "Test Player",
         "jugador_id": "test-jugador-id", "exp": exp},
        JWT_SECRET, algorithm="HS256",
    )


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{API}/auth/login",
        json={"username": "admin@padelappretas.com", "password": "admin123"},
        timeout=10)
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture
def reta(admin_token):
    """Crea una reta y la borra al final."""
    r = requests.post(f"{API}/retas",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={
            "nombre": "Fase C Test", "club": "Club Fase C",
            "fecha_str": "2026-10-15", "hora_str": "19:00", "tz_offset_minutes": -360,
            "canchas_disponibles": 1, "max_jugadores": 4, "costo_inscripcion": 0,
            "modalidad_juego": "PUNTOS", "num_rondas": 5,
            "formato_score": {"tipo": "PUNTOS", "valor": 9, "unidad": "juegos"},
        },
        timeout=10)
    assert r.status_code == 200, r.text
    data = r.json()
    yield data
    requests.delete(f"{API}/retas/{data['id']}",
        headers={"Authorization": f"Bearer {admin_token}"}, timeout=10)


# =============================================================================
# Standings (función pura)
# =============================================================================
class TestStandingsCascade:
    def test_orden_estricto_PG_DG_GF(self):
        # Ana 2W (DG=4), Bea 2W (DG=0), Carla 2W (DG=8) → Carla > Ana > Bea
        rs = [
            {"pareja_a": ["Ana", "Bea"], "pareja_b": ["Carla", "Dora"], "score_a": 9, "score_b": 7, "ganador": "A"},
            {"pareja_a": ["Ana", "Carla"], "pareja_b": ["Bea", "Dora"], "score_a": 9, "score_b": 3, "ganador": "A"},
            {"pareja_a": ["Ana", "Dora"], "pareja_b": ["Bea", "Carla"], "score_a": 5, "score_b": 9, "ganador": "B"},
        ]
        t = compute_individual_standings(rs)
        nombres = [e.nombre for e in t]
        assert nombres[0] == "Carla", f"Esperaba Carla primera, got {nombres}"
        assert nombres[1] == "Ana"
        assert nombres[2] == "Bea"
        assert nombres[3] == "Dora"

    def test_empate_tecnico_4_4(self):
        rs = [{"pareja_a": ["X", "Y"], "pareja_b": ["Z", "W"],
               "score_a": 4, "score_b": 4, "ganador": "EMPATE"}]
        t = compute_individual_standings(rs)
        assert len(t) == 4
        for e in t:
            assert e.partidos_jugados == 1
            assert e.partidos_ganados == 0
            assert e.partidos_perdidos == 0
            assert e.partidos_empatados == 1
            assert e.juegos_a_favor == 4
            assert e.juegos_en_contra == 4
            assert e.diferencia == 0

    def test_alias_E_es_empate(self):
        rs = [{"pareja_a": ["M", "N"], "pareja_b": ["O", "P"],
               "score_a": 3, "score_b": 3, "ganador": "E"}]
        t = compute_individual_standings(rs)
        for e in t:
            assert e.partidos_empatados == 1

    def test_defensa_score_sin_ganador(self):
        rs = [{"pareja_a": ["Q", "R"], "pareja_b": ["S", "T"],
               "score_a": 9, "score_b": 5, "ganador": ""}]
        t = compute_individual_standings(rs)
        q = next(e for e in t if e.nombre == "Q")
        s = next(e for e in t if e.nombre == "S")
        assert q.partidos_ganados == 1
        assert s.partidos_perdidos == 1

    def test_ignora_resultados_malformados(self):
        rs = [
            {"pareja_a": ["solo"], "pareja_b": ["X", "Y"], "score_a": 9, "score_b": 5, "ganador": "A"},
            {"pareja_a": ["A", "B"], "pareja_b": ["C", "D"], "score_a": "x", "score_b": 0, "ganador": "A"},
            {"pareja_a": ["A", "B"], "pareja_b": ["C", "D"], "score_a": 9, "score_b": 5, "ganador": "A"},
        ]
        t = compute_individual_standings(rs)
        a = next(e for e in t if e.nombre == "A")
        assert a.partidos_jugados == 1, "Solo debió contar el 3º resultado"

    def test_efectividad_calculada(self):
        rs = [
            {"pareja_a": ["A", "B"], "pareja_b": ["C", "D"], "score_a": 9, "score_b": 5, "ganador": "A"},
            {"pareja_a": ["A", "C"], "pareja_b": ["B", "D"], "score_a": 9, "score_b": 5, "ganador": "B"},
        ]
        t = compute_individual_standings(rs)
        a = next(e for e in t if e.nombre == "A")
        assert a.partidos_jugados == 2
        assert a.partidos_ganados == 1
        assert a.efectividad == 50.0


# =============================================================================
# Endpoint POST /resultados con no-self-play validación
# =============================================================================
class TestResultadoUpsert:
    def test_post_basico_inserta_y_devuelve(self, admin_token, reta):
        r = requests.post(
            f"{API}/retas/{reta['id']}/resultados",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={"cancha": 1, "ronda": 1, "partido_idx": 0,
                  "pareja_a": ["A1", "A2"], "pareja_b": ["B1", "B2"],
                  "score_a": 9, "score_b": 5},
            timeout=10,
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["ganador"] == "A"
        assert d["partido_jugado"] is True

    def test_rechaza_self_play(self, admin_token, reta):
        # A1 está en ambas parejas — Pydantic lo rechaza
        r = requests.post(
            f"{API}/retas/{reta['id']}/resultados",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={"cancha": 1, "ronda": 1, "partido_idx": 0,
                  "pareja_a": ["A1", "A2"], "pareja_b": ["A1", "B2"],
                  "score_a": 9, "score_b": 5},
            timeout=10,
        )
        assert r.status_code == 422, r.text

    def test_rechaza_pareja_duplicada(self, admin_token, reta):
        # A1 está duplicado dentro de la misma pareja
        r = requests.post(
            f"{API}/retas/{reta['id']}/resultados",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={"cancha": 1, "ronda": 1, "partido_idx": 0,
                  "pareja_a": ["A1", "A1"], "pareja_b": ["B1", "B2"],
                  "score_a": 9, "score_b": 5},
            timeout=10,
        )
        assert r.status_code == 422, r.text

    def test_upsert_idempotente(self, admin_token, reta):
        body = {"cancha": 1, "ronda": 1, "partido_idx": 0,
                "pareja_a": ["X", "Y"], "pareja_b": ["Z", "W"],
                "score_a": 6, "score_b": 9}
        r1 = requests.post(f"{API}/retas/{reta['id']}/resultados",
            headers={"Authorization": f"Bearer {admin_token}"}, json=body, timeout=10)
        id1 = r1.json()["id"]
        # Corregir: cambiar score → mismo (cancha, ronda, partido_idx)
        body["score_a"] = 9
        body["score_b"] = 6
        r2 = requests.post(f"{API}/retas/{reta['id']}/resultados",
            headers={"Authorization": f"Bearer {admin_token}"}, json=body, timeout=10)
        assert r2.json()["id"] == id1, "Upsert debió usar mismo id"
        assert r2.json()["ganador"] == "A"

    def test_sin_admin_token_403(self, reta):
        r = requests.post(f"{API}/retas/{reta['id']}/resultados",
            json={"cancha": 1, "ronda": 1, "partido_idx": 0,
                  "pareja_a": ["A", "B"], "pareja_b": ["C", "D"],
                  "score_a": 9, "score_b": 5},
            timeout=10)
        assert r.status_code == 401  # OAuth2PasswordBearer devuelve 401

    def test_player_no_puede_capturar(self, reta):
        token = make_player_token()
        r = requests.post(f"{API}/retas/{reta['id']}/resultados",
            headers={"Authorization": f"Bearer {token}"},
            json={"cancha": 1, "ronda": 1, "partido_idx": 0,
                  "pareja_a": ["A", "B"], "pareja_b": ["C", "D"],
                  "score_a": 9, "score_b": 5},
            timeout=10)
        assert r.status_code == 403


class TestResultadoDelete:
    def test_delete_resultado_admin(self, admin_token, reta):
        # Insertar
        r = requests.post(f"{API}/retas/{reta['id']}/resultados",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={"cancha": 1, "ronda": 1, "partido_idx": 0,
                  "pareja_a": ["A", "B"], "pareja_b": ["C", "D"],
                  "score_a": 9, "score_b": 5},
            timeout=10)
        rid = r.json()["id"]
        # Borrar
        d = requests.delete(f"{API}/retas/{reta['id']}/resultados/{rid}",
            headers={"Authorization": f"Bearer {admin_token}"}, timeout=10)
        assert d.status_code == 200, d.text
        # Confirmar
        lst = requests.get(f"{API}/retas/{reta['id']}/resultados",
            headers={"Authorization": f"Bearer {admin_token}"}, timeout=10).json()
        assert not any(x["id"] == rid for x in lst)


# =============================================================================
# Endpoint GET /clasificacion con auth player/admin
# =============================================================================
class TestClasificacionAuth:
    def test_sin_token_401(self, reta):
        r = requests.get(f"{API}/retas/{reta['id']}/clasificacion", timeout=10)
        assert r.status_code == 401, r.text

    def test_admin_token_ok(self, admin_token, reta):
        r = requests.get(f"{API}/retas/{reta['id']}/clasificacion",
            headers={"Authorization": f"Bearer {admin_token}"}, timeout=10)
        assert r.status_code == 200, r.text
        assert isinstance(r.json(), list)

    def test_player_sin_inscripcion_403(self, reta):
        token = make_player_token(telefono="+5215599999999")
        r = requests.get(f"{API}/retas/{reta['id']}/clasificacion",
            headers={"Authorization": f"Bearer {token}"}, timeout=10)
        assert r.status_code == 403, r.text
        assert "no estás inscrito" in r.text.lower() or "no autorizado" in r.text.lower()

    def test_player_inscripcion_pendiente_403(self, admin_token, reta):
        # Inscribir vía checkout pero NO aprobar
        tel = "+5215511223344"
        c = requests.post(f"{API}/public/retas/{reta['id']}/checkout",
            json={"reta_id": reta['id'], "nombre": "Pending Player", "telefono": tel},
            timeout=10)
        assert c.status_code == 200, c.text
        token = make_player_token(telefono=tel)
        r = requests.get(f"{API}/retas/{reta['id']}/clasificacion",
            headers={"Authorization": f"Bearer {token}"}, timeout=10)
        assert r.status_code == 403, "Estatus Pendiente → 403"

    def test_player_aprobado_ok(self, admin_token, reta):
        tel = "+5215567890123"
        # Inscribir
        c = requests.post(f"{API}/public/retas/{reta['id']}/checkout",
            json={"reta_id": reta['id'], "nombre": "Approved Player", "telefono": tel},
            timeout=10)
        ins_id = c.json()["id"]
        # Aprobar via webhook mock
        w = requests.post(f"{API}/webhooks/payment",
            json={"inscripcion_id": ins_id, "status": "approved"}, timeout=10)
        assert w.status_code == 200
        token = make_player_token(telefono=tel)
        r = requests.get(f"{API}/retas/{reta['id']}/clasificacion",
            headers={"Authorization": f"Bearer {token}"}, timeout=10)
        assert r.status_code == 200, r.text


# =============================================================================
# WebSocket realtime
# =============================================================================
import websockets  # noqa: E402

WS_BASE = BASE_URL.replace("http://", "ws://").replace("https://", "wss://")


class TestWebsocketRealtime:
    @pytest.fixture
    def anyio_backend(self):
        return "asyncio"

    @pytest.mark.anyio
    async def test_ws_sin_token_cierra_403(self, reta):
        uri = f"{WS_BASE}/api/ws/retas/{reta['id']}"
        try:
            async with websockets.connect(uri) as ws:
                await ws.recv()
            pytest.fail("WS sin token debería haber sido rechazado")
        except websockets.exceptions.InvalidStatus as e:
            assert e.response.status_code == 403
        except websockets.exceptions.ConnectionClosed as e:
            assert e.rcvd.code in (4403, 1011)

    @pytest.mark.anyio
    async def test_ws_admin_recibe_hello(self, admin_token, reta):
        uri = f"{WS_BASE}/api/ws/retas/{reta['id']}?token={admin_token}"
        async with websockets.connect(uri) as ws:
            hello = json.loads(await asyncio.wait_for(ws.recv(), timeout=5))
            assert hello["type"] == "hello"
            assert hello["role"] == "admin"

    @pytest.mark.anyio
    async def test_ws_recibe_broadcast_post(self, admin_token, reta):
        uri = f"{WS_BASE}/api/ws/retas/{reta['id']}?token={admin_token}"
        async with websockets.connect(uri) as ws:
            await asyncio.wait_for(ws.recv(), timeout=5)  # hello
            # Trigger un POST de resultado
            async def post_it():
                await asyncio.sleep(0.2)
                return await asyncio.to_thread(
                    requests.post,
                    f"{API}/retas/{reta['id']}/resultados",
                    headers={"Authorization": f"Bearer {admin_token}"},
                    json={"cancha": 1, "ronda": 1, "partido_idx": 0,
                          "pareja_a": ["A", "B"], "pareja_b": ["C", "D"],
                          "score_a": 9, "score_b": 5},
                    timeout=10,
                )
            task = asyncio.create_task(post_it())
            msg = json.loads(await asyncio.wait_for(ws.recv(), timeout=5))
            await task
            assert msg["type"] == "standings_updated"
            assert msg["reta_id"] == reta["id"]
            assert msg.get("event") == "match_saved"

    @pytest.mark.anyio
    async def test_ws_ping_pong(self, admin_token, reta):
        uri = f"{WS_BASE}/api/ws/retas/{reta['id']}?token={admin_token}"
        async with websockets.connect(uri) as ws:
            await asyncio.wait_for(ws.recv(), timeout=5)  # hello
            await ws.send(json.dumps({"type": "ping"}))
            pong = json.loads(await asyncio.wait_for(ws.recv(), timeout=3))
            assert pong["type"] == "pong"
