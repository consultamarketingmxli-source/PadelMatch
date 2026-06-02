#!/usr/bin/env python3
"""
generate_icons.py — Genera el set completo de iconos de PadelAppRetas.

Outputs en /app/frontend/assets/images/:
  - icon.png             1024×1024  Icono iOS principal (squircle iOS-rendered)
  - adaptive-icon.png    1024×1024  Foreground Android (transparente, ball-only, safe zone 66%)
  - splash-icon.png      1024×1024  Splash screen (ball + wordmark sobre fondo blanco)
  - favicon.png            48×48    Favicon web
  - icon-monochrome.png  1024×1024  iOS 18+ Tinted (silueta blanca, transparente)

Composición:
  - Pelota: foto real "Pelota Padel.jpg" enmascarada en círculo, con highlight
    radial sutil para conservar la apariencia 3D.
  - Wordmark: "Padel" (light) + "AppRetas" (heavy) usando Liberation Sans
    (sustituto sin licencia de Inter; igual look-and-feel).
  - Squircle: el background `#0f172a` se aplica al canvas; iOS aplica su propio
    rounded square mask en runtime.

USO:
    cd /app && python3 scripts/generate_icons.py
"""
from __future__ import annotations

import io
import os
import sys
import urllib.request
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

PELOTA_URL = (
    "https://customer-assets.emergentagent.com/job_padel-tournament-hub-9/"
    "artifacts/fpyuwnwu_Pelota%20Padel.jpg"
)
OUTPUT_DIR = Path("/app/frontend/assets/images")
FONT_REGULAR = "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf"
FONT_BOLD = "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"

DARK = (15, 23, 42, 255)        # #0f172a slate-900
LIGHT_BG = (248, 250, 252, 255)  # #F8FAFC slate-50
TEXT_LIGHT = (226, 232, 240, 255)  # slate-200 para "Padel"
TEXT_WHITE = (255, 255, 255, 255)  # para "AppRetas"


def download_pelota() -> Image.Image:
    """Descarga la pelota o usa cache local."""
    cache = Path("/tmp/pelota_padel_cache.jpg")
    if not cache.exists():
        print(f"  ↓ Descargando pelota desde {PELOTA_URL}")
        urllib.request.urlretrieve(PELOTA_URL, cache)
    return Image.open(cache).convert("RGBA")


def make_circular_ball(size: int) -> Image.Image:
    """Pelota recortada en círculo con padding interno para que se vea limpia."""
    src = download_pelota()
    # Centro-crop cuadrado.
    w, h = src.size
    side = min(w, h)
    left = (w - side) // 2
    top = (h - side) // 2
    cropped = src.crop((left, top, left + side, top + side)).resize(
        (size, size), Image.LANCZOS
    )

    # Máscara circular con anti-aliasing (oversampling 4x).
    over = 4
    mask = Image.new("L", (size * over, size * over), 0)
    md = ImageDraw.Draw(mask)
    md.ellipse((0, 0, size * over, size * over), fill=255)
    mask = mask.resize((size, size), Image.LANCZOS)

    result = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    result.paste(cropped, (0, 0), mask=mask)
    return result


def render_wordmark(canvas_w: int, font_size: int) -> Image.Image:
    """
    Renderiza 'Padel' light + 'AppRetas' bold centrado.
    Retorna una imagen RGBA del tamaño exacto del texto.
    """
    font_light = ImageFont.truetype(FONT_REGULAR, font_size)
    font_bold = ImageFont.truetype(FONT_BOLD, font_size)

    # Medir bbox para dimensionar el canvas del wordmark.
    tmp = Image.new("RGBA", (canvas_w, font_size * 2), (0, 0, 0, 0))
    td = ImageDraw.Draw(tmp)
    bbox_p = td.textbbox((0, 0), "Padel", font=font_light)
    bbox_a = td.textbbox((0, 0), "AppRetas", font=font_bold)
    w_p = bbox_p[2] - bbox_p[0]
    w_a = bbox_a[2] - bbox_a[0]
    total_w = w_p + w_a
    h = max(bbox_p[3] - bbox_p[1], bbox_a[3] - bbox_a[1])

    out = Image.new("RGBA", (total_w + 4, int(h * 1.2)), (0, 0, 0, 0))
    od = ImageDraw.Draw(out)
    # Alineamos por baseline. PIL ascender + descender.
    od.text((-bbox_p[0], -bbox_p[1]), "Padel", font=font_light, fill=TEXT_LIGHT)
    od.text((w_p - bbox_p[0], -bbox_a[1]), "AppRetas", font=font_bold, fill=TEXT_WHITE)
    return out


