"""Tests for Fase B — Soporte Integral y Operaciones en Vivo.

Cubre:
  • POST /api/public/retas/{slug}/soporte/alertar-organizador
  • POST /api/public/retas/{slug}/soporte/reportar-ausencia
  • GET  /api/admin/alertas/pendientes
  • PATCH /api/admin/alertas/{id}/leida
  • GET  /api/admin/me
  • PATCH /api/admin/me/whatsapp
  • PATCH /api/admin/inscripciones/{id}/inline
  • POST  /api/admin/inscripciones/{id}/confirmar-manual
"""
import os
import uuid
import time
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/") or \
           os.environ.get("EXPO_BACKEND_URL", "").rstrip("/")

ADMIN_USER = "admin@padelappretas.com"
ADMIN_PASS = "admin123"


@pytest.fixture(scope="module")
def s():
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json"})
    return sess


@pytest.fixture(scope="module")
def admin_token(s):
    r = s.post(f"{BASE_URL}/api/auth/login",
               json={"username": ADMIN_USER, "password": ADMIN_PASS})
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


def auth_h(tok):
    return {"Authorization": f"Bearer {tok}"}


def _payload_reta(nombre, club="Soporte Club Test"):
    return {
        "nombre": nombre,
        "club": club,
        "fecha_str": "2026-12-22",
        "hora_str": "19:00",
        "tz_offset_minutes": -360,
        "canchas_disponibles": 2,
        "max_jugadores": 8,
        "costo_inscripcion": 100,
        "modalidad_juego": "PUNTOS",
        "num_rondas": 7,
        "formato_score": {"tipo": "PUNTOS", "valor": 9, "unidad": "juegos"},
        "tipo_acceso": "paga",
    }


@pytest.fixture(scope="module")
def reta_ctx(s, admin_token):
    """Crea una reta de prueba para todos los tests del módulo."""
    payload = _payload_reta(f"TEST_SoporteReta_{uuid.uuid4().hex[:6]}")
    r = s.post(f"{BASE_URL}/api/retas", headers=auth_h(admin_token), json=payload)
    assert r.status_code == 200, r.text
    reta = r.json()
    ctx = {"reta": reta, "ids_creados": [reta["id"]]}
    yield ctx
    # Cleanup
    for rid in ctx["ids_creados"]:
        s.delete(f"{BASE_URL}/api/retas/{rid}", headers=auth_h(admin_token))


# ============================================================================
# Player Telephone único para evitar colisión con rate limiter entre tests.
# ============================================================================
def _phone():
    # Phone formato MX +521 + 10 dígitos
    return f"+521{int(time.time() * 1000) % 10000000000:010d}"


# ============================================================================
# 1. Alertar Organizador — flujo feliz
# ============================================================================
def test_alertar_organizador_registra_alerta(s, reta_ctx):
    slug = reta_ctx["reta"]["url_slug"]
    body = {"nombre": "Pedro Pruebas", "telefono": _phone(),
            "motivo": "No me llegó el link de pago"}
    r = s.post(f"{BASE_URL}/api/public/retas/{slug}/soporte/alertar-organizador", json=body)
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["ok"] is True
    assert "alerta_id" in j
    assert j["canal"] in {"whatsapp", "registro"}
    # En el ambiente de test el admin NO tiene whatsapp seteado por defecto → canal = registro
    assert j["enviado_whatsapp"] is False
    assert j["canal"] == "registro"


# ============================================================================
# 2. Validación: motivo demasiado corto → 422
# ============================================================================
def test_alertar_organizador_motivo_corto(s, reta_ctx):
    slug = reta_ctx["reta"]["url_slug"]
    body = {"nombre": "Pedro", "telefono": _phone(), "motivo": "x"}
    r = s.post(f"{BASE_URL}/api/public/retas/{slug}/soporte/alertar-organizador", json=body)
    assert r.status_code == 422


# ============================================================================
# 3. Rate limit: segundo POST <60s mismo player+slug → 429
# ============================================================================
def test_alertar_organizador_rate_limit(s, reta_ctx):
    slug = reta_ctx["reta"]["url_slug"]
    tel = _phone()
    body = {"nombre": "Rate Test", "telefono": tel, "motivo": "Primera vez"}
    r1 = s.post(f"{BASE_URL}/api/public/retas/{slug}/soporte/alertar-organizador", json=body)
    assert r1.status_code == 200
    body2 = {"nombre": "Rate Test", "telefono": tel, "motivo": "Segunda inmediata"}
    r2 = s.post(f"{BASE_URL}/api/public/retas/{slug}/soporte/alertar-organizador", json=body2)
    assert r2.status_code == 429, r2.text


# ============================================================================
# 4. Reta no existe → 404
# ============================================================================
def test_alertar_organizador_slug_inexistente(s):
    body = {"nombre": "Pedro", "telefono": _phone(), "motivo": "test"}
    r = s.post(f"{BASE_URL}/api/public/retas/no-existe-jamas-xyz/soporte/alertar-organizador",
               json=body)
    assert r.status_code == 404


