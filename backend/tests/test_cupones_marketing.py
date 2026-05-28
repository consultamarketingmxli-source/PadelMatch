"""
Tests del MÓDULO DE MARKETING — Motor de Cupones (Vouchers 100% gratis).

Cubre los 8 edge cases mandatorios:
  EC1  Cross-organizer invalidation.
  EC2  Reta llena rechaza el canje SIN consumir cupón.
  EC3  Cancelación de inscripción (parejas_admin.DELETE) reactiva el cupón.
  EC4  Race condition de canje concurrente → solo uno gana, cupo no se infla.
  EC5  Cupón exclusivo de otra reta del mismo organizador → falla.
  EC6  Código case-insensitive (normaliza a mayúsculas).
  EC7  Re-canje de cupón usado → falla.
  EC8  DELETE /admin/cupones/{id} sobre cupón usado → 409.

Endpoints CRUD admin también validados (POST/GET/DELETE/reactivar).
"""
from __future__ import annotations

import os
import threading
import uuid
from typing import Optional

import pytest
import requests
from pymongo import MongoClient

# conftest provee: base_url, api_client, admin_token, auth_headers


MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _mongo_db():
    """Conexión directa para casos donde necesitamos forzar estado (e.g. cross-org)."""
    return MongoClient(MONGO_URL)[DB_NAME]


def _crear_reta(base_url, headers, *, max_jugadores: int = 4, costo: float = 200.0,
                nombre: Optional[str] = None) -> dict:
    nombre = nombre or f"TEST_RETA_{uuid.uuid4().hex[:6]}"
    body = {
        "nombre": nombre,
        "club": "TEST_CLUB",
        "fecha_str": "2099-12-31",
        "hora_str": "18:00",
        "tz_offset_minutes": -360,
        "canchas_disponibles": 1,
        "max_jugadores": max_jugadores,
        "costo_inscripcion": costo,
        "modalidad_juego": "PUNTOS",
        "num_rondas": 7,
    }
    r = requests.post(f"{base_url}/api/retas", json=body, headers=headers, timeout=20)
    assert r.status_code == 200, f"crear reta fallo: {r.status_code} {r.text}"
    return r.json()


def _borrar_reta(base_url, headers, reta_id: str):
    try:
        requests.delete(f"{base_url}/api/retas/{reta_id}", headers=headers, timeout=15)
    except Exception:
        pass


def _crear_cupon(base_url, headers, *, codigo: Optional[str] = None,
                 reta_id_exclusivo: Optional[str] = None,
                 descripcion: str = "TEST") -> dict:
    body = {"descripcion": descripcion}
    if codigo:
        body["codigo"] = codigo
    if reta_id_exclusivo:
        body["reta_id_exclusivo"] = reta_id_exclusivo
    r = requests.post(f"{base_url}/api/admin/cupones", json=body, headers=headers, timeout=15)
    assert r.status_code == 200, f"crear cupon: {r.status_code} {r.text}"
    return r.json()


def _llenar_reta_directo_db(reta_id: str, n: int):
    """Inserta N inscripciones aprobadas + setea inscritos_lock = n vía DB.
    Necesario para EC2 (probar reta llena) sin estresar el flujo Stripe."""
    mdb = _mongo_db()
    docs = [{
        "id": str(uuid.uuid4()),
        "reta_id": reta_id,
        "jugador_id": str(uuid.uuid4()),
        "nombre": f"TEST_FILLER_{i}",
        "telefono": f"+52155500000{i:02d}",
        "estatus_pago": "Aprobado",
        "monto_pagado": 200.0,
        "metodo_pago": "test",
        "creado_en": "2099-01-01T00:00:00+00:00",
    } for i in range(n)]
    mdb.inscripciones.insert_many(docs)
    mdb.retas.update_one({"id": reta_id}, {"$set": {"inscritos_lock": n}})


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def reta_test(base_url, auth_headers):
    """Reta limpia (max_jugadores=4, costo=200). Se borra al final."""
    reta = _crear_reta(base_url, auth_headers, max_jugadores=4, costo=200.0)
    yield reta
    _borrar_reta(base_url, auth_headers, reta["id"])
    # cleanup inscripciones y cupones residuales
    mdb = _mongo_db()
    mdb.inscripciones.delete_many({"reta_id": reta["id"]})
    mdb.cupones.delete_many({"reta_id_exclusivo": reta["id"]})


