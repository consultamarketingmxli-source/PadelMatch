"""JWT auth + password hashing helpers."""
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

import jwt
from dotenv import load_dotenv
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from passlib.context import CryptContext

# Cargar .env antes de leer JWT_SECRET — auth.py es importado tempranamente
# desde server.py (antes que core/db.py que también hace load_dotenv).
# Sin esto, JWT_SECRET cae al default hardcodeado y las claves rotadas
# del .env se ignoran (vulnerabilidad descubierta por el testing_agent).
load_dotenv(Path(__file__).resolve().parent / ".env")

JWT_SECRET = os.environ.get("JWT_SECRET", "padelappretas-os-secret-dev-key-min-32bytes-please-rotate-in-prod")
JWT_ALG = "HS256"
# Ola E — Access tokens ahora son SHORT-LIVED (15 min).
# Refresh tokens cubren la persistencia de sesión hasta 30 días (ver core.refresh_tokens).
# Tokens emitidos ANTES de este cambio (legacy 24h/30d) siguen siendo válidos
# hasta su exp natural — no rompemos sesiones activas.
ACCESS_TOKEN_EXP_MIN = 15

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")


def hash_password(p: str) -> str:
    return pwd_context.hash(p)


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return pwd_context.verify(plain, hashed)
    except Exception:
        return False


def create_access_token(subject: str, role: str = "admin") -> str:
    import uuid

    now = datetime.now(timezone.utc)
    exp = now + timedelta(minutes=ACCESS_TOKEN_EXP_MIN)
    # iat + jti — trazabilidad y unicidad token-per-issue.
    payload = {
        "sub": subject,
        "role": role,
        "exp": exp,
        "iat": now,
        "jti": uuid.uuid4().hex,
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)


def decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expirado")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Token inválido")


async def get_current_admin(token: str = Depends(oauth2_scheme)) -> dict:
    payload = decode_token(token)
    if payload.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Se requiere rol admin")
    return payload
