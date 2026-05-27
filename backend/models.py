"""Pydantic models for Pixel Padel OS."""
from datetime import datetime
from typing import List, Optional, Literal
from pydantic import BaseModel, Field, constr
import uuid


# ============= Usuarios =============
class UsuarioCreate(BaseModel):
    nombre: str
    telefono: str
    nivel: Literal["Primera", "Segunda", "Tercera", "Cuarta", "Quinta", "Iniciación"] = "Iniciación"
    perfil_publico: bool = True


class Usuario(UsuarioCreate):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    creado_en: datetime = Field(default_factory=lambda: datetime.now())


class PlayerStats(BaseModel):
    jugador_id: str
    nombre: str
    partidos_jugados: int = 0
    partidos_ganados: int = 0
    efectividad: float = 0.0  # 0..100


# ============= Retas =============
class RetaCreate(BaseModel):
    nombre: str
    club: str
    fecha_str: str  # YYYY-MM-DD
    hora_str: str   # HH:mm
    tz_offset_minutes: int = -360  # default CDMX
    canchas_disponibles: int = Field(ge=1, le=8)
    costo_inscripcion: float = 0.0
    modalidad_juego: Literal["PUNTOS", "TIEMPO"] = "PUNTOS"
    num_rondas: Literal[5, 6, 7] = 7
    organizador_logo_url: Optional[str] = None
    observaciones_publicas: constr(max_length=140) = ""  # type: ignore
    latitud: Optional[float] = None
    longitud: Optional[float] = None


class Reta(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    organizador_id: str = "admin"
    nombre: str
    club: str
    fecha_evento: str  # ISO 8601 con offset
    canchas_disponibles: int
    max_jugadores: int  # 8 * canchas
    costo_inscripcion: float = 0.0
    modalidad_juego: Literal["PUNTOS", "TIEMPO"]
    num_rondas: int
    url_slug: str
    organizador_logo_url: Optional[str] = None
    observaciones_publicas: str = ""
    latitud: Optional[float] = None
    longitud: Optional[float] = None
    alertas_enviadas: bool = False
    creado_en: datetime = Field(default_factory=lambda: datetime.now())


class RetaPublic(Reta):
    inscritos_count: int = 0
    waitlist_count: int = 0
    capacidad_pct: float = 0.0
    semaforo: Literal["VERDE", "AMARILLO", "ROJO"] = "VERDE"


# ============= Inscripciones =============
class InscripcionCreate(BaseModel):
    reta_id: str
    nombre: str
    telefono: str


class Inscripcion(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    reta_id: str
    jugador_id: str
    nombre: str
    telefono: str
    estatus_pago: Literal["Pendiente", "Aprobado", "Expirado"] = "Pendiente"
    bloqueado_hasta: Optional[str] = None  # ISO
    creado_en: datetime = Field(default_factory=lambda: datetime.now())


# ============= Lista de espera =============
class WaitlistCreate(BaseModel):
    reta_id: str
    nombre: str
    telefono: str


class WaitlistEntry(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    reta_id: str
    jugador_id: str
    nombre: str
    telefono: str
    posicion_fila: int
    notificado: bool = False
    creado_en: datetime = Field(default_factory=lambda: datetime.now())


# ============= Auth =============
class LoginRequest(BaseModel):
    username: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


# ============= Webhook =============
class PaymentWebhook(BaseModel):
    inscripcion_id: str
    status: Literal["approved", "failed"]


# ============= PDF =============
class PDFRequest(BaseModel):
    jugadores: List[str]
    num_rondas: Literal[5, 6, 7] = 7


# ============= Resultados de partidos =============
class PartidoResultadoCreate(BaseModel):
    """Score de un partido. Se identifica de forma única por
    (reta_id, cancha, ronda, partido_idx)."""
    cancha: int = Field(ge=1, le=8)
    ronda: int = Field(ge=1, le=7)
    partido_idx: int = Field(ge=0, le=1)  # 0 = primer partido de la ronda, 1 = segundo
    pareja_a: List[str]  # nombres (2)
    pareja_b: List[str]  # nombres (2)
    score_a: int = Field(ge=0, le=99)
    score_b: int = Field(ge=0, le=99)


class PartidoResultado(PartidoResultadoCreate):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    reta_id: str
    ganador: Literal["A", "B", "EMPATE"] = "A"
    creado_en: datetime = Field(default_factory=lambda: datetime.now())


class TablaPosicionEntry(BaseModel):
    nombre: str
    partidos_jugados: int = 0
    partidos_ganados: int = 0
    partidos_empatados: int = 0
    partidos_perdidos: int = 0
    juegos_a_favor: int = 0
    juegos_en_contra: int = 0
    diferencia: int = 0
    puntos: int = 0  # 3 por victoria, 1 por empate
    efectividad: float = 0.0


# ============= Stripe Payments =============
class StripeCheckoutCreate(BaseModel):
    nombre: str = Field(min_length=2, max_length=80)
    telefono: str = Field(min_length=6, max_length=20)
    success_url: Optional[str] = None  # URL absoluta a la que volver tras pago OK
    cancel_url: Optional[str] = None


class StripeCheckoutResponse(BaseModel):
    inscripcion_id: str
    checkout_url: str
    session_id: str


class PaymentStatus(BaseModel):
    inscripcion_id: str
    estatus_pago: str
    session_id: Optional[str] = None
    stripe_payment_status: Optional[str] = None


class StripeTransaction(BaseModel):
    """Tracking server-side de cada Checkout Session creada. NO confiamos en el cliente."""
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    session_id: str
    inscripcion_id: str
    reta_id: str
    jugador_id: str
    telefono: str
    amount: float
    currency: str
    payment_status: Literal["initiated", "paid", "failed", "expired"] = "initiated"
    creado_en: datetime = Field(default_factory=lambda: datetime.now())
