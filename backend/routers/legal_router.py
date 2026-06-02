"""
legal_router.py — Infraestructura de cumplimiento legal.

Endpoints (montados bajo `/api/v1`):
  - GET  /api/v1/legal/versions          → versiones vigentes de T&C y Privacy.
  - POST /api/v1/user/legal-consent      → registra el consentimiento del usuario.
  - GET  /api/v1/user/legal-consent      → consulta el último consentimiento.

Colección MongoDB: `legal_consents`
  {
    user_id: str | null,       # `null` para usuarios anónimos pre-registro.
    role: str | null,          # 'player' | 'admin' | null
    tc_version: str,
    privacy_version: str,
    accepted_at: datetime,
    ip: str,
    user_agent: str,
  }

Política: tracking de TODOS los consentimientos históricos (no se sobreescriben);
el último prevalece. Esto cumple con auditorías GDPR Art. 7 (demostrabilidad).
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import BaseModel, Field

from core.db import db
from core.legal_versions import get_current_versions
from core.security import write_security_log

router = APIRouter(prefix="/v1", tags=["legal"])


class LegalConsentBody(BaseModel):
    user_id: Optional[str] = Field(
        default=None,
        description="Teléfono (player) o email (admin). Null si pre-registro.",
    )
    tc_version: str
    privacy_version: str
    accepted_at: Optional[datetime] = None  # cliente puede declarar timestamp; servidor valida


class LegalConsentResponse(BaseModel):
    ok: bool
    stored_at: datetime
    tc_version: str
    privacy_version: str


async def _ensure_indices() -> None:
    """Idempotente. user_id no-unique (un usuario puede tener historial)."""
    try:
        await db.legal_consents.create_index("user_id")
    except Exception:
        pass
    try:
        await db.legal_consents.create_index("accepted_at")
    except Exception:
        pass


@router.get("/legal/versions")
async def get_versions():
    """Público — ningún token requerido. Cacheable por el cliente."""
    return get_current_versions()


@router.post("/user/legal-consent", response_model=LegalConsentResponse)
async def post_consent(body: LegalConsentBody, request: Request):
    """
    Registra el consentimiento. Permite usuarios anónimos (pre-registro)
    si user_id es null — útil para capturar consentimiento en el flujo de
    signup ANTES de tener un id estable.
    """
    await _ensure_indices()

    versions = get_current_versions()
    # Defensa: nunca aceptar versiones futuras o desconocidas.
    if body.tc_version != versions["tc_version"]:
        raise HTTPException(
            status_code=400,
            detail=f"tc_version desactualizada. Esperada: {versions['tc_version']}",
        )
    if body.privacy_version != versions["privacy_version"]:
        raise HTTPException(
            status_code=400,
            detail=f"privacy_version desactualizada. Esperada: {versions['privacy_version']}",
        )

    now = datetime.now(timezone.utc)
    accepted_at = body.accepted_at or now
    # Si el cliente declara un timestamp futuro o muy viejo (>1 día), normalizamos.
    if accepted_at.tzinfo is None:
        accepted_at = accepted_at.replace(tzinfo=timezone.utc)
    if abs((now - accepted_at).total_seconds()) > 86_400:
        accepted_at = now

    role = None
    if body.user_id:
        if "@" in body.user_id:
            role = "admin"
        elif body.user_id.startswith("+"):
            role = "player"

    doc = {
        "user_id": body.user_id,
        "role": role,
        "tc_version": body.tc_version,
        "privacy_version": body.privacy_version,
        "accepted_at": accepted_at,
        "ip": request.client.host if request.client else None,
        "user_agent": (request.headers.get("user-agent") or "")[:300],
    }
    await db.legal_consents.insert_one(doc)

    await write_security_log(
        accion="legal_consent_accepted",
        request=request,
        id_usuario=body.user_id or "anonymous",
        result="ok",
        extra={
            "tc_version": body.tc_version,
            "privacy_version": body.privacy_version,
        },
    )

    return LegalConsentResponse(
        ok=True,
        stored_at=accepted_at,
        tc_version=body.tc_version,
        privacy_version=body.privacy_version,
    )


@router.get("/user/legal-consent")
async def get_consent(authorization: Optional[str] = Header(None)):
    """
    Devuelve el último consentimiento del usuario autenticado.
    Acepta tokens admin o player. Si no hay auth → 401.
    """
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "No autenticado")

    # Decodificamos manualmente para soportar ambos roles sin acoplar a un guard específico.
    from auth import JWT_ALG, JWT_SECRET
    try:
        import jwt as _jwt
        token = authorization.split(" ", 1)[1].strip()
        payload = _jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
    except Exception as e:  # noqa: BLE001
        raise HTTPException(401, f"Token inválido: {e}") from e

    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(401, "Token sin sub")

    latest = await db.legal_consents.find_one(
        {"user_id": user_id},
        sort=[("accepted_at", -1)],
        projection={"_id": 0},
    )
    versions = get_current_versions()
    if not latest:
        return {
            "has_consent": False,
            "current_versions": versions,
        }
    return {
        "has_consent": True,
        "accepted_tc_version": latest.get("tc_version"),
        "accepted_privacy_version": latest.get("privacy_version"),
        "accepted_at": (latest.get("accepted_at") or datetime.now(timezone.utc)).isoformat()
        if hasattr(latest.get("accepted_at"), "isoformat")
        else None,
        "current_versions": versions,
        "is_outdated": (
            latest.get("tc_version") != versions["tc_version"]
            or latest.get("privacy_version") != versions["privacy_version"]
        ),
    }
