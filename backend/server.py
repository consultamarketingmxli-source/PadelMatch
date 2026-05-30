"""
PadelappRetas — API principal FastAPI.

Entry point: configura app, middleware, startup/shutdown, e incluye routers.
Toda la lógica vive en /app/backend/routers/ y /app/backend/core/.
"""
import asyncio
import logging
import os

from fastapi import APIRouter, FastAPI
from starlette.middleware.cors import CORSMiddleware

from auth import hash_password
from core.db import close as close_db
from core.db import seed_admin_if_needed, setup_indexes
from core.helpers import cronjob_expirar_bloqueos, cronjob_recordatorios
from core.security import install_security
from routers.admin_dashboard import router as admin_dashboard_router
from routers.cupones import router_admin as cupones_admin_router
from routers.cupones import router_cancel as cupones_cancel_router
from routers.cupones import router_public as cupones_public_router
from routers.deploy_readiness import router as deploy_readiness_router
from routers.auth_router import router as auth_router
from routers.export_router import router as export_router
from routers.inscripciones import router as inscripciones_router
from routers.mercadopago import router as mercadopago_router
from routers.notify_admin import router as notify_admin_router
from routers.notify_admin import twilio_router as twilio_admin_router
from routers.parejas_admin import router as parejas_admin_router
from routers.payments_router import router as payments_router
from routers.pdf_router import router as pdf_router
from routers.player_auth import router as player_auth_router
from routers.public import router as public_router
from routers.realtime_ws import router as realtime_ws_router
from routers.resultados import router as resultados_router
from routers.retas import router as retas_router
from routers.rsvp import router_admin as rsvp_admin_router
from routers.security_admin import router as security_admin_router
from routers.rsvp import router_public as rsvp_public_router
from routers.clubes import router as clubes_public_router
from routers.soporte import router_admin as soporte_admin_router
from routers.soporte import router_public as soporte_public_router

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger("padelappretas-os")

app = FastAPI(title="PadelappRetas API")

# ============== Seguridad (Ola A): Headers + Rate Limit + Errores Genéricos ==============
install_security(app)

api = APIRouter(prefix="/api")

# Incluir todos los routers bajo /api
api.include_router(auth_router)
api.include_router(player_auth_router)
api.include_router(retas_router)
api.include_router(admin_dashboard_router)
api.include_router(cupones_admin_router)
api.include_router(cupones_cancel_router)
api.include_router(cupones_public_router)
api.include_router(deploy_readiness_router)
api.include_router(public_router)
api.include_router(inscripciones_router)
api.include_router(payments_router)
api.include_router(mercadopago_router)
api.include_router(notify_admin_router)
api.include_router(twilio_admin_router)
api.include_router(parejas_admin_router)
api.include_router(resultados_router)
api.include_router(realtime_ws_router)
api.include_router(pdf_router)
api.include_router(export_router)
api.include_router(rsvp_public_router)
api.include_router(rsvp_admin_router)
api.include_router(clubes_public_router)
api.include_router(soporte_public_router)
api.include_router(soporte_admin_router)
api.include_router(security_admin_router)


@api.get("/")
async def health():
    return {"status": "ok", "app": "PadelappRetas OS API"}


app.include_router(api)


# ============== Startup / Shutdown ==============
@app.on_event("startup")
async def startup():
    await setup_indexes()
    seeded = await seed_admin_if_needed(hash_password)
    if seeded:
        logger.info("Admin seedeado (admin@padelappretas.com / admin123)")
    asyncio.create_task(cronjob_recordatorios())
    asyncio.create_task(cronjob_expirar_bloqueos())


@app.on_event("shutdown")
async def shutdown():
    close_db()


# ============== CORS ==============
# AUDIT FIX (DevSecOps · Comité Élite):
#   La combinación allow_origins=["*"] + allow_credentials=True es INVÁLIDA
#   por spec CORS (browsers rechazan la respuesta con credenciales y *).
#   Estrategia segura:
#     - Si CORS_ORIGINS está explícitamente listado → credenciales OK.
#     - Si CORS_ORIGINS=="*" (catch-all dev) → credenciales OFF para evitar
#       que un origen malicioso adjunte cookies HttpOnly del refresh token.
#   El APP_PUBLIC_URL y dominios de preview se añaden implícitamente.
_cors_origins_env = os.getenv("CORS_ORIGINS", "*").strip()
_app_public = os.getenv("APP_PUBLIC_URL", "").strip().rstrip("/")
if _cors_origins_env == "*":
    _cors_origins: list[str] = ["*"]
    _cors_allow_credentials = False  # spec-compliant
else:
    _cors_origins = [o.strip().rstrip("/") for o in _cors_origins_env.split(",") if o.strip()]
    # Asegura que el dominio público de la app siempre esté permitido.
    if _app_public and _app_public not in _cors_origins:
        _cors_origins.append(_app_public)
    _cors_allow_credentials = True

app.add_middleware(
    CORSMiddleware,
    allow_credentials=_cors_allow_credentials,
    allow_origins=_cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)
