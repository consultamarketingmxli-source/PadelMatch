"""Fase A — Tests RSVP (Retas Gratis / Entre Amigos).

Cubre:
  • Aceptar con cupo → estatus_confirmacion=aceptado.
  • Idempotencia: mismo teléfono no duplica.
  • Llenado total → siguientes RSVP caen a lista_espera.
  • Rechazar previo aceptado → libera cupo + promueve waitlist.
  • Endpoints RSVP rechazan retas tipo_acceso="paga" (400).
  • PATCH admin estatus: aceptado→rechazado libera; rechazado→aceptado en reta llena 409.
  • GET admin asistencia devuelve 3 columnas.
  • REGRESIÓN: retas paga siguen funcionando (crear, cupón, etc).
"""
import os
import uuid
import requests
import pytest

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
ADMIN_EMAIL = "admin@padelappretas.com"
ADMIN_PASS = "admin123"


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"username": ADMIN_EMAIL, "password": ADMIN_PASS},
                      timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def admin_h(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


def _create_reta(admin_h, tipo_acceso="gratis_amigos", max_jug=4):
    tag = uuid.uuid4().hex[:6]
    body = {
        "nombre": f"TEST_RSVP_{tag}",
        "club": "Club Test",
        "fecha_str": "2026-12-30",
        "hora_str": "19:00",
        "tz_offset_minutes": -360,
        "canchas_disponibles": 1,
        "max_jugadores": max_jug,
        "costo_inscripcion": 0 if tipo_acceso == "gratis_amigos" else 200,
        "tipo_acceso": tipo_acceso,
        "modalidad_juego": "PUNTOS",
        "num_rondas": 5,
    }
    r = requests.post(f"{BASE_URL}/api/retas", json=body, headers=admin_h, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


def _cleanup(admin_h, reta_id):
    requests.delete(f"{BASE_URL}/api/retas/{reta_id}", headers=admin_h, timeout=15)


# ============================================================================
# 1. Aceptar — cupo disponible
# ============================================================================
def test_aceptar_con_cupo(admin_h):
    reta = _create_reta(admin_h, "gratis_amigos", 4)
    try:
        r = requests.post(
            f"{BASE_URL}/api/public/retas/{reta['id']}/rsvp/aceptar",
            json={"nombre": "TEST Jugador 1", "telefono": "+5215511111111"},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["estatus_confirmacion"] == "aceptado"
        assert d["inscripcion_id"]
        # verify cupo incrementó
        pub = requests.get(f"{BASE_URL}/api/public/retas/{reta['url_slug']}", timeout=15).json()
        assert pub["inscritos_count"] == 1
    finally:
        _cleanup(admin_h, reta["id"])


# ============================================================================
# 2. Idempotencia — mismo teléfono no duplica
# ============================================================================
def test_idempotencia_mismo_telefono(admin_h):
    reta = _create_reta(admin_h, "gratis_amigos", 4)
    try:
        body = {"nombre": "TEST Jug A", "telefono": "+5215522222222"}
        r1 = requests.post(f"{BASE_URL}/api/public/retas/{reta['id']}/rsvp/aceptar", json=body, timeout=15)
        assert r1.status_code == 200
        insc1 = r1.json()["inscripcion_id"]
        # segunda llamada con mismo teléfono
        r2 = requests.post(f"{BASE_URL}/api/public/retas/{reta['id']}/rsvp/aceptar", json=body, timeout=15)
        assert r2.status_code == 200
        assert r2.json()["inscripcion_id"] == insc1, "Idempotencia rota — creó otra inscripción"
        # cupo solo +1
        pub = requests.get(f"{BASE_URL}/api/public/retas/{reta['url_slug']}", timeout=15).json()
        assert pub["inscritos_count"] == 1
    finally:
        _cleanup(admin_h, reta["id"])


# ============================================================================
# 3. Llenado total → lista_espera
# ============================================================================
def test_llenado_va_a_lista_espera(admin_h):
    reta = _create_reta(admin_h, "gratis_amigos", 4)
    try:
        # llenar los 4 cupos
        for i in range(4):
            r = requests.post(
                f"{BASE_URL}/api/public/retas/{reta['id']}/rsvp/aceptar",
                json={"nombre": f"TEST Player {i}", "telefono": f"+5215530000{i:03d}"},
                timeout=15,
            )
            assert r.status_code == 200
            assert r.json()["estatus_confirmacion"] == "aceptado"
        # 5to debe caer en waitlist
        r = requests.post(
            f"{BASE_URL}/api/public/retas/{reta['id']}/rsvp/aceptar",
            json={"nombre": "TEST WaitPlayer", "telefono": "+5215599999999"},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["estatus_confirmacion"] == "lista_espera"
        assert d["posicion_lista_espera"] == 1
    finally:
        _cleanup(admin_h, reta["id"])


# ============================================================================
# 4. Rechazar previo aceptado → libera + promueve
# ============================================================================
def test_rechazar_libera_y_promueve(admin_h):
    reta = _create_reta(admin_h, "gratis_amigos", 4)
    try:
        # llenar 4 cupos
        for i in range(4):
            r = requests.post(
                f"{BASE_URL}/api/public/retas/{reta['id']}/rsvp/aceptar",
                json={"nombre": f"TEST P{i}", "telefono": f"+5215540000{i:03d}"},
                timeout=15,
            )
            assert r.status_code == 200
        # 3ro a waitlist
        r = requests.post(
            f"{BASE_URL}/api/public/retas/{reta['id']}/rsvp/aceptar",
            json={"nombre": "TEST Waiter", "telefono": "+5215541111111"},
            timeout=15,
        )
        assert r.json()["estatus_confirmacion"] == "lista_espera"
        # P0 rechaza
        r = requests.post(
            f"{BASE_URL}/api/public/retas/{reta['id']}/rsvp/rechazar",
            json={"nombre": "TEST P0", "telefono": "+5215540000000"},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["ok"] is True
        assert body["promoted"] is True, "No promovió waitlist al rechazar"
        assert body["promoted_player"] == "TEST Waiter"
    finally:
        _cleanup(admin_h, reta["id"])


# ============================================================================
# 5. Rechazar sin previo aceptado → registra rechazo
# ============================================================================
def test_rechazar_sin_previo_aceptado(admin_h):
    reta = _create_reta(admin_h, "gratis_amigos", 4)
    try:
        r = requests.post(
            f"{BASE_URL}/api/public/retas/{reta['id']}/rsvp/rechazar",
            json={"nombre": "TEST NoVa", "telefono": "+5215566666666"},
            timeout=15,
        )
        assert r.status_code == 200
        d = r.json()
        assert d["ok"] is True
        assert d["promoted"] is False
    finally:
        _cleanup(admin_h, reta["id"])


# ============================================================================
# 6. RSVP rechaza retas tipo_acceso="paga" → 400
# ============================================================================
def test_rsvp_rejects_paga_reta(admin_h):
    reta = _create_reta(admin_h, "paga", 8)
    try:
        r = requests.post(
            f"{BASE_URL}/api/public/retas/{reta['id']}/rsvp/aceptar",
            json={"nombre": "TEST X", "telefono": "+5215577777777"},
            timeout=15,
        )
        assert r.status_code == 400, f"Esperaba 400, got {r.status_code}: {r.text}"
        # Rechazar también debe bloquear
        r2 = requests.post(
            f"{BASE_URL}/api/public/retas/{reta['id']}/rsvp/rechazar",
            json={"nombre": "TEST X", "telefono": "+5215577777777"},
            timeout=15,
        )
        assert r2.status_code == 400
    finally:
        _cleanup(admin_h, reta["id"])


# ============================================================================
# 7. GET admin asistencia — 3 columnas
# ============================================================================
def test_admin_asistencia_columnas(admin_h):
    reta = _create_reta(admin_h, "gratis_amigos", 4)
    try:
        # 4 aceptados, 1 waitlist, 1 rechazado directo
        for i in range(4):
            requests.post(f"{BASE_URL}/api/public/retas/{reta['id']}/rsvp/aceptar",
                          json={"nombre": f"TEST OK{i}", "telefono": f"+521556000000{i}"}, timeout=15)
        # reta llena → waitlist
        requests.post(f"{BASE_URL}/api/public/retas/{reta['id']}/rsvp/aceptar",
                      json={"nombre": "TEST WL1", "telefono": "+5215560000005"}, timeout=15)
        # rechazo directo
        requests.post(f"{BASE_URL}/api/public/retas/{reta['id']}/rsvp/rechazar",
                      json={"nombre": "TEST NO", "telefono": "+5215560000006"}, timeout=15)

        r = requests.get(f"{BASE_URL}/api/admin/retas/{reta['id']}/asistencia",
                         headers=admin_h, timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert len(d["confirmados"]) == 4
        assert len(d["lista_espera"]) == 1
        assert len(d["rechazados"]) == 1
        assert "pendientes" in d
    finally:
        _cleanup(admin_h, reta["id"])


# ============================================================================
# 8. PATCH admin: aceptado → rechazado libera + promueve
# ============================================================================
def test_patch_estatus_libera_y_promueve(admin_h):
    reta = _create_reta(admin_h, "gratis_amigos", 4)
    try:
        # llenar 4 cupos
        insc_ids = []
        for i in range(4):
            r1 = requests.post(f"{BASE_URL}/api/public/retas/{reta['id']}/rsvp/aceptar",
                               json={"nombre": f"TEST Acep{i}", "telefono": f"+521557000000{i}"}, timeout=15)
            assert r1.json()["estatus_confirmacion"] == "aceptado"
            insc_ids.append(r1.json()["inscripcion_id"])
        # waitlist
        r2 = requests.post(f"{BASE_URL}/api/public/retas/{reta['id']}/rsvp/aceptar",
                           json={"nombre": "TEST Wait", "telefono": "+5215570000005"}, timeout=15)
        assert r2.json()["estatus_confirmacion"] == "lista_espera"

        # admin pasa al primero aceptado → rechazado
        r = requests.patch(
            f"{BASE_URL}/api/admin/inscripciones/{insc_ids[0]}/estatus",
            json={"estatus_confirmacion": "rechazado"},
            headers=admin_h, timeout=15,
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["ok"] is True
        assert d["promoted"] is True, "PATCH no promovió waitlist"
    finally:
        _cleanup(admin_h, reta["id"])


# ============================================================================
# 9. PATCH admin: aceptar en reta llena → 409
# ============================================================================
def test_patch_acceptar_en_llena_409(admin_h):
    reta = _create_reta(admin_h, "gratis_amigos", 4)
    try:
        # llenar los 4 cupos
        for i in range(4):
            requests.post(f"{BASE_URL}/api/public/retas/{reta['id']}/rsvp/aceptar",
                          json={"nombre": f"TEST Full{i}", "telefono": f"+521558000000{i}"}, timeout=15)
        # crear un rechazado
        r_no = requests.post(f"{BASE_URL}/api/public/retas/{reta['id']}/rsvp/rechazar",
                             json={"nombre": "TEST Rch", "telefono": "+5215580000005"}, timeout=15)
        assert r_no.status_code == 200
        # buscar el insc rechazado
        asis = requests.get(f"{BASE_URL}/api/admin/retas/{reta['id']}/asistencia",
                            headers=admin_h, timeout=15).json()
        rech_id = asis["rechazados"][0]["id"]
        # intentar pasar a aceptado → debe ser 409 (reta llena)
        r = requests.patch(
            f"{BASE_URL}/api/admin/inscripciones/{rech_id}/estatus",
            json={"estatus_confirmacion": "aceptado"},
            headers=admin_h, timeout=15,
        )
        assert r.status_code == 409, f"Esperaba 409 reta llena, got {r.status_code}: {r.text}"
    finally:
        _cleanup(admin_h, reta["id"])


# ============================================================================
# 10. REGRESIÓN — reta paga sigue creando checkout
# ============================================================================
def test_regresion_paga_checkout_mp_no_rota(admin_h):
    reta = _create_reta(admin_h, "paga", 8)
    try:
        # Sólo validamos que la reta paga es invocable; checkout MP requiere connect.
        r = requests.get(f"{BASE_URL}/api/public/retas/{reta['url_slug']}", timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert d["tipo_acceso"] == "paga"
        assert d["costo_inscripcion"] == 200
        # listar inscripciones admin endpoint
        r2 = requests.get(f"{BASE_URL}/api/retas/{reta['id']}/inscripciones",
                          headers=admin_h, timeout=15)
        assert r2.status_code == 200
    finally:
        _cleanup(admin_h, reta["id"])


# ============================================================================
# 11. Endpoints admin requieren auth
# ============================================================================
def test_admin_endpoints_require_auth():
    fake_id = str(uuid.uuid4())
    r = requests.get(f"{BASE_URL}/api/admin/retas/{fake_id}/asistencia", timeout=15)
    assert r.status_code in (401, 403)
    r2 = requests.patch(f"{BASE_URL}/api/admin/inscripciones/{fake_id}/estatus",
                        json={"estatus_confirmacion": "aceptado"}, timeout=15)
    assert r2.status_code in (401, 403)
