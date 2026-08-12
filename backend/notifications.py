"""notifications.py — Deprecated WhatsApp sender (Iter57 · Fase 3).

Historia:
    Antes usábamos Twilio WhatsApp Sandbox para (a) enviar códigos OTP de
    login y (b) recordatorios T-2h/T-1h, promociones de waitlist y alertas
    admin. En Iter57 migramos AUTH a Google + Email Magic Link (Resend), y
    convertimos este módulo a **NO-OP con logging** para:
      - Preservar los ~10 call-sites existentes sin romperlos.
      - Eliminar costos operativos de Twilio ($0 goal).
      - Eliminar dependencia crítica del sandbox de Twilio.

Todos los envíos son ahora **fire-and-forget silentes**: se loguean para
observabilidad pero NO se despachan al carrier. Los callers ya están
envueltos en `safe_run` (circuit breaker) → no rompen los flujos de negocio.

Roadmap:
    - Migrar recordatorios T-2h/T-1h a push notifications (Emergent) y/o
      Resend emails cuando el usuario opt-ine.
    - Reemplazar alertas admin por dashboard interno + email a admin.
    - Eventualmente borrar este archivo cuando los ~10 call-sites migren.

Interfaz preservada:
    - `send_whatsapp(to, body) -> dict`
    - `is_twilio_configured() -> bool`
    - `get_join_instructions() -> str`
    - `construir_mensaje_recordatorio*` — templates de mensajes (útiles para
      cuando los migremos a push/email; conservamos el copy).
"""
import logging
from typing import Any

logger = logging.getLogger("notifications")


def is_twilio_configured() -> bool:
    """Compat legacy: siempre False post-Iter57 (Twilio ya no se usa)."""
    return False


def get_join_instructions() -> str:
    """Compat legacy — retorna string vacío. Ningún caller lo consume ya."""
    return ""


async def send_whatsapp(to: str, body: str) -> dict[str, Any]:
    """No-op post-Iter57. Loguea para observabilidad, no despacha nada.

    Preserved return contract: `{status: "mocked", to, body}` — compatible
    con todos los callers legacy (routers/soporte.py, notify_admin.py,
    new_device_alert.py, helpers.py).
    """
    logger.info("[WHATSAPP-DEPRECATED] to=%s body_len=%d — sin envío", to, len(body or ""))
    return {"status": "mocked", "to": to, "body": body}


# ============== Plantillas de mensaje (preservadas para migración futura) ==============
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
