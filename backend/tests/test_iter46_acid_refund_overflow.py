"""ITER46 — ACID overflow guard + automatic refund + q-sanitization regression.

Cierra los casos `requires-external` reportados por iter45:

  A. _aplicar_resultado_pago (MP)  — overflow path → refundar_pago se invoca
                                     y tx queda como `refunded_overflow`.
  B. _aplicar_resultado_pago (Stripe) — mismo flujo, vía PaymentIntent + refund.
  C. _aplicar_resultado_pago (MP, happy path) — sin overflow → tx queda `approved`.
  D. core.transactions.safe_transaction → no-op en standalone Mongo (no rompe).
  E. routers/public.py::buscar — robustez ante NUL, control chars C0/C1,
     Unicode bidi overrides (U+202A-E / U+2066-9) y line separators (U+2028-9).

Estrategia: monkeypatch sobre `mercadopago_service.refundar_pago` y
`payments_stripe.refundar_pago` para NO golpear las APIs reales. Crea fixtures
limpias en MongoDB por test y las borra al final con un cleanup global.

Estos tests corren contra el motor real de MongoDB del pod (a través de
`core.db.db`) — NO requieren el servidor FastAPI corriendo.
"""
import asyncio
import os
import sys
import uuid
from datetime import datetime, timedelta, timezone

import pytest

# Garantiza que el backend root esté en sys.path para imports relativos.
BACKEND_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if BACKEND_ROOT not in sys.path:
    sys.path.insert(0, BACKEND_ROOT)

# Sentry desactivado para tests (evita ruido en stderr).
os.environ.setdefault("SENTRY_DSN", "")


@pytest.fixture
def event_loop():
    """Event loop por test (evita 'attached to a different loop' en motor)."""
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


def run(coro):
    """Helper: ejecuta una coroutine y devuelve su resultado."""
    return asyncio.get_event_loop().run_until_complete(coro)


# ============================================================================
# Fixtures: reta y tx de prueba, limpieza automática
# ============================================================================
TEST_RETA_PREFIX = "iter46-acid-test-"


@pytest.fixture
def fresh_reta(monkeypatch):
    """Crea una reta de prueba con `max_jugadores=4` y la borra al finalizar."""
    from core.db import db

    reta_id = f"{TEST_RETA_PREFIX}{uuid.uuid4()}"

    async def setup():
        await db.retas.insert_one({
            "id": reta_id,
            "nombre": f"ACID Test {reta_id[-6:]}",
            "url_slug": reta_id,
            "club": "Test Club",
            "fecha_evento": (datetime.now(timezone.utc) + timedelta(days=7)).isoformat(),
            "max_jugadores": 4,
            "costo_inscripcion": 100.0,
            "inscritos_lock": 0,
            "modalidad_registro": "individual",
            "organizador_id": "admin",
            "alertas_enviadas": False,
        })

    async def teardown():
        await db.retas.delete_many({"id": reta_id})
        await db.inscripciones.delete_many({"reta_id": reta_id})
        await db.mp_transactions.delete_many({"reta_id": reta_id})
        await db.stripe_transactions.delete_many({"reta_id": reta_id})
        await db.mp_refunds_emitidos.delete_many({
            "reason": {"$regex": reta_id},
        })
        await db.stripe_refunds_emitidos.delete_many({
            "reason": {"$regex": reta_id},
        })

    run(setup())
    yield reta_id
    run(teardown())


