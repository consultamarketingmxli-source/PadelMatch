"""
Notificaciones WhatsApp via Twilio Sandbox.

- Lee credenciales en cada llamada (resilient a hot-reload de .env).
- Si no hay credenciales: fallback automático a mock con log.
- Si Twilio responde 63015 (recipient no se unió al sandbox): se loguea con instrucciones
  pero no se considera error crítico (el sender lo verá en logs admin).
- Para Sandbox: el usuario debe enviar "join busy-crack" al +14155238886 ANTES de
  poder recibir mensajes.
"""
import asyncio
import logging
import os
from typing import Optional

logger = logging.getLogger("notifications")


def _get_creds() -> tuple[Optional[str], Optional[str], Optional[str], Optional[str]]:
    """Lee credenciales en runtime (no en import time)."""
    return (
        os.getenv("TWILIO_ACCOUNT_SID", "").strip() or None,
        os.getenv("TWILIO_AUTH_TOKEN", "").strip() or None,
        os.getenv("TWILIO_WHATSAPP_FROM", "").strip() or None,
        os.getenv("TWILIO_JOIN_CODE", "").strip() or None,
    )


def is_twilio_configured() -> bool:
    sid, token, frm, _ = _get_creds()
    # WHATSAPP_FORCE_MOCK=true permite forzar mock incluso con Twilio configurado
    # (útil para tests automatizados que de otra forma agotarían el límite del sandbox)
    force_mock = os.getenv("WHATSAPP_FORCE_MOCK", "").strip().lower() in ("1", "true", "yes")
    if force_mock:
        return False
    return bool(sid and token and frm)


def get_join_instructions() -> str:
    """Mensaje de instrucciones para que un usuario se una al sandbox."""
    _, _, frm, join_code = _get_creds()
    sandbox_num = (frm or "whatsapp:+14155238886").replace("whatsapp:", "")
    code = join_code or "join YOUR-CODE"
    return (
        f'Envía "{code}" por WhatsApp al {sandbox_num} para activar tus notificaciones.'
    )


def _format_to(to: str) -> str:
    return to if to.startswith("whatsapp:") else f"whatsapp:{to}"


def _send_sync(sid: str, token: str, frm: str, to: str, body: str) -> dict:
    """Llamada sincrónica al SDK de Twilio. Se ejecuta en threadpool desde async.
    Timeout interno HTTP de 8s para no congelar el event loop si Twilio responde lento.
    """
    from twilio.base.exceptions import TwilioRestException
    from twilio.http.http_client import TwilioHttpClient
    from twilio.rest import Client
    try:
        # TwilioHttpClient acepta `timeout` para todas las llamadas HTTP del SDK.
        http_client = TwilioHttpClient(timeout=8)
        client = Client(sid, token, http_client=http_client)
        msg = client.messages.create(from_=frm, to=to, body=body)
        return {"status": "sent", "sid": msg.sid}
    except TwilioRestException as exc:
        code = getattr(exc, "code", None)
        return {
            "status": "error",
            "twilio_code": code,
            "http_status": getattr(exc, "status", None),
            "detail": str(getattr(exc, "msg", exc)),
        }
    except Exception as exc:
        return {"status": "error", "detail": str(exc)}


async def send_whatsapp(to: str, body: str) -> dict:
    """Envía mensaje WhatsApp con timeout duro y retry.

    - Si Twilio no está configurado, fallback a mock.
    - Timeout total: 8s por intento (vía wait_for desde el caller cuando se usa
      `safe_run`); aquí ejecutamos el SDK síncrono con HTTP timeout=8s para
      cortar cuelgues a nivel de red.
    """
    sid, token, frm, _ = _get_creds()
    if not (sid and token and frm):
        logger.info("[MOCK-WHATSAPP] To=%s | Body=%s", to, body)
        return {"status": "mocked", "to": to, "body": body}

    to_fmt = _format_to(to)
    loop = asyncio.get_event_loop()
    try:
        # Wait_for protege contra cuelgues del threadpool por encima del HTTP timeout.
        result = await asyncio.wait_for(
            loop.run_in_executor(None, _send_sync, sid, token, frm, to_fmt, body),
            timeout=9.0,  # 1s más que el HTTP timeout interno
        )
    except asyncio.TimeoutError:
        logger.error("[WHATSAPP] timeout duro 9s para %s", to_fmt)
        return {"status": "error", "detail": "timeout"}

    if result["status"] == "sent":
        logger.info("[WHATSAPP] sent sid=%s to=%s", result["sid"], to_fmt)
        return result

    tw_code = result.get("twilio_code")
    if tw_code == 63015:
        logger.warning(
            "[WHATSAPP] Destinatario %s no se unió al sandbox. %s",
            to_fmt, get_join_instructions(),
        )
        result["needs_sandbox_join"] = True
        result["join_instructions"] = get_join_instructions()
    elif tw_code == 63050:
        logger.warning("[WHATSAPP] Usuario %s opted-out (63050)", to_fmt)
    else:
        logger.error("[WHATSAPP] Error to=%s result=%s", to_fmt, result)

    return result


# ============== Plantillas de mensaje ==============
def construir_mensaje_recordatorio(
    nombre: str, reta_nombre: str, club: str, hora_str: str, observaciones: str = "",
) -> str:
    msg = (
        f"¡Hola {nombre}! 🎾⚡ Tu reta '{reta_nombre}' en {club} arranca en ~2 horas "
        f"({hora_str}). Calienta las muñecas, hidrátate y prepárate a darlo todo en el court."
    )
    if observaciones:
        msg += f"\n\nNota del organizador: {observaciones}"
    return msg


def construir_mensaje_recordatorio_1h(
    nombre: str, reta_nombre: str, club: str, hora_str: str, observaciones: str = "",
) -> str:
    """Fase 6 — Recordatorio T-1h (más urgente que el de 2h).

    Diseñado para WhatsApp con tono directo (action-oriented) e instrucciones
    logísticas: hora exacta, club, llegar 10 min antes.
    """
    msg = (
        f"⏰ {nombre}, ¡falta 1 hora! 🎾 Tu reta '{reta_nombre}' en {club} arranca a las "
        f"{hora_str}. Llega 10 min antes para hidratarte, calentar y revisar la cancha asignada."
    )
    if observaciones:
        msg += f"\n\nNota del organizador: {observaciones}"
    return msg


def construir_mensaje_waitlist_promovido(nombre: str, reta_nombre: str, link_pago: str) -> str:
    return (
        f"¡{nombre}, tienes lugar! 🟢 Se liberó un cupo en '{reta_nombre}'. "
        f"Confirma tu pago en los próximos 5 minutos: {link_pago}"
    )
