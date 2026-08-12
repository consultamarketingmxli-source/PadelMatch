"""
legal_pages.py — Rutas HTML públicas para páginas legales.

Sirve páginas HTML autocontenidas (sin dependencia de JS) para:
  • /privacy  → Política de Privacidad
  • /terms    → Términos y Condiciones (futuro)

Motivación:
  Google Play, Apple App Store y clientes de email requieren URLs públicas
  de la política de privacidad que devuelvan HTML válido incluso cuando el
  bundle de la SPA no ha cargado (crawlers, previews de link, curl).

Fuente de contenido:
  El contenido "canónico" vive en el frontend en `/app/frontend/src/content/
  legal.ts` para consumo por la app React Native. Aquí se REPLICA el texto
  para consumo HTML puro. Si actualizas uno, ACTUALIZA EL OTRO — y bumpea
  `legal_versions.PRIVACY_VERSION` para forzar re-consentimiento.

Diseño:
  HTML minimalista con CSS inline (sin fetches externos), tipografía system
  sans-serif, ancho contenido a 720px, mobile-friendly con viewport meta.
"""
from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import HTMLResponse

router = APIRouter(tags=["legal-pages"])

LEGAL_ENTITY = "PadelAppRetas"
LEGAL_CONTACT_EMAIL = "legal@padelappretas.com"
LEGAL_EFFECTIVE_DATE = "30 de mayo de 2026"

# Espejo exacto de PRIVACY_SECTIONS en /app/frontend/src/content/legal.ts
_PRIVACY_SECTIONS: list[tuple[str, str]] = [
    (
        "1. Responsable del tratamiento",
        f"{LEGAL_ENTITY}, con dirección electrónica de contacto "
        f"{LEGAL_CONTACT_EMAIL}, es responsable del tratamiento de tus "
        "datos personales conforme a la Ley Federal de Protección de Datos "
        "Personales en Posesión de los Particulares (LFPDPPP) y, cuando "
        "aplique, al GDPR.",
    ),
    (
        "2. Datos que recolectamos",
        "• Identificación: nombre, teléfono, email (admin), foto opcional.\n"
        "• Ubicación aproximada (cuando autorices el GPS para encontrar "
        "retas cercanas).\n"
        "• Datos técnicos: IP, user-agent, eventos de inicio de sesión.\n"
        "• Histórico de inscripciones y resultados deportivos.",
    ),
    (
        "3. Finalidades primarias",
        "(a) Operar la Plataforma y permitir tu participación en retas.\n"
        "(b) Procesar pagos a través de Mercado Pago.\n"
        "(c) Notificarte eventos relevantes (recordatorios, cambios).\n"
        "(d) Detectar y prevenir fraude o uso indebido.",
    ),
    (
        "4. Finalidades secundarias",
        "Métricas agregadas y anónimas para mejorar la app. Puedes oponerte "
        f"a este tratamiento escribiendo a {LEGAL_CONTACT_EMAIL}.",
    ),
    (
        "5. Transferencias",
        "Compartimos datos mínimos con: Mercado Pago (proceso de pagos), "
        "Twilio (envío de OTP por WhatsApp/SMS), proveedores de "
        "infraestructura cloud. Ningún dato se vende a terceros con fines "
        "publicitarios.",
    ),
    (
        "6. Derechos ARCO",
        "Tienes derecho a Acceder, Rectificar, Cancelar u Oponerte al uso "
        f"de tus datos. Puedes ejercer estos derechos escribiendo a "
        f"{LEGAL_CONTACT_EMAIL} o desde la app en Configuración → "
        "Eliminar cuenta.",
    ),
    (
        "7. Seguridad",
        "Aplicamos cifrado en tránsito (HTTPS), almacenamiento seguro de "
        "tokens en Keychain (iOS) / Keystore (Android), JWT de corta vida "
        "(15 min), rotación de refresh tokens, lockout anti-brute-force y "
        "registro de auditoría.",
    ),
    (
        "8. Conservación",
        "Conservamos tus datos mientras tu cuenta esté activa. Tras "
        "eliminar tu cuenta, los datos personales son anonimizados de forma "
        "IRREVERSIBLE (conforme a Apple 5.1.1), conservando únicamente los "
        "datos mínimos necesarios para integridad de torneos históricos.",
    ),
    (
        "9. Menores de edad",
        "La Plataforma está dirigida a usuarios mayores de 13 años. "
        "Menores de edad deben contar con autorización de padre/madre/tutor.",
    ),
    (
        "10. Cambios en esta política",
        "Notificaremos cambios sustantivos. La fecha de última "
        "actualización aparece en el encabezado de este documento.",
    ),
]


