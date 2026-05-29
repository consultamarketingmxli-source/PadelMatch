"""
Centro de Seguridad — endpoints solo-admin (super-admin + admins normales).

Expone:
  - GET /api/admin/security/logs   → visor paginado de security_logs con filtros.
  - GET /api/admin/security/stats  → métricas agregadas últimos N días.
  - GET /api/admin/security/sessions/active → refresh tokens activos en el sistema.

Todos los endpoints requieren JWT admin (role=='admin'). La lectura de
security_logs en sí queda auditada vía AdminMutationAuditMiddleware
(método GET no, pero el acceso a logs es un evento sensible — lo registramos
explícitamente con `write_security_log`).
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from auth import get_current_admin
from core.db import db
from core.security import write_security_log

router = APIRouter(prefix="/admin/security", tags=["admin-security"])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _iso(dt: Optional[datetime]) -> Optional[str]:
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat()


def _parse_iso(s: Optional[str]) -> Optional[datetime]:
    if not s:
        return None
    try:
        # Acepta `YYYY-MM-DD` o ISO completo.
        if len(s) == 10:
            return datetime.fromisoformat(s).replace(tzinfo=timezone.utc)
        out = datetime.fromisoformat(s.replace("Z", "+00:00"))
        if out.tzinfo is None:
            out = out.replace(tzinfo=timezone.utc)
        return out
    except Exception:
        return None


# ---------------------------------------------------------------------------
# GET /api/admin/security/logs  — Visor paginado
# ---------------------------------------------------------------------------
@router.get("/logs")
async def list_security_logs(
    request: Request,
    accion: Optional[str] = Query(None, description="Prefijo de la acción (e.g. 'admin_' o 'refresh_')"),
    id_usuario: Optional[str] = Query(None, description="Filtra por sub/email/teléfono exacto"),
    result: Optional[str] = Query(None, description="success | denied | rate_limited | error"),
    from_date: Optional[str] = Query(None, alias="from", description="ISO date/datetime"),
    to_date: Optional[str] = Query(None, alias="to", description="ISO date/datetime"),
    limit: int = Query(50, ge=1, le=200),
    skip: int = Query(0, ge=0),
    current=Depends(get_current_admin),
):
    """Lista paginada de eventos de seguridad. Solo admins."""
    q: dict = {}
    if accion:
        q["accion"] = {"$regex": f"^{accion}", "$options": "i"}
    if id_usuario:
        q["id_usuario"] = id_usuario
    if result:
        q["result"] = result
    rng: dict = {}
    f = _parse_iso(from_date)
    t = _parse_iso(to_date)
    if f:
        rng["$gte"] = f
    if t:
        rng["$lte"] = t
    if rng:
        q["timestamp"] = rng

    total = await db.security_logs.count_documents(q)
    cursor = (
        db.security_logs.find(q, {"_id": 0})
        .sort("timestamp", -1)
        .skip(skip)
        .limit(limit)
    )
    items = []
    async for d in cursor:
        items.append(
            {
                "accion": d.get("accion"),
                "id_usuario": d.get("id_usuario"),
                "result": d.get("result"),
                "ip_origen": d.get("ip_origen"),
                "user_agent": (d.get("user_agent") or "")[:120],
                "timestamp": _iso(d.get("timestamp")),
                "extra": d.get("extra") or {},
            }
        )

    # El propio acto de consultar el log de auditoría queda auditado.
    await write_security_log(
        accion="admin_security_logs_viewed",
        request=request,
        id_usuario=current["sub"],
        result="success",
        extra={"filter": (str({k: str(v) for k, v in q.items()})[:200] if q else None), "count": len(items)},
    )

    return {
        "items": items,
        "total": total,
        "limit": limit,
        "skip": skip,
        "has_more": skip + len(items) < total,
    }


# ---------------------------------------------------------------------------
# GET /api/admin/security/stats — Métricas top-line
# ---------------------------------------------------------------------------
@router.get("/stats")
async def security_stats(
    days: int = Query(7, ge=1, le=90),
    current=Depends(get_current_admin),
):
    """Métricas agregadas de los últimos N días (default 7)."""
    since = datetime.now(timezone.utc) - timedelta(days=days)

    total_events = await db.security_logs.count_documents({"timestamp": {"$gte": since}})

    # Counts por acción (top 10).
    pipe_top_actions = [
        {"$match": {"timestamp": {"$gte": since}}},
        {"$group": {"_id": "$accion", "count": {"$sum": 1}}},
        {"$sort": {"count": -1}},
        {"$limit": 10},
    ]
    top_actions = [
        {"accion": d["_id"], "count": d["count"]}
        async for d in db.security_logs.aggregate(pipe_top_actions)
    ]

    # Counts por resultado.
    pipe_results = [
        {"$match": {"timestamp": {"$gte": since}}},
        {"$group": {"_id": "$result", "count": {"$sum": 1}}},
    ]
    by_result = {
        d["_id"]: d["count"] async for d in db.security_logs.aggregate(pipe_results)
    }

    # Acciones críticas específicas.
    failed_logins = await db.security_logs.count_documents(
        {"timestamp": {"$gte": since}, "accion": {"$in": ["admin_login_failed", "otp_verify_failed"]}}
    )
    nosql_blocks = await db.security_logs.count_documents(
        {"timestamp": {"$gte": since}, "accion": "nosql_injection_blocked"}
    )
    rate_limited = await db.security_logs.count_documents(
        {"timestamp": {"$gte": since}, "accion": "rate_limit_exceeded"}
    )
    account_deletions = await db.security_logs.count_documents(
        {"timestamp": {"$gte": since}, "accion": "account_deletion_completed"}
    )
    refresh_reuse = await db.security_logs.count_documents(
        {"timestamp": {"$gte": since}, "accion": "refresh_reuse_detected"}
    )
    mp_signature_blocks = await db.security_logs.count_documents(
        {"timestamp": {"$gte": since}, "accion": "mp_webhook_signature_invalid"}
    )

    # Sesiones (refresh tokens) actualmente activos.
    now = datetime.now(timezone.utc)
    active_sessions = await db.refresh_tokens.count_documents(
        {"revoked": False, "expires_at": {"$gt": now}}
    )

    return {
        "window_days": days,
        "since": _iso(since),
        "total_events": total_events,
        "top_actions": top_actions,
        "by_result": by_result,
        "critical": {
            "failed_logins": failed_logins,
            "nosql_blocks": nosql_blocks,
            "rate_limited": rate_limited,
            "account_deletions": account_deletions,
            "refresh_reuse_detected": refresh_reuse,
            "mp_webhook_signature_invalid": mp_signature_blocks,
        },
        "active_sessions": active_sessions,
    }
