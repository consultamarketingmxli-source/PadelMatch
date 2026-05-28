"""Iter 12 — Importación masiva de jugadores (CSV bulk).

Cubre los 10 escenarios solicitados por el main agent:
  BACKEND 1: 5 jugadores válidos → 200 OK, creadas=5, omitidos=[].
  BACKEND 2: Duplicados (case-insensitive) → razon='duplicado'.
  BACKEND 3: Exceso de cupo → razon='cupo_lleno' en los que sobran.
  BACKEND 4: Lista vacía → 422.
  BACKEND 5: >1000 items → 422 'Máximo 1000'.
  BACKEND 6: Con resultados capturados → 409.
  BACKEND 7: Sin auth → 401.
  BACKEND 8: Normaliza espacios extra ('Juan   Pérez' → 'Juan Pérez').
  BACKEND 9: Nombre vacío post-trim → razon='vacio'.
  BACKEND 10: REGRESIÓN — GET /rol, PUT /jugadores/orden, POST /rol/preview siguen funcionando.
"""
import uuid
from datetime import datetime, timezone

import pytest
import requests

from conftest import BASE_URL


DEMO_RETA_ID = "6012defc-2e74-4b14-abc2-313787a3d3e7"


# ---------- helpers ----------
def _create_reta(api_client, auth_headers, max_jugadores=8):
    """Crea una reta temporal con capacidad max_jugadores."""
    body = {
        "nombre": f"TEST_IMPORT_{uuid.uuid4().hex[:6]}",
        "club": "TestClub",
        "fecha_str": "2030-12-31",
        "hora_str": "18:00",
        "tz_offset_minutes": 0,
        "canchas_disponibles": 1,
        "max_jugadores": max_jugadores,
        "costo_inscripcion": 100,
        "modalidad_juego": "PUNTOS",
        "num_rondas": 7,
        "formato_score": {"tipo": "PUNTOS", "valor": 5, "unidad": "juegos"},
        "observaciones_publicas": "",
    }
    r = api_client.post(f"{BASE_URL}/api/retas", json=body, headers=auth_headers, timeout=20)
    assert r.status_code == 200, r.text
    return r.json()["id"]


def _cleanup(api_client, auth_headers, reta_id):
    try:
        api_client.delete(f"{BASE_URL}/api/retas/{reta_id}", headers=auth_headers, timeout=20)
    except Exception:
        pass


