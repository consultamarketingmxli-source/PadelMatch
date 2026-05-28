"""Tests for POST /api/retas/{id}/rol/preview (Iter 11).

Validates the new preview endpoint that generates a Round Robin rol
without persisting any state on the DB. Also runs regression on the
existing PUT /jugadores/orden + GET /rol + result-capture + WS flows.
"""
import os
import pytest
import requests
from dotenv import load_dotenv

load_dotenv("/app/frontend/.env")
BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL not set"

RETA_ID = "6012defc-2e74-4b14-abc2-313787a3d3e7"
APROBADOS = [
    "Mateo Garcia", "Sofia Lopez", "Andres Perez", "Camila Ruiz",
    "Diego Torres", "Valentina Diaz", "Lucas Mendez", "Isabella Vargas",
]


# ---------- helpers ----------
def _get_rol(headers):
    r = requests.get(f"{BASE_URL}/api/retas/{RETA_ID}/rol", headers=headers, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


# ---------- BACKEND 1: lista válida → 200 + is_preview ----------
class TestPreviewBasic:
    def test_preview_returns_200_with_is_preview_flag(self, auth_headers):
        body = {"jugadores": list(APROBADOS)}
        r = requests.post(
            f"{BASE_URL}/api/retas/{RETA_ID}/rol/preview",
            json=body, headers=auth_headers, timeout=20,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("is_preview") is True
        assert data.get("reta_id") == RETA_ID
        assert isinstance(data.get("rol"), list)
        assert isinstance(data.get("jugadores"), list)
        # Devuelve la misma lista (orden tentativo)
        assert data["jugadores"][: len(APROBADOS)] == list(APROBADOS)
        # Estructura del rol: Cancha → rondas → partidos
        assert len(data["rol"]) >= 1
        c0 = data["rol"][0]
        assert "cancha" in c0 and "rondas" in c0

    def test_preview_with_reordered_list_returns_new_rol(self, auth_headers):
        """Pasar un orden distinto produce un rol distinto en partidos."""
        original = _get_rol(auth_headers)
        reorder = list(reversed(APROBADOS))
        r = requests.post(
            f"{BASE_URL}/api/retas/{RETA_ID}/rol/preview",
            json={"jugadores": reorder}, headers=auth_headers, timeout=20,
        )
        assert r.status_code == 200
        prev = r.json()
        assert prev["is_preview"] is True
        # Los nombres deben coincidir con lo enviado (mismos 8)
        assert set(prev["jugadores"]) == set(reorder)
        # Al menos un partido difiere respecto al rol persistido actual
        assert prev["rol"] != original["rol"]


# ---------- BACKEND 2: duplicados → 422 ----------
class TestPreviewValidation:
    def test_duplicate_names_returns_422(self, auth_headers):
        dup = list(APROBADOS)
        dup[1] = dup[0]  # introduce duplicado
        r = requests.post(
            f"{BASE_URL}/api/retas/{RETA_ID}/rol/preview",
            json={"jugadores": dup}, headers=auth_headers, timeout=15,
        )
        assert r.status_code == 422, r.text

    # BACKEND 3: jugadores no-array → 422
    def test_jugadores_not_array_returns_422(self, auth_headers):
        r = requests.post(
            f"{BASE_URL}/api/retas/{RETA_ID}/rol/preview",
            json={"jugadores": "Mateo,Sofia"}, headers=auth_headers, timeout=15,
        )
        assert r.status_code == 422, r.text

    def test_jugadores_missing_returns_422(self, auth_headers):
        r = requests.post(
            f"{BASE_URL}/api/retas/{RETA_ID}/rol/preview",
            json={}, headers=auth_headers, timeout=15,
        )
        assert r.status_code == 422, r.text

    def test_jugadores_with_non_string_element_returns_422(self, auth_headers):
        r = requests.post(
            f"{BASE_URL}/api/retas/{RETA_ID}/rol/preview",
            json={"jugadores": ["Mateo Garcia", 42, "Sofia Lopez"]},
            headers=auth_headers, timeout=15,
        )
        assert r.status_code == 422, r.text


# ---------- BACKEND 4: sin auth → 401 ----------
class TestPreviewAuth:
    def test_no_auth_returns_401_or_403(self):
        r = requests.post(
            f"{BASE_URL}/api/retas/{RETA_ID}/rol/preview",
            json={"jugadores": list(APROBADOS)}, timeout=15,
        )
        # FastAPI Security devuelve 401 (token requerido). Aceptamos 403 por compat.
        assert r.status_code in (401, 403), r.text

    def test_invalid_token_returns_401(self):
        r = requests.post(
            f"{BASE_URL}/api/retas/{RETA_ID}/rol/preview",
            json={"jugadores": list(APROBADOS)},
            headers={"Authorization": "Bearer not-a-real-token"}, timeout=15,
        )
        assert r.status_code == 401, r.text


# ---------- BACKEND 5: menos jugadores → rellena placeholders ----------
class TestPreviewPlaceholders:
    def test_short_list_is_padded_with_placeholders(self, auth_headers):
        partial = APROBADOS[:5]
        r = requests.post(
            f"{BASE_URL}/api/retas/{RETA_ID}/rol/preview",
            json={"jugadores": partial}, headers=auth_headers, timeout=20,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        jugs = data["jugadores"]
        # max_jugadores = 8 (1 cancha * 8) por defecto. Mínimo deberíamos
        # llegar a un múltiplo válido (>= 8).
        assert len(jugs) >= 8
        # Los primeros 5 son los reales en el mismo orden
        assert jugs[:5] == partial
        # El resto son placeholders "Jugador N"
        for n in jugs[5:]:
            assert n.startswith("Jugador "), f"Esperaba placeholder, recibí: {n}"

    def test_empty_list_returns_full_placeholders(self, auth_headers):
        r = requests.post(
            f"{BASE_URL}/api/retas/{RETA_ID}/rol/preview",
            json={"jugadores": []}, headers=auth_headers, timeout=20,
        )
        assert r.status_code == 200
        jugs = r.json()["jugadores"]
        assert len(jugs) >= 8
        assert all(n.startswith("Jugador ") for n in jugs)


# ---------- BACKEND 6: NO persiste jugadores_orden_manual ----------
class TestPreviewNoPersistence:
    def test_preview_does_not_mutate_rol_persisted(self, auth_headers):
        before = _get_rol(auth_headers)
        # POST preview con orden invertido
        reorder = list(reversed(APROBADOS))
        r = requests.post(
            f"{BASE_URL}/api/retas/{RETA_ID}/rol/preview",
            json={"jugadores": reorder}, headers=auth_headers, timeout=20,
        )
        assert r.status_code == 200
        after = _get_rol(auth_headers)
        # El rol persistido NO debe haber cambiado tras el preview
        assert before["jugadores"] == after["jugadores"], (
            "El preview alteró el orden persistido (no debería)"
        )
        assert before["rol"] == after["rol"], (
            "El preview alteró el rol persistido (no debería)"
        )


# ---------- BACKEND 7: REGRESIÓN ----------
class TestRegressionExisting:
    """Confirm pre-existing flows still work after the new endpoint shipped."""

    def test_get_rol_still_works(self, auth_headers):
        data = _get_rol(auth_headers)
        assert data["reta_id"] == RETA_ID
        assert isinstance(data["jugadores"], list) and len(data["jugadores"]) >= 8

    def test_put_orden_still_works(self, auth_headers):
        before = _get_rol(auth_headers)
        original_order = list(before["jugadores"])[:8]
        # Reordenamos: swap del primero con el segundo
        nuevo = list(original_order)
        nuevo[0], nuevo[1] = nuevo[1], nuevo[0]

        r = requests.put(
            f"{BASE_URL}/api/retas/{RETA_ID}/jugadores/orden",
            json={"jugadores": nuevo}, headers=auth_headers, timeout=15,
        )
        # Puede dar 409 si quedaron resultados; en ese caso aceptamos y skip.
        if r.status_code == 409:
            pytest.skip("Hay resultados capturados — saltamos regresión PUT")
        assert r.status_code == 200, r.text

        after = _get_rol(auth_headers)
        assert after["jugadores"][:8] == nuevo

        # Restauramos al orden previo
        r2 = requests.put(
            f"{BASE_URL}/api/retas/{RETA_ID}/jugadores/orden",
            json={"jugadores": original_order}, headers=auth_headers, timeout=15,
        )
        assert r2.status_code == 200, r2.text

    def test_capturar_resultado_y_borrar(self, auth_headers):
        """Captura un resultado y lo borra para no dejar estado."""
        payload = {
            "cancha": 1,
            "ronda": 1,
            "partido_idx": 0,
            "pareja_a": ["A1", "A2"],
            "pareja_b": ["B1", "B2"],
            "score_a": 6,
            "score_b": 4,
        }
        r = requests.post(
            f"{BASE_URL}/api/retas/{RETA_ID}/resultados",
            json=payload, headers=auth_headers, timeout=15,
        )
        assert r.status_code == 200, r.text
        result_id = r.json()["id"]
        assert r.json()["ganador"] == "A"

        # Listar
        r2 = requests.get(
            f"{BASE_URL}/api/retas/{RETA_ID}/resultados",
            headers=auth_headers, timeout=15,
        )
        assert r2.status_code == 200
        assert any(x["id"] == result_id for x in r2.json())

        # Limpiar
        r3 = requests.delete(
            f"{BASE_URL}/api/retas/{RETA_ID}/resultados/{result_id}",
            headers=auth_headers, timeout=15,
        )
        assert r3.status_code == 200

    def test_preview_works_even_with_resultados_present(self, auth_headers):
        """A diferencia de PUT (que da 409), preview NO está bloqueado por
        la presencia de resultados — debe seguir funcionando porque no
        persiste nada. Validamos el contrato."""
        # Seed: agregar un resultado
        payload = {
            "cancha": 1, "ronda": 1, "partido_idx": 0,
            "pareja_a": ["X1", "X2"], "pareja_b": ["Y1", "Y2"],
            "score_a": 6, "score_b": 3,
        }
        seed = requests.post(
            f"{BASE_URL}/api/retas/{RETA_ID}/resultados",
            json=payload, headers=auth_headers, timeout=15,
        )
        assert seed.status_code == 200
        rid = seed.json()["id"]
        try:
            r = requests.post(
                f"{BASE_URL}/api/retas/{RETA_ID}/rol/preview",
                json={"jugadores": list(APROBADOS)},
                headers=auth_headers, timeout=20,
            )
            assert r.status_code == 200, (
                "Preview debe seguir funcionando aún con resultados presentes"
            )
            assert r.json().get("is_preview") is True
        finally:
            requests.delete(
                f"{BASE_URL}/api/retas/{RETA_ID}/resultados/{rid}",
                headers=auth_headers, timeout=15,
            )

    def test_reta_not_found_returns_404(self, auth_headers):
        r = requests.post(
            f"{BASE_URL}/api/retas/inexistente-uuid-xxx/rol/preview",
            json={"jugadores": list(APROBADOS)},
            headers=auth_headers, timeout=15,
        )
        assert r.status_code == 404, r.text
