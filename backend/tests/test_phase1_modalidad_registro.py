"""Phase 1 — Modalidad de Registro (parejas foundation) backend tests.

Validates:
- Default behavior / retrocompat (modalidad_registro defaults to 'individual').
- Create / fetch with parejas_libres + permitir_individual_en_parejas.
- Create with parejas_mixtas.
- Update (PUT) round-trip including coherence flip.
- Coherence validator (silences flag when individual).
- Invalid enum values (422).
- Inscripcion new fields default to None/False (backward compat).
- Regression: list / delete still work.
"""
import os
import uuid

import pytest
import requests

BASE_URL = os.environ.get(
    "EXPO_PUBLIC_BACKEND_URL",
    "https://padel-tournament-hub-9.preview.emergentagent.com",
).rstrip("/")


# ---------- helpers / fixtures ----------

def _reta_payload(**overrides):
    base = {
        "nombre": f"TEST Phase1 {uuid.uuid4().hex[:6]}",
        "club": "TEST Club",
        "fecha_str": "2026-12-15",
        "hora_str": "18:00",
        "tz_offset_minutes": -360,
        "canchas_disponibles": 2,
        "max_jugadores": 8,
        "costo_inscripcion": 0.0,
        "modalidad_juego": "PUNTOS",
        "num_rondas": 7,
        "formato_score": {"tipo": "PUNTOS", "valor": 9, "unidad": "juegos"},
    }
    base.update(overrides)
    return base


@pytest.fixture(scope="module")
def created_ids():
    ids = []
    yield ids
    # Cleanup
    try:
        r = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"username": "admin@padelappretas.com", "password": "admin123"},
            timeout=15,
        )
        tok = r.json()["access_token"]
        headers = {"Authorization": f"Bearer {tok}"}
        for rid in ids:
            try:
                requests.delete(f"{BASE_URL}/api/retas/{rid}", headers=headers, timeout=15)
            except Exception:
                pass
    except Exception:
        pass


# ---------- 1. Default behavior / retrocompat ----------

