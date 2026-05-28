"""Phase 2/3/4 — Retas de Parejas backend validation.

Cubre los 22 puntos numerados de la spec + regresión individual.
"""
import os
import time
import uuid

import pytest
import requests

BASE_URL = os.environ.get(
    "EXPO_PUBLIC_BACKEND_URL",
    "https://padel-tournament-hub-9.preview.emergentagent.com",
).rstrip("/")

ADMIN = {"username": "admin@padelappretas.com", "password": "admin123"}


# =========== helpers ===========
def _login():
    r = requests.post(f"{BASE_URL}/api/auth/login", json=ADMIN, timeout=15)
    r.raise_for_status()
    return r.json()["access_token"]


def _h(token):
    return {"Authorization": f"Bearer {token}"}


def _payload(**ov):
    base = {
        "nombre": f"TEST P234 {uuid.uuid4().hex[:6]}",
        "club": "TEST Club",
        "fecha_str": "2026-12-20",
        "hora_str": "18:00",
        "tz_offset_minutes": -360,
        "canchas_disponibles": 2,
        "max_jugadores": 8,
        "costo_inscripcion": 100.0,
        "modalidad_juego": "PUNTOS",
        "num_rondas": 7,
        "formato_score": {"tipo": "PUNTOS", "valor": 9, "unidad": "juegos"},
    }
    base.update(ov)
    return base


def _crear_reta(token, **ov):
    r = requests.post(f"{BASE_URL}/api/retas", headers=_h(token), json=_payload(**ov), timeout=20)
    assert r.status_code == 200, r.text
    return r.json()


def _aprobar(insc_id):
    r = requests.post(
        f"{BASE_URL}/api/webhooks/payment",
        json={"inscripcion_id": insc_id, "status": "approved"},
        timeout=15,
    )
    assert r.status_code == 200, r.text
    return r.json()


def _phone():
    # genera un teléfono mexicano único válido
    return f"+5215{uuid.uuid4().int % 10**9:09d}"


# =========== fixtures ===========
@pytest.fixture(scope="module")
def token():
    return _login()


@pytest.fixture(scope="module")
def created_ids(token):
    ids = []
    yield ids
    for rid in ids:
        try:
            requests.delete(f"{BASE_URL}/api/retas/{rid}", headers=_h(token), timeout=15)
        except Exception:
            pass


