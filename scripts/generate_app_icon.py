"""
Generate Pixel Padel OS app icon programmatically with Pillow.
"Club Pro Clean" aesthetic: emerald-600 squircle background, padel ball, subtle court lines.

Outputs:
  - /app/frontend/assets/icon.png            (1024x1024)
  - /app/frontend/assets/adaptive-icon.png   (1024x1024 - foreground)
  - /app/frontend/assets/splash-icon.png     (1024x1024)
  - /app/frontend/assets/favicon.png         (256x256)
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

ASSETS = Path("/app/frontend/assets")
ASSETS.mkdir(parents=True, exist_ok=True)

SIZE = 1024
EMERALD = (5, 150, 105, 255)        # emerald-600
EMERALD_DARK = (4, 120, 87, 255)    # emerald-700
BALL_YELLOW = (250, 204, 21, 255)   # tennis/padel ball #FACC15
BALL_HIGHLIGHT = (255, 236, 130, 255)
WHITE = (255, 255, 255, 255)


def squircle_mask(size: int, radius_ratio: float = 0.225) -> Image.Image:
    """iOS-style squircle (superellipse approximation) mask."""
    mask = Image.new("L", (size, size), 0)
    draw = ImageDraw.Draw(mask)
    r = int(size * radius_ratio)
    draw.rounded_rectangle((0, 0, size - 1, size - 1), radius=r, fill=255)
    return mask


def make_radial_gradient(size: int, inner, outer) -> Image.Image:
    """Subtle radial gradient: inner color in center -> outer color at edges."""
    img = Image.new("RGBA", (size, size), inner)
    px = img.load()
    cx = cy = size / 2
    max_d = (cx ** 2 + cy ** 2) ** 0.5
    for y in range(size):
        for x in range(size):
            d = ((x - cx) ** 2 + (y - cy) ** 2) ** 0.5 / max_d
            d = min(1.0, d ** 1.4)  # ease curve
            r = int(inner[0] * (1 - d) + outer[0] * d)
            g = int(inner[1] * (1 - d) + outer[1] * d)
            b = int(inner[2] * (1 - d) + outer[2] * d)
            px[x, y] = (r, g, b, 255)
    return img


def draw_court_lines(img: Image.Image, alpha: int = 38) -> None:
    """Subtle padel court overlay: outer rectangle, service line, center line, mesh."""
    size = img.size[0]
    overlay = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(overlay)
    line_col = (255, 255, 255, alpha)
    thick = max(2, size // 256)

    # Outer court rectangle (margin)
    m = int(size * 0.18)
    d.rectangle((m, m, size - m, size - m), outline=line_col, width=thick)

    # Horizontal service line (slightly above center)
    sy = int(size * 0.42)
    d.line((m, sy, size - m, sy), fill=line_col, width=thick)

    # Vertical center line (below service line)
    cx = size // 2
    d.line((cx, sy, cx, size - m), fill=line_col, width=thick)

    # Net at vertical center
    ny = size // 2
    d.line((m, ny, size - m, ny), fill=(255, 255, 255, alpha + 25), width=thick + 1)

    # Mesh dots along the net
    for x in range(m + 12, size - m, 22):
        d.ellipse((x - 1, ny - 1, x + 1, ny + 1), fill=(255, 255, 255, 70))

    img.alpha_composite(overlay)


def draw_padel_ball(img: Image.Image) -> None:
    """Draw a stylized padel ball with seam, highlight, and shadow."""
    size = img.size[0]
    cx = size // 2
    cy = int(size * 0.54)  # slightly below center for visual balance
    r = int(size * 0.22)

    # Outer soft shadow
    shadow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow)
    sd.ellipse((cx - r, cy - r + int(r * 0.18),
                cx + r, cy + r + int(r * 0.28)),
               fill=(0, 0, 0, 90))
    shadow = shadow.filter(ImageFilter.GaussianBlur(radius=int(r * 0.18)))
    img.alpha_composite(shadow)

    # Ball body
    body = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    bd = ImageDraw.Draw(body)
    bd.ellipse((cx - r, cy - r, cx + r, cy + r), fill=BALL_YELLOW)
    img.alpha_composite(body)

    # Top-left highlight (glossy)
    hl = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    hd = ImageDraw.Draw(hl)
    hr = int(r * 0.55)
    hd.ellipse(
        (cx - r * 0.55, cy - r * 0.78, cx - r * 0.55 + hr * 1.6, cy - r * 0.78 + hr * 1.1),
        fill=(255, 255, 255, 90),
    )
    hl = hl.filter(ImageFilter.GaussianBlur(radius=int(r * 0.12)))
    img.alpha_composite(hl)

    # Seam curve (classic tennis/padel ball curve)
    seam = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    sd2 = ImageDraw.Draw(seam)
    seam_col = (255, 255, 255, 240)
    seam_w = max(4, int(r * 0.06))
    # Left arc (upper-left to lower-right curve)
    sd2.arc((cx - int(r * 1.55), cy - int(r * 0.55),
             cx + int(r * 0.05), cy + int(r * 1.55)),
            start=295, end=355, fill=seam_col, width=seam_w)
    # Right arc mirrored
    sd2.arc((cx - int(r * 0.05), cy - int(r * 1.55),
             cx + int(r * 1.55), cy + int(r * 0.55)),
            start=115, end=175, fill=seam_col, width=seam_w)
    img.alpha_composite(seam)


def build_icon(size: int = SIZE, with_padding: float = 0.0) -> Image.Image:
    # Base radial gradient
    base = make_radial_gradient(size, EMERALD, EMERALD_DARK)
    # Add court lines
    draw_court_lines(base)
    # Padel ball
    draw_padel_ball(base)

    # Apply squircle mask
    mask = squircle_mask(size)
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(base, (0, 0), mask)

    # Optional padding (for adaptive-icon safe zone on Android)
    if with_padding > 0:
        pad = int(size * with_padding)
        canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        scaled = out.resize((size - 2 * pad, size - 2 * pad), Image.LANCZOS)
        canvas.paste(scaled, (pad, pad), scaled)
        out = canvas

    return out


def main() -> None:
    print("Building app icons...")

    # Main icon (used for iOS / web)
    icon = build_icon(SIZE)
    icon.save(ASSETS / "icon.png", "PNG", optimize=True)
    print(f"  icon.png            -> {(ASSETS / 'icon.png').stat().st_size // 1024} KB")

    # Splash icon (same image, will be centered on splash bg via app.json)
    icon.save(ASSETS / "splash-icon.png", "PNG", optimize=True)
    print(f"  splash-icon.png     -> {(ASSETS / 'splash-icon.png').stat().st_size // 1024} KB")

    # Adaptive icon (Android) - foreground with safe-zone padding
    adaptive = build_icon(SIZE, with_padding=0.15)
    adaptive.save(ASSETS / "adaptive-icon.png", "PNG", optimize=True)
    print(f"  adaptive-icon.png   -> {(ASSETS / 'adaptive-icon.png').stat().st_size // 1024} KB")

    # Favicon (web)
    favicon = icon.resize((256, 256), Image.LANCZOS)
    favicon.save(ASSETS / "favicon.png", "PNG", optimize=True)
    print(f"  favicon.png         -> {(ASSETS / 'favicon.png').stat().st_size // 1024} KB")

    print("DONE")


if __name__ == "__main__":
    main()
