"""
Validadores y sanitizadores estrictos para entradas de usuario.

Protege contra:
  - Teléfonos malformados antes de mandar a Twilio (E.164 sin espacios).
  - Textos de observaciones que rompen el PDF A4 o WhatsApp (> 140 chars).
  - Nombres con emojis rotos o tamaños abusivos.
  - Capacidad de jugadores fuera de [4,32] o no múltiplo de 4 (pádel = parejas).

Todos los modelos Pydantic deben usar estos tipos en lugar de `str`/`int` plano.
"""
from __future__ import annotations

import re
import unicodedata
from typing import Annotated

from pydantic import AfterValidator, Field, StringConstraints

# Capacidad mínima/máxima por reta — multiplo de 4 (pádel = parejas)
JUGADORES_MIN = 4
JUGADORES_MAX = 32

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


# País por defecto cuando el usuario ingresa un número sin código internacional.
# México (+52) es el mercado principal de PadelAppRetas.
DEFAULT_COUNTRY_CODE = "+52"


def _validate_phone(raw: str) -> str:
    """Valida y normaliza a formato E.164.

    Tolerante con la UX del cliente: si el usuario tipeó sólo los 10 dígitos
    locales sin código de país (ej. `5512345678`), auto-prependemos
    `DEFAULT_COUNTRY_CODE` (+52 MX). Esto elimina la fricción del "+" para
    el usuario final pero mantiene E.164 estricto en base de datos.

    Casos aceptados:
        "+5215512345678"     → "+5215512345678"  (E.164 ya correcto)
        "5215512345678"      → "+5215512345678"  (falta "+", lo agregamos)
        "5512345678"         → "+525512345678"   (10 dígitos MX, prepend +52)
        "(55) 1234-5678"     → "+525512345678"   (separadores + prepend +52)
        "521 55 1234 5678"   → "+5215512345678"  (separadores, ya tiene lada)

    Rechaza cualquier otro formato con mensaje claro.
    """
    s = _strip_phone(raw)
    if not s:
        raise ValueError("Teléfono requerido.")

    # Si NO empieza con "+", intentamos inferir el formato:
    if not s.startswith("+"):
        digits = re.sub(r"\D", "", s)
        # Caso 1: 10 dígitos → asumimos número local MX, prepend +52
        if len(digits) == 10:
            s = f"{DEFAULT_COUNTRY_CODE}{digits}"
        # Caso 2: 11-15 dígitos → asumimos que ya trae lada, sólo agregamos "+"
        elif 11 <= len(digits) <= 15:
            s = f"+{digits}"
        else:
            raise ValueError(
                "Teléfono inválido. Ingresa 10 dígitos (México) o el número "
                "completo con lada. Ejemplo: (55) 1234 5678",
            )

    if not _PHONE_RE.match(s):
        raise ValueError(
            "Teléfono inválido. Verifica que tenga entre 10 y 15 dígitos. "
            "Ejemplo: (55) 1234 5678",
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


def _validate_jugadores_par4(n: int) -> int:
    """Capacidad de reta de pádel: tamaño curado entre 4 y 32.

    El pádel se juega en parejas (múltiplos de 4) en la mayoría de los casos.
    Se admite la excepción **6** (formato "Mexicano triple" / rotación con
    banca) que un organizador Pro puede elegir para retas con 2 jugadores en
    banca/rotación por cancha de 4. El techo de 32 garantiza que el algoritmo
    de rol corra rápido.
    """
    if not isinstance(n, int) or isinstance(n, bool):
        raise ValueError("max_jugadores debe ser entero")
    if n < JUGADORES_MIN or n > JUGADORES_MAX:
        raise ValueError(
            f"max_jugadores debe estar entre {JUGADORES_MIN} y {JUGADORES_MAX}."
        )
    # Set curado: 6 es la única capacidad "no par-4" permitida (rotación).
    permitidas = {4, 6, 8, 12, 16, 20, 24, 28, 32}
    if n not in permitidas:
        # Mensaje útil: sugerir el más cercano dentro del set.
        sugerido = min(permitidas, key=lambda x: abs(x - n))
        raise ValueError(
            f"Capacidad {n} no soportada. Te sugerimos {sugerido} (múltiplo "
            f"de 4 estándar o la variante 6 con rotación)."
        )
    return n


# Tipos exportados — úsalos en Pydantic models.
PhoneStr = Annotated[str, AfterValidator(_validate_phone)]
NombreStr = Annotated[str, AfterValidator(_validate_nombre)]
ObservacionesStr = Annotated[
    str,
    AfterValidator(_validate_observaciones),
    Field(max_length=140),
]
JugadoresPar4 = Annotated[int, AfterValidator(_validate_jugadores_par4)]
