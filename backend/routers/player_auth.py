"""Player Auth utilities + /me/* endpoints (Iter57 · Fase 3).

Post-Iter57: el login OTP-por-WhatsApp fue reemplazado por Google Sign-In +
Email Magic Link (ver `routers/emergent_auth.py`). Este módulo conserva:
  • `get_current_player` — validación de JWT tipo `player` (tolerante a
    JWT viejos con `sub=telefono` y nuevos con `sub=user_id UUID`).
  • Todos los endpoints `/players/me/*` (perfil, inscripciones, sessions,
    security activity, roles, eliminar cuenta, etc.) — sin cambios.
  • Endpoints `/auth/otp/*` como stubs 410 Gone para clientes legacy.

JWT tipo `player` (no admin), scope a `jugador_id`. Compat híbrida con
identidad por `user_id` o `telefono` según origen del token.
"""
import logging
import os
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel

from auth import JWT_ALG, JWT_SECRET, create_access_token
from core.db import db
from core.security import limiter, write_security_log
from models import PlayerStats

try:
    import jwt
except Exception:
    jwt = None  # type: ignore

logger = logging.getLogger("padelappretas-os")
router = APIRouter(prefix="/players", tags=["players"])


class PlayerTokenResponse(BaseModel):
    """Compat schema — usado por routers/refresh, no eliminar."""
    access_token: str
    token_type: str = "bearer"
    jugador_id: str
    nombre: str
    telefono: str
    refresh_token: Optional[str] = None
    expires_in: Optional[int] = None


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
    # Iter56 — Compat híbrido: JWTs nuevos (Google/Email Magic Link) tienen
    # `sub=user_id` (UUID); los legacy (OTP pre-Iter57) tenían `sub=telefono`.
    # Emitimos `identity_kind` para código downstream que necesita distinguir
    # (my_roles, ownership checks). El campo `sub` sigue siendo string estable.
    payload["identity_kind"] = (
        "user_id" if payload.get("auth_method", "").startswith("emergent") else "phone"
    )
    return payload


# ============== Endpoints ==============
# ─────────────────────────────────────────────────────────────────────────
# OTP por WhatsApp/SMS eliminado en Iter57 · Fase 3.
#
# Migrado a Google Sign-In + Email Magic Link (ver `routers/emergent_auth.py`).
# Los endpoints legacy responden 410 Gone para clientes viejos que aún los
# consulten. La lógica interna (get_current_player, _create_player_token,
# /me/*, /me/sessions, etc.) se mantiene porque emergent_auth reusa el mismo
# JWT + refresh token infrastructure.
# ─────────────────────────────────────────────────────────────────────────
@router.post("/auth/otp/request", deprecated=True, include_in_schema=False)
async def request_otp_deprecated():
    raise HTTPException(
        status_code=410,
        detail={
            "code": "otp_deprecated",
            "message": (
                "El login por SMS/WhatsApp fue removido. Usá 'Continuar con "
                "Google' o 'Continuar con Correo' en la pantalla de login."
            ),
        },
    )


