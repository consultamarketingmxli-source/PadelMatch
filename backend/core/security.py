"""
PadelappRetas — Módulo de Seguridad Centralizado.

Ola A: Headers + Rate Limit + Errores Genéricos
Ola B: Audit Log + RBAC reforzado

Implementado por el Ingeniero Principal de Ciberseguridad / DevSecOps:
  • Middleware de cabeceras de seguridad (HSTS, X-Frame-Options, etc.)
  • Rate limiter por IP con slowapi (token bucket en memoria)
  • Exception handler global que oculta stack traces y devuelve UUID
  • Logger inmutable hacia colección MongoDB `security_logs`
  • Helpers RBAC para verificar permisos admin con audit trail
"""
from __future__ import annotations

import logging
import os
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import FastAPI, HTTPException, Request, status
from fastapi.responses import JSONResponse
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from slowapi.util import get_remote_address
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.types import ASGIApp

logger = logging.getLogger("padelappretas-security")

# Por defecto desplegamos en producción detrás de un ingress HTTPS.
# Override con SECURITY_PROD=false para entornos de desarrollo locales.
IS_PROD = os.getenv("SECURITY_PROD", "true").lower() == "true"


# ──────────────────────────────────────────────────────────────────
# RATE LIMITER (slowapi)
#
# Token bucket en memoria por proceso. Estrategia:
#   • Identificador: client.host (IP del request, atrás del ingress
#     usamos X-Forwarded-For si está disponible).
#   • Endpoints críticos: 5 intentos / minuto, ventana deslizante.
#   • Si supera, devuelve 429 inmediato (sin bloqueo persistente —
#     queda como follow-up para móvil/Redis).
# ──────────────────────────────────────────────────────────────────


def _client_identifier(request: Request) -> str:
    """Prioriza X-Forwarded-For (detrás del ingress) sobre socket peer."""
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        # Toma el primero (cliente real)
        return fwd.split(",")[0].strip()
    return get_remote_address(request)


limiter = Limiter(
    key_func=_client_identifier,
    # Default conservador para todos los endpoints (se sobrescribe por endpoint)
    default_limits=["120/minute"],
    headers_enabled=True,
)


# ──────────────────────────────────────────────────────────────────
# SECURITY HEADERS MIDDLEWARE
#
# Cabeceras OWASP recomendadas:
#   • Strict-Transport-Security  — fuerza HTTPS por 6 meses (HSTS)
#   • X-Content-Type-Options     — bloquea MIME sniffing
#   • X-Frame-Options            — anti-clickjacking
#   • Referrer-Policy            — privacidad del referer
#   • Permissions-Policy         — limita APIs sensibles del navegador
#   • X-Padelapp-Request-Id      — correlación con audit_log
# ──────────────────────────────────────────────────────────────────
class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        # Genera un request id correlable para auditoría/errores
        request_id = uuid.uuid4().hex[:16]
        request.state.request_id = request_id

        response = await call_next(request)

        if IS_PROD:
            # HSTS: 6 meses + incluye subdominios (Apple/Apple Search también lo exigen)
            response.headers["Strict-Transport-Security"] = (
                "max-age=15552000; includeSubDomains"
            )
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = (
            "camera=(), microphone=(), geolocation=(self), payment=(self)"
        )
        response.headers["X-Padelapp-Request-Id"] = request_id
        # Nunca cachear respuestas autenticadas/mutables
        if request.method != "GET":
            response.headers["Cache-Control"] = "no-store"
        return response


