"""
Utilidades de imagen — compresión automática a WebP para logos de organizadores.

Objetivo: que el organizador pueda subir un PNG/JPG pesado (1MB+) y la app lo
guarde como WebP ligero (~50-150KB) sin perder calidad visual perceptible. Así
la landing page de la reta carga rápido en móviles con conexión lenta.

Entrada: data URL base64 (ej. "data:image/png;base64,iVBORw0KG...")
Salida:  data URL base64 con MIME `image/webp` y tamaño reducido.

Si la entrada no es una imagen válida o ya pesa < 30KB, se retorna sin cambios
(evita degradar logos ya optimizados).
"""
from __future__ import annotations

import base64
import io
import logging
import re
from typing import Optional

from PIL import Image, UnidentifiedImageError

logger = logging.getLogger("padelappretas-os.image")

_DATA_URL_RE = re.compile(r"^data:image/([a-zA-Z]+);base64,(.+)$", re.DOTALL)

# Límites para evitar abusos / latencia inaceptable.
MAX_INPUT_BYTES = 8 * 1024 * 1024       # 8 MB de input
MAX_OUTPUT_DIMENSION = 512               # max 512px de lado (logos suelen ser cuadrados)
WEBP_QUALITY = 82                        # buen balance calidad/peso
SKIP_IF_SMALLER_THAN = 30 * 1024         # 30 KB — ya está optimizado, no toques


def _is_data_url(s: str) -> bool:
    return isinstance(s, str) and s.startswith("data:image/")


def compress_logo_to_webp(data_url: Optional[str]) -> Optional[str]:
    """Comprime un data URL de imagen a WebP. Idempotente y resiliente.

    - Si `data_url` es None / vacío / no es data URL: retorna tal cual.
    - Si ya pesa < 30KB: retorna tal cual (no degradar).
    - Si Pillow no puede leerlo: log + retorna tal cual (no rompe el flujo).
    - Si excede 8MB: rechaza (devuelve None) para no aceptar payloads abusivos.
    """
    if not data_url:
        return data_url
    if not _is_data_url(data_url):
        return data_url

    m = _DATA_URL_RE.match(data_url)
    if not m:
        return data_url

    mime, b64 = m.group(1).lower(), m.group(2)

    try:
        raw = base64.b64decode(b64, validate=True)
    except Exception:
        logger.warning("image_utils: base64 inválido en logo, dejando tal cual")
        return data_url

    if len(raw) > MAX_INPUT_BYTES:
        logger.warning("image_utils: logo excede %dMB, rechazado", MAX_INPUT_BYTES // (1024 * 1024))
        return None

    if len(raw) < SKIP_IF_SMALLER_THAN and mime == "webp":
        # Ya es WebP ligero, no tocamos.
        return data_url

    try:
        img = Image.open(io.BytesIO(raw))
        img.load()
    except (UnidentifiedImageError, Exception) as e:
        logger.warning("image_utils: Pillow no pudo leer la imagen (%s), dejando tal cual", e)
        return data_url

    # Convertir a RGB(A) según soporte alpha. WebP soporta ambos.
    if img.mode not in ("RGB", "RGBA"):
        img = img.convert("RGBA" if "A" in img.mode else "RGB")

    # Redimensionar manteniendo aspecto si excede el lado máximo.
    w, h = img.size
    if max(w, h) > MAX_OUTPUT_DIMENSION:
        scale = MAX_OUTPUT_DIMENSION / max(w, h)
        new_size = (int(w * scale), int(h * scale))
        img = img.resize(new_size, Image.LANCZOS)

    buf = io.BytesIO()
    try:
        img.save(buf, format="WEBP", quality=WEBP_QUALITY, method=6)
    except Exception as e:
        logger.exception("image_utils: falló encode WebP (%s), dejando tal cual", e)
        return data_url

    out_bytes = buf.getvalue()
    out_b64 = base64.b64encode(out_bytes).decode("ascii")
    return f"data:image/webp;base64,{out_b64}"
