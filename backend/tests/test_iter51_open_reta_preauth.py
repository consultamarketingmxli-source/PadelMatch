"""ITER51 — Open Reta Pre-authorization workflow tests.

Cubre los 3 endpoints nuevos + el job handler auto-expire, usando el patrón
unit-level (mock de `mercadopago_service` + motor real via `conftest.py`).

Casos:
  1.  `hold_funds` construye body correcto con `capture=False` (mock httpx).
  2.  `capture_funds` envía PUT con `capture=True` + idempotency.
  3.  `cancel_hold` envía PUT con `status="cancelled"`.
  4.  `cancel_hold` es idempotente cuando MP responde 400 "cannot_cancel".
  5.  `crear_join_request` happy path → persiste + encola auto_expire.
  6.  `crear_join_request` 409 si ya existe un pending para (player, match).
  7.  `crear_join_request` 402 si la tarjeta fue rechazada por MP.
  8.  `crear_join_request` 404 si la reta no existe.
  9.  `decidir_join_request` approve → captura + crea inscripción.
  10. `decidir_join_request` approve · reta llena → cancel_hold + 409.
  11. `decidir_join_request` approve · capture falla → liberar_lugar + failed.
  12. `decidir_join_request` reject → cancel_hold + email + status=rejected.
  13. `decidir_join_request` idempotente si status != pending_approval.
  14. `handle_join_request_auto_expire` cancela hold + marca expired.
  15. `handle_join_request_auto_expire` es no-op si request ya decidido.
  16. `handle_join_request_auto_expire` marca expired sin llamar MP si reta borrada.
"""
from __future__ import annotations

import asyncio
import os
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest
from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))
load_dotenv(BACKEND_DIR / ".env")

import mercadopago_service as mps  # noqa: E402
from core.crypto import encrypt_token  # noqa: E402
from core.db import db  # noqa: E402
from fastapi import HTTPException  # noqa: E402
from routers import join_requests as jr  # noqa: E402


# ═══════════════════════════════ Helpers ═══════════════════════════════
def _run(coro):
    """Ejecuta corutina en el loop activo (o crea uno)."""
    try:
        loop = asyncio.get_event_loop()
        if loop.is_closed():
            raise RuntimeError("closed")
    except RuntimeError:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
    return loop.run_until_complete(coro)


async def _mk_reta(match_id: str, organizador_id: str, max_jug: int = 4, open_reta: bool = True) -> None:
    """Inserta una reta mínima para los tests.

    `open_reta` default True porque casi todos los casos verifican el flujo
    Open Reta feliz. Los tests que validan el gate lo pasan explicitamente
    en False.
    """
    fecha = (datetime.now(timezone.utc) + timedelta(days=3)).isoformat()
    await db.retas.insert_one({
        "id": match_id,
        "nombre": "Reta Test Iter51",
        "organizador_id": organizador_id,
        "max_jugadores": max_jug,
        "inscritos_lock": 0,
        "costo_inscripcion": 100.0,
        "fecha_evento": fecha,
        "status_public": "open",
        "url_slug": f"reta-{match_id[:6]}",
        "open_reta_habilitado": open_reta,
    })


async def _mk_admin(admin_id: str) -> None:
    """Inserta un admin con token MP encriptado."""
    await db.admins.insert_one({
        "id": admin_id,
        "email": f"admin-{admin_id[:6]}@test.com",
        "access_token_pasarela": encrypt_token("TEST-MP-TOKEN"),
    })


async def _cleanup(match_id: str, admin_id: str) -> None:
    await db.retas.delete_many({"id": match_id})
    await db.admins.delete_many({"id": admin_id})
    await db.join_requests.delete_many({"match_id": match_id})
    await db.inscripciones.delete_many({"reta_id": match_id})
    await db.jobs_queue.delete_many({"payload.request_id": {"$exists": True}})


# ═══════════════════════════ MP service tests ═══════════════════════════
class _FakeResp:
    def __init__(self, status_code: int, json_data: dict, text: str = ""):
        self.status_code = status_code
        self._json = json_data
        self.text = text or str(json_data)

    def json(self):
        return self._json


class _FakeAsyncClient:
    def __init__(self, *_, **__):
        self.calls = []
        self._response = None

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_):
        return False

    def _record(self, method, url, headers, json):
        self.calls.append({"method": method, "url": url, "headers": headers, "json": json})

    async def post(self, url, headers=None, json=None):
        self._record("POST", url, headers, json)
        return self._response

    async def put(self, url, headers=None, json=None):
        self._record("PUT", url, headers, json)
        return self._response


