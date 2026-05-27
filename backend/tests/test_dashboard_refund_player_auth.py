"""Iteration 4 backend tests:
   (1) Admin Dashboard métricas
   (2) Reembolsos Stripe (sin payment_intent — edge case válido)
   (3) Player OTP login (request + verify + me + history + stats)

Reads OTP code directly from MongoDB (`db.player_otps`) since SMS is mocked
(Twilio not configured) and the code is otherwise only printed to backend logs.
"""
from __future__ import annotations

import os
import time
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import requests
from pymongo import MongoClient

from conftest import BASE_URL


MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")


# ============== MongoDB direct access for OTP retrieval & expiration ==============
@pytest.fixture(scope="module")
def mongo_db():
    client = MongoClient(MONGO_URL)
    db = client[DB_NAME]
    yield db
    client.close()


# ============== Reta CRUD helpers ==============
def _create_reta(api_client, auth_headers, **overrides):
    suffix = str(int(time.time() * 1000)) + str(uuid.uuid4())[:4]
    payload = {
        "nombre": f"TEST_DashRefund_{suffix}",
        "club": f"TEST_Club_{suffix}",
        "fecha_str": "2026-12-20",
        "hora_str": "19:00",
        "tz_offset_minutes": -360,
        "canchas_disponibles": 1,
        "costo_inscripcion": 200.0,
        "modalidad_juego": "PUNTOS",
        "num_rondas": 7,
        "observaciones_publicas": "TEST",
        "latitud": 19.43,
        "longitud": -99.13,
    }
    payload.update(overrides)
    r = api_client.post(f"{BASE_URL}/api/retas", json=payload, headers=auth_headers)
    assert r.status_code == 200, f"Create reta failed: {r.status_code} {r.text}"
    return r.json()


def _delete_reta(api_client, auth_headers, reta_id):
    api_client.delete(f"{BASE_URL}/api/retas/{reta_id}", headers=auth_headers)


def _mock_checkout(api_client, reta_id, nombre, telefono):
    """Use legacy /public/retas/{id}/checkout (mock) to create a Pendiente."""
    r = api_client.post(
        f"{BASE_URL}/api/public/retas/{reta_id}/checkout",
        json={"reta_id": reta_id, "nombre": nombre, "telefono": telefono},
    )
    assert r.status_code == 200, f"checkout failed: {r.status_code} {r.text}"
    return r.json()


def _approve_inscripcion(api_client, inscripcion_id):
    """Approve via mock webhook (no Stripe involvement). Inscripcion has no stripe_session_id."""
    r = api_client.post(
        f"{BASE_URL}/api/webhooks/payment",
        json={"inscripcion_id": inscripcion_id, "status": "approved"},
    )
    assert r.status_code == 200, f"approve failed: {r.status_code} {r.text}"


