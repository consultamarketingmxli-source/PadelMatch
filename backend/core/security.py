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
    # headers_enabled requiere que CADA endpoint reciba un param `response: Response`,
    # lo cual rompería decenas de rutas existentes. Desactivado — los hits se
    # auditan vía `rate_limit_handler` y `write_security_log`.
    headers_enabled=False,
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
# NOSQL INJECTION SANITIZER  (Ola D)
#
# Bloquea cualquier payload JSON que contenga keys con `$` o `.`
# (vectores de NoSQL injection sobre MongoDB).  Aplica recursivamente
# a dicts y listas.  Saltamos paths de webhooks porque las firmas y
# payloads de Stripe / Mercado Pago / Twilio pueden traer keys con
# puntos legítimos (`data.id`, etc.) y los sanitizamos por código.
# ──────────────────────────────────────────────────────────────────
_NOSQL_SKIP_PATHS = (
    "/api/webhooks/",
    "/api/public/retas/",  # checkout pública usa nombres con puntos a veces
)


def _has_unsafe_key(obj: Any, depth: int = 0) -> Optional[str]:
    """Devuelve el primer key inseguro encontrado o None."""
    if depth > 8:
        return None  # protección contra bombas recursivas
    if isinstance(obj, dict):
        for k, v in obj.items():
            if not isinstance(k, str):
                continue
            if k.startswith("$") or "." in k:
                return k
            bad = _has_unsafe_key(v, depth + 1)
            if bad:
                return bad
    elif isinstance(obj, list):
        for item in obj:
            bad = _has_unsafe_key(item, depth + 1)
            if bad:
                return bad
    return None


