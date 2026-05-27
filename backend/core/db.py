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

ADMIN_EMAIL_DEFAULT = "admin@padelappretas.com"
ADMIN_PASSWORD_DEFAULT = "admin123"


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


async def seed_admin_if_needed(hash_password_fn) -> bool:
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
