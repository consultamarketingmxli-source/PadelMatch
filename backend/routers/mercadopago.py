"""
Router Mercado Pago Marketplace.

Endpoints:
- POST /admin/mercadopago/connect       — admin pega su Access Token y lo guardamos
- POST /admin/mercadopago/disconnect    — limpia el token
- GET  /admin/mercadopago/status        — estado de la vinculación
- PATCH /admin/mercadopago/settings     — toggle apply_fee (futuro)
- POST /public/retas/{id}/checkout-mercadopago — crea preference y devuelve init_point
- POST /webhooks/mercadopago            — recibe notificaciones de MP
- GET  /public/inscripciones/{id}/mp-status — polling del pago

Reglas de negocio:
- Si un organizador (admin) NO tiene access_token_pasarela, NO se pueden vender
  inscripciones de sus retas (lockout 3a confirmado por el usuario).
- Por defecto: el 100% del pago va a la cuenta del organizador (sin marketplace_fee).
- El toggle `apply_fee` queda en BD para activar 10% de comisión a futuro sin redeploy.
"""
import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field

import mercadopago_service as mps
import mp_oauth_service as mp_oauth
from auth import get_current_admin
from core.circuit import with_timeout_and_retry
from core.crypto import decrypt_token, encrypt_token
from core.db import db, ADMIN_EMAIL_DEFAULT
from core.email_service import email_service
from core.helpers import (
    assert_reta_no_cerrada,
    crear_inscripcion_free_agent_pendiente,
    crear_inscripcion_pareja_pendiente,
    crear_inscripcion_pendiente,
    expirar_pendientes_vencidas,
    promover_lista_espera,
)
from core.concurrency import liberar_lugar
from core.validators import NombreStr, PhoneStr

logger = logging.getLogger("padelappretas-os")
router = APIRouter(tags=["mercadopago"])


# =====================================================================
# OAuth state helpers (CSRF + admin_email signing)
# =====================================================================
def _sign_oauth_state(admin_email: str) -> str:
    """Devuelve `<nonce>.<admin_email_b64>.<hmac>` para usarlo como `state` OAuth."""
    import base64
    import hashlib
    import hmac as _hmac
    import secrets as _secrets

    secret = (os.getenv("MP_OAUTH_STATE_SECRET") or os.getenv("SECRET_KEY") or "").encode("utf-8")
    if not secret:
        raise HTTPException(503, "MP_OAUTH_STATE_SECRET no configurado en backend.")
    nonce = _secrets.token_urlsafe(12)
    email_b64 = base64.urlsafe_b64encode(admin_email.encode("utf-8")).decode("utf-8").rstrip("=")
    base = f"{nonce}.{email_b64}"
    sig = _hmac.new(secret, base.encode("utf-8"), hashlib.sha256).hexdigest()[:32]
    return f"{base}.{sig}"


def _verify_oauth_state(state: str) -> str:
    """Valida el state firmado y devuelve el `admin_email` que lo originó."""
    import base64
    import hashlib
    import hmac as _hmac

    parts = (state or "").split(".")
    if len(parts) != 3:
        raise HTTPException(400, "state OAuth inválido.")
    nonce, email_b64, sig = parts
    secret = (os.getenv("MP_OAUTH_STATE_SECRET") or os.getenv("SECRET_KEY") or "").encode("utf-8")
    if not secret:
        raise HTTPException(503, "MP_OAUTH_STATE_SECRET no configurado en backend.")
    base = f"{nonce}.{email_b64}"
    expected = _hmac.new(secret, base.encode("utf-8"), hashlib.sha256).hexdigest()[:32]
    if not _hmac.compare_digest(expected, sig):
        raise HTTPException(400, "Firma de state OAuth no coincide (CSRF / tampering).")
    try:
        # padding-safe decode
        padded = email_b64 + "=" * (-len(email_b64) % 4)
        return base64.urlsafe_b64decode(padded.encode("utf-8")).decode("utf-8")
    except Exception:
        raise HTTPException(400, "state OAuth inválido (email decode).")



# ===================== Schemas =====================
class MpConnectRequest(BaseModel):
    access_token: str = Field(min_length=10, max_length=400)


