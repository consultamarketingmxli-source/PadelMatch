"""
Integración Stripe Checkout para PadelReta usando emergentintegrations.

Flujo:
1. Frontend llama POST /api/public/retas/{id}/checkout-stripe → crea Inscripción Pendiente y
   genera una Stripe Checkout Session. Devuelve { inscripcion, checkout_url, session_id }.
2. Frontend redirige al jugador a checkout_url.
3. Stripe procesa el pago y manda webhook a POST /api/webhooks/stripe.
4. Backend marca la inscripción como Aprobada (o la elimina y promueve waitlist si falla).
5. Frontend hace polling a GET /api/public/inscripciones/{id}/payment-status para
   detectar la confirmación del backend.

Seguridad:
- Stripe API key viene de env STRIPE_API_KEY (no hardcodeada).
- El amount se calcula en server desde reta.costo_inscripcion (no se confía en el cliente).
- Webhook secret opcional (Stripe en producción lo requiere; en sandbox del pod no).
"""
from __future__ import annotations

import logging
import os
from typing import Optional

from emergentintegrations.payments.stripe.checkout import (
    CheckoutSessionRequest,
    CheckoutSessionResponse,
    CheckoutStatusResponse,
    StripeCheckout,
    WebhookEventResponse,
)

logger = logging.getLogger("payments.stripe")

def _get_api_key() -> str:
    return os.getenv("STRIPE_API_KEY", "").strip()


def _get_webhook_secret() -> Optional[str]:
    s = os.getenv("STRIPE_WEBHOOK_SECRET", "").strip()
    return s or None


def is_stripe_configured() -> bool:
    return bool(_get_api_key())


def _client() -> StripeCheckout:
    api_key = _get_api_key()
    if not api_key:
        raise RuntimeError("STRIPE_API_KEY no configurada en el ambiente.")
    return StripeCheckout(api_key=api_key, webhook_secret=_get_webhook_secret())


async def crear_session_checkout(
    *,
    monto_principal: float,  # en unidades enteras de la moneda (ej. 250 = $250 MXN)
    moneda: str = "mxn",
    nombre_reta: str,
    success_url: str,
    cancel_url: str,
    inscripcion_id: str,
    reta_id: str,
    jugador_id: str,
    telefono: str,
) -> CheckoutSessionResponse:
    """Crea una Stripe Checkout Session.

    `monto_principal` es la cantidad en MXN o USD (NO en centavos). El wrapper
    de emergent toma `amount` como float y lo convierte internamente.
    """
    req = CheckoutSessionRequest(
        amount=float(monto_principal),
        currency=moneda.lower(),
        quantity=1,
        success_url=success_url,
        cancel_url=cancel_url,
        metadata={
            "inscripcion_id": inscripcion_id,
            "reta_id": reta_id,
            "jugador_id": jugador_id,
            "telefono": telefono,
            "nombre_reta": nombre_reta[:120],
        },
        payment_methods=["card"],
    )
    return await _client().create_checkout_session(req)


async def obtener_status_sesion(session_id: str) -> CheckoutStatusResponse:
    return await _client().get_checkout_status(session_id)


async def procesar_webhook(payload: bytes, signature: Optional[str]) -> WebhookEventResponse:
    return await _client().handle_webhook(payload, signature)


async def refundar_pago(payment_intent_id: str, amount: Optional[int] = None) -> dict:
    """Reembolsa un pago Stripe. amount en centavos (None = total).
    Usa el SDK oficial `stripe` directamente porque emergentintegrations no expone refund."""
    import stripe
    stripe.api_key = _get_api_key()
    params = {"payment_intent": payment_intent_id}
    if amount is not None:
        params["amount"] = amount
    # SDK síncrono — Stripe es rápido y este endpoint admin no es hot path
    import asyncio as _asyncio
    loop = _asyncio.get_event_loop()
    refund = await loop.run_in_executor(None, lambda: stripe.Refund.create(**params))
    return {"id": refund.id, "amount": refund.amount, "status": refund.status}
