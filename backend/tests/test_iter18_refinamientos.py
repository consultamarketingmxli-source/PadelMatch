"""Iter18 — Validación de refinamientos UX/copy + bug fixes.

Cubre los nuevos puntos del review_request:
  1. GET /api/admin/twilio/sandbox-info con admin auth → 200 con shape correcto.
  2. Sin auth → 401/403.
  3. POST /api/retas/{id}/free-agents/match con DOS jugadores DEL MISMO TELÉFONO → 400.
  4. POST /api/retas/{id}/free-agents/match con IDs iguales → 400 (regresión).
  5. POST /api/retas/{id}/free-agents/match con uno ya emparejado → 409 (regresión).
  6. POST /api/retas/{id}/free-agents/match exitoso → 200 + pareja_grupo_id (regresión).
"""
import os
import uuid

import pytest
import requests

BASE_URL = os.environ.get(
    "EXPO_PUBLIC_BACKEND_URL",
    "https://padel-tournament-hub-9.preview.emergentagent.com",
).rstrip("/")

ADMIN = {"username": "admin@padelappretas.com", "password": "admin123"}


# ============ helpers ============
def _login():
    r = requests.post(f"{BASE_URL}/api/auth/login", json=ADMIN, timeout=15)
    r.raise_for_status()
    return r.json()["access_token"]


def _h(token):
    return {"Authorization": f"Bearer {token}"}


def _phone():
    return f"+5215{uuid.uuid4().int % 10**9:09d}"


def _crear_reta_parejas(token, **ov):
    base = {
        "nombre": f"TEST iter18 {uuid.uuid4().hex[:6]}",
        "club": "TEST Club",
        "fecha_str": "2026-12-20",
        "hora_str": "18:00",
        "tz_offset_minutes": -360,
        "canchas_disponibles": 1,
        "max_jugadores": 8,
        "costo_inscripcion": 100.0,
        "modalidad_juego": "PUNTOS",
        "num_rondas": 7,
        "formato_score": {"tipo": "PUNTOS", "valor": 9, "unidad": "juegos"},
        "modalidad_registro": "parejas_libres",
        "permitir_individual_en_parejas": True,
    }
    base.update(ov)
    r = requests.post(
        f"{BASE_URL}/api/retas", headers=_h(token), json=base, timeout=20,
    )
    assert r.status_code == 200, r.text
    return r.json()


def _free_agent_checkout(reta_id, nombre, telefono):
    body = {
        "reta_id": reta_id, "nombre": nombre, "telefono": telefono,
        "es_free_agent": True,
    }
    r = requests.post(
        f"{BASE_URL}/api/public/retas/{reta_id}/checkout", json=body, timeout=20,
    )
    assert r.status_code == 200, r.text
    d = r.json()
    return d.get("id") or d.get("inscripcion_id")


def _aprobar(insc_id):
    r = requests.post(
        f"{BASE_URL}/api/webhooks/payment",
        json={"inscripcion_id": insc_id, "status": "approved"}, timeout=15,
    )
    assert r.status_code == 200, r.text


# ============ fixtures ============
@pytest.fixture(scope="module")
def token():
    return _login()


@pytest.fixture(scope="module")
def created_ids(token):
    ids = []
    yield ids
    for rid in ids:
        try:
            requests.delete(
                f"{BASE_URL}/api/retas/{rid}", headers=_h(token), timeout=15,
            )
        except Exception:
            pass