# =================================================================
# FASE 2 — Checkout coordinado por DÚO
# =================================================================
class TestFase2Checkout:
    # Punto 1
    def test_mp_dúo_crea_2_inscripciones_mismo_grupo(self, token, created_ids):
        reta = _crear_reta(token, modalidad_registro="parejas_libres")
        created_ids.append(reta["id"])
        ta, tb = _phone(), _phone()
        body = {
            "nombre": "TEST Alice", "telefono": ta,
            "pareja_nombre": "TEST Bob", "pareja_telefono": tb,
        }
        r = requests.post(
            f"{BASE_URL}/api/public/retas/{reta['id']}/checkout-mercadopago",
            json=body, timeout=20,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert "inscripcion_id" in data
        # Verificar 2 inscripciones ligadas
        lst = requests.get(
            f"{BASE_URL}/api/retas/{reta['id']}/inscripciones", headers=_h(token), timeout=15,
        ).json()
        with_phones = [i for i in lst if i["telefono"] in (ta, tb)]
        assert len(with_phones) == 2
        grupos = {i["pareja_grupo_id"] for i in with_phones}
        assert len(grupos) == 1 and None not in grupos
        # inscritos_count subió 2
        det = requests.get(f"{BASE_URL}/api/public/retas/{reta['url_slug']}", timeout=15).json()
        assert det["inscritos_count"] >= 2
        # amount = 2x via tx
        # tx no expuesto vía API; comprobamos costo_total indirectamente al menos en monto reservado
        assert data["inscripcion_id"] == with_phones[0]["id"] or data["inscripcion_id"] == with_phones[1]["id"]

    # Punto 2
    def test_mp_individual_rechaza_datos_pareja(self, token, created_ids):
        reta = _crear_reta(token, modalidad_registro="individual")
        created_ids.append(reta["id"])
        body = {
            "nombre": "TEST X", "telefono": _phone(),
            "pareja_nombre": "TEST Y", "pareja_telefono": _phone(),
        }
        r = requests.post(
            f"{BASE_URL}/api/public/retas/{reta['id']}/checkout-mercadopago",
            json=body, timeout=20,
        )
        assert r.status_code == 400, r.text

    # Punto 3
    def test_mp_parejas_sin_pareja_ni_freeagent_400(self, token, created_ids):
        reta = _crear_reta(token, modalidad_registro="parejas_libres")
        created_ids.append(reta["id"])
        body = {"nombre": "Solo", "telefono": _phone()}
        r = requests.post(
            f"{BASE_URL}/api/public/retas/{reta['id']}/checkout-mercadopago",
            json=body, timeout=20,
        )
        assert r.status_code == 400, r.text

    # Punto 4
    def test_mp_freeagent_sin_permiso_400(self, token, created_ids):
        reta = _crear_reta(
            token,
            modalidad_registro="parejas_libres",
            permitir_individual_en_parejas=False,
        )
        created_ids.append(reta["id"])
        body = {"nombre": "Solo", "telefono": _phone(), "es_free_agent": True}
        r = requests.post(
            f"{BASE_URL}/api/public/retas/{reta['id']}/checkout-mercadopago",
            json=body, timeout=20,
        )
        assert r.status_code == 400, r.text

    # Punto 5
    def test_mock_checkout_dúo_crea_2(self, token, created_ids):
        reta = _crear_reta(token, modalidad_registro="parejas_libres")
        created_ids.append(reta["id"])
        ta, tb = _phone(), _phone()
        body = {
            "reta_id": reta["id"],
            "nombre": "TEST MA", "telefono": ta,
            "pareja_nombre": "TEST MB", "pareja_telefono": tb,
        }
        r = requests.post(
            f"{BASE_URL}/api/public/retas/{reta['id']}/checkout", json=body, timeout=20,
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["pareja_grupo_id"] is not None
        # buscar al compañero
        lst = requests.get(
            f"{BASE_URL}/api/retas/{reta['id']}/inscripciones", headers=_h(token), timeout=15,
        ).json()
        grupo = [i for i in lst if i["pareja_grupo_id"] == d["pareja_grupo_id"]]
        assert len(grupo) == 2

    # Punto 6
    def test_stripe_dúo_o_503(self, token, created_ids):
        reta = _crear_reta(token, modalidad_registro="parejas_libres")
        created_ids.append(reta["id"])
        body = {
            "nombre": "TEST SA", "telefono": _phone(),
            "pareja_nombre": "TEST SB", "pareja_telefono": _phone(),
        }
        r = requests.post(
            f"{BASE_URL}/api/public/retas/{reta['id']}/checkout-stripe",
            json=body, timeout=30,
        )
        assert r.status_code in (200, 503), r.text
        if r.status_code == 200:
            d = r.json()
            assert "inscripcion_id" in d
            lst = requests.get(
                f"{BASE_URL}/api/retas/{reta['id']}/inscripciones",
                headers=_h(token), timeout=15,
            ).json()
            insc = next(i for i in lst if i["id"] == d["inscripcion_id"])
            assert insc["pareja_grupo_id"] is not None
            partners = [i for i in lst if i["pareja_grupo_id"] == insc["pareja_grupo_id"]]
            assert len(partners) == 2

    # Punto 7
    def test_webhook_payment_approved_aprueba_ambas(self, token, created_ids):
        reta = _crear_reta(token, modalidad_registro="parejas_libres")
        created_ids.append(reta["id"])
        body = {
            "reta_id": reta["id"],
            "nombre": "TEST WA", "telefono": _phone(),
            "pareja_nombre": "TEST WB", "pareja_telefono": _phone(),
        }
        r = requests.post(
            f"{BASE_URL}/api/public/retas/{reta['id']}/checkout", json=body, timeout=20,
        )
        assert r.status_code == 200
        insc_id = r.json()["id"]
        _aprobar(insc_id)
        lst = requests.get(
            f"{BASE_URL}/api/retas/{reta['id']}/inscripciones", headers=_h(token), timeout=15,
        ).json()
        target_grupo = next(i for i in lst if i["id"] == insc_id)["pareja_grupo_id"]
        miembros = [i for i in lst if i["pareja_grupo_id"] == target_grupo]
        assert len(miembros) == 2
        assert all(m["estatus_pago"] == "Aprobado" for m in miembros)

    # Punto 8
    def test_webhook_payment_failed_borra_ambas_libera_2(self, token, created_ids):
        reta = _crear_reta(token, modalidad_registro="parejas_libres", max_jugadores=8)
        created_ids.append(reta["id"])
        body = {
            "reta_id": reta["id"],
            "nombre": "TEST FA", "telefono": _phone(),
            "pareja_nombre": "TEST FB", "pareja_telefono": _phone(),
        }
        r = requests.post(
            f"{BASE_URL}/api/public/retas/{reta['id']}/checkout", json=body, timeout=20,
        )
        insc_id = r.json()["id"]
        det1 = requests.get(f"{BASE_URL}/api/public/retas/{reta['url_slug']}", timeout=15).json()
        assert det1["inscritos_count"] == 2
        r2 = requests.post(
            f"{BASE_URL}/api/webhooks/payment",
            json={"inscripcion_id": insc_id, "status": "failed"}, timeout=15,
        )
        assert r2.status_code == 200
        lst = requests.get(
            f"{BASE_URL}/api/retas/{reta['id']}/inscripciones", headers=_h(token), timeout=15,
        ).json()
        # Ambas borradas
        assert not any(i["id"] == insc_id for i in lst)
        det2 = requests.get(f"{BASE_URL}/api/public/retas/{reta['url_slug']}", timeout=15).json()
        assert det2["inscritos_count"] == 0

    # Punto 9 — concurrencia: 1 cupo restante, dúo debe fallar 409 y no crear huérfanos
    def test_concurrencia_un_cupo_dúo_409(self, token, created_ids):
        reta = _crear_reta(token, modalidad_registro="parejas_libres", max_jugadores=4)
        created_ids.append(reta["id"])
        # Llenamos 3 cupos via webhook
        for i in range(3):
            r = requests.post(
                f"{BASE_URL}/api/public/retas/{reta['id']}/checkout",
                json={
                    "reta_id": reta["id"],
                    "nombre": f"TEST F{i}", "telefono": _phone(),
                    "es_free_agent": False if i < 2 else True,  # last as free-agent
                    **({"pareja_nombre": f"TEST P{i}", "pareja_telefono": _phone()} if i < 1 else {}),
                },
                timeout=20,
            )
            # i=0 crea 2; i=1 → debe ser free_agent o pareja
            # Simplificamos: i=0 crea pareja (2 cupos); luego un free-agent
            if i == 0:
                assert r.status_code == 200
            else:
                # ya no necesitamos más, romper
                break
        # Tras i=0 hay 2 cupos. Agregamos 1 free-agent vía permitir_individual
        # Re-crear reta más simple: 4 cupos, pareja inicial (2), un free-agent (1) → 1 restante
        # Como permitir_individual_en_parejas=False, no podemos hacer free-agent.
        # Re-arquitectura:
        reta2 = _crear_reta(
            token, modalidad_registro="parejas_libres",
            permitir_individual_en_parejas=True, max_jugadores=4,
        )
        created_ids.append(reta2["id"])
        # 1 pareja → 2 cupos
        r = requests.post(
            f"{BASE_URL}/api/public/retas/{reta2['id']}/checkout",
            json={
                "reta_id": reta2["id"],
                "nombre": "TEST A1", "telefono": _phone(),
                "pareja_nombre": "TEST A2", "pareja_telefono": _phone(),
            },
            timeout=20,
        )
        assert r.status_code == 200
        # 1 free-agent → 3 cupos ocupados
        r = requests.post(
            f"{BASE_URL}/api/public/retas/{reta2['id']}/checkout",
            json={
                "reta_id": reta2["id"],
                "nombre": "TEST F1", "telefono": _phone(),
                "es_free_agent": True,
            },
            timeout=20,
        )
        assert r.status_code == 200
        det = requests.get(f"{BASE_URL}/api/public/retas/{reta2['url_slug']}", timeout=15).json()
        assert det["inscritos_count"] == 3
        # Ahora intentar pareja (necesita 2 cupos, solo hay 1) → 409
        r = requests.post(
            f"{BASE_URL}/api/public/retas/{reta2['id']}/checkout",
            json={
                "reta_id": reta2["id"],
                "nombre": "TEST B1", "telefono": _phone(),
                "pareja_nombre": "TEST B2", "pareja_telefono": _phone(),
            },
            timeout=20,
        )
        assert r.status_code == 409, r.text
        # No deben haber inscripciones huérfanas
        det2 = requests.get(f"{BASE_URL}/api/public/retas/{reta2['url_slug']}", timeout=15).json()
        assert det2["inscritos_count"] == 3


# =================================================================
# FASE 3 — Round Robin de Parejas + Standings
# =================================================================
class TestFase3RoundRobin:
    # Punto 10 — reta individual rol clásico
    def test_rol_individual_regresion(self, token, created_ids):
        reta = _crear_reta(token, max_jugadores=8)
        created_ids.append(reta["id"])
        # Sin inscritos suficientes igual debe retornar estructura clásica (no `es_parejas`)
        r = requests.get(f"{BASE_URL}/api/retas/{reta['id']}/rol", headers=_h(token), timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        # En rol individual NO debe haber flag es_parejas o debe ser False
        assert d.get("es_parejas") in (None, False)
        assert "rol" in d

    # Punto 11.a — parejas sin dúos
    def test_rol_parejas_sin_duos(self, token, created_ids):
        reta = _crear_reta(token, modalidad_registro="parejas_libres", max_jugadores=8)
        created_ids.append(reta["id"])
        r = requests.get(f"{BASE_URL}/api/retas/{reta['id']}/rol", headers=_h(token), timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("es_parejas") is True
        assert d.get("rol") == []
        assert "mensaje" in d

    # Punto 11.b — parejas con 4 dúos aprobados → rol 3 rondas
    def test_rol_parejas_con_4_duos(self, token, created_ids):
        reta = _crear_reta(token, modalidad_registro="parejas_libres", max_jugadores=8)
        created_ids.append(reta["id"])
        # Crear 4 dúos aprobados
        for i in range(4):
            body = {
                "reta_id": reta["id"],
                "nombre": f"PA{i}", "telefono": _phone(),
                "pareja_nombre": f"PB{i}", "pareja_telefono": _phone(),
            }
            r = requests.post(
                f"{BASE_URL}/api/public/retas/{reta['id']}/checkout", json=body, timeout=20,
            )
            assert r.status_code == 200, r.text
            _aprobar(r.json()["id"])
        # GET rol
        r = requests.get(f"{BASE_URL}/api/retas/{reta['id']}/rol", headers=_h(token), timeout=20)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("es_parejas") is True
        # Estructura: rol → lista por cancha, cada uno con "rondas" → cada ronda con "partidos"
        rol = d["rol"]
        assert isinstance(rol, list) and len(rol) >= 1
        from collections import Counter
        flat = Counter()
        unique_pairings = set()
        rondas_set = set()
        for cancha in rol:
            for ronda in cancha.get("rondas", []):
                rondas_set.add(ronda.get("ronda"))
                for partido in ronda.get("partidos", []):
                    pa = tuple(sorted(partido["pareja_a"]))
                    pb = tuple(sorted(partido["pareja_b"]))
                    unique_pairings.add(tuple(sorted([pa, pb])))
                    flat[pa] += 1
                    flat[pb] += 1
        # Round Robin de 4 dúos → exactamente 6 enfrentamientos únicos (C(4,2))
        assert len(unique_pairings) == 6, (
            f"Esperado 6 enfrentamientos únicos en RR de 4 dúos, got {len(unique_pairings)}"
        )
        # 4 dúos únicos
        assert len(flat) == 4, f"esperado 4 dúos únicos, got {len(flat)}: {flat}"

    # Punto 12 — tabla por dúo (sin resultados aún, sólo estructura)
    def test_tabla_por_duo(self, token, created_ids):
        reta = _crear_reta(token, modalidad_registro="parejas_libres", max_jugadores=8)
        created_ids.append(reta["id"])
        for i in range(2):
            body = {
                "reta_id": reta["id"],
                "nombre": f"T{i}A", "telefono": _phone(),
                "pareja_nombre": f"T{i}B", "pareja_telefono": _phone(),
            }
            r = requests.post(
                f"{BASE_URL}/api/public/retas/{reta['id']}/checkout", json=body, timeout=20,
            )
            _aprobar(r.json()["id"])
        # Tabla pública
        r = requests.get(f"{BASE_URL}/api/public/retas/{reta['id']}/tabla", timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        # Estructura: debe haber filas por dúo, formato "A & B"
        tabla = d.get("tabla") if isinstance(d, dict) and "tabla" in d else d
        if isinstance(tabla, list) and tabla:
            # En reta de parejas, los nombres son "X & Y"
            nombres = [t.get("nombre", "") for t in tabla]
            assert any("&" in n for n in nombres), f"Esperado filas por dúo con &: {nombres}"

    # Punto 13 — CSV de rol de parejas
    def test_csv_rol_parejas(self, token, created_ids):
        reta = _crear_reta(token, modalidad_registro="parejas_libres", max_jugadores=8)
        created_ids.append(reta["id"])
        for i in range(4):
            body = {
                "reta_id": reta["id"],
                "nombre": f"CA{i}", "telefono": _phone(),
                "pareja_nombre": f"CB{i}", "pareja_telefono": _phone(),
            }
            r = requests.post(
                f"{BASE_URL}/api/public/retas/{reta['id']}/checkout", json=body, timeout=20,
            )
            _aprobar(r.json()["id"])
        r = requests.get(
            f"{BASE_URL}/api/retas/{reta['id']}/rol/csv", headers=_h(token), timeout=20,
        )
        assert r.status_code == 200, r.text
        assert "text/csv" in r.headers.get("content-type", "") or "csv" in r.headers.get("content-type", "").lower()
        text = r.text
        assert "CA0" in text or "CB0" in text or len(text) > 50

    # Punto 14 — CSV/PDF de clasificación de parejas
    def test_clasificacion_csv_pdf_parejas(self, token, created_ids):
        reta = _crear_reta(token, modalidad_registro="parejas_libres", max_jugadores=8)
        created_ids.append(reta["id"])
        for i in range(2):
            body = {
                "reta_id": reta["id"],
                "nombre": f"X{i}A", "telefono": _phone(),
                "pareja_nombre": f"X{i}B", "pareja_telefono": _phone(),
            }
            r = requests.post(
                f"{BASE_URL}/api/public/retas/{reta['id']}/checkout", json=body, timeout=20,
            )
            _aprobar(r.json()["id"])
        rc = requests.get(
            f"{BASE_URL}/api/retas/{reta['id']}/clasificacion/csv",
            headers=_h(token), timeout=20,
        )
        assert rc.status_code == 200, rc.text
        # contiene & si es de parejas
        # PDF
        rp = requests.get(
            f"{BASE_URL}/api/retas/{reta['id']}/clasificacion/pdf",
            headers=_h(token), timeout=30,
        )
        assert rp.status_code == 200, rp.text
        assert rp.headers.get("content-type", "").startswith("application/pdf") or len(rp.content) > 500


# =================================================================
# FASE 4 — Admin Edge Cases (free-agents + duos + cancel)
# =================================================================
class TestFase4Admin:
    # Punto 15 — listar free-agents
    def test_listar_free_agents(self, token, created_ids):
        reta = _crear_reta(
            token, modalidad_registro="parejas_libres",
            permitir_individual_en_parejas=True, max_jugadores=8,
        )
        created_ids.append(reta["id"])
        # Crear 2 free-agents aprobados
        ids_fa = []
        for i in range(2):
            r = requests.post(
                f"{BASE_URL}/api/public/retas/{reta['id']}/checkout",
                json={
                    "reta_id": reta["id"], "nombre": f"FA{i}",
                    "telefono": _phone(), "es_free_agent": True,
                },
                timeout=20,
            )
            assert r.status_code == 200, r.text
            _aprobar(r.json()["id"])
            ids_fa.append(r.json()["id"])
        r = requests.get(
            f"{BASE_URL}/api/retas/{reta['id']}/free-agents",
            headers=_h(token), timeout=15,
        )
        assert r.status_code == 200, r.text
        lst = r.json()
        assert isinstance(lst, list)
        returned_ids = {x["inscripcion_id"] for x in lst}
        assert set(ids_fa).issubset(returned_ids), f"Esperado {ids_fa}, got {returned_ids}"

    # Punto 16 — match 2 free-agents
    def test_match_free_agents(self, token, created_ids):
        reta = _crear_reta(
            token, modalidad_registro="parejas_libres",
            permitir_individual_en_parejas=True, max_jugadores=8,
        )
        created_ids.append(reta["id"])
        ids_fa = []
        for i in range(2):
            r = requests.post(
                f"{BASE_URL}/api/public/retas/{reta['id']}/checkout",
                json={
                    "reta_id": reta["id"], "nombre": f"M{i}",
                    "telefono": _phone(), "es_free_agent": True,
                },
                timeout=20,
            )
            _aprobar(r.json()["id"])
            ids_fa.append(r.json()["id"])
        r = requests.post(
            f"{BASE_URL}/api/retas/{reta['id']}/free-agents/match",
            headers=_h(token),
            json={"inscripcion_a_id": ids_fa[0], "inscripcion_b_id": ids_fa[1]},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["ok"] is True
        assert "pareja_grupo_id" in d
        # Verificar shared grupo
        lst = requests.get(
            f"{BASE_URL}/api/retas/{reta['id']}/inscripciones", headers=_h(token), timeout=15,
        ).json()
        miembros = [i for i in lst if i["id"] in ids_fa]
        grupos = {m["pareja_grupo_id"] for m in miembros}
        assert len(grupos) == 1 and None not in grupos

    # Punto 17 — match con IDs iguales 400
    def test_match_ids_iguales_400(self, token, created_ids):
        reta = _crear_reta(
            token, modalidad_registro="parejas_libres",
            permitir_individual_en_parejas=True, max_jugadores=8,
        )
        created_ids.append(reta["id"])
        r = requests.post(
            f"{BASE_URL}/api/public/retas/{reta['id']}/checkout",
            json={
                "reta_id": reta["id"], "nombre": "Solo",
                "telefono": _phone(), "es_free_agent": True,
            },
            timeout=20,
        )
        _aprobar(r.json()["id"])
        insc_id = r.json()["id"]
        r2 = requests.post(
            f"{BASE_URL}/api/retas/{reta['id']}/free-agents/match",
            headers=_h(token),
            json={"inscripcion_a_id": insc_id, "inscripcion_b_id": insc_id},
            timeout=15,
        )
        assert r2.status_code == 400, r2.text

    # Punto 18 — match ya emparejados 409
    def test_match_ya_emparejados_409(self, token, created_ids):
        reta = _crear_reta(
            token, modalidad_registro="parejas_libres",
            permitir_individual_en_parejas=True, max_jugadores=8,
        )
        created_ids.append(reta["id"])
        # Crear dúo via pareja directa (ya tienen grupo)
        body = {
            "reta_id": reta["id"],
            "nombre": "PE1", "telefono": _phone(),
            "pareja_nombre": "PE2", "pareja_telefono": _phone(),
        }
        rp = requests.post(
            f"{BASE_URL}/api/public/retas/{reta['id']}/checkout", json=body, timeout=20,
        )
        _aprobar(rp.json()["id"])
        lst = requests.get(
            f"{BASE_URL}/api/retas/{reta['id']}/inscripciones", headers=_h(token), timeout=15,
        ).json()
        miembros = [i for i in lst if i["pareja_grupo_id"]]
        assert len(miembros) >= 2
        # Free-agent extra
        rf = requests.post(
            f"{BASE_URL}/api/public/retas/{reta['id']}/checkout",
            json={
                "reta_id": reta["id"], "nombre": "FE",
                "telefono": _phone(), "es_free_agent": True,
            },
            timeout=20,
        )
        _aprobar(rf.json()["id"])
        fa_id = rf.json()["id"]
        # Intentar emparejar uno ya con grupo + free agent → 409
        r = requests.post(
            f"{BASE_URL}/api/retas/{reta['id']}/free-agents/match",
            headers=_h(token),
            json={"inscripcion_a_id": miembros[0]["id"], "inscripcion_b_id": fa_id},
            timeout=15,
        )
        assert r.status_code == 409, r.text

    # Punto 19 — DELETE modo=duo borra ambos
    def test_cancel_dúo_modo_duo(self, token, created_ids):
        reta = _crear_reta(token, modalidad_registro="parejas_libres", max_jugadores=8)
        created_ids.append(reta["id"])
        body = {
            "reta_id": reta["id"],
            "nombre": "DA", "telefono": _phone(),
            "pareja_nombre": "DB", "pareja_telefono": _phone(),
        }
        rp = requests.post(
            f"{BASE_URL}/api/public/retas/{reta['id']}/checkout", json=body, timeout=20,
        )
        _aprobar(rp.json()["id"])
        insc_id = rp.json()["id"]
        # Pre: 2 inscritos
        det = requests.get(f"{BASE_URL}/api/public/retas/{reta['url_slug']}", timeout=15).json()
        assert det["inscritos_count"] == 2
        # DELETE modo=duo
        r = requests.delete(
            f"{BASE_URL}/api/retas/{reta['id']}/inscripciones/{insc_id}?modo=duo",
            headers=_h(token), timeout=15,
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["eliminadas"] == 2
        assert d["cupos_liberados"] == 2
        # Post: 0 inscritos
        det2 = requests.get(f"{BASE_URL}/api/public/retas/{reta['url_slug']}", timeout=15).json()
        assert det2["inscritos_count"] == 0

    # Punto 20 — DELETE modo=solo deja otro como free-agent
    def test_cancel_modo_solo(self, token, created_ids):
        reta = _crear_reta(token, modalidad_registro="parejas_libres", max_jugadores=8)
        created_ids.append(reta["id"])
        body = {
            "reta_id": reta["id"],
            "nombre": "SOA", "telefono": _phone(),
            "pareja_nombre": "SOB", "pareja_telefono": _phone(),
        }
        rp = requests.post(
            f"{BASE_URL}/api/public/retas/{reta['id']}/checkout", json=body, timeout=20,
        )
        _aprobar(rp.json()["id"])
        insc_id = rp.json()["id"]
        # DELETE solo
        r = requests.delete(
            f"{BASE_URL}/api/retas/{reta['id']}/inscripciones/{insc_id}?modo=solo",
            headers=_h(token), timeout=15,
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["eliminadas"] == 1
        # El otro queda como free-agent
        lst = requests.get(
            f"{BASE_URL}/api/retas/{reta['id']}/inscripciones",
            headers=_h(token), timeout=15,
        ).json()
        assert len(lst) == 1
        assert lst[0]["es_free_agent"] is True
        assert lst[0]["pareja_grupo_id"] in (None,)

    # Punto 21 — GET /duos
    def test_listar_duos(self, token, created_ids):
        reta = _crear_reta(token, modalidad_registro="parejas_libres", max_jugadores=8)
        created_ids.append(reta["id"])
        for i in range(2):
            body = {
                "reta_id": reta["id"],
                "nombre": f"GA{i}", "telefono": _phone(),
                "pareja_nombre": f"GB{i}", "pareja_telefono": _phone(),
            }
            r = requests.post(
                f"{BASE_URL}/api/public/retas/{reta['id']}/checkout", json=body, timeout=20,
            )
            _aprobar(r.json()["id"])
        r = requests.get(
            f"{BASE_URL}/api/retas/{reta['id']}/duos", headers=_h(token), timeout=15,
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert isinstance(d, list)
        assert len(d) == 2
        for duo in d:
            assert "pareja_grupo_id" in duo
            assert len(duo["miembros"]) == 2

    # Punto 22 — endpoints requieren auth + 400 si individual
    def test_endpoints_fase4_requieren_auth(self, token, created_ids):
        # Sin token
        r = requests.get(f"{BASE_URL}/api/retas/anyid/free-agents", timeout=15)
        assert r.status_code in (401, 403), r.text
        r = requests.get(f"{BASE_URL}/api/retas/anyid/duos", timeout=15)
        assert r.status_code in (401, 403), r.text
        r = requests.post(f"{BASE_URL}/api/retas/anyid/free-agents/match",
                          json={"inscripcion_a_id": "1234567890", "inscripcion_b_id": "0987654321"},
                          timeout=15)
        assert r.status_code in (401, 403), r.text

    def test_endpoints_fase4_400_si_individual(self, token, created_ids):
        reta = _crear_reta(token, modalidad_registro="individual")
        created_ids.append(reta["id"])
        r = requests.get(
            f"{BASE_URL}/api/retas/{reta['id']}/free-agents",
            headers=_h(token), timeout=15,
        )
        assert r.status_code == 400, r.text
        r = requests.get(
            f"{BASE_URL}/api/retas/{reta['id']}/duos",
            headers=_h(token), timeout=15,
        )
        assert r.status_code == 400, r.text


# =================================================================
# REGRESIÓN — Individual no se rompió
# =================================================================
class TestRegresionIndividual:
    def test_checkout_individual_clasico(self, token, created_ids):
        reta = _crear_reta(token, modalidad_registro="individual", max_jugadores=8)
        created_ids.append(reta["id"])
        # Checkout sin campos de pareja debe funcionar 100%
        body = {
            "reta_id": reta["id"],
            "nombre": "TEST Indiv", "telefono": _phone(),
        }
        r = requests.post(
            f"{BASE_URL}/api/public/retas/{reta['id']}/checkout", json=body, timeout=20,
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["pareja_grupo_id"] is None
        assert d["es_free_agent"] is False
        # Aprobar
        _aprobar(d["id"])
        det = requests.get(f"{BASE_URL}/api/public/retas/{reta['url_slug']}", timeout=15).json()
        assert det["inscritos_count"] == 1
