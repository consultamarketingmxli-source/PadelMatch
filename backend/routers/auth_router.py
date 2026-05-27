"""Endpoints de autenticación admin JWT."""
from fastapi import APIRouter, Depends, HTTPException

from auth import create_access_token, get_current_admin, verify_password
from core.db import db
from models import LoginRequest, TokenResponse

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=TokenResponse)
async def login(body: LoginRequest):
    admin = await db.admins.find_one({"email": body.username.lower()})
    if not admin or not verify_password(body.password, admin["hashed_password"]):
        raise HTTPException(status_code=401, detail="Credenciales incorrectas")
    token = create_access_token(subject=admin["email"], role="admin")
    return TokenResponse(access_token=token)


@router.get("/me")
async def me(current=Depends(get_current_admin)):
    return {"email": current["sub"], "role": current["role"]}
