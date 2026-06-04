"""
core/ip_geo.py — Resolución IP → ciudad/país con caché.

Estrategia:
  1. Caché en `db.ip_geo_cache` con TTL 30 días — minimiza llamadas externas.
  2. Proveedor: ip-api.com (gratis, no requiere API key, límite 45 req/min).
  3. Fallback gracioso: si la API falla, devolvemos `None` y el caller usa
     el IP crudo (degradación graceful, no rompe nada).
  4. Skip IPs locales/privadas: 127.0.0.1, 10.x, 192.168.x, etc.
"""
from __future__ import annotations

import ipaddress
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

import httpx

logger = logging.getLogger("padelappretas-security")

_GEO_API = "http://ip-api.com/json/{ip}?fields=status,country,countryCode,region,city,query"
_CACHE_TTL_DAYS = 30


def _is_private_or_local(ip: str) -> bool:
    """True para IPs que no tiene sentido geolocalizar."""
    if not ip:
        return True
    try:
        ipobj = ipaddress.ip_address(ip)
        return ipobj.is_private or ipobj.is_loopback or ipobj.is_link_local
    except ValueError:
        return True


async def _ensure_cache_indices(db) -> None:
    try:
        await db.ip_geo_cache.create_index("ip", unique=True)
    except Exception:
        pass
    try:
        await db.ip_geo_cache.create_index(
            "cached_at",
            expireAfterSeconds=_CACHE_TTL_DAYS * 86_400,
        )
    except Exception:
        pass


async def resolve_ip_geo(ip: Optional[str]) -> Optional[dict]:
    """
    Devuelve {city, country, country_code, region} o None.
    Resultado cacheado por 30 días para minimizar llamadas a la API.
    """
    if not ip or _is_private_or_local(ip):
        return None
    # Import lazy para evitar ciclos.
    from core.db import db  # type: ignore

    await _ensure_cache_indices(db)

    # 1) Cache hit?
    cached = await db.ip_geo_cache.find_one({"ip": ip}, {"_id": 0})
    if cached:
        return {
            "city": cached.get("city"),
            "country": cached.get("country"),
            "country_code": cached.get("country_code"),
            "region": cached.get("region"),
        }

    # 2) Cache miss → API lookup
    try:
        async with httpx.AsyncClient(timeout=4.0) as client:
            resp = await client.get(_GEO_API.format(ip=ip))
        if resp.status_code != 200:
            return None
        data = resp.json()
        if data.get("status") != "success":
            return None
        result = {
            "city": data.get("city") or None,
            "country": data.get("country") or None,
            "country_code": data.get("countryCode") or None,
            "region": data.get("region") or None,
        }
        # 3) Persistir cache (no bloquea si falla)
        try:
            await db.ip_geo_cache.insert_one({
                "ip": ip,
                **result,
                "cached_at": datetime.now(timezone.utc),
            })
        except Exception:
            pass
        return result
    except Exception as e:
        logger.warning("[IP-GEO-FAIL] ip=%s err=%s", ip, str(e)[:120])
        return None


def format_location(geo: Optional[dict]) -> str:
    """Formato amigable: 'Ciudad de México, MX' o '—' si no hay datos."""
    if not geo:
        return "—"
    parts = []
    if geo.get("city"):
        parts.append(geo["city"])
    if geo.get("country_code"):
        parts.append(geo["country_code"])
    return ", ".join(parts) if parts else "—"
