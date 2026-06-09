"""
Encryption helpers para secretos sensibles persistidos en MongoDB.

Uso primario: tokens de OAuth de pasarelas de pago (Mercado Pago, Stripe, etc.).

Diseño:
  • Si `MP_TOKEN_ENCRYPTION_KEY` (Fernet key) está en .env → cifra+descifra real.
  • Si NO está → modo "passthrough" (los tokens se guardan en claro).
    Esto permite que entornos de dev sigan funcionando sin generar key.

  Cuando se cifra, el ciphertext se prefija con `enc::` para diferenciarlo
  visualmente de tokens en claro existentes (migración suave).

Generar key (una sola vez por entorno):
    python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
"""
from __future__ import annotations

import logging
import os
from typing import Optional

from cryptography.fernet import Fernet, InvalidToken

logger = logging.getLogger("padelappretas-os")

_ENC_PREFIX = "enc::"
_fernet_singleton: Optional[Fernet] = None
_initialized = False


def _get_fernet() -> Optional[Fernet]:
    global _fernet_singleton, _initialized
    if _initialized:
        return _fernet_singleton
    _initialized = True
    key = (os.getenv("MP_TOKEN_ENCRYPTION_KEY") or "").strip()
    if not key:
        logger.info(
            "crypto: MP_TOKEN_ENCRYPTION_KEY no configurada — tokens se "
            "guardarán en claro (modo dev).",
        )
        return None
    try:
        _fernet_singleton = Fernet(key.encode())
        logger.info("crypto: Fernet inicializado para encriptación at-rest.")
    except Exception as e:
        logger.error("crypto: clave Fernet inválida (%s); usando passthrough.", e)
        _fernet_singleton = None
    return _fernet_singleton


def encrypt_token(plain: Optional[str]) -> Optional[str]:
    """Cifra un token. Si no hay key, devuelve plain (passthrough)."""
    if not plain:
        return plain
    if plain.startswith(_ENC_PREFIX):
        # Ya cifrado — idempotente.
        return plain
    f = _get_fernet()
    if f is None:
        return plain
    return _ENC_PREFIX + f.encrypt(plain.encode("utf-8")).decode("utf-8")


def decrypt_token(stored: Optional[str]) -> Optional[str]:
    """Descifra un token guardado. Si viene en claro lo devuelve tal cual
    (retro-compat con tokens guardados antes de habilitar la key)."""
    if not stored:
        return stored
    if not stored.startswith(_ENC_PREFIX):
        return stored
    f = _get_fernet()
    if f is None:
        logger.warning(
            "crypto: token cifrado encontrado pero no hay key configurada — "
            "no se puede descifrar.",
        )
        return None
    try:
        return f.decrypt(stored[len(_ENC_PREFIX):].encode("utf-8")).decode("utf-8")
    except InvalidToken:
        logger.error("crypto: InvalidToken al descifrar token MP — key rotada?")
        return None
