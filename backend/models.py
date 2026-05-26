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
