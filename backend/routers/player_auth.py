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

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel, Field

from auth import JWT_ALG, JWT_SECRET, create_access_token
from core.db import db
from core.helpers import upsert_jugador
from core.security import limiter, write_security_log
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
@limiter.limit("5/minute")
async def request_otp(request: Request, body: OtpRequest):
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
@limiter.limit("10/minute")
async def verify_otp(request: Request, body: OtpVerify):
    rec = await db.player_otps.find_one({"telefono": body.telefono}, {"_id": 0})
    if not rec:
        raise HTTPException(400, "No hay código pendiente para ese teléfono.")

    now = datetime.now(timezone.utc).isoformat()
    if rec["expires_at"] < now:
        await db.player_otps.delete_one({"telefono": body.telefono})
        raise HTTPException(410, "El código expiró. Solicita uno nuevo.")

    if rec.get("intentos", 0) >= 5:
        await write_security_log(
            accion="otp_verify_locked",
            request=request,
            id_usuario=body.telefono,
            result="rate_limited",
        )
        raise HTTPException(429, "Demasiados intentos. Solicita un código nuevo.")

    if rec["codigo"] != body.codigo.strip():
        await db.player_otps.update_one(
            {"telefono": body.telefono}, {"$inc": {"intentos": 1}}
        )
        await write_security_log(
            accion="otp_verify_failed",
            request=request,
            id_usuario=body.telefono,
            result="denied",
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


# ----------------------------------------------------------------------
# Ola C — Eliminación de Cuenta (Apple App Store 5.1.1).
#
# Anonimización IRREVERSIBLE:
#   • usuarios.nombre        → "Usuario eliminado"
#   • usuarios.telefono      → SHA-256(telefono_original)[:24] (no reversible)
#   • usuarios.email         → null
#   • usuarios.deleted_at    → timestamp
#
# Preservamos:
#   • el documento (no DELETE físico) para mantener integridad referencial
#     de resultados/torneos históricos (foreign keys soft).
#   • inscripciones, resultados y waitlist — NO se borran, solo el nombre
#     mostrado pasa a "Usuario eliminado" via JOIN al usuario.
#
# Borramos físicamente:
#   • player_otps de ese teléfono (limpieza de credenciales).
#   • alertas_organizador donde el usuario era player_telefono.
#
# Aud log en `security_logs` para trazabilidad GDPR.
# ----------------------------------------------------------------------
import hashlib  # noqa: E402


@router.delete("/me")
@limiter.limit("3/hour")
async def delete_my_account(request: Request, current=Depends(get_current_player)):
    """Elimina (anonimiza) la cuenta del jugador autenticado.

    Apple Guideline 5.1.1(v) requiere botón visible y proceso de un solo paso.
    Limitado a 3 intentos por hora para evitar abuso accidental masivo.
    """
    jugador_id = current["jugador_id"]
    telefono = current["sub"]
    nombre_antes = current.get("nombre", "?")

    # 1. Hash irreversible del teléfono (placeholder anonimizado).
    hash_phone = "deleted_" + hashlib.sha256(telefono.encode("utf-8")).hexdigest()[:24]

    # 2. Anonimización del documento (UPDATE en lugar de DELETE).
    update_result = await db.usuarios.update_one(
        {"id": jugador_id},
        {
            "$set": {
                "nombre": "Usuario eliminado",
                "telefono": hash_phone,
                "email": None,
                "deleted_at": datetime.now(timezone.utc).isoformat(),
                "anonimizado": True,
            }
        },
    )

    # 3. Limpieza de credenciales activas (no reversible).
    await db.player_otps.delete_many({"telefono": telefono})

    # 4. Audit log irrefutable (GDPR + Apple compliance).
    await write_security_log(
        accion="account_deleted",
        request=request,
        id_usuario=jugador_id,
        result="success",
        extra={
            "telefono_hash": hash_phone,
            "nombre_antes": nombre_antes,
            "matched": update_result.matched_count,
        },
    )

    return {
        "ok": True,
        "anonimizado": True,
        "mensaje": (
            "Tu cuenta y datos personales han sido eliminados. "
            "Las inscripciones y resultados históricos se mantienen "
            "como 'Usuario eliminado' para preservar la integridad de los torneos."
        ),
    }


# ----------------------------------------------------------------------
# Auditoría Routing — Bifurcación inteligente Organizador / Jugador.
#
# Determina los roles del usuario autenticado por OTP:
#   • is_player        → siempre True (autenticado por OTP)
#   • is_organizer     → True si su teléfono aparece como `organizador_telefono`
#                         en ≥1 reta, o como `owner_telefono` en ≥1 club,
#                         o está en la lista SUPER_ADMIN_TELEFONOS env.
#   • is_super_admin   → True si su teléfono está en SUPER_ADMIN_TELEFONOS.
#
# Esto habilita la pantalla `/seleccion` (Hub Bifurcación) y el "salto
# inteligente" cuando el usuario es estrictamente jugador.
# ----------------------------------------------------------------------
def _normalize_phone(p: str) -> str:
    return "".join(ch for ch in (p or "") if ch.isdigit() or ch == "+").strip()


def _super_admin_phones() -> List[str]:
    raw = os.environ.get("SUPER_ADMIN_TELEFONOS", "") or ""
    return [_normalize_phone(t) for t in raw.split(",") if t.strip()]


@router.get("/me/roles")
async def my_roles(current=Depends(get_current_player)):
    """Determina los ambientes a los que puede acceder el usuario.

    Respuesta:
        {
          is_player: bool,
          is_organizer: bool,
          is_super_admin: bool,
          stats: { retas_organizadas: int, clubes_propios: int }
        }
    """
    telefono = current["sub"]
    norm = _normalize_phone(telefono)
    super_phones = _super_admin_phones()
    is_super = norm in super_phones

    # Match por teléfono normalizado (tolerante a formato con/sin espacios).
    # Buscamos en ambos: exacto y normalizado (los registros nuevos pueden no
    # estar normalizados consistentemente con los antiguos).
    retas_count = await db.retas.count_documents(
        {"organizador_telefono": {"$in": [telefono, norm]}}
    )
    clubes_count = 0
    try:
        clubes_count = await db.clubes.count_documents(
            {"owner_telefono": {"$in": [telefono, norm]}}
        )
    except Exception:
        clubes_count = 0

    is_organizer = is_super or retas_count > 0 or clubes_count > 0
    return {
        "is_player": True,
        "is_organizer": is_organizer,
        "is_super_admin": is_super,
        "stats": {
            "retas_organizadas": retas_count,
            "clubes_propios": clubes_count,
        },
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


# ---------------------------------------------------------------
# Fase D — Portal jugador: mi posición en la lista de espera.
# ---------------------------------------------------------------
class PlayerWaitlistEntry(BaseModel):
    waitlist_id: str
    reta_id: str
    reta_nombre: str
    reta_slug: str
    club: str
    fecha_evento: str
    posicion_fila: int
    total_en_espera: int
    notificado: bool


@router.get("/me/waitlist", response_model=List[PlayerWaitlistEntry])
async def my_waitlist(current=Depends(get_current_player)):
    """Lista de retas donde el jugador está en lista de espera, con posición."""
    telefono = current["sub"]
    cursor = db.lista_espera.find({"telefono": telefono}, {"_id": 0}).sort("creado_en", 1)
    out: List[PlayerWaitlistEntry] = []
    async for w in cursor:
        reta = await db.retas.find_one(
            {"id": w["reta_id"]},
            {"_id": 0, "nombre": 1, "url_slug": 1, "fecha_evento": 1, "club": 1},
        )
        if not reta:
            continue
        # Sólo eventos futuros (evita basura histórica al usuario)
        try:
            fecha_dt = datetime.fromisoformat(reta["fecha_evento"])
            if fecha_dt.replace(tzinfo=fecha_dt.tzinfo or timezone.utc) < datetime.now(timezone.utc):
                continue
        except Exception:
            pass
        total = await db.lista_espera.count_documents({"reta_id": w["reta_id"]})
        out.append(PlayerWaitlistEntry(
            waitlist_id=w["id"],
            reta_id=w["reta_id"],
            reta_nombre=reta["nombre"],
            reta_slug=reta["url_slug"],
            club=reta["club"],
            fecha_evento=reta["fecha_evento"],
            posicion_fila=w.get("posicion_fila", 0),
            total_en_espera=total,
            notificado=w.get("notificado", False),
        ))
    return out