@router.post("/auth/otp/verify", deprecated=True, include_in_schema=False)
async def verify_otp_deprecated():
    raise HTTPException(
        status_code=410,
        detail={
            "code": "otp_deprecated",
            "message": (
                "El login por SMS/WhatsApp fue removido. Usá 'Continuar con "
                "Google' o 'Continuar con Correo' en la pantalla de login."
            ),
        },
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
# Ola E.2 — Centro de Privacidad: Sesiones activas del player.
# ----------------------------------------------------------------------
@router.get("/me/sessions")
async def list_my_sessions(request: Request, current=Depends(get_current_player)):
    """Lista las sesiones activas (refresh tokens no revocados ni expirados)
    del player autenticado. Útil para que el usuario vea desde dónde está
    su sesión y revoque dispositivos perdidos.

    Devuelve: id (opaco, derivado del hash), ip, user_agent, created_at,
    last_used_at, expires_at, is_current (el que envió esta request).
    """
    telefono = current["sub"]
    now = datetime.now(timezone.utc)

    # ID estable opaco = primeros 12 chars del token_hash (no leak útil).
    cursor = db.refresh_tokens.find(
        {"user_id": telefono, "revoked": False, "expires_at": {"$gt": now}},
        {"_id": 0},
    ).sort("created_at", -1)

    # Identificamos cuál refresh token vino con esta request (si aplica).
    from core.refresh_tokens import (
        get_raw_refresh_from_request,
        hash_refresh_token,
    )

    raw = get_raw_refresh_from_request(request)
    current_hash = hash_refresh_token(raw) if raw else None

    sessions = []
    async for d in cursor:
        th = d.get("token_hash", "")
        ip = d.get("ip")
        # Enriquecimiento iter37: location (cacheado, no rompe si falla).
        location_str = "—"
        if ip:
            try:
                from core.ip_geo import format_location, resolve_ip_geo

                geo_dict = await resolve_ip_geo(ip)
                location_str = format_location(geo_dict)
            except Exception:  # noqa: BLE001
                pass
        sessions.append(
            {
                "id": th[:16],
                "ip": ip,
                "location": location_str,
                "user_agent": (d.get("user_agent") or "")[:120],
                "created_at": (d.get("created_at") or now).isoformat()
                if hasattr(d.get("created_at"), "isoformat")
                else None,
                "last_used_at": (d.get("last_used_at") or now).isoformat()
                if hasattr(d.get("last_used_at"), "isoformat")
                else None,
                "expires_at": (d.get("expires_at") or now).isoformat()
                if hasattr(d.get("expires_at"), "isoformat")
                else None,
                "is_current": bool(current_hash and th == current_hash),
            }
        )

    # Fallback iter36 P2: si el cliente NO envió el refresh token con esta
    # request (uso normal cuando solo manda el Authorization access token),
    # heurísticamente marcamos la sesión más reciente como `is_current`.
    # Es seguro porque el access viene de la sesión más recientemente emitida.
    if not current_hash and sessions:
        sessions[0]["is_current"] = True

    return {"sessions": sessions, "count": len(sessions)}


@router.delete("/me/sessions/{session_id}")
async def revoke_my_session(
    session_id: str,
    request: Request,
    current=Depends(get_current_player),
):
    """Revoca UNA sesión específica (refresh token) por su id opaco.
    El id es los primeros 16 chars del hash SHA256 del token.
    El usuario solo puede revocar sus propias sesiones."""
    if not session_id or len(session_id) < 8:
        raise HTTPException(400, "session_id inválido")

    telefono = current["sub"]
    # Buscamos por prefijo de hash + scope estricto al usuario.
    doc = await db.refresh_tokens.find_one(
        {"user_id": telefono, "token_hash": {"$regex": f"^{session_id}"}}
    )
    if not doc:
        raise HTTPException(404, "Sesión no encontrada")
    if doc.get("revoked"):
        return {"ok": True, "already_revoked": True}

    await db.refresh_tokens.update_one(
        {"_id": doc["_id"]},
        {"$set": {"revoked": True, "last_used_at": datetime.now(timezone.utc)}},
    )

    from core.security import write_security_log

    await write_security_log(
        accion="player_session_revoked",
        request=request,
        id_usuario=telefono,
        result="success",
        extra={"session_id": session_id[:16]},
    )
    return {"ok": True}


@router.get("/me/security-activity")
async def my_security_activity(
    request: Request,
    limit: int = 20,
    current=Depends(get_current_player),
):
    """Últimos eventos de seguridad del propio usuario (limit ≤ 100).
    Solo muestra acciones relacionadas con la cuenta del usuario actual."""
    telefono = current["sub"]
    limit = max(1, min(100, int(limit)))

    cursor = db.security_logs.find(
        {"id_usuario": telefono},
        {"_id": 0, "accion": 1, "result": 1, "ip_origen": 1, "timestamp": 1, "user_agent": 1},
    ).sort("timestamp", -1).limit(limit)

    items = []
    async for d in cursor:
        ts = d.get("timestamp")
        # Enriquecimiento iter37: agregar location vía geo lookup cacheado.
        ip = d.get("ip_origen")
        geo = None
        if ip:
            from core.ip_geo import resolve_ip_geo, format_location
            geo_dict = await resolve_ip_geo(ip)
            geo = format_location(geo_dict)
        items.append(
            {
                "accion": d.get("accion"),
                "result": d.get("result"),
                "ip": ip,
                "location": geo or "—",
                "user_agent": (d.get("user_agent") or "")[:80],
                "timestamp": ts.isoformat() if hasattr(ts, "isoformat") else None,
            }
        )
    return {"items": items, "count": len(items)}


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

    # 3b. Ola E — Revoca TODOS los refresh tokens activos del usuario.
    from core.refresh_tokens import revoke_all_user_tokens

    revoked = await revoke_all_user_tokens(db, telefono)

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
            "refresh_tokens_revoked": revoked,
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

    Iter56 — Compat híbrido: soporta identidad por `user_id` (Google Auth)
    O por `telefono` (OTP legacy). El match ownership hace $or entre ambos.

    Respuesta:
        {
          is_player: bool,
          is_organizer: bool,
          is_super_admin: bool,
          stats: { retas_organizadas: int, clubes_propios: int }
        }
    """
    sub = current["sub"]
    identity_kind = current.get("identity_kind", "phone")
    super_phones = _super_admin_phones()

    # Match por identidad primaria (user_id o phone). Query es defensivo:
    # busca en organizador_user_id (nuevos) OR organizador_telefono (legacy).
    if identity_kind == "user_id":
        user_id = sub
        # Traer teléfono del documento (si el usuario también hizo OTP alguna vez).
        user_doc = await db.usuarios.find_one({"user_id": user_id}, {"_id": 0, "telefono": 1})
        telefono = (user_doc or {}).get("telefono") or ""
        norm = _normalize_phone(telefono) if telefono else ""
    else:
        telefono = sub
        norm = _normalize_phone(telefono)
        user_doc = await db.usuarios.find_one({"telefono": telefono}, {"_id": 0, "user_id": 1})
        user_id = (user_doc or {}).get("user_id") or ""

    is_super = bool(telefono and norm in super_phones)

    # Ownership: matchea contra organizador_user_id (Iter56+) OR organizador_telefono (legacy).
    or_conds = []
    if user_id:
        or_conds.append({"organizador_user_id": user_id})
    if telefono:
        or_conds.append({"organizador_telefono": {"$in": [telefono, norm]}})
    retas_query = {"$or": or_conds} if or_conds else {"organizador_telefono": "__never_match__"}
    retas_count = await db.retas.count_documents(retas_query)

    clubes_count = 0
    try:
        or_conds_c = []
        if user_id:
            or_conds_c.append({"owner_user_id": user_id})
        if telefono:
            or_conds_c.append({"owner_telefono": {"$in": [telefono, norm]}})
        if or_conds_c:
            clubes_count = await db.clubes.count_documents({"$or": or_conds_c})
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
    victorias_ko = 0  # Fase 4 — KO wins counter.
    async for r in cursor:
        total += 1
        en_a = nombre in r["pareja_a"]
        gano = (en_a and r.get("ganador") == "A") or ((not en_a) and r.get("ganador") == "B")
        if gano:
            ganados += 1
            if bool(r.get("terminado_por_ko")):
                victorias_ko += 1
    efectividad = (ganados / total * 100) if total else 0.0
    return PlayerStats(
        jugador_id=jugador_id,
        nombre=nombre,
        partidos_jugados=total,
        partidos_ganados=ganados,
        efectividad=round(efectividad, 1),
        victorias_ko=victorias_ko,
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
