"""
Servicio Mercado Pago Marketplace.

Flujo:
- El organizador (admin) pega su Access Token de MP en el dashboard.
- Lo validamos llamando a `/users/me` para obtener su user_id real.
- Lo guardamos en `admins.access_token_pasarela`.
- Al checkout: usamos ESE token para crear una preferencia Checkout Pro,
  por lo que el cobro va directo a la cuenta MP del organizador (100%).
- Webhook: MP nos avisa, consultamos el pago y actualizamos la inscripción.

Sin `marketplace_fee` por defecto (organizador recibe 100%).
Si `mp_apply_fee=true` en el admin, aplicaremos 10% en el futuro.
"""
import logging
import os
from typing import Optional

import httpx
import mercadopago
from dotenv import load_dotenv

load_dotenv()
logger = logging.getLogger("padelappretas-os")

MP_API_BASE = "https://api.mercadopago.com"
PLATFORM_FEE_PERCENT = float(os.getenv("MP_PLATFORM_FEE_PERCENT", "10"))


async def validar_access_token(access_token: str) -> dict:
    """Valida un Access Token de MP contra `/users/me`.
    Devuelve el user info (id, nickname, email, country_id, ...).
    Lanza ValueError si el token es inválido.
    """
    if not access_token or not access_token.strip():
        raise ValueError("Access Token vacío.")

    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.get(
            f"{MP_API_BASE}/users/me",
            headers={"Authorization": f"Bearer {access_token.strip()}"},
        )
    if resp.status_code == 401 or resp.status_code == 403:
        raise ValueError("Access Token inválido o expirado.")
    if resp.status_code != 200:
        raise ValueError(f"MP API error {resp.status_code}: {resp.text[:200]}")
    return resp.json()


def _sdk(access_token: str) -> mercadopago.SDK:
    return mercadopago.SDK(access_token.strip())


async def crear_preferencia(
    *,
    access_token: str,
    nombre_reta: str,
    costo_mxn: float,
    success_url: str,
    cancel_url: str,
    notification_url: str,
    external_reference: str,
    payer_email: Optional[str] = None,
    apply_fee: bool = False,
    metadata: Optional[dict] = None,
) -> dict:
    """Crea una preferencia Checkout Pro usando el access_token del organizador.
    Devuelve el dict de respuesta de MP (incluye id, init_point, sandbox_init_point).

    Marketplace multi-organizer:
        • `metadata` se adjunta tal cual a la preference. MP la propaga al
          objeto `payment` y al `merchant_order` → el webhook puede leer
          `payment.metadata.admin_email` para identificar al organizador.
        • `marketplace_fee` es ABSOLUTO en MXN (no porcentaje). Se calcula
          aquí usando MARKETPLACE_FEE_PERCENT (env, default 0).
    """
    sdk = _sdk(access_token)
    pref: dict = {
        "items": [{
            "title": f"Inscripción · {nombre_reta}"[:80],
            "quantity": 1,
            "currency_id": "MXN",
            "unit_price": round(float(costo_mxn), 2),
        }],
        "external_reference": external_reference,
        "back_urls": {
            "success": success_url,
            "failure": cancel_url,
            "pending": cancel_url,
        },
        "auto_return": "approved",
        "notification_url": notification_url,
        "statement_descriptor": "PadelappRetas",
    }
    if payer_email:
        pref["payer"] = {"email": payer_email}
    # ===== Metadata multi-organizer (Marketplace expansion) =====
    if metadata and isinstance(metadata, dict):
        # MP exige strings/numbers en metadata; serializamos por las dudas.
        clean = {k: (v if isinstance(v, (str, int, float, bool)) else str(v)) for k, v in metadata.items() if v is not None}
        if clean:
            pref["metadata"] = clean
    # ===== Marketplace fee configurable vía env =====
    # Lee del helper canónico para que un cambio de env propague sin redeploy.
    from mp_oauth_service import marketplace_fee_percent
    fee_pct = marketplace_fee_percent()
    if apply_fee and fee_pct > 0:
        pref["marketplace_fee"] = round(float(costo_mxn) * fee_pct / 100.0, 2)

    res = sdk.preference().create(pref)
    status = res.get("status")
    if status not in (200, 201):
        msg = res.get("response", {}).get("message") or str(res)
        raise RuntimeError(f"MP rechazó preference (status {status}): {msg}")
    return res["response"]


async def obtener_pago(access_token: str, payment_id: str) -> dict:
    """Recupera el payment completo (status, external_reference, etc.)."""
    sdk = _sdk(access_token)
    res = sdk.payment().get(payment_id)
    if res.get("status") != 200:
        raise RuntimeError(f"MP payment {payment_id} no encontrado: {res}")
    return res["response"]


async def obtener_merchant_order(access_token: str, order_id: str) -> dict:
    """Algunos webhooks vienen como merchant_order — listamos los pagos asociados."""
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.get(
            f"{MP_API_BASE}/merchant_orders/{order_id}",
            headers={"Authorization": f"Bearer {access_token.strip()}"},
        )
    if resp.status_code != 200:
        raise RuntimeError(f"MP merchant_order {order_id} error {resp.status_code}")
    return resp.json()



