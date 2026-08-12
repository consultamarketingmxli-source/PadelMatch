"""Emergent Auth (Iter56) — Login sin OTP vía Google Sign-In gestionado.

Reemplaza el flujo OTP-por-WhatsApp por login con Google (y en Fase 2, Email
Magic Link vía Resend). Mantiene compat con JWT existente:

  • Nuevo JWT: `sub=user_id (UUID)`, `role="player"`, `jugador_id=user_id`,
    `nombre=<display_name>`, `email=<email>`, `iat`, `exp`, `jti`.
  • JWT legacy (OTP): `sub=<telefono>`, `role="player"`, `jugador_id=<uuid>`.
    Ambos siguen siendo válidos durante el período de gracia — el helper
    `get_current_player` (en `player_auth.py`) resuelve la identidad del
    usuario buscando por `user_id` PRIMERO y por `telefono` como fallback.

Flujo de una vía (según playbook de Emergent):
  1. Frontend abre `https://auth.emergentagent.com/?redirect=<app_url>` en
     el navegador (AuthSession / WebBrowser en móvil, redirect directo en web).
  2. Emergent hace OAuth con Google, redirige a `<app_url>#session_id=...`.
  3. Frontend extrae `session_id` del hash y llama a este endpoint:
     `POST /api/auth/session` con body `{"session_id": "..."}`.
  4. Backend intercambia `session_id` con Emergent llamando a
     `GET https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data`
     con header `X-Session-ID: <session_id>`. Recibe email, name, picture.
  5. Backend upserta `usuarios` por email (reusa `user_id` si ya existía).
  6. Backend emite JWT con `sub=user_id` + refresh token (mismo patrón que
     `player_auth._create_player_token`).
  7. Frontend guarda access_token en secure store y usa como Bearer.

Contract endpoints:
  • POST /api/auth/session      → intercambia session_id → JWT + user
  • GET  /api/auth/me           → devuelve perfil del usuario autenticado
  • POST /api/auth/profile-setup → primer login: setea preferred_side + skill_level

Zero-cost: usa Emergent-managed OAuth (sin API keys de Google del usuario).
"""
import hashlib
import logging
import os
import uuid
from datetime import datetime, timedelta, timezone
from typing import Literal, Optional

import httpx
from fastapi import APIRouter, Body, Depends, Header, HTTPException, Request, Response
from pydantic import BaseModel, EmailStr, Field

from auth import JWT_ALG, JWT_SECRET
from core.db import db
from core.security import limiter, write_security_log

try:
    import jwt
except Exception:
    jwt = None  # type: ignore

logger = logging.getLogger("padelappretas-os")

router = APIRouter(prefix="/auth/emergent", tags=["auth-emergent"])

# ─────────────────────────────────────────────────────────────────────────
# Configuración
# ─────────────────────────────────────────────────────────────────────────
# Endpoint oficial de Emergent para intercambiar session_id por datos OAuth.
# NO requiere API keys — la validación se hace 1:1 vía `X-Session-ID`.
EMERGENT_SESSION_DATA_URL = (
    "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data"
)

# Duración del session_token entregado por Emergent (según playbook: 7 días).
SESSION_TTL_DAYS = 7

# TTL del access_token JWT — paridad con el flujo OTP existente (15 min).
from auth import ACCESS_TOKEN_EXP_MIN  # noqa: E402


# ─────────────────────────────────────────────────────────────────────────
# Schemas
# ─────────────────────────────────────────────────────────────────────────
class SessionExchangeRequest(BaseModel):
    """Body para POST /api/auth/session. Frontend envía SÓLO session_id.

    Nunca aceptar session_token en este endpoint (playbook mandatory).
    """
    session_id: str = Field(min_length=8, max_length=512)


