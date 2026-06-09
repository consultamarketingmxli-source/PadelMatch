"""Fase 3 — Tie-breaker engine (criterios A/B/C) regression suite.

Coverage:
  1. Unit: compute_individual_standings respects criterio A / B / C in PG ties.
  2. Endpoint GET /api/retas/{id}/clasificacion respects criterio_desempate='C'.
  3. Retro-compat: reta without criterio_desempate defaults to 'A'.
  4. Endpoint criterio='B' uses only DG (no GF tiebreaker).
  5. Endpoint GET /api/public/retas/{id}/tabla also respects criterio_desempate.

Players X, Y, Z are crafted so PG=1 each but DG / ratio differ:
    X → GF=10, GC=6,  DG=+4, ratio=10/6≈1.667
    Y → GF=8,  GC=8,  DG= 0, ratio=8/8=1.0
    Z → GF=11, GC=6,  DG=+5, ratio=11/6≈1.833

Expected orderings of X/Y/Z (PG tie, all =1):
    A: Z > X > Y      (DG desc, then GF)
    B: Z > X > Y      (DG only)
    C: Z > X > Y      (ratio desc) — same direction; we still verify
                       that C uses ratio path (extra check below).

For criterio='B' isolation (test 4): build a scenario where A and B
*disagree* — same DG but different GF.
    P → GF=10, GC=6,  DG=+4
    Q → GF=8,  GC=4,  DG=+4
  A:  P (DG=4, GF=10) > Q (DG=4, GF=8)
  B:  both DG=+4 → tied → alphabetic ('P' < 'Q') → P > Q  (still same)
  → To force a divergence we use names: 'zeta' and 'alpha' so alphabetic
    decides in B. Both DG=+4 → A breaks by GF (zeta GF=10 wins);
    B breaks alphabetically (alpha wins).
"""
import os
import sys
import time
import uuid
from pathlib import Path

import pytest
import requests
from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))
load_dotenv(BACKEND_DIR / ".env")

# Allow importing the pure function for unit tests
from core.standings import compute_individual_standings  # noqa: E402


# ============================================================================
# Helpers
# ============================================================================
def _mk_result(reta_id, cancha, ronda, idx, pa, pb, sa, sb):
    g = "A" if sa > sb else ("B" if sb > sa else "EMPATE")
    return {
        "reta_id": reta_id,
        "cancha": cancha,
        "ronda": ronda,
        "partido_idx": idx,
        "pareja_a": pa,
        "pareja_b": pb,
        "score_a": sa,
        "score_b": sb,
        "ganador": g,
    }


def _xyz_results(reta_id="r"):
    """Return 6 result docs producing X/Y/Z PG-tied stats described in header."""
    return [
        _mk_result(reta_id, 1, 1, 0, ["X", "P1"], ["P2", "P3"], 6, 1),   # X wins
        _mk_result(reta_id, 1, 1, 1, ["Y", "P4"], ["P5", "P6"], 6, 3),   # Y wins
        _mk_result(reta_id, 1, 2, 0, ["Z", "P7"], ["P8", "P9"], 6, 0),   # Z wins
        _mk_result(reta_id, 1, 2, 1, ["X", "P10"], ["P11", "P12"], 4, 5),  # X loses
        _mk_result(reta_id, 1, 3, 0, ["Y", "P13"], ["P14", "P15"], 2, 5),  # Y loses
        _mk_result(reta_id, 1, 3, 1, ["Z", "P16"], ["P17", "P18"], 5, 6),  # Z loses
    ]


def _positions(standings, names):
    """Return {name: index} for the requested players inside the standings list."""
    return {n: i for i, e in enumerate(standings) if (n := e.nombre) in names}