# ============================================================================
# 5. Reportar Ausencia — feliz path + marca inscripción si existe
# ============================================================================
def test_reportar_ausencia_marca_inscripcion(s, admin_token, reta_ctx):
    slug = reta_ctx["reta"]["url_slug"]
    reta_id = reta_ctx["reta"]["id"]
    # Primero creamos una inscripción via checkout público (no admin)
    tel = _phone()
    r_insc = s.post(
        f"{BASE_URL}/api/public/retas/{reta_id}/checkout",
        json={"reta_id": reta_id, "nombre": "Jugador Ausente", "telefono": tel},
    )
    if r_insc.status_code not in (200, 201):
        pytest.skip(f"No se pudo crear inscripción base: {r_insc.status_code} {r_insc.text}")
    insc_id = r_insc.json().get("id")

    body = {"nombre": "Jugador Ausente", "telefono": tel, "motivo": "Me lesioné"}
    r = s.post(f"{BASE_URL}/api/public/retas/{slug}/soporte/reportar-ausencia", json=body)
    assert r.status_code == 200, r.text
    assert r.json()["ok"] is True

    # Verificamos que la inscripción se marcó
    r2 = s.get(f"{BASE_URL}/api/retas/{reta_id}/inscripciones",
               headers=auth_h(admin_token))
    if r2.status_code == 200 and insc_id:
        items = r2.json() if isinstance(r2.json(), list) else r2.json().get("items", [])
        ours = [i for i in items if i.get("id") == insc_id]
        if ours:
            assert ours[0].get("ausencia_reportada") is True


# ============================================================================
# 6. Admin inbox: GET pendientes → contiene las alertas creadas arriba
# ============================================================================
def test_admin_inbox_alertas(s, admin_token, reta_ctx):
    r = s.get(f"{BASE_URL}/api/admin/alertas/pendientes",
              headers=auth_h(admin_token),
              params={"reta_id": reta_ctx["reta"]["id"]})
    assert r.status_code == 200
    j = r.json()
    assert "items" in j and isinstance(j["items"], list)
    assert j["total_pendientes"] >= 1
    # Cada item tiene la forma esperada
    for it in j["items"]:
        assert it["reta_id"] == reta_ctx["reta"]["id"]
        assert it["leida"] is False
        assert it["tipo"] in {"alertar_organizador", "reportar_ausencia"}


# ============================================================================
# 7. Admin marca alerta como leída
# ============================================================================
def test_admin_marcar_alerta_leida(s, admin_token, reta_ctx):
    r = s.get(f"{BASE_URL}/api/admin/alertas/pendientes",
              headers=auth_h(admin_token),
              params={"reta_id": reta_ctx["reta"]["id"]})
    assert r.status_code == 200
    items = r.json()["items"]
    assert items
    alerta_id = items[0]["id"]
    r2 = s.patch(f"{BASE_URL}/api/admin/alertas/{alerta_id}/leida",
                 headers=auth_h(admin_token))
    assert r2.status_code == 200
    assert r2.json()["ok"] is True
    # Ya no aparece en pendientes
    r3 = s.get(f"{BASE_URL}/api/admin/alertas/pendientes",
               headers=auth_h(admin_token),
               params={"reta_id": reta_ctx["reta"]["id"]})
    assert all(it["id"] != alerta_id for it in r3.json()["items"])


# ============================================================================
# 8. Admin GET /me
# ============================================================================
def test_admin_get_me(s, admin_token):
    r = s.get(f"{BASE_URL}/api/admin/me", headers=auth_h(admin_token))
    assert r.status_code == 200
    j = r.json()
    assert "email" in j
    assert "telefono_whatsapp" in j


# ============================================================================
# 9. Admin PATCH /me/whatsapp setea y desetea
# ============================================================================
def test_admin_set_whatsapp(s, admin_token):
    tel = "+5215512345699"
    r1 = s.patch(f"{BASE_URL}/api/admin/me/whatsapp",
                 headers=auth_h(admin_token),
                 json={"telefono_whatsapp": tel})
    assert r1.status_code == 200, r1.text
    assert r1.json()["telefono_whatsapp"] == tel

    # Verificamos GET me
    r2 = s.get(f"{BASE_URL}/api/admin/me", headers=auth_h(admin_token))
    assert r2.json()["telefono_whatsapp"] == tel

    # Desetear
    r3 = s.patch(f"{BASE_URL}/api/admin/me/whatsapp",
                 headers=auth_h(admin_token),
                 json={"telefono_whatsapp": None})
    assert r3.status_code == 200
    r4 = s.get(f"{BASE_URL}/api/admin/me", headers=auth_h(admin_token))
    assert r4.json()["telefono_whatsapp"] is None


