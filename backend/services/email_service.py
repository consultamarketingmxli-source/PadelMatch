"""Email service — Resend transactional emails (waitlist promotion + others).

Diseño Clean-Architecture:
  - Function `send_waitlist_promotion_email` es el único punto de entrada externo
    relevante para este sprint.
  - El servicio NO debe bloquear el flujo de promoción: errores se loggean y
    retornan `False` para que el caller continúe (Push aún funciona).
  - Idempotente: el caller pasa una `idempotency_key` que se loggea para auditar
    duplicados en caso de retries.
"""
from __future__ import annotations

import logging
import os
from typing import Optional

import resend  # type: ignore

logger = logging.getLogger("padelappretas.email")

# Inicialización lazy en el primer uso.
_initialized = False


def _ensure_init() -> bool:
    """Configura el SDK de Resend. Retorna False si no hay key (modo dev)."""
    global _initialized
    if _initialized:
        return True
    api_key = os.getenv("RESEND_API_KEY")
    if not api_key or api_key == "placeholder":
        logger.warning("[email] RESEND_API_KEY no configurada — modo no-op")
        return False
    resend.api_key = api_key
    _initialized = True
    return True


def _branded_template(player_name: str, reta_name: str, deeplink: str, ttl_min: int) -> str:
    """Template HTML branded navy/azure premium · 15 min countdown."""
    return f"""
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#F8FAFC;">
  <table cellpadding="0" cellspacing="0" width="100%" style="max-width:560px;margin:24px auto;background:#FFFFFF;border-radius:16px;overflow:hidden;border:1px solid #E2E8F0">
    <tr>
      <td style="background:#0F172A;padding:32px 28px;text-align:center">
        <div style="display:inline-block;background:rgba(96,165,250,0.18);color:#60A5FA;padding:6px 12px;border-radius:999px;font-size:11px;font-weight:800;letter-spacing:0.8px">
          ⚡ TU CUPO ESTÁ DISPONIBLE
        </div>
        <h1 style="color:#FFFFFF;font-size:24px;font-weight:800;margin:14px 0 6px;letter-spacing:-0.5px">¡Hola, {player_name}!</h1>
        <p style="color:rgba(255,255,255,0.7);font-size:14px;margin:0;line-height:20px">
          Se liberó un cupo en <strong style="color:#FFFFFF">{reta_name}</strong>
        </p>
      </td>
    </tr>
    <tr>
      <td style="padding:28px 28px 8px">
        <p style="color:#1E293B;font-size:15px;line-height:22px;margin:0 0 18px">
          Tienes <strong style="color:#2563EB">{ttl_min} minutos exactos</strong> para
          completar tu pago y asegurar tu lugar antes de que el cupo pase al siguiente
          jugador en la lista de espera.
        </p>
        <table cellpadding="0" cellspacing="0" align="center" style="margin:8px auto 20px">
          <tr>
            <td style="background:#2563EB;border-radius:12px;padding:14px 28px">
              <a href="{deeplink}" style="color:#FFFFFF;font-size:15px;font-weight:800;text-decoration:none;letter-spacing:-0.2px">
                Pagar e Inscribirme →
              </a>
            </td>
          </tr>
        </table>
        <div style="background:#ECFDF5;border:1px solid #A7F3D0;border-radius:10px;padding:12px 14px;margin-bottom:8px">
          <p style="margin:0;color:#065F46;font-size:12px;line-height:18px">
            🛡️ <strong>FIFO garantizado.</strong> Si no confirmas en {ttl_min} minutos, el cupo
            pasa al siguiente jugador automáticamente.
          </p>
        </div>
      </td>
    </tr>
    <tr>
      <td style="padding:20px 28px;border-top:1px solid #E2E8F0;background:#F8FAFC;text-align:center">
        <p style="color:#94A3B8;font-size:11px;margin:0;line-height:16px">
          Enviado por PadelAppRetas · Si no fuiste tú quien se anotó, ignora este correo.
        </p>
      </td>
    </tr>
  </table>
</body>
</html>
""".strip()


async def send_waitlist_promotion_email(
    *,
    to_email: str,
    player_name: str,
    reta_name: str,
    deeplink: str,
    ttl_min: int = 15,
    idempotency_key: Optional[str] = None,
) -> bool:
    """Envía el correo de promoción FIFO con template branded.

    Args:
        to_email: Destinatario.
        player_name: Nombre del jugador (saludo personalizado).
        reta_name: Nombre de la reta.
        deeplink: URL completa al checkout (ej: https://<host>/retas/<slug>).
        ttl_min: Minutos antes de expirar (default 15).
        idempotency_key: Para auditar retries (jugador_id + reta_id típicamente).

    Returns:
        True si Resend aceptó (HTTP 200) · False en cualquier otra situación.
        Nunca lanza excepciones (no debe romper el flow de promoción).
    """
    if not _ensure_init():
        return False
    if not to_email or "@" not in to_email:
        logger.warning("[email] skip · email inválido para %s", player_name)
        return False
    from_email = os.getenv("RESEND_FROM_EMAIL", "PadelAppRetas <onboarding@resend.dev>")
    subject = f"⚡ Tu cupo está disponible — {reta_name} · {ttl_min} min"
    html = _branded_template(player_name, reta_name, deeplink, ttl_min)
    try:
        # SDK es sync; lo corremos en threadpool para no bloquear event loop.
        import asyncio
        params = {
            "from": from_email,
            "to": [to_email],
            "subject": subject,
            "html": html,
            "tags": [
                {"name": "category", "value": "waitlist_promotion"},
                *([{"name": "idem", "value": idempotency_key}] if idempotency_key else []),
            ],
        }
        res = await asyncio.to_thread(resend.Emails.send, params)
        msg_id = (res or {}).get("id") if isinstance(res, dict) else None
        logger.info(
            "[email] promoción enviada · to=%s reta='%s' resend_id=%s idem=%s",
            to_email, reta_name, msg_id, idempotency_key,
        )
        return True
    except Exception as e:  # pylint: disable=broad-except
        logger.warning(
            "[email] envío falló · to=%s err=%s idem=%s",
            to_email, str(e)[:120], idempotency_key,
        )
        return False


