"""Stripe Checkout integration tests for PadelappRetas — covers checkout-stripe,
webhook idempotency, payment-status polling, admin manual expire, waitlist_count
semantics (notificado:false), and mock webhook retrocompatibility."""
import json
import time
import uuid

import pytest
import requests

from conftest import BASE_URL


# ============== HELPERS ==============
def _create_reta(api_client, auth_headers, **overrides):
    suffix = str(int(time.time() * 1000)) + str(uuid.uuid4())[:4]
    payload = {
        "nombre": f"TEST_StripeReta_{suffix}",
        "club": f"TEST_Club_{suffix}",
        "fecha_str": "2026-12-15",
        "hora_str": "18:00",
        "tz_offset_minutes": -360,
        "canchas_disponibles": 1,
        "costo_inscripcion": 250.0,
        "modalidad_juego": "PUNTOS",
        "num_rondas": 7,
        "observaciones_publicas": "TEST stripe",
        "latitud": 19.43,
        "longitud": -99.13,
    }
    payload.update(overrides)
    r = api_client.post(f"{BASE_URL}/api/retas", json=payload, headers=auth_headers)
    assert r.status_code == 200, f"Create reta failed: {r.status_code} {r.text}"
    return r.json()


def _delete_reta(api_client, auth_headers, reta_id):
    api_client.delete(f"{BASE_URL}/api/retas/{reta_id}", headers=auth_headers)


def _completed_event(session_id, event_id=None, payment_status="paid",
                     inscripcion_id="", reta_id="", jugador_id="", telefono=""):
    """Builds a Stripe-style checkout.session.completed payload that the
    emergent wrapper can parse (no signature, no webhook_secret in env)."""
    return {
        "id": event_id or f"evt_test_{uuid.uuid4().hex[:16]}",
        "type": "checkout.session.completed",
        "data": {
            "object": {
                "id": session_id,
                "payment_status": payment_status,
                "metadata": {
                    "inscripcion_id": inscripcion_id,
                    "reta_id": reta_id,
                    "jugador_id": jugador_id,
                    "telefono": telefono,
                },
            }
        },
    }


def _expired_event(session_id, event_id=None, inscripcion_id="", reta_id=""):
    return {
        "id": event_id or f"evt_test_{uuid.uuid4().hex[:16]}",
        "type": "checkout.session.expired",
        "data": {
            "object": {
                "id": session_id,
                "payment_status": "unpaid",
                "metadata": {"inscripcion_id": inscripcion_id, "reta_id": reta_id},
            }
        },
    }


def _post_stripe_webhook(api_client, event_dict):
    """Webhook needs raw bytes body; cannot use json= because requests sets
    content-type and serializes. We send raw."""
    return api_client.post(
        f"{BASE_URL}/api/webhooks/stripe",
        data=json.dumps(event_dict),
        headers={"Content-Type": "application/json"},
    )


