"""Iter38 — Fase 1 (Reta parametrization extra fields) + Fase 2 (Dynamic Results + KO).

Covers the scenarios requested by the review:
  1) POST /api/retas persists new fields (num_ganadores_por_cancha,
     criterio_desempate, jugadores_por_cancha, formato_score with ko_enabled
     + cap_total) and roundtrip GET returns them.
  2) PUT /api/retas/{id} updates those fields.
  3) PUNTOS reta with cap_total=5/ko_enabled=true:
     - score 3-0 → 200 + terminado_por_ko=True
     - score 6-0 → 422 (excede cap_total)
     - Re-POST same coords on a KO match → 409
     - DELETE on the KO result → 200 ok
  4) TIEMPO reta: score_a=2/score_b=2 (empate) → 200, terminado_por_ko=False
  5) Legacy reta sin formato_score.cap_total acepta cualquier marcador.
"""
import time
import pytest


# ---- Helpers ----------------------------------------------------------------

def _build_reta_payload(
    *,
    nombre,
    formato_score,
    canchas=1,
    num_ganadores_por_cancha=1,
    criterio_desempate="A",
    jugadores_por_cancha=4,
    num_rondas=5,
    modalidad_juego="PUNTOS",
):
    return {
        "nombre": nombre,
        "club": "TEST_Club_Iter38",
        "fecha_str": "2030-01-15",
        "hora_str": "10:00",
        "tz_offset_minutes": -360,
        "canchas_disponibles": canchas,
        "max_jugadores": 8,
        "costo_inscripcion": 0.0,
        "modalidad_juego": modalidad_juego,
        "num_rondas": num_rondas,
        "formato_score": formato_score,
        "num_ganadores_por_cancha": num_ganadores_por_cancha,
        "criterio_desempate": criterio_desempate,
        "jugadores_por_cancha": jugadores_por_cancha,
    }


def _delete_reta(api_client, base_url, auth_headers, reta_id):
    try:
        api_client.delete(f"{base_url}/api/retas/{reta_id}", headers=auth_headers, timeout=20)
    except Exception:
        pass


# ---- Fase 1: Parametrization roundtrip --------------------------------------

class TestFase1Parametrization:
    """POST + GET + PUT roundtrip for the new Reta fields."""

    def test_post_persists_new_fields(self, api_client, base_url, auth_headers):
        payload = _build_reta_payload(
            nombre=f"TEST_Fase1_Roundtrip_{int(time.time())}",
            formato_score={
                "tipo": "PUNTOS",
                "valor": 5,
                "unidad": "juegos",
                "cap_total": 5,
                "ko_enabled": True,
            },
            num_ganadores_por_cancha=3,
            criterio_desempate="C",
            jugadores_por_cancha=6,
        )
        r = api_client.post(
            f"{base_url}/api/retas",
            json=payload,
            headers=auth_headers,
            timeout=20,
        )
        assert r.status_code == 200, f"Create failed: {r.status_code} {r.text}"
        data = r.json()
        rid = data["id"]

        try:
            # Persisted on response
            assert data["num_ganadores_por_cancha"] == 3
            assert data["criterio_desempate"] == "C"
            assert data["jugadores_por_cancha"] == 6
            fs = data["formato_score"]
            assert fs["tipo"] == "PUNTOS"
            assert fs["valor"] == 5
            assert fs["unidad"] == "juegos"
            assert fs["cap_total"] == 5
            assert fs["ko_enabled"] is True

            # GET roundtrip
            g = api_client.get(
                f"{base_url}/api/retas/{rid}", headers=auth_headers, timeout=20
            )
            assert g.status_code == 200
            gd = g.json()
            assert gd["num_ganadores_por_cancha"] == 3
            assert gd["criterio_desempate"] == "C"
            assert gd["jugadores_por_cancha"] == 6
            assert gd["formato_score"]["cap_total"] == 5
            assert gd["formato_score"]["ko_enabled"] is True
        finally:
            _delete_reta(api_client, base_url, auth_headers, rid)

    def test_put_updates_new_fields(self, api_client, base_url, auth_headers):
        # Create with defaults
        payload = _build_reta_payload(
            nombre=f"TEST_Fase1_PUT_{int(time.time())}",
            formato_score={
                "tipo": "PUNTOS",
                "valor": 9,
                "unidad": "juegos",
            },
        )
        r = api_client.post(
            f"{base_url}/api/retas", json=payload, headers=auth_headers, timeout=20
        )
        assert r.status_code == 200, r.text
        rid = r.json()["id"]

        try:
            # PUT with updated fields
            updated = _build_reta_payload(
                nombre=payload["nombre"] + "_upd",
                formato_score={
                    "tipo": "PUNTOS",
                    "valor": 5,
                    "unidad": "juegos",
                    "cap_total": 5,
                    "ko_enabled": True,
                },
                num_ganadores_por_cancha=2,
                criterio_desempate="B",
                jugadores_por_cancha=8,
            )
            p = api_client.put(
                f"{base_url}/api/retas/{rid}",
                json=updated,
                headers=auth_headers,
                timeout=20,
            )
            assert p.status_code == 200, f"PUT failed: {p.status_code} {p.text}"
            pd = p.json()
            assert pd["num_ganadores_por_cancha"] == 2
            assert pd["criterio_desempate"] == "B"
            assert pd["jugadores_por_cancha"] == 8
            assert pd["formato_score"]["cap_total"] == 5
            assert pd["formato_score"]["ko_enabled"] is True

            # GET to confirm persistence
            g = api_client.get(
                f"{base_url}/api/retas/{rid}", headers=auth_headers, timeout=20
            )
            assert g.status_code == 200
            gd = g.json()
            assert gd["num_ganadores_por_cancha"] == 2
            assert gd["criterio_desempate"] == "B"
            assert gd["jugadores_por_cancha"] == 8
            assert gd["formato_score"]["cap_total"] == 5
            assert gd["formato_score"]["ko_enabled"] is True
        finally:
            _delete_reta(api_client, base_url, auth_headers, rid)


