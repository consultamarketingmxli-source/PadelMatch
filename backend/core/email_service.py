"""
EmailService — envío de correos transaccionales provider-agnostic.

Soporta `resend` y `sendgrid` controlados vía env var `EMAIL_PROVIDER`.
Si no hay API key configurada, opera en modo NOOP (loguea y skip) para que
los flujos de pago no se rompan en dev / antes de configurar credenciales.

ENV VARS:
    EMAIL_PROVIDER   = "resend" | "sendgrid" | "" (vacío = deshabilitado)
    EMAIL_API_KEY    = re_... | SG.... | ""
    EMAIL_FROM       = "PadelappRetas <no-reply@padelappretas.com>"
    EMAIL_REPLY_TO   = "soporte@padelappretas.com" (opcional)

USO:
    from core.email_service import email_service
    await email_service.send_inscripcion_confirmada(
        to="jugador@example.com",
        jugador="Juan",
        reta_nombre="Reta Demo",
        club="Padel Club CDMX",
        fecha_evento="mar 16 jun, 19:00",
        inscripcion_id="abc-123",
        reta_slug="reta-demo",
    )

CIRCUIT BREAKER:
    El envío se hace dentro de `safe_run` (no propaga excepciones), así si
    Resend/SendGrid están caídos, la confirmación del pago NO se rompe.
"""
from __future__ import annotations

import logging
import os
from typing import Any, Optional

import httpx

from core.circuit import safe_run

logger = logging.getLogger("padelappretas-os.email")

# ---- Configuración leída del entorno ----
PROVIDER = (os.getenv("EMAIL_PROVIDER", "") or "").strip().lower()
API_KEY = (os.getenv("EMAIL_API_KEY", "") or "").strip()
FROM_EMAIL = (os.getenv("EMAIL_FROM", "") or "PadelappRetas <onboarding@resend.dev>").strip()
REPLY_TO = (os.getenv("EMAIL_REPLY_TO", "") or "").strip() or None

# Si APP_PUBLIC_URL existe se usa para links absolutos en los emails.
APP_PUBLIC_URL = (os.getenv("APP_PUBLIC_URL", "") or "").rstrip("/")


def _email_enabled() -> bool:
    return bool(PROVIDER) and bool(API_KEY)


