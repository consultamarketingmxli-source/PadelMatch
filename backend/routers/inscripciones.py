"""Inscripciones via mock checkout legacy + lista de espera + webhook mock.

Mantiene compatibilidad hacia atrás con el endpoint /webhooks/payment mock.
El flujo real con Stripe está en payments_router.py.

Blindaje QA (race conditions):
- /public/retas/{id}/checkout usa `crear_inscripcion_pendiente` con reserva atómica.
- /public/retas/{id}/waitlist usa `siguiente_posicion_waitlist_atomica` para
  evitar posiciones duplicadas.
- /webhooks/payment libera el cupo atómico al borrar la inscripción.
"""
import logging

from fastapi import APIRouter, HTTPException

from core.db import db
from core.concurrency import (
    liberar_lugar,
    siguiente_posicion_waitlist_atomica,
)
from core.helpers import (
    MIN_SAMPLE_FOR_ANTIFLAKE,
    assert_player_passes_antiflake,
    assert_reta_no_cerrada,
    crear_inscripcion_free_agent_pendiente,
    crear_inscripcion_pareja_pendiente,
    crear_inscripcion_pendiente,
    player_attendance_rate,
    promover_lista_espera,
)
from models import (
    Inscripcion,
    InscripcionCreate,
    PaymentWebhook,
    Usuario,
    WaitlistCreate,
    WaitlistEntry,
)

logger = logging.getLogger("padelappretas-os")
router = APIRouter(tags=["inscripciones"])


def _es_reta_de_parejas(reta: dict) -> bool:
    return reta.get("modalidad_registro", "individual") != "individual"


@router.post("/public/retas/{reta_id}/checkout", response_model=Inscripcion)
async def checkout_mock(reta_id: str, body: InscripcionCreate):
    """Bloquea el lugar por 5 minutos mientras se procesa el pago (mock legacy).

    Adaptado a Fase 2 (soporte parejas):
      • Reta individual → flujo clásico (1 inscripción, 1 cupo).
      • Reta parejas + body.pareja_nombre/telefono → 2 inscripciones ligadas
        con `pareja_grupo_id`, 2 cupos, retorna la inscripción del jugador
        principal (la del compañero queda en la misma transacción).
      • Reta parejas + body.es_free_agent + permitir_individual_en_parejas →
        1 inscripción marcada como free-agent.

    Race condition protegida via reservas atómicas.
    """
    if body.reta_id != reta_id:
        raise HTTPException(400, "reta_id mismatch")

    reta = await db.retas.find_one({"id": reta_id}, {"_id": 0})
    if not reta:
        raise HTTPException(404, "Reta no encontrada")
    # Fase C — bloqueo de rondas pasadas (prevención: nadie paga por reta cerrada)
    assert_reta_no_cerrada(reta, accion="inscribirte a")

    # ===== Iter50 — Bypass de anti-flake si pago en efectivo =====
    # Si el body indica método de pago manual (efectivo_cancha o transferencia),
    # exigimos que la reta lo permita Y omitimos el filtro antiflake (el
    # organizador decide humanamente si acepta este jugador).
    metodo_pago_req = getattr(body, "metodo_pago", None) or "online"
    if metodo_pago_req in ("efectivo_cancha", "transferencia_manual"):
        if not bool(reta.get("permitir_pago_cancha", False)):
            raise HTTPException(
                400,
                "Esta reta no permite pago en cancha. Usa el flujo de pago en línea.",
            )
    else:
        # Anti-Flake (Pro) — gate por asistencia histórica del jugador principal.
        await assert_player_passes_antiflake(reta, body.telefono, body.nombre)
        # Si la reta es de parejas y el body incluye datos del compañero,
        # también validamos al compañero antes de tocar cupos.
        if body.pareja_telefono:
            await assert_player_passes_antiflake(reta, body.pareja_telefono, body.pareja_nombre)

    es_parejas = _es_reta_de_parejas(reta)
    permite_indiv = bool(reta.get("permitir_individual_en_parejas", False))

    # --- Reta INDIVIDUAL: rechazar datos de pareja ---
    if not es_parejas:
        if body.pareja_nombre or body.es_free_agent:
            raise HTTPException(
                400,
                "Esta reta es individual; no admite inscripción con pareja ni free-agent.",
            )
        return await crear_inscripcion_pendiente(
            reta, body.nombre, body.telefono, minutos_bloqueo=5,
        )

    # --- Reta de PAREJAS ---
    # 1) Inscripción con pareja explícita.
    if body.pareja_nombre and body.pareja_telefono:
        insc_a, _insc_b = await crear_inscripcion_pareja_pendiente(
            reta,
            body.nombre, body.telefono,
            body.pareja_nombre, body.pareja_telefono,
            minutos_bloqueo=5,
        )
        return insc_a

    # 2) Free-agent (solo si el organizador lo habilitó).
    if body.es_free_agent:
        if not permite_indiv:
            raise HTTPException(
                400,
                "Esta reta requiere inscripción en pareja; el organizador no habilitó "
                "la inscripción individual.",
            )
        return await crear_inscripcion_free_agent_pendiente(
            reta, body.nombre, body.telefono, minutos_bloqueo=5,
        )

    # 3) Faltan datos.
    raise HTTPException(
        400,
        "Esta reta es de parejas. Debes inscribir a tu pareja o marcar "
        "'inscribirme solo' (si el organizador lo permite).",
    )