# ──────────────────────────────────────────────────────────────────
# GLOBAL EXCEPTION HANDLER
#
# Especificación del usuario:
#   "Ha ocurrido un error en el servidor. Reporte ID: [UUID]"
#
# Reglas:
#   • HTTPException (4xx) → pasa el detail tal cual al cliente
#     (es info safe: "Credenciales inválidas", "No encontrado", etc.)
#   • Excepciones no controladas (500) → mensaje genérico + UUID
#     y logueamos el stack completo en backend.err.log con el UUID
#     para poder diagnosticar.
# ──────────────────────────────────────────────────────────────────
async def safe_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    if isinstance(exc, HTTPException):
        # Estos son errores de cliente esperados — no rastrear stack.
        return JSONResponse(
            status_code=exc.status_code,
            content={"detail": exc.detail},
        )

    # Error 500 inesperado — generar UUID y loguear stack completo.
    err_id = uuid.uuid4().hex
    request_id = getattr(request.state, "request_id", "?")
    logger.exception(
        "[UNHANDLED] err_id=%s request_id=%s path=%s method=%s",
        err_id,
        request_id,
        request.url.path,
        request.method,
    )
    return JSONResponse(
        status_code=500,
        content={
            "detail": "Ha ocurrido un error en el servidor.",
            "reporte_id": err_id,
            "mensaje_usuario": f"Ha ocurrido un error en el servidor. Reporte ID: {err_id}",
        },
    )


# ──────────────────────────────────────────────────────────────────
# AUDIT LOG (Ola B — `security_logs` MongoDB collection)
#
# Cada evento crítico genera un registro inmutable con:
#   id_usuario, accion_realizada, timestamp, ip_origen, user_agent, result
#
# Nunca falla la operación principal si el audit log falla — se loggea
# por separado y devuelve None.
# ──────────────────────────────────────────────────────────────────


SecurityLogResult = str  # "success" | "denied" | "rate_limited" | "error" | ...


async def write_security_log(
    *,
    accion: str,
    request: Optional[Request] = None,
    id_usuario: Optional[str] = None,
    result: SecurityLogResult = "success",
    extra: Optional[dict[str, Any]] = None,
) -> None:
    """Inserta un log inmutable de auditoría. Nunca rompe el flujo principal."""
    try:
        # Import lazy para evitar ciclos al cargar el módulo.
        from core.db import db  # type: ignore

        doc = {
            "_id": uuid.uuid4().hex,
            "accion": accion,
            "id_usuario": id_usuario,
            "result": result,
            "timestamp": datetime.now(timezone.utc),
            "ip_origen": _client_identifier(request) if request else None,
            "user_agent": request.headers.get("user-agent") if request else None,
            "request_id": getattr(request.state, "request_id", None) if request else None,
            "path": request.url.path if request else None,
            "method": request.method if request else None,
            "extra": extra or {},
        }
        await db["security_logs"].insert_one(doc)
    except Exception as e:
        # Nunca propagamos errores de audit log para no romper el flujo.
        logger.warning("[AUDIT-LOG-FAIL] accion=%s err=%s", accion, str(e)[:200])


# ──────────────────────────────────────────────────────────────────
# RATE LIMIT EXCEEDED — con audit
# ──────────────────────────────────────────────────────────────────
async def rate_limit_handler(request: Request, exc: RateLimitExceeded) -> JSONResponse:
    # Audit del intento de fuerza bruta.
    await write_security_log(
        accion="rate_limit_exceeded",
        request=request,
        result="rate_limited",
        extra={"limit": str(exc.detail)},
    )
    response = _rate_limit_exceeded_handler(request, exc)
    return JSONResponse(
        status_code=response.status_code,
        content={
            "detail": "Demasiados intentos. Por favor espera unos minutos antes de volver a intentar.",
            "retry_after_seconds": 60,
        },
        headers=dict(response.headers),
    )


# ──────────────────────────────────────────────────────────────────
# Instalador único: configura todo en la app.
# ──────────────────────────────────────────────────────────────────
def install_security(app: FastAPI) -> None:
    """Aplica todo el blindaje de seguridad sobre el FastAPI app."""

    # 1. Rate limiter (slowapi)
    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, rate_limit_handler)  # type: ignore[arg-type]
    app.add_middleware(SlowAPIMiddleware)

    # 2. Security headers (HSTS, X-Frame, etc.)
    app.add_middleware(SecurityHeadersMiddleware)

    # 3. Global exception handler — oculta stack traces.
    app.add_exception_handler(Exception, safe_exception_handler)  # type: ignore[arg-type]
    app.add_exception_handler(HTTPException, safe_exception_handler)  # type: ignore[arg-type]

    logger.info(
        "[security] middleware instalado · IS_PROD=%s · rate limiter activo",
        IS_PROD,
    )