class UserPublic(BaseModel):
    """Perfil público del usuario devuelto al cliente."""
    user_id: str
    email: Optional[str] = None
    nombre: str
    telefono: Optional[str] = None
    picture: Optional[str] = None
    preferred_side: Optional[Literal["Drive", "Revés", "Ambos"]] = None
    skill_level: Optional[Literal["Principiante", "Intermedio", "Avanzado", "Pro"]] = None
    profile_completed: bool = False


class SessionResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    refresh_token: Optional[str] = None
    expires_in: int = ACCESS_TOKEN_EXP_MIN * 60
    user: UserPublic


class ProfileSetupRequest(BaseModel):
    nombre: Optional[str] = Field(default=None, min_length=2, max_length=80)
    preferred_side: Literal["Drive", "Revés", "Ambos"]
    skill_level: Literal["Principiante", "Intermedio", "Avanzado", "Pro"]


# ─────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────
def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _create_player_jwt(user_id: str, email: Optional[str], nombre: str) -> str:
    """Emite JWT con `sub=user_id (UUID)`. Compatible con `get_current_player`
    del router `player_auth` (que resuelve `sub` como user_id O phone)."""
    if jwt is None:
        raise HTTPException(500, "JWT library no disponible")
    now = _now()
    payload = {
        "sub": user_id,
        "role": "player",
        "jugador_id": user_id,
        "nombre": nombre,
        "email": email,
        "exp": now + timedelta(minutes=ACCESS_TOKEN_EXP_MIN),
        "iat": now,
        "jti": uuid.uuid4().hex,
        "auth_method": "emergent_google",  # traceable en logs
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)


async def _upsert_user_by_email(
    email: str,
    name: str,
    picture: Optional[str],
) -> dict:
    """Encuentra o crea `usuarios` por email. Reusa user_id si ya existe.

    Retorna el documento completo del usuario (dict), asegurando que tiene
    `user_id`, `email`, `nombre`, `creado_en` seteados.
    """
    existing = await db.usuarios.find_one({"email": email}, {"_id": 0})

    # Si no está por email pero hay un legacy user con este mismo email en
    # cualquier campo indexable, no lo tocamos — creamos uno nuevo.
    if existing:
        # Backfill user_id si no lo tenía (legacy OTP que después vincula email)
        updates: dict = {}
        if not existing.get("user_id"):
            new_user_id = str(uuid.uuid4())
            updates["user_id"] = new_user_id
            existing["user_id"] = new_user_id
        if picture and existing.get("picture") != picture:
            updates["picture"] = picture
            existing["picture"] = picture
        if updates:
            await db.usuarios.update_one({"email": email}, {"$set": updates})
        return existing

    # Crear usuario nuevo
    user_id = str(uuid.uuid4())
    doc = {
        "id": user_id,  # compat con `Usuario` legacy (`id` field)
        "user_id": user_id,
        "email": email,
        "nombre": name or email.split("@")[0],
        "telefono": None,  # sparse index acepta null
        "picture": picture,
        "preferred_side": None,
        "skill_level": None,
        "nivel": "Iniciación",  # compat con schema legacy
        "perfil_publico": True,
        "creado_en": _now().isoformat(),
        "auth_provider": "google",
    }
    await db.usuarios.insert_one(doc)
    doc.pop("_id", None)
    return doc


def _to_public(user: dict) -> UserPublic:
    return UserPublic(
        user_id=user.get("user_id") or user.get("id", ""),
        email=user.get("email"),
        nombre=user.get("nombre", ""),
        telefono=user.get("telefono"),
        picture=user.get("picture"),
        preferred_side=user.get("preferred_side"),
        skill_level=user.get("skill_level"),
        profile_completed=bool(
            user.get("preferred_side") and user.get("skill_level")
        ),
    )


# ─────────────────────────────────────────────────────────────────────────
# Endpoints
# ─────────────────────────────────────────────────────────────────────────
# Guard sync contra reenvío del mismo session_id (uso de memoria in-process).
# Es best-effort: si hay múltiples workers, cada uno tiene su set. Emergent
# rechaza duplicados de todas formas, este set sólo optimiza el 99% de casos.
_used_session_ids: set[str] = set()


