"""Tests para el Motor de Búsqueda Híbrido — GET /api/public/retas/buscar.

Cubre las 3 vías combinables: A) GPS Haversine, B) texto libre, C) fallback fecha ASC.
"""
import os

import pytest
import requests

BASE_URL = os.environ["EXPO_BACKEND_URL"].rstrip("/")
ENDPOINT = f"{BASE_URL}/api/public/retas/buscar"


@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


# === Vía C: Fallback sin params ===
class TestFallbackOrdenado:
    def test_sin_params_devuelve_lista(self, api):
        r = api.get(ENDPOINT, timeout=10)
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)
        assert len(data) >= 2  # seed: Reta Demo + Reta MP Test
        # campos mínimos
        for reta in data:
            assert "id" in reta and "nombre" in reta and "fecha_evento" in reta

    def test_sin_params_ordenado_por_fecha_asc(self, api):
        r = api.get(ENDPOINT, timeout=10)
        data = r.json()
        fechas = [d["fecha_evento"] for d in data]
        assert fechas == sorted(fechas), f"Fechas no ascendentes: {fechas}"

    def test_seed_data_presente(self, api):
        r = api.get(ENDPOINT, timeout=10)
        nombres = [d["nombre"] for d in r.json()]
        assert "Reta Demo" in nombres
        assert "Reta MP Test" in nombres


# === Vía B: Texto libre ===
class TestTextoLibre:
    def test_q_club_encuentra_match(self, api):
        r = api.get(ENDPOINT, params={"q": "club"}, timeout=10)
        assert r.status_code == 200
        data = r.json()
        assert len(data) >= 1
        for d in data:
            blob = (d["nombre"] + " " + d["club"]).lower()
            assert "club" in blob

    def test_q_demo_devuelve_reta_demo(self, api):
        r = api.get(ENDPOINT, params={"q": "demo"}, timeout=10)
        assert r.status_code == 200
        data = r.json()
        nombres = [d["nombre"] for d in data]
        assert "Reta Demo" in nombres

    def test_q_case_insensitive(self, api):
        r1 = api.get(ENDPOINT, params={"q": "DEMO"}, timeout=10)
        r2 = api.get(ENDPOINT, params={"q": "demo"}, timeout=10)
        assert r1.status_code == 200 and r2.status_code == 200
        assert {d["id"] for d in r1.json()} == {d["id"] for d in r2.json()}

    def test_q_solo_espacios_ignora_filtro(self, api):
        # 3 espacios → debe comportarse como fallback C
        r = api.get(ENDPOINT, params={"q": "   "}, timeout=10)
        assert r.status_code == 200
        data = r.json()
        assert len(data) >= 2  # mismo que sin filtro

    def test_q_trim_aplicado(self, api):
        r1 = api.get(ENDPOINT, params={"q": "  demo  "}, timeout=10)
        r2 = api.get(ENDPOINT, params={"q": "demo"}, timeout=10)
        assert {d["id"] for d in r1.json()} == {d["id"] for d in r2.json()}

    def test_q_mp_encuentra_reta_mp(self, api):
        r = api.get(ENDPOINT, params={"q": "MP"}, timeout=10)
        assert r.status_code == 200
        nombres = [d["nombre"] for d in r.json()]
        assert "Reta MP Test" in nombres

    def test_q_sin_match_devuelve_vacio(self, api):
        r = api.get(ENDPOINT, params={"q": "zzzzznoexiste9999"}, timeout=10)
        assert r.status_code == 200
        assert r.json() == []

    def test_q_metacaracter_regex_no_rompe(self, api):
        # caracteres regex deben escaparse server-side
        r = api.get(ENDPOINT, params={"q": "(.*"}, timeout=10)
        assert r.status_code == 200
        assert isinstance(r.json(), list)


# === Vía A: GPS Haversine ===
class TestGpsHaversine:
    def test_lat_lng_cdmx_radio_30_devuelve_reta_demo(self, api):
        # Reta Demo está en 19.4326,-99.1332 → distancia 0
        r = api.get(
            ENDPOINT,
            params={"lat": 19.4326, "lng": -99.1332, "radio_km": 30},
            timeout=10,
        )
        assert r.status_code == 200
        data = r.json()
        nombres = [d["nombre"] for d in data]
        assert "Reta Demo" in nombres
        # Reta MP Test no tiene lat/lng → debe omitirse
        assert "Reta MP Test" not in nombres

    def test_lat_lng_lejos_devuelve_vacio(self, api):
        # Polo Norte → ninguna reta dentro de 30km
        r = api.get(
            ENDPOINT,
            params={"lat": 89.0, "lng": 0.0, "radio_km": 30},
            timeout=10,
        )
        assert r.status_code == 200
        assert r.json() == []

    def test_sin_lng_ignora_geo(self, api):
        # lat sin lng → backend debe ignorar el filtro geo (fallback)
        r = api.get(ENDPOINT, params={"lat": 19.4326}, timeout=10)
        assert r.status_code == 200
        data = r.json()
        # debe devolver TODAS las retas (incluida la sin coords)
        nombres = [d["nombre"] for d in data]
        assert "Reta MP Test" in nombres
        assert "Reta Demo" in nombres

    def test_retas_sin_lat_lng_omitidas_no_rompen(self, api):
        # Con GPS activo, retas sin lat/lng no rompen el endpoint (200, lista válida)
        r = api.get(
            ENDPOINT,
            params={"lat": 19.4326, "lng": -99.1332, "radio_km": 30},
            timeout=10,
        )
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_lat_fuera_de_rango_400(self, api):
        r = api.get(ENDPOINT, params={"lat": 999, "lng": 0}, timeout=10)
        assert r.status_code == 422  # Pydantic validation

    def test_radio_km_fuera_de_rango_400(self, api):
        r = api.get(
            ENDPOINT,
            params={"lat": 19.4, "lng": -99.1, "radio_km": 500},
            timeout=10,
        )
        assert r.status_code == 422


# === Combinación A+B ===
class TestCombinacionTextoYGeo:
    def test_q_padel_lat_lng_cdmx(self, api):
        r = api.get(
            ENDPOINT,
            params={"q": "padel", "lat": 19.4326, "lng": -99.1332, "radio_km": 50},
            timeout=10,
        )
        assert r.status_code == 200
        data = r.json()
        # Debe encontrar Reta Demo (club "Padel Club CDMX" + coords cdmx)
        nombres = [d["nombre"] for d in data]
        assert "Reta Demo" in nombres
        # Reta MP Test (sin coords) NO debe aparecer aunque su nombre incluya MP
        assert "Reta MP Test" not in nombres

    def test_q_no_match_con_geo_devuelve_vacio(self, api):
        r = api.get(
            ENDPOINT,
            params={"q": "zzzzzz", "lat": 19.4326, "lng": -99.1332, "radio_km": 50},
            timeout=10,
        )
        assert r.status_code == 200
        assert r.json() == []
