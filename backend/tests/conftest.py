"""Shared pytest fixtures for PadelappRetas OS backend tests."""
import asyncio
import importlib
import os
import sys
from pathlib import Path

import pytest
import requests
from dotenv import load_dotenv

# Allow importing backend modules (logica_torneo, etc.)
BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

# Load backend env to access MONGO_URL/DB_NAME if needed
load_dotenv(BACKEND_DIR / ".env")

# Use the PUBLIC URL (Kubernetes ingress) — backend serves on /api prefix
BASE_URL = os.environ.get(
    "EXPO_PUBLIC_BACKEND_URL",
    "https://padel-tournament-hub-9.preview.emergentagent.com",
).rstrip("/")

ADMIN_EMAIL = "admin@padelappretas.com"
ADMIN_PASSWORD = "admin123"


# ════════════════════════════════════════════════════════════════════════════
# ANTI-FLAKE Motor Client Rebind (autouse)
# ────────────────────────────────────────────────────────────────────────────
# Motor (AsyncIOMotorClient) ata `_io_loop` al PRIMER event-loop que ve. Cuando
# pytest corre múltiples suites en secuencia, cada suite puede crear/cerrar su
# propio loop. Tests posteriores que toquen `core.db.db` directamente reciben
# `RuntimeError: Event loop is closed` porque motor sigue apuntando al loop
# muerto.
#
# Solución (autouse, todos los tests):
#   1. Garantizar un loop fresco asignado como global por cada test que lo
#      necesite (fixture detecta uso bajo demanda).
#   2. Re-instanciar el cliente motor ATADO al loop activo.
#   3. Propagar la referencia a TODOS los módulos que cachearon `db` /
#      `client` via `from core.db import db` (binding por módulo).
#   4. NO cerrar/restaurar en teardown — el siguiente test recibe un cliente
#      fresco si vuelve a necesitarlo. Esto evita la doble cerradura.
#
# Tests que SÓLO hacen HTTP (via `requests` al backend live) no se ven afectados
# porque no tocan `core.db` directamente. Tests que sí lo hacen (iter46
# overflow refund) sufren sin esta fixture.
# ════════════════════════════════════════════════════════════════════════════
_MOTOR_REBIND_MODULES = (
    "core.db",
    "routers.mercadopago",
    "routers.payments_router",
    "core.helpers",
    "core.concurrency",
    "services.push_service",
)


@pytest.fixture(autouse=True)
def _motor_loop_rebind():
    """Garantiza loop+motor frescos por test cuando se requiera `core.db`.

    Detecta cuando algún test va a tocar mongo directo y prepara un client
    nuevo. Para tests HTTP-only es no-op (motor no se importa).
    """
    # Si `core.db` no se cargó aún, no hacemos nada — el test no lo necesita.
    if "core.db" not in sys.modules:
        yield
        return

    # Verificar si el loop existente está cerrado o no existe.
    needs_fresh_loop = False
    try:
        loop = asyncio.get_event_loop()
        if loop.is_closed():
            needs_fresh_loop = True
    except RuntimeError:
        needs_fresh_loop = True

    if needs_fresh_loop:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)

    # Re-instanciar motor SOLO si está cargado y el loop cambió. Esto detecta
    # el caso "loop cerrado por test anterior, ahora tenemos uno nuevo".
    try:
        from motor.motor_asyncio import AsyncIOMotorClient  # noqa: PLC0415
        core_db = sys.modules["core.db"]
        existing_client = getattr(core_db, "client", None)
        # Heurística: si el cliente actual está atado a un loop cerrado, lo
        # reemplazamos. Acceder `_io_loop` no es API pública pero es estable
        # en motor 3.x (lo usamos solo para diagnóstico, defensivo en catch).
        client_io_loop = None
        try:
            client_io_loop = getattr(existing_client, "_io_loop", None)
        except Exception:  # pylint: disable=broad-except
            pass
        if client_io_loop is None or client_io_loop.is_closed() or client_io_loop is not loop:
            mongo_url = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
            db_name = os.environ.get("DB_NAME", "padelappretas")
            fresh_client = AsyncIOMotorClient(mongo_url, serverSelectionTimeoutMS=5000)
            fresh_db = fresh_client[db_name]
            for mod_name in _MOTOR_REBIND_MODULES:
                mod = sys.modules.get(mod_name)
                if mod is None:
                    continue
                if hasattr(mod, "client"):
                    mod.client = fresh_client
                if hasattr(mod, "db"):
                    mod.db = fresh_db
    except ImportError:
        pass  # motor no instalado — test no lo necesita

    yield
    # NO cleanup — el siguiente test recibirá lo que necesite (rebind
    # condicional). Cerrar aquí causaría doble close para tests que comparten
    # loop dentro del mismo suite.


@pytest.fixture(scope="session")
def base_url():
    return BASE_URL


@pytest.fixture(scope="session")
def api_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session")
def admin_token(api_client):
    r = api_client.post(
        f"{BASE_URL}/api/auth/login",
        json={"username": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        timeout=20,
    )
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    data = r.json()
    assert "access_token" in data
    return data["access_token"]


@pytest.fixture(scope="session")
def auth_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}