class MongoSanitizerMiddleware:
    """Pure ASGI middleware: rechaza payloads JSON con operadores Mongo
    (`$ne`, `$gt`, etc.) o nombres de campo con `.` que permitirían
    pivoteo de queries. Implementado como ASGI puro porque
    `BaseHTTPMiddleware` no permite cachear/re-emitir el body para
    handlers downstream (Starlette envuelve `receive` y nuestra
    sustitución no surte efecto)."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        method = scope.get("method", "")
        path = scope.get("path", "") or scope.get("raw_path", b"").decode("utf-8", "ignore")

        # Solo nos interesan rutas mutantes bajo /api (no webhooks).
        if (
            method not in ("POST", "PUT", "PATCH", "DELETE")
            or not path.startswith("/api")
            or any(path.startswith(p) for p in _NOSQL_SKIP_PATHS)
        ):
            await self.app(scope, receive, send)
            return

        # Solo si declaran JSON. Otros content-types (form, multipart) los dejamos pasar.
        headers = {k.decode().lower(): v.decode() for k, v in scope.get("headers", [])}
        ct = headers.get("content-type", "").lower()
        if "application/json" not in ct:
            await self.app(scope, receive, send)
            return

        # Drenamos el body completo antes de inspeccionarlo.
        body_chunks: list[bytes] = []
        more_body = True
        while more_body:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            body_chunks.append(message.get("body", b"") or b"")
            more_body = message.get("more_body", False)
        body_bytes = b"".join(body_chunks)

        if body_bytes:
            import json as _json

            try:
                parsed = _json.loads(body_bytes)
            except Exception:
                parsed = None
            if parsed is not None:
                bad = _has_unsafe_key(parsed)
                if bad:
                    # Audit log + 400 directo (sin pasar al handler).
                    from starlette.requests import Request as _StarReq

                    _req = _StarReq(scope)
                    await write_security_log(
                        accion="nosql_injection_blocked",
                        request=_req,
                        result="denied",
                        extra={"unsafe_key": bad[:80]},
                    )
                    response = JSONResponse(
                        status_code=400,
                        content={
                            "detail": "Solicitud inválida.",
                            "codigo": "INVALID_PAYLOAD",
                        },
                    )
                    await response(scope, receive, send)
                    return

        # Reemitimos el body cacheado para handlers downstream.
        # La primera llamada devuelve el body cacheado; las siguientes
        # delegan al receive() real (así Starlette puede detectar
        # disconnects reales del cliente sin romper la respuesta).
        _sent = False

        async def _replay_receive():
            nonlocal _sent
            if not _sent:
                _sent = True
                return {
                    "type": "http.request",
                    "body": body_bytes,
                    "more_body": False,
                }
            return await receive()

        await self.app(scope, _replay_receive, send)


# ──────────────────────────────────────────────────────────────────
# ADMIN MUTATION AUDIT  (Ola B)
#
# Cualquier request mutante (POST/PUT/PATCH/DELETE) bajo /api/admin
# o /api/retas (excluyendo /retas/buscar y similares públicos) que
# venga con un JWT admin válido se loguea automáticamente sin tocar
# cada endpoint.  Path + method + status quedan registrados en
# `security_logs` con id_usuario = email del admin.
# ──────────────────────────────────────────────────────────────────
_AUDIT_MUTATION_PREFIXES = (
    "/api/admin",
    "/api/retas",
    "/api/auth",
    "/api/cupones",
)
_AUDIT_SKIP_SUFFIXES = (
    "/login",  # ya audita el handler con más detalle
)


def _decode_jwt_safe(token: str) -> Optional[dict]:
    """Decodifica un JWT sin lanzar — devuelve payload o None."""
    try:
        import jwt as _jwt

        from auth import JWT_ALG, JWT_SECRET  # type: ignore

        return _jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
    except Exception:
        return None


class AdminMutationAuditMiddleware(BaseHTTPMiddleware):
    """Audit log automático de mutaciones admin (compliance / GDPR)."""

    # Normaliza UUIDs / IDs alfanuméricos largos a `:id` para no explotar
    # la cardinalidad de la columna `accion` en `security_logs`.
    import re as _re

    _ID_PATTERNS = [
        _re.compile(r"/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"),
        _re.compile(r"/[0-9a-fA-F]{24,}"),  # mongo ObjectId-like / long hex
    ]

    @classmethod
    def _normalize_path(cls, path: str) -> str:
        out = path
        for pat in cls._ID_PATTERNS:
            out = pat.sub("/:id", out)
        return out

    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)

        # Sólo después de la respuesta, para no impactar latencia.
        try:
            if (
                request.method in ("POST", "PUT", "PATCH", "DELETE")
                and any(request.url.path.startswith(p) for p in _AUDIT_MUTATION_PREFIXES)
                and not any(request.url.path.endswith(s) for s in _AUDIT_SKIP_SUFFIXES)
            ):
                auth_hdr = request.headers.get("authorization") or ""
                if auth_hdr.lower().startswith("bearer "):
                    token = auth_hdr.split(" ", 1)[1].strip()
                    payload = _decode_jwt_safe(token)
                    if payload and payload.get("role") == "admin":
                        result = (
                            "success" if response.status_code < 400 else "denied"
                        )
                        norm_path = self._normalize_path(request.url.path)
                        await write_security_log(
                            accion=f"admin_{request.method.lower()}_{norm_path}",
                            request=request,
                            id_usuario=payload.get("sub"),
                            result=result,
                            extra={
                                "status": response.status_code,
                                "raw_path": request.url.path,
                            },
                        )
        except Exception as e:
            logger.debug("[audit-middleware] skip: %s", e)

        return response


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
    """Aplica todo el blindaje de seguridad sobre el FastAPI app.

    Orden de middleware (añadidos en este orden, ejecutan en REVERSO):
      Request flow  →  MongoSanitizer (outer) → SecurityHeaders → AdminAudit
                       → SlowAPI → endpoint
      Response flow ←  ... ← endpoint
    Esto es CRÍTICO: MongoSanitizer (ASGI puro) debe ser el más externo
    para evitar conflictos con BaseHTTPMiddleware downstream.
    """

    # 1. Rate limiter (slowapi) — primer middleware añadido = más interno.
    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, rate_limit_handler)  # type: ignore[arg-type]
    app.add_middleware(SlowAPIMiddleware)

    # 2. Audit log automático de mutaciones admin (Ola B).
    app.add_middleware(AdminMutationAuditMiddleware)

    # 3. Security headers (HSTS, X-Frame, etc.)
    app.add_middleware(SecurityHeadersMiddleware)

    # 4. NoSQL Injection Sanitizer (Ola D) — ASGI puro, debe ir al final
    # (= más externo) para que envuelva todo el resto.
    app.add_middleware(MongoSanitizerMiddleware)

    # 5. Exception handlers — ocultan stack traces.
    app.add_exception_handler(Exception, safe_exception_handler)  # type: ignore[arg-type]
    app.add_exception_handler(HTTPException, safe_exception_handler)  # type: ignore[arg-type]

    logger.info(
        "[security] middleware instalado · IS_PROD=%s · rate limiter activo · "
        "NoSQL sanitizer activo · admin audit activo",
        IS_PROD,
    )
