"""
Pixel Padel OS — API principal FastAPI.
Incluye:
- Auth admin JWT
- CRUD Retas
- Radar geolocalizado (Haversine)
- Inscripciones + checkout con bloqueo 5 min (mock)
- Lista de espera atómica
- PDF A4 del rol Round Robin
- Cronjob recordatorios WhatsApp 2h (mock)
- Webhook mock de pagos
"""
import asyncio
import base64
import io
import logging
import os
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import List, Optional

from dotenv import load_dotenv
from fastapi import APIRouter, Depends, FastAPI, HTTPException, Query, Response, status
from fastapi.responses import StreamingResponse
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo import ASCENDING
from slugify import slugify
from starlette.middleware.cors import CORSMiddleware

from auth import (
    create_access_token,
    get_current_admin,
    hash_password,
    verify_password,
)
from logica_torneo import (
    construir_fecha_local_iso,
    generar_rol_filtrado_8_jugadores,
    generar_rol_multi_cancha,
    obtener_distancia_km,
)
from models import (
    Inscripcion,
    InscripcionCreate,
    LoginRequest,
    PaymentWebhook,
    PDFRequest,
    PlayerStats,
    Reta,
    RetaCreate,
    RetaPublic,
    TokenResponse,
    Usuario,
    UsuarioCreate,
    WaitlistCreate,
    WaitlistEntry,
)
from notifications import (
    construir_mensaje_recordatorio,
    construir_mensaje_waitlist_promovido,
    send_whatsapp,
)
from pdf_generator import generar_pdf_rol

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger("pixel-padel-os")

app = FastAPI(title="Pixel Padel OS API")
api = APIRouter(prefix="/api")

ADMIN_EMAIL_DEFAULT = "admin@pixelpadel.com"
ADMIN_PASSWORD_DEFAULT = "admin123"


# ============== Startup: seed admin + indexes + cronjob ==============
@app.on_event("startup")
async def startup():
    # Índices únicos
    await db.usuarios.create_index([("telefono", ASCENDING)], unique=True)
    await db.retas.create_index([("url_slug", ASCENDING)], unique=True)
    await db.lista_espera.create_index(
        [("reta_id", ASCENDING), ("posicion_fila", ASCENDING)], unique=True
    )

    # Seed admin
    existing = await db.admins.find_one({"email": ADMIN_EMAIL_DEFAULT})
    if not existing:
        await db.admins.insert_one({
            "id": str(uuid.uuid4()),
            "email": ADMIN_EMAIL_DEFAULT,
            "hashed_password": hash_password(ADMIN_PASSWORD_DEFAULT),
            "creado_en": datetime.now(timezone.utc).isoformat(),
        })
        logger.info("Admin seedeado: %s / %s", ADMIN_EMAIL_DEFAULT, ADMIN_PASSWORD_DEFAULT)

    # Lanza cronjob en background
    asyncio.create_task(_cronjob_recordatorios())
    asyncio.create_task(_cronjob_expirar_bloqueos())


@app.on_event("shutdown")
async def shutdown():
    client.close()


# ============== AUTH ==============
@api.post("/auth/login", response_model=TokenResponse)
async def login(body: LoginRequest):
    admin = await db.admins.find_one({"email": body.username.lower()})
    if not admin or not verify_password(body.password, admin["hashed_password"]):
        raise HTTPException(status_code=401, detail="Credenciales incorrectas")
    token = create_access_token(subject=admin["email"], role="admin")
    return TokenResponse(access_token=token)


@api.get("/auth/me")
async def me(current=Depends(get_current_admin)):
    return {"email": current["sub"], "role": current["role"]}


# ============== HELPERS ==============
def _strip_mongo(doc: dict) -> dict:
    if not doc:
        return doc
    doc.pop("_id", None)
    return doc