# =====================================================================
# ============== 1) ADMIN DASHBOARD MÉTRICAS ==========================
# =====================================================================
class TestAdminMetrics:
    def test_metrics_requires_auth(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/admin/metrics")
        assert r.status_code == 401

    def test_metrics_rejects_player_token(self, api_client, auth_headers):
        # Crear un token de player y usarlo en /admin/metrics → debe ser 403
        tel = f"+52155{int(time.time())%10000000:07d}"
        api_client.post(
            f"{BASE_URL}/api/players/auth/otp/request",
            json={"nombre": "TEST Player", "telefono": tel},
        )
        # leer code de Mongo y verificar
        from pymongo import MongoClient
        client = MongoClient(MONGO_URL)
        rec = client[DB_NAME].player_otps.find_one({"telefono": tel})
        client.close()
        assert rec, "OTP record should exist"
        v = api_client.post(
            f"{BASE_URL}/api/players/auth/otp/verify",
            json={"telefono": tel, "codigo": rec["codigo"]},
        )
        assert v.status_code == 200, v.text
        player_token = v.json()["access_token"]
        r = api_client.get(
            f"{BASE_URL}/api/admin/metrics",
            headers={"Authorization": f"Bearer {player_token}"},
        )
        assert r.status_code == 403

    def test_metrics_schema_and_ordering(self, api_client, auth_headers):
        # Create two retas with different incomes & dates
        reta_low = _create_reta(api_client, auth_headers, fecha_str="2026-11-10",
                                costo_inscripcion=100.0)
        reta_high = _create_reta(api_client, auth_headers, fecha_str="2026-12-25",
                                 costo_inscripcion=300.0)
        created_ids = [reta_low["id"], reta_high["id"]]
        try:
            # Get baseline
            r = api_client.get(f"{BASE_URL}/api/admin/metrics", headers=auth_headers)
            assert r.status_code == 200, r.text
            data = r.json()

            # Schema checks
            expected_keys = {
                "ingresos_totales_mxn", "refunds_totales_mxn", "pagos_aprobados",
                "conversion_pct", "retas_totales", "retas_futuras",
                "jugadores_unicos", "top_retas", "proximas_retas",
            }
            assert expected_keys.issubset(set(data.keys())), \
                f"Missing keys: {expected_keys - set(data.keys())}"

            assert isinstance(data["top_retas"], list)
            assert isinstance(data["proximas_retas"], list)
            assert data["retas_totales"] >= 2

            # Top retas ordered by ingresos_mxn desc
            top = data["top_retas"]
            for i in range(len(top) - 1):
                assert top[i]["ingresos_mxn"] >= top[i + 1]["ingresos_mxn"], \
                    f"top_retas not desc-sorted by ingresos at idx {i}: {top}"

            # Proximas ordered by fecha_evento asc
            proximas = data["proximas_retas"]
            for i in range(len(proximas) - 1):
                assert proximas[i]["fecha_evento"] <= proximas[i + 1]["fecha_evento"], \
                    f"proximas_retas not asc-sorted by fecha at idx {i}"

            # KPI structure
            if top:
                k = top[0]
                for f in ("reta_id", "nombre", "club", "fecha_evento", "url_slug",
                          "capacidad_pct", "semaforo", "inscritos", "max_jugadores",
                          "waitlist", "ingresos_mxn", "refunds_mxn"):
                    assert f in k, f"missing field {f} in RetaKPI: {k}"
        finally:
            for rid in created_ids:
                _delete_reta(api_client, auth_headers, rid)


# =====================================================================
# ============== 2) REFUND VALIDATIONS & FLOW =========================
# =====================================================================
class TestRefundEndpoint:
    def test_refund_requires_auth(self, api_client):
        r = api_client.post(
            f"{BASE_URL}/api/admin/retas/nonexistent/inscripciones/nonexistent/refund"
        )
        assert r.status_code == 401

    def test_refund_404_for_missing_inscripcion(self, api_client, auth_headers):
        reta = _create_reta(api_client, auth_headers)
        try:
            r = api_client.post(
                f"{BASE_URL}/api/admin/retas/{reta['id']}/inscripciones/nonexistent_id/refund",
                headers=auth_headers,
            )
            assert r.status_code == 404, r.text
        finally:
            _delete_reta(api_client, auth_headers, reta["id"])

    def test_refund_400_when_not_aprobado(self, api_client, auth_headers):
        reta = _create_reta(api_client, auth_headers)
        try:
            insc = _mock_checkout(api_client, reta["id"], "TEST Refund Pend",
                                  f"+5215599{int(time.time())%1000000:06d}")
            # Insc está Pendiente (no aprobada): refund debe ser 400
            r = api_client.post(
                f"{BASE_URL}/api/admin/retas/{reta['id']}/inscripciones/{insc['id']}/refund",
                headers=auth_headers,
            )
            assert r.status_code == 400, r.text
            assert "Aprobad" in r.json().get("detail", "")
        finally:
            _delete_reta(api_client, auth_headers, reta["id"])

    def test_refund_success_no_payment_intent_local_path(
        self, api_client, auth_headers, mongo_db,
    ):
        """Edge case: inscripción Aprobada SIN stripe_session_id (mock-aprobada).
        El endpoint debe eliminar la inscripción y liberar el cupo localmente
        sin llamar a Stripe."""
        reta = _create_reta(api_client, auth_headers)
        try:
            tel_a = f"+5215588{int(time.time())%1000000:06d}"
            insc = _mock_checkout(api_client, reta["id"], "TEST Refund OK", tel_a)
            _approve_inscripcion(api_client, insc["id"])

            # Verificar Aprobado
            stored = mongo_db.inscripciones.find_one({"id": insc["id"]})
            assert stored and stored["estatus_pago"] == "Aprobado"
            assert not stored.get("stripe_session_id")  # mock path: sin Stripe

            # Refund
            r = api_client.post(
                f"{BASE_URL}/api/admin/retas/{reta['id']}/inscripciones/{insc['id']}/refund",
                headers=auth_headers,
            )
            assert r.status_code == 200, r.text
            body = r.json()
            assert body["ok"] is True
            assert body["inscripcion_id"] == insc["id"]
            # Sin payment_intent → refund_id queda None pero la operación es OK
            assert body["refund_id"] is None
            assert body["amount_refunded_mxn"] == 0.0
            assert body["promoted"] is False  # sin waitlist

            # Inscripción eliminada
            gone = mongo_db.inscripciones.find_one({"id": insc["id"]})
            assert gone is None, "Inscripción debió ser eliminada"
        finally:
            _delete_reta(api_client, auth_headers, reta["id"])

    def test_refund_idempotent_returns_404_second_time(
        self, api_client, auth_headers,
    ):
        """Tras el primer refund la inscripción ya no existe → segundo intento 404."""
        reta = _create_reta(api_client, auth_headers)
        try:
            tel = f"+5215577{int(time.time())%1000000:06d}"
            insc = _mock_checkout(api_client, reta["id"], "TEST Idemp", tel)
            _approve_inscripcion(api_client, insc["id"])

            r1 = api_client.post(
                f"{BASE_URL}/api/admin/retas/{reta['id']}/inscripciones/{insc['id']}/refund",
                headers=auth_headers,
            )
            assert r1.status_code == 200

            r2 = api_client.post(
                f"{BASE_URL}/api/admin/retas/{reta['id']}/inscripciones/{insc['id']}/refund",
                headers=auth_headers,
            )
            # Idempotencia: la inscripción ya no existe → 404 (no provoca errores ni
            # double-refund en Stripe). Aceptamos 404 como respuesta idempotente.
            assert r2.status_code == 404, r2.text
        finally:
            _delete_reta(api_client, auth_headers, reta["id"])

    def test_refund_promotes_waitlist(self, api_client, auth_headers, mongo_db):
        """Si hay alguien en waitlist al hacer refund, se libera cupo y se promueve."""
        # Capacidad 1 cancha = 8 jugadores. Llenamos los 8 + 1 waitlist.
        reta = _create_reta(api_client, auth_headers)
        try:
            inscripciones = []
            base_tel = int(time.time()) % 1000000
            # Llenar 8 lugares Aprobados
            for i in range(8):
                tel = f"+5215566{base_tel:06d}{i}"
                ins = _mock_checkout(api_client, reta["id"], f"TEST P{i}", tel)
                _approve_inscripcion(api_client, ins["id"])
                inscripciones.append(ins)

            # Verificar 8 aprobados
            count = mongo_db.inscripciones.count_documents(
                {"reta_id": reta["id"], "estatus_pago": "Aprobado"},
            )
            assert count == 8

            # Añadir uno a waitlist (reta llena → /checkout devuelve 409, así que
            # usamos endpoint /waitlist directo)
            wl_tel = f"+5215555{base_tel:06d}"
            wlr = api_client.post(
                f"{BASE_URL}/api/public/retas/{reta['id']}/waitlist",
                json={"nombre": "TEST Waitlister", "telefono": wl_tel,
                      "reta_id": reta["id"]},
            )
            assert wlr.status_code == 200, wlr.text

            # Refund al primero
            r = api_client.post(
                f"{BASE_URL}/api/admin/retas/{reta['id']}/inscripciones/{inscripciones[0]['id']}/refund",
                headers=auth_headers,
            )
            assert r.status_code == 200, r.text
            assert r.json()["promoted"] is True

            # Validar que el waitlister se convirtió en Pendiente
            promoted = mongo_db.inscripciones.find_one({
                "reta_id": reta["id"], "telefono": wl_tel,
            })
            assert promoted and promoted["estatus_pago"] == "Pendiente"
        finally:
            _delete_reta(api_client, auth_headers, reta["id"])


# =====================================================================
# ============== 3) PLAYER OTP LOGIN ==================================
# =====================================================================
class TestPlayerOtp:
    @staticmethod
    def _request_otp(api_client, nombre, telefono):
        return api_client.post(
            f"{BASE_URL}/api/players/auth/otp/request",
            json={"nombre": nombre, "telefono": telefono},
        )

    def test_otp_request_creates_record_and_lazy_user(self, api_client, mongo_db):
        tel = f"+5215111{int(time.time())%1000000:06d}"
        # Limpiar
        mongo_db.player_otps.delete_one({"telefono": tel})
        mongo_db.usuarios.delete_one({"telefono": tel})

        r = self._request_otp(api_client, "TEST OtpNew", tel)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["ok"] is True
        assert isinstance(body["enviado_por_sms"], bool)  # depende de si Twilio está configurado
        assert "mensaje" in body

        rec = mongo_db.player_otps.find_one({"telefono": tel})
        assert rec is not None
        assert len(rec["codigo"]) == 6
        assert rec["codigo"].isdigit()
        assert rec["intentos"] == 0
        assert "expires_at" in rec

        usuario = mongo_db.usuarios.find_one({"telefono": tel})
        assert usuario is not None, "Lazy upsert_jugador debió crear el usuario"

        # cleanup
        mongo_db.player_otps.delete_one({"telefono": tel})
        mongo_db.usuarios.delete_one({"telefono": tel})

    def test_otp_verify_wrong_code_increments_intentos(self, api_client, mongo_db):
        tel = f"+5215111{(int(time.time())+1)%1000000:06d}"
        mongo_db.player_otps.delete_one({"telefono": tel})
        mongo_db.usuarios.delete_one({"telefono": tel})

        self._request_otp(api_client, "TEST OtpWrong", tel)
        for i in range(1, 5):
            r = api_client.post(
                f"{BASE_URL}/api/players/auth/otp/verify",
                json={"telefono": tel, "codigo": "000000"},
            )
            assert r.status_code == 401, f"Iter {i}: {r.text}"
            rec = mongo_db.player_otps.find_one({"telefono": tel})
            assert rec["intentos"] == i

        # 5th wrong → still 401 (intento se incrementa a 5)... pero el código
        # chequea intentos >= 5 ANTES de validar, así que la sexta llamada con
        # cualquier código debe responder 429.
        r5 = api_client.post(
            f"{BASE_URL}/api/players/auth/otp/verify",
            json={"telefono": tel, "codigo": "000000"},
        )
        assert r5.status_code == 401  # esta también incrementa a 5
        rec = mongo_db.player_otps.find_one({"telefono": tel})
        assert rec["intentos"] >= 5

        r6 = api_client.post(
            f"{BASE_URL}/api/players/auth/otp/verify",
            json={"telefono": tel, "codigo": "000000"},
        )
        assert r6.status_code == 429, r6.text

        # cleanup
        mongo_db.player_otps.delete_one({"telefono": tel})
        mongo_db.usuarios.delete_one({"telefono": tel})

    def test_otp_verify_expired_returns_410(self, api_client, mongo_db):
        tel = f"+5215111{(int(time.time())+2)%1000000:06d}"
        mongo_db.player_otps.delete_one({"telefono": tel})
        mongo_db.usuarios.delete_one({"telefono": tel})

        self._request_otp(api_client, "TEST OtpExp", tel)
        # Forzar expiración modificando expires_at en el pasado
        past = (datetime.now(timezone.utc) - timedelta(minutes=10)).isoformat()
        mongo_db.player_otps.update_one(
            {"telefono": tel}, {"$set": {"expires_at": past}}
        )
        rec = mongo_db.player_otps.find_one({"telefono": tel})
        r = api_client.post(
            f"{BASE_URL}/api/players/auth/otp/verify",
            json={"telefono": tel, "codigo": rec["codigo"]},
        )
        assert r.status_code == 410, r.text
        # Debe haber sido borrado
        assert mongo_db.player_otps.find_one({"telefono": tel}) is None

        # cleanup usuario
        mongo_db.usuarios.delete_one({"telefono": tel})

    def test_otp_full_success_flow(self, api_client, mongo_db):
        tel = f"+5215111{(int(time.time())+3)%1000000:06d}"
        mongo_db.player_otps.delete_one({"telefono": tel})
        mongo_db.usuarios.delete_one({"telefono": tel})

        self._request_otp(api_client, "TEST OtpOK", tel)
        rec = mongo_db.player_otps.find_one({"telefono": tel})
        assert rec is not None
        codigo = rec["codigo"]

        r = api_client.post(
            f"{BASE_URL}/api/players/auth/otp/verify",
            json={"telefono": tel, "codigo": codigo},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        for k in ("access_token", "token_type", "jugador_id", "nombre", "telefono"):
            assert k in body, f"Missing key {k}"
        assert body["token_type"] == "bearer"
        assert body["telefono"] == tel

        # OTP debe haber sido eliminado
        assert mongo_db.player_otps.find_one({"telefono": tel}) is None

        # GET /me con el token
        h = {"Authorization": f"Bearer {body['access_token']}"}
        rm = api_client.get(f"{BASE_URL}/api/players/me", headers=h)
        assert rm.status_code == 200, rm.text
        me = rm.json()
        assert me["telefono"] == tel
        assert me["role"] == "player"
        assert me["jugador_id"] == body["jugador_id"]

        # cleanup
        mongo_db.usuarios.delete_one({"telefono": tel})

    def test_player_me_requires_auth_and_rejects_admin(self, api_client, auth_headers):
        r = api_client.get(f"{BASE_URL}/api/players/me")
        assert r.status_code == 401

        # Admin token (role=admin) → 403 en /players/me
        r2 = api_client.get(f"{BASE_URL}/api/players/me", headers=auth_headers)
        assert r2.status_code == 403, r2.text


# =====================================================================
# ============== 4) PLAYER HISTORY / STATS ============================
# =====================================================================
class TestPlayerHistoryStats:
    def _login_player(self, api_client, mongo_db, nombre, tel):
        api_client.post(
            f"{BASE_URL}/api/players/auth/otp/request",
            json={"nombre": nombre, "telefono": tel},
        )
        rec = mongo_db.player_otps.find_one({"telefono": tel})
        r = api_client.post(
            f"{BASE_URL}/api/players/auth/otp/verify",
            json={"telefono": tel, "codigo": rec["codigo"]},
        )
        assert r.status_code == 200, r.text
        return r.json()

    def test_player_inscripciones_only_own_phone(
        self, api_client, auth_headers, mongo_db,
    ):
        reta = _create_reta(api_client, auth_headers)
        try:
            tel_me = f"+5215133{int(time.time())%1000000:06d}"
            tel_other = f"+5215144{(int(time.time())+99)%1000000:06d}"
            mongo_db.usuarios.delete_one({"telefono": tel_me})
            mongo_db.usuarios.delete_one({"telefono": tel_other})

            # Otro jugador se inscribe
            _mock_checkout(api_client, reta["id"], "TEST Other Player", tel_other)

            # Yo me inscribo (mock pendiente)
            mine = _mock_checkout(api_client, reta["id"], "TEST Me Player", tel_me)

            # Login player
            session = self._login_player(api_client, mongo_db, "TEST Me Player", tel_me)
            h = {"Authorization": f"Bearer {session['access_token']}"}

            r = api_client.get(f"{BASE_URL}/api/players/me/inscripciones", headers=h)
            assert r.status_code == 200, r.text
            data = r.json()
            assert isinstance(data, list)
            # Debe estar la mía y NO la del otro
            ids = [d["id"] for d in data]
            assert mine["id"] in ids
            for d in data:
                # Cada item es del teléfono autenticado (no podemos chequear el
                # telefono directo aquí porque PlayerInscripcion no lo expone),
                # pero el reta_id debe coincidir con la reta donde inscribimos
                assert "reta_id" in d and "estatus_pago" in d
            # El otro no aparece (su ID no debería estar)
            other_insc = mongo_db.inscripciones.find_one({"telefono": tel_other})
            assert other_insc["id"] not in ids

            # cleanup
            mongo_db.usuarios.delete_one({"telefono": tel_me})
            mongo_db.usuarios.delete_one({"telefono": tel_other})
        finally:
            _delete_reta(api_client, auth_headers, reta["id"])

    def test_player_stats_returns_schema(self, api_client, mongo_db):
        tel = f"+5215122{int(time.time())%1000000:06d}"
        mongo_db.usuarios.delete_one({"telefono": tel})

        session = self._login_player(api_client, mongo_db, "TEST StatsP", tel)
        h = {"Authorization": f"Bearer {session['access_token']}"}

        r = api_client.get(f"{BASE_URL}/api/players/me/stats", headers=h)
        assert r.status_code == 200, r.text
        data = r.json()
        for k in ("jugador_id", "nombre", "partidos_jugados",
                  "partidos_ganados", "efectividad"):
            assert k in data, f"missing key {k}"
        assert data["partidos_jugados"] >= 0
        assert data["partidos_ganados"] >= 0
        assert 0.0 <= data["efectividad"] <= 100.0

        mongo_db.usuarios.delete_one({"telefono": tel})
