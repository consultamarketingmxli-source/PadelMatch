"""
Admin: Endpoint de verificación pre-deployment (LIVE readiness).

GET /api/admin/deploy-readiness
    Devuelve el estado de cada credencial productiva. No expone secretos;
    solo dice si están configuradas, si son TEST vs LIVE, y qué falta.

Útil ANTES de hacer click en el botón "Publish" de Emergent. Lee
`/app/memory/LIVE_DEPLOYMENT_KEYS.md` como source-of-truth de variables.
"""
from __future__ import annotations

import logging
import os

from fastapi import APIRouter, Depends

from auth import get_current_admin

logger = logging.getLogger("padelappretas-os")
router = APIRouter(prefix="/admin", tags=["deploy-readiness"])


def _classify_key(key: str | None, live_prefix: str, test_prefix: str) -> str:
    """Clasifica una credencial: 'missing' | 'test' | 'live' | 'unknown'."""
    if not key or not key.strip():
        return "missing"
    k = key.strip()
    if k.startswith(live_prefix):
        return "live"
    if k.startswith(test_prefix):
        return "test"
    return "unknown"


@router.get("/deploy-readiness")
async def deploy_readiness(current=Depends(get_current_admin)):
    """Reporta qué integraciones están configuradas en modo LIVE vs TEST.

    Output schema:
        {
            "overall": "ready" | "test" | "missing",
            "ready_for_live": bool,
            "integrations": [
                { name, configured, mode, severity, advice },
                ...
            ],
            "missing_critical": [name, ...],
        }
    """
    items: list[dict] = []

    # ---------- Stripe ----------
    stripe_key = os.getenv("STRIPE_API_KEY", "").strip()
    stripe_mode = _classify_key(stripe_key, "sk_live_", "sk_test_")
    items.append({
        "name": "Stripe API Key",
        "env": "STRIPE_API_KEY",
        "configured": bool(stripe_key),
        "mode": stripe_mode,
        "severity": "critical" if stripe_mode == "missing" else "warning" if stripe_mode == "test" else "ok",
        "advice": {
            "missing": "Obtén tu clave en https://dashboard.stripe.com/apikeys.",
            "test": "Estás en modo TEST. Cambia a sk_live_… antes de publicar.",
            "live": "✓ Stripe en modo LIVE.",
            "unknown": "Formato de key no reconocido — verifica que empiece por sk_live_ o sk_test_.",
        }[stripe_mode],
    })

    stripe_whsec = os.getenv("STRIPE_WEBHOOK_SECRET", "").strip()
    items.append({
        "name": "Stripe Webhook Secret",
        "env": "STRIPE_WEBHOOK_SECRET",
        "configured": bool(stripe_whsec),
        "mode": "live" if stripe_whsec.startswith("whsec_") else "missing",
        "severity": "warning" if not stripe_whsec else "ok",
        "advice": (
            "Configura webhook productivo en Stripe Dashboard → Developers → Webhooks."
            if not stripe_whsec else "✓ Signing secret configurado."
        ),
    })

    # ---------- Mercado Pago ----------
    mp_client = os.getenv("MP_CLIENT_ID", "").strip()
    mp_secret = os.getenv("MP_CLIENT_SECRET", "").strip()
    mp_public = os.getenv("MP_PUBLIC_KEY", "").strip()
    mp_mode = (
        "missing" if not mp_client else
        # MP no exhibe prefijo TEST/LIVE en el Client ID; lo detectamos por la public key.
        "test" if "TEST-" in mp_public.upper() else
        "live" if mp_public.startswith("APP_USR-") else "unknown"
    )
    items.append({
        "name": "Mercado Pago App",
        "env": "MP_CLIENT_ID + MP_PUBLIC_KEY + MP_CLIENT_SECRET",
        "configured": bool(mp_client and mp_public),
        "mode": mp_mode,
        "severity": "warning" if mp_mode in ("missing", "test") else "ok",
        "advice": {
            "missing": "Configura MP_CLIENT_ID, MP_PUBLIC_KEY y MP_CLIENT_SECRET desde tu app en MP Developers.",
            "test": "Estás usando credenciales TEST de MP (TEST-…). Cambia a credenciales productivas.",
            "live": "✓ Mercado Pago en modo productivo.",
            "unknown": "Verifica el formato de MP_PUBLIC_KEY (debe empezar por APP_USR-).",
        }[mp_mode],
        "extra": {
            "client_id_set": bool(mp_client),
            "public_key_set": bool(mp_public),
            "client_secret_set": bool(mp_secret),
        },
    })

    # ---------- Twilio ----------
    tw_sid = os.getenv("TWILIO_ACCOUNT_SID", "").strip()
    tw_token = os.getenv("TWILIO_AUTH_TOKEN", "").strip()
    tw_from = os.getenv("TWILIO_WHATSAPP_FROM", "").strip()
    tw_join = os.getenv("TWILIO_JOIN_CODE", "").strip()
    is_sandbox = (tw_from == "whatsapp:+14155238886") or bool(tw_join)
    tw_mode = (
        "missing" if not (tw_sid and tw_token and tw_from) else
        "test" if is_sandbox else "live"
    )
    items.append({
        "name": "Twilio WhatsApp",
        "env": "TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN + TWILIO_WHATSAPP_FROM",
        "configured": bool(tw_sid and tw_token and tw_from),
        "mode": tw_mode,
        "severity": "warning" if tw_mode in ("missing", "test") else "ok",
        "advice": {
            "missing": "Configura las 3 variables Twilio para activar notificaciones WhatsApp.",
            "test": (
                "Estás usando el Twilio Sandbox (whatsapp:+14155238886). En producción "
                "necesitas un número WhatsApp Business aprobado por Meta. Elimina TWILIO_JOIN_CODE."
            ),
            "live": "✓ Twilio WhatsApp en modo productivo.",
        }[tw_mode],
        "extra": {"sandbox_join_code_present": bool(tw_join)},
    })

    # ---------- Email ----------
    email_provider = os.getenv("EMAIL_PROVIDER", "").strip().lower()
    email_key = os.getenv("EMAIL_API_KEY", "").strip()
    email_from = os.getenv("EMAIL_FROM", "").strip()
    email_mode = (
        "missing" if not (email_provider and email_key and email_from) else "live"
    )
    items.append({
        "name": "Email transaccional",
        "env": "EMAIL_PROVIDER + EMAIL_API_KEY + EMAIL_FROM",
        "configured": bool(email_provider and email_key and email_from),
        "mode": email_mode,
        "severity": "warning" if email_mode == "missing" else "ok",
        "advice": {
            "missing": "Sin email los compradores no reciben confirmación. Configura Resend o SendGrid.",
            "live": f"✓ Email habilitado vía {email_provider}.",
        }[email_mode],
        "extra": {"provider": email_provider or None},
    })

    # ---------- JWT secret ----------
    jwt_secret = os.getenv("JWT_SECRET", "").strip()
    jwt_mode = (
        "missing" if not jwt_secret else
        "test" if len(jwt_secret) < 32 or jwt_secret in {"dev", "secret", "changeme"} else
        "live"
    )
    items.append({
        "name": "JWT Secret",
        "env": "JWT_SECRET",
        "configured": bool(jwt_secret),
        "mode": jwt_mode,
        "severity": "critical" if jwt_mode != "live" else "ok",
        "advice": {
            "missing": "JWT_SECRET es obligatorio. Genera uno aleatorio ≥64 chars.",
            "test": "JWT_SECRET es muy corto o de desarrollo. Genera uno aleatorio ≥64 chars.",
            "live": "✓ JWT secret fuerte.",
        }[jwt_mode],
    })

    # ---------- CORS ----------
    cors = os.getenv("CORS_ORIGINS", "").strip()
    cors_mode = "warning" if (not cors or cors.strip() == "*") else "ok"
    items.append({
        "name": "CORS Origins",
        "env": "CORS_ORIGINS",
        "configured": bool(cors),
        "mode": "test" if cors_mode == "warning" else "live",
        "severity": "warning" if cors_mode == "warning" else "ok",
        "advice": (
            "Restringe CORS_ORIGINS a tus dominios reales (sin *) para producción."
            if cors_mode == "warning"
            else "✓ CORS configurado para dominios específicos."
        ),
    })

    # ---------- Resumen ----------
    severities = [it["severity"] for it in items]
    if "critical" in severities:
        overall = "missing"
    elif "warning" in severities:
        overall = "test"
    else:
        overall = "ready"

    missing_critical = [it["name"] for it in items if it["severity"] == "critical"]

    return {
        "overall": overall,
        "ready_for_live": overall == "ready",
        "integrations": items,
        "missing_critical": missing_critical,
        "summary": {
            "total": len(items),
            "ok": severities.count("ok"),
            "warning": severities.count("warning"),
            "critical": severities.count("critical"),
        },
        "doc_url": "/app/memory/LIVE_DEPLOYMENT_KEYS.md",
    }