async def _compute_public(r: dict) -> dict:
    """Adjunta inscritos_count, waitlist_count, capacidad y semáforo."""
    insc = await db.inscripciones.count_documents({
        "reta_id": r["id"],
        "estatus_pago": {"$in": ["Aprobado", "Pendiente"]},
    })
    pendientes_activos = await db.inscripciones.count_documents({
        "reta_id": r["id"],
        "estatus_pago": "Pendiente",
        "bloqueado_hasta": {"$gt": datetime.now(timezone.utc).isoformat()},
    })
    aprobados = await db.inscripciones.count_documents({
        "reta_id": r["id"],
        "estatus_pago": "Aprobado",
    })
    ocupados = aprobados + pendientes_activos
    wl = await db.lista_espera.count_documents({"reta_id": r["id"]})

    capacidad_pct = (ocupados / r["max_jugadores"]) * 100 if r["max_jugadores"] else 0
    if ocupados >= r["max_jugadores"]:
        semaforo = "ROJO"
    elif capacidad_pct >= 50:
        semaforo = "AMARILLO"
    else:
        semaforo = "VERDE"

    r["inscritos_count"] = ocupados
    r["waitlist_count"] = wl
    r["capacidad_pct"] = round(capacidad_pct, 1)
    r["semaforo"] = semaforo
    return r


# ============== RETAS — ADMIN ==============
@api.post("/retas", response_model=Reta)
async def create_reta(body: RetaCreate, current=Depends(get_current_admin)):
    fecha_iso = construir_fecha_local_iso(body.fecha_str, body.hora_str, body.tz_offset_minutes)
    base_slug = slugify(f"{body.nombre}-{body.club}-{body.fecha_str}")
    slug = base_slug
    n = 1
    while await db.retas.find_one({"url_slug": slug}):
        n += 1
        slug = f"{base_slug}-{n}"

    reta = Reta(
        nombre=body.nombre,
        club=body.club,
        fecha_evento=fecha_iso,
        canchas_disponibles=body.canchas_disponibles,
        max_jugadores=8 * body.canchas_disponibles,
        costo_inscripcion=body.costo_inscripcion,
        modalidad_juego=body.modalidad_juego,
        num_rondas=body.num_rondas,
        url_slug=slug,
        organizador_logo_url=body.organizador_logo_url,
        observaciones_publicas=body.observaciones_publicas,
        latitud=body.latitud,
        longitud=body.longitud,
        organizador_id=current["sub"],
    )
    doc = reta.model_dump()
    doc["creado_en"] = doc["creado_en"].isoformat() if isinstance(doc["creado_en"], datetime) else doc["creado_en"]
    await db.retas.insert_one(doc)
    return reta


@api.get("/retas", response_model=List[RetaPublic])
async def list_retas_admin(current=Depends(get_current_admin)):
    cursor = db.retas.find().sort("creado_en", -1)
    out = []
    async for r in cursor:
        _strip_mongo(r)
        await _compute_public(r)
        out.append(RetaPublic(**r))
    return out


@api.get("/retas/{reta_id}", response_model=RetaPublic)
async def get_reta_admin(reta_id: str, current=Depends(get_current_admin)):
    r = await db.retas.find_one({"id": reta_id}, {"_id": 0})
    if not r:
        raise HTTPException(404, "Reta no encontrada")
    await _compute_public(r)
    return RetaPublic(**r)


@api.put("/retas/{reta_id}", response_model=Reta)
async def update_reta(reta_id: str, body: RetaCreate, current=Depends(get_current_admin)):
    r = await db.retas.find_one({"id": reta_id})
    if not r:
        raise HTTPException(404, "Reta no encontrada")
    fecha_iso = construir_fecha_local_iso(body.fecha_str, body.hora_str, body.tz_offset_minutes)
    update = {
        "nombre": body.nombre,
        "club": body.club,
        "fecha_evento": fecha_iso,
        "canchas_disponibles": body.canchas_disponibles,
        "max_jugadores": 8 * body.canchas_disponibles,
        "costo_inscripcion": body.costo_inscripcion,
        "modalidad_juego": body.modalidad_juego,
        "num_rondas": body.num_rondas,
        "organizador_logo_url": body.organizador_logo_url,
        "observaciones_publicas": body.observaciones_publicas,
        "latitud": body.latitud,
        "longitud": body.longitud,
    }
    await db.retas.update_one({"id": reta_id}, {"$set": update})
    new = await db.retas.find_one({"id": reta_id}, {"_id": 0})
    return Reta(**new)


@api.delete("/retas/{reta_id}")
async def delete_reta(reta_id: str, current=Depends(get_current_admin)):
    res = await db.retas.delete_one({"id": reta_id})
    if res.deleted_count == 0:
        raise HTTPException(404, "Reta no encontrada")
    await db.inscripciones.delete_many({"reta_id": reta_id})
    await db.lista_espera.delete_many({"reta_id": reta_id})
    return {"ok": True}