@router.post("/session", response_model=SessionResponse)
@limiter.limit("30/minute")
async def exchange_session(
    request: Request,
    response: Response,
    body: SessionExchangeRequest = Body(...),
):
    """Intercambia `session_id` (recibido en el redirect de Emergent) por JWT.

    Playbook rules:
      • Nunca aceptar session_token aquí (sólo session_id).
      • Hacer exactamente 1 GET a Emergent con `X-Session-ID` header.
      • Non-200 de Emergent → 401 al cliente (no filtrar detalles).
      • Guard contra duplicados síncrono ANTES de la llamada de red.
    """
    session_id = body.session_id.strip()
    if not session_id:
        raise HTTPException(401, "session_id vacío")

    # Guard duplicados (opcional, best-effort). Los duplicados legítimos
    # ocurren en Android cuando WebBrowser + Linking listener disparan ambos.
    if session_id in _used_session_ids:
        raise HTTPException(401, "session_id ya fue procesado")
    _used_session_ids.add(session_id)
    # Trim el set si crece demasiado (evita memory leak).
    if len(_used_session_ids) > 10_000:
        _used_session_ids.clear()

    # ── 1. Intercambio con Emergent ────────────────────────────────
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.get(
                EMERGENT_SESSION_DATA_URL,
                headers={"X-Session-ID": session_id},
            )
    except Exception as exc:
        logger.error("[emergent-auth] Error de red con Emergent: %s", exc)
        raise HTTPException(502, "No pudimos verificar tu sesión. Intentá de nuevo.")

    if r.status_code != 200:
        logger.warning(
            "[emergent-auth] session_id inválido/expirado: HTTP %s", r.status_code
        )
        raise HTTPException(401, "Sesión inválida o expirada. Volvé a iniciar sesión.")

    try:
        data = r.json()
    except Exception:
        raise HTTPException(502, "Respuesta inválida del proveedor de auth.")

    email = (data.get("email") or "").strip().lower()
    name = (data.get("name") or "").strip()
    picture = data.get("picture")
    emergent_session_token = data.get("session_token")

    if not email:
        raise HTTPException(400, "El proveedor no devolvió email.")

    # ── 2. Upsert usuario ─────────────────────────────────────────
    user = await _upsert_user_by_email(email=email, name=name, picture=picture)
    user_id: str = user["user_id"]

    # ── 3. Guardar sesión Emergent en Mongo (para /auth/me alternativo) ──
    if emergent_session_token:
        expires_at = _now() + timedelta(days=SESSION_TTL_DAYS)
        await db.user_sessions.update_one(
            {"session_token_hash": _hash_token(emergent_session_token)},
            {
                "$set": {
                    "session_token_hash": _hash_token(emergent_session_token),
                    "user_id": user_id,
                    "email": email,
                    "expires_at": expires_at,
                    "created_at": _now(),
                    "ip": (request.client.host if request.client else None),
                    "user_agent": (request.headers.get("user-agent") or "")[:200],
                }
            },
            upsert=True,
        )

    # ── 4. Emitir JWT + refresh token compat con OTP flow ─────────
    access_token = _create_player_jwt(
        user_id=user_id, email=email, nombre=user["nombre"]
    )

    from core.refresh_tokens import (
        REFRESH_COOKIE_NAME,
        REFRESH_TOKEN_LIFETIME_DAYS,
        create_refresh_token_document,
        detect_client_platform,
        generate_refresh_token,
    )

    raw_refresh = generate_refresh_token()
    await create_refresh_token_document(
        db=db,
        raw_token=raw_refresh,
        user_id=user_id,  # ← nueva PK: user_id UUID (antes: telefono)
        role="player",
        request=request,
    )
    platform = detect_client_platform(request)

    # ── 5. Audit log ─────────────────────────────────────────────
    await write_security_log(
        accion="login_google",
        request=request,
        id_usuario=user_id,
        result="success",
        extra={"email": email, "new_user": not user.get("auth_provider")},
    )

    result = SessionResponse(
        access_token=access_token,
        expires_in=ACCESS_TOKEN_EXP_MIN * 60,
        user=_to_public(user),
    )

    if platform == "web":
        response.set_cookie(
            key=REFRESH_COOKIE_NAME,
            value=raw_refresh,
            httponly=True,
            secure=True,
            samesite="strict",
            max_age=REFRESH_TOKEN_LIFETIME_DAYS * 24 * 60 * 60,
            path="/api",
        )
    else:
        result.refresh_token = raw_refresh
    return result


