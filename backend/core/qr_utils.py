"""
QR Code generator — usado para que organizadores compartan un link directo a
su reta en redes, posters o pizarrones del club.

Diseño:
- Generamos PNG cuadrado (no SVG porque la mayoría de impresoras y WhatsApp
  pintan mejor PNG).
- Tamaño objetivo: ~512px para que sea nítido en pantalla y en impresión A6.
- Box size dinámico para mantener el PNG compacto (<25 KB).
- Logo en el centro: opcional (futuro). Hoy generamos QR limpio con color de
  marca primary del theme.
"""
from __future__ import annotations

import io
import logging

import qrcode
from qrcode.constants import ERROR_CORRECT_M

logger = logging.getLogger("padelappretas-os.qr")

# Color de marca (Padel green primary del theme "Club Pro Clean")
BRAND_FG = "#0E1721"    # casi negro — buen contraste universal
BRAND_BG = "#FFFFFF"


def make_qr_png(url: str, box_size: int = 14, border: int = 2) -> bytes:
    """Genera un PNG de QR. Lanza ValueError si la URL es vacía.

    box_size=14 + border=2 → ~512-560 px de lado para URLs típicas. Cabe en
    cualquier WhatsApp Story o cartel A6.
    """
    if not url or not isinstance(url, str):
        raise ValueError("URL requerida para generar QR.")

    qr = qrcode.QRCode(
        version=None,                 # auto-fit
        error_correction=ERROR_CORRECT_M,  # tolera ~15% de daño / suciedad
        box_size=box_size,
        border=border,
    )
    qr.add_data(url.strip())
    qr.make(fit=True)

    img = qr.make_image(fill_color=BRAND_FG, back_color=BRAND_BG)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()