# ============================================================================
# CASO A — Mercado Pago: webhook approved sobre cupo perdido → refund auto
# ============================================================================
class TestMPOverflowRefund:
    def test_mp_approved_overflow_triggers_refund(self, fresh_reta, monkeypatch):
        """Escenario: TTL expiró la inscripción Pendiente; el cupo fue tomado por
        otros jugadores (4 Aprobados = reta llena). Llega webhook tardío con
        status=approved → debe disparar refundar_pago automáticamente."""
        from core.db import db
        from routers import mercadopago as mp_router

        reta_id = fresh_reta
        insc_id = f"insc-{uuid.uuid4()}"
        payment_id = f"mp-pay-{uuid.uuid4().hex[:10]}"

        # 1) Setup: 4 Aprobados (reta llena) + el insc original ya en Expirado.
        async def setup():
            for i in range(4):
                await db.inscripciones.insert_one({
                    "id": f"other-{i}-{uuid.uuid4()}",
                    "reta_id": reta_id,
                    "jugador_id": f"player-{i}",
                    "nombre": f"Other Player {i}",
                    "telefono": f"+52155500001{i:02d}",
                    "estatus_pago": "Aprobado",
                    "creado_en": datetime.now(timezone.utc).isoformat(),
                })
            await db.retas.update_one({"id": reta_id}, {"$set": {"inscritos_lock": 4}})
            # Inscripción original del jugador retrasado (Expirado por TTL).
            await db.inscripciones.insert_one({
                "id": insc_id,
                "reta_id": reta_id,
                "jugador_id": "delayed-player",
                "nombre": "Delayed Player",
                "telefono": "+5215555555555",
                "estatus_pago": "Expirado",
                "creado_en": datetime.now(timezone.utc).isoformat(),
            })
            await db.mp_transactions.insert_one({
                "id": insc_id,
                "inscripcion_id": insc_id,
                "reta_id": reta_id,
                "jugador_id": "delayed-player",
                "telefono": "+5215555555555",
                "amount": 100.0,
                "cupos_reservados": 1,
                "preference_id": f"pref-{uuid.uuid4().hex[:8]}",
                "payment_status": "initiated",
                "creado_en": datetime.now(timezone.utc).isoformat(),
            })
            # Admin con MP conectado (encriptado-friendly: claro funciona).
            await db.admins.update_one(
                {"email": "admin@padelappretas.com"},
                {"$set": {"access_token_pasarela": "TEST-MOCK-MP-TOKEN"}},
            )

        run(setup())

        # 2) Monkeypatch refundar_pago para NO golpear MP real.
        refund_calls = []

        async def fake_refundar(access_token, payment_id, amount=None, reason=None):
            refund_calls.append({
                "access_token": access_token,
                "payment_id": payment_id,
                "amount": amount,
                "reason": reason,
            })
            return {"id": f"refund-{uuid.uuid4().hex[:8]}", "status": "approved", "amount": 100.0}

        monkeypatch.setattr(mp_router.mps, "refundar_pago", fake_refundar)
        # decrypt_token devuelve el token tal cual cuando no empieza con "enc::".
        # Verificado en producción · no requiere mock extra.

        # 3) Disparar el handler.
        result = run(mp_router._aplicar_resultado_pago(insc_id, payment_id, "approved"))

        # 4) Aserciones críticas.
        assert result["matched"] is True
        assert result["estatus_pago"] == "RefundedOverflow", result
        assert result["afectadas"] == 0
        assert len(refund_calls) == 1, f"refundar_pago debió llamarse 1 vez · llamadas={refund_calls}"
        call = refund_calls[0]
        assert call["payment_id"] == payment_id
        assert reta_id in (call["reason"] or "")
        assert "ACID overflow guard" in (call["reason"] or "")

        # 5) Persistencia: tx marcada y audit-trail creado.
        async def check():
            tx = await db.mp_transactions.find_one({"inscripcion_id": insc_id}, {"_id": 0})
            assert tx["payment_status"] == "refunded_overflow"
            assert tx["mp_payment_id"] == payment_id
            assert tx["refund_result"]["ok"] is True
            refund_row = await db.mp_refunds_emitidos.find_one(
                {"mp_payment_id": payment_id}, {"_id": 0},
            )
            assert refund_row is not None
            assert refund_row["status"] == "approved"

        run(check())

    def test_mp_approved_happy_path_no_refund(self, fresh_reta, monkeypatch):
        """Escenario feliz: inscripción Pendiente intacta + cupos disponibles →
        flip a Aprobado SIN llamar refundar_pago."""
        from core.db import db
        from routers import mercadopago as mp_router

        reta_id = fresh_reta
        insc_id = f"insc-{uuid.uuid4()}"
        payment_id = f"mp-pay-{uuid.uuid4().hex[:10]}"

        async def setup():
            await db.inscripciones.insert_one({
                "id": insc_id,
                "reta_id": reta_id,
                "jugador_id": "happy-player",
                "nombre": "Happy Player",
                "telefono": "+5215511112222",
                "estatus_pago": "Pendiente",
                "bloqueado_hasta": (datetime.now(timezone.utc) + timedelta(minutes=10)).isoformat(),
                "creado_en": datetime.now(timezone.utc).isoformat(),
            })
            await db.retas.update_one({"id": reta_id}, {"$set": {"inscritos_lock": 1}})
            await db.mp_transactions.insert_one({
                "id": insc_id,
                "inscripcion_id": insc_id,
                "reta_id": reta_id,
                "jugador_id": "happy-player",
                "telefono": "+5215511112222",
                "amount": 100.0,
                "cupos_reservados": 1,
                "preference_id": f"pref-{uuid.uuid4().hex[:8]}",
                "payment_status": "initiated",
                "creado_en": datetime.now(timezone.utc).isoformat(),
            })

        run(setup())

        refund_calls = []

        async def fake_refundar(*args, **kwargs):
            refund_calls.append((args, kwargs))
            return {"id": "should-not-be-called"}

        monkeypatch.setattr(mp_router.mps, "refundar_pago", fake_refundar)

        result = run(mp_router._aplicar_resultado_pago(insc_id, payment_id, "approved"))

        assert result["matched"] is True
        assert result["estatus_pago"] == "Aprobado"
        assert result["afectadas"] == 1
        assert refund_calls == [], "refundar_pago NO debió llamarse en happy path"

        async def check():
            insc = await db.inscripciones.find_one({"id": insc_id}, {"_id": 0})
            assert insc["estatus_pago"] == "Aprobado"
            assert insc.get("bloqueado_hasta") is None
            tx = await db.mp_transactions.find_one({"inscripcion_id": insc_id}, {"_id": 0})
            assert tx["payment_status"] == "approved"
            assert tx["mp_payment_id"] == payment_id

        run(check())

    def test_mp_already_processed_is_idempotent(self, fresh_reta, monkeypatch):
        """Webhook duplicado tras refund_overflow → no-op (no doble refund)."""
        from core.db import db
        from routers import mercadopago as mp_router

        reta_id = fresh_reta
        insc_id = f"insc-{uuid.uuid4()}"

        async def setup():
            await db.mp_transactions.insert_one({
                "id": insc_id,
                "inscripcion_id": insc_id,
                "reta_id": reta_id,
                "jugador_id": "x",
                "telefono": "+5215511223344",
                "amount": 100.0,
                "cupos_reservados": 1,
                "preference_id": "pref-x",
                "payment_status": "refunded_overflow",  # ya procesado
                "creado_en": datetime.now(timezone.utc).isoformat(),
            })

        run(setup())

        refund_calls = []

        async def fake_refundar(*args, **kwargs):
            refund_calls.append((args, kwargs))
            return {"id": "x"}

        monkeypatch.setattr(mp_router.mps, "refundar_pago", fake_refundar)
        result = run(mp_router._aplicar_resultado_pago(insc_id, "pay-x", "approved"))

        assert result["matched"] is True
        assert result.get("already") is True
        assert result["payment_status"] == "refunded_overflow"
        assert refund_calls == []