# ============== CHECKOUT-STRIPE: HAPPY PATH ==============
class TestStripeCheckoutCreate:
    def test_checkout_stripe_creates_pendiente_and_returns_https_url(
        self, api_client, auth_headers
    ):
        reta = _create_reta(api_client, auth_headers, costo_inscripcion=150.0)
        try:
            r = api_client.post(
                f"{BASE_URL}/api/public/retas/{reta['id']}/checkout-stripe",
                json={
                    "nombre": "TEST_StripePayer",
                    "telefono": "+521TEST_SK10000001",
                },
                timeout=30,
            )
            assert r.status_code == 200, r.text
            data = r.json()
            assert "inscripcion_id" in data and "checkout_url" in data
            assert "session_id" in data
            assert data["checkout_url"].startswith("https://checkout.stripe.com"), (
                f"URL must be from Stripe domain, got: {data['checkout_url']}"
            )
            assert data["session_id"].startswith("cs_"), data["session_id"]

            # Verify inscription is Pendiente
            ins_list = api_client.get(
                f"{BASE_URL}/api/retas/{reta['id']}/inscripciones",
                headers=auth_headers,
            ).json()
            mine = [
                i for i in ins_list if i["id"] == data["inscripcion_id"]
            ]
            assert len(mine) == 1, ins_list
            assert mine[0]["estatus_pago"] == "Pendiente"
            assert mine[0]["bloqueado_hasta"] is not None
        finally:
            _delete_reta(api_client, auth_headers, reta["id"])

    def test_checkout_stripe_reta_inexistente_404(self, api_client):
        r = api_client.post(
            f"{BASE_URL}/api/public/retas/no-existe-xyz-{uuid.uuid4().hex[:6]}/checkout-stripe",
            json={"nombre": "TEST_X", "telefono": "+521TEST_NX1"},
        )
        assert r.status_code == 404, r.text

    def test_checkout_stripe_costo_menor_a_10_returns_400(
        self, api_client, auth_headers
    ):
        reta = _create_reta(api_client, auth_headers, costo_inscripcion=5.0)
        try:
            r = api_client.post(
                f"{BASE_URL}/api/public/retas/{reta['id']}/checkout-stripe",
                json={"nombre": "TEST_Low", "telefono": "+521TEST_LOW1"},
            )
            assert r.status_code == 400, r.text
        finally:
            _delete_reta(api_client, auth_headers, reta["id"])

    def test_checkout_stripe_full_reta_returns_409(
        self, api_client, auth_headers
    ):
        reta = _create_reta(
            api_client, auth_headers, canchas_disponibles=1,
            costo_inscripcion=120.0,
        )
        try:
            # Fill 8 spots via mock webhook (faster than Stripe)
            for i in range(8):
                r = api_client.post(
                    f"{BASE_URL}/api/public/retas/{reta['id']}/checkout",
                    json={
                        "reta_id": reta["id"],
                        "nombre": f"TEST_Filler_{i}",
                        "telefono": f"+521TEST_SF{i:06d}",
                    },
                )
                assert r.status_code == 200, r.text
                api_client.post(
                    f"{BASE_URL}/api/webhooks/payment",
                    json={"inscripcion_id": r.json()["id"], "status": "approved"},
                )
            # Now stripe checkout should 409
            r = api_client.post(
                f"{BASE_URL}/api/public/retas/{reta['id']}/checkout-stripe",
                json={"nombre": "TEST_Overflow", "telefono": "+521TEST_OVF"},
            )
            assert r.status_code == 409, r.text
        finally:
            _delete_reta(api_client, auth_headers, reta["id"])