def test_1_hold_funds_capture_false_body():
    """hold_funds envía capture=False + idempotency-key."""
    fake_client = _FakeAsyncClient()
    fake_client._response = _FakeResp(
        201, {"id": "PAY-1", "status": "authorized", "status_detail": "accredited"}
    )
    with patch.object(httpx, "AsyncClient", return_value=fake_client):
        res = _run(mps.hold_funds(
            access_token="TEST-TOKEN",
            amount=100.0,
            card_token="CARDTOK123",
            payer_email="player@test.com",
            installments=1,
            payment_method_id="visa",
            idempotency_key="hold-abc",
            metadata={"match_id": "M1", "player_id": "P1"},
        ))
    assert res["id"] == "PAY-1"
    assert res["status"] == "authorized"
    call = fake_client.calls[0]
    assert call["json"]["capture"] is False
    assert call["json"]["transaction_amount"] == 100.0
    assert call["json"]["token"] == "CARDTOK123"
    assert call["json"]["payment_method_id"] == "visa"
    assert call["headers"]["X-Idempotency-Key"] == "hold-abc"
    assert call["headers"]["Authorization"] == "Bearer TEST-TOKEN"


def test_2_capture_funds_puts_capture_true():
    """capture_funds usa PUT con capture=True + idempotency."""
    fake_client = _FakeAsyncClient()
    fake_client._response = _FakeResp(
        200, {"id": "PAY-1", "status": "approved", "status_detail": "accredited"}
    )
    with patch.object(httpx, "AsyncClient", return_value=fake_client):
        res = _run(mps.capture_funds(access_token="TT", payment_id="PAY-1"))
    assert res["status"] == "approved"
    call = fake_client.calls[0]
    assert call["method"] == "PUT"
    assert call["json"] == {"capture": True}
    assert "/v1/payments/PAY-1" in call["url"]
    assert call["headers"]["X-Idempotency-Key"] == "capture-PAY-1"


def test_3_cancel_hold_puts_status_cancelled():
    fake_client = _FakeAsyncClient()
    fake_client._response = _FakeResp(200, {"id": "PAY-1", "status": "cancelled"})
    with patch.object(httpx, "AsyncClient", return_value=fake_client):
        res = _run(mps.cancel_hold(access_token="TT", payment_id="PAY-1"))
    assert res["status"] == "cancelled"
    call = fake_client.calls[0]
    assert call["json"] == {"status": "cancelled"}
    assert call["headers"]["X-Idempotency-Key"] == "cancel-PAY-1"


def test_4_cancel_hold_idempotent_on_400_cannot():
    """MP responde 400 'cannot_cancel' cuando ya está cancelled → tratamos como OK."""
    fake_client = _FakeAsyncClient()
    fake_client._response = _FakeResp(
        400, {"error": "bad_request"}, text='{"message":"cannot_cancel_payment"}'
    )
    with patch.object(httpx, "AsyncClient", return_value=fake_client):
        res = _run(mps.cancel_hold(access_token="TT", payment_id="PAY-1"))
    assert res["status"] == "cancelled"
    assert res.get("idempotent") is True


# ═══════════════════════════ crear_join_request ═══════════════════════════
def test_5_crear_join_request_happy_path():
    match_id = f"m-{uuid.uuid4().hex[:8]}"
    admin_id = f"a-{uuid.uuid4().hex[:8]}"
    player_id = f"p-{uuid.uuid4().hex[:8]}"

    async def scenario():
        await _mk_reta(match_id, admin_id)
        await _mk_admin(admin_id)
        with patch.object(mps, "hold_funds", new_callable=AsyncMock) as mock_hold, \
             patch.object(jr, "enqueue", new_callable=AsyncMock) as mock_enq:
            mock_hold.return_value = {
                "id": "PAY-42", "status": "authorized", "status_detail": "accredited",
            }
            body = jr.JoinRequestCreate(
                match_id=match_id, player_id=player_id, amount=100.0,
                card_token="TOK-abcdef", payer_email="p@test.com",
            )
            out = await jr.crear_join_request(body)
        assert out.status == "pending_approval"
        assert out.payment_id == "PAY-42"
        doc = await db.join_requests.find_one({"id": out.id}, {"_id": 0})
        assert doc["status"] == "pending_approval"
        assert doc["payment_id"] == "PAY-42"
        # enqueue del auto-expire se llamó una vez
        assert mock_enq.call_count == 1
        assert mock_enq.call_args.kwargs["job_type"] == jr.JOB_AUTO_EXPIRE

    try:
        _run(scenario())
    finally:
        _run(_cleanup(match_id, admin_id))