# ============================================================================
# 10. PATCH inline edit — nombre y cancha
# ============================================================================
def test_inscripcion_inline_edit(s, admin_token, reta_ctx):
    tel = _phone()
    reta_id = reta_ctx['reta']['id']
    r_insc = s.post(
        f"{BASE_URL}/api/public/retas/{reta_id}/checkout",
        json={"reta_id": reta_id, "nombre": "Original Name", "telefono": tel},
    )
    if r_insc.status_code not in (200, 201):
        pytest.skip(f"No se pudo crear inscripción base: {r_insc.status_code} {r_insc.text}")
    insc_id = r_insc.json().get("id")
    assert insc_id

    # Edit nombre + cancha
    r = s.patch(f"{BASE_URL}/api/admin/inscripciones/{insc_id}/inline",
                headers=auth_h(admin_token),
                json={"nombre": "Nombre Editado", "cancha_asignada": 2})
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["inscripcion"]["nombre"] == "Nombre Editado"
    assert j["inscripcion"]["cancha_asignada"] == 2


# ============================================================================
# 11. PATCH inline — cancha fuera de rango → 400
# ============================================================================
def test_inscripcion_inline_cancha_invalida(s, admin_token, reta_ctx):
    tel = _phone()
    reta_id = reta_ctx['reta']['id']
    r_insc = s.post(
        f"{BASE_URL}/api/public/retas/{reta_id}/checkout",
        json={"reta_id": reta_id, "nombre": "Cancha Test", "telefono": tel},
    )
    if r_insc.status_code not in (200, 201):
        pytest.skip(f"No se pudo crear inscripción base: {r_insc.status_code} {r_insc.text}")
    insc_id = r_insc.json().get("id")

    # Esta reta tiene canchas_disponibles=2, así que cancha 5 debe fallar
    r = s.patch(f"{BASE_URL}/api/admin/inscripciones/{insc_id}/inline",
                headers=auth_h(admin_token),
                json={"cancha_asignada": 5})
    assert r.status_code == 400


# ============================================================================
# 12. PATCH inline sin auth → 401
# ============================================================================
def test_inscripcion_inline_no_auth(s, reta_ctx):
    r = s.patch(f"{BASE_URL}/api/admin/inscripciones/inventado/inline",
                json={"nombre": "x"})
    assert r.status_code == 401


# ============================================================================
# 13. Confirmar manual: cambia estatus a aprobado
# ============================================================================
def test_confirmar_manual_aprueba(s, admin_token, reta_ctx):
    tel = _phone()
    reta_id = reta_ctx['reta']['id']
    r_insc = s.post(
        f"{BASE_URL}/api/public/retas/{reta_id}/checkout",
        json={"reta_id": reta_id, "nombre": "Pago Manual Test", "telefono": tel},
    )
    if r_insc.status_code not in (200, 201):
        pytest.skip(f"No se pudo crear inscripción base: {r_insc.status_code} {r_insc.text}")
    insc_id = r_insc.json().get("id")

    r = s.post(f"{BASE_URL}/api/admin/inscripciones/{insc_id}/confirmar-manual",
               headers=auth_h(admin_token),
               json={"nota": "Pagó en efectivo en el club"})
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["ok"] is True
    assert j.get("confirmada_manualmente") is True or j.get("ya_aprobada") is True

    # === Refuerzo (Iter22 — bug detectado por testing_agent): re-leer el doc
    # y verificar que estatus_pago realmente cambió a "Aprobado", no solo
    # los flags pago_manual.
    r2 = s.get(f"{BASE_URL}/api/retas/{reta_id}/inscripciones",
               headers=auth_h(admin_token))
    assert r2.status_code == 200
    items = r2.json() if isinstance(r2.json(), list) else r2.json().get("items", [])
    ours = [i for i in items if i.get("id") == insc_id]
    assert ours, "Inscripción no aparece tras confirmar manual"
    assert ours[0]["estatus_pago"] == "Aprobado", \
        f"estatus_pago debe ser 'Aprobado' tras confirmar manual, got {ours[0]['estatus_pago']!r}"
    assert ours[0].get("pago_manual") is True


# ============================================================================
# 14. Confirmar manual idempotente: segundo call → ya_aprobada=True
# ============================================================================
def test_confirmar_manual_idempotente(s, admin_token, reta_ctx):
    tel = _phone()
    reta_id = reta_ctx['reta']['id']
    r_insc = s.post(
        f"{BASE_URL}/api/public/retas/{reta_id}/checkout",
        json={"reta_id": reta_id, "nombre": "Idempotente Test", "telefono": tel},
    )
    if r_insc.status_code not in (200, 201):
        pytest.skip("Setup falló")
    insc_id = r_insc.json().get("id")

    r1 = s.post(f"{BASE_URL}/api/admin/inscripciones/{insc_id}/confirmar-manual",
                headers=auth_h(admin_token), json={"nota": "primera"})
    assert r1.status_code == 200
    r2 = s.post(f"{BASE_URL}/api/admin/inscripciones/{insc_id}/confirmar-manual",
                headers=auth_h(admin_token), json={"nota": "segunda"})
    assert r2.status_code == 200
    assert r2.json().get("ya_aprobada") is True