# ============== STRIPE WEBHOOK: IDEMPOTENCY + EFFECTS ==============
class TestStripeWebhook:
    def test_webhook_paid_marks_inscripcion_aprobada(
        self, api_client, auth_headers
    ):
        reta = _create_reta(api_client, auth_headers, costo_inscripcion=200.0)
        try:
            r = api_client.post(
                f"{BASE_URL}/api/public/retas/{reta['id']}/checkout-stripe",
                json={"nombre": "TEST_WH1", "telefono": "+521TEST_WH10001"},
                timeout=30,
            )
            assert r.status_code == 200, r.text
            d = r.json()

            evt = _completed_event(
                session_id=d["session_id"],
                inscripcion_id=d["inscripcion_id"],
                reta_id=reta["id"],
            )
            w = _post_stripe_webhook(api_client, evt)
            assert w.status_code == 200, w.text
            wb = w.json()
            assert wb["ok"] is True
            assert wb.get("estatus_pago") == "Aprobado"

            # Verify DB state
            ins_list = api_client.get(
                f"{BASE_URL}/api/retas/{reta['id']}/inscripciones",
                headers=auth_headers,
            ).json()
            mine = [i for i in ins_list if i["id"] == d["inscripcion_id"]]
            assert len(mine) == 1
            assert mine[0]["estatus_pago"] == "Aprobado"
        finally:
            _delete_reta(api_client, auth_headers, reta["id"])

    def test_webhook_idempotent_by_event_id(self, api_client, auth_headers):
        """Same event_id sent twice does NOT duplicate side-effects."""
        reta = _create_reta(api_client, auth_headers, costo_inscripcion=200.0)
        try:
            r = api_client.post(
                f"{BASE_URL}/api/public/retas/{reta['id']}/checkout-stripe",
                json={"nombre": "TEST_Idem", "telefono": "+521TEST_IDEM01"},
                timeout=30,
            )
            d = r.json()
            event_id = f"evt_idem_{uuid.uuid4().hex[:10]}"
            evt = _completed_event(
                session_id=d["session_id"], event_id=event_id,
                inscripcion_id=d["inscripcion_id"], reta_id=reta["id"],
            )
            w1 = _post_stripe_webhook(api_client, evt)
            assert w1.status_code == 200
            w2 = _post_stripe_webhook(api_client, evt)
            assert w2.status_code == 200
            assert w2.json().get("duplicate") is True, w2.text

            # Inscription should remain a single Aprobado row
            ins_list = api_client.get(
                f"{BASE_URL}/api/retas/{reta['id']}/inscripciones",
                headers=auth_headers,
            ).json()
            mine = [i for i in ins_list if i["id"] == d["inscripcion_id"]]
            assert len(mine) == 1
            assert mine[0]["estatus_pago"] == "Aprobado"
        finally:
            _delete_reta(api_client, auth_headers, reta["id"])

    def test_webhook_expired_removes_and_promotes_waitlist(
        self, api_client, auth_headers
    ):
        reta = _create_reta(
            api_client, auth_headers, canchas_disponibles=1, costo_inscripcion=120.0,
        )
        try:
            # Fill 7 spots and 1 Stripe-pending = 8 occupied
            for i in range(7):
                r = api_client.post(
                    f"{BASE_URL}/api/public/retas/{reta['id']}/checkout",
                    json={"reta_id": reta["id"],
                          "nombre": f"TEST_FillEx_{i}",
                          "telefono": f"+521TEST_EX{i:06d}"},
                )
                api_client.post(
                    f"{BASE_URL}/api/webhooks/payment",
                    json={"inscripcion_id": r.json()["id"], "status": "approved"},
                )
            sk = api_client.post(
                f"{BASE_URL}/api/public/retas/{reta['id']}/checkout-stripe",
                json={"nombre": "TEST_Cancel", "telefono": "+521TEST_CN001"},
                timeout=30,
            )
            assert sk.status_code == 200, sk.text
            sd = sk.json()

            # Add 1 to waitlist
            wl = api_client.post(
                f"{BASE_URL}/api/public/retas/{reta['id']}/waitlist",
                json={"reta_id": reta["id"], "nombre": "TEST_WLProm",
                      "telefono": "+521TEST_WLP001"},
            )
            assert wl.status_code == 200

            # Send expired webhook for the Stripe inscription
            evt = _expired_event(
                session_id=sd["session_id"],
                inscripcion_id=sd["inscripcion_id"],
                reta_id=reta["id"],
            )
            w = _post_stripe_webhook(api_client, evt)
            assert w.status_code == 200, w.text

            # Inscription deleted
            ins_list = api_client.get(
                f"{BASE_URL}/api/retas/{reta['id']}/inscripciones",
                headers=auth_headers,
            ).json()
            assert not any(i["id"] == sd["inscripcion_id"] for i in ins_list), \
                "Cancelled stripe inscription should have been deleted"

            # Waitlister promoted to Pendiente
            promoted = [i for i in ins_list
                        if i["telefono"] == "+521TEST_WLP001"
                        and i["estatus_pago"] == "Pendiente"]
            assert len(promoted) == 1, ins_list
        finally:
            _delete_reta(api_client, auth_headers, reta["id"])

    def test_webhook_invalid_payload_returns_400(self, api_client):
        r = api_client.post(
            f"{BASE_URL}/api/webhooks/stripe",
            data="not-json-at-all{{{",
            headers={"Content-Type": "application/json"},
        )
        assert r.status_code == 400