class MpStatus(BaseModel):
    connected: bool
    mp_user_id: Optional[str] = None
    nickname: Optional[str] = None
    email: Optional[str] = None
    site_id: Optional[str] = None
    connected_at: Optional[str] = None
    apply_fee: bool = False
    fee_percent: float = 0.0
    # ===== Marketplace OAuth multi-cuenta (Sección 2 - expansión) =====
    # Modo de vinculación: 'oauth' si vino del flujo OAuth, 'manual' si pegado.
    connection_mode: Optional[str] = None
    # Indica si el access_token persistido está cifrado at-rest en MongoDB.
    encrypted_at_rest: bool = False
    # Indica si la key Fernet está configurada en el backend (independiente de si hay token).
    encryption_available: bool = False
    # Si el OAuth se hizo y devolvió expires_in, ISO timestamp absoluto del expiry.
    expires_at: Optional[str] = None
    # True si tenemos refresh_token guardado (token renovable sin re-OAuth).
    has_refresh_token: bool = False


class MpOAuthStartResponse(BaseModel):
    authorize_url: str
    state: str
    redirect_uri: str


class MpSettingsUpdate(BaseModel):
    apply_fee: bool


class MpCheckoutCreate(BaseModel):
    nombre: NombreStr
    telefono: PhoneStr
    success_url: Optional[str] = None
    cancel_url: Optional[str] = None
    payer_email: Optional[str] = Field(default=None, max_length=120)
    # Soporte parejas (Fase 2) — opcionales para retrocompat.
    pareja_nombre: Optional[NombreStr] = None
    pareja_telefono: Optional[PhoneStr] = None
    es_free_agent: bool = False


class MpCheckoutResponse(BaseModel):
    inscripcion_id: str
    preference_id: str
    init_point: str
    sandbox_init_point: Optional[str] = None
    monto_total: Optional[float] = None  # Total cobrado (x2 si es dúo)
    cupos_reservados: Optional[int] = None  # 1 o 2 según modalidad


class MpPaymentStatus(BaseModel):
    inscripcion_id: str
    estatus_pago: str
    mp_payment_id: Optional[str] = None
    mp_status: Optional[str] = None


# ===================== Helpers =====================
async def _admin_with_mp_for_reta(reta: dict) -> dict:
    """Recupera el documento de admin/organizador que cobra esta reta y
    que TIENE MP conectado. Si no, lanza 400 con mensaje claro."""
    _organizador_id = reta.get("organizador_id") or "admin"  # noqa: F841 — reservado para multi-organizador
    # En el modelo actual solo hay un admin; lo identificamos por email default.
    admin = await db.admins.find_one({"email": ADMIN_EMAIL_DEFAULT}, {"_id": 0})
    if not admin:
        raise HTTPException(503, "Organizador no configurado.")
    if not admin.get("access_token_pasarela"):
        raise HTTPException(
            400,
            "Esta reta no puede recibir pagos: el organizador aún no ha vinculado su cuenta de Mercado Pago.",
        )
    return admin


# ===================== Endpoints admin =====================
@router.post("/admin/mercadopago/connect", response_model=MpStatus)
async def mp_connect(body: MpConnectRequest, current=Depends(get_current_admin)):
    """Vincula la cuenta MP del organizador validando su Access Token (modo MANUAL).

    Para el flujo OAuth, usar `GET /admin/mercadopago/oauth/start`.
    """
    try:
        info = await mps.validar_access_token(body.access_token)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    except Exception as e:
        logger.exception("MP validate error")
        raise HTTPException(502, f"Mercado Pago no respondió: {e}") from e

    email = current.get("sub") or current.get("email")
    now_iso = datetime.now(timezone.utc).isoformat()
    # Encriptamos el token at-rest si MP_TOKEN_ENCRYPTION_KEY está configurada.
    encrypted_access = encrypt_token(body.access_token.strip())
    update = {
        "access_token_pasarela": encrypted_access,
        "mp_user_id": str(info.get("id")),
        "mp_nickname": info.get("nickname"),
        "mp_email": info.get("email"),
        "mp_site_id": info.get("site_id"),
        "mp_connected_at": now_iso,
        "mp_connection_mode": "manual",
        "mp_refresh_token": None,  # manual paste no provee refresh
        "mp_expires_at": None,
    }
    # apply_fee se setea por defecto False solo en el connect inicial
    existing = await db.admins.find_one({"email": email}, {"mp_apply_fee": 1})
    if not existing or "mp_apply_fee" not in existing:
        update["mp_apply_fee"] = False

    await db.admins.update_one({"email": email}, {"$set": update})
    return await mp_status(current)


@router.post("/admin/mercadopago/disconnect")
async def mp_disconnect(current=Depends(get_current_admin)):
    """Desvincula la cuenta MP (borra el token y campos asociados)."""
    email = current.get("sub") or current.get("email")
    await db.admins.update_one(
        {"email": email},
        {"$unset": {
            "access_token_pasarela": "",
            "mp_user_id": "",
            "mp_nickname": "",
            "mp_email": "",
            "mp_site_id": "",
            "mp_connected_at": "",
            "mp_connection_mode": "",
            "mp_refresh_token": "",
            "mp_expires_at": "",
        }},
    )
    return {"ok": True}