# ─────────────────────────────────────────────────────────────────────────
# /auth/me — devuelve perfil del usuario autenticado.
#
# Este endpoint tolera tanto JWTs nuevos (sub=user_id) como legacy (sub=phone)
# porque busca al usuario por AMBOS campos.
# ─────────────────────────────────────────────────────────────────────────
async def _current_user_flexible(
    authorization: Optional[str] = Header(None),
) -> dict:
    """Version tolerante a auth_method mixto. Busca usuario por user_id primero,
    luego por telefono (legacy). Devuelve el DOCUMENTO completo del usuario."""
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "No autenticado")
    if jwt is None:
        raise HTTPException(500, "JWT no disponible")
    token = authorization.split(" ", 1)[1].strip()
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
    except Exception as e:
        raise HTTPException(401, f"Token inválido: {e}") from e
    if payload.get("role") != "player":
        raise HTTPException(403, "Se requiere sesión de jugador")

    sub = payload.get("sub", "")
    # Nuevo path: JWT emitido por /auth/session tiene sub=UUID (user_id).
    # Legacy path: JWT emitido por OTP tiene sub=telefono.
    user = None
    if sub:
        user = await db.usuarios.find_one({"user_id": sub}, {"_id": 0})
        if not user:
            user = await db.usuarios.find_one({"telefono": sub}, {"_id": 0})
    if not user:
        raise HTTPException(404, "Usuario no encontrado")
    return user


@router.get("/me", response_model=UserPublic)
async def get_me(user: dict = Depends(_current_user_flexible)):
    """Devuelve perfil del usuario autenticado (tolerante a JWT viejos/nuevos)."""
    return _to_public(user)


@router.post("/profile-setup", response_model=UserPublic)
@limiter.limit("10/minute")
async def profile_setup(
    request: Request,
    body: ProfileSetupRequest = Body(...),
    user: dict = Depends(_current_user_flexible),
):
    """Completa el perfil post-primer-login: preferred_side + skill_level.

    Idempotente: se puede llamar múltiples veces para actualizar.
    Optionalmente actualiza el nombre si el usuario quiere corregirlo.
    """
    updates: dict = {
        "preferred_side": body.preferred_side,
        "skill_level": body.skill_level,
    }
    if body.nombre:
        updates["nombre"] = body.nombre.strip()

    match_key = "user_id" if user.get("user_id") else "id"
    await db.usuarios.update_one(
        {match_key: user.get(match_key)},
        {"$set": updates},
    )

    # Refetch
    refreshed = await db.usuarios.find_one(
        {match_key: user.get(match_key)}, {"_id": 0}
    )
    await write_security_log(
        accion="profile_setup_completed",
        request=request,
        id_usuario=refreshed.get("user_id") or refreshed.get("id"),
        result="success",
    )
    return _to_public(refreshed)