@api.get("/retas/{reta_id}/inscripciones", response_model=List[Inscripcion])
async def list_inscripciones(reta_id: str, current=Depends(get_current_admin)):
    cursor = db.inscripciones.find({"reta_id": reta_id}, {"_id": 0}).sort("creado_en", 1)
    out = []
    async for d in cursor:
        out.append(Inscripcion(**d))
    return out


# ============== RETAS — PÚBLICAS ==============
@api.get("/public/retas/radar", response_model=List[RetaPublic])
async def radar(
    lat: Optional[float] = Query(None),
    lng: Optional[float] = Query(None),
    radio_km: float = Query(30.0, gt=0, le=200),
):
    """Si lat/lng se proveen, filtra por radio. Si no, retorna todas las retas futuras."""
    cursor = db.retas.find().sort("fecha_evento", 1)
    out = []
    async for r in cursor:
        _strip_mongo(r)
        if lat is not None and lng is not None:
            if not r.get("latitud") or not r.get("longitud"):
                # Sin geo data, no incluir cuando se pide filtro espacial.
                continue
            dist = obtener_distancia_km(lat, lng, r["latitud"], r["longitud"])
            if dist > radio_km:
                continue
            r["distancia_km"] = round(dist, 2)
        await _compute_public(r)
        out.append(RetaPublic(**r))
    return out


@api.get("/public/retas/{slug}", response_model=RetaPublic)
async def get_reta_by_slug(slug: str):
    r = await db.retas.find_one({"url_slug": slug}, {"_id": 0})
    if not r:
        raise HTTPException(404, "Reta no encontrada")
    await _compute_public(r)
    return RetaPublic(**r)


# ============== INSCRIPCIONES / CHECKOUT ==============
@api.post("/public/retas/{reta_id}/checkout", response_model=Inscripcion)
async def checkout(reta_id: str, body: InscripcionCreate):
    """Bloquea el lugar por 5 minutos mientras se procesa el pago (mock)."""
    if body.reta_id != reta_id:
        raise HTTPException(400, "reta_id mismatch")

    reta = await db.retas.find_one({"id": reta_id}, {"_id": 0})
    if not reta:
        raise HTTPException(404, "Reta no encontrada")

    # Limpiar inscripciones expiradas antes de contar
    now_iso = datetime.now(timezone.utc).isoformat()
    await db.inscripciones.update_many(
        {
            "reta_id": reta_id,
            "estatus_pago": "Pendiente",
            "bloqueado_hasta": {"$lt": now_iso},
        },
        {"$set": {"estatus_pago": "Expirado"}},
    )

    ocupados = await db.inscripciones.count_documents({
        "reta_id": reta_id,
        "estatus_pago": {"$in": ["Aprobado", "Pendiente"]},
    })
    if ocupados >= reta["max_jugadores"]:
        raise HTTPException(409, "Reta llena. Únete a la lista de espera.")

    # Upsert jugador
    jugador = await db.usuarios.find_one({"telefono": body.telefono})
    if not jugador:
        nuevo = Usuario(nombre=body.nombre, telefono=body.telefono)
        doc = nuevo.model_dump()
        doc["creado_en"] = doc["creado_en"].isoformat()
        await db.usuarios.insert_one(doc)
        jugador_id = nuevo.id
    else:
        jugador_id = jugador["id"]

    bloqueado_hasta = (datetime.now(timezone.utc) + timedelta(minutes=5)).isoformat()
    insc = Inscripcion(
        reta_id=reta_id,
        jugador_id=jugador_id,
        nombre=body.nombre,
        telefono=body.telefono,
        estatus_pago="Pendiente",
        bloqueado_hasta=bloqueado_hasta,
    )
    doc = insc.model_dump()
    doc["creado_en"] = doc["creado_en"].isoformat()
    await db.inscripciones.insert_one(doc)
    return insc


