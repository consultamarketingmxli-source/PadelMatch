"""
Mock de notificaciones WhatsApp (Twilio).
Cuando se proporcionen TWILIO_ACCOUNT_SID/AUTH_TOKEN/WHATSAPP_FROM en .env se
activa la integración real. Mientras tanto, se loggean los envíos.
"""
import logging
import os

logger = logging.getLogger("notifications")

TWILIO_SID = os.environ.get("TWILIO_ACCOUNT_SID")
TWILIO_TOKEN = os.environ.get("TWILIO_AUTH_TOKEN")
TWILIO_FROM = os.environ.get("TWILIO_WHATSAPP_FROM")


async def send_whatsapp(to: str, body: str) -> dict:
    """
    Envía un mensaje WhatsApp. Si Twilio no está configurado, retorna mock log.
    """
    if not (TWILIO_SID and TWILIO_TOKEN and TWILIO_FROM):
        logger.info("[MOCK-WHATSAPP] To=%s | Body=%s", to, body)
        return {"status": "mocked", "to": to, "body": body}

    # Integración real (cuando user provea credenciales)
    try:
        from twilio.rest import Client  # type: ignore
        client = Client(TWILIO_SID, TWILIO_TOKEN)
        msg = client.messages.create(
            from_=TWILIO_FROM,
            to=f"whatsapp:{to}" if not to.startswith("whatsapp:") else to,
            body=body,
        )
        return {"status": "sent", "sid": msg.sid}
    except Exception as e:
        logger.exception("Error enviando WhatsApp")
        return {"status": "error", "detail": str(e)}


def construir_mensaje_recordatorio(nombre: str, reta_nombre: str, club: str, hora_str: str, observaciones: str = "") -> str:
    msg = (
        f"¡Hola {nombre}! 🎾⚡ Tu reta '{reta_nombre}' en {club} arranca en ~2 horas "
        f"({hora_str}). Calienta las muñecas, hidrátate y prepárate a darlo todo en el court."
    )
    if observaciones:
        msg += f"\n\nNota del organizador: {observaciones}"
    return msg


def construir_mensaje_waitlist_promovido(nombre: str, reta_nombre: str, link_pago: str) -> str:
    return (
        f"¡{nombre}, tienes lugar! 🟢 Se liberó un cupo en '{reta_nombre}'. "
        f"Confirma tu pago en los próximos 5 minutos: {link_pago}"
    )