def add_ball_shadow(ball: Image.Image, shadow_offset: int = 12, blur: int = 18) -> Image.Image:
    """Añade sombra suave bajo la pelota — refuerza la sensación 3D."""
    w, h = ball.size
    canvas = Image.new("RGBA", (w + blur * 4, h + blur * 4 + shadow_offset), (0, 0, 0, 0))
    # Sombra
    sh_mask = ball.split()[3]  # alpha channel
    sh = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    sh.paste((0, 0, 0, 110), (blur * 2, blur * 2 + shadow_offset), mask=sh_mask)
    sh = sh.filter(ImageFilter.GaussianBlur(blur))
    canvas.alpha_composite(sh)
    # Pelota encima
    canvas.alpha_composite(ball, (blur * 2, blur * 2))
    return canvas


def make_icon_main(size: int = 1024) -> Image.Image:
    """
    icon.png — iOS-friendly. Cuadrado completo con fondo dark slate.
    Componentes: pelota arriba-centro + wordmark debajo. iOS aplica su propio
    rounded square; aquí dejamos el cuadrado limpio.
    """
    canvas = Image.new("RGBA", (size, size), DARK)

    # Pelota ~ 44% del lado
    ball_size = int(size * 0.44)
    ball = make_circular_ball(ball_size)
    ball_with_shadow = add_ball_shadow(ball, shadow_offset=int(size * 0.012), blur=int(size * 0.025))
    bx = (size - ball_with_shadow.size[0]) // 2
    by = int(size * 0.20)
    canvas.alpha_composite(ball_with_shadow, (bx, by))

    # Wordmark
    wm = render_wordmark(size, font_size=int(size * 0.095))
    # escalar al ~74% del ancho si excede
    if wm.size[0] > size * 0.78:
        new_w = int(size * 0.78)
        ratio = new_w / wm.size[0]
        wm = wm.resize((new_w, int(wm.size[1] * ratio)), Image.LANCZOS)
    wx = (size - wm.size[0]) // 2
    wy = by + ball_with_shadow.size[1] - int(size * 0.025) + int(size * 0.01)
    canvas.alpha_composite(wm, (wx, wy))
    return canvas


def make_adaptive_foreground(size: int = 1024) -> Image.Image:
    """
    adaptive-icon.png — solo pelota centrada, sobre transparente.
    Safe zone Android: inner 66% (mecánica: 432dp en canvas 108dp = ~624px en 1024).
    Sin texto (sería recortado por el mask circular/squircle del launcher).
    """
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    ball_size = int(size * 0.55)  # cabe holgado dentro del 66% safe zone
    ball = make_circular_ball(ball_size)
    ball_with_shadow = add_ball_shadow(ball, shadow_offset=int(size * 0.010), blur=int(size * 0.022))
    bx = (size - ball_with_shadow.size[0]) // 2
    by = (size - ball_with_shadow.size[1]) // 2
    canvas.alpha_composite(ball_with_shadow, (bx, by))
    return canvas


def make_splash_icon(size: int = 1024) -> Image.Image:
    """
    splash-icon.png — pelota + wordmark sobre transparente (el splash
    aplica su propio backgroundColor desde app.json plugins).
    """
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    ball_size = int(size * 0.42)
    ball = make_circular_ball(ball_size)
    ball_with_shadow = add_ball_shadow(ball, shadow_offset=int(size * 0.010), blur=int(size * 0.020))
    bx = (size - ball_with_shadow.size[0]) // 2
    by = int(size * 0.23)
    canvas.alpha_composite(ball_with_shadow, (bx, by))

    # Wordmark en azul brand (sobre fondo claro splash)
    wm_dark = render_wordmark(size, font_size=int(size * 0.085))
    # Recolorear: "Padel" → cobalt #1E40AF, "AppRetas" → primary #2563EB
    # Simplificación: re-renderizamos con colores oscuros directamente.
    font_size = int(size * 0.085)
    font_light = ImageFont.truetype(FONT_REGULAR, font_size)
    font_bold = ImageFont.truetype(FONT_BOLD, font_size)
    td = ImageDraw.Draw(canvas)
    bbox_p = td.textbbox((0, 0), "Padel", font=font_light)
    bbox_a = td.textbbox((0, 0), "AppRetas", font=font_bold)
    w_p = bbox_p[2] - bbox_p[0]
    w_a = bbox_a[2] - bbox_a[0]
    total_w = w_p + w_a
    wm_x = (size - total_w) // 2
    wm_y = by + ball_with_shadow.size[1] - int(size * 0.025)
    td.text((wm_x - bbox_p[0], wm_y - bbox_p[1]), "Padel", font=font_light, fill=(30, 64, 175, 255))
    td.text((wm_x + w_p - bbox_p[0], wm_y - bbox_a[1]), "AppRetas", font=font_bold, fill=(37, 99, 235, 255))
    return canvas


