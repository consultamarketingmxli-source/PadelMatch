"""Dashboard admin con métricas agregadas + reembolsos Stripe.

Métricas calculadas en tiempo real (sin job de agregación dado el volumen MVP).
Para producción a escala se recomendaría cachear con TTL o migrar a aggregation pipelines.
"""
import logging
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

import payments_stripe
from auth import get_current_admin
from core.db import db
from core.helpers import promover_lista_espera

logger = logging.getLogger("pixel-padel-os")
router = APIRouter(prefix="/admin", tags=["admin-dashboard"])


# ============== Schemas ==============
class RetaKPI(BaseModel):
    reta_id: str
    nombre: str
    club: str
    fecha_evento: str
    url_slug: str
    capacidad_pct: float
    semaforo: str
    inscritos: int
    max_jugadores: int
    waitlist: int
    ingresos_mxn: float
    refunds_mxn: float = 0.0


class MetricsResponse(BaseModel):
    ingresos_totales_mxn: float
    ingresos_pendientes_mxn: float
    refunds_totales_mxn: float
    pagos_aprobados: int
    pagos_pendientes: int
    pagos_fallidos: int
    conversion_pct: float  # paid / (paid + failed + canceled)
    retas_totales: int
    retas_futuras: int
    retas_llenas: int
    jugadores_unicos: int
    top_retas: List[RetaKPI] = Field(default_factory=list)
    proximas_retas: List[RetaKPI] = Field(default_factory=list)


class RefundResponse(BaseModel):
    ok: bool
    inscripcion_id: str
    refund_id: Optional[str] = None
    amount_refunded_mxn: float = 0.0
    promoted: bool = False


# ============== Helpers internos ==============
async def _ingresos_por_reta(reta_id: str) -> tuple[float, float]:
    """Retorna (ingresos_paid, refunds) en MXN para una reta."""
    cursor = db.stripe_transactions.find({"reta_id": reta_id}, {"_id": 0}).limit(2000)
    paid = 0.0
    refunded = 0.0
    async for tx in cursor:
        if tx.get("payment_status") == "paid":
            paid += float(tx.get("amount", 0))
        if tx.get("refunded_amount"):
            refunded += float(tx["refunded_amount"])
    return paid, refunded


async def _build_reta_kpi(r: dict) -> RetaKPI:
    aprobados = await db.inscripciones.count_documents({
        "reta_id": r["id"], "estatus_pago": "Aprobado",
    })
    waitlist = await db.lista_espera.count_documents({
        "reta_id": r["id"], "notificado": False,
    })
    paid, refunded = await _ingresos_por_reta(r["id"])
    capacidad_pct = (aprobados / r["max_jugadores"]) * 100 if r["max_jugadores"] else 0
    if aprobados >= r["max_jugadores"]:
        sem = "ROJO"
    elif capacidad_pct >= 50:
        sem = "AMARILLO"
    else:
        sem = "VERDE"

    return RetaKPI(
        reta_id=r["id"],
        nombre=r["nombre"],
        club=r["club"],
        fecha_evento=r["fecha_evento"],
        url_slug=r["url_slug"],
        capacidad_pct=round(capacidad_pct, 1),
        semaforo=sem,
        inscritos=aprobados,
        max_jugadores=r["max_jugadores"],
        waitlist=waitlist,
        ingresos_mxn=round(paid, 2),
        refunds_mxn=round(refunded, 2),
    )


