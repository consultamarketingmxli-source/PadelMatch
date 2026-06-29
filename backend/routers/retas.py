"""Endpoints admin de Retas: CRUD + listar inscripciones + expirar pendientes + QR."""
import math
import os
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel
from slugify import slugify

from auth import get_current_admin
from core.db import db
from core.helpers import compute_public, expirar_bloqueos_pass, strip_mongo
from core.image_utils import compress_logo_to_webp
from core.qr_utils import make_qr_png
from logica_torneo import construir_fecha_local_iso
from models import (
    AvisoManualPayload,
    AvisosManualesResponse,
    Inscripcion,
    InscripcionManualCreate,
    MarcarPagadoBody,
    Reta,
    RetaCreate,
    RetaPublic,
)
from routers.clubes import upsert_club_silencioso

router = APIRouter(prefix="/retas", tags=["retas"])


def _public_base_url() -> str:
    """URL pública del frontend (donde el invitado abrirá la reta).

    Convención del proyecto: usamos `APP_PUBLIC_URL` (igual que el resto del
    backend para success/cancel URLs de Stripe & MP). Como fallback intentamos
    `EXPO_PUBLIC_FRONTEND_URL`, y por último `EXPO_PUBLIC_BACKEND_URL` (mismo
    dominio en la preview de Emergent).
    """
    for var in ("APP_PUBLIC_URL", "EXPO_PUBLIC_FRONTEND_URL", "EXPO_PUBLIC_BACKEND_URL"):
        v = os.environ.get(var, "").strip().rstrip("/")
        if v:
            return v
    return ""


def _build_public_link(slug: str) -> str:
    base = _public_base_url()
    if not base:
        # último fallback — link relativo, igual sirve si el cliente ya conoce el host
        return f"/retas/{slug}"
    return f"{base}/retas/{slug}"


def _resolve_max_jugadores(body: RetaCreate) -> int:
    """Si el cliente manda max_jugadores explícito lo respeta (ya validado).
    Si NO lo manda, retrocompat: 8 jugadores por cancha (clientes antiguos)."""
    if body.max_jugadores is not None:
        return int(body.max_jugadores)
    return 8 * body.canchas_disponibles


def _derive_canchas(max_jugadores: int, declared: int) -> int:
    """Calcula cuántas canchas físicas hacen falta para `max_jugadores`.
    Cada cancha estándar = 8 jugadores; remanente de 4 = 1 cancha mini.
    Si el organizador declaró más canchas que las necesarias, las respeta."""
    necesarias = math.ceil(max_jugadores / 8)
    return max(int(declared), int(necesarias))