# =================================================================
# Punto 1-2 — Endpoint /api/admin/twilio/sandbox-info
# =================================================================
class TestTwilioSandboxInfo:
    URL = f"{BASE_URL}/api/admin/twilio/sandbox-info"

    def test_p1_admin_auth_ok_shape(self, token):
        r = requests.get(self.URL, headers=_h(token), timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        # Shape esperado
        for k in ("configured", "is_sandbox", "sandbox_number",
                  "join_code", "instructions"):
            assert k in d, f"falta key '{k}' en sandbox-info"
        assert isinstance(d["configured"], bool)
        assert isinstance(d["is_sandbox"], bool)
        # sandbox_number es string limpio (sin "whatsapp:")
        assert isinstance(d["sandbox_number"], str) and "whatsapp:" not in d["sandbox_number"]
        # join_code: None o string no vacío
        assert d["join_code"] is None or (
            isinstance(d["join_code"], str) and len(d["join_code"]) > 0
        )
        # instructions: string informativo
        assert isinstance(d["instructions"], str) and len(d["instructions"]) > 5

    def test_p1b_is_sandbox_consistent_with_join_code(self, token):
        r = requests.get(self.URL, headers=_h(token), timeout=15)
        d = r.json()
        # invariante: is_sandbox == bool(join_code)
        assert d["is_sandbox"] == bool(d["join_code"]), (
            f"inconsistencia is_sandbox={d['is_sandbox']} join_code={d['join_code']}"
        )

    def test_p2_sin_auth_401_403(self):
        r = requests.get(self.URL, timeout=10)
        assert r.status_code in (401, 403), (
            f"esperado 401/403 sin auth, got {r.status_code}"
        )

    def test_p2b_token_invalido_401_403(self):
        r = requests.get(
            self.URL, headers={"Authorization": "Bearer bogus.token"}, timeout=10,
        )
        assert r.status_code in (401, 403)


# =================================================================
# Punto 3-6 — free-agents/match: validaciones + happy path
# =================================================================
class TestFreeAgentsMatch:

    def _setup_reta_with_2_free_agents(self, token, created_ids, same_phone=False):
        """Crea reta de parejas + 2 inscripciones free-agent aprobadas."""
        reta = _crear_reta_parejas(token)
        created_ids.append(reta["id"])
        phone_a = _phone()
        phone_b = phone_a if same_phone else _phone()
        ins_a = _free_agent_checkout(
            reta["id"], f"TEST FA_A {uuid.uuid4().hex[:4]}", phone_a,
        )
        ins_b = _free_agent_checkout(
            reta["id"], f"TEST FA_B {uuid.uuid4().hex[:4]}", phone_b,
        )
        _aprobar(ins_a)
        _aprobar(ins_b)
        return reta, ins_a, ins_b

    # Punto 3 — mismo teléfono → 400
    def test_p3_mismo_telefono_400(self, token, created_ids):
        reta, ins_a, ins_b = self._setup_reta_with_2_free_agents(
            token, created_ids, same_phone=True,
        )
        r = requests.post(
            f"{BASE_URL}/api/retas/{reta['id']}/free-agents/match",
            headers=_h(token),
            json={"inscripcion_a_id": ins_a, "inscripcion_b_id": ins_b},
            timeout=15,
        )
        assert r.status_code == 400, (
            f"esperado 400 por mismo telefono, got {r.status_code} {r.text}"
        )
        # Verificar copy específico
        body = r.json()
        detail = body.get("detail", "")
        assert "mismo teléfono" in detail.lower() or "mismo telefono" in detail.lower(), (
            f"esperado mensaje sobre teléfonos iguales, got: {detail}"
        )

    # Punto 4 — IDs iguales → 400 (regresión)
    def test_p4_ids_iguales_400(self, token, created_ids):
        reta, ins_a, _ = self._setup_reta_with_2_free_agents(token, created_ids)
        r = requests.post(
            f"{BASE_URL}/api/retas/{reta['id']}/free-agents/match",
            headers=_h(token),
            json={"inscripcion_a_id": ins_a, "inscripcion_b_id": ins_a},
            timeout=15,
        )
        assert r.status_code == 400, r.text
        detail = r.json().get("detail", "").lower()
        assert "diferent" in detail, (
            f"esperado mensaje sobre IDs distintos, got: {detail}"
        )

    # Punto 6 — happy path → 200 + pareja_grupo_id (lo hacemos ANTES del 409)
    def test_p6_match_exitoso(self, token, created_ids):
        reta, ins_a, ins_b = self._setup_reta_with_2_free_agents(
            token, created_ids,
        )
        r = requests.post(
            f"{BASE_URL}/api/retas/{reta['id']}/free-agents/match",
            headers=_h(token),
            json={"inscripcion_a_id": ins_a, "inscripcion_b_id": ins_b},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("ok") is True
        assert isinstance(d.get("pareja_grupo_id"), str)
        assert len(d["pareja_grupo_id"]) >= 8
        miembros = d.get("miembros") or []
        assert len(miembros) == 2
        ids = {m["inscripcion_id"] for m in miembros}
        assert ids == {ins_a, ins_b}

    # Punto 5 — uno ya emparejado → 409
    def test_p5_ya_emparejado_409(self, token, created_ids):
        # Creamos reta con 4 free-agents: emparejamos (a,b) y luego intentamos (a,c).
        reta = _crear_reta_parejas(token)
        created_ids.append(reta["id"])
        ids = []
        for i in range(3):
            iid = _free_agent_checkout(
                reta["id"], f"TEST FA{i} {uuid.uuid4().hex[:3]}", _phone(),
            )
            _aprobar(iid)
            ids.append(iid)
        # Emparejamos (a,b) primero
        r1 = requests.post(
            f"{BASE_URL}/api/retas/{reta['id']}/free-agents/match",
            headers=_h(token),
            json={"inscripcion_a_id": ids[0], "inscripcion_b_id": ids[1]},
            timeout=15,
        )
        assert r1.status_code == 200, r1.text
        # Intento (a, c) ahora → 409
        r2 = requests.post(
            f"{BASE_URL}/api/retas/{reta['id']}/free-agents/match",
            headers=_h(token),
            json={"inscripcion_a_id": ids[0], "inscripcion_b_id": ids[2]},
            timeout=15,
        )
        assert r2.status_code == 409, (
            f"esperado 409 (ya emparejado), got {r2.status_code} {r2.text}"
        )
