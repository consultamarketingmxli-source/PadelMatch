"""Endpoints de autenticación admin JWT."""
from fastapi import APIRouter, Depends, HTTPException, Request

from auth import create_access_token, get_current_admin, verify_password
from core.db import db
from core.security import limiter, write_security_log
from models import LoginRequest, TokenResponse

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=TokenResponse)
@limiter.limit("5/minute")
async def login(request: Request, body: LoginRequest):
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
    token = create_access_token(subject=admin["email"], role="admin")
    await write_security_log(
        accion="admin_login_success",
        request=request,
        id_usuario=admin["email"],
        result="success",
    )
    return TokenResponse(access_token=token)


@router.get("/me")
async def me(current=Depends(get_current_admin)):
    return {"email": current["sub"], "role": current["role"]}