def test_6_crear_join_request_duplicate_returns_409():
    match_id = f"m-{uuid.uuid4().hex[:8]}"
    admin_id = f"a-{uuid.uuid4().hex[:8]}"
    player_id = f"p-{uuid.uuid4().hex[:8]}"

    async def scenario():
        await _mk_reta(match_id, admin_id)
        await _mk_admin(admin_id)
        # Insertar un pending previo.
        await db.join_requests.insert_one({
            "id": str(uuid.uuid4()), "match_id": match_id, "player_id": player_id,
            "payment_id": "PAY-existing", "status": "pending_approval",
            "amount": 100.0, "payer_email": "p@test.com",
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        with patch.object(mps, "hold_funds", new_callable=AsyncMock) as mock_hold:
            body = jr.JoinRequestCreate(
                match_id=match_id, player_id=player_id, amount=100.0,
                card_token="TOK-abcdef", payer_email="p@test.com",
            )
            with pytest.raises(HTTPException) as exc:
                await jr.crear_join_request(body)
            assert exc.value.status_code == 409
            mock_hold.assert_not_called()  # No debe haber tocado MP

    try:
        _run(scenario())
    finally:
        _run(_cleanup(match_id, admin_id))


def test_7_crear_join_request_402_when_card_rejected():
    match_id = f"m-{uuid.uuid4().hex[:8]}"
    admin_id = f"a-{uuid.uuid4().hex[:8]}"
    player_id = f"p-{uuid.uuid4().hex[:8]}"

    async def scenario():
        await _mk_reta(match_id, admin_id)
        await _mk_admin(admin_id)
        with patch.object(mps, "hold_funds", new_callable=AsyncMock) as mock_hold:
            mock_hold.return_value = {
                "id": "PAY-X", "status": "rejected", "status_detail": "cc_rejected_insufficient_amount",
            }
            body = jr.JoinRequestCreate(
                match_id=match_id, player_id=player_id, amount=100.0,
                card_token="TOK-abcdef", payer_email="p@test.com",
            )
            with pytest.raises(HTTPException) as exc:
                await jr.crear_join_request(body)
            assert exc.value.status_code == 402
        # No debe haberse persistido nada.
        doc = await db.join_requests.find_one({"match_id": match_id})
        assert doc is None

    try:
        _run(scenario())
    finally:
        _run(_cleanup(match_id, admin_id))


def test_8_crear_join_request_404_reta_missing():
    async def scenario():
        body = jr.JoinRequestCreate(
            match_id="does-not-exist-xxx", player_id="p1", amount=50.0,
            card_token="TOK-abcdef", payer_email="p@test.com",
        )
        with pytest.raises(HTTPException) as exc:
            await jr.crear_join_request(body)
        assert exc.value.status_code == 404

    _run(scenario())


def test_8b_crear_join_request_403_when_open_reta_disabled():
    """Iter51-P2 · gate: si `open_reta_habilitado` es False → 403 antes de MP."""
    match_id = f"m-{uuid.uuid4().hex[:8]}"
    admin_id = f"a-{uuid.uuid4().hex[:8]}"
    player_id = f"p-{uuid.uuid4().hex[:8]}"

    async def scenario():
        # Reta con open_reta_habilitado=False → no acepta solicitudes.
        await _mk_reta(match_id, admin_id, open_reta=False)
        await _mk_admin(admin_id)
        with patch.object(mps, "hold_funds", new_callable=AsyncMock) as mock_hold:
            body = jr.JoinRequestCreate(
                match_id=match_id, player_id=player_id, amount=100.0,
                card_token="TOK-abcdef", payer_email="p@test.com",
            )
            with pytest.raises(HTTPException) as exc:
                await jr.crear_join_request(body)
            assert exc.value.status_code == 403
            assert "solicitudes" in exc.value.detail.lower()
            mock_hold.assert_not_called()  # NUNCA toca MP si el gate falla
        # Nada persistido en DB.
        doc = await db.join_requests.find_one({"match_id": match_id})
        assert doc is None

    try:
        _run(scenario())
    finally:
        _run(_cleanup(match_id, admin_id))


# ═══════════════════════════ decidir_join_request ═══════════════════════════
def test_9_decidir_approve_captures_and_creates_inscripcion():
    match_id = f"m-{uuid.uuid4().hex[:8]}"
    admin_id = f"a-{uuid.uuid4().hex[:8]}"
    player_id = f"p-{uuid.uuid4().hex[:8]}"
    req_id = str(uuid.uuid4())

    async def scenario():
        await _mk_reta(match_id, admin_id, max_jug=4)
        await _mk_admin(admin_id)
        await db.join_requests.insert_one({
            "id": req_id, "match_id": match_id, "player_id": player_id,
            "payment_id": "PAY-approve-1", "status": "pending_approval",
            "amount": 100.0, "payer_email": "p@test.com",
            "created_at": datetime.now(timezone.utc).isoformat(),
        })

        with patch.object(mps, "capture_funds", new_callable=AsyncMock) as mock_cap, \
             patch.object(jr, "email_service", MagicMock()) as mock_email, \
             patch.object(jr, "push_service", MagicMock()) as mock_push:
            mock_cap.return_value = {"id": "PAY-approve-1", "status": "approved"}
            mock_email.send_join_request_approved = AsyncMock(return_value=True)
            mock_push.send_high_priority_push = AsyncMock(return_value=True)

            body = jr.DecideRequestBody(request_id=req_id, action="approve")
            res = await jr.decidir_join_request(body, current={"sub": admin_id, "role": "admin"})

        assert res["success"] is True
        assert res["status"] == "approved"
        assert "inscripcion_id" in res
        doc = await db.join_requests.find_one({"id": req_id}, {"_id": 0})
        assert doc["status"] == "approved"
        assert "decided_at" in doc
        insc = await db.inscripciones.find_one({"reta_id": match_id}, {"_id": 0})
        assert insc is not None
        assert insc["tipo_inscripcion"] == "DIRECTA_APP"
        # inscritos_lock incrementado
        reta = await db.retas.find_one({"id": match_id}, {"_id": 0})
        assert reta["inscritos_lock"] == 1

    try:
        _run(scenario())
    finally:
        _run(_cleanup(match_id, admin_id))


def test_10_decidir_approve_reta_llena_rollback():
    match_id = f"m-{uuid.uuid4().hex[:8]}"
    admin_id = f"a-{uuid.uuid4().hex[:8]}"
    player_id = f"p-{uuid.uuid4().hex[:8]}"
    req_id = str(uuid.uuid4())

    async def scenario():
        # Reta max_jugadores=1 pero ya lock=1 → llena.
        await _mk_reta(match_id, admin_id, max_jug=1)
        await db.retas.update_one({"id": match_id}, {"$set": {"inscritos_lock": 1}})
        await _mk_admin(admin_id)
        await db.join_requests.insert_one({
            "id": req_id, "match_id": match_id, "player_id": player_id,
            "payment_id": "PAY-full", "status": "pending_approval",
            "amount": 100.0, "payer_email": "p@test.com",
            "created_at": datetime.now(timezone.utc).isoformat(),
        })

        with patch.object(mps, "cancel_hold", new_callable=AsyncMock) as mock_cancel, \
             patch.object(mps, "capture_funds", new_callable=AsyncMock) as mock_cap:
            mock_cancel.return_value = {"status": "cancelled"}
            body = jr.DecideRequestBody(request_id=req_id, action="approve")
            with pytest.raises(HTTPException) as exc:
                await jr.decidir_join_request(body, current={"sub": admin_id, "role": "admin"})
            assert exc.value.status_code == 409
            mock_cancel.assert_awaited_once()
            mock_cap.assert_not_called()

        doc = await db.join_requests.find_one({"id": req_id}, {"_id": 0})
        assert doc["status"] == "rejected"
        assert "reta_llena" in doc["decision_reason"]

    try:
        _run(scenario())
    finally:
        _run(_cleanup(match_id, admin_id))


def test_11_decidir_approve_capture_fails_rollback_lugar():
    match_id = f"m-{uuid.uuid4().hex[:8]}"
    admin_id = f"a-{uuid.uuid4().hex[:8]}"
    player_id = f"p-{uuid.uuid4().hex[:8]}"
    req_id = str(uuid.uuid4())

    async def scenario():
        await _mk_reta(match_id, admin_id, max_jug=4)
        await _mk_admin(admin_id)
        await db.join_requests.insert_one({
            "id": req_id, "match_id": match_id, "player_id": player_id,
            "payment_id": "PAY-cap-fail", "status": "pending_approval",
            "amount": 100.0, "payer_email": "p@test.com",
            "created_at": datetime.now(timezone.utc).isoformat(),
        })

        with patch.object(mps, "capture_funds", new_callable=AsyncMock) as mock_cap:
            mock_cap.side_effect = RuntimeError("MP 502 Timeout")
            body = jr.DecideRequestBody(request_id=req_id, action="approve")
            with pytest.raises(HTTPException) as exc:
                await jr.decidir_join_request(body, current={"sub": admin_id, "role": "admin"})
            assert exc.value.status_code == 502

        doc = await db.join_requests.find_one({"id": req_id}, {"_id": 0})
        assert doc["status"] == "failed"
        assert "capture_failed" in doc["decision_reason"]
        # inscritos_lock debe estar de vuelta a 0 (rollback).
        reta = await db.retas.find_one({"id": match_id}, {"_id": 0})
        assert reta["inscritos_lock"] == 0

    try:
        _run(scenario())
    finally:
        _run(_cleanup(match_id, admin_id))


def test_12_decidir_reject_cancels_hold_and_marks_rejected():
    match_id = f"m-{uuid.uuid4().hex[:8]}"
    admin_id = f"a-{uuid.uuid4().hex[:8]}"
    player_id = f"p-{uuid.uuid4().hex[:8]}"
    req_id = str(uuid.uuid4())

    async def scenario():
        await _mk_reta(match_id, admin_id)
        await _mk_admin(admin_id)
        await db.join_requests.insert_one({
            "id": req_id, "match_id": match_id, "player_id": player_id,
            "payment_id": "PAY-reject", "status": "pending_approval",
            "amount": 100.0, "payer_email": "p@test.com",
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        with patch.object(mps, "cancel_hold", new_callable=AsyncMock) as mock_cancel, \
             patch.object(jr, "email_service", MagicMock()) as mock_email:
            mock_cancel.return_value = {"status": "cancelled"}
            mock_email.send_join_request_rejected = AsyncMock(return_value=True)
            body = jr.DecideRequestBody(
                request_id=req_id, action="reject", motivo="No cumple nivel",
            )
            res = await jr.decidir_join_request(body, current={"sub": admin_id, "role": "admin"})
        assert res["status"] == "rejected"
        doc = await db.join_requests.find_one({"id": req_id}, {"_id": 0})
        assert doc["status"] == "rejected"
        assert doc["decision_reason"] == "No cumple nivel"

    try:
        _run(scenario())
    finally:
        _run(_cleanup(match_id, admin_id))


def test_13_decidir_idempotent_already_approved():
    match_id = f"m-{uuid.uuid4().hex[:8]}"
    admin_id = f"a-{uuid.uuid4().hex[:8]}"
    req_id = str(uuid.uuid4())

    async def scenario():
        await _mk_reta(match_id, admin_id)
        await _mk_admin(admin_id)
        await db.join_requests.insert_one({
            "id": req_id, "match_id": match_id, "player_id": "p1",
            "payment_id": "PAY-done", "status": "approved",
            "amount": 100.0, "payer_email": "p@test.com",
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        with patch.object(mps, "capture_funds", new_callable=AsyncMock) as mock_cap:
            body = jr.DecideRequestBody(request_id=req_id, action="approve")
            res = await jr.decidir_join_request(body, current={"sub": admin_id, "role": "admin"})
            assert res["already_processed"] is True
            assert res["status"] == "approved"
            mock_cap.assert_not_called()  # no debe re-capturar

    try:
        _run(scenario())
    finally:
        _run(_cleanup(match_id, admin_id))


def test_13b_decidir_403_when_not_organizer():
    """SECURITY: admin autenticado ≠ organizador dueño → 403 antes de tocar MP."""
    match_id = f"m-{uuid.uuid4().hex[:8]}"
    owner_id = f"a-{uuid.uuid4().hex[:8]}"
    other_admin_id = f"a-{uuid.uuid4().hex[:8]}"
    req_id = str(uuid.uuid4())

    async def scenario():
        await _mk_reta(match_id, owner_id)  # reta pertenece a owner_id
        await _mk_admin(owner_id)
        await db.join_requests.insert_one({
            "id": req_id, "match_id": match_id, "player_id": "p1",
            "payment_id": "PAY-403", "status": "pending_approval",
            "amount": 100.0, "payer_email": "p@test.com",
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        with patch.object(mps, "capture_funds", new_callable=AsyncMock) as mock_cap, \
             patch.object(mps, "cancel_hold", new_callable=AsyncMock) as mock_cancel:
            body = jr.DecideRequestBody(request_id=req_id, action="approve")
            with pytest.raises(HTTPException) as exc:
                # other_admin_id intenta aprobar una reta ajena
                await jr.decidir_join_request(body, current={"sub": other_admin_id, "role": "admin"})
            assert exc.value.status_code == 403
            mock_cap.assert_not_called()
            mock_cancel.assert_not_called()
        # request debe seguir en pending_approval — sin cambios.
        doc = await db.join_requests.find_one({"id": req_id}, {"_id": 0})
        assert doc["status"] == "pending_approval"

    try:
        _run(scenario())
    finally:
        _run(_cleanup(match_id, owner_id))


# ══════════════════════ handle_join_request_auto_expire ══════════════════════
def test_14_auto_expire_cancels_and_marks_expired():
    match_id = f"m-{uuid.uuid4().hex[:8]}"
    admin_id = f"a-{uuid.uuid4().hex[:8]}"
    req_id = str(uuid.uuid4())

    async def scenario():
        await _mk_reta(match_id, admin_id)
        await _mk_admin(admin_id)
        await db.join_requests.insert_one({
            "id": req_id, "match_id": match_id, "player_id": "p1",
            "payment_id": "PAY-expire", "status": "pending_approval",
            "amount": 100.0, "payer_email": "p@test.com",
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        with patch.object(mps, "cancel_hold", new_callable=AsyncMock) as mock_cancel, \
             patch.object(jr, "email_service", MagicMock()) as mock_email:
            mock_cancel.return_value = {"status": "cancelled"}
            mock_email.send_join_request_rejected = AsyncMock(return_value=True)
            await jr.handle_join_request_auto_expire({"request_id": req_id})
            mock_cancel.assert_awaited_once()
        doc = await db.join_requests.find_one({"id": req_id}, {"_id": 0})
        assert doc["status"] == "expired"
        assert "auto_expired" in doc["decision_reason"]

    try:
        _run(scenario())
    finally:
        _run(_cleanup(match_id, admin_id))


def test_15_auto_expire_noop_if_already_decided():
    match_id = f"m-{uuid.uuid4().hex[:8]}"
    admin_id = f"a-{uuid.uuid4().hex[:8]}"
    req_id = str(uuid.uuid4())

    async def scenario():
        await _mk_reta(match_id, admin_id)
        await db.join_requests.insert_one({
            "id": req_id, "match_id": match_id, "player_id": "p1",
            "payment_id": "PAY-done", "status": "approved",
            "amount": 100.0, "payer_email": "p@test.com",
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        with patch.object(mps, "cancel_hold", new_callable=AsyncMock) as mock_cancel:
            await jr.handle_join_request_auto_expire({"request_id": req_id})
            mock_cancel.assert_not_called()
        doc = await db.join_requests.find_one({"id": req_id}, {"_id": 0})
        assert doc["status"] == "approved"  # sin cambios

    try:
        _run(scenario())
    finally:
        _run(_cleanup(match_id, admin_id))


def test_16_auto_expire_reta_deleted_marks_expired_no_mp():
    match_id = f"m-nonexistent-{uuid.uuid4().hex[:6]}"
    req_id = str(uuid.uuid4())

    async def scenario():
        # NO creamos la reta a propósito.
        await db.join_requests.insert_one({
            "id": req_id, "match_id": match_id, "player_id": "p1",
            "payment_id": "PAY-orphan", "status": "pending_approval",
            "amount": 100.0, "payer_email": "p@test.com",
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        with patch.object(mps, "cancel_hold", new_callable=AsyncMock) as mock_cancel:
            await jr.handle_join_request_auto_expire({"request_id": req_id})
            mock_cancel.assert_not_called()  # sin reta, no toca MP
        doc = await db.join_requests.find_one({"id": req_id}, {"_id": 0})
        assert doc["status"] == "expired"
        assert "reta_deleted" in doc["decision_reason"]

    try:
        _run(scenario())
    finally:
        await_coro = db.join_requests.delete_many({"id": req_id})
        _run(await_coro)