# ===========================================================================
# Plantillas HTML — estética Club Pro Clean (slate-50 + emerald-600 + Inter)
# ===========================================================================
def _render_inscripcion_confirmada(
    *,
    jugador: str,
    reta_nombre: str,
    club: str,
    fecha_evento: str,
    inscripcion_id: str,
    reta_slug: str,
) -> str:
    cta = (
        f"{APP_PUBLIC_URL}/retas/{reta_slug}" if APP_PUBLIC_URL else f"/retas/{reta_slug}"
    )
    return f"""\
<!doctype html>
<html lang="es">
  <body style="margin:0;padding:0;background:#F8FAFC;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0F172A;">
    <div style="max-width:560px;margin:0 auto;padding:32px 24px;">
      <div style="font-weight:900;font-size:20px;letter-spacing:-0.4px;margin-bottom:24px;">
        <span style="color:#0F172A;">Padel</span><span style="color:#059669;">AppRetas</span>
      </div>

      <div style="background:#FFFFFF;border:1px solid #E2E8F0;border-radius:14px;padding:28px;">
        <div style="font-size:11px;font-weight:800;letter-spacing:1.2px;text-transform:uppercase;color:#059669;margin-bottom:8px;">
          INSCRIPCIÓN CONFIRMADA
        </div>
        <h1 style="margin:0 0 8px;font-size:24px;line-height:28px;letter-spacing:-0.6px;">
          ¡Listo, {jugador}! Tu lugar está confirmado.
        </h1>
        <p style="margin:0 0 20px;font-size:15px;line-height:22px;color:#334155;">
          Tu pago se procesó correctamente. Llega 10 min antes para calentar.
        </p>

        <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
          <tr>
            <td style="padding:10px 0;border-bottom:1px solid #F1F5F9;color:#64748B;font-size:13px;">Reta</td>
            <td style="padding:10px 0;border-bottom:1px solid #F1F5F9;font-weight:600;font-size:14px;text-align:right;">{reta_nombre}</td>
          </tr>
          <tr>
            <td style="padding:10px 0;border-bottom:1px solid #F1F5F9;color:#64748B;font-size:13px;">Club</td>
            <td style="padding:10px 0;border-bottom:1px solid #F1F5F9;font-weight:600;font-size:14px;text-align:right;">{club}</td>
          </tr>
          <tr>
            <td style="padding:10px 0;border-bottom:1px solid #F1F5F9;color:#64748B;font-size:13px;">Fecha</td>
            <td style="padding:10px 0;border-bottom:1px solid #F1F5F9;font-weight:600;font-size:14px;text-align:right;">{fecha_evento}</td>
          </tr>
          <tr>
            <td style="padding:10px 0;color:#64748B;font-size:13px;">ID Inscripción</td>
            <td style="padding:10px 0;font-family:'JetBrains Mono',Menlo,monospace;font-size:12px;text-align:right;color:#334155;">{inscripcion_id}</td>
          </tr>
        </table>

        <a href="{cta}" style="display:block;background:#059669;color:#FFFFFF;text-align:center;padding:14px 20px;border-radius:10px;text-decoration:none;font-weight:800;letter-spacing:0.6px;font-size:14px;text-transform:uppercase;">
          Ver mi reta
        </a>

        <p style="margin:24px 0 0;font-size:12px;line-height:18px;color:#64748B;text-align:center;">
          Si no puedes asistir, avisa con al menos 24 hs de anticipación para liberar tu lugar.
        </p>
      </div>

      <p style="margin:16px 0 0;font-size:11px;color:#94A3B8;text-align:center;">
        Este email fue enviado por PadelappRetas. Si no reconoces esta inscripción, ignóralo.
      </p>
    </div>
  </body>
</html>"""


# ===========================================================================
# Backends de envío (Resend / SendGrid)
# ===========================================================================
async def _send_resend(*, to: str, subject: str, html: str) -> bool:
    """https://resend.com/docs/api-reference/emails/send-email"""
    headers = {
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "application/json",
    }
    payload: dict[str, Any] = {
        "from": FROM_EMAIL,
        "to": [to],
        "subject": subject,
        "html": html,
    }
    if REPLY_TO:
        payload["reply_to"] = REPLY_TO

    async with httpx.AsyncClient(timeout=8.0) as client:
        r = await client.post(
            "https://api.resend.com/emails",
            headers=headers,
            json=payload,
        )
        if r.status_code >= 300:
            logger.warning("resend send failed status=%s body=%s", r.status_code, r.text[:300])
            return False
        return True


async def _send_sendgrid(*, to: str, subject: str, html: str) -> bool:
    """https://docs.sendgrid.com/api-reference/mail-send/mail-send"""
    headers = {
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "application/json",
    }
    payload: dict[str, Any] = {
        "personalizations": [{"to": [{"email": to}]}],
        "from": {"email": FROM_EMAIL},
        "subject": subject,
        "content": [{"type": "text/html", "value": html}],
    }
    if REPLY_TO:
        payload["reply_to"] = {"email": REPLY_TO}

    async with httpx.AsyncClient(timeout=8.0) as client:
        r = await client.post(
            "https://api.sendgrid.com/v3/mail/send",
            headers=headers,
            json=payload,
        )
        if r.status_code >= 300:
            logger.warning("sendgrid send failed status=%s body=%s", r.status_code, r.text[:300])
            return False
        return True