async def refundar_pago(
    access_token: str,
    payment_id: str,
    amount: Optional[float] = None,
    reason: Optional[str] = None,
) -> dict:
    """Emite un refund (total o parcial) contra un payment aprobado.

    Args:
        access_token: token del organizador que cobró el payment.
        payment_id: id MP del pago aprobado.
        amount: monto en MXN (None = refund total).
        reason: motivo para metadata interna (no se envía a MP).

    Returns:
        dict con `id`, `status`, `amount` del refund creado.

    Raises:
        RuntimeError si MP responde != 201.
    """
    body: dict = {}
    if amount is not None:
        body["amount"] = round(float(amount), 2)
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.post(
            f"{MP_API_BASE}/v1/payments/{payment_id}/refunds",
            headers={
                "Authorization": f"Bearer {access_token.strip()}",
                "Content-Type": "application/json",
                # X-Idempotency-Key: previene refunds duplicados ante retries.
                "X-Idempotency-Key": f"refund-{payment_id}-{int(amount or 0)}",
            },
            json=body,
        )
    if resp.status_code not in (200, 201):
        raise RuntimeError(
            f"MP refund {payment_id} fallido: HTTP {resp.status_code} · {resp.text[:200]}"
        )
    data = resp.json() or {}
    logger.info(
        "[mp] refund emitido · payment=%s refund_id=%s amount=%s reason=%s",
        payment_id, data.get("id"), data.get("amount"), (reason or "")[:80],
    )
    return {
        "id": str(data.get("id") or ""),
        "status": data.get("status"),
        "amount": data.get("amount"),
    }


# ════════════════════════════════════════════════════════════════════════════
# ITER51 — Pre-authorization (hold) + Capture flow for Open Reta
# ════════════════════════════════════════════════════════════════════════════
async def hold_funds(
    *,
    access_token: str,
    amount: float,
    card_token: str,
    payer_email: str,
    installments: int = 1,
    payment_method_id: Optional[str] = None,
    idempotency_key: Optional[str] = None,
    metadata: Optional[dict] = None,
) -> dict:
    """Retiene (autoriza) fondos SIN capturarlos. `capture=False`.

    MP mantiene los fondos bloqueados en la tarjeta hasta:
      - Un PUT posterior con `capture=True` → cobro efectivo.
      - Un PUT con `status="cancelled"` → liberación total al 0% comisión.
      - Vencimiento automático del hold (típ. 7-30 días según banco).

    Returns:
        dict crudo de MP con `id`, `status` (authorized/rejected), `status_detail`.
    Raises:
        RuntimeError si MP responde no-2xx.
    """
    body: dict = {
        "transaction_amount": round(float(amount), 2),
        "token": card_token,
        "installments": int(installments),
        "payer": {"email": payer_email},
        "capture": False,
        "description": "PadelAppRetas — Hold Open Reta",
    }
    if payment_method_id:
        body["payment_method_id"] = payment_method_id
    if metadata:
        body["metadata"] = metadata

    headers = {
        "Authorization": f"Bearer {access_token.strip()}",
        "Content-Type": "application/json",
    }
    if idempotency_key:
        headers["X-Idempotency-Key"] = idempotency_key

    async with httpx.AsyncClient(timeout=20.0) as client:
        resp = await client.post(f"{MP_API_BASE}/v1/payments", headers=headers, json=body)
    if resp.status_code not in (200, 201):
        raise RuntimeError(f"MP hold_funds HTTP {resp.status_code}: {resp.text[:200]}")
    data = resp.json() or {}
    logger.info(
        "[mp] hold · payment=%s status=%s amount=%s idem=%s",
        data.get("id"), data.get("status"), amount, idempotency_key,
    )
    return data


async def capture_funds(*, access_token: str, payment_id: str, amount: Optional[float] = None) -> dict:
    """Captura un hold previamente autorizado. PUT con `capture=True`.

    Args:
        amount: opcional para captura PARCIAL (menor o igual al autorizado).
                Por default captura el monto total del hold.

    Returns:
        dict con `id`, `status` (approved/rejected), `status_detail`.
    """
    body: dict = {"capture": True}
    if amount is not None:
        body["transaction_amount"] = round(float(amount), 2)
    async with httpx.AsyncClient(timeout=20.0) as client:
        resp = await client.put(
            f"{MP_API_BASE}/v1/payments/{payment_id}",
            headers={
                "Authorization": f"Bearer {access_token.strip()}",
                "Content-Type": "application/json",
                "X-Idempotency-Key": f"capture-{payment_id}",
            },
            json=body,
        )
    if resp.status_code not in (200, 201):
        raise RuntimeError(f"MP capture_funds HTTP {resp.status_code}: {resp.text[:200]}")
    data = resp.json() or {}
    logger.info(
        "[mp] capture · payment=%s status=%s status_detail=%s",
        payment_id, data.get("status"), data.get("status_detail"),
    )
    return data


async def cancel_hold(*, access_token: str, payment_id: str) -> dict:
    """Libera un hold sin cobrar. PUT con `status="cancelled"`.

    Comisión: 0% (el hold nunca se convierte en cargo).
    Idempotente: llamar sobre un pago ya cancelado retorna el estado actual.
    """
    async with httpx.AsyncClient(timeout=20.0) as client:
        resp = await client.put(
            f"{MP_API_BASE}/v1/payments/{payment_id}",
            headers={
                "Authorization": f"Bearer {access_token.strip()}",
                "Content-Type": "application/json",
                "X-Idempotency-Key": f"cancel-{payment_id}",
            },
            json={"status": "cancelled"},
        )
    if resp.status_code not in (200, 201):
        # 400 con status_detail="cannot_cancel" cuando ya está cancelled → OK idempotente
        if resp.status_code == 400 and "cannot" in resp.text.lower():
            logger.info("[mp] cancel_hold ya-cancelado (idempotent) · payment=%s", payment_id)
            return {"id": payment_id, "status": "cancelled", "idempotent": True}
        raise RuntimeError(f"MP cancel_hold HTTP {resp.status_code}: {resp.text[:200]}")
    data = resp.json() or {}
    logger.info("[mp] cancel_hold · payment=%s status=%s", payment_id, data.get("status"))
    return data

