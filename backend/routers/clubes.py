"""
Módulo de Selección Inteligente de Clubes de Pádel.

Endpoints públicos:
    GET /api/public/clubes/buscar?q=&lat=&lng=&radio_km=&limit=
        Autocompletado del directorio:
        - q (opcional): substring case-insensitive en nombre + dirección.
        - lat/lng (opcional): si se provee, ordena por proximidad Haversine
          (los que NO tienen coords quedan al final).
        - radio_km (opcional, default 50): solo aplica si hay lat/lng;
          filtra fuera de ese radio. 0 o negativo lo desactiva.
        - limit (default 12, max 50): tope de resultados.

Helpers internos:
    upsert_club_silencioso(nombre, direccion?, lat?, lng?)
        Enriquecimiento silencioso. Cuando un organizador crea una reta con
        texto libre de club, llamamos aquí para guardar/actualizar el club
        en el directorio. Dedupe por nombre normalizado (lowercase+trim).
        - Nunca lanza; si falla, el creador sigue su flujo.
        - Devuelve el club_id (uuid string) o None si decidimos no guardar.
"""
from __future__ import annotations

import logging
import math
import re
import unicodedata
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Query
from pydantic import BaseModel, Field

from core.db import db

logger = logging.getLogger("padelappretas-os")

router = APIRouter(prefix="/public/clubes", tags=["clubes-public"])


# ============================================================================
# Modelos
# ============================================================================

class ClubOut(BaseModel):
    id: str
    nombre: str
    direccion_completa: Optional[str] = ""
    latitud: Optional[float] = None
    longitud: Optional[float] = None
    distancia_km: Optional[float] = None  # se rellena cuando hay GPS


# ============================================================================
# Helpers
# ============================================================================

def _norm(s: str) -> str:
    """Normaliza para dedupe: lower + strip + sin acentos + espacios colapsados."""
    if not s:
        return ""
    s = s.strip().lower()
    s = "".join(
        c for c in unicodedata.normalize("NFKD", s) if not unicodedata.combining(c)
    )
    s = re.sub(r"\s+", " ", s)
    return s


def _haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    R = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(min(1.0, math.sqrt(a)))


async def upsert_club_silencioso(
    nombre: str,
    direccion: Optional[str] = None,
    lat: Optional[float] = None,
    lng: Optional[float] = None,
) -> Optional[str]:
    """Crea o actualiza un club en el directorio sin romper jamás el flujo
    de creación de reta. Cualquier excepción se silencia (log warn).

    Estrategia:
      1. Si el nombre normalizado coincide con un club existente, devolvemos
         su id. Si trae datos nuevos (dir/lat/lng) y el existente tenía vacíos,
         hacemos $set parcial (enriquecimiento).
      2. Si no existe, insertamos uno nuevo.

    Returns:
        club_id (str) o None si nombre está vacío o falló la op.
    """
    try:
        nombre_clean = (nombre or "").strip()
        if len(nombre_clean) < 2:
            return None
        nombre_norm = _norm(nombre_clean)

        existing = await db.clubes.find_one({"nombre_norm": nombre_norm}, {"_id": 0})
        if existing:
            # Enriquecimiento parcial: solo seteamos los nuevos campos si
            # el existente NO los tenía.
            update_set: dict = {}
            if direccion and not existing.get("direccion_completa"):
                update_set["direccion_completa"] = direccion.strip()[:240]
            if lat is not None and existing.get("latitud") is None:
                update_set["latitud"] = float(lat)
            if lng is not None and existing.get("longitud") is None:
                update_set["longitud"] = float(lng)
            if update_set:
                update_set["actualizado_en"] = datetime.now(timezone.utc).isoformat()
                await db.clubes.update_one({"id": existing["id"]}, {"$set": update_set})
            return existing["id"]

        # Insert nuevo
        new_id = str(uuid.uuid4())
        await db.clubes.insert_one({
            "id": new_id,
            "nombre": nombre_clean[:80],
            "nombre_norm": nombre_norm,
            "direccion_completa": (direccion or "").strip()[:240] or "",
            "latitud": float(lat) if lat is not None else None,
            "longitud": float(lng) if lng is not None else None,
            "creado_en": datetime.now(timezone.utc).isoformat(),
            "fuente": "organic",  # vs "seed" si hiciéramos seed manual a futuro
        })
        return new_id
    except Exception as e:  # pragma: no cover — guardia defensiva
        logger.warning("upsert_club_silencioso falló para '%s': %s", nombre, e)
        return None