class TestDefaults:
    def test_create_without_modalidad_defaults_to_individual(self, auth_headers, created_ids):
        r = requests.post(
            f"{BASE_URL}/api/retas",
            headers=auth_headers,
            json=_reta_payload(),
            timeout=20,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["modalidad_registro"] == "individual"
        assert data["permitir_individual_en_parejas"] is False
        created_ids.append(data["id"])

    def test_existing_reta_fetched_has_default_modalidad(self, auth_headers):
        """Pydantic default should backfill missing field on fetch."""
        r = requests.get(f"{BASE_URL}/api/retas", headers=auth_headers, timeout=20)
        assert r.status_code == 200
        items = r.json()
        assert isinstance(items, list)
        # Every serialized item must expose the new keys with valid values.
        for it in items:
            assert "modalidad_registro" in it
            assert it["modalidad_registro"] in ("individual", "parejas_libres", "parejas_mixtas")
            assert "permitir_individual_en_parejas" in it
            assert isinstance(it["permitir_individual_en_parejas"], bool)


# ---------- 2. parejas_libres ----------

class TestParejasLibres:
    def test_create_parejas_libres_with_free_agent_toggle(self, auth_headers, created_ids):
        r = requests.post(
            f"{BASE_URL}/api/retas",
            headers=auth_headers,
            json=_reta_payload(
                modalidad_registro="parejas_libres",
                permitir_individual_en_parejas=True,
            ),
            timeout=20,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["modalidad_registro"] == "parejas_libres"
        assert data["permitir_individual_en_parejas"] is True
        rid = data["id"]
        created_ids.append(rid)

        # GET round-trip
        g = requests.get(f"{BASE_URL}/api/retas/{rid}", headers=auth_headers, timeout=20)
        assert g.status_code == 200, g.text
        gd = g.json()
        assert gd["modalidad_registro"] == "parejas_libres"
        assert gd["permitir_individual_en_parejas"] is True


# ---------- 3. parejas_mixtas ----------

class TestParejasMixtas:
    def test_create_parejas_mixtas(self, auth_headers, created_ids):
        r = requests.post(
            f"{BASE_URL}/api/retas",
            headers=auth_headers,
            json=_reta_payload(modalidad_registro="parejas_mixtas"),
            timeout=20,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["modalidad_registro"] == "parejas_mixtas"
        # No flag passed → default False
        assert data["permitir_individual_en_parejas"] is False
        created_ids.append(data["id"])


# ---------- 4. Update (PUT) ----------

class TestUpdateModalidad:
    def test_update_individual_to_parejas_libres_and_back(self, auth_headers, created_ids):
        # 1. Create individual
        r = requests.post(
            f"{BASE_URL}/api/retas",
            headers=auth_headers,
            json=_reta_payload(),
            timeout=20,
        )
        assert r.status_code == 200
        rid = r.json()["id"]
        created_ids.append(rid)

        # 2. Update → parejas_libres + free agents
        put_payload = _reta_payload(
            modalidad_registro="parejas_libres",
            permitir_individual_en_parejas=True,
        )
        u = requests.put(
            f"{BASE_URL}/api/retas/{rid}",
            headers=auth_headers,
            json=put_payload,
            timeout=20,
        )
        assert u.status_code == 200, u.text
        ud = u.json()
        assert ud["modalidad_registro"] == "parejas_libres"
        assert ud["permitir_individual_en_parejas"] is True

        # Re-fetch
        g = requests.get(f"{BASE_URL}/api/retas/{rid}", headers=auth_headers, timeout=20)
        assert g.status_code == 200
        gd = g.json()
        assert gd["modalidad_registro"] == "parejas_libres"
        assert gd["permitir_individual_en_parejas"] is True

        # 3. PUT back to individual — coherence validator must flip flag to False
        back_payload = _reta_payload(
            modalidad_registro="individual",
            permitir_individual_en_parejas=True,  # invalid combo, must be silenced
        )
        u2 = requests.put(
            f"{BASE_URL}/api/retas/{rid}",
            headers=auth_headers,
            json=back_payload,
            timeout=20,
        )
        assert u2.status_code == 200, u2.text
        ud2 = u2.json()
        assert ud2["modalidad_registro"] == "individual"
        assert ud2["permitir_individual_en_parejas"] is False, (
            f"Coherence validator failed to silence flag on PUT. Got: {ud2}"
        )


# ---------- 5. Coherence validator on POST ----------

class TestCoherenceValidator:
    def test_individual_with_flag_true_is_silenced(self, auth_headers, created_ids):
        r = requests.post(
            f"{BASE_URL}/api/retas",
            headers=auth_headers,
            json=_reta_payload(
                modalidad_registro="individual",
                permitir_individual_en_parejas=True,
            ),
            timeout=20,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["modalidad_registro"] == "individual"
        assert data["permitir_individual_en_parejas"] is False, (
            "Coherence validator must silently set the flag to False when individual."
        )
        created_ids.append(data["id"])


# ---------- 6. Invalid enum values ----------

class TestInvalidValues:
    def test_invalid_modalidad_value(self, auth_headers):
        r = requests.post(
            f"{BASE_URL}/api/retas",
            headers=auth_headers,
            json=_reta_payload(modalidad_registro="foo"),
            timeout=20,
        )
        assert r.status_code == 422, f"Expected 422 for invalid enum, got {r.status_code}: {r.text}"

    def test_empty_modalidad_value(self, auth_headers):
        r = requests.post(
            f"{BASE_URL}/api/retas",
            headers=auth_headers,
            json=_reta_payload(modalidad_registro=""),
            timeout=20,
        )
        assert r.status_code == 422, f"Expected 422 for empty enum, got {r.status_code}: {r.text}"


# ---------- 7. Inscripcion model defaults (backward compat) ----------

class TestInscripcionDefaults:
    def test_public_checkout_inscripcion_has_new_fields_defaulted(
        self, auth_headers, created_ids
    ):
        # Create a reta to inscribe into.
        r = requests.post(
            f"{BASE_URL}/api/retas",
            headers=auth_headers,
            json=_reta_payload(),
            timeout=20,
        )
        assert r.status_code == 200
        rid = r.json()["id"]
        created_ids.append(rid)

        # POST inscripcion via public legacy checkout (no auth).
        body = {
            "reta_id": rid,
            "nombre": "TEST Phase1 Inscrito",
            "telefono": "+5215512345678",
        }
        ins = requests.post(
            f"{BASE_URL}/api/public/retas/{rid}/checkout",
            json=body,
            timeout=20,
        )
        assert ins.status_code == 200, ins.text
        ins_data = ins.json()
        # New fields must default correctly
        assert ins_data.get("pareja_grupo_id") is None
        assert ins_data.get("pareja_nombre") is None
        assert ins_data.get("pareja_telefono") is None
        assert ins_data.get("es_free_agent") is False

        # Admin GET inscripciones — same fields persisted
        ll = requests.get(
            f"{BASE_URL}/api/retas/{rid}/inscripciones",
            headers=auth_headers,
            timeout=20,
        )
        assert ll.status_code == 200
        items = ll.json()
        assert len(items) >= 1
        found = [i for i in items if i["id"] == ins_data["id"]]
        assert len(found) == 1
        rec = found[0]
        assert rec.get("pareja_grupo_id") is None
        assert rec.get("pareja_nombre") is None
        assert rec.get("pareja_telefono") is None
        assert rec.get("es_free_agent") is False


# ---------- 8. Regression ----------

class TestRegression:
    def test_login_works(self):
        r = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"username": "admin@padelappretas.com", "password": "admin123"},
            timeout=15,
        )
        assert r.status_code == 200
        assert "access_token" in r.json()

    def test_list_retas_includes_new_ones(self, auth_headers, created_ids):
        r = requests.get(f"{BASE_URL}/api/retas", headers=auth_headers, timeout=20)
        assert r.status_code == 200
        items = r.json()
        ids_in_list = {it["id"] for it in items}
        # At least one of our created IDs must be in the list
        for rid in created_ids:
            if rid in ids_in_list:
                return
        assert False, "None of the created retas were returned by list endpoint."

    def test_delete_reta_still_works(self, auth_headers):
        # Create a throwaway reta
        r = requests.post(
            f"{BASE_URL}/api/retas",
            headers=auth_headers,
            json=_reta_payload(nombre=f"TEST Del {uuid.uuid4().hex[:6]}"),
            timeout=20,
        )
        assert r.status_code == 200
        rid = r.json()["id"]
        d = requests.delete(
            f"{BASE_URL}/api/retas/{rid}",
            headers=auth_headers,
            timeout=20,
        )
        assert d.status_code == 200
        # Confirm gone
        g = requests.get(
            f"{BASE_URL}/api/retas/{rid}",
            headers=auth_headers,
            timeout=20,
        )
        assert g.status_code == 404