@router.post("", response_model=Reta)
async def create_reta(body: RetaCreate, current=Depends(get_current_admin)):
    fecha_iso = construir_fecha_local_iso(body.fecha_str, body.hora_str, body.tz_offset_minutes)
    base_slug = slugify(f"{body.nombre}-{body.club}-{body.fecha_str}")
    slug = base_slug
    n = 1
    while await db.retas.find_one({"url_slug": slug}):
        n += 1
        slug = f"{base_slug}-{n}"

    max_jug = _resolve_max_jugadores(body)
    canchas = _derive_canchas(max_jug, body.canchas_disponibles)
    logo_webp = compress_logo_to_webp(body.organizador_logo_url)

    # ===== Resolución de club_id (Selector Inteligente) =====
    # 1) Si llega club_id explícito, verificamos que exista en el directorio.
    #    Si NO existe, lo tratamos como nulo (degradación silenciosa).
    # 2) Si NO llega club_id, hacemos enriquecimiento silencioso por nombre.
    #    Eso devuelve el club_id resultante (existente o recién creado).
    resolved_club_id: Optional[str] = None
    club_doc = None
    if body.club_id:
        club_doc = await db.clubes.find_one({"id": body.club_id}, {"_id": 0})
        if club_doc:
            resolved_club_id = club_doc["id"]
    if not resolved_club_id:
        resolved_club_id = await upsert_club_silencioso(
            nombre=body.club,
            direccion=body.club_direccion,
            lat=body.latitud,
            lng=body.longitud,
        )
        if resolved_club_id:
            club_doc = await db.clubes.find_one({"id": resolved_club_id}, {"_id": 0})

    # Si tenemos el doc resuelto, podemos heredar dirección/coords si no vinieron.
    club_dir_final = body.club_direccion or (club_doc or {}).get("direccion_completa") or None
    lat_final = body.latitud
    lng_final = body.longitud
    if lat_final is None and club_doc:
        lat_final = club_doc.get("latitud")
    if lng_final is None and club_doc:
        lng_final = club_doc.get("longitud")

    reta = Reta(
        nombre=body.nombre,
        club=body.club,
        club_id=resolved_club_id,
        club_direccion=club_dir_final,
        fecha_evento=fecha_iso,
        canchas_disponibles=canchas,
        max_jugadores=max_jug,
        costo_inscripcion=body.costo_inscripcion,
        modalidad_juego=body.modalidad_juego,
        num_rondas=body.num_rondas,
        formato_score=body.formato_score,
        modalidad_registro=body.modalidad_registro,
        permitir_individual_en_parejas=body.permitir_individual_en_parejas,
        tipo_acceso=body.tipo_acceso,
        url_slug=slug,
        organizador_logo_url=logo_webp,
        observaciones_publicas=body.observaciones_publicas,
        latitud=lat_final,
        longitud=lng_final,
        organizador_id=current["sub"],
        organizador_telefono=body.organizador_telefono,
        # === Fase 1 (Sección 1) — Parametrización extendida ===
        num_ganadores_por_cancha=body.num_ganadores_por_cancha,
        criterio_desempate=body.criterio_desempate,
        jugadores_por_cancha=body.jugadores_por_cancha,
        # === Anti-Flake Filter (PRO feature) ===
        requiere_alta_asistencia=body.requiere_alta_asistencia,
        asistencia_minima_pct=body.asistencia_minima_pct,
        # === Iter50 — Pago en Cancha ===
        permitir_pago_cancha=body.permitir_pago_cancha,
    )
    doc = reta.model_dump()
    doc["creado_en"] = (
        doc["creado_en"].isoformat() if isinstance(doc["creado_en"], datetime) else doc["creado_en"]
    )
    await db.retas.insert_one(doc)
    return reta


@router.get("", response_model=List[RetaPublic])
async def list_retas_admin(current=Depends(get_current_admin)):
    cursor = db.retas.find().sort("creado_en", -1).limit(500)
    out = []
    async for r in cursor:
        strip_mongo(r)
        await compute_public(r)
        out.append(RetaPublic(**r))
    return out


@router.get("/{reta_id}", response_model=RetaPublic)
async def get_reta_admin(reta_id: str, current=Depends(get_current_admin)):
    r = await db.retas.find_one({"id": reta_id}, {"_id": 0})
    if not r:
        raise HTTPException(404, "Reta no encontrada")
    await compute_public(r)
    return RetaPublic(**r)