# ============================================================================
# Endpoints
# ============================================================================

@router.get("/buscar")
async def buscar_clubes(
    q: Optional[str] = Query(None, max_length=120),
    lat: Optional[float] = Query(None, ge=-90, le=90),
    lng: Optional[float] = Query(None, ge=-180, le=180),
    radio_km: Optional[float] = Query(50.0, ge=0, le=1000),
    limit: int = Query(12, ge=1, le=50),
):
    """Autocompletado + opcional geo-ordering del directorio de clubes.

    Estrategia anti-error:
      - Si la colección está vacía: devuelve [] (front muestra "Usar como ubicación personalizada").
      - Si q viene vacío y NO hay coords: devuelve los más usados (sort por creado_en desc).
      - Si lat/lng inválidos: ignoramos geo silenciosamente y aplicamos solo texto.
      - Nunca devuelve 500: en error retorna {results: [], error: str}.
    """
    try:
        # 1) Filtro de texto (sub-cadena case-insensitive en nombre + dirección)
        mongo_filter: dict = {}
        if q and q.strip():
            term = q.strip()
            # Escape regex specials para evitar inyección de patrones.
            escaped = re.escape(term)
            mongo_filter["$or"] = [
                {"nombre": {"$regex": escaped, "$options": "i"}},
                {"direccion_completa": {"$regex": escaped, "$options": "i"}},
            ]

        has_geo = lat is not None and lng is not None

        # Si NO hay texto NI geo, devolvemos los más recientes como sugerencias.
        cursor = db.clubes.find(mongo_filter, {"_id": 0})
        if not has_geo:
            cursor = cursor.sort("creado_en", -1)

        # Materializamos como lista para ordenar con Haversine en memoria si hay geo.
        # Capamos a 200 antes de Haversine para evitar cargar toda la DB.
        docs = []
        async for c in cursor.limit(200 if has_geo else limit):
            docs.append(c)

        if has_geo:
            # Calcula distancia para los que tienen coords; los demás van al final.
            def _key(c):
                la = c.get("latitud")
                lo = c.get("longitud")
                if la is None or lo is None:
                    return (1, float("inf"))  # sin coords → al final
                try:
                    d = _haversine_km(lat, lng, float(la), float(lo))
                    c["__distancia"] = d
                    return (0, d)
                except Exception:
                    return (1, float("inf"))

            docs.sort(key=_key)

            # Filtro por radio si aplica (radio_km>0 y solo para los que tienen coords).
            if radio_km and radio_km > 0:
                filtrados = []
                for c in docs:
                    d = c.get("__distancia")
                    if d is None:
                        # Los sin coords igual los mostramos al final (no los filtramos).
                        filtrados.append(c)
                    elif d <= radio_km:
                        filtrados.append(c)
                docs = filtrados

            docs = docs[:limit]

        results = []
        for c in docs:
            results.append({
                "id": c["id"],
                "nombre": c.get("nombre", ""),
                "direccion_completa": c.get("direccion_completa", "") or "",
                "latitud": c.get("latitud"),
                "longitud": c.get("longitud"),
                "distancia_km": (
                    round(c["__distancia"], 2) if c.get("__distancia") is not None else None
                ),
            })

        return {"results": results, "total": len(results)}
    except Exception as e:
        logger.exception("Error en /clubes/buscar: %s", e)
        # Nunca devolvemos 500 al frontend — degradamos a lista vacía.
        return {"results": [], "total": 0, "error": "search_unavailable"}
