"""
Mercado Pago OAuth Marketplace service.

Documentación oficial: https://www.mercadopago.com.mx/developers/es/docs/security/oauth/creation

Flujo Authorization Code (3-legged OAuth):
  1) build_authorize_url()  → genera URL https://auth.mercadopago.com.mx/authorization?...
  2) Organizador se loguea en MP y autoriza → MP redirige a `redirect_uri` con `?code=...&state=...`.
  3) exchange_code_for_tokens(code) → POST https://api.mercadopago.com/oauth/token
        body: client_id, client_secret, grant_type=authorization_code, code, redirect_uri
        respuesta: access_token, refresh_token, user_id, expires_in (6 meses), ...
  4) refresh_access_token(refresh_token) → mismo endpoint con grant_type=refresh_token.

Diseño:
  • Solo lógica HTTP. No toca DB, no maneja sesión. El router en routers/mercadopago.py
    decide qué hacer con los tokens (guardar / refresh / re-validar).
  • Encryption AT REST se delega al helper `core.crypto` (no a este módulo) para que las
    pruebas puedan inyectar mocks fácilmente.
  • State CSRF se firma con HMAC fuera de aquí (firma en routers/mercadopago.py para tener
    acceso al admin_email del request).
"""
from __future__ import annotations

import logging
import os
from typing import Optional

import httpx
from dotenv import load_dotenv

load_dotenv()
logger = logging.getLogger("padelappretas-os")

MP_AUTH_BASE = os.getenv("MP_AUTH_BASE", "https://auth.mercadopago.com.mx")
MP_OAUTH_TOKEN_URL = os.getenv("MP_OAUTH_TOKEN_URL", "https://api.mercadopago.com/oauth/token")


def _client_credentials() -> tuple[str, str]:
    cid = (os.getenv("MP_CLIENT_ID") or "").strip()
    csec = (os.getenv("MP_CLIENT_SECRET") or "").strip()
    if not cid or not csec:
        raise RuntimeError(
            "MP_CLIENT_ID y MP_CLIENT_SECRET deben estar configurados en el .env "
            "para usar el flujo OAuth de Mercado Pago.",
        )
    return cid, csec


def build_authorize_url(*, state: str, redirect_uri: str) -> str:
    """Construye la URL del paso 1 del OAuth (UI hosteada por MP).

    Args:
        state: token opaco firmado por nosotros (CSRF + admin_email).
        redirect_uri: debe estar EXACTAMENTE registrada en el dashboard de MP.

    Returns:
        URL completa lista para abrir en WebBrowser/expo-web-browser.
    """
    cid, _ = _client_credentials()
    params = {
        "client_id": cid,
        "response_type": "code",
        "platform_id": "mp",
        "state": state,
        "redirect_uri": redirect_uri,
    }
    qs = "&".join(f"{k}={httpx.QueryParams({k: v})[k]}" for k, v in params.items())
    return f"{MP_AUTH_BASE}/authorization?{qs}"


async def exchange_code_for_tokens(*, code: str, redirect_uri: str) -> dict:
    """Canjea `code` por access_token + refresh_token + user_id.

    Respuesta esperada:
        {
          "access_token": "APP_USR-...",
          "token_type": "Bearer",
          "expires_in": 15552000,   # ~6 meses
          "scope": "offline_access read write",
          "user_id": 123456789,
          "refresh_token": "TG-...",
          "public_key": "APP_USR-..."
        }

    Lanza:
        ValueError si MP rechaza el code (400/401).
        RuntimeError ante errores de red / 5xx.
    """
    cid, csec = _client_credentials()
    payload = {
        "client_id": cid,
        "client_secret": csec,
        "grant_type": "authorization_code",
        "code": code.strip(),
        "redirect_uri": redirect_uri,
    }
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.post(
            MP_OAUTH_TOKEN_URL,
            json=payload,
            headers={"Accept": "application/json"},
        )
    if resp.status_code in (400, 401):
        try:
            body = resp.json()
        except Exception:
            body = {"raw": resp.text[:300]}
        logger.warning("MP OAuth code rejected: %s", body)
        raise ValueError(f"Mercado Pago rechazó el código de autorización: {body}")
    if resp.status_code >= 500 or resp.status_code != 200:
        raise RuntimeError(
            f"MP OAuth token endpoint devolvió {resp.status_code}: {resp.text[:300]}",
        )
    data = resp.json()
    # Sanity-check mínimo
    if not data.get("access_token") or not data.get("user_id"):
        raise RuntimeError(f"Respuesta MP OAuth incompleta: {data}")
    return data


async def refresh_access_token(*, refresh_token: str) -> dict:
    """Renueva el access_token usando el refresh_token. MP rota refresh_tokens:
    cada llamada devuelve un refresh_token NUEVO que reemplaza al anterior.
    """
    cid, csec = _client_credentials()
    payload = {
        "client_id": cid,
        "client_secret": csec,
        "grant_type": "refresh_token",
        "refresh_token": refresh_token.strip(),
    }
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.post(
            MP_OAUTH_TOKEN_URL,
            json=payload,
            headers={"Accept": "application/json"},
        )
    if resp.status_code in (400, 401):
        try:
            body = resp.json()
        except Exception:
            body = {"raw": resp.text[:300]}
        raise ValueError(f"Mercado Pago rechazó el refresh_token: {body}")
    if resp.status_code != 200:
        raise RuntimeError(f"MP OAuth refresh devolvió {resp.status_code}: {resp.text[:300]}")
    return resp.json()


def marketplace_fee_percent() -> float:
    """Devuelve el porcentaje de comisión de plataforma (marketplace_fee).

    Default = 0 (organizador recibe 100%). Configurable vía MARKETPLACE_FEE_PERCENT.
    """
    raw = (os.getenv("MARKETPLACE_FEE_PERCENT") or "").strip()
    if not raw:
        # Backward-compat: el código viejo usaba MP_PLATFORM_FEE_PERCENT.
        raw = (os.getenv("MP_PLATFORM_FEE_PERCENT") or "0").strip()
    try:
        return max(0.0, float(raw))
    except ValueError:
        return 0.0


def default_redirect_uri() -> Optional[str]:
    """Construye la redirect_uri canónica a partir de APP_PUBLIC_URL si existe."""
    base = (os.getenv("APP_PUBLIC_URL") or "").rstrip("/")
    if not base:
        return None
    return f"{base}/api/admin/mercadopago/oauth/callback"