# ---- Fase 2: Resultados con cap_total y KO ----------------------------------

@pytest.fixture
def reta_puntos_ko5(api_client, base_url, auth_headers):
    """Crea una reta PUNTOS cap_total=5 ko_enabled=true. Limpia al final."""
    payload = _build_reta_payload(
        nombre=f"TEST_Fase2_KO5_{int(time.time())}",
        formato_score={
            "tipo": "PUNTOS",
            "valor": 5,
            "unidad": "juegos",
            "cap_total": 5,
            "ko_enabled": True,
        },
        canchas=1,
        num_rondas=5,
    )
    r = api_client.post(
        f"{base_url}/api/retas", json=payload, headers=auth_headers, timeout=20
    )
    assert r.status_code == 200, r.text
    rid = r.json()["id"]
    yield rid
    _delete_reta(api_client, base_url, auth_headers, rid)


@pytest.fixture
def reta_tiempo(api_client, base_url, auth_headers):
    payload = _build_reta_payload(
        nombre=f"TEST_Fase2_Tiempo_{int(time.time())}",
        formato_score={
            "tipo": "TIEMPO",
            "valor": 15,
            "unidad": "minutos",
        },
        canchas=1,
        num_rondas=5,
        modalidad_juego="TIEMPO",
    )
    r = api_client.post(
        f"{base_url}/api/retas", json=payload, headers=auth_headers, timeout=20
    )
    assert r.status_code == 200, r.text
    rid = r.json()["id"]
    yield rid
    _delete_reta(api_client, base_url, auth_headers, rid)


@pytest.fixture
def reta_legacy_no_cap(api_client, base_url, auth_headers):
    payload = _build_reta_payload(
        nombre=f"TEST_Fase2_Legacy_{int(time.time())}",
        formato_score={
            "tipo": "PUNTOS",
            "valor": 9,
            "unidad": "juegos",
            # SIN cap_total ni ko_enabled
        },
        canchas=1,
        num_rondas=5,
    )
    r = api_client.post(
        f"{base_url}/api/retas", json=payload, headers=auth_headers, timeout=20
    )
    assert r.status_code == 200, r.text
    rid = r.json()["id"]
    yield rid
    _delete_reta(api_client, base_url, auth_headers, rid)


