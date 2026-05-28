"""
Tests for new EXPORT endpoints (iteration 14):
- GET /api/retas/{reta_id}/rol/csv
- GET /api/retas/{reta_id}/clasificacion/csv
- GET /api/retas/{reta_id}/clasificacion/pdf

Plus regression checks for:
- POST /api/auth/login
- POST /api/retas (create)
- POST /api/retas/{id}/pdf  (existing rol PDF)
- GET  /api/retas/{id}/clasificacion (standings)
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest
import requests

BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

BASE_URL = os.environ.get(
    "EXPO_PUBLIC_BACKEND_URL",
    "https://padel-tournament-hub-9.preview.emergentagent.com",
).rstrip("/")

API = f"{BASE_URL}/api"

ADMIN_EMAIL = "admin@padelappretas.com"
ADMIN_PASSWORD = "admin123"

# -------- helpers / module fixtures --------


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def admin_token(session):
    """Regression: login still works and returns access_token."""
    r = session.post(
        f"{API}/auth/login",
        json={"username": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        timeout=20,
    )
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    data = r.json()
    assert "access_token" in data and data["access_token"]
    return data["access_token"]


@pytest.fixture(scope="module")
def auth_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


@pytest.fixture(scope="module")
def test_reta(session, auth_headers):
    """Create a test reta: 1 cancha, 8 max_jugadores, 7 rondas, PUNTOS modality.

    Cleanup: best-effort delete at module teardown via DELETE /api/retas/{id} if exists,
    otherwise leave it (the request says cleanup but no DELETE endpoint guaranteed).
    """
    payload = {
        "nombre": "TEST_Export_Reta",
        "club": "TEST_Club_Export",
        "fecha_str": "2030-01-15",
        "hora_str": "10:00",
        "tz_offset_minutes": -360,
        "canchas_disponibles": 1,
        "max_jugadores": 8,
        "costo_inscripcion": 0.0,
        "modalidad_juego": "PUNTOS",
        "num_rondas": 7,
        "formato_score": {"tipo": "PUNTOS", "valor": 9, "unidad": "juegos"},
        "observaciones_publicas": "Test export endpoints",
    }
    r = session.post(f"{API}/retas", json=payload, headers=auth_headers, timeout=20)
    assert r.status_code == 200, f"Create reta failed: {r.status_code} {r.text}"
    data = r.json()
    assert "id" in data
    yield data
    # Cleanup attempt — only call if endpoint exists.
    try:
        session.delete(f"{API}/retas/{data['id']}", headers=auth_headers, timeout=10)
    except Exception:
        pass


@pytest.fixture(scope="module")
def reta_with_results(session, auth_headers, test_reta):
    """Capture a couple of resultados on the test reta to populate standings."""
    reta_id = test_reta["id"]
    # Use placeholder names (Jugador 1..8) since reta has 0 inscritos.
    results_payloads = [
        {
            "cancha": 1, "ronda": 1, "partido_idx": 0,
            "pareja_a": ["Jugador 1", "Jugador 2"],
            "pareja_b": ["Jugador 3", "Jugador 4"],
            "score_a": 9, "score_b": 6,
        },
        {
            "cancha": 1, "ronda": 1, "partido_idx": 1,
            "pareja_a": ["Jugador 5", "Jugador 6"],
            "pareja_b": ["Jugador 7", "Jugador 8"],
            "score_a": 7, "score_b": 9,
        },
        {
            "cancha": 1, "ronda": 2, "partido_idx": 0,
            "pareja_a": ["Jugador 1", "Jugador 3"],
            "pareja_b": ["Jugador 2", "Jugador 5"],
            "score_a": 9, "score_b": 9,  # empate
        },
    ]
    for body in results_payloads:
        r = session.post(
            f"{API}/retas/{reta_id}/resultados",
            json=body, headers=auth_headers, timeout=15,
        )
        assert r.status_code == 200, f"Resultado upsert failed: {r.status_code} {r.text}"
    return test_reta


# =========================================
# 1. Authentication (401 without token)
# =========================================
class TestAuth401:
    def test_rol_csv_requires_auth(self, session, test_reta):
        r = session.get(f"{API}/retas/{test_reta['id']}/rol/csv", timeout=15)
        assert r.status_code in (401, 403), f"Expected 401/403, got {r.status_code}"

    def test_clasificacion_csv_requires_auth(self, session, test_reta):
        r = session.get(f"{API}/retas/{test_reta['id']}/clasificacion/csv", timeout=15)
        assert r.status_code in (401, 403), f"Expected 401/403, got {r.status_code}"

    def test_clasificacion_pdf_requires_auth(self, session, test_reta):
        r = session.get(f"{API}/retas/{test_reta['id']}/clasificacion/pdf", timeout=15)
        assert r.status_code in (401, 403), f"Expected 401/403, got {r.status_code}"


# =========================================
# 2. GET /api/retas/{id}/rol/csv
# =========================================
class TestRolCsv:
    def test_rol_csv_returns_200_with_token(self, session, auth_headers, test_reta):
        r = session.get(
            f"{API}/retas/{test_reta['id']}/rol/csv",
            headers=auth_headers, timeout=20,
        )
        assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text[:200]}"
        ct = r.headers.get("content-type", "").lower()
        assert "text/csv" in ct, f"Expected text/csv, got {ct}"

        text = r.content.decode("utf-8")
        assert text.startswith("\ufeff"), "Response must start with UTF-8 BOM"
        # Header row check
        first_line = text.split("\n", 1)[0]
        assert "Cancha" in first_line
        assert "Ronda" in first_line
        assert "Partido" in first_line
        assert "Pareja A" in first_line

    def test_rol_csv_row_count(self, session, auth_headers, test_reta):
        r = session.get(
            f"{API}/retas/{test_reta['id']}/rol/csv",
            headers=auth_headers, timeout=20,
        )
        assert r.status_code == 200
        text = r.content.decode("utf-8").lstrip("\ufeff")
        rows = [ln for ln in text.splitlines() if ln.strip()]
        # 1 cancha × 7 rondas × 2 partidos + 1 header = 15 rows
        assert len(rows) >= 14, f"Expected at least 14 rows, got {len(rows)}"

    def test_rol_csv_404_for_nonexistent_reta(self, session, auth_headers):
        r = session.get(
            f"{API}/retas/nonexistent-reta-id-xyz/rol/csv",
            headers=auth_headers, timeout=15,
        )
        assert r.status_code == 404


# =========================================
# 3. GET /api/retas/{id}/clasificacion/csv
# =========================================
class TestClasificacionCsv:
    def test_csv_empty_returns_header_only(self, session, auth_headers, test_reta):
        """Before any resultados captured: header only."""
        r = session.get(
            f"{API}/retas/{test_reta['id']}/clasificacion/csv",
            headers=auth_headers, timeout=15,
        )
        assert r.status_code == 200
        ct = r.headers.get("content-type", "").lower()
        assert "text/csv" in ct
        text = r.content.decode("utf-8").lstrip("\ufeff")
        rows = [ln for ln in text.splitlines() if ln.strip()]
        assert len(rows) >= 1, "Expected at least header row"
        # Check 11 columns in header
        cols = rows[0].split(",")
        assert len(cols) == 11, f"Expected 11 cols, got {len(cols)}: {cols}"
        assert "Posición" in rows[0] or "Posici" in rows[0]
        assert "Jugador" in rows[0]
        assert "Puntos" in rows[0]

    def test_csv_with_results_has_data_rows(self, session, auth_headers, reta_with_results):
        r = session.get(
            f"{API}/retas/{reta_with_results['id']}/clasificacion/csv",
            headers=auth_headers, timeout=15,
        )
        assert r.status_code == 200
        text = r.content.decode("utf-8").lstrip("\ufeff")
        rows = [ln for ln in text.splitlines() if ln.strip()]
        assert len(rows) >= 2, f"Expected header + data rows, got {len(rows)}"
        # Check first data row has 11 columns
        data_cols = rows[1].split(",")
        assert len(data_cols) == 11, f"Data row should have 11 cols, got {len(data_cols)}"

    def test_csv_404_for_nonexistent_reta(self, session, auth_headers):
        r = session.get(
            f"{API}/retas/nonexistent-reta-id-xyz/clasificacion/csv",
            headers=auth_headers, timeout=15,
        )
        assert r.status_code == 404


# =========================================
# 4. GET /api/retas/{id}/clasificacion/pdf
# =========================================
class TestClasificacionPdf:
    def test_pdf_empty_returns_valid_pdf(self, session, auth_headers, test_reta):
        """A fresh reta with no resultados — but for this test we use a NEW reta
        because test_reta will be populated by reta_with_results fixture later.
        However module-scope ordering may interleave. Easiest: create a brand new empty reta."""
        payload = {
            "nombre": "TEST_Empty_Pdf",
            "club": "TEST_Club_Empty",
            "fecha_str": "2030-02-20",
            "hora_str": "11:00",
            "tz_offset_minutes": -360,
            "canchas_disponibles": 1,
            "max_jugadores": 8,
            "costo_inscripcion": 0.0,
            "modalidad_juego": "PUNTOS",
            "num_rondas": 7,
            "formato_score": {"tipo": "PUNTOS", "valor": 9, "unidad": "juegos"},
        }
        cr = session.post(f"{API}/retas", json=payload, headers=auth_headers, timeout=20)
        assert cr.status_code == 200
        empty_reta = cr.json()

        r = session.get(
            f"{API}/retas/{empty_reta['id']}/clasificacion/pdf",
            headers=auth_headers, timeout=30,
        )
        assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text[:200]}"
        ct = r.headers.get("content-type", "").lower()
        assert "application/pdf" in ct, f"Expected application/pdf, got {ct}"
        assert r.content[:4] == b"%PDF", f"Magic header not %PDF: {r.content[:8]!r}"
        assert len(r.content) > 1000, f"PDF size too small: {len(r.content)} bytes"
        # Save for later size comparison
        TestClasificacionPdf.empty_pdf_size = len(r.content)

    def test_pdf_with_results_is_larger(self, session, auth_headers, reta_with_results):
        r = session.get(
            f"{API}/retas/{reta_with_results['id']}/clasificacion/pdf",
            headers=auth_headers, timeout=30,
        )
        assert r.status_code == 200
        assert "application/pdf" in r.headers.get("content-type", "").lower()
        assert r.content[:4] == b"%PDF"
        assert len(r.content) > 1000
        # PDF with podium + table should be larger than empty PDF (with placeholder msg)
        empty_size = getattr(TestClasificacionPdf, "empty_pdf_size", 0)
        if empty_size:
            assert len(r.content) > empty_size, (
                f"PDF with results ({len(r.content)}) should be larger "
                f"than empty PDF ({empty_size})"
            )

    def test_pdf_404_for_nonexistent_reta(self, session, auth_headers):
        r = session.get(
            f"{API}/retas/nonexistent-reta-id-xyz/clasificacion/pdf",
            headers=auth_headers, timeout=15,
        )
        assert r.status_code == 404


# =========================================
# 5. Regression tests
# =========================================
class TestRegression:
    def test_login_still_works(self, session):
        r = session.post(
            f"{API}/auth/login",
            json={"username": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
            timeout=15,
        )
        assert r.status_code == 200
        assert "access_token" in r.json()

    def test_create_reta_still_works(self, session, auth_headers):
        payload = {
            "nombre": "TEST_Regression_Reta",
            "club": "TEST_Club_Reg",
            "fecha_str": "2030-03-10",
            "hora_str": "18:00",
            "tz_offset_minutes": -360,
            "canchas_disponibles": 2,
            "max_jugadores": 16,
            "modalidad_juego": "PUNTOS",
            "num_rondas": 7,
        }
        r = session.post(f"{API}/retas", json=payload, headers=auth_headers, timeout=20)
        assert r.status_code == 200
        data = r.json()
        assert "id" in data and data["nombre"] == "TEST_Regression_Reta"
        assert data["canchas_disponibles"] == 2
        assert data["max_jugadores"] == 16

    def test_existing_rol_pdf_endpoint(self, session, auth_headers, test_reta):
        """POST /api/retas/{id}/pdf still works (existing rol PDF endpoint)."""
        r = session.post(
            f"{API}/retas/{test_reta['id']}/pdf",
            headers=auth_headers, timeout=30,
        )
        assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text[:200]}"
        assert "application/pdf" in r.headers.get("content-type", "").lower()
        assert r.content[:4] == b"%PDF"
        assert len(r.content) > 1000

    def test_existing_clasificacion_endpoint(self, session, auth_headers, test_reta):
        """GET /api/retas/{id}/clasificacion (standings endpoint) still works."""
        r = session.get(
            f"{API}/retas/{test_reta['id']}/clasificacion",
            headers=auth_headers, timeout=15,
        )
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)