@router.post("/logout")
async def logout(
    request: Request,
    response: Response,
    user: dict = Depends(_current_user_flexible),
):
    """Cierra la sesión actual: revoca refresh tokens y limpia cookies.

    NO borra el usuario ni sus datos. Sólo invalida credenciales activas.
    """
    from core.refresh_tokens import REFRESH_COOKIE_NAME, revoke_all_user_tokens

    user_id = user.get("user_id") or user.get("id")
    revoked = await revoke_all_user_tokens(db, user_id)
    response.delete_cookie(REFRESH_COOKIE_NAME, path="/api")
    await write_security_log(
        accion="logout",
        request=request,
        id_usuario=user_id,
        result="success",
        extra={"refresh_tokens_revoked": revoked},
    )
    return {"ok": True}


# ═════════════════════════════════════════════════════════════════════════
# EMAIL MAGIC LINK OTP (Iter57 · Fase 2)
#
# Provee un flujo de login sin contraseña usando código OTP de 6 dígitos
# enviado por email vía Resend. Diseño mobile-first:
#   - El usuario ingresa email → recibe código → lo escribe en la app.
#   - Elegimos código sobre "link mágico" porque el link tiene fricción en
#     mobile (abrir mail app, tapear link, volver a la app, deep link
#     handling). El código es 1-tap.
#
# Rate limiting agresivo:
#   - Máx 3 requests por email cada 15 min (evita email bomb).
#   - Máx 10 requests por IP por hora (defensa DDoS).
#   - Máx 5 verificaciones incorrectas por email antes de invalidar.
# ═════════════════════════════════════════════════════════════════════════
class EmailOtpRequestBody(BaseModel):
    email: EmailStr
    nombre: Optional[str] = Field(default=None, max_length=80)


class EmailOtpVerifyBody(BaseModel):
    email: EmailStr
    codigo: str = Field(min_length=4, max_length=8)


EMAIL_OTP_TTL_MINUTES = 10
EMAIL_OTP_MAX_ATTEMPTS = 5


def _generate_email_otp() -> str:
    import secrets
    return f"{secrets.randbelow(1_000_000):06d}"


@router.post("/email/request")
@limiter.limit("3/15minutes")
async def request_email_otp(
    request: Request,
    body: EmailOtpRequestBody = Body(...),
):
    """Genera un OTP de 6 dígitos y lo envía por email vía Resend.

    Rate limit: 3 requests / 15 min por IP (SlowAPI usa remote_address).
    Diseño intencional: rate limit por IP + email en Mongo garantiza defensa
    en 2 capas contra email-bombing.

    Nunca revela si el email existe o no en la DB (privacy) — siempre
    devuelve 200 con mensaje genérico "Si el email es válido, recibirás un
    código". La única forma de saber si el envío falló es intentar verificar.
    """
    from core.email_service import email_service

    email = body.email.lower().strip()

    # Segundo rate limit por email (defensa contra 1 IP → muchos emails):
    # Máx 3 OTPs pendientes o generados en los últimos 15 min por email.
    fifteen_min_ago = _now() - timedelta(minutes=15)
    recent_count = await db.email_otps.count_documents(
        {"email": email, "created_at": {"$gte": fifteen_min_ago}}
    )
    if recent_count >= 3:
        # Devolvemos 200 igualmente para no filtrar existencia (privacy).
        logger.warning("[email-otp] Rate limit por email exhausted: %s", email)
        return {
            "ok": True,
            "message": "Si el email es válido, recibirás un código en unos minutos.",
            "throttled": True,
        }

    codigo = _generate_email_otp()
    now = _now()
    await db.email_otps.insert_one({
        "email": email,
        "codigo_hash": _hash_token(codigo),  # NUNCA guardamos el código plano
        "created_at": now,
        "expires_at": now + timedelta(minutes=EMAIL_OTP_TTL_MINUTES),
        "attempts": 0,
        "used": False,
        "nombre_hint": (body.nombre or "").strip()[:80] or None,
        "ip": (request.client.host if request.client else None),
    })

    # Envío best-effort. Si Resend falla, el código queda huérfano y expira
    # solo. No lo revelamos al cliente.
    sent = await email_service.send_otp_code(to=email, codigo=codigo)
    logger.info("[email-otp] enviado=%s to=%s", sent, email)

    return {
        "ok": True,
        "message": "Si el email es válido, recibirás un código en unos minutos.",
        "expires_in_minutes": EMAIL_OTP_TTL_MINUTES,
    }


