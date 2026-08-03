"""Universal Links (iOS) + App Links (Android) — `.well-known/*` endpoints.

Se sirven SIN el prefijo `/api` (Apple y Google requieren la ruta literal).
Por eso este router se monta directamente en la app, no en el sub-router `/api`.

Dominio productivo: `padelappretas.app` (confirmado por el usuario).

Para probar tras deploy:
  • iOS:   https://padelappretas.app/.well-known/apple-app-site-association
  • Android: https://padelappretas.app/.well-known/assetlinks.json

Nota: el cliente Apple cachea el AASA por 24h; Android verifica con
`autoVerify="true"` en el intent-filter al instalar la app.
"""
from __future__ import annotations

import logging
import os

from fastapi import APIRouter
from fastapi.responses import JSONResponse

logger = logging.getLogger("padelappretas-os")
router = APIRouter(tags=["wellknown"])

# ══════════════════════════════════════════════════════════════════════════
# Bundle ID / Package name de la app (deben coincidir con app.json).
# ══════════════════════════════════════════════════════════════════════════
IOS_BUNDLE_ID = os.getenv("IOS_BUNDLE_ID", "com.padelappretas.app")
ANDROID_PACKAGE = os.getenv("ANDROID_PACKAGE", "com.padelappretas.app")

# ══════════════════════════════════════════════════════════════════════════
# Credenciales de firma — leídas desde `.env` para inyección dinámica.
# ══════════════════════════════════════════════════════════════════════════
# `IOS_TEAM_ID`: 10 chars alfanuméricos de Apple Developer Program.
#   Default = placeholder ⇒ Universal Links iOS NO validarán hasta que se
#   inscriba el equipo en Apple. Setea en `.env` cuando esté disponible.
IOS_TEAM_ID = os.getenv("IOS_TEAM_ID", "TEAM_ID_TODO").strip()

# `ANDROID_SHA256_FINGERPRINTS`: lista separada por comas de fingerprints
#   en formato hex uppercase con `:` (ej. `AB:CD:...:12`). Acepta múltiples
#   para incluir debug + release keystore simultáneamente. Ejemplo:
#   ANDROID_SHA256_FINGERPRINTS="AB:CD:...,EF:12:..."
_raw_sha256 = os.getenv("ANDROID_SHA256_FINGERPRINTS", "SHA256_FINGERPRINT_TODO_REPLACE_AFTER_BUILD")
ANDROID_SHA256_FINGERPRINTS = [x.strip() for x in _raw_sha256.split(",") if x.strip()]

# Log estado de config al startup para facilitar debugging post-deploy.
if IOS_TEAM_ID == "TEAM_ID_TODO":
    logger.warning("[wellknown] IOS_TEAM_ID en placeholder — Universal Links iOS NO validarán")
if any("TODO" in fp for fp in ANDROID_SHA256_FINGERPRINTS):
    logger.warning("[wellknown] ANDROID_SHA256_FINGERPRINTS en placeholder — App Links Android NO auto-verify")


@router.get("/.well-known/apple-app-site-association", include_in_schema=False)
async def apple_app_site_association() -> JSONResponse:
    """AASA para Universal Links iOS.

    Estructura:
      applinks.details[].appIDs = ["<TEAM_ID>.<BUNDLE_ID>"]
      applinks.details[].components = [{ "/": "/retas/*" }]

    El Content-Type DEBE ser application/json (sin extensión .json en la URL).
    """
    payload = {
        "applinks": {
            "details": [
                {
                    "appIDs": [f"{IOS_TEAM_ID}.{IOS_BUNDLE_ID}"],
                    "components": [
                        {"/": "/retas/*", "comment": "Detalle de reta por slug"},
                    ],
                }
            ]
        },
        # webcredentials habilita el autocompletado de password con la app
        # cuando se use SSO. Inocuo si no se usa.
        "webcredentials": {
            "apps": [f"{IOS_TEAM_ID}.{IOS_BUNDLE_ID}"],
        },
    }
    return JSONResponse(payload, media_type="application/json")


@router.get("/.well-known/assetlinks.json", include_in_schema=False)
async def android_assetlinks() -> JSONResponse:
    """assetlinks.json para Android App Links.

    Estructura:
      [
        {
          "relation": ["delegate_permission/common.handle_all_urls"],
          "target": {
            "namespace": "android_app",
            "package_name": "<PACKAGE>",
            "sha256_cert_fingerprints": ["<FP1>", "<FP2>"]
          }
        }
      ]
    """
    payload = [
        {
            "relation": ["delegate_permission/common.handle_all_urls"],
            "target": {
                "namespace": "android_app",
                "package_name": ANDROID_PACKAGE,
                "sha256_cert_fingerprints": ANDROID_SHA256_FINGERPRINTS,
            },
        }
    ]
    return JSONResponse(payload, media_type="application/json")
