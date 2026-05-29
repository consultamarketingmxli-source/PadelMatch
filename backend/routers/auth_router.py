"""Endpoints de autenticación admin JWT + Refresh Tokens (Ola E)."""
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, Response

from auth import (
    ACCESS_TOKEN_EXP_MIN,
    create_access_token,
    get_current_admin,
    verify_password,
)
from core.db import db
from core.refresh_tokens import (
    REFRESH_COOKIE_NAME,
    REFRESH_TOKEN_LIFETIME_DAYS,
    create_refresh_token_document,
    detect_client_platform,
    find_refresh_doc,
    generate_refresh_token,
    get_raw_refresh_from_request,
    revoke_all_user_tokens,
    revoke_refresh_token,
)
from core.security import limiter, write_security_log
from models import LoginRequest, TokenResponse

router = APIRouter(prefix="/auth", tags=["auth"])


def _set_refresh_cookie(response: Response, raw_refresh: str) -> None:
    response.set_cookie(
        key=REFRESH_COOKIE_NAME,
        value=raw_refresh,
        httponly=True,
        secure=True,  # Producción HTTPS — el reverse proxy garantiza TLS.
        samesite="strict",
        max_age=REFRESH_TOKEN_LIFETIME_DAYS * 24 * 60 * 60,
        path="/api/auth",
    )


def _clear_refresh_cookie(response: Response) -> None:
    response.delete_cookie(REFRESH_COOKIE_NAME, path="/api/auth")


@router.post("/login", response_model=TokenResponse)
@limiter.limit("5/minute")
async def login(request: Request, response: Response, body: LoginRequest):
    admin = await db.admins.find_one({"email": body.username.lower()})
    if not admin or not verify_password(body.password, admin["hashed_password"]):
        # Ola B — audit log de intento fallido (anti-fuerza bruta).
        await write_security_log(
            accion="admin_login_failed",
            request=request,
            id_usuario=body.username.lower(),
            result="denied",
            extra={"reason": "bad_credentials"},
        )
        raise HTTPException(status_code=401, detail="Credenciales incorrectas")

    access_token = create_access_token(subject=admin["email"], role="admin")
    raw_refresh = generate_refresh_token()
    await create_refresh_token_document(
        db=db,
        raw_token=raw_refresh,
        user_id=admin["email"],
        role="admin",
        request=request,
    )

    platform = detect_client_platform(request)
    await write_security_log(
        accion="admin_login_success",
        request=request,
        id_usuario=admin["email"],
        result="success",
        extra={"platform": platform},
    )

    payload = TokenResponse(
        access_token=access_token,
        expires_in=ACCESS_TOKEN_EXP_MIN * 60,
    )
    if platform == "web":
        _set_refresh_cookie(response, raw_refresh)
    else:
        payload.refresh_token = raw_refresh
    return payload


@router.post("/refresh", response_model=TokenResponse)
@limiter.limit("30/minute")
async def refresh(request: Request, response: Response):
    """Rotación de refresh token + emisión de nuevo access token.

    - WEB: lee cookie `padelapp_refresh` (HttpOnly).
    - NATIVE: lee header `X-Refresh-Token`.
    Si el token está revocado/expirado, devuelve 401 → el cliente debe
    relogin. Si detectamos REUSE de un revoked, revocamos TODOS los del
    usuario (mitigación de robo de token).
    """
    raw = get_raw_refresh_from_request(request)
    if not raw:
        raise HTTPException(401, "Missing refresh token")

    doc = await find_refresh_doc(db, raw)
    if not doc:
        await write_security_log(
            accion="refresh_unknown_token",
            request=request,
            result="denied",
        )
        raise HTTPException(401, "Refresh token inválido")

    if doc.get("revoked"):
        # REUSE detectado — posible robo de token. Revocamos todos del usuario.
        await revoke_all_user_tokens(db, doc["user_id"])
        await write_security_log(
            accion="refresh_reuse_detected",
            request=request,
            id_usuario=doc["user_id"],
            result="denied",
            extra={"role": doc.get("role"), "action": "all_tokens_revoked"},
        )
        raise HTTPException(401, "Refresh token revocado")

    from datetime import datetime, timezone

    # MongoDB devuelve datetimes naive (UTC). Lo normalizamos a aware.
    exp_at = doc["expires_at"]
    if exp_at.tzinfo is None:
        exp_at = exp_at.replace(tzinfo=timezone.utc)
    if exp_at <= datetime.now(timezone.utc):
        await write_security_log(
            accion="refresh_expired",
            request=request,
            id_usuario=doc["user_id"],
            result="denied",
        )
        raise HTTPException(401, "Refresh token expirado")

    user_id = doc["user_id"]
    role = doc["role"]

    # Rotar: revocar anterior + emitir nuevo
    await revoke_refresh_token(db, raw)
    new_raw = generate_refresh_token()
    await create_refresh_token_document(
        db=db,
        raw_token=new_raw,
        user_id=user_id,
        role=role,
        request=request,
    )

    # Construir nuevo access token según el rol original.
    if role == "player":
        # Reusamos la lógica del player_auth para mantener claims (jugador_id, nombre)
        import jwt as _jwt
        from auth import JWT_ALG, JWT_SECRET

        jugador = await db.usuarios.find_one({"telefono": user_id}, {"_id": 0})
        access_token = _jwt.encode(
            {
                "sub": user_id,
                "role": "player",
                "jugador_id": (jugador or {}).get("id", ""),
                "nombre": (jugador or {}).get("nombre", ""),
                "exp": datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXP_MIN),
                "iat": datetime.now(timezone.utc),
            },
            JWT_SECRET,
            algorithm=JWT_ALG,
        )
    else:
        access_token = create_access_token(subject=user_id, role=role)

    platform = detect_client_platform(request)
    await write_security_log(
        accion="refresh_success",
        request=request,
        id_usuario=user_id,
        result="success",
        extra={"platform": platform, "role": role},
    )

    payload = TokenResponse(
        access_token=access_token,
        expires_in=ACCESS_TOKEN_EXP_MIN * 60,
    )
    if platform == "web":
        _set_refresh_cookie(response, new_raw)
    else:
        payload.refresh_token = new_raw
    return payload


@router.post("/logout")
async def logout(request: Request, response: Response):
    """Revoca el refresh token actual y borra la cookie (si aplica).
    Idempotente: nunca falla aunque no haya token."""
    raw = get_raw_refresh_from_request(request)
    if raw:
        doc = await find_refresh_doc(db, raw)
        if doc:
            await revoke_refresh_token(db, raw)
            await write_security_log(
                accion="logout",
                request=request,
                id_usuario=doc["user_id"],
                extra={"role": doc.get("role")},
                result="success",
            )
    _clear_refresh_cookie(response)
    return {"ok": True}


@router.get("/me")
async def me(current=Depends(get_current_admin)):
    return {"email": current["sub"], "role": current["role"]}
