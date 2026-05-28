"""Action Items #2 (Notificaciones admin Twilio) y #3 (Deploy Readiness).

Cubre puntos 8-22 del review request.

Notas:
  * Twilio Sandbox: los destinos no-suscritos devuelven twilio_code=63015 →
    status='error' + needs_sandbox_join=true. Esto es ACEPTABLE.
  * WHATSAPP_FORCE_MOCK=true → status='mocked' para todos.
  * Cuando hay sandbox real activo (preview actual), aceptamos status ∈
    {'sent','mocked','error'}.
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


def _reta_payload(**ov):
    base = {
        "nombre": f"TEST AI23 {uuid.uuid4().hex[:6]}",
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
    }
    base.update(ov)
    return base


def _crear_reta(token, **ov):
    r = requests.post(
        f"{BASE_URL}/api/retas", headers=_h(token),
        json=_reta_payload(**ov), timeout=20,
    )
    assert r.status_code == 200, r.text
    return r.json()


def _checkout_individual(reta_id, nombre, telefono):
    """Crea inscripción individual via mock /checkout."""
    body = {"reta_id": reta_id, "nombre": nombre, "telefono": telefono}
    r = requests.post(
        f"{BASE_URL}/api/public/retas/{reta_id}/checkout", json=body, timeout=20,
    )
    assert r.status_code == 200, r.text
    d = r.json()
    return d.get("id") or d.get("inscripcion_id")


def _checkout_pareja(reta_id, n1, t1, n2, t2):
    body = {
        "reta_id": reta_id, "nombre": n1, "telefono": t1,
        "pareja_nombre": n2, "pareja_telefono": t2,
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


@pytest.fixture(scope="module")
def reta_individual_8(token, created_ids):
    """Reta individual con 8 aprobados (full)."""
    reta = _crear_reta(token, modalidad_registro="individual")
    created_ids.append(reta["id"])
    for i in range(8):
        iid = _checkout_individual(
            reta["id"], f"TEST IndJug{i}_{uuid.uuid4().hex[:4]}", _phone(),
        )
        _aprobar(iid)
    return reta


@pytest.fixture(scope="module")
def reta_parejas_8(token, created_ids):
    """Reta de parejas con 4 dúos aprobados (8 aprobados)."""
    reta = _crear_reta(token, modalidad_registro="parejas_libres")
    created_ids.append(reta["id"])
    for i in range(4):
        iid = _checkout_pareja(
            reta["id"],
            f"TEST PA{i}_{uuid.uuid4().hex[:4]}", _phone(),
            f"TEST PB{i}_{uuid.uuid4().hex[:4]}", _phone(),
        )
        _aprobar(iid)
    return reta


# =================================================================
# Action Item #2 — Notificaciones admin Twilio (puntos 8-14)
# =================================================================
class TestNotifyEndpoints:
    # Punto 8 — endpoints registrados (probamos sin auth para detectar 401 vs 404)
    def test_p8_endpoints_registrados(self, reta_individual_8):
        rid = reta_individual_8["id"]
        urls = [
            f"{BASE_URL}/api/retas/{rid}/notify/recordatorio-general",
            f"{BASE_URL}/api/retas/{rid}/notify/proximo-partido?ronda=1&cancha=1",
            f"{BASE_URL}/api/retas/{rid}/notify/lista-espera",
        ]
        for u in urls:
            r = requests.post(u, timeout=15)
            assert r.status_code != 404, f"Endpoint no registrado: {u} → {r.status_code}"
            assert r.status_code in (401, 403), (
                f"Esperado 401/403 sin auth, got {r.status_code} en {u}"
            )

    # Punto 9 — auth admin obligatoria
    def test_p9_auth_requerida(self, reta_individual_8):
        rid = reta_individual_8["id"]
        # Sin token
        r = requests.post(
            f"{BASE_URL}/api/retas/{rid}/notify/recordatorio-general", timeout=10,
        )
        assert r.status_code in (401, 403)
        # Con token mal
        r = requests.post(
            f"{BASE_URL}/api/retas/{rid}/notify/recordatorio-general",
            headers={"Authorization": "Bearer bogus.token.value"}, timeout=10,
        )
        assert r.status_code in (401, 403)

    # Punto 10 — recordatorio-general envía a todos los Aprobados
    def test_p10_recordatorio_general(self, token, reta_individual_8):
        rid = reta_individual_8["id"]
        r = requests.post(
            f"{BASE_URL}/api/retas/{rid}/notify/recordatorio-general",
            headers=_h(token), timeout=60,
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["total_targets"] == 8, f"Esperado 8 aprobados, got {d['total_targets']}"
        assert "items" in d and len(d["items"]) == 8
        # Sumas consistentes
        assert d["sent"] + d["mocked"] + d["failed"] == d["total_targets"]
        # configured presente
        assert isinstance(d.get("configured"), bool)
        # cada item debe traer status
        for it in d["items"]:
            assert it["status"] in ("sent", "mocked", "error")
            assert "telefono" in it and "nombre" in it

    # Punto 11 — proximo-partido ronda=1 cancha=1 con datos completos
    def test_p11_proximo_partido_4_jugadores(self, token, reta_individual_8):
        rid = reta_individual_8["id"]
        r = requests.post(
            f"{BASE_URL}/api/retas/{rid}/notify/proximo-partido?ronda=1&cancha=1",
            headers=_h(token), timeout=60,
        )
        assert r.status_code == 200, r.text
        d = r.json()
        # Reta individual: 8 jugadores en 1 cancha → ronda 1 tiene 2 partidos (8 jugadores) en 1 cancha
        # Por rol multi-cancha con 1 cancha y 8 jugadores: 1 partido por ronda con 4 jugadores
        assert d["partidos_procesados"] >= 1
        # Al menos 4 jugadores notificados (un partido)
        notified = [it for it in d["items"] if it.get("status") != "skipped_no_phone"]
        assert len(notified) >= 4, f"Esperado ≥4 jugadores notificados, got {len(notified)}"
        # Items con datos del partido
        for it in notified:
            assert it.get("ronda") == 1
            assert it.get("cancha") == 1
            assert it.get("partido") is not None

    # Punto 12 — proximo-partido en reta de parejas usa rol de dúos fijos
    def test_p12_proximo_partido_parejas(self, token, reta_parejas_8):
        rid = reta_parejas_8["id"]
        r = requests.post(
            f"{BASE_URL}/api/retas/{rid}/notify/proximo-partido?ronda=1&cancha=1",
            headers=_h(token), timeout=60,
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["partidos_procesados"] >= 1
        notified = [it for it in d["items"] if it.get("status") != "skipped_no_phone"]
        # 4 jugadores reales (2 dúos enfrentados)
        assert len(notified) >= 4, f"parejas: esperado ≥4 reales, got {len(notified)}"

    # Punto 13 — lista-espera envía a todos los inscritos en waitlist
    def test_p13_lista_espera(self, token, created_ids):
        # Reta nueva chica (max_jugadores=4) → llenamos 4 + waitlist 3
        reta = _crear_reta(
            token, modalidad_registro="individual", max_jugadores=4,
        )
        created_ids.append(reta["id"])
        for i in range(4):
            iid = _checkout_individual(
                reta["id"], f"TEST WLfull{i}", _phone(),
            )
            _aprobar(iid)
        # 3 waitlist
        for i in range(3):
            body = {
                "reta_id": reta["id"], "nombre": f"TEST WLpend{i}",
                "telefono": _phone(),
            }
            wr = requests.post(
                f"{BASE_URL}/api/public/retas/{reta['id']}/waitlist",
                json=body, timeout=15,
            )
            assert wr.status_code == 200, wr.text
        r = requests.post(
            f"{BASE_URL}/api/retas/{reta['id']}/notify/lista-espera",
            headers=_h(token), timeout=60,
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["total_targets"] == 3, f"esperado 3 en waitlist, got {d}"
        assert d["sent"] + d["mocked"] + d["failed"] == 3

    # Punto 14 — WHATSAPP_FORCE_MOCK=true ⇒ todos mocked
    # No podemos cambiar env vars del backend en runtime. En su lugar
    # comprobamos que CUANDO la flag is_twilio_configured()=False ⇒ items
    # devuelven mocked. La flag se expone en 'configured'. Validamos invariante:
    # si configured=False ⇒ todos los items son mocked.
    def test_p14_invariante_force_mock(self, token, reta_individual_8):
        rid = reta_individual_8["id"]
        r = requests.post(
            f"{BASE_URL}/api/retas/{rid}/notify/recordatorio-general",
            headers=_h(token), timeout=60,
        )
        d = r.json()
        if d.get("configured") is False:
            # Twilio no configurado: todos los envíos deben ser mocked.
            assert d["mocked"] == d["total_targets"], (
                f"Twilio no configurado pero hay envíos no-mocked: {d}"
            )
            for it in d["items"]:
                assert it["status"] == "mocked"
        else:
            # Twilio configurado (sandbox real): se acepta sent/error.
            # Si hay failed con sandbox, debe traer needs_sandbox_join=true
            for it in d["items"]:
                if it["status"] == "error":
                    # 63015 = no joined sandbox, debe marcar needs_sandbox_join
                    if it.get("twilio_code") == 63015:
                        assert it.get("needs_sandbox_join") is True


# =================================================================
# Action Item #3 — Deploy Readiness (puntos 17-22)
# =================================================================
class TestDeployReadiness:
    EXPECTED_NAMES = {
        "Stripe API Key",
        "Stripe Webhook Secret",
        "Mercado Pago App",
        "Twilio WhatsApp",
        "Email transaccional",
        "JWT Secret",
        "CORS Origins",
    }
    VALID_MODES = {"live", "test", "missing", "unknown"}
    VALID_SEVS = {"ok", "warning", "critical"}

    # Punto 17 — 200 con admin auth y shape correcto
    def test_p17_shape_ok(self, token):
        r = requests.get(
            f"{BASE_URL}/api/admin/deploy-readiness",
            headers=_h(token), timeout=20,
        )
        assert r.status_code == 200, r.text
        d = r.json()
        for k in ("overall", "ready_for_live", "integrations",
                  "missing_critical", "summary", "doc_url"):
            assert k in d, f"falta key {k}"
        assert d["overall"] in ("ready", "test", "missing")
        assert isinstance(d["ready_for_live"], bool)
        assert isinstance(d["integrations"], list)
        assert isinstance(d["missing_critical"], list)
        assert isinstance(d["summary"], dict)
        for sk in ("total", "ok", "warning", "critical"):
            assert sk in d["summary"]

    # Punto 18 — sin auth = 401/403
    def test_p18_sin_auth(self):
        r = requests.get(f"{BASE_URL}/api/admin/deploy-readiness", timeout=10)
        assert r.status_code in (401, 403)

    # Punto 19 — los 7 items reportados
    def test_p19_siete_integraciones(self, token):
        r = requests.get(
            f"{BASE_URL}/api/admin/deploy-readiness",
            headers=_h(token), timeout=20,
        )
        d = r.json()
        names = {it["name"] for it in d["integrations"]}
        assert names == self.EXPECTED_NAMES, (
            f"diferencias: faltan {self.EXPECTED_NAMES - names}; "
            f"extra {names - self.EXPECTED_NAMES}"
        )
        assert len(d["integrations"]) == 7

    # Punto 20 — campos por item
    def test_p20_campos_por_item(self, token):
        r = requests.get(
            f"{BASE_URL}/api/admin/deploy-readiness",
            headers=_h(token), timeout=20,
        )
        for it in r.json()["integrations"]:
            for k in ("name", "env", "configured", "mode", "severity", "advice"):
                assert k in it, f"item {it.get('name')} carece de {k}"
            assert isinstance(it["configured"], bool)
            assert isinstance(it["advice"], str) and len(it["advice"]) > 3

    # Punto 21 — modes válidos
    def test_p21_modes_validos(self, token):
        r = requests.get(
            f"{BASE_URL}/api/admin/deploy-readiness",
            headers=_h(token), timeout=20,
        )
        for it in r.json()["integrations"]:
            assert it["mode"] in self.VALID_MODES, (
                f"{it['name']} tiene mode inválido: {it['mode']}"
            )

    # Punto 22 — severities válidos
    def test_p22_severities_validas(self, token):
        r = requests.get(
            f"{BASE_URL}/api/admin/deploy-readiness",
            headers=_h(token), timeout=20,
        )
        for it in r.json()["integrations"]:
            assert it["severity"] in self.VALID_SEVS, (
                f"{it['name']} tiene severity inválida: {it['severity']}"
            )
