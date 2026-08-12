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
# Admin bootstrap credentials — SIEMPRE desde environment.
# ══════════════════════════════════════════════════════════════════════════
# `seed_admin_if_needed` corre sólo en el startup del backend cuando la
# colección `admins` está vacía. En cualquier ambiente (dev / staging /
# producción) se requiere que `ADMIN_BOOTSTRAP_EMAIL` y
# `ADMIN_BOOTSTRAP_PASSWORD` estén definidos en el `.env`. Sin ellos, el
# seed se skipea y se loguea una advertencia — nunca se escribe una
# credencial predecible en la base de datos.
#
# Ejemplos:
#   dev:   ADMIN_BOOTSTRAP_EMAIL=admin@padelappretas.com  (en backend/.env)
#          ADMIN_BOOTSTRAP_PASSWORD=admin123              (en backend/.env)
#   prod:  Setear vía Emergent env secrets con valores fuertes.
ADMIN_EMAIL_DEFAULT = os.getenv("ADMIN_BOOTSTRAP_EMAIL", "").strip()
ADMIN_PASSWORD_DEFAULT = os.getenv("ADMIN_BOOTSTRAP_PASSWORD", "")


async def setup_indexes() -> None:
    """Crea los índices únicos requeridos. Idempotente (Mongo lo permite).

    Iter56 — Migración one-shot del índice `telefono_1` a sparse. Esto es
    necesario porque el índice legacy fue creado como unique NON-sparse; al
    autenticarse un segundo usuario vía Google (telefono=None) MongoDB
    lanzaba `E11000 duplicate key on {telefono: null}`, tumbando el flujo.
    """
    # === Migración one-shot: telefono unique → partial ===
    try:
        info = await db.usuarios.index_information()
        # Eliminar índices legacy que colisionan (unique=True sparse=False O sparse=True
        # sin partialFilterExpression). Los recreamos abajo con partialFilterExpression.
        for legacy_name in ("telefono_1", "email_1", "user_id_1"):
            legacy_idx = info.get(legacy_name)
            if legacy_idx is not None and not legacy_idx.get("partialFilterExpression"):
                try:
                    await db.usuarios.drop_index(legacy_name)
                except Exception:
                    pass
    except Exception as exc:  # pragma: no cover — defensivo
        import logging as _l
        _l.getLogger("padelappretas-os").warning(
            "[db] No se pudo migrar índices a partial: %s", exc
        )

    # === Usuarios ===
    # Partial filter: sólo indexa docs donde `telefono` es un string (no null,
    # no faltante). Más robusto que sparse porque Mongo trata `field:null`
    # como VALOR presente (sparse NO lo omite).
    try:
        await db.usuarios.create_index(
            [("telefono", ASCENDING)],
            unique=True,
            partialFilterExpression={"telefono": {"$type": "string"}},
            name="telefono_partial_unique",
        )
    except Exception:
        pass
    # user_id: partial filter idéntico.
    try:
        await db.usuarios.create_index(
            [("user_id", ASCENDING)],
            unique=True,
            partialFilterExpression={"user_id": {"$type": "string"}},
            name="user_id_partial_unique",
        )
    except Exception:
        pass
    # email: partial filter idéntico. Necesario porque los usuarios legacy OTP
    # tienen `email: null` explícito y sparse NO los omite.
    try:
        await db.usuarios.create_index(
            [("email", ASCENDING)],
            unique=True,
            partialFilterExpression={"email": {"$type": "string"}},
            name="email_partial_unique",
        )
    except Exception:
        pass
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

    # === Emergent Auth Sessions (Iter56 — Google/Email login sin OTP) ===
    # `session_token` es el token opaco entregado por Emergent + refresh interno.
    # Almacena {session_token (hash), user_id, expires_at, created_at, ip, ua}.
    # TTL automático borra sesiones vencidas sin cron adicional.
    try:
        await db.user_sessions.create_index("session_token_hash", unique=True)
        await db.user_sessions.create_index("user_id")
        await db.user_sessions.create_index(
            "expires_at", expireAfterSeconds=0
        )
    except Exception:
        pass

    # === Email OTPs (Iter57 · Fase 2 — Magic Link OTP por email) ===
    # TTL sobre `expires_at` limpia códigos vencidos. Índice por email para
    # rate limiting rápido. `codigo_hash` NO se indexa para prevenir
    # timing attacks (aunque son improbables con hash).
    try:
        await db.email_otps.create_index("email")
        await db.email_otps.create_index("created_at")
        await db.email_otps.create_index(
            "expires_at", expireAfterSeconds=0
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