@api.post("/webhooks/payment")
async def webhook_payment(body: PaymentWebhook):
    """
    Endpoint mock para confirmar/cancelar pagos (Stripe/MercadoPago compatible).
    Cuerpo: { inscripcion_id, status: "approved"|"failed" }
    Idempotente: si la inscripción ya no existe (caso failed repetido), retorna ok.
    """
    insc = await db.inscripciones.find_one({"id": body.inscripcion_id})
    if not insc:
        # Idempotencia: webhook duplicado tras cancelación previa.
        return {"ok": True, "status": "already_processed"}

    if body.status == "approved":
        await db.inscripciones.update_one(
            {"id": body.inscripcion_id},
            {"$set": {"estatus_pago": "Aprobado", "bloqueado_hasta": None}},
        )
        return {"ok": True, "status": "Aprobado"}
    else:
        await db.inscripciones.delete_one({"id": body.inscripcion_id})
        await _promover_lista_espera(insc["reta_id"])
        return {"ok": True, "status": "Cancelado", "promoted": True}


# ============== LISTA DE ESPERA ==============
@api.post("/public/retas/{reta_id}/waitlist", response_model=WaitlistEntry)
async def join_waitlist(reta_id: str, body: WaitlistCreate):
    if body.reta_id != reta_id:
        raise HTTPException(400, "reta_id mismatch")
    reta = await db.retas.find_one({"id": reta_id})
    if not reta:
        raise HTTPException(404, "Reta no encontrada")

    # ¿Ya en waitlist?
    existing = await db.lista_espera.find_one({"reta_id": reta_id, "telefono": body.telefono})
    if existing:
        existing.pop("_id", None)
        return WaitlistEntry(**existing)

    # Calcular siguiente posición atómicamente con índice único (race-safe).
    for attempt in range(10):
        last = await db.lista_espera.find_one(
            {"reta_id": reta_id}, sort=[("posicion_fila", -1)]
        )
        next_pos = (last["posicion_fila"] if last else 0) + 1

        # Crear/upsert jugador
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
        try:
            doc = entry.model_dump()
            doc["creado_en"] = doc["creado_en"].isoformat()
            await db.lista_espera.insert_one(doc)
            return entry
        except Exception as e:
            # Race condition: alguien tomó la misma posición. Reintenta.
            logger.warning("Reintento waitlist (intento %d): %s", attempt + 1, e)
            await asyncio.sleep(0.05)
    raise HTTPException(500, "No se pudo unir a la lista de espera tras múltiples intentos")


async def _promover_lista_espera(reta_id: str):
    """Toma al jugador en posición 1 no notificado, lo promueve a inscripción Pendiente
    con 5 min de bloqueo, y envía WhatsApp express."""
    next_in_line = await db.lista_espera.find_one(
        {"reta_id": reta_id, "notificado": False},
        sort=[("posicion_fila", 1)],
    )
    if not next_in_line:
        return None

    bloqueado_hasta = (datetime.now(timezone.utc) + timedelta(minutes=5)).isoformat()
    insc = Inscripcion(
        reta_id=reta_id,
        jugador_id=next_in_line["jugador_id"],
        nombre=next_in_line["nombre"],
        telefono=next_in_line["telefono"],
        estatus_pago="Pendiente",
        bloqueado_hasta=bloqueado_hasta,
    )
    doc = insc.model_dump()
    doc["creado_en"] = doc["creado_en"].isoformat()
    await db.inscripciones.insert_one(doc)

    await db.lista_espera.update_one(
        {"id": next_in_line["id"]},
        {"$set": {"notificado": True}},
    )
    # Notificar
    reta = await db.retas.find_one({"id": reta_id}, {"_id": 0})
    link = f"/retas/{reta['url_slug']}?inscripcion={insc.id}"
    msg = construir_mensaje_waitlist_promovido(insc.nombre, reta["nombre"], link)
    await send_whatsapp(insc.telefono, msg)
    return insc