@router.get("/admin/mercadopago/status", response_model=MpStatus)
async def mp_status(current=Depends(get_current_admin)):
    email = current.get("sub") or current.get("email")
    admin = await db.admins.find_one({"email": email}, {"_id": 0}) or {}
    token_stored = admin.get("access_token_pasarela") or ""
    connected = bool(token_stored)
    encrypted = isinstance(token_stored, str) and token_stored.startswith("enc::")
    encryption_available = bool((os.getenv("MP_TOKEN_ENCRYPTION_KEY") or "").strip())
    return MpStatus(
        connected=connected,
        mp_user_id=admin.get("mp_user_id"),
        nickname=admin.get("mp_nickname"),
        email=admin.get("mp_email"),
        site_id=admin.get("mp_site_id"),
        connected_at=admin.get("mp_connected_at"),
        apply_fee=bool(admin.get("mp_apply_fee", False)),
        fee_percent=mp_oauth.marketplace_fee_percent(),
        connection_mode=admin.get("mp_connection_mode") or ("manual" if connected else None),
        encrypted_at_rest=encrypted,
        encryption_available=encryption_available,
        expires_at=admin.get("mp_expires_at"),
        has_refresh_token=bool(admin.get("mp_refresh_token")),
    )


@router.patch("/admin/mercadopago/settings", response_model=MpStatus)
async def mp_update_settings(body: MpSettingsUpdate, current=Depends(get_current_admin)):
    email = current.get("sub") or current.get("email")
    await db.admins.update_one(
        {"email": email},
        {"$set": {"mp_apply_fee": bool(body.apply_fee)}},
    )
    return await mp_status(current)  # reuse


# ===================== OAuth Marketplace endpoints =====================
@router.get("/admin/mercadopago/oauth/start", response_model=MpOAuthStartResponse)
async def mp_oauth_start(current=Depends(get_current_admin), redirect_uri: Optional[str] = None):
    """Devuelve la URL `authorize_url` para iniciar el flujo OAuth.

    El cliente (admin app) la abre en WebBrowser / window.open. Luego MP redirige
    a nuestro `/admin/mercadopago/oauth/callback?code=...&state=...`.

    Args:
        redirect_uri (query opcional): la app puede pedir un redirect distinto al
            default (útil para preview vs prod). Si se omite se usa APP_PUBLIC_URL.
    """
    email = current.get("sub") or current.get("email")
    if not email:
        raise HTTPException(400, "No se pudo identificar al admin solicitante.")
    redir = (redirect_uri or mp_oauth.default_redirect_uri() or "").strip()
    if not redir:
        raise HTTPException(503, "APP_PUBLIC_URL no configurado; no se puede armar redirect_uri.")
    state = _sign_oauth_state(email)
    try:
        url = mp_oauth.build_authorize_url(state=state, redirect_uri=redir)
    except RuntimeError as e:
        raise HTTPException(503, str(e)) from e
    return MpOAuthStartResponse(authorize_url=url, state=state, redirect_uri=redir)


