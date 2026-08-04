"""Conexión MongoDB compartida + setup de índices."""
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo import ASCENDING, TEXT

ROOT_DIR = Path(__file__).resolve().parent.parent
load_dotenv(ROOT_DIR / ".env")

mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]

# ══════════════════════════════════════════════════════════════════════════
# Admin bootstrap credentials — MUST come from environment in production.
# ══════════════════════════════════════════════════════════════════════════
# Estos valores se usan UNA sola vez al arrancar el backend cuando la
# colección `admins` está vacía (bootstrap inicial). En producción, siempre
# se debe setear `ADMIN_BOOTSTRAP_EMAIL` + `ADMIN_BOOTSTRAP_PASSWORD` en el
# `.env` para evitar credenciales predecibles.
#
# Fallback SÓLO se activa si `IS_PROD` NO es truthy (dev / test). En prod
# sin env vars, `bootstrap_admin_if_empty` skipea el seed y loguea una
# advertencia para que el operador cree el admin manualmente.
_IS_PROD = os.getenv("IS_PROD", "").lower() in ("1", "true", "yes")
ADMIN_EMAIL_DEFAULT = os.getenv(
    "ADMIN_BOOTSTRAP_EMAIL",
    "admin@padelappretas.com" if not _IS_PROD else "",
)
ADMIN_PASSWORD_DEFAULT = os.getenv(
    "ADMIN_BOOTSTRAP_PASSWORD",
    "admin123" if not _IS_PROD else "",
)


async def setup_indexes() -> None:
    """Crea los índices únicos requeridos. Idempotente (Mongo lo permite)."""
    await db.usuarios.create_index([("telefono", ASCENDING)], unique=True)
    await db.retas.create_index([("url_slug", ASCENDING)], unique=True)
    await db.lista_espera.create_index(
        [("reta_id", ASCENDING), ("posicion_fila", ASCENDING)], unique=True
    )
    await db.resultados.create_index(
        [("reta_id", ASCENDING), ("cancha", ASCENDING),
         ("ronda", ASCENDING), ("partido_idx", ASCENDING)],
        unique=True,
    )
    await db.stripe_transactions.create_index("session_id", unique=True)
    await db.stripe_transactions.create_index("inscripcion_id")
    await db.stripe_events.create_index("event_id", unique=True)
    # OTPs de jugadores con auto-expiración por TTL (Mongo limpia automáticamente)
    await db.player_otps.create_index("expires_at_dt", expireAfterSeconds=0)
    await db.player_otps.create_index("telefono", unique=True)
    # === Cupones (motor de marketing) ===
    # codigo único en TODA la DB (no colisiona entre organizadores).
    await db.cupones.create_index("codigo", unique=True)
    await db.cupones.create_index("organizador_id")
    await db.cupones.create_index([("organizador_id", ASCENDING), ("usado", ASCENDING)])
    await db.cupones.create_index("reta_id_exclusivo")

    # === Motor de búsqueda híbrido ===
    # Índice de texto sobre nombre + club para búsqueda por coincidencia parcial.
    # MongoDB usa stemming + tokenización ($text). Para sub-cadenas usamos $regex
    # con índice B-Tree adicional sobre el campo crudo.
    try:
        await db.retas.create_index(
            [("nombre", TEXT), ("club", TEXT)],
            name="retas_text_idx",
            default_language="spanish",
        )
    except Exception:
        # Si ya existe con otra definición lo dejamos pasar (idempotente).
        pass
    # B-Tree de soporte para sort por fecha_evento (orden por defecto del feed).
    await db.retas.create_index([("fecha_evento", ASCENDING)])
    # 2dsphere para futuras consultas geo nativas (compatible con docs sin lat/lng).
    await db.retas.create_index([("latitud", ASCENDING), ("longitud", ASCENDING)], sparse=True)

    # === Directorio de Clubes (Selector Inteligente) ===
    # Dedupe por nombre normalizado (lowercase+sin acentos+trim).
    try:
        await db.clubes.create_index("nombre_norm", unique=True)
    except Exception:
        pass
    # Substring search rápido sobre nombre y dirección.
    try:
        await db.clubes.create_index([("nombre", ASCENDING)])
        await db.clubes.create_index([("direccion_completa", ASCENDING)])
    except Exception:
        pass
    # Sparse para evitar errores con docs sin coords.
    await db.clubes.create_index(
        [("latitud", ASCENDING), ("longitud", ASCENDING)], sparse=True
    )

    # === Alertas Organizador (Fase B — Soporte) ===
    # Query principal del inbox: por organizador + leida (con sort por fecha).
    try:
        await db.alertas_organizador.create_index(
            [("organizador_id", ASCENDING), ("leida", ASCENDING), ("creada_en", -1)]
        )
        # Lookup directo por reta_id en admin attendance view.
        await db.alertas_organizador.create_index([("reta_id", ASCENDING)])
    except Exception:
        pass

    # === Security Audit Log (Ola B — DevSecOps) ===
    # TTL 365 días + índices por acción/usuario/timestamp.
    try:
        await db.security_logs.create_index(
            "timestamp", expireAfterSeconds=365 * 24 * 60 * 60
        )
        await db.security_logs.create_index([("accion", ASCENDING), ("timestamp", -1)])
        await db.security_logs.create_index([("id_usuario", ASCENDING), ("timestamp", -1)])
        await db.security_logs.create_index([("result", ASCENDING), ("timestamp", -1)])
    except Exception:
        pass

    # === Refresh Tokens (Ola E — DevSecOps) ===
    # TTL automático sobre expires_at + lookup rápido por hash y revocación masiva.
    try:
        await db.refresh_tokens.create_index("expires_at", expireAfterSeconds=0)
        await db.refresh_tokens.create_index("token_hash", unique=True)
        await db.refresh_tokens.create_index(
            [("user_id", ASCENDING), ("revoked", ASCENDING)]
        )
    except Exception:
        pass


async def seed_admin_if_needed(hash_password_fn) -> bool:
    """Seedea admin bootstrap si la colección está vacía.

    En producción, requiere que `ADMIN_BOOTSTRAP_EMAIL` y
    `ADMIN_BOOTSTRAP_PASSWORD` estén definidos en el entorno. Si faltan,
    NO se seedea y el operador debe crear el admin manualmente.
    """
    import logging as _logging
    _logger = _logging.getLogger("padelappretas-os")
    if not ADMIN_EMAIL_DEFAULT or not ADMIN_PASSWORD_DEFAULT:
        _logger.warning(
            "[bootstrap] Admin no seedeado — falta ADMIN_BOOTSTRAP_EMAIL/PASSWORD en env. "
            "Créalo manualmente vía POST /api/admin/register o el CLI de seed."
        )
        return False
    existing = await db.admins.find_one({"email": ADMIN_EMAIL_DEFAULT})
    if existing:
        return False
    await db.admins.insert_one({
        "id": str(uuid.uuid4()),
        "email": ADMIN_EMAIL_DEFAULT,
        "hashed_password": hash_password_fn(ADMIN_PASSWORD_DEFAULT),
        "creado_en": datetime.now(timezone.utc).isoformat(),
    })
    return True


def close() -> None:
    client.close()
