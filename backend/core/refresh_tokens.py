"""Refresh Token model + helpers (Ola E — DevSecOps).

Estrategia híbrida:
  - Mobile (iOS / Android / Expo): refresh token devuelto en JSON,
    el cliente lo guarda en `expo-secure-store`.
  - Web: refresh token entregado como cookie `HttpOnly`+`Secure`+`SameSite=Strict`.

Persistencia:
  - Colección `refresh_tokens` (MongoDB) — solo guardamos el SHA256 del
    token; el texto plano nunca toca el disco.
  - TTL index sobre `expires_at` para limpieza automática.
  - Rotación obligatoria: cada `/api/auth/refresh` revoca el anterior
    e inserta uno nuevo (mitiga replay-after-theft).

Detección de cliente: header `X-Client-Platform: web|native`.
Fallback a `User-Agent` (Mozilla → web; otro → native).
"""
from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import Request
from motor.motor_asyncio import AsyncIOMotorDatabase

# ── Configuración ──
REFRESH_TOKEN_BYTES = 32  # 256 bits de entropía
REFRESH_TOKEN_LIFETIME_DAYS = 30
ACCESS_TOKEN_LIFETIME_MINUTES = 15  # Ola E — antes 24h/30d

REFRESH_COOKIE_NAME = "padelapp_refresh"
REFRESH_HEADER_NAME = "x-refresh-token"  # case-insensitive


def generate_refresh_token() -> str:
    """String aleatorio url-safe (256 bits)."""
    return secrets.token_urlsafe(REFRESH_TOKEN_BYTES)


def hash_refresh_token(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def refresh_token_expiry() -> datetime:
    return datetime.now(timezone.utc) + timedelta(days=REFRESH_TOKEN_LIFETIME_DAYS)


# ── Detección de plataforma del cliente ──
def detect_client_platform(request: Request) -> str:
    h = request.headers.get("x-client-platform", "").strip().lower()
    if h in ("web", "native"):
        return h
    ua = (request.headers.get("user-agent") or "").lower()
    # Heurística mínima — el header explícito es la fuente confiable.
    if "mozilla" in ua and ("chrome" in ua or "safari" in ua or "firefox" in ua):
        return "web"
    return "native"


# ── Persistencia ──
async def create_refresh_token_document(
    db: AsyncIOMotorDatabase,
    raw_token: str,
    user_id: str,
    role: str,
    request: Request,
    extra: Optional[dict] = None,
) -> dict:
    now = datetime.now(timezone.utc)
    doc = {
        "token_hash": hash_refresh_token(raw_token),
        "user_id": str(user_id),
        "role": role,
        "expires_at": refresh_token_expiry(),
        "revoked": False,
        "created_at": now,
        "last_used_at": now,
        "ip": (request.client.host if request.client else None),
        "user_agent": (request.headers.get("user-agent") or "")[:200],
    }
    if extra:
        doc["extra"] = extra
    await db["refresh_tokens"].insert_one(doc)
    return doc


async def find_refresh_doc(db: AsyncIOMotorDatabase, raw_token: str) -> Optional[dict]:
    return await db["refresh_tokens"].find_one(
        {"token_hash": hash_refresh_token(raw_token)}
    )


async def revoke_refresh_token(db: AsyncIOMotorDatabase, raw_token: str) -> None:
    await db["refresh_tokens"].update_one(
        {"token_hash": hash_refresh_token(raw_token), "revoked": False},
        {"$set": {"revoked": True, "last_used_at": datetime.now(timezone.utc)}},
    )


async def revoke_all_user_tokens(db: AsyncIOMotorDatabase, user_id: str) -> int:
    res = await db["refresh_tokens"].update_many(
        {"user_id": str(user_id), "revoked": False},
        {"$set": {"revoked": True, "last_used_at": datetime.now(timezone.utc)}},
    )
    return res.modified_count or 0


def get_raw_refresh_from_request(request: Request) -> Optional[str]:
    """Lee el refresh token de cookie (web) o header `X-Refresh-Token` (mobile)."""
    cookie_val = request.cookies.get(REFRESH_COOKIE_NAME)
    if cookie_val:
        return cookie_val
    hdr = request.headers.get(REFRESH_HEADER_NAME) or request.headers.get(
        "X-Refresh-Token"
    )
    return hdr.strip() if hdr else None