def make_favicon(size: int = 48) -> Image.Image:
    """favicon.png — pelota sobre slate dark, cuadrado simple."""
    canvas = Image.new("RGBA", (size, size), DARK)
    ball_size = int(size * 0.70)
    ball = make_circular_ball(ball_size)
    bx = (size - ball_size) // 2
    by = (size - ball_size) // 2
    canvas.alpha_composite(ball, (bx, by))
    return canvas


def make_monochrome_icon(size: int = 1024) -> Image.Image:
    """
    icon-monochrome.png — versión iOS 18+ Tinted Mode.
    Silueta blanca de pelota + costuras como negativo, sobre transparente.
    El SO le aplica un tinte automático según el modo seleccionado.
    """
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    # Solo silueta circular blanca con costuras "estilo logo".
    margin = int(size * 0.18)
    diameter = size - 2 * margin
    cx = size // 2
    cy = size // 2
    r = diameter // 2

    # Anti-aliased solid white circle
    over = 4
    big = Image.new("RGBA", (size * over, size * over), (0, 0, 0, 0))
    bd = ImageDraw.Draw(big)
    bd.ellipse(
        (
            (cx - r) * over,
            (cy - r) * over,
            (cx + r) * over,
            (cy + r) * over,
        ),
        fill=(255, 255, 255, 255),
    )
    # Costuras estilo "punzadas" en el cuerpo (recortamos con alpha)
    seam_w = max(int(size * 0.034), 6)
    # Costura superior (bell curve)
    seam_points_top = []
    for t in range(101):
        x = (cx - r * 0.85) + (1.7 * r * 0.85) * (t / 100)
        # Parábola hacia arriba
        y = cy - (r * 0.25) - (r * 0.40) * (1 - (2 * (t / 100) - 1) ** 2)
        seam_points_top.append((x * over, y * over))
    bd.line(seam_points_top, fill=(0, 0, 0, 0), width=seam_w * over, joint="curve")
    # Costura inferior (bell curve hacia abajo)
    seam_points_bot = []
    for t in range(101):
        x = (cx - r * 0.85) + (1.7 * r * 0.85) * (t / 100)
        y = cy + (r * 0.25) + (r * 0.40) * (1 - (2 * (t / 100) - 1) ** 2)
        seam_points_bot.append((x * over, y * over))
    bd.line(seam_points_bot, fill=(0, 0, 0, 0), width=seam_w * over, joint="curve")

    canvas = big.resize((size, size), Image.LANCZOS)
    return canvas


def main() -> int:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    print("=== GENERANDO ICONOS PadelAppRetas ===")

    targets = [
        ("icon.png", make_icon_main(1024)),
        ("adaptive-icon.png", make_adaptive_foreground(1024)),
        ("splash-icon.png", make_splash_icon(1024)),
        ("favicon.png", make_favicon(48)),
        ("icon-monochrome.png", make_monochrome_icon(1024)),
    ]

    for name, img in targets:
        out = OUTPUT_DIR / name
        img.save(out, format="PNG", optimize=True)
        size_kb = out.stat().st_size / 1024
        print(f"  ✓ {name:24s}  {img.size[0]}×{img.size[1]}  {size_kb:6.1f} KB")

    print("\nTodos los assets generados en", OUTPUT_DIR)
    return 0


if __name__ == "__main__":
    sys.exit(main())