# ============== PDF ==============
@api.post("/retas/{reta_id}/pdf")
async def generar_pdf_reta(
    reta_id: str,
    body: Optional[PDFRequest] = None,
    current=Depends(get_current_admin),
):
    """Genera PDF A4 del rol. Si body.jugadores se omite, usa los inscritos aprobados."""
    reta = await db.retas.find_one({"id": reta_id}, {"_id": 0})
    if not reta:
        raise HTTPException(404, "Reta no encontrada")

    num_rondas = (body.num_rondas if body else reta.get("num_rondas", 7))
    canchas = reta["canchas_disponibles"]
    required = canchas * 8

    if body and body.jugadores:
        jugadores = body.jugadores
    else:
        cursor = db.inscripciones.find(
            {"reta_id": reta_id, "estatus_pago": "Aprobado"},
            {"_id": 0},
        ).sort("creado_en", 1)
        jugadores = []
        async for d in cursor:
            jugadores.append(d["nombre"])

    # Rellenar con placeholders si faltan
    while len(jugadores) < required:
        jugadores.append(f"Jugador {len(jugadores)+1}")
    jugadores = jugadores[:required]

    rol_canchas = generar_rol_multi_cancha(jugadores, canchas, num_rondas)

    # Logo bytes (si hay URL base64 data: o externo no soportado en mock; placeholder).
    logo_bytes = None
    logo_url = reta.get("organizador_logo_url")
    if logo_url and logo_url.startswith("data:image"):
        try:
            b64 = logo_url.split(",", 1)[1]
            logo_bytes = base64.b64decode(b64)
        except Exception:
            logo_bytes = None

    pdf_bytes = generar_pdf_rol(reta, rol_canchas, logo_bytes)
    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="rol-{reta["url_slug"]}.pdf"'},
    )


# ============== STATS JUGADOR ==============
@api.get("/public/players/{telefono}/stats", response_model=PlayerStats)
async def player_stats(telefono: str):
    user = await db.usuarios.find_one({"telefono": telefono}, {"_id": 0})
    if not user:
        # Devolver default vacío
        return PlayerStats(jugador_id="", nombre="", partidos_jugados=0, partidos_ganados=0, efectividad=0.0)

    # Stats simuladas a partir de inscripciones aprobadas (cada reta = ~ num_rondas partidos)
    cursor = db.inscripciones.find({"telefono": telefono, "estatus_pago": "Aprobado"}, {"_id": 0})
    total = 0
    async for ins in cursor:
        reta = await db.retas.find_one({"id": ins["reta_id"]}, {"num_rondas": 1, "_id": 0})
        if reta:
            total += reta.get("num_rondas", 7) * 2  # 2 partidos por ronda
    ganados = int(total * 0.55)  # placeholder hasta que haya resultados reales
    efectividad = (ganados / total * 100) if total else 0.0
    return PlayerStats(
        jugador_id=user["id"],
        nombre=user["nombre"],
        partidos_jugados=total,
        partidos_ganados=ganados,
        efectividad=round(efectividad, 1),
    )


# ============== CRONJOBS ==============
async def _cronjob_recordatorios():
    """Cada 15 min: busca retas que arranquen en ~2h y manda WhatsApp."""
    while True:
        try:
            ahora = datetime.now(timezone.utc)
            ventana_ini = (ahora + timedelta(hours=2, minutes=-7)).isoformat()
            ventana_fin = (ahora + timedelta(hours=2, minutes=8)).isoformat()
            cursor = db.retas.find({
                "alertas_enviadas": False,
                "fecha_evento": {"$gte": ventana_ini, "$lte": ventana_fin},
            })
            async for r in cursor:
                inscripciones = db.inscripciones.find({
                    "reta_id": r["id"], "estatus_pago": "Aprobado",
                })
                async for ins in inscripciones:
                    msg = construir_mensaje_recordatorio(
                        ins["nombre"], r["nombre"], r["club"], r["fecha_evento"],
                        r.get("observaciones_publicas", ""),
                    )
                    await send_whatsapp(ins["telefono"], msg)
                await db.retas.update_one({"id": r["id"]}, {"$set": {"alertas_enviadas": True}})
        except Exception as e:
            logger.exception("Error en cronjob recordatorios: %s", e)
        await asyncio.sleep(60 * 15)  # 15 min


async def _cronjob_expirar_bloqueos():
    """Cada 30s: expira inscripciones con bloqueo vencido y promueve waitlist."""
    while True:
        try:
            now_iso = datetime.now(timezone.utc).isoformat()
            expiradas = db.inscripciones.find({
                "estatus_pago": "Pendiente",
                "bloqueado_hasta": {"$lt": now_iso},
            })
            retas_afectadas = set()
            async for ins in expiradas:
                await db.inscripciones.delete_one({"id": ins["id"]})
                retas_afectadas.add(ins["reta_id"])
            for reta_id in retas_afectadas:
                await _promover_lista_espera(reta_id)
        except Exception as e:
            logger.exception("Error cronjob bloqueos: %s", e)
        await asyncio.sleep(30)


# ============== HEALTH ==============
@api.get("/")
async def health():
    return {"status": "ok", "app": "Pixel Padel OS API"}


app.include_router(api)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