@router.put("/{reta_id}", response_model=Reta)
async def update_reta(reta_id: str, body: RetaCreate, current=Depends(get_current_admin)):
    r = await db.retas.find_one({"id": reta_id})
    if not r:
        raise HTTPException(404, "Reta no encontrada")
    fecha_iso = construir_fecha_local_iso(body.fecha_str, body.hora_str, body.tz_offset_minutes)
    max_jug = _resolve_max_jugadores(body)
    canchas = _derive_canchas(max_jug, body.canchas_disponibles)
    logo_webp = compress_logo_to_webp(body.organizador_logo_url)

    # Re-resolución de club_id (igual que en create).
    resolved_club_id: Optional[str] = None
    club_doc = None
    if body.club_id:
        club_doc = await db.clubes.find_one({"id": body.club_id}, {"_id": 0})
        if club_doc:
            resolved_club_id = club_doc["id"]
    if not resolved_club_id:
        resolved_club_id = await upsert_club_silencioso(
            nombre=body.club,
            direccion=body.club_direccion,
            lat=body.latitud,
            lng=body.longitud,
        )
        if resolved_club_id:
            club_doc = await db.clubes.find_one({"id": resolved_club_id}, {"_id": 0})

    club_dir_final = body.club_direccion or (club_doc or {}).get("direccion_completa") or None
    lat_final = body.latitud
    lng_final = body.longitud
    if lat_final is None and club_doc:
        lat_final = club_doc.get("latitud")
    if lng_final is None and club_doc:
        lng_final = club_doc.get("longitud")

    update = {
        "nombre": body.nombre,
        "club": body.club,
        "club_id": resolved_club_id,
        "club_direccion": club_dir_final,
        "fecha_evento": fecha_iso,
        "canchas_disponibles": canchas,
        "max_jugadores": max_jug,
        "costo_inscripcion": body.costo_inscripcion,
        "modalidad_juego": body.modalidad_juego,
        "num_rondas": body.num_rondas,
        "formato_score": body.formato_score.model_dump(),
        "modalidad_registro": body.modalidad_registro,
        "permitir_individual_en_parejas": body.permitir_individual_en_parejas,
        "tipo_acceso": body.tipo_acceso,
        "organizador_logo_url": logo_webp,
        "observaciones_publicas": body.observaciones_publicas,
        "latitud": lat_final,
        "longitud": lng_final,
        "organizador_telefono": body.organizador_telefono,
        # === Fase 1 (Sección 1) — Parametrización extendida ===
        "num_ganadores_por_cancha": body.num_ganadores_por_cancha,
        "criterio_desempate": body.criterio_desempate,
        "jugadores_por_cancha": body.jugadores_por_cancha,
        # === Anti-Flake Filter (PRO feature) ===
        "requiere_alta_asistencia": body.requiere_alta_asistencia,
        "asistencia_minima_pct": body.asistencia_minima_pct,
    }
    await db.retas.update_one({"id": reta_id}, {"$set": update})
    new = await db.retas.find_one({"id": reta_id}, {"_id": 0})
    return Reta(**new)


@router.delete("/{reta_id}")
async def delete_reta(reta_id: str, current=Depends(get_current_admin)):
    res = await db.retas.delete_one({"id": reta_id})
    if res.deleted_count == 0:
        raise HTTPException(404, "Reta no encontrada")
    await db.inscripciones.delete_many({"reta_id": reta_id})
    await db.lista_espera.delete_many({"reta_id": reta_id})
    await db.resultados.delete_many({"reta_id": reta_id})
    await db.stripe_transactions.delete_many({"reta_id": reta_id})
    return {"ok": True}


@router.get("/{reta_id}/inscripciones", response_model=List[Inscripcion])
async def list_inscripciones(reta_id: str, current=Depends(get_current_admin)):
    cursor = db.inscripciones.find({"reta_id": reta_id}, {"_id": 0}).sort("creado_en", 1).limit(500)
    out = []
    async for d in cursor:
        out.append(Inscripcion(**d))
    return out


# ---------------- IMPORT MASIVO de jugadores (CSV/manual bulk) -----------------
class ImportJugadorItem(BaseModel):
    nombre: str
    telefono: str | None = None


class ImportJugadoresBody(BaseModel):
    jugadores: List[ImportJugadorItem]


