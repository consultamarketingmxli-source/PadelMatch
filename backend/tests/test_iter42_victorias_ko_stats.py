"""Iter42 — Fase 4: stat `victorias_ko` en el perfil del jugador.

Regla de negocio:
    - victorias_ko cuenta cuando terminado_por_ko=true Y el jugador estuvo
      en la pareja GANADORA.
    - terminado_por_ko=true se calcula automáticamente cuando la reta tiene
      formato_score.ko_enabled=true, cap_total=5, y el score es N-0 con
      N >= cap/2+1=3 (es decir, 3-0 KO).

Endpoints bajo prueba:
    - POST /api/retas                              (crear reta)
    - POST /api/retas/{id}/resultados              (registrar partido)
    - GET  /api/public/players/{telefono}/stats    (devuelve victorias_ko)
"""
import os
import random
import uuid

import pytest
import requests


def _rand_digits(n: int = 7) -> str:
    """Genera N dígitos aleatorios para construir teléfonos E.164 válidos."""
    return "".join(str(random.randint(0, 9)) for _ in range(n))

BASE_URL = os.environ.get(
    "EXPO_PUBLIC_BACKEND_URL",
    "https://padel-tournament-hub-9.preview.emergentagent.com",
).rstrip("/")
ADMIN_EMAIL = "admin@padelappretas.com"
ADMIN_PASSWORD = "admin123"