@router.get("/admin/mercadopago/oauth/callback")
async def mp_oauth_callback(
    request: Request,
    code: Optional[str] = None,
    state: Optional[str] = None,
    error: Optional[str] = None,
    error_description: Optional[str] = None,
):
    """Callback público (sin auth) al que MP redirige tras autorizar.

    Validamos `state` con HMAC; canjeamos `code` por tokens; guardamos cifrado;
    redirigimos al frontend con `?mp_oauth=ok` o `?mp_oauth=error&reason=...`.
    """
    public_base = (os.getenv("APP_PUBLIC_URL") or "").rstrip("/")
    frontend_url = f"{public_base}/admin/mercadopago" if public_base else "/admin/mercadopago"

    if error:
        msg = (error_description or error)[:160]
        return RedirectResponse(
            url=f"{frontend_url}?mp_oauth=error&reason={msg}",
            status_code=302,
        )
    if not code or not state:
        return RedirectResponse(
            url=f"{frontend_url}?mp_oauth=error&reason=missing_code",
            status_code=302,
        )

    try:
        admin_email = _verify_oauth_state(state)
    except HTTPException:
        return RedirectResponse(
            url=f"{frontend_url}?mp_oauth=error&reason=state_invalid",
            status_code=302,
        )

    redir = mp_oauth.default_redirect_uri()
    if not redir:
        return RedirectResponse(
            url=f"{frontend_url}?mp_oauth=error&reason=app_public_url_missing",
            status_code=302,
        )

    try:
        tokens = await mp_oauth.exchange_code_for_tokens(code=code, redirect_uri=redir)
    except ValueError as e:
        logger.warning("MP OAuth exchange rejected: %s", e)
        return RedirectResponse(
            url=f"{frontend_url}?mp_oauth=error&reason=exchange_rejected",
            status_code=302,
        )
    except Exception:
        logger.exception("MP OAuth exchange failed")
        return RedirectResponse(
            url=f"{frontend_url}?mp_oauth=error&reason=exchange_failed",
            status_code=302,
        )

    # Persistimos con encriptación at-rest.
    now = datetime.now(timezone.utc)
    expires_in = int(tokens.get("expires_in") or 0)
    expires_at_iso = (
        (now + timedelta(seconds=expires_in)).isoformat()
        if expires_in > 0
        else None
    )
    # Validamos el token recién recibido para traer nickname/email/site_id.
    try:
        info = await mps.validar_access_token(tokens["access_token"])
    except Exception:
        info = {}

    update = {
        "access_token_pasarela": encrypt_token(tokens["access_token"]),
        "mp_refresh_token": encrypt_token(tokens.get("refresh_token") or ""),
        "mp_user_id": str(tokens.get("user_id") or info.get("id") or ""),
        "mp_nickname": info.get("nickname"),
        "mp_email": info.get("email"),
        "mp_site_id": info.get("site_id"),
        "mp_connected_at": now.isoformat(),
        "mp_expires_at": expires_at_iso,
        "mp_connection_mode": "oauth",
    }
    existing = await db.admins.find_one({"email": admin_email}, {"mp_apply_fee": 1})
    if not existing or "mp_apply_fee" not in existing:
        update["mp_apply_fee"] = False

    await db.admins.update_one({"email": admin_email}, {"$set": update}, upsert=False)
    logger.info("MP OAuth completed for admin=%s user_id=%s", admin_email, update["mp_user_id"])
    return RedirectResponse(url=f"{frontend_url}?mp_oauth=ok", status_code=302)