@router.post("/webhooks/payment")
async def webhook_payment_mock(body: PaymentWebhook):
    """Endpoint mock para confirmar/cancelar pagos (compat con tests legacy).
    Idempotente y pareja-aware.

    Si la inscripción pertenece a una pareja (tiene `pareja_grupo_id`), la
    operación se aplica a AMBAS inscripciones simultáneamente.
    """
    insc = await db.inscripciones.find_one({"id": body.inscripcion_id})
    if not insc:
        return {"ok": True, "status": "already_processed"}

    # Resolver el conjunto de inscripciones afectadas (1 individual, o 2 para pareja).
    grupo_id = insc.get("pareja_grupo_id")
    if grupo_id:
        ids = [
            d["id"] async for d in db.inscripciones.find(
                {"pareja_grupo_id": grupo_id}, {"id": 1, "_id": 0},
            )
        ]
    else:
        ids = [body.inscripcion_id]

    if body.status == "approved":
        await db.inscripciones.update_many(
            {"id": {"$in": ids}},
            {"$set": {"estatus_pago": "Aprobado", "bloqueado_hasta": None}},
        )
        return {"ok": True, "status": "Aprobado", "afectadas": len(ids)}
    else:
        await db.inscripciones.delete_many({"id": {"$in": ids}})
        await liberar_lugar(insc["reta_id"], len(ids))
        # Solo promovemos waitlist 1 vez (la próxima persona).
        await promover_lista_espera(insc["reta_id"])
        return {"ok": True, "status": "Cancelado", "afectadas": len(ids), "promoted": True}


@router.post("/public/retas/{reta_id}/waitlist", response_model=WaitlistEntry)
async def join_waitlist(reta_id: str, body: WaitlistCreate):
    """Une a un jugador a la lista de espera con posición ATÓMICA.

    Garantiza que dos clics simultáneos siempre obtengan posiciones distintas
    (sin retries, sin colisiones).
    """
    if body.reta_id != reta_id:
        raise HTTPException(400, "reta_id mismatch")
    reta = await db.retas.find_one({"id": reta_id})
    if not reta:
        raise HTTPException(404, "Reta no encontrada")

    # Si ya está en la lista, devolvemos la entrada existente (idempotente).
    existing = await db.lista_espera.find_one(
        {"reta_id": reta_id, "telefono": body.telefono}, {"_id": 0},
    )
    if existing:
        return WaitlistEntry(**existing)

    # Posición atómica (siempre única, race-safe).
    next_pos = await siguiente_posicion_waitlist_atomica(reta_id)

    jugador = await db.usuarios.find_one({"telefono": body.telefono})
    if not jugador:
        nuevo = Usuario(nombre=body.nombre, telefono=body.telefono)
        doc = nuevo.model_dump()
        doc["creado_en"] = doc["creado_en"].isoformat()
        await db.usuarios.insert_one(doc)
        jugador_id = nuevo.id
    else:
        jugador_id = jugador["id"]

    entry = WaitlistEntry(
        reta_id=reta_id,
        jugador_id=jugador_id,
        nombre=body.nombre,
        telefono=body.telefono,
        posicion_fila=next_pos,
    )
    doc = entry.model_dump()
    doc["creado_en"] = doc["creado_en"].isoformat()
    await db.lista_espera.insert_one(doc)
    return entry


# ============================================================================
# Public — Asistencia Check (P2 · Visual feedback Anti-Flake)
# ============================================================================
@router.get("/public/retas/{reta_id}/asistencia-check")
async def public_asistencia_check(reta_id: str, telefono: str):
    """Devuelve si un jugador (por teléfono) pasaría el gate Anti-Flake.

    Endpoint informativo · NO bloquea ni reserva nada. Sirve para que la
    pantalla pública de inscripción muestre feedback visual antes de que
    el jugador intente checkout.

    Returns:
        gate_on: bool — si la reta tiene el filtro activo.
        threshold: int — porcentaje mínimo requerido (default 90).
        rate_pct: float — tasa de asistencia histórica del jugador.
        sample_size: int — número de retas pasadas Aprobadas.
        exento: bool — si sample < MIN_SAMPLE_FOR_ANTIFLAKE.
        passes: bool — si el jugador pasaría el gate.
    """
    # Saneamos teléfono mínimo para evitar lookup vacíos. No autenticamos
    # porque es un check informativo (no expone datos sensibles).
    tel = (telefono or "").strip()
    if len(tel) < 8:
        raise HTTPException(400, "Teléfono inválido")

    reta = await db.retas.find_one({"id": reta_id}, {"_id": 0, "requiere_alta_asistencia": 1, "asistencia_minima_pct": 1})
    if not reta:
        raise HTTPException(404, "Reta no encontrada")

    gate_on = bool(reta.get("requiere_alta_asistencia", False))
    threshold = int(reta.get("asistencia_minima_pct") or 90)
    rate_pct, sample_size = await player_attendance_rate(tel)
    exento = sample_size < MIN_SAMPLE_FOR_ANTIFLAKE
    passes = (not gate_on) or exento or rate_pct >= threshold
    return {
        "gate_on": gate_on,
        "threshold": threshold,
        "rate_pct": rate_pct,
        "sample_size": sample_size,
        "exento": exento,
        "passes": passes,
        "min_sample": MIN_SAMPLE_FOR_ANTIFLAKE,
    }