@pytest.fixture(scope="module")
def http():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def auth_hdr(http):
    r = http.post(
        f"{BASE_URL}/api/auth/login",
        json={"username": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        timeout=20,
    )
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _create_reta_ko(http, hdr, suffix=""):
    """Crea una reta con formato_score KO habilitado (PUNTOS a 5, KO 3-0)."""
    payload = {
        "nombre": f"TEST_Iter42_KO_{suffix}_{uuid.uuid4().hex[:6]}",
        "club": "TEST_ClubKO",
        "fecha_str": "2030-02-15",
        "hora_str": "20:00",
        "tz_offset_minutes": -360,
        "canchas_disponibles": 1,
        "max_jugadores": 8,
        "costo_inscripcion": 0.0,
        "modalidad_juego": "PUNTOS",
        "num_rondas": 5,
        "tipo_acceso": "gratis_amigos",
        "formato_score": {
            "tipo": "PUNTOS",
            "valor": 5,
            "unidad": "juegos",
            "cap_total": 5,
            "ko_enabled": True,
        },
    }
    r = http.post(f"{BASE_URL}/api/retas", json=payload, headers=hdr, timeout=20)
    assert r.status_code == 200, f"Create reta failed: {r.status_code} {r.text}"
    return r.json()


def _ensure_user(http, nombre, telefono):
    """Asegura que el jugador exista en db.usuarios escribiéndolo directo
    en Mongo (saltea OTP/rate-limit y el match telefono-strict del schema).
    Idempotente: usa upsert por telefono.
    """
    from pymongo import MongoClient

    mongo_url = os.getenv("MONGO_URL", "mongodb://localhost:27017")
    db_name = os.getenv("DB_NAME", "test_database")
    client = MongoClient(mongo_url)
    try:
        coll = client[db_name].usuarios
        coll.update_one(
            {"telefono": telefono},
            {
                "$setOnInsert": {
                    "id": uuid.uuid4().hex,
                    "nombre": nombre,
                    "telefono": telefono,
                    "creado_en": __import__("datetime").datetime.utcnow().isoformat(),
                    "rol": "jugador",
                },
            },
            upsert=True,
        )
    finally:
        client.close()
    return 200


def _post_result(http, hdr, reta_id, *, cancha, ronda, partido_idx,
                  pareja_a, pareja_b, score_a, score_b):
    body = {
        "cancha": cancha,
        "ronda": ronda,
        "partido_idx": partido_idx,
        "pareja_a": pareja_a,
        "pareja_b": pareja_b,
        "score_a": score_a,
        "score_b": score_b,
    }
    r = http.post(
        f"{BASE_URL}/api/retas/{reta_id}/resultados",
        json=body,
        headers=hdr,
        timeout=20,
    )
    assert r.status_code == 200, (
        f"POST resultado failed ({score_a}-{score_b}): "
        f"{r.status_code} {r.text}"
    )
    return r.json()


# ---------- TEST 1: caso happy-path completo ----------
def test_player_X_victorias_ko_count(http, auth_hdr):
    """X juega 3 partidos: (a) 3-0 ganador KO, (b) 3-2 ganador no-KO,
    (c) 1-3 X en pareja_a perdedora → no KO.
    Expectativa: partidos_jugados=3, partidos_ganados=2, victorias_ko=1,
    efectividad=66.7."""
    suffix = uuid.uuid4().hex[:6]
    nombre_x = f"TEST_X_{suffix}"
    tel_x = f"+5215511{_rand_digits(6)}"

    # 1. Crear reta KO.
    reta = _create_reta_ko(http, auth_hdr, suffix=suffix)
    reta_id = reta["id"]

    # 2. Asegurar usuario X registrado (con teléfono).
    _ensure_user(http, nombre_x, tel_x)

    # 3. Registrar 3 partidos.
    # (a) 3-0 con X en pareja_a (ganadora) → KO.
    r_a = _post_result(
        http, auth_hdr, reta_id,
        cancha=1, ronda=1, partido_idx=0,
        pareja_a=[nombre_x, f"A1_{suffix}"],
        pareja_b=[f"B1_{suffix}", f"B2_{suffix}"],
        score_a=3, score_b=0,
    )
    assert r_a["terminado_por_ko"] is True, "Partido 3-0 debería ser KO"
    assert r_a["ganador"] == "A"

    # (b) 3-2 con X en pareja_a (ganadora) → no KO.
    r_b = _post_result(
        http, auth_hdr, reta_id,
        cancha=1, ronda=2, partido_idx=0,
        pareja_a=[nombre_x, f"C1_{suffix}"],
        pareja_b=[f"D1_{suffix}", f"D2_{suffix}"],
        score_a=3, score_b=2,
    )
    assert r_b["terminado_por_ko"] is False, "3-2 no debería ser KO"
    assert r_b["ganador"] == "A"

    # (c) 1-3 con X en pareja_a (perdedora) → no KO, X pierde.
    r_c = _post_result(
        http, auth_hdr, reta_id,
        cancha=1, ronda=3, partido_idx=0,
        pareja_a=[nombre_x, f"E1_{suffix}"],
        pareja_b=[f"F1_{suffix}", f"F2_{suffix}"],
        score_a=1, score_b=3,
    )
    assert r_c["terminado_por_ko"] is False, "1-3 no debería ser KO"
    assert r_c["ganador"] == "B"

    # 4. GET stats del jugador.
    r = http.get(
        f"{BASE_URL}/api/public/players/{tel_x}/stats",
        timeout=15,
    )
    assert r.status_code == 200, f"GET stats failed: {r.status_code} {r.text}"
    stats = r.json()

    # Validaciones explícitas.
    assert stats["nombre"] == nombre_x, f"Nombre incorrecto: {stats}"
    assert stats["partidos_jugados"] == 3, f"PJ debería ser 3, got {stats}"
    assert stats["partidos_ganados"] == 2, f"PG debería ser 2, got {stats}"
    assert stats["victorias_ko"] == 1, f"victorias_ko debería ser 1, got {stats}"
    assert stats["efectividad"] == 66.7, f"efectividad debería ser 66.7, got {stats}"


# ---------- TEST 2: edge — ningún partido fue KO ----------
def test_player_no_ko_matches(http, auth_hdr):
    """Si ninguno de los partidos del jugador fue KO, victorias_ko=0
    aunque tenga partidos_ganados."""
    suffix = uuid.uuid4().hex[:6]
    nombre = f"TEST_Y_{suffix}"
    telefono = f"+5215522{_rand_digits(6)}"

    reta = _create_reta_ko(http, auth_hdr, suffix=suffix)
    reta_id = reta["id"]
    _ensure_user(http, nombre, telefono)

    # 2 victorias sin KO + 1 derrota sin KO.
    _post_result(http, auth_hdr, reta_id,
                 cancha=1, ronda=1, partido_idx=0,
                 pareja_a=[nombre, f"a1_{suffix}"],
                 pareja_b=[f"b1_{suffix}", f"b2_{suffix}"],
                 score_a=3, score_b=2)
    _post_result(http, auth_hdr, reta_id,
                 cancha=1, ronda=2, partido_idx=0,
                 pareja_a=[nombre, f"c1_{suffix}"],
                 pareja_b=[f"d1_{suffix}", f"d2_{suffix}"],
                 score_a=3, score_b=1)
    _post_result(http, auth_hdr, reta_id,
                 cancha=1, ronda=3, partido_idx=0,
                 pareja_a=[nombre, f"e1_{suffix}"],
                 pareja_b=[f"f1_{suffix}", f"f2_{suffix}"],
                 score_a=2, score_b=3)

    r = http.get(f"{BASE_URL}/api/public/players/{telefono}/stats", timeout=15)
    assert r.status_code == 200
    stats = r.json()
    assert stats["partidos_jugados"] == 3
    assert stats["partidos_ganados"] == 2
    assert stats["victorias_ko"] == 0, f"victorias_ko debería ser 0, got {stats}"


# ---------- TEST 3: edge — jugador en pareja PERDEDORA de un KO ----------
def test_player_on_losing_side_of_ko(http, auth_hdr):
    """Si el jugador estuvo en la pareja PERDEDORA de un partido KO,
    su victorias_ko NO debe incrementarse (solo cuenta para ganadores)."""
    suffix = uuid.uuid4().hex[:6]
    nombre = f"TEST_Z_{suffix}"
    telefono = f"+5215533{_rand_digits(6)}"

    reta = _create_reta_ko(http, auth_hdr, suffix=suffix)
    reta_id = reta["id"]
    _ensure_user(http, nombre, telefono)

    # Z está en pareja_b, score_a=3, score_b=0 → A gana por KO, Z PIERDE.
    res = _post_result(
        http, auth_hdr, reta_id,
        cancha=1, ronda=1, partido_idx=0,
        pareja_a=[f"W1_{suffix}", f"W2_{suffix}"],
        pareja_b=[nombre, f"L1_{suffix}"],
        score_a=3, score_b=0,
    )
    assert res["terminado_por_ko"] is True
    assert res["ganador"] == "A"

    r = http.get(f"{BASE_URL}/api/public/players/{telefono}/stats", timeout=15)
    assert r.status_code == 200
    stats = r.json()
    assert stats["partidos_jugados"] == 1
    assert stats["partidos_ganados"] == 0
    assert stats["victorias_ko"] == 0, (
        f"Z perdió un KO → victorias_ko debe ser 0, got {stats}"
    )


# ---------- TEST 4: retro-compat — jugador sin resultados ----------
def test_player_no_results_backward_compat(http, auth_hdr):
    """Jugador registrado pero sin partidos → victorias_ko=0 (default)."""
    suffix = uuid.uuid4().hex[:6]
    nombre = f"TEST_NewUser_{suffix}"
    telefono = f"+5215544{_rand_digits(6)}"

    _ensure_user(http, nombre, telefono)

    r = http.get(f"{BASE_URL}/api/public/players/{telefono}/stats", timeout=15)
    assert r.status_code == 200
    stats = r.json()
    assert stats["partidos_jugados"] == 0
    assert stats["partidos_ganados"] == 0
    assert stats["victorias_ko"] == 0, f"Sin resultados → victorias_ko=0, got {stats}"
    assert stats["efectividad"] == 0.0


# ---------- TEST 5: teléfono inexistente → stats vacíos con victorias_ko=0 ----------
def test_phone_not_registered_returns_zero_stats(http):
    """Teléfono que no existe en usuarios devuelve stats=0 con victorias_ko=0
    (retro-compat: response no debe crashear por nuevo campo)."""
    fake_phone = f"+5219999{uuid.uuid4().hex[:6]}"
    r = http.get(f"{BASE_URL}/api/public/players/{fake_phone}/stats", timeout=15)
    assert r.status_code == 200
    stats = r.json()
    assert "victorias_ko" in stats, "El campo victorias_ko debe estar en la respuesta"
    assert stats["victorias_ko"] == 0
    assert stats["partidos_jugados"] == 0