# ===================== Checkout público =====================
@router.post(
    "/public/retas/{reta_id}/checkout-mercadopago",
    response_model=MpCheckoutResponse,
)
async def checkout_mercadopago(reta_id: str, body: MpCheckoutCreate, request: Request):
    """Crea inscripción Pendiente + Preference MP del organizador.
    El dinero va 100% a la cuenta MP del organizador (no marketplace_fee por defecto).
    """
    reta = await db.retas.find_one({"id": reta_id}, {"_id": 0})
    if not reta:
        raise HTTPException(404, "Reta no encontrada")
    # Fase C — bloqueo de rondas pasadas
    assert_reta_no_cerrada(reta, accion="pagar inscripción a")
    if float(reta.get("costo_inscripcion", 0)) < 10:
        raise HTTPException(400, "El costo de inscripción debe ser de al menos $10 MXN.")

    # ===== Fase 5 (Sección 2) — Anti-Oversell early peek =====
    # Liberamos pendientes vencidas y comparamos contra max_jugadores ANTES de
    # exigir MP-vinculado. Así, si la reta está visiblemente llena el cliente
    # recibe 409 (→ Waitlist modal) en lugar de un 400 confuso cuando además
    # el organizador no tiene MP conectado.
    await expirar_pendientes_vencidas(reta_id)
    lock_actual = int(reta.get("inscritos_lock") or 0)
    cupos_solicitados = (
        2 if (reta.get("modalidad_registro", "individual") != "individual"
              and body.pareja_nombre and body.pareja_telefono)
        else 1
    )
    if lock_actual + cupos_solicitados > int(reta.get("max_jugadores", 0)):
        raise HTTPException(
            409,
            "Reta llena. Únete a la lista de espera.",
        )

    admin = await _admin_with_mp_for_reta(reta)
    # Decrypt token at-rest. Si está en claro (manual legacy) pasa tal cual.
    access_token = decrypt_token(admin["access_token_pasarela"]) or ""
    if not access_token:
        raise HTTPException(503, "Token MP corrupto/no descifrable. Reconecta MP.")
    apply_fee = bool(admin.get("mp_apply_fee", False))
    admin_email_for_meta = admin.get("email") or ADMIN_EMAIL_DEFAULT

    # ===== Detección de modalidad (Fase 2 — soporte parejas) =====
    es_parejas = reta.get("modalidad_registro", "individual") != "individual"
    permite_indiv = bool(reta.get("permitir_individual_en_parejas", False))
    costo_unitario = float(reta["costo_inscripcion"])

    # Branch en 3 vías: dúo / free-agent / individual.
    if not es_parejas:
        if body.pareja_nombre or body.es_free_agent:
            raise HTTPException(
                400, "Esta reta es individual; no admite pareja ni free-agent.",
            )
        insc = await crear_inscripcion_pendiente(
            reta, body.nombre, body.telefono, minutos_bloqueo=15,
        )
        cupos_reservados = 1
        costo_total = costo_unitario
        partner_insc_id = None
    elif body.pareja_nombre and body.pareja_telefono:
        insc, insc_b = await crear_inscripcion_pareja_pendiente(
            reta, body.nombre, body.telefono,
            body.pareja_nombre, body.pareja_telefono,
            minutos_bloqueo=15,
        )
        cupos_reservados = 2
        costo_total = costo_unitario * 2
        partner_insc_id = insc_b.id
    elif body.es_free_agent and permite_indiv:
        insc = await crear_inscripcion_free_agent_pendiente(
            reta, body.nombre, body.telefono, minutos_bloqueo=15,
        )
        cupos_reservados = 1
        costo_total = costo_unitario
        partner_insc_id = None
    else:
        raise HTTPException(
            400,
            "Reta de parejas: debes inscribir a tu pareja o marcar "
            "'inscribirme solo' (si el organizador lo permite).",
        )

    # MP rechaza localhost en back_urls. Usamos APP_PUBLIC_URL si está definido.
    public_base = os.getenv("APP_PUBLIC_URL", "").rstrip("/")
    base = public_base or str(request.base_url).rstrip("/")
    success = body.success_url or (
        f"{base}/retas/{reta['url_slug']}?pago=ok&inscripcion={insc.id}&provider=mp"
    )
    cancel = body.cancel_url or (
        f"{base}/retas/{reta['url_slug']}?pago=cancelado&inscripcion={insc.id}&provider=mp"
    )
    notification = f"{base}/api/webhooks/mercadopago"

    try:
        pref = await with_timeout_and_retry(
            lambda: mps.crear_preferencia(
                access_token=access_token,
                nombre_reta=reta["nombre"],
                costo_mxn=costo_total,
                success_url=success,
                cancel_url=cancel,
                notification_url=notification,
                external_reference=insc.id,
                payer_email=body.payer_email,
                apply_fee=apply_fee,
                # ===== Marketplace multi-organizer routing (webhook) =====
                metadata={
                    "admin_email": admin_email_for_meta,
                    "reta_id": reta_id,
                    "inscripcion_id": insc.id,
                    "mp_user_id": admin.get("mp_user_id") or "",
                    "platform": "padelappretas",
                },
            ),
            label=f"mp:create_pref:{reta['id']}",
            timeout_s=8.0,
            retries=1,
        )
    except Exception as e:
        logger.exception("MP preference error tras reintentos")
        # Rollback pareja-aware: borra inscripción(es) y libera cupo(s) atómicos.
        if cupos_reservados == 2 and insc.pareja_grupo_id:
            await db.inscripciones.delete_many({"pareja_grupo_id": insc.pareja_grupo_id})
        else:
            await db.inscripciones.delete_one({"id": insc.id})
        await liberar_lugar(reta_id, cupos_reservados)
        raise HTTPException(
            502,
            "Estamos experimentando intermitencias con Mercado Pago. Tu lugar fue liberado, "
            "intenta de nuevo en unos segundos.",
        ) from e

    # Persistimos tracking server-side (incluye partner_insc_id para dúo)
    tx_doc = {
        "id": insc.id,  # reusamos id de inscripción como tracking principal
        "inscripcion_id": insc.id,
        "partner_inscripcion_id": partner_insc_id,
        "pareja_grupo_id": insc.pareja_grupo_id,
        "cupos_reservados": cupos_reservados,
        "reta_id": reta_id,
        "jugador_id": insc.jugador_id,
        "telefono": insc.telefono,
        "payer_email": (body.payer_email or "").strip() or None,
        "amount": costo_total,
        "currency": "MXN",
        "preference_id": pref["id"],
        "init_point": pref["init_point"],
        "sandbox_init_point": pref.get("sandbox_init_point"),
        "organizador_mp_user_id": admin.get("mp_user_id"),
        "apply_fee": apply_fee,
        "payment_status": "initiated",
        "creado_en": datetime.now(timezone.utc).isoformat(),
    }
    await db.mp_transactions.insert_one(tx_doc)

    # Asociamos preference_id a TODAS las inscripciones del grupo (1 o 2).
    ids_a_actualizar = [insc.id]
    if partner_insc_id:
        ids_a_actualizar.append(partner_insc_id)
    await db.inscripciones.update_many(
        {"id": {"$in": ids_a_actualizar}},
        {"$set": {"mp_preference_id": pref["id"]}},
    )

    # En sandbox el init_point real funciona igual; preferimos siempre init_point.
    return MpCheckoutResponse(
        inscripcion_id=insc.id,
        preference_id=pref["id"],
        init_point=pref["init_point"],
        sandbox_init_point=pref.get("sandbox_init_point"),
        monto_total=float(costo_total),
        cupos_reservados=int(cupos_reservados),
    )