# ============================================================================
# 1. UNIT TESTS — compute_individual_standings tie-breaker
# ============================================================================
class TestStandingsCriterios:
    """Direct unit tests on the pure function."""

    def test_criterio_A_orders_by_DG_then_GF(self):
        out = compute_individual_standings(_xyz_results(), criterio="A")
        # Extract the X/Y/Z subsequence preserving order
        order = [e.nombre for e in out if e.nombre in {"X", "Y", "Z"}]
        assert order == ["Z", "X", "Y"], f"Expected Z>X>Y, got {order}"

        idx = {e.nombre: e for e in out}
        # Sanity on stats
        assert idx["X"].partidos_ganados == 1
        assert idx["X"].juegos_a_favor == 10 and idx["X"].juegos_en_contra == 6
        assert idx["X"].diferencia == 4
        assert idx["Y"].juegos_a_favor == 8 and idx["Y"].juegos_en_contra == 8
        assert idx["Y"].diferencia == 0
        assert idx["Z"].juegos_a_favor == 11 and idx["Z"].juegos_en_contra == 6
        assert idx["Z"].diferencia == 5

    def test_criterio_B_orders_by_DG_only(self):
        out = compute_individual_standings(_xyz_results(), criterio="B")
        order = [e.nombre for e in out if e.nombre in {"X", "Y", "Z"}]
        assert order == ["Z", "X", "Y"], f"Expected Z>X>Y (DG only), got {order}"

    def test_criterio_C_orders_by_ratio(self):
        out = compute_individual_standings(_xyz_results(), criterio="C")
        order = [e.nombre for e in out if e.nombre in {"X", "Y", "Z"}]
        # ratios: Z=1.833, X=1.667, Y=1.0
        assert order == ["Z", "X", "Y"], f"Expected Z>X>Y (ratio), got {order}"

    def test_criterio_B_vs_A_diverge_when_DG_equal_and_GF_differs(self):
        """B should NOT use GF as 2nd-tier; A should.

        Scenario: 'zeta' and 'alpha' both PG=1, DG=+4 but different GF.
            zeta: win 6-1, lose 4-5    → GF=10 GC=6 DG=+4 ratio≈1.667
            alpha: win 8-3, lose 0-1   → GF=8  GC=4 DG=+4 ratio=2.0
        A: tiebreak by GF desc → zeta (10) > alpha (8)
        B: tiebreak by name asc → 'alpha' < 'zeta' → alpha > zeta
        C: tiebreak by ratio desc → alpha (2.0) > zeta (1.667)
        """
        rid = "rdiv"
        docs = [
            _mk_result(rid, 1, 1, 0, ["zeta", "p1"], ["p2", "p3"], 6, 1),   # zeta wins +5
            _mk_result(rid, 1, 1, 1, ["alpha", "p4"], ["p5", "p6"], 8, 3),  # alpha wins +5
            _mk_result(rid, 1, 2, 0, ["zeta", "p7"], ["p8", "p9"], 4, 5),   # zeta loses -1
            _mk_result(rid, 1, 2, 1, ["alpha", "p10"], ["p11", "p12"], 0, 1),  # alpha loses -1
        ]
        # zeta totals: PG=1 GF=10 GC=6 DG=+4
        # alpha totals: PG=1 GF=8 GC=4 DG=+4
        out_a = [e.nombre for e in compute_individual_standings(docs, criterio="A") if e.nombre in {"zeta", "alpha"}]
        out_b = [e.nombre for e in compute_individual_standings(docs, criterio="B") if e.nombre in {"zeta", "alpha"}]
        out_c = [e.nombre for e in compute_individual_standings(docs, criterio="C") if e.nombre in {"zeta", "alpha"}]

        assert out_a == ["zeta", "alpha"], f"A (DG→GF) expected zeta>alpha got {out_a}"
        assert out_b == ["alpha", "zeta"], f"B (DG only→name) expected alpha>zeta got {out_b}"
        assert out_c == ["alpha", "zeta"], f"C (ratio 2.0>1.667) expected alpha>zeta got {out_c}"