class TestFase2KOyCapTotal:

    def _result_body(self, score_a, score_b, cancha=1, ronda=1, partido_idx=0):
        return {
            "cancha": cancha,
            "ronda": ronda,
            "partido_idx": partido_idx,
            "pareja_a": ["TEST_P1", "TEST_P2"],
            "pareja_b": ["TEST_P3", "TEST_P4"],
            "score_a": score_a,
            "score_b": score_b,
        }

    def test_ko_3_0_auto_detection(self, api_client, base_url, auth_headers, reta_puntos_ko5):
        rid = reta_puntos_ko5
        r = api_client.post(
            f"{base_url}/api/retas/{rid}/resultados",
            json=self._result_body(3, 0),
            headers=auth_headers,
            timeout=20,
        )
        assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text}"
        d = r.json()
        assert d["terminado_por_ko"] is True, f"Should auto-mark KO: {d}"
        assert d["ganador"] == "A"
        assert d["score_a"] == 3 and d["score_b"] == 0

    def test_cap_total_exceeded_returns_422(self, api_client, base_url, auth_headers, reta_puntos_ko5):
        rid = reta_puntos_ko5
        r = api_client.post(
            f"{base_url}/api/retas/{rid}/resultados",
            json=self._result_body(6, 0),
            headers=auth_headers,
            timeout=20,
        )
        assert r.status_code == 422, f"Expected 422, got {r.status_code}: {r.text}"

    def test_ko_blocks_further_edits_with_409(self, api_client, base_url, auth_headers, reta_puntos_ko5):
        rid = reta_puntos_ko5
        # Establecer un partido KO
        r = api_client.post(
            f"{base_url}/api/retas/{rid}/resultados",
            json=self._result_body(3, 0),
            headers=auth_headers,
            timeout=20,
        )
        assert r.status_code == 200, r.text
        assert r.json()["terminado_por_ko"] is True

        # Reintentar mismo (cancha, ronda, partido_idx) — debe 409
        r2 = api_client.post(
            f"{base_url}/api/retas/{rid}/resultados",
            json=self._result_body(2, 2),
            headers=auth_headers,
            timeout=20,
        )
        assert r2.status_code == 409, f"Expected 409, got {r2.status_code}: {r2.text}"

    def test_delete_ko_result_allowed(self, api_client, base_url, auth_headers, reta_puntos_ko5):
        rid = reta_puntos_ko5
        r = api_client.post(
            f"{base_url}/api/retas/{rid}/resultados",
            json=self._result_body(3, 0),
            headers=auth_headers,
            timeout=20,
        )
        assert r.status_code == 200, r.text
        result_id = r.json()["id"]
        assert r.json()["terminado_por_ko"] is True

        d = api_client.delete(
            f"{base_url}/api/retas/{rid}/resultados/{result_id}",
            headers=auth_headers,
            timeout=20,
        )
        assert d.status_code == 200, f"Delete should be allowed, got {d.status_code}: {d.text}"
        body = d.json()
        assert body.get("ok") is True

        # Tras el delete, ya se puede recapturar el mismo slot
        r3 = api_client.post(
            f"{base_url}/api/retas/{rid}/resultados",
            json=self._result_body(2, 1),
            headers=auth_headers,
            timeout=20,
        )
        assert r3.status_code == 200, f"After delete, recapture should work: {r3.text}"
        assert r3.json()["terminado_por_ko"] is False

    def test_tiempo_allows_tie_and_no_ko(self, api_client, base_url, auth_headers, reta_tiempo):
        rid = reta_tiempo
        r = api_client.post(
            f"{base_url}/api/retas/{rid}/resultados",
            json=self._result_body(2, 2),
            headers=auth_headers,
            timeout=20,
        )
        assert r.status_code == 200, f"TIEMPO 2-2 should pass: {r.status_code} {r.text}"
        d = r.json()
        assert d["terminado_por_ko"] is False
        assert d["ganador"] in ("EMPATE", "E")
        assert d["score_a"] == 2 and d["score_b"] == 2

    def test_legacy_reta_without_cap_accepts_free_scores(
        self, api_client, base_url, auth_headers, reta_legacy_no_cap,
    ):
        rid = reta_legacy_no_cap
        # 9-6 sin cap_total → libre, no debe quedar bloqueado
        r = api_client.post(
            f"{base_url}/api/retas/{rid}/resultados",
            json=self._result_body(9, 6),
            headers=auth_headers,
            timeout=20,
        )
        assert r.status_code == 200, f"Legacy score should pass: {r.status_code} {r.text}"
        d = r.json()
        assert d["terminado_por_ko"] is False
        assert d["score_a"] == 9 and d["score_b"] == 6

        # 20-0 también permitido (sin cap)
        r2 = api_client.post(
            f"{base_url}/api/retas/{rid}/resultados",
            json=self._result_body(20, 0, partido_idx=1),
            headers=auth_headers,
            timeout=20,
        )
        assert r2.status_code == 200, f"Legacy high-score should pass: {r2.text}"
        assert r2.json()["terminado_por_ko"] is False