@pytest.fixture(autouse=True)
def _cleanup_test_cupones():
    """Limpia cupones con códigos TEST_ y descripción TEST al inicio/fin."""
    mdb = _mongo_db()
    mdb.cupones.delete_many({"descripcion": {"$regex": "^TEST"}})
    yield
    mdb.cupones.delete_many({"descripcion": {"$regex": "^TEST"}})


# ---------------------------------------------------------------------------
# CRUD admin
# ---------------------------------------------------------------------------

class TestCuponesCRUD:
    def test_crear_cupon_autogenerado(self, base_url, auth_headers):
        c = _crear_cupon(base_url, auth_headers, descripcion="TEST_AUTO")
        assert c["codigo"].startswith("PRO-"), c["codigo"]
        assert c["usado"] is False
        assert c["organizador_id"] == "admin@padelappretas.com"

    def test_crear_cupon_codigo_manual(self, base_url, auth_headers):
        code = f"TEST{uuid.uuid4().hex[:6].upper()}"
        c = _crear_cupon(base_url, auth_headers, codigo=code, descripcion="TEST_MAN")
        assert c["codigo"] == code

    def test_crear_cupon_codigo_duplicado_409(self, base_url, auth_headers):
        code = f"TEST{uuid.uuid4().hex[:6].upper()}"
        _crear_cupon(base_url, auth_headers, codigo=code, descripcion="TEST_DUP1")
        r = requests.post(
            f"{base_url}/api/admin/cupones",
            json={"codigo": code, "descripcion": "TEST_DUP2"},
            headers=auth_headers, timeout=15,
        )
        assert r.status_code == 409, r.text

    def test_listar_cupones(self, base_url, auth_headers):
        _crear_cupon(base_url, auth_headers, descripcion="TEST_LIST_A")
        _crear_cupon(base_url, auth_headers, descripcion="TEST_LIST_B")
        r = requests.get(f"{base_url}/api/admin/cupones", headers=auth_headers, timeout=15)
        assert r.status_code == 200
        items = r.json()
        codes = {x["descripcion"] for x in items}
        assert "TEST_LIST_A" in codes and "TEST_LIST_B" in codes

    def test_borrar_cupon_no_usado_200(self, base_url, auth_headers):
        c = _crear_cupon(base_url, auth_headers, descripcion="TEST_DEL")
        r = requests.delete(
            f"{base_url}/api/admin/cupones/{c['id']}",
            headers=auth_headers, timeout=15,
        )
        assert r.status_code == 200
        # GET → 404
        rg = requests.get(
            f"{base_url}/api/admin/cupones/{c['id']}",
            headers=auth_headers, timeout=15,
        )
        assert rg.status_code == 404

    def test_reactivar_cupon_manual(self, base_url, auth_headers):
        c = _crear_cupon(base_url, auth_headers, descripcion="TEST_REACT")
        # marca usado vía DB
        _mongo_db().cupones.update_one(
            {"id": c["id"]},
            {"$set": {"usado": True, "fecha_uso": "2099-01-01T00:00:00+00:00"}},
        )
        r = requests.post(
            f"{base_url}/api/admin/cupones/{c['id']}/reactivar",
            headers=auth_headers, timeout=15,
        )
        assert r.status_code == 200
        assert r.json()["usado"] is False


# ---------------------------------------------------------------------------
# EDGE CASES
# ---------------------------------------------------------------------------

