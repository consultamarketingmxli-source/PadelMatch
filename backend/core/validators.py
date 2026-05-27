"""
Validadores y sanitizadores estrictos para entradas de usuario.

Protege contra:
  - Teléfonos malformados antes de mandar a Twilio (E.164 sin espacios).
  - Textos de observaciones que rompen el PDF A4 o WhatsApp (> 140 chars).
  - Nombres con emojis rotos o tamaños abusivos.

Todos los modelos Pydantic deben usar estos tipos en lugar de `str` plano.
"""
from __future__ import annotations

import re
import unicodedata
from typing import Annotated

from pydantic import AfterValidator, Field, StringConstraints

# E.164: "+" obligatorio + 1-3 dígitos país + 7-12 dígitos número. Máximo 15 dígitos.
_PHONE_RE = re.compile(r"^\+[1-9]\d{7,14}$")


def _strip_phone(raw: str) -> str:
    """Elimina espacios, guiones, paréntesis y puntos. NO valida formato.
    El validador subsiguiente se encargará de validar E.164."""
    if not isinstance(raw, str):
        raise ValueError("teléfono debe ser cadena")
    s = raw.strip()
    # Quitar separadores comunes
    s = re.sub(r"[\s\-\.\(\)]", "", s)
    return s


def _validate_phone(raw: str) -> str:
    s = _strip_phone(raw)
    if not _PHONE_RE.match(s):
        raise ValueError(
            "Teléfono inválido. Usa formato internacional con +. Ejemplo: +5215512345678",
        )
    return s


def _strip_control_chars(s: str) -> str:
    """Remueve caracteres de control no imprimibles que rompen Twilio/PDF.
    Conserva emojis válidos y caracteres Unicode legibles."""
    if not s:
        return s
    return "".join(c for c in s if unicodedata.category(c)[0] != "C" or c in ("\n", "\t"))


def _validate_nombre(raw: str) -> str:
    s = _strip_control_chars(raw).strip()
    if len(s) < 2:
        raise ValueError("El nombre debe tener al menos 2 caracteres.")
    if len(s) > 80:
        raise ValueError("El nombre no puede exceder 80 caracteres.")
    return s


def _validate_observaciones(raw: str) -> str:
    if raw is None:
        return ""
    s = _strip_control_chars(raw).strip()
    # Truncado duro a 140 para proteger PDF y WhatsApp.
    return s[:140]


# Tipos exportados — úsalos en Pydantic models.
PhoneStr = Annotated[str, AfterValidator(_validate_phone)]
NombreStr = Annotated[str, AfterValidator(_validate_nombre)]
ObservacionesStr = Annotated[
    str,
    AfterValidator(_validate_observaciones),
    Field(max_length=140),
]
