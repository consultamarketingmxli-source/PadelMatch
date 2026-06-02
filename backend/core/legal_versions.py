"""
legal_versions.py — Single Source of Truth para versiones legales.

Cuando se actualice T&C o Privacy:
  1) Incrementar la versión correspondiente aquí.
  2) Actualizar el contenido en `frontend/src/content/legal.ts`.
  3) Cliente comparará con su caché local; si difiere, marca `needsReConsent=true`
     y muestra el flujo de re-consentimiento.

Formato semántico: MAYOR.MENOR
  - MAYOR: cambio sustantivo que requiere re-aceptación del usuario.
  - MENOR: clarificaciones, títulos, sin cambio de obligaciones.
"""
from datetime import date

# Versión actual de Términos y Condiciones.
TC_VERSION = "1.0"
TC_EFFECTIVE_DATE = date(2026, 5, 30).isoformat()

# Versión actual de Política de Privacidad.
PRIVACY_VERSION = "1.0"
PRIVACY_EFFECTIVE_DATE = date(2026, 5, 30).isoformat()

# Identificador legal del propietario (para footers / contacto).
LEGAL_ENTITY = "PadelAppRetas"
LEGAL_CONTACT_EMAIL = "legal@padelappretas.com"


def get_current_versions() -> dict:
    """Payload público de versiones — consumido por GET /api/v1/legal/versions."""
    return {
        "tc_version": TC_VERSION,
        "tc_effective_date": TC_EFFECTIVE_DATE,
        "privacy_version": PRIVACY_VERSION,
        "privacy_effective_date": PRIVACY_EFFECTIVE_DATE,
        "legal_entity": LEGAL_ENTITY,
        "contact_email": LEGAL_CONTACT_EMAIL,
    }