# ============== PAYMENT-STATUS POLLING ==============
class TestPaymentStatus:
    def test_status_pendiente_after_checkout(self, api_client, auth_headers):
        reta = _create_reta(api_client, auth_headers, costo_inscripcion=180.0)
        try:
            r = api_client.post(
                f"{BASE_URL}/api/public/retas/{reta['id']}/checkout-stripe",
                json={"nombre": "TEST_PS1", "telefono": "+521TEST_PS00001"},
                timeout=30,
            )
            d = r.json()
            s = api_client.get(
                f"{BASE_URL}/api/public/inscripciones/{d['inscripcion_id']}/payment-status",
                timeout=30,
            )
            assert s.status_code == 200, s.text
            sd = s.json()
            assert sd["inscripcion_id"] == d["inscripcion_id"]
            # Stripe sandbox session unpaid yet — should remain Pendiente
            assert sd["estatus_pago"] in ("Pendiente", "Aprobado")
            assert sd["session_id"] == d["session_id"]
        finally:
            _delete_reta(api_client, auth_headers, reta["id"])

    def test_status_after_webhook_paid_returns_aprobado(
        self, api_client, auth_headers
    ):
        reta = _create_reta(api_client, auth_headers, costo_inscripcion=180.0)
        try:
            r = api_client.post(
                f"{BASE_URL}/api/public/retas/{reta['id']}/checkout-stripe",
                json={"nombre": "TEST_PS2", "telefono": "+521TEST_PS00002"},
                timeout=30,
            )
            d = r.json()
            evt = _completed_event(
                session_id=d["session_id"],
                inscripcion_id=d["inscripcion_id"],
                reta_id=reta["id"],
            )
            assert _post_stripe_webhook(api_client, evt).status_code == 200

            s = api_client.get(
                f"{BASE_URL}/api/public/inscripciones/{d['inscripcion_id']}/payment-status",
                timeout=30,
            )
            assert s.status_code == 200
            assert s.json()["estatus_pago"] == "Aprobado"
        finally:
            _delete_reta(api_client, auth_headers, reta["id"])

    def test_status_inscripcion_inexistente_404(self, api_client):
        r = api_client.get(
            f"{BASE_URL}/api/public/inscripciones/no-existe-xyz-{uuid.uuid4().hex[:6]}/payment-status"
        )
        assert r.status_code == 404


# ============== WAITLIST_COUNT semantics (notificado:false) ==============
class TestWaitlistCount:
    def test_waitlist_count_decreases_after_promotion(
        self, api_client, auth_headers
    ):
        reta = _create_reta(
            api_client, auth_headers, canchas_disponibles=1, costo_inscripcion=110.0,
        )
        try:
            # Fill 8 -> ROJO
            ids = []
            for i in range(8):
                r = api_client.post(
                    f"{BASE_URL}/api/public/retas/{reta['id']}/checkout",
                    json={"reta_id": reta["id"],
                          "nombre": f"TEST_WC_{i}",
                          "telefono": f"+521TEST_WC{i:06d}"},
                )
                ids.append(r.json()["id"])
                api_client.post(
                    f"{BASE_URL}/api/webhooks/payment",
                    json={"inscripcion_id": r.json()["id"], "status": "approved"},
                )

            # Add 3 to waitlist
            for i in range(3):
                api_client.post(
                    f"{BASE_URL}/api/public/retas/{reta['id']}/waitlist",
                    json={"reta_id": reta["id"],
                          "nombre": f"TEST_WLCount_{i}",
                          "telefono": f"+521TEST_WLC{i:06d}"},
                )

            # Verify count == 3 (none notificado yet)
            detail = api_client.get(
                f"{BASE_URL}/api/retas/{reta['id']}", headers=auth_headers,
            ).json()
            assert detail["waitlist_count"] == 3, detail

            # Cancel 1 approved -> promotes pos 1 -> notificado:true
            api_client.post(
                f"{BASE_URL}/api/webhooks/payment",
                json={"inscripcion_id": ids[0], "status": "failed"},
            )

            detail2 = api_client.get(
                f"{BASE_URL}/api/retas/{reta['id']}", headers=auth_headers,
            ).json()
            assert detail2["waitlist_count"] == 2, (
                f"Expected 2 after promotion, got {detail2['waitlist_count']}"
            )
        finally:
            _delete_reta(api_client, auth_headers, reta["id"])


