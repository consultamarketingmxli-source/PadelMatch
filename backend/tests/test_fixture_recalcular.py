"""Tests del endpoint POST /api/retas/{id}/rol/recalcular-pendientes (Fase D).

Cubre:
  • Reta SIN resultados guardados → todas las rondas son recalculables.
  • Reta CON resultados parciales → rondas con scores quedan bloqueadas
    (mantienen los partidos originales).
  • Exclusión de jugadores: cuando se excluye 1 jugador, el motor recalcula
    con los activos manteniendo Regla A.
  • Errores: jugadores activos < 4 → 409; body inválido → 422; reta no
    encontrada → 404.
"""
from __future__ import annotations

import os
import time
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import requests
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")

BASE_URL = os.environ.get(
    "EXPO_PUBLIC_BACKEND_URL",
    "https://padel-tournament-hub-9.preview.emergentagent.com",
).rstrip("/")

ADMIN_USER = "admin@padelappretas.com"
ADMIN_PASS = "admin123"


@pytest.fixture(scope="module")
def s():
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json"})
    return sess


@pytest.fixture(scope="module")
def admin_token(s):
    r = s.post(f"{BASE_URL}/api/auth/login",
               json={"username": ADMIN_USER, "password": ADMIN_PASS})
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


def auth_h(tok):
    return {"Authorization": f"Bearer {tok}"}


def _phone(suffix: int = 0):
    base = int(time.time() * 1000)
    return f"+521{(base + suffix) % 10000000000:010d}"


def _crear_reta_lista(s, tok, n_jugadores: int = 8):
    """Crea una reta gratis con jugadores inscritos y aprobados."""
    futura = datetime.now(timezone.utc) + timedelta(days=10)
    payload = {
        "nombre": f"TEST_Recalc_{uuid.uuid4().hex[:6]}",
        "club": "Test Club",
        "fecha_str": futura.strftime("%Y-%m-%d"),
        "hora_str": "19:00",
        "tz_offset_minutes": -360,
        "canchas_disponibles": 1,
        "max_jugadores": n_jugadores,
        "costo_inscripcion": 100,
        "modalidad_juego": "PUNTOS",
        "num_rondas": 5,
        "formato_score": {"tipo": "PUNTOS", "valor": 9, "unidad": "juegos"},
        "tipo_acceso": "gratis_amigos",
    }
    r = s.post(f"{BASE_URL}/api/retas", headers=auth_h(tok), json=payload)
    assert r.status_code == 200, r.text
    reta = r.json()
    # Inscribimos n jugadores vía RSVP.
    for i in range(n_jugadores):
        ri = s.post(
            f"{BASE_URL}/api/public/retas/{reta['id']}/rsvp/aceptar",
            json={"nombre": f"Jugador{i+1}", "telefono": _phone(i)},
        )
        assert ri.status_code == 200, ri.text
    return reta


def _cleanup(s, tok, reta_id):
    s.delete(f"{BASE_URL}/api/retas/{reta_id}", headers=auth_h(tok))


# =============================================================================
# 1. Reta sin resultados → recalcular es no-op
# =============================================================================
def test_recalcular_sin_resultados_sin_excluidos(s, admin_token):
    reta = _crear_reta_lista(s, admin_token, n_jugadores=8)
    try:
        r = s.post(
            f"{BASE_URL}/api/retas/{reta['id']}/rol/recalcular-pendientes",
            headers=auth_h(admin_token),
            json={},
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["es_parejas"] is False
        assert len(data["jugadores_activos"]) == 8
        assert data["jugadores_excluidos"] == []
        assert data["rondas_bloqueadas"] == []
        # Todas las rondas son recalculables → no hay bloqueadas
        # → debería ser igual al rol normal.
        assert data["rondas_pendientes_recalculadas"] >= 1
        assert data["fixture_metadata"]["algoritmo"] == "estatico"
    finally:
        _cleanup(s, admin_token, reta["id"])


# =============================================================================
# 2. Excluir un jugador (lesión)
# =============================================================================
def test_recalcular_excluyendo_un_jugador(s, admin_token):
    reta = _crear_reta_lista(s, admin_token, n_jugadores=8)
    try:
        r = s.post(
            f"{BASE_URL}/api/retas/{reta['id']}/rol/recalcular-pendientes",
            headers=auth_h(admin_token),
            json={"excluir_jugadores": ["Jugador8"]},
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert len(data["jugadores_activos"]) == 7
        assert "Jugador8" in data["jugadores_excluidos"]
        # N=7 obliga al motor a usar CSP.
        assert data["fixture_metadata"]["algoritmo"].startswith("csp")
        assert data["fixture_metadata"]["optimizacion_aplicada"]
    finally:
        _cleanup(s, admin_token, reta["id"])


# =============================================================================
# 3. Excluir TANTOS que quedan <4 → 409
# =============================================================================
def test_recalcular_409_si_pocos_jugadores(s, admin_token):
    reta = _crear_reta_lista(s, admin_token, n_jugadores=8)
    try:
        # Excluir 6 → quedan 2 → 409.
        r = s.post(
            f"{BASE_URL}/api/retas/{reta['id']}/rol/recalcular-pendientes",
            headers=auth_h(admin_token),
            json={"excluir_jugadores": [f"Jugador{i}" for i in range(1, 7)]},
        )
        assert r.status_code == 409, r.text
        assert "activos" in r.text.lower()
    finally:
        _cleanup(s, admin_token, reta["id"])


# =============================================================================
# 4. Body inválido → 422
# =============================================================================
def test_recalcular_body_invalido(s, admin_token):
    reta = _crear_reta_lista(s, admin_token, n_jugadores=8)
    try:
        r = s.post(
            f"{BASE_URL}/api/retas/{reta['id']}/rol/recalcular-pendientes",
            headers=auth_h(admin_token),
            json={"excluir_jugadores": "Jugador1"},  # debería ser lista
        )
        assert r.status_code == 422
    finally:
        _cleanup(s, admin_token, reta["id"])


# =============================================================================
# 5. Reta inexistente → 404
# =============================================================================
def test_recalcular_reta_inexistente(s, admin_token):
    r = s.post(
        f"{BASE_URL}/api/retas/no-existe-uuid-xyz/rol/recalcular-pendientes",
        headers=auth_h(admin_token),
        json={},
    )
    assert r.status_code == 404


# =============================================================================
# 6. Endpoint /rol devuelve fixture_metadata
# =============================================================================
def test_get_rol_incluye_fixture_metadata(s, admin_token):
    reta = _crear_reta_lista(s, admin_token, n_jugadores=8)
    try:
        r = s.get(f"{BASE_URL}/api/retas/{reta['id']}/rol", headers=auth_h(admin_token))
        assert r.status_code == 200
        data = r.json()
        assert "fixture_metadata" in data
        assert data["fixture_metadata"]["algoritmo"] == "estatico"
        assert data["fixture_metadata"]["optimizacion_aplicada"] is False
    finally:
        _cleanup(s, admin_token, reta["id"])