@router.post("/email/verify", response_model=SessionResponse)
@limiter.limit("10/minute")
async def verify_email_otp(
    request: Request,
    response: Response,
    body: EmailOtpVerifyBody = Body(...),
):
    """Valida el OTP, upserta usuario y devuelve JWT (paridad con Google Auth)."""
    from core.refresh_tokens import (
        REFRESH_COOKIE_NAME,
        REFRESH_TOKEN_LIFETIME_DAYS,
        create_refresh_token_document,
        detect_client_platform,
        generate_refresh_token,
    )

    email = body.email.lower().strip()
    codigo = body.codigo.strip()
    codigo_hash = _hash_token(codigo)
    now = _now()

    # Buscar el OTP más reciente NO usado y NO expirado para este email.
    otp_doc = await db.email_otps.find_one(
        {"email": email, "used": False, "expires_at": {"$gt": now}},
        sort=[("created_at", -1)],
    )

    if not otp_doc:
        await write_security_log(
            accion="email_otp_verify",
            request=request,
            id_usuario=email,
            result="fail_no_otp",
        )
        raise HTTPException(401, "Código incorrecto o expirado.")

    # Guard de brute-force: máx N intentos antes de invalidar el OTP.
    attempts = int(otp_doc.get("attempts", 0))
    if attempts >= EMAIL_OTP_MAX_ATTEMPTS:
        await db.email_otps.update_one({"_id": otp_doc["_id"]}, {"$set": {"used": True}})
        await write_security_log(
            accion="email_otp_verify",
            request=request,
            id_usuario=email,
            result="fail_max_attempts",
        )
        raise HTTPException(401, "Demasiados intentos. Solicitá un código nuevo.")

    if otp_doc["codigo_hash"] != codigo_hash:
        await db.email_otps.update_one(
            {"_id": otp_doc["_id"]}, {"$inc": {"attempts": 1}}
        )
        await write_security_log(
            accion="email_otp_verify",
            request=request,
            id_usuario=email,
            result="fail_wrong_code",
        )
        raise HTTPException(401, "Código incorrecto o expirado.")

    # ── Success: marcar OTP como usado y crear/actualizar usuario ──
    await db.email_otps.update_one(
        {"_id": otp_doc["_id"]}, {"$set": {"used": True, "used_at": now}}
    )
    nombre_hint = otp_doc.get("nombre_hint") or email.split("@")[0]
    user = await _upsert_user_by_email(email=email, name=nombre_hint, picture=None)
    user_id: str = user["user_id"]

    # JWT + refresh (idéntico patrón que Google Sign-In).
    access_token = _create_player_jwt(
        user_id=user_id, email=email, nombre=user["nombre"]
    )
    raw_refresh = generate_refresh_token()
    await create_refresh_token_document(
        db=db,
        raw_token=raw_refresh,
        user_id=user_id,
        role="player",
        request=request,
    )
    platform = detect_client_platform(request)

    await write_security_log(
        accion="login_email_otp",
        request=request,
        id_usuario=user_id,
        result="success",
        extra={"email": email, "new_user": user.get("auth_provider") is None},
    )

    result = SessionResponse(
        access_token=access_token,
        expires_in=ACCESS_TOKEN_EXP_MIN * 60,
        user=_to_public(user),
    )
    if platform == "web":
        response.set_cookie(
            key=REFRESH_COOKIE_NAME,
            value=raw_refresh,
            httponly=True,
            secure=True,
            samesite="strict",
            max_age=REFRESH_TOKEN_LIFETIME_DAYS * 24 * 60 * 60,
            path="/api",
        )
    else:
        result.refresh_token = raw_refresh
    return result
