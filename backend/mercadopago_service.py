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
logger = logging.getLogger("pixel-padel-os")

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
) -> dict:
    """Crea una preferencia Checkout Pro usando el access_token del organizador.
    Devuelve el dict de respuesta de MP (incluye id, init_point, sandbox_init_point).
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
        "statement_descriptor": "PadelReta",
    }
    if payer_email:
        pref["payer"] = {"email": payer_email}
    if apply_fee:
        pref["marketplace_fee"] = round(float(costo_mxn) * PLATFORM_FEE_PERCENT / 100.0, 2)

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
