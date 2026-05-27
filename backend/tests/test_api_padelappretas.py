"""API integration tests for PadelappRetas OS — covers auth, retas, radar,
checkout, waitlist promotion, semaforo states, PDF, and player stats."""
import time

import pytest
import requests

from conftest import BASE_URL


# ============== AUTH ==============
class TestAuth:
    def test_login_success(self, api_client):
        r = api_client.post(
            f"{BASE_URL}/api/auth/login",
            json={"username": "admin@padelappretas.com", "password": "admin123"},
        )
        assert r.status_code == 200
        data = r.json()
        assert "access_token" in data and data["token_type"] == "bearer"

    def test_login_bad_password(self, api_client):
        r = api_client.post(
            f"{BASE_URL}/api/auth/login",
            json={"username": "admin@padelappretas.com", "password": "wrong"},
        )
        assert r.status_code == 401

    def test_me_returns_admin(self, api_client, auth_headers):
        r = api_client.get(f"{BASE_URL}/api/auth/me", headers=auth_headers)
        assert r.status_code == 200
        data = r.json()
        assert data["email"] == "admin@padelappretas.com"
        assert data["role"] == "admin"

    def test_me_requires_token(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/auth/me")
        assert r.status_code in (401, 403)


# ============== RETA HELPERS ==============
def _create_reta(api_client, auth_headers, **overrides):
    suffix = str(int(time.time() * 1000))
    payload = {
        "nombre": f"TEST_Reta_{suffix}",
        "club": f"TEST_Club_{suffix}",
        "fecha_str": "2026-12-15",
        "hora_str": "18:00",
        "tz_offset_minutes": -360,
        "canchas_disponibles": 1,
        "costo_inscripcion": 250.0,
        "modalidad_juego": "PUNTOS",
        "num_rondas": 7,
        "observaciones_publicas": "TEST evento",
        "latitud": 19.43,
        "longitud": -99.13,
    }
    payload.update(overrides)
    r = api_client.post(f"{BASE_URL}/api/retas", json=payload, headers=auth_headers)
    assert r.status_code == 200, f"Create reta failed: {r.status_code} {r.text}"
    return r.json()


def _delete_reta(api_client, auth_headers, reta_id):
    api_client.delete(f"{BASE_URL}/api/retas/{reta_id}", headers=auth_headers)


# ============== RETAS CRUD ==============
class TestRetas:
    def test_create_reta_sets_max_jugadores_8x_canchas(self, api_client, auth_headers):
        reta = _create_reta(api_client, auth_headers, canchas_disponibles=2)
        try:
            assert reta["max_jugadores"] == 16
            assert reta["url_slug"]
            # fecha_evento ISO with offset
            assert "T" in reta["fecha_evento"] and (
                "-06:00" in reta["fecha_evento"] or "+" in reta["fecha_evento"]
            )
            # Persistence GET
            g = api_client.get(
                f"{BASE_URL}/api/retas/{reta['id']}", headers=auth_headers
            )
            assert g.status_code == 200
            assert g.json()["id"] == reta["id"]
        finally:
            _delete_reta(api_client, auth_headers, reta["id"])

    def test_list_retas_has_semaforo(self, api_client, auth_headers):
        reta = _create_reta(api_client, auth_headers)
        try:
            r = api_client.get(f"{BASE_URL}/api/retas", headers=auth_headers)
            assert r.status_code == 200
            items = r.json()
            assert isinstance(items, list)
            target = next((x for x in items if x["id"] == reta["id"]), None)
            assert target is not None
            assert target["semaforo"] in ("VERDE", "AMARILLO", "ROJO")
            assert "inscritos_count" in target
            assert "capacidad_pct" in target
            # New reta -> VERDE, 0 inscritos
            assert target["inscritos_count"] == 0
            assert target["semaforo"] == "VERDE"
        finally:
            _delete_reta(api_client, auth_headers, reta["id"])


# ============== RADAR (Haversine) ==============
class TestRadar:
    def test_radar_includes_close_excludes_far(self, api_client, auth_headers):
        # ~10 km from CDMX center
        near = _create_reta(
            api_client, auth_headers, latitud=19.50, longitud=-99.20
        )
        # Cancun-ish, > 1000 km from CDMX
        far = _create_reta(api_client, auth_headers, latitud=21.16, longitud=-86.85)
        try:
            r = api_client.get(
                f"{BASE_URL}/api/public/retas/radar",
                params={"lat": 19.43, "lng": -99.13, "radio_km": 30},
            )
            assert r.status_code == 200
            ids = [x["id"] for x in r.json()]
            assert near["id"] in ids, "Near reta should be present within 30km"
            assert far["id"] not in ids, "Far reta should be filtered out"
        finally:
            _delete_reta(api_client, auth_headers, near["id"])
            _delete_reta(api_client, auth_headers, far["id"])


# ============== PUBLIC DETAIL ==============
class TestPublicDetail:
    def test_get_reta_by_slug(self, api_client, auth_headers):
        reta = _create_reta(api_client, auth_headers)
        try:
            r = api_client.get(f"{BASE_URL}/api/public/retas/{reta['url_slug']}")
            assert r.status_code == 200
            data = r.json()
            assert data["url_slug"] == reta["url_slug"]
            assert data["semaforo"] == "VERDE"
            assert data["inscritos_count"] == 0
        finally:
            _delete_reta(api_client, auth_headers, reta["id"])


# ============== CHECKOUT + WEBHOOK + SEMAFORO LLENO ==============
class TestCheckoutFlow:
    def test_checkout_creates_pendiente_with_lock(self, api_client, auth_headers):
        reta = _create_reta(api_client, auth_headers)
        try:
            r = api_client.post(
                f"{BASE_URL}/api/public/retas/{reta['id']}/checkout",
                json={
                    "reta_id": reta["id"],
                    "nombre": "TEST_Player1",
                    "telefono": "+521TEST10000001",
                },
            )
            assert r.status_code == 200, r.text
            data = r.json()
            assert data["estatus_pago"] == "Pendiente"
            assert data["bloqueado_hasta"] is not None
            # Approve via webhook
            w = api_client.post(
                f"{BASE_URL}/api/webhooks/payment",
                json={"inscripcion_id": data["id"], "status": "approved"},
            )
            assert w.status_code == 200
            assert w.json()["status"] == "Aprobado"
        finally:
            _delete_reta(api_client, auth_headers, reta["id"])

    def test_fill_reta_to_rojo_and_409(self, api_client, auth_headers):
        reta = _create_reta(api_client, auth_headers, canchas_disponibles=1)
        try:
            # Fill 8 spots and approve them
            for i in range(8):
                r = api_client.post(
                    f"{BASE_URL}/api/public/retas/{reta['id']}/checkout",
                    json={
                        "reta_id": reta["id"],
                        "nombre": f"TEST_Player_{i}",
                        "telefono": f"+521TEST20{i:06d}",
                    },
                )
                assert r.status_code == 200, f"Checkout {i} failed: {r.text}"
                insc_id = r.json()["id"]
                w = api_client.post(
                    f"{BASE_URL}/api/webhooks/payment",
                    json={"inscripcion_id": insc_id, "status": "approved"},
                )
                assert w.status_code == 200

            # Semaforo should be ROJO now
            detail = api_client.get(
                f"{BASE_URL}/api/public/retas/{reta['url_slug']}"
            ).json()
            assert detail["semaforo"] == "ROJO"
            assert detail["inscritos_count"] == 8
            assert detail["capacidad_pct"] == 100.0

            # 9th checkout should 409
            extra = api_client.post(
                f"{BASE_URL}/api/public/retas/{reta['id']}/checkout",
                json={
                    "reta_id": reta["id"],
                    "nombre": "TEST_Overflow",
                    "telefono": "+521TEST2OVERFLOW",
                },
            )
            assert extra.status_code == 409
        finally:
            _delete_reta(api_client, auth_headers, reta["id"])


# ============== WAITLIST + PROMOTION ==============
class TestWaitlist:
    def test_waitlist_positions_and_promotion(self, api_client, auth_headers):
        reta = _create_reta(api_client, auth_headers, canchas_disponibles=1)
        inscripciones_ids = []
        try:
            # Fill the reta to ROJO with approved players
            for i in range(8):
                r = api_client.post(
                    f"{BASE_URL}/api/public/retas/{reta['id']}/checkout",
                    json={
                        "reta_id": reta["id"],
                        "nombre": f"TEST_FillPlayer_{i}",
                        "telefono": f"+521TEST30{i:06d}",
                    },
                )
                assert r.status_code == 200
                ins = r.json()
                inscripciones_ids.append(ins["id"])
                w = api_client.post(
                    f"{BASE_URL}/api/webhooks/payment",
                    json={"inscripcion_id": ins["id"], "status": "approved"},
                )
                assert w.status_code == 200

            # Add 3 to waitlist in order
            positions = []
            for i in range(3):
                wl = api_client.post(
                    f"{BASE_URL}/api/public/retas/{reta['id']}/waitlist",
                    json={
                        "reta_id": reta["id"],
                        "nombre": f"TEST_WL_{i}",
                        "telefono": f"+521TEST40{i:06d}",
                    },
                )
                assert wl.status_code == 200, wl.text
                positions.append(wl.json()["posicion_fila"])
            assert positions == [1, 2, 3], f"Expected [1,2,3], got {positions}"

            # Cancel one approved via webhook=failed -> should promote WL pos 1
            cancelled_id = inscripciones_ids[0]
            cancel = api_client.post(
                f"{BASE_URL}/api/webhooks/payment",
                json={"inscripcion_id": cancelled_id, "status": "failed"},
            )
            assert cancel.status_code == 200
            assert cancel.json().get("promoted") is True

            # Verify new Pendiente inscription exists for TEST_WL_0 phone
            inscripciones = api_client.get(
                f"{BASE_URL}/api/retas/{reta['id']}/inscripciones",
                headers=auth_headers,
            ).json()
            promoted = [
                x for x in inscripciones
                if x["telefono"] == "+521TEST40000000"
                and x["estatus_pago"] == "Pendiente"
            ]
            assert len(promoted) == 1, (
                f"Waitlist pos 1 should have been promoted: {inscripciones}"
            )
            assert promoted[0]["bloqueado_hasta"] is not None
        finally:
            _delete_reta(api_client, auth_headers, reta["id"])


# ============== PDF ==============
class TestPDF:
    def test_generate_pdf_binary(self, api_client, auth_headers):
        reta = _create_reta(api_client, auth_headers, canchas_disponibles=1, num_rondas=5)
        try:
            r = requests.post(
                f"{BASE_URL}/api/retas/{reta['id']}/pdf",
                headers={**auth_headers, "Content-Type": "application/json"},
                json={"jugadores": [f"TEST_J{i}" for i in range(1, 9)], "num_rondas": 5},
                timeout=30,
            )
            assert r.status_code == 200
            assert r.headers["content-type"].startswith("application/pdf")
            assert r.content.startswith(b"%PDF-"), "Not a valid PDF magic header"
            assert len(r.content) > 1000
        finally:
            _delete_reta(api_client, auth_headers, reta["id"])


# ============== PLAYER STATS ==============
class TestPlayerStats:
    def test_stats_unknown_player_returns_defaults(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/public/players/+521TESTNOEXISTE/stats")
        assert r.status_code == 200
        data = r.json()
        assert data["partidos_jugados"] == 0
        assert data["efectividad"] == 0.0

    def test_stats_known_player_no_results_yet(self, api_client, auth_headers):
        """Después de la refactor: la efectividad se calcula desde resultados REALES.
        Un jugador recién aprobado, sin partidos capturados, debe tener 0/0."""
        reta = _create_reta(api_client, auth_headers, canchas_disponibles=1, num_rondas=7)
        try:
            phone = "+521TESTSTATSPLAYER"
            ins = api_client.post(
                f"{BASE_URL}/api/public/retas/{reta['id']}/checkout",
                json={"reta_id": reta["id"], "nombre": "TEST_StatsPlayer", "telefono": phone},
            ).json()
            api_client.post(
                f"{BASE_URL}/api/webhooks/payment",
                json={"inscripcion_id": ins["id"], "status": "approved"},
            )
            r = api_client.get(f"{BASE_URL}/api/public/players/{phone}/stats")
            assert r.status_code == 200
            data = r.json()
            assert data["nombre"] == "TEST_StatsPlayer"
            assert data["partidos_jugados"] == 0
            assert data["partidos_ganados"] == 0
            assert data["efectividad"] == 0.0
        finally:
            _delete_reta(api_client, auth_headers, reta["id"])

    def test_stats_real_efectividad_from_resultados(self, api_client, auth_headers):
        """Crea una reta, captura 3 partidos donde 'TEST_RealStats' gana 2 y pierde 1
        y verifica que efectividad = 2/3*100 = 66.7."""
        reta = _create_reta(api_client, auth_headers, canchas_disponibles=1, num_rondas=7)
        try:
            phone = "+521TESTREALSTATS"
            target = "TEST_RealStats"
            # Inscribir y aprobar al jugador
            ins = api_client.post(
                f"{BASE_URL}/api/public/retas/{reta['id']}/checkout",
                json={"reta_id": reta["id"], "nombre": target, "telefono": phone},
            ).json()
            api_client.post(
                f"{BASE_URL}/api/webhooks/payment",
                json={"inscripcion_id": ins["id"], "status": "approved"},
            )
            # 3 partidos: gana, gana, pierde
            partidos = [
                {"cancha": 1, "ronda": 1, "partido_idx": 0, "pareja_a": [target, "X"], "pareja_b": ["Y", "Z"], "score_a": 6, "score_b": 3},
                {"cancha": 1, "ronda": 2, "partido_idx": 0, "pareja_a": ["Y", target], "pareja_b": ["X", "Z"], "score_a": 6, "score_b": 2},
                {"cancha": 1, "ronda": 3, "partido_idx": 0, "pareja_a": ["X", "Y"], "pareja_b": [target, "Z"], "score_a": 6, "score_b": 4},
            ]
            for p in partidos:
                r = api_client.post(
                    f"{BASE_URL}/api/retas/{reta['id']}/resultados",
                    json=p, headers=auth_headers,
                )
                assert r.status_code == 200, r.text
            r = api_client.get(f"{BASE_URL}/api/public/players/{phone}/stats")
            assert r.status_code == 200
            data = r.json()
            assert data["partidos_jugados"] == 3
            assert data["partidos_ganados"] == 2
            assert abs(data["efectividad"] - 66.7) < 0.2
        finally:
            _delete_reta(api_client, auth_headers, reta["id"])


# ============== ROL ==============
class TestRol:
    def test_get_rol_returns_round_robin(self, api_client, auth_headers):
        reta = _create_reta(api_client, auth_headers, canchas_disponibles=1, num_rondas=7)
        try:
            r = api_client.get(
                f"{BASE_URL}/api/retas/{reta['id']}/rol", headers=auth_headers,
            )
            assert r.status_code == 200, r.text
            data = r.json()
            assert data["reta_id"] == reta["id"]
            assert data["canchas"] == 1
            assert data["num_rondas"] == 7
            assert len(data["jugadores"]) == 8  # 8 * 1 cancha
            # Placeholders 'Jugador N'
            assert all(j.startswith("Jugador ") for j in data["jugadores"])
            # rol estructura: 1 cancha con 7 rondas, cada ronda con 2 partidos
            assert len(data["rol"]) == 1
            cancha1 = data["rol"][0]
            assert cancha1["cancha"] == 1
            assert len(cancha1["rondas"]) == 7
            for ronda in cancha1["rondas"]:
                assert len(ronda["partidos"]) == 2
                for p in ronda["partidos"]:
                    assert len(p["pareja_a"]) == 2
                    assert len(p["pareja_b"]) == 2
        finally:
            _delete_reta(api_client, auth_headers, reta["id"])

    def test_get_rol_requires_auth(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/retas/fake-id/rol")
        assert r.status_code in (401, 403)


# ============== RESULTADOS (POST/GET) ==============
class TestResultados:
    def test_post_resultado_calcula_ganador_A(self, api_client, auth_headers):
        reta = _create_reta(api_client, auth_headers, canchas_disponibles=1, num_rondas=7)
        try:
            r = api_client.post(
                f"{BASE_URL}/api/retas/{reta['id']}/resultados",
                json={
                    "cancha": 1, "ronda": 1, "partido_idx": 0,
                    "pareja_a": ["A1", "A2"], "pareja_b": ["B1", "B2"],
                    "score_a": 6, "score_b": 3,
                },
                headers=auth_headers,
            )
            assert r.status_code == 200, r.text
            data = r.json()
            assert data["ganador"] == "A"
            assert data["score_a"] == 6 and data["score_b"] == 3
        finally:
            _delete_reta(api_client, auth_headers, reta["id"])

    def test_post_resultado_calcula_ganador_B_y_empate(self, api_client, auth_headers):
        reta = _create_reta(api_client, auth_headers, canchas_disponibles=1, num_rondas=7)
        try:
            # B gana
            r1 = api_client.post(
                f"{BASE_URL}/api/retas/{reta['id']}/resultados",
                json={"cancha": 1, "ronda": 1, "partido_idx": 0,
                      "pareja_a": ["A1", "A2"], "pareja_b": ["B1", "B2"],
                      "score_a": 2, "score_b": 6},
                headers=auth_headers,
            )
            assert r1.json()["ganador"] == "B"
            # EMPATE
            r2 = api_client.post(
                f"{BASE_URL}/api/retas/{reta['id']}/resultados",
                json={"cancha": 1, "ronda": 2, "partido_idx": 0,
                      "pareja_a": ["A1", "A2"], "pareja_b": ["B1", "B2"],
                      "score_a": 4, "score_b": 4},
                headers=auth_headers,
            )
            assert r2.json()["ganador"] == "EMPATE"
        finally:
            _delete_reta(api_client, auth_headers, reta["id"])

    def test_post_resultado_idempotente_upsert(self, api_client, auth_headers):
        reta = _create_reta(api_client, auth_headers, canchas_disponibles=1, num_rondas=7)
        try:
            payload = {
                "cancha": 1, "ronda": 1, "partido_idx": 0,
                "pareja_a": ["A1", "A2"], "pareja_b": ["B1", "B2"],
                "score_a": 6, "score_b": 3,
            }
            r1 = api_client.post(
                f"{BASE_URL}/api/retas/{reta['id']}/resultados",
                json=payload, headers=auth_headers,
            )
            assert r1.status_code == 200
            first_id = r1.json()["id"]

            # Update score con misma key — debería ACTUALIZAR, no crear
            payload["score_a"] = 4
            payload["score_b"] = 6
            r2 = api_client.post(
                f"{BASE_URL}/api/retas/{reta['id']}/resultados",
                json=payload, headers=auth_headers,
            )
            assert r2.status_code == 200
            assert r2.json()["id"] == first_id, "Debe mantener mismo id (upsert)"
            assert r2.json()["ganador"] == "B"

            # GET lista debe tener exactamente 1
            g = api_client.get(
                f"{BASE_URL}/api/retas/{reta['id']}/resultados",
                headers=auth_headers,
            )
            assert g.status_code == 200
            assert len(g.json()) == 1
        finally:
            _delete_reta(api_client, auth_headers, reta["id"])

    def test_get_resultados_ordenado(self, api_client, auth_headers):
        reta = _create_reta(api_client, auth_headers, canchas_disponibles=2, num_rondas=7)
        try:
            # Insertar en orden caótico
            payloads = [
                (2, 3, 1), (1, 1, 0), (2, 1, 0), (1, 2, 1),
            ]
            for cancha, ronda, idx in payloads:
                api_client.post(
                    f"{BASE_URL}/api/retas/{reta['id']}/resultados",
                    json={"cancha": cancha, "ronda": ronda, "partido_idx": idx,
                          "pareja_a": ["A", "B"], "pareja_b": ["C", "D"],
                          "score_a": 5, "score_b": 4},
                    headers=auth_headers,
                )
            r = api_client.get(
                f"{BASE_URL}/api/retas/{reta['id']}/resultados",
                headers=auth_headers,
            )
            assert r.status_code == 200
            data = r.json()
            tuples = [(d["cancha"], d["ronda"], d["partido_idx"]) for d in data]
            assert tuples == sorted(tuples), f"No ordenado: {tuples}"
        finally:
            _delete_reta(api_client, auth_headers, reta["id"])

    def test_post_validations_cancha_ronda_pareja(self, api_client, auth_headers):
        reta = _create_reta(api_client, auth_headers, canchas_disponibles=1, num_rondas=7)
        try:
            # Cancha fuera de rango (reta tiene 1 cancha) -> 400
            r1 = api_client.post(
                f"{BASE_URL}/api/retas/{reta['id']}/resultados",
                json={"cancha": 5, "ronda": 1, "partido_idx": 0,
                      "pareja_a": ["A", "B"], "pareja_b": ["C", "D"],
                      "score_a": 6, "score_b": 0},
                headers=auth_headers,
            )
            assert r1.status_code in (400, 422), r1.text

            # Ronda fuera de rango (>7) -> 422 (pydantic) o 400
            r2 = api_client.post(
                f"{BASE_URL}/api/retas/{reta['id']}/resultados",
                json={"cancha": 1, "ronda": 99, "partido_idx": 0,
                      "pareja_a": ["A", "B"], "pareja_b": ["C", "D"],
                      "score_a": 6, "score_b": 0},
                headers=auth_headers,
            )
            assert r2.status_code in (400, 422)

            # pareja_a con 1 sola persona -> 400/422
            r3 = api_client.post(
                f"{BASE_URL}/api/retas/{reta['id']}/resultados",
                json={"cancha": 1, "ronda": 1, "partido_idx": 0,
                      "pareja_a": ["A"], "pareja_b": ["C", "D"],
                      "score_a": 6, "score_b": 0},
                headers=auth_headers,
            )
            assert r3.status_code in (400, 422)
        finally:
            _delete_reta(api_client, auth_headers, reta["id"])


# ============== TABLA DE POSICIONES ==============
class TestTabla:
    def test_tabla_ordering_y_puntos(self, api_client, auth_headers):
        reta = _create_reta(api_client, auth_headers, canchas_disponibles=1, num_rondas=7)
        try:
            # Configuración: J1 gana 2 y empata 1 -> 7 pts
            #                J2 socio en gana 1 y pierde 2 -> 3 pts
            #                J3 y J4 son rivales
            partidos = [
                # P1: J1+X gana 6-3 a J3+J4 -> J1=3pts
                {"cancha": 1, "ronda": 1, "partido_idx": 0,
                 "pareja_a": ["J1", "X"], "pareja_b": ["J3", "J4"],
                 "score_a": 6, "score_b": 3},
                # P2: J1+J2 gana 6-2 a J3+J4 -> J1+3, J2+3
                {"cancha": 1, "ronda": 2, "partido_idx": 0,
                 "pareja_a": ["J1", "J2"], "pareja_b": ["J3", "J4"],
                 "score_a": 6, "score_b": 2},
                # P3: J1+J2 empata 4-4 con J3+J4 -> J1+1, J2+1
                {"cancha": 1, "ronda": 3, "partido_idx": 0,
                 "pareja_a": ["J1", "J2"], "pareja_b": ["J3", "J4"],
                 "score_a": 4, "score_b": 4},
            ]
            for p in partidos:
                rr = api_client.post(
                    f"{BASE_URL}/api/retas/{reta['id']}/resultados",
                    json=p, headers=auth_headers,
                )
                assert rr.status_code == 200, rr.text

            r = api_client.get(f"{BASE_URL}/api/public/retas/{reta['id']}/tabla")
            assert r.status_code == 200, r.text
            tabla = r.json()
            by_name = {e["nombre"]: e for e in tabla}
            assert "J1" in by_name and "J2" in by_name and "J3" in by_name
            # J1: 3 partidos, 2G + 1E -> 7 pts
            assert by_name["J1"]["partidos_jugados"] == 3
            assert by_name["J1"]["partidos_ganados"] == 2
            assert by_name["J1"]["partidos_empatados"] == 1
            assert by_name["J1"]["puntos"] == 7
            # J2: 2 partidos (no jugó P1), 1G + 1E -> 4 pts
            assert by_name["J2"]["partidos_jugados"] == 2
            assert by_name["J2"]["puntos"] == 4
            # J3: 3 partidos, 0G + 1E + 2P -> 1 pt
            assert by_name["J3"]["puntos"] == 1
            assert by_name["J3"]["partidos_perdidos"] == 2
            # Diferencia J1 = (6+6+4)-(3+2+4) = 16-9 = 7
            assert by_name["J1"]["diferencia"] == 7
            assert by_name["J1"]["juegos_a_favor"] == 16
            assert by_name["J1"]["juegos_en_contra"] == 9
            # Efectividad J1 = 2/3*100 = 66.7
            assert abs(by_name["J1"]["efectividad"] - 66.7) < 0.2
            # Ordenamiento: J1 (7) > J2 (4) > J3 (1)
            puntos_lista = [e["puntos"] for e in tabla]
            assert puntos_lista == sorted(puntos_lista, reverse=True)
            # J1 debe ser el primero
            assert tabla[0]["nombre"] == "J1"
        finally:
            _delete_reta(api_client, auth_headers, reta["id"])

    def test_tabla_publica_sin_auth(self, api_client, auth_headers):
        reta = _create_reta(api_client, auth_headers, canchas_disponibles=1)
        try:
            # Sin headers de auth
            r = requests.get(f"{BASE_URL}/api/public/retas/{reta['id']}/tabla")
            assert r.status_code == 200
            assert isinstance(r.json(), list)
        finally:
            _delete_reta(api_client, auth_headers, reta["id"])

    def test_tabla_reta_inexistente_404(self, api_client):
        r = requests.get(f"{BASE_URL}/api/public/retas/no-existe-xyz/tabla")
        assert r.status_code == 404