# ════════════════════════════════════════════════════════════════════════════
# ITER51 — Notificaciones Open Reta Pre-auth
# ════════════════════════════════════════════════════════════════════════════
async def _send_via_resend(*, to: str, subject: str, html: str, tag: str = "open_reta") -> bool:
    """Wrapper genérico de envío via Resend. No lanza excepciones."""
    if not _ensure_init():
        return False
    if not to or "@" not in to:
        return False
    from_email = os.getenv("RESEND_FROM_EMAIL", "PadelAppRetas <onboarding@resend.dev>")
    try:
        import asyncio
        params = {
            "from": from_email,
            "to": [to],
            "subject": subject,
            "html": html,
            "tags": [{"name": "category", "value": tag}],
        }
        res = await asyncio.to_thread(resend.Emails.send, params)
        msg_id = (res or {}).get("id") if isinstance(res, dict) else None
        logger.info("[email] %s enviado · to=%s resend_id=%s", tag, to, msg_id)
        return True
    except Exception as e:  # pylint: disable=broad-except
        logger.warning("[email] %s falló · to=%s err=%s", tag, to, str(e)[:120])
        return False


async def send_join_request_approved(
    *, to: str, reta_nombre: str, fecha_evento: str, amount: float,
) -> bool:
    """Email de confirmación cuando el organizador aprueba el join_request."""
    if not to:
        return False
    subject = f"¡Aprobado! Tu cupo en {reta_nombre} está confirmado"
    html = f"""
    <div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;max-width:520px;margin:auto;padding:24px;background:#f8fafc">
      <div style="background:#fff;border-radius:16px;padding:32px;box-shadow:0 2px 12px rgba(0,0,0,0.06)">
        <div style="background:#10B981;width:56px;height:56px;border-radius:28px;display:flex;align-items:center;justify-content:center;margin:0 auto 20px">
          <span style="color:#fff;font-size:28px">✓</span>
        </div>
        <h1 style="color:#0F172A;text-align:center;font-size:22px;margin:0 0 12px">¡Cupo confirmado!</h1>
        <p style="color:#475569;line-height:1.6;text-align:center;font-size:15px">
          El organizador aprobó tu solicitud para <b>{reta_nombre}</b>.
        </p>
        <div style="background:#f1f5f9;border-radius:12px;padding:16px;margin:20px 0">
          <p style="margin:4px 0;color:#334155"><b>Fecha:</b> {fecha_evento}</p>
          <p style="margin:4px 0;color:#334155"><b>Cargo realizado:</b> ${amount:.2f} MXN</p>
        </div>
        <p style="color:#94a3b8;font-size:13px;text-align:center;margin-top:24px">
          Nos vemos en la cancha 🎾
        </p>
      </div>
    </div>
    """
    return await _send_via_resend(to=to, subject=subject, html=html)


async def send_join_request_rejected(
    *, to: str, reta_nombre: str, motivo: Optional[str] = None,
) -> bool:
    """Email cuando el organizador rechaza (o auto-expira) el join_request.

    Aclaramos explícitamente que el hold fue LIBERADO (0% comisión).
    """
    if not to:
        return False
    subject = f"Actualización sobre tu solicitud para {reta_nombre}"
    razon = motivo or "El organizador no pudo confirmar tu lugar en esta ocasión."
    html = f"""
    <div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;max-width:520px;margin:auto;padding:24px;background:#f8fafc">
      <div style="background:#fff;border-radius:16px;padding:32px;box-shadow:0 2px 12px rgba(0,0,0,0.06)">
        <h1 style="color:#0F172A;font-size:22px;margin:0 0 12px">Tu solicitud no se completó</h1>
        <p style="color:#475569;line-height:1.6;font-size:15px">
          Sobre tu solicitud para <b>{reta_nombre}</b>:
        </p>
        <div style="background:#fef3c7;border-radius:12px;padding:16px;margin:20px 0;border-left:4px solid #f59e0b">
          <p style="margin:0;color:#78350f;font-size:14px">{razon}</p>
        </div>
        <div style="background:#ecfdf5;border-radius:12px;padding:16px;margin:16px 0;border-left:4px solid #10b981">
          <p style="margin:0;color:#065f46;font-size:14px">
            <b>✓ La retención de tu tarjeta fue liberada al 100%.</b><br>
            No se realizó ningún cargo. Los fondos vuelven a estar disponibles.
          </p>
        </div>
        <p style="color:#94a3b8;font-size:13px;text-align:center;margin-top:24px">
          Sigue buscando retas activas en la app.
        </p>
      </div>
    </div>
    """
    return await _send_via_resend(to=to, subject=subject, html=html)