# ===================== Webhook =====================
async def _aplicar_resultado_pago(inscripcion_id: str, mp_payment_id: str, mp_status: str) -> dict:
    """Idempotente y pareja-aware: actualiza inscripción(es) + tracking según pago.

    Si la inscripción pertenece a un grupo de pareja, se confirman/cancelan
    AMBAS al unísono, liberando 2 cupos en caso de rechazo.
    """
    tx = await db.mp_transactions.find_one({"inscripcion_id": inscripcion_id}, {"_id": 0})
    if not tx:
        return {"matched": False}

    if tx.get("payment_status") in ("approved", "rejected", "cancelled"):
        return {"matched": True, "already": True, "payment_status": tx["payment_status"]}

    insc = await db.inscripciones.find_one({"id": inscripcion_id}, {"_id": 0})
    cupos = int(tx.get("cupos_reservados") or 1)
    grupo_id = (insc or {}).get("pareja_grupo_id") or tx.get("pareja_grupo_id")
    if grupo_id:
        ids = [
            d["id"] async for d in db.inscripciones.find(
                {"pareja_grupo_id": grupo_id}, {"id": 1, "_id": 0},
            )
        ]
    else:
        ids = [inscripcion_id]

    if mp_status == "approved":
        if ids:
            await db.inscripciones.update_many(
                {"id": {"$in": ids}, "estatus_pago": "Pendiente"},
                {"$set": {"estatus_pago": "Aprobado", "bloqueado_hasta": None}},
            )
        await db.mp_transactions.update_one(
            {"inscripcion_id": inscripcion_id},
            {"$set": {
                "payment_status": "approved",
                "mp_payment_id": mp_payment_id,
                "aprobado_en": datetime.now(timezone.utc).isoformat(),
            }},
        )
        # Confirmación por email (fire-and-forget, jamás rompe el webhook).
        try:
            reta = await db.retas.find_one({"id": tx["reta_id"]}, {"_id": 0})
            if reta and insc:
                await email_service.send_inscripcion_confirmada(
                    to=tx.get("payer_email"),
                    jugador=insc["nombre"],
                    reta_nombre=reta["nombre"],
                    club=reta.get("club", ""),
                    fecha_evento=str(reta.get("fecha_evento", "")),
                    inscripcion_id=inscripcion_id,
                    reta_slug=reta.get("url_slug", ""),
                )
        except Exception:
            logger.exception("email confirmación falló (no bloquea pago)")
        return {"matched": True, "estatus_pago": "Aprobado", "afectadas": len(ids)}

    if mp_status in ("rejected", "cancelled", "refunded", "charged_back"):
        if insc and insc["estatus_pago"] == "Pendiente":
            await db.inscripciones.delete_many({"id": {"$in": ids}})
            # Liberar TODOS los cupos atómicos ANTES de promover waitlist.
            await liberar_lugar(tx["reta_id"], cupos)
            await promover_lista_espera(tx["reta_id"])
        await db.mp_transactions.update_one(
            {"inscripcion_id": inscripcion_id},
            {"$set": {"payment_status": mp_status, "mp_payment_id": mp_payment_id}},
        )
        return {"matched": True, "estatus_pago": mp_status, "afectadas": len(ids)}

    # pending / in_process / authorized — no cerramos aún
    await db.mp_transactions.update_one(
        {"inscripcion_id": inscripcion_id},
        {"$set": {"mp_payment_id": mp_payment_id, "last_mp_status": mp_status}},
    )
    return {"matched": True, "estatus_pago": mp_status, "pending": True}


