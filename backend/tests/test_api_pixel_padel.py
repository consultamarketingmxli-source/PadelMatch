"""API integration tests for Pixel Padel OS — covers auth, retas, radar,
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
            json={"username": "admin@pixelpadel.com", "password": "admin123"},
        )
        assert r.status_code == 200
        data = r.json()
        assert "access_token" in data and data["token_type"] == "bearer"

    def test_login_bad_password(self, api_client):
        r = api_client.post(
            f"{BASE_URL}/api/auth/login",
            json={"username": "admin@pixelpadel.com", "password": "wrong"},
        )
        assert r.status_code == 401

    def test_me_returns_admin(self, api_client, auth_headers):
        r = api_client.get(f"{BASE_URL}/api/auth/me", headers=auth_headers)
        assert r.status_code == 200
        data = r.json()
        assert data["email"] == "admin@pixelpadel.com"
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

    def test_stats_known_player_after_approval(self, api_client, auth_headers):
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
            assert data["partidos_jugados"] == 14  # 7 rondas * 2
            assert 0 < data["efectividad"] <= 100
        finally:
            _delete_reta(api_client, auth_headers, reta["id"])
