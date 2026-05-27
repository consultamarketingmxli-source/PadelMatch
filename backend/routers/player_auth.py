"""Login de Jugador con OTP de 6 dígitos (mock-friendly).

Si Twilio está configurado, envía SMS. Si no, el código se loguea para que
durante desarrollo se pueda obtener del log del backend.

JWT separado del admin: tipo `player`, scope a `jugador_id`.
"""
import logging
import os
import random
import secrets
from datetime import datetime, timedelta, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field

from auth import JWT_ALG, JWT_SECRET, create_access_token
from core.db import db
from core.helpers import upsert_jugador
from models import Inscripcion, PlayerStats, Usuario
from notifications import is_twilio_configured, send_whatsapp

try:
    import jwt
except Exception:
    jwt = None  # type: ignore

logger = logging.getLogger("padelappretas-os")
router = APIRouter(prefix="/players", tags=["players"])

OTP_TTL_SECONDS = 5 * 60
OTP_LENGTH = 6


# ============== Schemas ==============
class OtpRequest(BaseModel):
    nombre: str = Field(min_length=2, max_length=80)
    telefono: str = Field(min_length=6, max_length=20)


class OtpVerify(BaseModel):
    telefono: str
    codigo: str = Field(min_length=4, max_length=8)


class PlayerTokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    jugador_id: str
    nombre: str
    telefono: str


class PlayerInscripcion(BaseModel):
    id: str
    reta_id: str
    reta_nombre: str
    reta_slug: str
    fecha_evento: str
    club: str
    estatus_pago: str
    creado_en: str


# ============== Helpers ==============
def _generar_codigo() -> str:
    # secrets para entropía criptográfica (mejor que random)
    return "".join(str(secrets.randbelow(10)) for _ in range(OTP_LENGTH))


async def _store_otp(telefono: str, codigo: str) -> None:
    expires_dt = datetime.now(timezone.utc) + timedelta(seconds=OTP_TTL_SECONDS)
    await db.player_otps.update_one(
        {"telefono": telefono},
        {"$set": {
            "telefono": telefono,
            "codigo": codigo,
            "expires_at": expires_dt.isoformat(),
            "expires_at_dt": expires_dt,  # datetime nativo para el TTL index Mongo
            "intentos": 0,
        }},
        upsert=True,
    )


def _create_player_token(jugador_id: str, telefono: str, nombre: str) -> str:
    """Crea JWT con tipo `player`. Reusa la SECRET_KEY del módulo auth."""
    if jwt is None:
        # Fallback (no debería pasar — pyjwt está instalado por auth.py)
        return create_access_token(subject=telefono, role="player")
    payload = {
        "sub": telefono,
        "role": "player",
        "jugador_id": jugador_id,
        "nombre": nombre,
        "exp": datetime.now(timezone.utc) + timedelta(days=30),
        "iat": datetime.now(timezone.utc),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)


async def get_current_player(authorization: Optional[str] = Header(None)) -> dict:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "No autenticado")
    token = authorization.split(" ", 1)[1].strip()
    if jwt is None:
        raise HTTPException(500, "JWT no disponible")
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
    except Exception as e:
        raise HTTPException(401, f"Token inválido: {e}") from e
    if payload.get("role") != "player":
        raise HTTPException(403, "Se requiere sesión de jugador")
    return payload


# ============== Endpoints ==============
@router.post("/auth/otp/request")
async def request_otp(body: OtpRequest):
    """Genera OTP de 6 dígitos. Si Twilio está, lo envía por WhatsApp.
    Si no, lo loguea (sólo en desarrollo)."""
    codigo = _generar_codigo()
    await _store_otp(body.telefono, codigo)

    twilio_listo = is_twilio_configured()
    # En todos los casos intentamos enviar (notifications.send_whatsapp es mock por defecto)
    msg = (
        f"Hola {body.nombre} 👋 Tu código PadelappRetas es: {codigo}\n"
        f"Vence en 5 minutos. No lo compartas con nadie."
    )
    await send_whatsapp(body.telefono, msg)
    if not twilio_listo:
        logger.warning("[OTP DEV] Código para %s = %s", body.telefono, codigo)

    # Asegurar que el jugador existe en usuarios (registro lazy)
    await upsert_jugador(body.nombre, body.telefono)

    return {
        "ok": True,
        "enviado_por_sms": twilio_listo,
        "mensaje": (
            "Te enviamos un código por WhatsApp."
            if twilio_listo
            else "OTP generado. En modo DEV puedes verlo en los logs del backend."
        ),
    }