# ===========================================================================
# Service público — fire-and-forget seguro
# ===========================================================================
class EmailService:
    @property
    def enabled(self) -> bool:
        return _email_enabled()

    async def _send(self, *, to: str, subject: str, html: str) -> bool:
        if not _email_enabled():
            logger.info("[email NOOP] provider=%s key_set=%s to=%s subject=%s",
                        PROVIDER or "(none)", bool(API_KEY), to, subject)
            return False
        if PROVIDER == "resend":
            return await _send_resend(to=to, subject=subject, html=html)
        if PROVIDER == "sendgrid":
            return await _send_sendgrid(to=to, subject=subject, html=html)
        logger.warning("Unknown EMAIL_PROVIDER=%s — skipping", PROVIDER)
        return False

    async def send_otp_code(
        self,
        *,
        to: str,
        codigo: str,
        ttl_minutes: int = 10,
    ) -> bool:
        """Envía un código OTP de 6 dígitos vía email para login sin contraseña.

        Diseño mobile-first: tablas + estilos inline, código en tamaño gigante
        para copia visual. Sin imágenes externas para máxima entregabilidad.
        Templado en español (mercado principal: México).
        """
        if not to:
            return False
        subject = f"Tu código PadelappRetas: {codigo}"
        html = f"""<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F8FAFC;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#F8FAFC;padding:32px 0;">
    <tr><td align="center">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:480px;background:#FFFFFF;border-radius:14px;padding:32px 28px;border:1px solid #E2E8F0;">
        <tr><td align="center" style="padding-bottom:16px;">
          <div style="font-size:22px;font-weight:700;color:#0F172A;letter-spacing:-0.02em;">
            Padel<span style="color:#2563EB;">AppRetas</span>
          </div>
        </td></tr>
        <tr><td align="center" style="padding:8px 0 24px;">
          <div style="font-size:13px;color:#64748B;letter-spacing:2px;text-transform:uppercase;">Tu código de acceso</div>
        </td></tr>
        <tr><td align="center" style="padding:12px 0 24px;">
          <div style="font-size:44px;font-weight:800;color:#0F172A;letter-spacing:8px;font-variant-numeric:tabular-nums;background:#F1F5F9;padding:20px 24px;border-radius:10px;display:inline-block;">
            {codigo}
          </div>
        </td></tr>
        <tr><td align="center" style="padding:0 8px;">
          <p style="font-size:15px;color:#334155;line-height:1.55;margin:0 0 12px;">
            Ingresá este código en la app para acceder a tu cuenta.
          </p>
          <p style="font-size:13px;color:#64748B;line-height:1.5;margin:0 0 24px;">
            El código vence en <strong style="color:#334155;">{ttl_minutes} minutos</strong>.
            Si vos no solicitaste este código, ignorá este correo.
          </p>
        </td></tr>
        <tr><td align="center" style="padding-top:24px;border-top:1px solid #E2E8F0;">
          <p style="font-size:11px;color:#94A3B8;line-height:1.5;margin:0;">
            Nunca compartas este código. Nadie del equipo PadelAppRetas te lo va a pedir.<br>
            © PadelAppRetas · Enviado a {to}
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>"""
        ok, _ = await safe_run(
            lambda: self._send(to=to, subject=subject, html=html),
            label=f"email:otp:{to}",
            timeout_s=10.0,
        )
        return ok

    async def send_inscripcion_confirmada(        self,
        *,
        to: Optional[str],
        jugador: str,
        reta_nombre: str,
        club: str,
        fecha_evento: str,
        inscripcion_id: str,
        reta_slug: str,
    ) -> bool:
        """Envia confirmación de inscripción. Silenciosamente skip si no hay email."""
        if not to:
            logger.info("send_inscripcion_confirmada skipped (no email) insc=%s", inscripcion_id)
            return False
        subject = f"Inscripción confirmada: {reta_nombre}"
        html = _render_inscripcion_confirmada(
            jugador=jugador,
            reta_nombre=reta_nombre,
            club=club,
            fecha_evento=fecha_evento,
            inscripcion_id=inscripcion_id,
            reta_slug=reta_slug,
        )
        ok, _ = await safe_run(
            lambda: self._send(to=to, subject=subject, html=html),
            label=f"email:inscripcion_confirmada:{inscripcion_id}",
            timeout_s=10.0,
        )
        return ok


email_service = EmailService()