# ============== ADMIN: expirar-pendientes ==============
class TestAdminExpirar:
    def test_expirar_pendientes_elimina_y_promueve(self, api_client, auth_headers):
        reta = _create_reta(
            api_client, auth_headers, canchas_disponibles=1, costo_inscripcion=110.0,
        )
        try:
            # 5 approved + 3 pending = 8 ocupados
            for i in range(5):
                r = api_client.post(
                    f"{BASE_URL}/api/public/retas/{reta['id']}/checkout",
                    json={"reta_id": reta["id"],
                          "nombre": f"TEST_EX_A_{i}",
                          "telefono": f"+521TEST_EXA{i:06d}"},
                )
                api_client.post(
                    f"{BASE_URL}/api/webhooks/payment",
                    json={"inscripcion_id": r.json()["id"], "status": "approved"},
                )
            for i in range(3):
                api_client.post(
                    f"{BASE_URL}/api/public/retas/{reta['id']}/checkout",
                    json={"reta_id": reta["id"],
                          "nombre": f"TEST_EX_P_{i}",
                          "telefono": f"+521TEST_EXP{i:06d}"},
                )
            # Add 1 to waitlist
            api_client.post(
                f"{BASE_URL}/api/public/retas/{reta['id']}/waitlist",
                json={"reta_id": reta["id"], "nombre": "TEST_EX_WL",
                      "telefono": "+521TEST_EXWL01"},
            )

            r = api_client.post(
                f"{BASE_URL}/api/retas/{reta['id']}/expirar-pendientes",
                headers=auth_headers,
            )
            assert r.status_code == 200, r.text
            data = r.json()
            assert data["ok"] is True
            assert data["eliminadas"] >= 3
            assert data["promovidos"] >= 1
            assert reta["id"] in data["retas_afectadas"]

            # Verify pendientes gone except possibly the newly-promoted one
            ins_list = api_client.get(
                f"{BASE_URL}/api/retas/{reta['id']}/inscripciones",
                headers=auth_headers,
            ).json()
            pendientes = [i for i in ins_list if i["estatus_pago"] == "Pendiente"]
            # Only the promoted waitlister should remain Pendiente
            assert len(pendientes) == 1
            assert pendientes[0]["telefono"] == "+521TEST_EXWL01"
        finally:
            _delete_reta(api_client, auth_headers, reta["id"])

    def test_expirar_pendientes_requires_auth(self, api_client):
        r = api_client.post(
            f"{BASE_URL}/api/retas/anything/expirar-pendientes"
        )
        assert r.status_code in (401, 403)

    def test_expirar_pendientes_reta_inexistente_404(self, api_client, auth_headers):
        r = api_client.post(
            f"{BASE_URL}/api/retas/no-existe-xxx/expirar-pendientes",
            headers=auth_headers,
        )
        assert r.status_code == 404


# ============== MOCK WEBHOOK BACK-COMPAT ==============
class TestMockWebhookRetrocompat:
    def test_mock_webhook_approved_still_works(self, api_client, auth_headers):
        reta = _create_reta(api_client, auth_headers, costo_inscripcion=150.0)
        try:
            r = api_client.post(
                f"{BASE_URL}/api/public/retas/{reta['id']}/checkout",
                json={"reta_id": reta["id"], "nombre": "TEST_Mock1",
                      "telefono": "+521TEST_MOCK1"},
            )
            assert r.status_code == 200
            ins_id = r.json()["id"]
            w = api_client.post(
                f"{BASE_URL}/api/webhooks/payment",
                json={"inscripcion_id": ins_id, "status": "approved"},
            )
            assert w.status_code == 200
            assert w.json()["status"] == "Aprobado"
        finally:
            _delete_reta(api_client, auth_headers, reta["id"])

    def test_mock_webhook_failed_promotes(self, api_client, auth_headers):
        reta = _create_reta(
            api_client, auth_headers, canchas_disponibles=1, costo_inscripcion=150.0,
        )
        try:
            for i in range(8):
                r = api_client.post(
                    f"{BASE_URL}/api/public/retas/{reta['id']}/checkout",
                    json={"reta_id": reta["id"],
                          "nombre": f"TEST_MFill_{i}",
                          "telefono": f"+521TEST_MF{i:06d}"},
                )
                api_client.post(
                    f"{BASE_URL}/api/webhooks/payment",
                    json={"inscripcion_id": r.json()["id"], "status": "approved"},
                )
            api_client.post(
                f"{BASE_URL}/api/public/retas/{reta['id']}/waitlist",
                json={"reta_id": reta["id"], "nombre": "TEST_MWL",
                      "telefono": "+521TEST_MWL01"},
            )
            # Get inscriptions and fail one
            ins_list = api_client.get(
                f"{BASE_URL}/api/retas/{reta['id']}/inscripciones",
                headers=auth_headers,
            ).json()
            target = [i for i in ins_list if i["telefono"] == "+521TEST_MF000000"][0]
            w = api_client.post(
                f"{BASE_URL}/api/webhooks/payment",
                json={"inscripcion_id": target["id"], "status": "failed"},
            )
            assert w.status_code == 200
            assert w.json().get("promoted") is True
        finally:
            _delete_reta(api_client, auth_headers, reta["id"])