# ============== Endpoints ==============
@router.get("/metrics", response_model=MetricsResponse)
async def get_metrics(current=Depends(get_current_admin)):
    """KPIs agregados de la plataforma. Recalcula en cada request (MVP)."""
    # Ingresos
    ingresos_paid = 0.0
    ingresos_refunded = 0.0
    pagos_paid = 0
    pagos_failed = 0
    cursor = db.stripe_transactions.find({}, {"_id": 0}).limit(5000)
    async for tx in cursor:
        ps = tx.get("payment_status")
        if ps == "paid":
            ingresos_paid += float(tx.get("amount", 0))
            pagos_paid += 1
        elif ps in ("failed", "expired"):
            pagos_failed += 1
        if tx.get("refunded_amount"):
            ingresos_refunded += float(tx["refunded_amount"])

    pendientes = await db.inscripciones.count_documents({"estatus_pago": "Pendiente"})
    pagos_aprobados_total = await db.inscripciones.count_documents({"estatus_pago": "Aprobado"})

    # Conversión
    total_intentos = pagos_paid + pagos_failed
    conversion = (pagos_paid / total_intentos * 100) if total_intentos else 0.0

    # Retas
    retas_totales = await db.retas.count_documents({})
    now_iso = datetime.now(timezone.utc).isoformat()
    retas_futuras = await db.retas.count_documents({"fecha_evento": {"$gte": now_iso}})

    # Jugadores únicos
    jugadores_unicos = await db.usuarios.count_documents({})

    # Retas con KPIs (top por ingresos + próximas por fecha)
    todas = db.retas.find({}, {"_id": 0}).sort("creado_en", -1).limit(200)
    kpis: List[RetaKPI] = []
    async for r in todas:
        k = await _build_reta_kpi(r)
        kpis.append(k)

    retas_llenas = sum(1 for k in kpis if k.semaforo == "ROJO")

    top_retas = sorted(kpis, key=lambda k: -k.ingresos_mxn)[:5]
    proximas_retas = sorted(
        [k for k in kpis if k.fecha_evento >= now_iso],
        key=lambda k: k.fecha_evento,
    )[:5]

    return MetricsResponse(
        ingresos_totales_mxn=round(ingresos_paid, 2),
        ingresos_pendientes_mxn=round(pendientes * 0, 2),  # placeholder
        refunds_totales_mxn=round(ingresos_refunded, 2),
        pagos_aprobados=pagos_paid or pagos_aprobados_total,
        pagos_pendientes=pendientes,
        pagos_fallidos=pagos_failed,
        conversion_pct=round(conversion, 1),
        retas_totales=retas_totales,
        retas_futuras=retas_futuras,
        retas_llenas=retas_llenas,
        jugadores_unicos=jugadores_unicos,
        top_retas=top_retas,
        proximas_retas=proximas_retas,
    )


# ============== Reembolsos ==============
@router.post(
    "/retas/{reta_id}/inscripciones/{inscripcion_id}/refund",
    response_model=RefundResponse,
)
async def refund_inscripcion(
    reta_id: str,
    inscripcion_id: str,
    current=Depends(get_current_admin),
):
    """Reembolsa una inscripción Aprobada vía Stripe, libera el cupo
    y promueve a la siguiente persona en lista de espera (idempotente)."""
    insc = await db.inscripciones.find_one(
        {"id": inscripcion_id, "reta_id": reta_id}, {"_id": 0},
    )
    if not insc:
        raise HTTPException(404, "Inscripción no encontrada")
    if insc["estatus_pago"] not in ("Aprobado",):
        raise HTTPException(
            400,
            f"Sólo se pueden reembolsar inscripciones Aprobadas (estatus actual: {insc['estatus_pago']}).",
        )

    session_id = insc.get("stripe_session_id")
    refund_id = None
    amount_refunded = 0.0

    if session_id and payments_stripe.is_stripe_configured():
        # Obtener payment_intent del session
        try:
            status = await payments_stripe.obtener_status_sesion(session_id)
            payment_intent_id = getattr(status, "payment_intent_id", None) or getattr(
                status, "payment_intent", None,
            )
        except Exception as e:
            logger.warning("No se pudo obtener payment_intent: %s", e)
            payment_intent_id = None

        if payment_intent_id:
            try:
                refund = await payments_stripe.refundar_pago(payment_intent_id)
                refund_id = refund.get("id")
                amount_refunded = float(refund.get("amount", 0)) / 100.0
            except Exception as e:
                logger.exception("Stripe refund falló: %s", e)
                raise HTTPException(502, f"Stripe rechazó el reembolso: {e}") from e
        else:
            logger.warning("Sin payment_intent_id; marcando como reembolsado localmente")

        # Actualizar tracking
        await db.stripe_transactions.update_one(
            {"session_id": session_id},
            {"$set": {
                "payment_status": "refunded",
                "refund_id": refund_id,
                "refunded_amount": amount_refunded,
                "refunded_at": datetime.now(timezone.utc).isoformat(),
            }},
        )

    # Liberar el cupo: borramos la inscripción y promovemos waitlist
    await db.inscripciones.delete_one({"id": inscripcion_id})
    nuevo = await promover_lista_espera(reta_id)
    promoted = nuevo is not None

    return RefundResponse(
        ok=True,
        inscripcion_id=inscripcion_id,
        refund_id=refund_id,
        amount_refunded_mxn=amount_refunded,
        promoted=promoted,
    )
