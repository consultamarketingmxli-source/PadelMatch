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