@router.post("/webhooks/mercadopago")
async def webhook_mercadopago(request: Request):
    """Recibe notificaciones de MP. Idempotente.
    Estructuras soportadas:
      - { type: 'payment', data: { id: '...' } }
      - query params ?type=payment&data.id=...  (IPN legacy)
      - { topic: 'merchant_order', resource: 'https://.../merchant_orders/XXX' }

    Verificación de firma HMAC-SHA256 (Ola D — DevSecOps):
      Si MP_WEBHOOK_SECRET está configurado, validamos x-signature según
      docs MP: manifest = "id:{data.id};request-id:{x-request-id};ts:{ts};"
      sha256_hmac(secret, manifest) === v1
    """
    body_bytes = await request.body()

    # --- Verificación de firma HMAC (cuando hay secret en .env) ---
    mp_secret = os.getenv("MP_WEBHOOK_SECRET", "").strip()
    if mp_secret:
        import hashlib
        import hmac as _hmac

        from core.security import write_security_log

        x_signature = request.headers.get("x-signature", "")
        x_request_id = request.headers.get("x-request-id", "")
        # x-signature viene como "ts=1704467022,v1=abcdef..."
        parts = dict(
            kv.split("=", 1) for kv in x_signature.split(",") if "=" in kv
        )
        ts = parts.get("ts", "").strip()
        v1 = parts.get("v1", "").strip()
        # data.id puede estar en query (IPN) o en body JSON.
        qp_for_sig = dict(request.query_params)
        try:
            preview = await request.json() if body_bytes else {}
        except Exception:
            preview = {}
        data_id = (
            qp_for_sig.get("data.id")
            or qp_for_sig.get("id")
            or (preview.get("data") or {}).get("id")
            or preview.get("id")
            or ""
        )
        manifest = f"id:{data_id};request-id:{x_request_id};ts:{ts};"
        expected = _hmac.new(
            mp_secret.encode("utf-8"),
            manifest.encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()
        if not (v1 and _hmac.compare_digest(expected, v1)):
            await write_security_log(
                accion="mp_webhook_signature_invalid",
                request=request,
                result="denied",
                extra={"data_id": str(data_id)[:32]},
            )
            raise HTTPException(401, "Firma de webhook inválida.")

    try:
        payload = await request.json() if body_bytes else {}
    except Exception:
        payload = {}

    qp = dict(request.query_params)
    event_type = (
        payload.get("type")
        or payload.get("topic")
        or qp.get("type")
        or qp.get("topic")
        or ""
    ).lower()

    # event id para idempotencia
    event_id = payload.get("id") or qp.get("id") or f"{event_type}-{datetime.now(timezone.utc).timestamp()}"
    seen = await db.mp_events.find_one({"event_id": str(event_id)})
    if seen and event_id and "-" not in str(event_id):
        return {"ok": True, "duplicate": True}
    await db.mp_events.insert_one({
        "event_id": str(event_id),
        "type": event_type,
        "payload": payload,
        "query": qp,
        "creado_en": datetime.now(timezone.utc).isoformat(),
    })

    # Necesitamos el access_token del organizador. Multi-marketplace expansion:
    # 1) Si el payment trae `metadata.admin_email`, lo usamos (multi-org).
    # 2) Fallback al admin único legacy (ADMIN_EMAIL_DEFAULT).
    # Como aún no conocemos el payment hasta consultarlo, intentamos por defecto y
    # luego re-resolvemos por metadata cuando obtengamos el payment.
    admin = await db.admins.find_one({"email": ADMIN_EMAIL_DEFAULT}, {"_id": 0})
    if not admin or not admin.get("access_token_pasarela"):
        # Sin admin default — intentamos con CUALQUIER admin que tenga MP conectado,
        # solo para poder consultar el payment y leer metadata.admin_email.
        admin = await db.admins.find_one(
            {"access_token_pasarela": {"$exists": True, "$ne": ""}},
            {"_id": 0},
        )
    if not admin or not admin.get("access_token_pasarela"):
        logger.warning("Webhook MP recibido pero no hay organizador conectado.")
        return {"ok": True, "ignored": True}
    access_token = decrypt_token(admin["access_token_pasarela"]) or ""

    # 1) Payment notifications
    if event_type == "payment":
        payment_id = (
            (payload.get("data") or {}).get("id")
            or qp.get("data.id")
            or qp.get("id")
        )
        if not payment_id:
            return {"ok": True, "ignored": True}
        try:
            payment = await mps.obtener_pago(access_token, str(payment_id))
        except Exception as e:
            logger.exception("MP payment fetch failed: %s", e)
            return {"ok": True, "error": str(e)}
        # Multi-organizer re-routing: si el payment trae metadata.admin_email
        # y NO coincide con el admin que usamos, recargamos con ese token.
        meta = (payment.get("metadata") or {}) if isinstance(payment, dict) else {}
        admin_email_meta = (meta.get("admin_email") or "").strip()
        if admin_email_meta and admin_email_meta != admin.get("email"):
            alt = await db.admins.find_one(
                {"email": admin_email_meta},
                {"_id": 0},
            )
            if alt and alt.get("access_token_pasarela"):
                alt_token = decrypt_token(alt["access_token_pasarela"]) or ""
                if alt_token and alt_token != access_token:
                    try:
                        payment = await mps.obtener_pago(alt_token, str(payment_id))
                    except Exception:
                        # mantenemos el payment original si re-fetch falla
                        pass
        ext_ref = payment.get("external_reference")
        status = payment.get("status")
        if ext_ref and status:
            result = await _aplicar_resultado_pago(ext_ref, str(payment_id), status)
            return {"ok": True, "event": "payment", "admin": admin_email_meta or admin.get("email"), **result}
        return {"ok": True, "ignored": True}

    # 2) merchant_order: contiene lista de pagos. Tomamos el último aprobado.
    if event_type == "merchant_order":
        order_id = (payload.get("data") or {}).get("id") or qp.get("id") or qp.get("data.id")
        resource = payload.get("resource") or ""
        if not order_id and resource:
            order_id = resource.rstrip("/").split("/")[-1]
        if not order_id:
            return {"ok": True, "ignored": True}
        try:
            mo = await mps.obtener_merchant_order(access_token, str(order_id))
        except Exception as e:
            logger.exception("MP merchant_order fetch failed")
            return {"ok": True, "error": str(e)}
        ext_ref = mo.get("external_reference")
        if not ext_ref:
            return {"ok": True, "ignored": True}
        # Buscamos el pago más relevante
        best_status = None
        best_payment_id = None
        for p in mo.get("payments", []) or []:
            s = p.get("status")
            if s == "approved":
                best_status, best_payment_id = s, str(p.get("id"))
                break
            if s in ("rejected", "cancelled") and not best_status:
                best_status, best_payment_id = s, str(p.get("id"))
        if best_status and best_payment_id:
            result = await _aplicar_resultado_pago(ext_ref, best_payment_id, best_status)
            return {"ok": True, "event": "merchant_order", **result}
        return {"ok": True, "ignored": True}

    return {"ok": True, "ignored": True, "type": event_type}


# ===================== Polling status =====================
@router.get(
    "/public/inscripciones/{inscripcion_id}/mp-status",
    response_model=MpPaymentStatus,
)
async def mp_payment_status(inscripcion_id: str):
    insc = await db.inscripciones.find_one({"id": inscripcion_id}, {"_id": 0})
    tx = await db.mp_transactions.find_one({"inscripcion_id": inscripcion_id}, {"_id": 0})

    if not insc and not tx:
        raise HTTPException(404, "Inscripción no encontrada")

    # Proactivo: si todavía está Pendiente y tenemos preference_id, intentamos buscar pagos.
    if insc and insc["estatus_pago"] == "Pendiente" and tx and tx.get("preference_id"):
        admin = await db.admins.find_one({"email": ADMIN_EMAIL_DEFAULT}, {"_id": 0})
        access_token = admin.get("access_token_pasarela") if admin else None
        if access_token:
            try:
                import httpx
                async with httpx.AsyncClient(timeout=8.0) as client:
                    resp = await client.get(
                        f"{mps.MP_API_BASE}/v1/payments/search",
                        params={"external_reference": inscripcion_id},
                        headers={"Authorization": f"Bearer {access_token}"},
                    )
                if resp.status_code == 200:
                    results = resp.json().get("results", []) or []
                    # Priorizamos approved
                    chosen = None
                    for p in results:
                        if p.get("status") == "approved":
                            chosen = p
                            break
                    if not chosen and results:
                        chosen = results[0]
                    if chosen:
                        await _aplicar_resultado_pago(
                            inscripcion_id, str(chosen.get("id")), chosen.get("status"),
                        )
                        insc = await db.inscripciones.find_one({"id": inscripcion_id}, {"_id": 0}) or insc
                        tx = await db.mp_transactions.find_one({"inscripcion_id": inscripcion_id}, {"_id": 0}) or tx
            except Exception as e:
                logger.warning("MP poll search error: %s", e)

    return MpPaymentStatus(
        inscripcion_id=inscripcion_id,
        estatus_pago=(insc or {}).get("estatus_pago", "Cancelado"),
        mp_payment_id=(tx or {}).get("mp_payment_id"),
        mp_status=(tx or {}).get("payment_status") or (tx or {}).get("last_mp_status"),
    )