# ---------- BACKEND 1 ----------
def test_b1_import_5_jugadores_validos(api_client, auth_headers):
    reta_id = _create_reta(api_client, auth_headers, max_jugadores=8)
    try:
        payload = {"jugadores": [
            {"nombre": "Pedro Alvarez", "telefono": "+5215511111111"},
            {"nombre": "Ana Beltran"},
            {"nombre": "Carlos Castro", "telefono": "+5215522222222"},
            {"nombre": "Diana Diaz"},
            {"nombre": "Esteban Estrada"},
        ]}
        r = api_client.post(
            f"{BASE_URL}/api/retas/{reta_id}/inscripciones/import",
            json=payload, headers=auth_headers, timeout=20,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["creadas"] == 5
        assert data["omitidos"] == []
        assert data["total_aprobados"] == 5
        assert data["max_jugadores"] == 8

        # Verificar persistencia
        g = api_client.get(
            f"{BASE_URL}/api/retas/{reta_id}/inscripciones",
            headers=auth_headers, timeout=20,
        )
        assert g.status_code == 200
        nombres = {i["nombre"] for i in g.json()}
        for n in ("Pedro Alvarez", "Ana Beltran", "Carlos Castro", "Diana Diaz", "Esteban Estrada"):
            assert n in nombres
        # telefono opcional → "N/A"
        ana = next(i for i in g.json() if i["nombre"] == "Ana Beltran")
        assert ana["telefono"] == "N/A"
        assert ana["estatus_pago"] == "Aprobado"
    finally:
        _cleanup(api_client, auth_headers, reta_id)


# ---------- BACKEND 2 ----------
def test_b2_duplicado_case_insensitive(api_client, auth_headers):
    reta_id = _create_reta(api_client, auth_headers, max_jugadores=8)
    try:
        # primera inserción
        api_client.post(
            f"{BASE_URL}/api/retas/{reta_id}/inscripciones/import",
            json={"jugadores": [{"nombre": "Juan Perez"}]},
            headers=auth_headers, timeout=20,
        )
        # segunda con mismo nombre case-insensitive
        r = api_client.post(
            f"{BASE_URL}/api/retas/{reta_id}/inscripciones/import",
            json={"jugadores": [{"nombre": "JUAN PEREZ"}, {"nombre": "juan perez"}]},
            headers=auth_headers, timeout=20,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["creadas"] == 0
        assert len(data["omitidos"]) == 2
        for o in data["omitidos"]:
            assert o["razon"] == "duplicado"
    finally:
        _cleanup(api_client, auth_headers, reta_id)


# ---------- BACKEND 3 ----------
def test_b3_cupo_lleno_respeta_orden(api_client, auth_headers):
    reta_id = _create_reta(api_client, auth_headers, max_jugadores=4)
    try:
        payload = {"jugadores": [
            {"nombre": "A Uno"},
            {"nombre": "B Dos"},
            {"nombre": "C Tres"},
            {"nombre": "D Cuatro"},
            {"nombre": "E Cinco"},
            {"nombre": "F Seis"},
        ]}
        r = api_client.post(
            f"{BASE_URL}/api/retas/{reta_id}/inscripciones/import",
            json=payload, headers=auth_headers, timeout=20,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["creadas"] == 4
        assert len(data["omitidos"]) == 2
        # Orden respetado: E y F son los omitidos
        assert [o["nombre"] for o in data["omitidos"]] == ["E Cinco", "F Seis"]
        for o in data["omitidos"]:
            assert o["razon"] == "cupo_lleno"
        assert data["total_aprobados"] == 4
    finally:
        _cleanup(api_client, auth_headers, reta_id)


# ---------- BACKEND 4 ----------
def test_b4_lista_vacia_422(api_client, auth_headers):
    reta_id = _create_reta(api_client, auth_headers, max_jugadores=8)
    try:
        r = api_client.post(
            f"{BASE_URL}/api/retas/{reta_id}/inscripciones/import",
            json={"jugadores": []}, headers=auth_headers, timeout=20,
        )
        assert r.status_code == 422, r.text
    finally:
        _cleanup(api_client, auth_headers, reta_id)


# ---------- BACKEND 5 ----------
def test_b5_mas_de_1000_422(api_client, auth_headers):
    reta_id = _create_reta(api_client, auth_headers, max_jugadores=8)
    try:
        items = [{"nombre": f"Jugador {i}"} for i in range(1001)]
        r = api_client.post(
            f"{BASE_URL}/api/retas/{reta_id}/inscripciones/import",
            json={"jugadores": items}, headers=auth_headers, timeout=30,
        )
        assert r.status_code == 422, r.text
        # Mensaje debe contener "Máximo 1000"
        assert "1000" in r.text
    finally:
        _cleanup(api_client, auth_headers, reta_id)


# ---------- BACKEND 6 ----------
def test_b6_con_resultados_capturados_409(api_client, auth_headers):
    reta_id = _create_reta(api_client, auth_headers, max_jugadores=8)
    try:
        # Inscribir 8 para poder capturar resultado
        nombres = [f"Player{i}" for i in range(8)]
        api_client.post(
            f"{BASE_URL}/api/retas/{reta_id}/inscripciones/import",
            json={"jugadores": [{"nombre": n} for n in nombres]},
            headers=auth_headers, timeout=20,
        )
        # Capturar 1 resultado
        rb = {
            "cancha": 1, "ronda": 1, "partido_idx": 0,
            "pareja_a": [nombres[0], nombres[1]],
            "pareja_b": [nombres[2], nombres[3]],
            "score_a": 5, "score_b": 3,
        }
        rr = api_client.post(
            f"{BASE_URL}/api/retas/{reta_id}/resultados",
            json=rb, headers=auth_headers, timeout=20,
        )
        assert rr.status_code == 200, rr.text

        # Intentar import → 409
        r = api_client.post(
            f"{BASE_URL}/api/retas/{reta_id}/inscripciones/import",
            json={"jugadores": [{"nombre": "Extra Uno"}]},
            headers=auth_headers, timeout=20,
        )
        assert r.status_code == 409, r.text
    finally:
        _cleanup(api_client, auth_headers, reta_id)


# ---------- BACKEND 7 ----------
def test_b7_sin_auth_401():
    r = requests.post(
        f"{BASE_URL}/api/retas/{DEMO_RETA_ID}/inscripciones/import",
        json={"jugadores": [{"nombre": "X"}]},
        timeout=20,
    )
    assert r.status_code in (401, 403), r.text


# ---------- BACKEND 8 ----------
def test_b8_normaliza_espacios(api_client, auth_headers):
    reta_id = _create_reta(api_client, auth_headers, max_jugadores=8)
    try:
        r = api_client.post(
            f"{BASE_URL}/api/retas/{reta_id}/inscripciones/import",
            json={"jugadores": [{"nombre": "Juan   Pérez"}, {"nombre": "  Maria  Lopez  "}]},
            headers=auth_headers, timeout=20,
        )
        assert r.status_code == 200, r.text
        assert r.json()["creadas"] == 2

        g = api_client.get(
            f"{BASE_URL}/api/retas/{reta_id}/inscripciones",
            headers=auth_headers, timeout=20,
        )
        nombres = {i["nombre"] for i in g.json()}
        assert "Juan Pérez" in nombres
        assert "Maria Lopez" in nombres
    finally:
        _cleanup(api_client, auth_headers, reta_id)


# ---------- BACKEND 9 ----------
def test_b9_nombre_vacio_post_trim(api_client, auth_headers):
    reta_id = _create_reta(api_client, auth_headers, max_jugadores=8)
    try:
        r = api_client.post(
            f"{BASE_URL}/api/retas/{reta_id}/inscripciones/import",
            json={"jugadores": [
                {"nombre": "   "},
                {"nombre": ""},
                {"nombre": "A"},  # 1 char → demasiado corto, también vacio
                {"nombre": "Bien Nombre"},
            ]},
            headers=auth_headers, timeout=20,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["creadas"] == 1
        assert len(data["omitidos"]) == 3
        for o in data["omitidos"]:
            assert o["razon"] == "vacio"
    finally:
        _cleanup(api_client, auth_headers, reta_id)


# ---------- BACKEND 10: REGRESIÓN ----------
def test_b10_regresion_rol_orden_preview(api_client, auth_headers):
    # GET /rol
    r = api_client.get(
        f"{BASE_URL}/api/retas/{DEMO_RETA_ID}/rol",
        headers=auth_headers, timeout=20,
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert "rol" in data
    assert "jugadores" in data
    jugadores = data["jugadores"]
    assert len(jugadores) >= 4

    # POST /rol/preview con el mismo orden
    rp = api_client.post(
        f"{BASE_URL}/api/retas/{DEMO_RETA_ID}/rol/preview",
        json={"jugadores": jugadores},
        headers=auth_headers, timeout=20,
    )
    assert rp.status_code == 200, rp.text
    assert rp.json().get("is_preview") is True

    # PUT /jugadores/orden con el mismo orden (idempotente)
    rput = api_client.put(
        f"{BASE_URL}/api/retas/{DEMO_RETA_ID}/jugadores/orden",
        json={"jugadores": jugadores},
        headers=auth_headers, timeout=20,
    )
    assert rput.status_code == 200, rput.text
    assert rput.json().get("ok") is True


# ---------- BACKEND extra: duplicado vs reta demo (8/8, ya llena) ----------
def test_demo_reta_full_import_blocked_by_cupo(api_client, auth_headers):
    """La reta demo tiene 8/8 aprobados — todo import nuevo es cupo_lleno."""
    r = api_client.post(
        f"{BASE_URL}/api/retas/{DEMO_RETA_ID}/inscripciones/import",
        json={"jugadores": [{"nombre": f"TEST_DEMO_NUEVO_{uuid.uuid4().hex[:4]}"}]},
        headers=auth_headers, timeout=20,
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["creadas"] == 0
    assert data["omitidos"][0]["razon"] == "cupo_lleno"
    assert data["total_aprobados"] == 8
    assert data["max_jugadores"] == 8