# ============================================================================
# 2-5. ENDPOINT TESTS
# ============================================================================
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
def admin_token(http):
    r = http.post(
        f"{BASE_URL}/api/auth/login",
        json={"username": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        timeout=20,
    )
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def auth_hdr(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


def _create_reta(http, hdr, *, criterio=None, suffix=""):
    payload = {
        "nombre": f"TEST_Iter40_{suffix}_{uuid.uuid4().hex[:6]}",
        "club": "TEST_ClubTie",
        "fecha_str": "2030-01-15",
        "hora_str": "20:00",
        "tz_offset_minutes": -360,
        "canchas_disponibles": 1,
        "max_jugadores": 8,
        "costo_inscripcion": 0.0,
        "modalidad_juego": "PUNTOS",
        "num_rondas": 5,
        "tipo_acceso": "gratis_amigos",
    }
    if criterio is not None:
        payload["criterio_desempate"] = criterio
    r = http.post(f"{BASE_URL}/api/retas", json=payload, headers=hdr, timeout=20)
    assert r.status_code == 200, f"Create reta failed: {r.status_code} {r.text}"
    body = r.json()
    return body


def _post_xyz_results(http, hdr, reta_id):
    """POST the 6 X/Y/Z matches against the live backend."""
    matches = [
        (1, 1, 0, ["X", "P1"], ["P2", "P3"], 6, 1),
        (1, 1, 1, ["Y", "P4"], ["P5", "P6"], 6, 3),
        (1, 2, 0, ["Z", "P7"], ["P8", "P9"], 6, 0),
        (1, 2, 1, ["X", "P10"], ["P11", "P12"], 4, 5),
        (1, 3, 0, ["Y", "P13"], ["P14", "P15"], 2, 5),
        (1, 3, 1, ["Z", "P16"], ["P17", "P18"], 5, 6),
    ]
    for cancha, ronda, idx, pa, pb, sa, sb in matches:
        body = {
            "cancha": cancha,
            "ronda": ronda,
            "partido_idx": idx,
            "pareja_a": pa,
            "pareja_b": pb,
            "score_a": sa,
            "score_b": sb,
        }
        r = http.post(
            f"{BASE_URL}/api/retas/{reta_id}/resultados",
            json=body,
            headers=hdr,
            timeout=20,
        )
        assert r.status_code == 200, f"Result POST failed: {r.status_code} {r.text}"


def _post_diverge_results(http, hdr, reta_id):
    """zeta vs alpha — same PG=1 and DG=+4, different GF/ratio."""
    matches = [
        (1, 1, 0, ["zeta", "p1"], ["p2", "p3"], 6, 1),    # zeta wins
        (1, 1, 1, ["alpha", "p4"], ["p5", "p6"], 8, 3),   # alpha wins
        (1, 2, 0, ["zeta", "p7"], ["p8", "p9"], 4, 5),    # zeta loses
        (1, 2, 1, ["alpha", "p10"], ["p11", "p12"], 0, 1),  # alpha loses
    ]
    for cancha, ronda, idx, pa, pb, sa, sb in matches:
        body = {
            "cancha": cancha,
            "ronda": ronda,
            "partido_idx": idx,
            "pareja_a": pa,
            "pareja_b": pb,
            "score_a": sa,
            "score_b": sb,
        }
        r = http.post(
            f"{BASE_URL}/api/retas/{reta_id}/resultados",
            json=body,
            headers=hdr,
            timeout=20,
        )
        assert r.status_code == 200, f"Result POST failed: {r.status_code} {r.text}"


def _extract(order, names):
    return [n for n in order if n in names]


# --- Test 2: criterio='C' via /api/retas/{id}/clasificacion (admin) ---
class TestEndpointCriterioC:
    def test_clasificacion_with_criterio_C(self, http, auth_hdr):
        reta = _create_reta(http, auth_hdr, criterio="C", suffix="C")
        assert reta["criterio_desempate"] == "C"
        _post_xyz_results(http, auth_hdr, reta["id"])

        r = http.get(
            f"{BASE_URL}/api/retas/{reta['id']}/clasificacion",
            headers=auth_hdr,
            timeout=20,
        )
        assert r.status_code == 200, f"{r.status_code} {r.text}"
        order = [e["nombre"] for e in r.json()]
        sub = _extract(order, {"X", "Y", "Z"})
        # criterio C: ratio desc → Z(1.833) > X(1.667) > Y(1.0)
        assert sub == ["Z", "X", "Y"], f"criterio=C expected Z>X>Y got {sub}"


# --- Test 3: retro-compat — default criterio A ---
class TestRetroCompatDefaultA:
    def test_default_criterio_is_A(self, http, auth_hdr):
        # Create WITHOUT sending criterio_desempate — model default should be 'A'.
        reta = _create_reta(http, auth_hdr, criterio=None, suffix="default")
        assert reta.get("criterio_desempate", "A") == "A", \
            f"Default criterio should be A, got {reta.get('criterio_desempate')}"

        _post_xyz_results(http, auth_hdr, reta["id"])
        r = http.get(
            f"{BASE_URL}/api/retas/{reta['id']}/clasificacion",
            headers=auth_hdr,
            timeout=20,
        )
        assert r.status_code == 200
        order = [e["nombre"] for e in r.json()]
        sub = _extract(order, {"X", "Y", "Z"})
        # criterio A (default): DG desc → Z(+5) > X(+4) > Y(0)
        assert sub == ["Z", "X", "Y"], f"default(A) expected Z>X>Y got {sub}"


# --- Test 4: criterio='B' — only DG, no GF tiebreaker ---
class TestEndpointCriterioB:
    def test_criterio_B_uses_only_DG(self, http, auth_hdr):
        reta = _create_reta(http, auth_hdr, criterio="B", suffix="B")
        assert reta["criterio_desempate"] == "B"
        _post_diverge_results(http, auth_hdr, reta["id"])

        r = http.get(
            f"{BASE_URL}/api/retas/{reta['id']}/clasificacion",
            headers=auth_hdr,
            timeout=20,
        )
        assert r.status_code == 200
        order = [e["nombre"] for e in r.json()]
        sub = _extract(order, {"zeta", "alpha"})
        # B: tie on DG=+4, no GF tiebreak → alphabetic → alpha > zeta
        assert sub == ["alpha", "zeta"], \
            f"criterio=B expected alpha>zeta (alphabetic) got {sub}"

        # Cross-check: with same data under A, zeta should win (GF=10 > 8).
        # We DON'T create a separate A reta — just call the pure function.
        from core.standings import compute_individual_standings as cis
        docs = [
            _mk_result(reta["id"], 1, 1, 0, ["zeta", "p1"], ["p2", "p3"], 6, 1),
            _mk_result(reta["id"], 1, 1, 1, ["alpha", "p4"], ["p5", "p6"], 8, 3),
            _mk_result(reta["id"], 1, 2, 0, ["zeta", "p7"], ["p8", "p9"], 4, 5),
            _mk_result(reta["id"], 1, 2, 1, ["alpha", "p10"], ["p11", "p12"], 0, 1),
        ]
        sub_A = [e.nombre for e in cis(docs, criterio="A") if e.nombre in {"zeta", "alpha"}]
        assert sub_A == ["zeta", "alpha"], \
            f"Sanity: criterio=A expected zeta>alpha got {sub_A}"


# --- Test 5: /api/public/retas/{id}/tabla respects criterio ---
class TestPublicTableRespectsCriterio:
    def test_public_tabla_with_criterio_B(self, http, auth_hdr):
        reta = _create_reta(http, auth_hdr, criterio="B", suffix="pubB")
        _post_diverge_results(http, auth_hdr, reta["id"])

        # No auth header → public endpoint
        r = requests.get(
            f"{BASE_URL}/api/public/retas/{reta['id']}/tabla", timeout=20
        )
        assert r.status_code == 200, f"{r.status_code} {r.text}"
        order = [e["nombre"] for e in r.json()]
        sub = _extract(order, {"zeta", "alpha"})
        # Same divergence test: B should yield alpha > zeta even on public endpoint.
        assert sub == ["alpha", "zeta"], \
            f"public criterio=B expected alpha>zeta got {sub}"

    def test_public_tabla_with_criterio_C(self, http, auth_hdr):
        reta = _create_reta(http, auth_hdr, criterio="C", suffix="pubC")
        _post_xyz_results(http, auth_hdr, reta["id"])

        r = requests.get(
            f"{BASE_URL}/api/public/retas/{reta['id']}/tabla", timeout=20
        )
        assert r.status_code == 200
        order = [e["nombre"] for e in r.json()]
        sub = _extract(order, {"X", "Y", "Z"})
        assert sub == ["Z", "X", "Y"], f"public criterio=C expected Z>X>Y got {sub}"