def _html_escape(s: str) -> str:
    return (
        s.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def _render_privacy_html() -> str:
    """Renderiza la Política de Privacidad como HTML autocontenido."""
    sections_html = "\n".join(
        f"""    <section>
      <h2>{_html_escape(title)}</h2>
      <p>{_html_escape(body).replace(chr(10), '<br>')}</p>
    </section>"""
        for title, body in _PRIVACY_SECTIONS
    )
    return f"""<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Política de Privacidad — {LEGAL_ENTITY}</title>
  <meta name="description" content="Política de Privacidad oficial de {LEGAL_ENTITY} — vigente desde el {LEGAL_EFFECTIVE_DATE}.">
  <meta name="robots" content="index, follow">
  <link rel="canonical" href="/privacy">
  <style>
    :root {{ color-scheme: light dark; }}
    * {{ box-sizing: border-box; }}
    html, body {{ margin: 0; padding: 0; }}
    body {{
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      background: #F8FAFC;
      color: #0F172A;
      line-height: 1.55;
      -webkit-font-smoothing: antialiased;
    }}
    .wrap {{
      max-width: 720px;
      margin: 0 auto;
      padding: 48px 24px 96px;
    }}
    header {{
      border-bottom: 1px solid #E2E8F0;
      padding-bottom: 24px;
      margin-bottom: 32px;
    }}
    h1 {{
      font-size: 28px;
      font-weight: 700;
      margin: 0 0 8px;
      color: #0F172A;
      letter-spacing: -0.02em;
    }}
    header p {{
      color: #475569;
      font-size: 14px;
      margin: 0;
    }}
    h2 {{
      font-size: 17px;
      font-weight: 700;
      margin: 32px 0 8px;
      color: #0F172A;
    }}
    p {{
      font-size: 15px;
      color: #1E293B;
      margin: 0 0 16px;
    }}
    footer {{
      margin-top: 48px;
      padding-top: 24px;
      border-top: 1px solid #E2E8F0;
      color: #64748B;
      font-size: 13px;
    }}
    footer a {{ color: #2563EB; text-decoration: none; }}
    footer a:hover {{ text-decoration: underline; }}
    @media (prefers-color-scheme: dark) {{
      body {{ background: #0F172A; color: #F1F5F9; }}
      header {{ border-color: #1E293B; }}
      h1, h2 {{ color: #F1F5F9; }}
      p {{ color: #CBD5E1; }}
      header p {{ color: #94A3B8; }}
      footer {{ border-color: #1E293B; color: #94A3B8; }}
    }}
  </style>
</head>
<body>
  <main class="wrap" role="main">
    <header>
      <h1>Política de Privacidad</h1>
      <p>Vigente desde el {LEGAL_EFFECTIVE_DATE} · Versión 1.0</p>
    </header>
{sections_html}
    <footer>
      <p>
        ¿Tienes preguntas sobre esta política? Escríbenos a
        <a href="mailto:{LEGAL_CONTACT_EMAIL}">{LEGAL_CONTACT_EMAIL}</a>.
      </p>
      <p>© {LEGAL_ENTITY}. Todos los derechos reservados.</p>
    </footer>
  </main>
</body>
</html>
"""


# Renderizamos una sola vez al import — el contenido es estático.
_PRIVACY_HTML = _render_privacy_html()


@router.api_route(
    "/privacy",
    methods=["GET", "HEAD"],
    include_in_schema=False,
    response_class=HTMLResponse,
)
async def privacy_html() -> HTMLResponse:
    """Sirve la Política de Privacidad como HTML autocontenido en /privacy.

    Compatible con:
      • Google Play Store data safety review (requiere URL pública)
      • Apple App Store privacy policy URL (requiere URL pública)
      • Crawlers de indexación (Googlebot, Bingbot)
      • Preview de enlaces en WhatsApp/Twitter/Slack (Open Graph opcional)
      • curl / wget para verificaciones automáticas de disponibilidad
    """
    return HTMLResponse(
        content=_PRIVACY_HTML,
        status_code=200,
        headers={
            # 1h cache pública — el contenido cambia por versionado, no por request.
            "Cache-Control": "public, max-age=3600",
        },
    )