# ============================================================================
# CASO B — Stripe: webhook paid sobre cupo perdido → refund auto
# ============================================================================
class TestStripeOverflowRefund:
    def test_stripe_paid_overflow_triggers_refund(self, fresh_reta, monkeypatch):
        from core.db import db
        from routers import payments_router as pay_router

        reta_id = fresh_reta
        insc_id = f"insc-{uuid.uuid4()}"
        session_id = f"cs_test_{uuid.uuid4().hex[:16]}"

        async def setup():
            for i in range(4):
                await db.inscripciones.insert_one({
                    "id": f"st-other-{i}-{uuid.uuid4()}",
                    "reta_id": reta_id,
                    "jugador_id": f"player-{i}",
                    "nombre": f"Other {i}",
                    "telefono": f"+5215522220{i:03d}",
                    "estatus_pago": "Aprobado",
                    "creado_en": datetime.now(timezone.utc).isoformat(),
                })
            await db.retas.update_one({"id": reta_id}, {"$set": {"inscritos_lock": 4}})
            await db.inscripciones.insert_one({
                "id": insc_id,
                "reta_id": reta_id,
                "jugador_id": "delayed-stripe",
                "nombre": "Delayed Stripe",
                "telefono": "+5215566778899",
                "estatus_pago": "Expirado",
                "creado_en": datetime.now(timezone.utc).isoformat(),
            })
            await db.stripe_transactions.insert_one({
                "session_id": session_id,
                "inscripcion_id": insc_id,
                "reta_id": reta_id,
                "jugador_id": "delayed-stripe",
                "telefono": "+5215566778899",
                "amount": 100.0,
                "currency": "mxn",
                "cupos_reservados": 1,
                "payment_status": "initiated",
                "creado_en": datetime.now(timezone.utc).isoformat(),
            })

        run(setup())

        # Monkeypatch del refund_stripe helper directamente (más limpio que mockear
        # el SDK de Stripe). Devuelve éxito simulado.
        async def fake_refund(*, session_id, reason):
            return {
                "ok": True,
                "id": f"re_test_{uuid.uuid4().hex[:8]}",
                "amount": 10000,
                "status": "succeeded",
                "_mock_reason": reason,
                "_mock_session": session_id,
            }

        monkeypatch.setattr(pay_router, "_refund_payment_stripe", fake_refund)

        result = run(pay_router._aplicar_resultado_pago(session_id, "paid"))

        assert result["matched"] is True
        assert result["estatus_pago"] == "RefundedOverflow", result
        assert result["afectadas"] == 0
        assert result["refund"]["ok"] is True
        assert result["refund"]["_mock_session"] == session_id
        assert "ACID overflow guard" in result["refund"]["_mock_reason"]

        async def check():
            tx = await db.stripe_transactions.find_one({"session_id": session_id}, {"_id": 0})
            assert tx["payment_status"] == "refunded_overflow"
            assert tx["refund_result"]["ok"] is True

        run(check())

    def test_stripe_paid_happy_path_no_refund(self, fresh_reta, monkeypatch):
        from core.db import db
        from routers import payments_router as pay_router

        reta_id = fresh_reta
        insc_id = f"insc-{uuid.uuid4()}"
        session_id = f"cs_test_happy_{uuid.uuid4().hex[:8]}"

        async def setup():
            await db.inscripciones.insert_one({
                "id": insc_id,
                "reta_id": reta_id,
                "jugador_id": "happy-stripe",
                "nombre": "Happy Stripe",
                "telefono": "+5215533334444",
                "estatus_pago": "Pendiente",
                "bloqueado_hasta": (datetime.now(timezone.utc) + timedelta(minutes=10)).isoformat(),
                "creado_en": datetime.now(timezone.utc).isoformat(),
            })
            await db.retas.update_one({"id": reta_id}, {"$set": {"inscritos_lock": 1}})
            await db.stripe_transactions.insert_one({
                "session_id": session_id,
                "inscripcion_id": insc_id,
                "reta_id": reta_id,
                "jugador_id": "happy-stripe",
                "telefono": "+5215533334444",
                "amount": 100.0,
                "currency": "mxn",
                "cupos_reservados": 1,
                "payment_status": "initiated",
                "creado_en": datetime.now(timezone.utc).isoformat(),
            })

        run(setup())

        refund_calls = []

        async def fake_refund(**kwargs):
            refund_calls.append(kwargs)
            return {"ok": True}

        monkeypatch.setattr(pay_router, "_refund_payment_stripe", fake_refund)
        result = run(pay_router._aplicar_resultado_pago(session_id, "paid"))

        assert result["matched"] is True
        assert result["estatus_pago"] == "Aprobado"
        assert result["afectadas"] == 1
        assert refund_calls == [], "_refund_payment_stripe NO debe llamarse en happy path"

        async def check():
            insc = await db.inscripciones.find_one({"id": insc_id}, {"_id": 0})
            assert insc["estatus_pago"] == "Aprobado"

        run(check())


