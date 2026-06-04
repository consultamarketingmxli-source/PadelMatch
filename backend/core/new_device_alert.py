"""
core/new_device_alert.py — Detección de nuevo dispositivo/IP en login.

Flujo:
  1. En cada login exitoso (player OTP o admin password), llamamos a
     `check_new_device(user_id, ip, user_agent)`.
  2. Si la combinación (user_id, ip+ua_hash) NO existe en
     `db.known_devices` → es un dispositivo nuevo.
  3. Registramos el dispositivo + emitimos audit log + (opcional)
     enviamos notificación WhatsApp.
  4. Si ya existe → actualizamos `last_seen_at`.

La colección `known_devices` tiene unique index sobre (user_id, fingerprint).
"""
from __future__ import annotations

import hashlib
import logging
from datetime import datetime, timezone
from typing import Optional

logger = logging.getLogger("padelappretas-security")


def _device_fingerprint(ip: Optional[str], user_agent: Optional[str]) -> str:
    """Hash determinístico de (ip + user_agent_simplified)."""
    ua = (user_agent or "").lower()
    # Compactar variantes Chrome 119.0.x → Chrome  (estabilidad version-bump).
    if "chrome/" in ua:
        ua = "chrome"
    elif "safari/" in ua and "chrome" not in ua:
        ua = "safari"
    elif "firefox/" in ua:
        ua = "firefox"
    elif "expo" in ua or "react-native" in ua:
        ua = "native"
    base = f"{ip or 'unknown'}|{ua}"
    return hashlib.sha256(base.encode()).hexdigest()[:24]


async def _ensure_indices(db) -> None:
    try:
        await db.known_devices.create_index(
            [("user_id", 1), ("fingerprint", 1)],
            unique=True,
        )
    except Exception:
        pass


async def check_and_register_device(
    user_id: str,
    ip: Optional[str],
    user_agent: Optional[str],
) -> tuple[bool, str]:
    """
    Returns: (is_new_device, fingerprint)
      - is_new_device=True → caller debe registrar audit + enviar notif.
      - is_new_device=False → reconocido, solo refrescar last_seen.
    """
    if not user_id:
        return False, ""
    from core.db import db  # lazy

    await _ensure_indices(db)
    fp = _device_fingerprint(ip, user_agent)
    now = datetime.now(timezone.utc)

    existing = await db.known_devices.find_one({"user_id": user_id, "fingerprint": fp})
    if existing:
        await db.known_devices.update_one(
            {"_id": existing["_id"]},
            {"$set": {"last_seen_at": now}, "$inc": {"login_count": 1}},
        )
        return False, fp

    # Dispositivo nuevo.
    try:
        await db.known_devices.insert_one({
            "user_id": user_id,
            "fingerprint": fp,
            "ip_first": ip,
            "user_agent_first": (user_agent or "")[:200],
            "first_seen_at": now,
            "last_seen_at": now,
            "login_count": 1,
        })
    except Exception as e:  # race condition con otro request: ya existe
        logger.warning("[new-device-insert-race] %s", str(e)[:120])
        return False, fp
    return True, fp


async def notify_new_device(
    user_id: str,
    ip: Optional[str],
    user_agent: Optional[str],
    role: str = "player",
) -> None:
    """
    Envía alerta WhatsApp al player si user_id es teléfono.
    Admin (email) NO recibe alerta automática (no tenemos su tel).
    Best-effort: errores no rompen el login.
    """
    if not user_id or not user_id.startswith("+"):
        # Admin (email) o no es teléfono → no notificamos en este sprint.
        return
    try:
        from core.ip_geo import resolve_ip_geo, format_location
        from notifications import send_whatsapp, is_twilio_configured

        if not is_twilio_configured():
            return

        geo = await resolve_ip_geo(ip) if ip else None
        loc = format_location(geo)
        ua_short = (user_agent or "desconocido")[:60]
        msg = (
            f"🔐 *PadelAppRetas* — Acceso desde un dispositivo NUEVO.\n\n"
            f"• Ubicación: {loc}\n"
            f"• IP: {ip or '—'}\n"
            f"• Dispositivo: {ua_short}\n\n"
            f"Si fuiste tú, ignora este mensaje.\n"
            f"Si NO fuiste tú, entra a *Configuración → Seguridad* y revoca todas las sesiones."
        )
        await send_whatsapp(user_id, msg)
    except Exception as e:
        logger.warning("[new-device-notify-fail] %s", str(e)[:160])