@router.post("/auth/otp/verify", response_model=PlayerTokenResponse)
async def verify_otp(body: OtpVerify):
    rec = await db.player_otps.find_one({"telefono": body.telefono}, {"_id": 0})
    if not rec:
        raise HTTPException(400, "No hay código pendiente para ese teléfono.")

    now = datetime.now(timezone.utc).isoformat()
    if rec["expires_at"] < now:
        await db.player_otps.delete_one({"telefono": body.telefono})
        raise HTTPException(410, "El código expiró. Solicita uno nuevo.")

    if rec.get("intentos", 0) >= 5:
        raise HTTPException(429, "Demasiados intentos. Solicita un código nuevo.")

    if rec["codigo"] != body.codigo.strip():
        await db.player_otps.update_one(
            {"telefono": body.telefono}, {"$inc": {"intentos": 1}}
        )
        raise HTTPException(401, "Código incorrecto.")

    # OK: borrar OTP y devolver token
    await db.player_otps.delete_one({"telefono": body.telefono})

    jugador = await db.usuarios.find_one({"telefono": body.telefono}, {"_id": 0})
    if not jugador:
        # Edge: usuario sin registro previo (no debería pasar)
        nuevo = Usuario(nombre=f"Jugador {body.telefono[-4:]}", telefono=body.telefono)
        doc = nuevo.model_dump()
        doc["creado_en"] = doc["creado_en"].isoformat()
        await db.usuarios.insert_one(doc)
        jugador = doc

    token = _create_player_token(jugador["id"], body.telefono, jugador["nombre"])
    return PlayerTokenResponse(
        access_token=token,
        jugador_id=jugador["id"],
        nombre=jugador["nombre"],
        telefono=body.telefono,
    )


@router.get("/me")
async def me(current=Depends(get_current_player)):
    return {
        "jugador_id": current["jugador_id"],
        "telefono": current["sub"],
        "nombre": current["nombre"],
        "role": "player",
    }


@router.get("/me/inscripciones", response_model=List[PlayerInscripcion])
async def my_inscripciones(current=Depends(get_current_player)):
    telefono = current["sub"]
    cursor = db.inscripciones.find(
        {"telefono": telefono}, {"_id": 0},
    ).sort("creado_en", -1).limit(200)
    out: List[PlayerInscripcion] = []
    async for ins in cursor:
        reta = await db.retas.find_one(
            {"id": ins["reta_id"]},
            {"_id": 0, "nombre": 1, "url_slug": 1, "fecha_evento": 1, "club": 1},
        )
        if not reta:
            continue
        out.append(PlayerInscripcion(
            id=ins["id"],
            reta_id=ins["reta_id"],
            reta_nombre=reta["nombre"],
            reta_slug=reta["url_slug"],
            fecha_evento=reta["fecha_evento"],
            club=reta["club"],
            estatus_pago=ins["estatus_pago"],
            creado_en=ins["creado_en"],
        ))
    return out


@router.get("/me/stats", response_model=PlayerStats)
async def my_stats(current=Depends(get_current_player)):
    nombre = current["nombre"]
    jugador_id = current["jugador_id"]
    cursor = db.resultados.find(
        {"$or": [{"pareja_a": nombre}, {"pareja_b": nombre}]},
        {"_id": 0},
    ).limit(1000)
    total = 0
    ganados = 0
    async for r in cursor:
        total += 1
        en_a = nombre in r["pareja_a"]
        if (en_a and r["ganador"] == "A") or ((not en_a) and r["ganador"] == "B"):
            ganados += 1
    efectividad = (ganados / total * 100) if total else 0.0
    return PlayerStats(
        jugador_id=jugador_id,
        nombre=nombre,
        partidos_jugados=total,
        partidos_ganados=ganados,
        efectividad=round(efectividad, 1),
    )
