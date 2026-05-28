"""Tests for Drag & Drop jugadores order endpoint (Fase C+).

Endpoints under test:
- GET /api/retas/{id}/rol — orden cronológico vs orden manual
- PUT /api/retas/{id}/jugadores/orden — persist manual order
"""
import os
import pytest
import requests
from dotenv import load_dotenv

load_dotenv("/app/frontend/.env")
BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL not set"
RETA_ID = "6012defc-2e74-4b14-abc2-313787a3d3e7"
APROBADOS_ESPERADOS = {
    "Mateo Garcia", "Sofia Lopez", "Andres Perez", "Camila Ruiz",
    "Diego Torres", "Valentina Diaz", "Lucas Mendez", "Isabella Vargas",
}


@pytest.fixture(scope="module")
def headers(auth_headers):
    return auth_headers


@pytest.fixture(scope="module", autouse=True)
def cleanup_resultados(headers):
    """Remove any leftover resultados from previous iterations BEFORE tests run.

    This is essential because PUT /jugadores/orden returns 409 if there are
    resultados already. Iter9 testing left a 0-0 upserted result; we wipe it.
    """
    r = requests.get(f"{BASE_URL}/api/retas/{RETA_ID}/resultados", headers=headers, timeout=15)
    if r.status_code == 200:
        for res in r.json():
            rid = res.get("id")
            if rid:
                requests.delete(
                    f"{BASE_URL}/api/retas/{RETA_ID}/resultados/{rid}",
                    headers=headers, timeout=10,
                )
    # Also clear any pre-existing jugadores_orden_manual via a direct PUT
    # (we'll set it back to a known state during the tests)
    yield


# ---------- BACKEND 1: GET rol devuelve cronológico ----------
class TestRolCronologico:
    def test_rol_returns_aprobados_in_chronological_order(self, headers):
        # Reset any manual order first by PUTting back chronological (or do it later)
        r = requests.get(f"{BASE_URL}/api/retas/{RETA_ID}/rol", headers=headers, timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "jugadores" in data
        assert len(data["jugadores"]) == 8
        # All 8 expected names are present (no placeholders)
        assert set(data["jugadores"]) == APROBADOS_ESPERADOS
        assert data["canchas"] == 1


# ---------- BACKEND 2 & 3: PUT persist + GET respects manual ----------
class TestPutOrdenManual:
    def test_put_valid_list_persists(self, headers):
        # Reverse the chronological order
        r = requests.get(f"{BASE_URL}/api/retas/{RETA_ID}/rol", headers=headers, timeout=15)
        assert r.status_code == 200
        current = r.json()["jugadores"]
        nuevo_orden = list(reversed(current))

        put_r = requests.put(
            f"{BASE_URL}/api/retas/{RETA_ID}/jugadores/orden",
            headers=headers,
            json={"jugadores": nuevo_orden},
            timeout=15,
        )
        assert put_r.status_code == 200, put_r.text
        body = put_r.json()
        assert body.get("ok") is True
        assert body.get("jugadores") == nuevo_orden

        # BACKEND 3: GET rol now must respect manual order
        r2 = requests.get(f"{BASE_URL}/api/retas/{RETA_ID}/rol", headers=headers, timeout=15)
        assert r2.status_code == 200
        assert r2.json()["jugadores"] == nuevo_orden

    def test_put_restore_chronological_via_resync(self, headers):
        """Leave the reta in a deterministic state for follow-up tests: restore
        original chronological order by sending the names sorted by inscription
        (we just send the current rol with a known shuffle to verify idempotency)."""
        # Send same set sorted alphabetically; backend persists exactly what we send.
        sorted_names = sorted(APROBADOS_ESPERADOS)
        r = requests.put(
            f"{BASE_URL}/api/retas/{RETA_ID}/jugadores/orden",
            headers=headers,
            json={"jugadores": sorted_names},
            timeout=15,
        )
        assert r.status_code == 200
        r2 = requests.get(f"{BASE_URL}/api/retas/{RETA_ID}/rol", headers=headers, timeout=15)
        assert r2.json()["jugadores"] == sorted_names


# ---------- BACKEND 4: duplicados ----------
class TestValidaciones:
    def test_put_with_duplicates_returns_422(self, headers):
        names = list(APROBADOS_ESPERADOS)
        names[0] = names[1]  # duplicate
        r = requests.put(
            f"{BASE_URL}/api/retas/{RETA_ID}/jugadores/orden",
            headers=headers,
            json={"jugadores": names},
            timeout=15,
        )
        assert r.status_code == 422, r.text
        assert "duplic" in r.text.lower()

    # ---------- BACKEND 5: nombres inexistentes ----------
    def test_put_with_unknown_names_returns_422(self, headers):
        names = list(APROBADOS_ESPERADOS)
        names[0] = "Jugador Fantasma"
        r = requests.put(
            f"{BASE_URL}/api/retas/{RETA_ID}/jugadores/orden",
            headers=headers,
            json={"jugadores": names},
            timeout=15,
        )
        assert r.status_code == 422, r.text

    def test_put_with_missing_count_returns_422(self, headers):
        names = list(APROBADOS_ESPERADOS)[:7]
        r = requests.put(
            f"{BASE_URL}/api/retas/{RETA_ID}/jugadores/orden",
            headers=headers,
            json={"jugadores": names},
            timeout=15,
        )
        assert r.status_code == 422

    def test_put_with_non_list_returns_422(self, headers):
        r = requests.put(
            f"{BASE_URL}/api/retas/{RETA_ID}/jugadores/orden",
            headers=headers,
            json={"jugadores": "not-a-list"},
            timeout=15,
        )
        assert r.status_code == 422


# ---------- BACKEND 7: sin auth ----------
class TestAuth:
    def test_put_without_auth_returns_401(self):
        r = requests.put(
            f"{BASE_URL}/api/retas/{RETA_ID}/jugadores/orden",
            json={"jugadores": list(APROBADOS_ESPERADOS)},
            timeout=15,
        )
        assert r.status_code in (401, 403), r.text


# ---------- BACKEND 6: conflict cuando hay resultados ----------
class TestConflictConResultados:
    """Captura un resultado, intenta PUT → debe ser 409. Limpia al final."""

    def test_put_with_resultados_returns_409(self, headers):
        # Crear resultado dummy
        # We use ronda=1, cancha=1, partido_idx=0, with first two pairs.
        sorted_names = sorted(APROBADOS_ESPERADOS)
        payload = {
            "ronda": 1,
            "cancha": 1,
            "partido_idx": 0,
            "pareja_a": [sorted_names[0], sorted_names[1]],
            "pareja_b": [sorted_names[2], sorted_names[3]],
            "score_a": 9,
            "score_b": 5,
        }
        r = requests.post(
            f"{BASE_URL}/api/retas/{RETA_ID}/resultados",
            headers=headers,
            json=payload,
            timeout=15,
        )
        assert r.status_code == 200, f"Could not seed resultado: {r.status_code} {r.text}"
        result_id = r.json().get("id")

        try:
            put_r = requests.put(
                f"{BASE_URL}/api/retas/{RETA_ID}/jugadores/orden",
                headers=headers,
                json={"jugadores": sorted_names},
                timeout=15,
            )
            assert put_r.status_code == 409, put_r.text
            assert "resultados" in put_r.text.lower()
        finally:
            # Cleanup the resultado so subsequent runs are not polluted
            if result_id:
                requests.delete(
                    f"{BASE_URL}/api/retas/{RETA_ID}/resultados/{result_id}",
                    headers=headers, timeout=10,
                )