@router.post("/{reta_id}/inscripciones/import")
async def import_inscripciones_bulk(
    reta_id: str,
    body: ImportJugadoresBody,
    current=Depends(get_current_admin),
):
    """Crea inscripciones en bulk (estatus_pago='Aprobado') a partir de
    una lista parseada (típicamente desde CSV importado por el organizador).

    Reglas de seguridad:
      • Solo admin.
      • Lista no vacía y máximo 1000 items por request (DoS guard).
      • Cada nombre: 2..80 chars, normalizado (trim, strip duplicates spaces).
      • Teléfono opcional → si vacío usa "N/A".
      • Skip duplicados: nombres ya presentes en la reta (cualquier estatus)
        se devuelven en `omitidos` con razón "duplicado".
      • Skip si nombre vacío post-trim → `omitidos` con razón "vacio".
      • Skip si superan el cupo `max_jugadores` → `omitidos` con razón
        "cupo_lleno" (se respeta el orden de llegada en el body).
      • También bloquea si ya hay resultados capturados (409) — no se debe
        cambiar el cupo activo del torneo en juego.

    Respuesta:
      {
        creadas: int,
        omitidos: [{nombre, razon}],
        total_aprobados: int,
        max_jugadores: int
      }
    """
    import uuid as _uuid
    import re as _re
    from datetime import timezone as _tz

    reta = await db.retas.find_one({"id": reta_id}, {"_id": 0})
    if not reta:
        raise HTTPException(404, "Reta no encontrada")

    items = body.jugadores or []
    if not items:
        raise HTTPException(422, "La lista 'jugadores' no puede estar vacía")
    if len(items) > 1000:
        raise HTTPException(422, "Máximo 1000 jugadores por importación")

    # Bloqueo si ya hay resultados (consistencia con drag & drop)
    if await db.resultados.count_documents({"reta_id": reta_id}):
        raise HTTPException(
            409,
            "No se puede importar: ya hay resultados capturados. Elimina los marcadores primero.",
        )

    canchas = reta["canchas_disponibles"]
    max_jug = int(reta.get("max_jugadores") or canchas * 8)

    # Estado actual: nombres ya en la reta (cualquier estatus)
    cursor = db.inscripciones.find({"reta_id": reta_id}, {"_id": 0, "nombre": 1, "estatus_pago": 1})
    existentes_norm: set[str] = set()
    aprobados_count = 0
    async for d in cursor:
        existentes_norm.add(d["nombre"].strip().lower())
        if d.get("estatus_pago") == "Aprobado":
            aprobados_count += 1

    creadas = 0
    omitidos: List[dict] = []
    docs_to_insert: List[dict] = []
    nombres_en_lote_norm: set[str] = set()  # evitar duplicados dentro del mismo CSV

    for it in items:
        # Normalizar
        nombre = _re.sub(r"\s+", " ", (it.nombre or "")).strip()
        if len(nombre) < 2 or len(nombre) > 80:
            omitidos.append({"nombre": it.nombre or "", "razon": "vacio"})
            continue

        key = nombre.lower()
        if key in existentes_norm or key in nombres_en_lote_norm:
            omitidos.append({"nombre": nombre, "razon": "duplicado"})
            continue

        if (aprobados_count + creadas) >= max_jug:
            omitidos.append({"nombre": nombre, "razon": "cupo_lleno"})
            continue

        telefono = (it.telefono or "N/A").strip() or "N/A"
        docs_to_insert.append({
            "id": str(_uuid.uuid4()),
            "reta_id": reta_id,
            "jugador_id": f"import-{_uuid.uuid4().hex[:8]}",
            "nombre": nombre,
            "telefono": telefono,
            "estatus_pago": "Aprobado",
            "bloqueado_hasta": None,
            "creado_en": datetime.now(_tz.utc),
            "via_import": True,
        })
        nombres_en_lote_norm.add(key)
        creadas += 1

    if docs_to_insert:
        await db.inscripciones.insert_many(docs_to_insert)

    total_aprobados = aprobados_count + creadas
    return {
        "creadas": creadas,
        "omitidos": omitidos,
        "total_aprobados": total_aprobados,
        "max_jugadores": max_jug,
    }


@router.post("/{reta_id}/expirar-pendientes")
async def admin_expirar_pendientes(reta_id: str, current=Depends(get_current_admin)):
    """Liberación manual: elimina todas las inscripciones Pendientes (aunque
    aún no haya vencido el bloqueo) y promueve a quienes estén en cola."""
    reta = await db.retas.find_one({"id": reta_id}, {"_id": 0})
    if not reta:
        raise HTTPException(404, "Reta no encontrada")
    res = await expirar_bloqueos_pass(force_reta_id=reta_id)
    return {"ok": True, **res}


# ----------------------------------------------------------------------
# Fase B — Compartir reta: link público, QR descargable, info elástica.
# ----------------------------------------------------------------------
class ShareInfo(BaseModel):
    reta_id: str
    nombre: str
    url_publica: str
    url_slug: str
    qr_endpoint: str  # ruta autenticada para descargar el PNG
    qr_publico: str   # ruta pública (sin auth) que también devuelve el PNG
    inscritos: int
    waitlist: int
    max_jugadores: int
    capacidad_pct: float
    semaforo: str
    sugerencia: str | None = None