# ============================================================================
# CASO D — Transactions: standalone Mongo → fallback grácil
# ============================================================================
class TestSafeTransactionFallback:
    def test_safe_transaction_yields_none_on_standalone(self):
        from core.transactions import safe_transaction, _detect_transactions_support

        # En el entorno del pod sabemos que es standalone.
        supports = run(_detect_transactions_support())
        assert supports is False

        async def use_it():
            async with safe_transaction() as session:
                return session

        session = run(use_it())
        assert session is None

    def test_safe_transaction_exception_propagates(self):
        from core.transactions import safe_transaction

        async def use_it():
            async with safe_transaction():
                raise ValueError("test-prop")

        with pytest.raises(ValueError, match="test-prop"):
            run(use_it())


# ============================================================================
# CASO E — public.py::buscar sanitización contra control chars
# ============================================================================
class TestPublicBuscarSanitization:
    """Tests HTTP contra el preview público. Si la URL no responde, skip."""

    BASE = os.environ.get(
        "EXPO_BACKEND_URL",
        "https://padel-tournament-hub-9.preview.emergentagent.com",
    ).rstrip("/")

    @pytest.fixture(scope="class")
    def api(self):
        import requests
        s = requests.Session()
        # Smoke test antes de correr — si no responde, skipea esta clase.
        try:
            r = s.get(f"{self.BASE}/api/", timeout=10)
            if r.status_code != 200:
                pytest.skip(f"Backend preview no responde: {r.status_code}")
        except Exception as e:
            pytest.skip(f"Backend preview inaccesible: {e}")
        return s

    @pytest.mark.parametrize("payload", [
        "test%00null",                  # NUL en medio
        "%00%00%00",                    # sólo NULs (queda string vacío)
        "%01%02%03test",                # C0 controls + texto
        "test%E2%80%A8sep",             # U+2028 LINE SEPARATOR
        "test%E2%80%A9sep",             # U+2029 PARAGRAPH SEPARATOR
        "test%E2%80%AAover",            # U+202A LRE bidi override
        "test%E2%81%A6iso",             # U+2066 LRI bidi isolate
        "%20%20%20",                    # sólo espacios
        "%5E%24%2E%2A%2B%3F",           # regex metacharacters
        "test%7F%C2%85",                # DEL + NEL (C1)
    ])
    def test_q_sanitization_returns_200(self, api, payload):
        r = api.get(f"{self.BASE}/api/public/retas/buscar?q={payload}", timeout=10)
        assert r.status_code == 200, f"payload={payload!r} → HTTP {r.status_code} body={r.text[:160]}"
        # JSON válido lista (vacía o no).
        data = r.json()
        assert isinstance(data, list)