class TestEdgeCases:

    # EC8 — DELETE cupón usado → 409
    def test_ec8_borrar_cupon_usado_409(self, base_url, auth_headers):
        c = _crear_cupon(base_url, auth_headers, descripcion="TEST_DEL_USED")
        _mongo_db().cupones.update_one(
            {"id": c["id"]}, {"$set": {"usado": True}},
        )
        r = requests.delete(
            f"{base_url}/api/admin/cupones/{c['id']}",
            headers=auth_headers, timeout=15,
        )
        assert r.status_code == 409, r.text

    # EC6 — código case-insensitive
    def test_ec6_codigo_case_insensitive(self, base_url, auth_headers, reta_test):
        code_upper = f"TESTLOWER{uuid.uuid4().hex[:4].upper()}"
        _crear_cupon(base_url, auth_headers, codigo=code_upper, descripcion="TEST_CASE")
        r = requests.post(
            f"{base_url}/api/public/retas/{reta_test['id']}/cupon/validar",
            json={"codigo": code_upper.lower()}, timeout=15,
        )
        assert r.status_code == 200
        j = r.json()
        assert j["valido"] is True, j

    # EC1 — Cross-organizer invalidation
    def test_ec1_cross_organizer_invalidation(self, base_url, auth_headers, reta_test):
        """Cupón con organizador 'X' NO debe servir para reta con organizador 'admin'."""
        # Crear cupón pero forzar organizador_id distinto vía DB.
        c = _crear_cupon(base_url, auth_headers, descripcion="TEST_CROSS")
        _mongo_db().cupones.update_one(
            {"id": c["id"]},
            {"$set": {"organizador_id": "otro-admin@example.com"}},
        )
        # Validar
        r = requests.post(
            f"{base_url}/api/public/retas/{reta_test['id']}/cupon/validar",
            json={"codigo": c["codigo"]}, timeout=15,
        )
        assert r.status_code == 200
        j = r.json()
        assert j["valido"] is False
        assert "club" in (j.get("razon") or "").lower(), j

        # Canjear → 400
        rc = requests.post(
            f"{base_url}/api/public/retas/{reta_test['id']}/cupon/canjear",
            json={"codigo": c["codigo"], "nombre": "Tester", "telefono": "+5215555550001"},
            timeout=15,
        )
        assert rc.status_code in (400, 403), rc.text

    # EC2 — Reta llena rechaza canje SIN consumir
    def test_ec2_reta_llena_no_consume(self, base_url, auth_headers, reta_test):
        c = _crear_cupon(base_url, auth_headers, descripcion="TEST_FULL")
        # Llenar la reta directamente.
        _llenar_reta_directo_db(reta_test["id"], 4)
        r = requests.post(
            f"{base_url}/api/public/retas/{reta_test['id']}/cupon/canjear",
            json={"codigo": c["codigo"], "nombre": "Tester", "telefono": "+5215555550002"},
            timeout=15,
        )
        assert r.status_code == 409, r.text
        assert "cupo" in r.text.lower() or "lugar" in r.text.lower()
        # GET cupón sigue usado=false
        rg = requests.get(
            f"{base_url}/api/admin/cupones/{c['id']}", headers=auth_headers, timeout=15,
        )
        assert rg.status_code == 200
        assert rg.json()["usado"] is False, "Cupón fue consumido a pesar de la reta llena"

    # EC5 — Cupón exclusivo de otra reta
    def test_ec5_reta_exclusiva_no_aplica_a_otra(self, base_url, auth_headers, reta_test):
        # Crear segunda reta
        reta2 = _crear_reta(base_url, auth_headers, max_jugadores=4, costo=300.0)
        try:
            c = _crear_cupon(
                base_url, auth_headers,
                reta_id_exclusivo=reta2["id"], descripcion="TEST_EXCL",
            )
            r = requests.post(
                f"{base_url}/api/public/retas/{reta_test['id']}/cupon/validar",
                json={"codigo": c["codigo"]}, timeout=15,
            )
            assert r.status_code == 200
            j = r.json()
            assert j["valido"] is False
            assert "exclus" in (j.get("razon") or "").lower(), j
        finally:
            _borrar_reta(base_url, auth_headers, reta2["id"])

    # EC7 — Cupón ya usado
    def test_ec7_cupon_ya_usado(self, base_url, auth_headers, reta_test):
        c = _crear_cupon(base_url, auth_headers, descripcion="TEST_USED")
        # Canje OK
        r1 = requests.post(
            f"{base_url}/api/public/retas/{reta_test['id']}/cupon/canjear",
            json={"codigo": c["codigo"], "nombre": "T1", "telefono": "+5215555550010"},
            timeout=15,
        )
        assert r1.status_code == 200, r1.text
        # Segundo intento
        r2 = requests.post(
            f"{base_url}/api/public/retas/{reta_test['id']}/cupon/canjear",
            json={"codigo": c["codigo"], "nombre": "T2", "telefono": "+5215555550011"},
            timeout=15,
        )
        assert r2.status_code == 400, r2.text
        assert "redim" in r2.text.lower() or "usad" in r2.text.lower()

    # EC4 — Race condition: dos canjes paralelos
    def test_ec4_race_condition_solo_uno_gana(self, base_url, auth_headers, reta_test):
        c = _crear_cupon(base_url, auth_headers, descripcion="TEST_RACE")
        results: list = []

        def _try_canjear(suffix):
            try:
                r = requests.post(
                    f"{base_url}/api/public/retas/{reta_test['id']}/cupon/canjear",
                    json={"codigo": c["codigo"], "nombre": f"R{suffix}",
                          "telefono": f"+5215555550{suffix:03d}"},
                    timeout=20,
                )
                results.append((suffix, r.status_code, r.text[:200]))
            except Exception as e:
                results.append((suffix, -1, str(e)))

        threads = [threading.Thread(target=_try_canjear, args=(i,)) for i in range(20, 25)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        codes = [s for _, s, _ in results]
        ok = sum(1 for s in codes if s == 200)
        conflict = sum(1 for s in codes if s == 409)
        bad = sum(1 for s in codes if s == 400)  # validación dice "ya usado" si llega después
        assert ok == 1, f"Esperaba 1 éxito, hubo {ok}. results={results}"
        assert (conflict + bad) == len(threads) - 1, results

        # Cupón quedó usado=true
        rg = requests.get(
            f"{base_url}/api/admin/cupones/{c['id']}", headers=auth_headers, timeout=15,
        )
        assert rg.status_code == 200 and rg.json()["usado"] is True

        # Cupo de la reta solo aumentó en +1
        mdb = _mongo_db()
        reta_doc = mdb.retas.find_one({"id": reta_test["id"]})
        ins_count = mdb.inscripciones.count_documents(
            {"reta_id": reta_test["id"], "estatus_pago": "Aprobado"},
        )
        assert ins_count == 1, f"Esperaba 1 inscripción aprobada, hay {ins_count}"
        assert int(reta_doc.get("inscritos_lock") or 0) == 1, reta_doc.get("inscritos_lock")

    # EC3 — Cancelación reactiva cupón
    def test_ec3_cancelacion_reactiva_cupon(self, base_url, auth_headers, reta_test):
        c = _crear_cupon(base_url, auth_headers, descripcion="TEST_REACTIVAR")
        # Canje
        r1 = requests.post(
            f"{base_url}/api/public/retas/{reta_test['id']}/cupon/canjear",
            json={"codigo": c["codigo"], "nombre": "Cancelador",
                  "telefono": "+5215555550099"},
            timeout=15,
        )
        assert r1.status_code == 200, r1.text
        insc_id = r1.json()["inscripcion_id"]
        # Cupón quedó usado=true
        rg = requests.get(
            f"{base_url}/api/admin/cupones/{c['id']}", headers=auth_headers, timeout=15,
        )
        assert rg.json()["usado"] is True

        # Cancelar inscripción vía parejas_admin DELETE
        rd = requests.delete(
            f"{base_url}/api/retas/{reta_test['id']}/inscripciones/{insc_id}?modo=solo",
            headers=auth_headers, timeout=15,
        )
        assert rd.status_code == 200, rd.text
        body = rd.json()
        assert body.get("cupones_reactivados") == 1, body
        assert body.get("ok") is True

        # Cupón sigue → usado=false
        rg2 = requests.get(
            f"{base_url}/api/admin/cupones/{c['id']}", headers=auth_headers, timeout=15,
        )
        assert rg2.status_code == 200
        assert rg2.json()["usado"] is False, rg2.json()

        # Re-canjeable
        r3 = requests.post(
            f"{base_url}/api/public/retas/{reta_test['id']}/cupon/canjear",
            json={"codigo": c["codigo"], "nombre": "Re-uso",
                  "telefono": "+5215555550100"},
            timeout=15,
        )
        assert r3.status_code == 200, r3.text