def _sugerencia_capacidad(max_jug: int, inscritos: int) -> str | None:
    """Devuelve un consejo de UX sobre la capacidad declarada.

    Sembrar conciencia al organizador antes de que reciba inscripciones impares
    o sobrecapacidad. Mensajes cortos, listos para mostrar en banner.
    """
    # 6 es la única capacidad "no múltiplo de 4" soportada (rotación).
    if max_jug != 6 and max_jug % 4 != 0:
        # No debería pasar (Pydantic ya lo bloquea), defensivo.
        sugerido = max(4, (max_jug // 4) * 4)
        return (
            f"Tu capacidad {max_jug} no es múltiplo de 4 ni 6. Te sugerimos "
            f"{sugerido} o habilitar lista de espera."
        )
    if inscritos >= max_jug:
        return (
            "Tu reta está al 100%. Nuevos jugadores entrarán automáticamente "
            "a la lista de espera (1 clic)."
        )
    libres = max_jug - inscritos
    if libres % 4 != 0:
        proximo_par = libres - (libres % 4)
        if proximo_par <= 0:
            return (
                "Pocos cupos restantes. Considera abrir lista de espera para "
                "no dejar a jugadores fuera."
            )
        return (
            f"Te quedan {libres} cupos. Idealmente cierras inscripciones cuando "
            f"queden múltiplos de 4 (faltan {libres - proximo_par} para el siguiente bloque)."
        )
    return None


@router.get("/{reta_id}/share-info", response_model=ShareInfo)
async def share_info(reta_id: str, current=Depends(get_current_admin)):
    """Devuelve metadatos para la pantalla 'Compartir reta' del admin."""
    r = await db.retas.find_one({"id": reta_id}, {"_id": 0})
    if not r:
        raise HTTPException(404, "Reta no encontrada")
    await compute_public(r)
    return ShareInfo(
        reta_id=r["id"],
        nombre=r["nombre"],
        url_publica=_build_public_link(r["url_slug"]),
        url_slug=r["url_slug"],
        qr_endpoint=f"/api/retas/{r['id']}/qr",
        qr_publico=f"/api/public/retas/{r['url_slug']}/qr",
        inscritos=r.get("inscritos_count", 0),
        waitlist=r.get("waitlist_count", 0),
        max_jugadores=r["max_jugadores"],
        capacidad_pct=r.get("capacidad_pct", 0.0),
        semaforo=r.get("semaforo", "VERDE"),
        sugerencia=_sugerencia_capacidad(r["max_jugadores"], r.get("inscritos_count", 0)),
    )


@router.get("/{reta_id}/qr")
async def reta_qr_png(reta_id: str, current=Depends(get_current_admin)):
    """PNG del QR codificando el link público de la reta. Admin-only."""
    r = await db.retas.find_one({"id": reta_id}, {"id": 1, "url_slug": 1, "_id": 0})
    if not r:
        raise HTTPException(404, "Reta no encontrada")
    url = _build_public_link(r["url_slug"])
    try:
        png = make_qr_png(url)
    except Exception as e:
        raise HTTPException(500, f"No se pudo generar QR: {e}")
    return Response(
        content=png,
        media_type="image/png",
        headers={
            "Cache-Control": "public, max-age=300",
            "Content-Disposition": f'inline; filename="qr-{r["url_slug"]}.png"',
        },
    )


# ════════════════════════════════════════════════════════════════════════════
# ITER50 — Pago en Cancha + Inscripción Manual
# ════════════════════════════════════════════════════════════════════════════

def _assert_es_dueno(reta: dict, current: dict) -> None:
    """Valida que el caller sea el organizador de la reta.

    Si current["role"] es "admin_master" (super-admin platform-wide) lo
    dejamos pasar — útil para soporte. En cualquier otro caso, el
    `current["sub"]` debe coincidir con `reta.organizador_id`.
    """
    if current.get("role") == "admin_master":
        return
    if str(reta.get("organizador_id") or "") != str(current.get("sub") or ""):
        raise HTTPException(
            403,
            "Sólo el organizador dueño de la reta puede agregar inscripciones manuales.",
        )


def _wa_link(telefono: Optional[str], texto: str) -> Optional[str]:
    """Construye un deeplink wa.me con texto preformateado.

    Acepta formatos `+52155...`, `52155...`, `155...`. Sólo deja dígitos.
    Si no hay número válido (>=10 dígitos), retorna un link "open" sin
    destinatario para que el organizador elija contacto manualmente.
    """
    if not telefono:
        return None
    digits = "".join(c for c in telefono if c.isdigit())
    if len(digits) < 10:
        return None
    from urllib.parse import quote
    return f"https://wa.me/{digits}?text={quote(texto)}"


@router.post(
    "/{reta_id}/inscripciones/manual",
    response_model=Inscripcion,
    status_code=201,
)
async def crear_inscripcion_manual(
    reta_id: str,
    body: InscripcionManualCreate,
    current=Depends(get_current_admin),
):
    """Inscripción manual creada por el organizador (típicamente para
    jugadores contactados por WhatsApp que NO tienen cuenta en la app).

    Comportamiento:
      • Valida ownership del organizador.
      • Reserva cupo atómico (no bypassa capacidad — si hay overflow → 409).
      • Crea inscripción con `tipo_inscripcion=MANUAL_ORGANIZADOR`,
        `estatus_pago=Pendiente`, `metodo_pago=<body>` (default efectivo_cancha).
      • NO dispara antiflake (no hay historial para jugador sin cuenta).
      • NO crea mp_transaction ni stripe_transaction.
    """
    import uuid as _uuid
    from core.concurrency import reservar_lugar_atomico, liberar_lugar

    reta = await db.retas.find_one({"id": reta_id}, {"_id": 0})
    if not reta:
        raise HTTPException(404, "Reta no encontrada")
    _assert_es_dueno(reta, current)

    # Reserva atómica de cupo
    reservada = await reservar_lugar_atomico(reta_id)
    if not reservada:
        raise HTTPException(
            409,
            "La reta está llena. Agrega al jugador a la lista de espera o libera un cupo.",
        )

    insc_doc = {
        "id": str(_uuid.uuid4()),
        "reta_id": reta_id,
        # jugador_id="" para manuales — back-compat con queries existentes
        # (todos los .find({"jugador_id": ...}) siguen funcionando).
        "jugador_id": "",
        "nombre": body.nombre_temporal.strip(),
        "telefono": body.telefono or "",
        "estatus_pago": "Pendiente",
        "estatus_confirmacion": "aceptado",
        "bloqueado_hasta": None,
        "tipo_inscripcion": "MANUAL_ORGANIZADOR",
        "metodo_pago": body.metodo_pago,
        "nombre_temporal": body.nombre_temporal.strip(),
        "pago_manual_nota": body.nota,
        "creado_en": datetime.now().isoformat(),
    }
    try:
        await db.inscripciones.insert_one(insc_doc)
    except Exception as e:
        # Rollback de cupo si la inserción falló (defensivo).
        await liberar_lugar(reta_id, 1)
        raise HTTPException(500, f"No se pudo crear la inscripción manual: {e}") from e

    return Inscripcion(**{k: v for k, v in insc_doc.items() if k != "_id"})


@router.patch(
    "/{reta_id}/inscripciones/{inscripcion_id}/marcar-pagado",
    response_model=Inscripcion,
)
async def marcar_inscripcion_pagada(
    reta_id: str,
    inscripcion_id: str,
    body: MarcarPagadoBody,
    current=Depends(get_current_admin),
):
    """Check-in cierre de caja: el organizador marca como Aprobado un pago
    en efectivo o transferencia manual el día del evento.

    Restricciones:
      • Sólo organizador dueño (o admin_master).
      • Sólo aplica si `metodo_pago != "online"` (cash o transferencia).
      • Sólo si la inscripción está `Pendiente` (idempotente para Aprobado).
    """
    reta = await db.retas.find_one({"id": reta_id}, {"_id": 0})
    if not reta:
        raise HTTPException(404, "Reta no encontrada")
    _assert_es_dueno(reta, current)

    insc = await db.inscripciones.find_one(
        {"id": inscripcion_id, "reta_id": reta_id}, {"_id": 0},
    )
    if not insc:
        raise HTTPException(404, "Inscripción no encontrada")

    metodo = str(insc.get("metodo_pago") or "online")
    if metodo == "online":
        raise HTTPException(
            400,
            "Esta inscripción se pagó por gateway (MP/Stripe). El check-in "
            "manual sólo aplica para pagos en efectivo o transferencia.",
        )
    # Idempotencia
    if insc.get("estatus_pago") == "Aprobado":
        return Inscripcion(**insc)
    if insc.get("estatus_pago") != "Pendiente":
        raise HTTPException(
            409,
            f"Esta inscripción está en estado '{insc.get('estatus_pago')}'. "
            "Sólo se puede marcar como pagada desde estado Pendiente.",
        )

    nota = (insc.get("pago_manual_nota") or "")
    if body.nota:
        nota = f"{nota}\n[{datetime.now().date()}] {body.nota}".strip()

    await db.inscripciones.update_one(
        {"id": inscripcion_id},
        {"$set": {
            "estatus_pago": "Aprobado",
            "bloqueado_hasta": None,
            "pago_manual": True,
            "pago_manual_nota": nota,
            "checked_in_en": datetime.now().isoformat(),
        }},
    )
    updated = await db.inscripciones.find_one({"id": inscripcion_id}, {"_id": 0})
    return Inscripcion(**updated)


@router.get(
    "/{reta_id}/avisos-manuales",
    response_model=AvisosManualesResponse,
)
async def listar_avisos_manuales(
    reta_id: str,
    current=Depends(get_current_admin),
):
    """Lista de inscripciones MANUAL_ORGANIZADOR para que el organizador
    contacte a los jugadores cuando la reta cambia de fecha o se cancela.

    Estos jugadores NO reciben push/email automático (no tienen app), así
    que el panel les ofrece:
      • Lista de nombres + teléfonos
      • Deeplinks `wa.me/<num>?text=...` por jugador
      • Un `bulk_whatsapp_payload` con texto pre-armado para copy-paste
        en cualquier chat/grupo de WhatsApp.
    """
    reta = await db.retas.find_one({"id": reta_id}, {"_id": 0})
    if not reta:
        raise HTTPException(404, "Reta no encontrada")
    _assert_es_dueno(reta, current)

    cursor = db.inscripciones.find(
        {"reta_id": reta_id, "tipo_inscripcion": "MANUAL_ORGANIZADOR"},
        {"_id": 0},
    ).sort("creado_en", 1).limit(200)

    # Plantilla del mensaje (puede personalizarse en versiones futuras).
    fecha_evento = str(reta.get("fecha_evento", ""))[:10]
    plantilla_individual = (
        f"Hola {{nombre}}, te aviso sobre la reta \"{reta['nombre']}\" "
        f"({fecha_evento} en {reta.get('club', '')}). "
        f"Hubo un cambio importante, ¿podemos coordinar?"
    )

    items: List[AvisoManualPayload] = []
    nombres_para_bulk: list[str] = []
    async for d in cursor:
        nombre = d.get("nombre_temporal") or d.get("nombre") or "Jugador"
        tel = d.get("telefono") or None
        texto = plantilla_individual.replace("{nombre}", nombre)
        items.append(AvisoManualPayload(
            inscripcion_id=d["id"],
            nombre_temporal=nombre,
            telefono=tel,
            metodo_pago=d.get("metodo_pago", "efectivo_cancha"),
            estatus_pago=d.get("estatus_pago", "Pendiente"),
            wa_link=_wa_link(tel, texto),
        ))
        nombres_para_bulk.append(f"• {nombre}" + (f" ({tel})" if tel else ""))

    bulk = (
        f"📣 *Aviso urgente — {reta['nombre']}*\n"
        f"Fecha: {fecha_evento} · Club: {reta.get('club', '')}\n\n"
        f"Hubo un cambio importante en la reta. Por favor confirmar disponibilidad.\n\n"
        f"Jugadores a contactar manualmente:\n"
        + ("\n".join(nombres_para_bulk) if nombres_para_bulk else "(ninguno)")
        + "\n\n— Organizador"
    )

    return AvisosManualesResponse(
        reta_id=reta_id,
        reta_nombre=reta["nombre"],
        total=len(items),
        lista_jugadores=items,
        bulk_whatsapp_payload=bulk,
    )
