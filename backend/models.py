"""Pydantic models for PadelappRetas OS."""
from datetime import datetime
from typing import List, Literal, Optional
from pydantic import BaseModel, Field, model_validator
import uuid

from core.validators import JugadoresPar4, NombreStr, ObservacionesStr, PhoneStr


# ============= Usuarios =============
class UsuarioCreate(BaseModel):
    nombre: NombreStr
    telefono: PhoneStr
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
class FormatoScore(BaseModel):
    """Formato de juego elástico. El admin elige cómo se define el ganador.

    - PUNTOS  + unidad="juegos":  ej. a 6/9/11 juegos por partido
    - PUNTOS  + unidad="sets":    ej. al mejor de 1 / 3 sets
    - TIEMPO  + unidad="minutos": ej. 15 / 20 / 30 min por partido

    El frontend adapta los marcadores en vivo según `tipo` (contadores
    incrementales para PUNTOS, timer regresivo para TIEMPO).
    """
    tipo: Literal["PUNTOS", "TIEMPO"] = "PUNTOS"
    valor: int = Field(default=9, ge=1, le=180)
    unidad: Literal["juegos", "sets", "minutos"] = "juegos"

    @model_validator(mode="after")
    def _coherencia(self) -> "FormatoScore":
        if self.tipo == "TIEMPO" and self.unidad != "minutos":
            raise ValueError("Con TIEMPO la unidad debe ser 'minutos'.")
        if self.tipo == "PUNTOS" and self.unidad not in ("juegos", "sets"):
            raise ValueError("Con PUNTOS la unidad debe ser 'juegos' o 'sets'.")
        if self.unidad == "minutos" and not (5 <= self.valor <= 90):
            raise ValueError("Duración en minutos válida: 5..90.")
        if self.unidad == "sets" and not (1 <= self.valor <= 5):
            raise ValueError("Sets válidos: 1..5.")
        if self.unidad == "juegos" and not (1 <= self.valor <= 21):
            raise ValueError("Juegos válidos: 1..21.")
        return self


def _default_formato_score() -> FormatoScore:
    return FormatoScore(tipo="PUNTOS", valor=9, unidad="juegos")


class RetaCreate(BaseModel):
    nombre: str = Field(min_length=2, max_length=80)
    club: str = Field(min_length=2, max_length=80)
    fecha_str: str  # YYYY-MM-DD
    hora_str: str   # HH:mm
    tz_offset_minutes: int = -360  # default CDMX
    canchas_disponibles: int = Field(ge=1, le=8)
    # Capacidad elástica — múltiplo de 4 entre 4 y 32. Si no se manda, se
    # calcula como 8 * canchas (retrocompat con clientes antiguos).
    max_jugadores: Optional[JugadoresPar4] = None
    costo_inscripcion: float = Field(default=0.0, ge=0, le=100000)
    modalidad_juego: Literal["PUNTOS", "TIEMPO"] = "PUNTOS"
    num_rondas: Literal[5, 6, 7] = 7
    formato_score: FormatoScore = Field(default_factory=_default_formato_score)
    # Modalidad de Registro elástica (Fase 1 — Foundation parejas).
    # individual       → flujo clásico round-robin individual (default, retrocompat).
    # parejas_libres   → inscripción por duplas, sin restricción de género.
    # parejas_mixtas   → inscripción por duplas, label/intent informativo
    #                    (la validación de género la administra el organizador).
    modalidad_registro: Literal["individual", "parejas_libres", "parejas_mixtas"] = "individual"
    # Si la reta es de parejas y este flag es True, se permite que jugadores
    # se inscriban SOLOS esperando que el organizador los empareje
    # manualmente desde la "bolsa de free agents" (Fase 4).
    permitir_individual_en_parejas: bool = False
    organizador_logo_url: Optional[str] = None
    observaciones_publicas: ObservacionesStr = ""
    latitud: Optional[float] = Field(default=None, ge=-90, le=90)
    longitud: Optional[float] = Field(default=None, ge=-180, le=180)

    @model_validator(mode="after")
    def _coherencia_modalidad(self) -> "RetaCreate":
        # El toggle de free-agents solo aplica si la reta es de parejas.
        if self.modalidad_registro == "individual" and self.permitir_individual_en_parejas:
            # Lo silenciamos (no rompemos), simplemente lo apagamos.
            object.__setattr__(self, "permitir_individual_en_parejas", False)
        return self


class Reta(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    organizador_id: str = "admin"
    nombre: str
    club: str
    fecha_evento: str  # ISO 8601 con offset
    canchas_disponibles: int
    max_jugadores: int  # múltiplo de 4, 4..32
    costo_inscripcion: float = 0.0
    modalidad_juego: Literal["PUNTOS", "TIEMPO"]
    num_rondas: int
    formato_score: FormatoScore = Field(default_factory=_default_formato_score)
    # Modalidad de Registro — default "individual" para retrocompatibilidad
    # de retas creadas antes de Fase 1.
    modalidad_registro: Literal["individual", "parejas_libres", "parejas_mixtas"] = "individual"
    permitir_individual_en_parejas: bool = False
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
    nombre: NombreStr
    telefono: PhoneStr
    # Soporte parejas (Fase 2). Opcionales para retrocompat con flujos
    # individuales y free-agents.
    pareja_nombre: Optional[NombreStr] = None
    pareja_telefono: Optional[PhoneStr] = None
    es_free_agent: bool = False

    @model_validator(mode="after")
    def _coherencia_pareja(self) -> "InscripcionCreate":
        # No puedes ser free-agent Y enviar datos de pareja a la vez.
        if self.es_free_agent and (self.pareja_nombre or self.pareja_telefono):
            raise ValueError(
                "Inconsistencia: 'es_free_agent' no admite datos de pareja."
            )
        # Si mandas un dato de pareja, debes mandar ambos.
        if bool(self.pareja_nombre) ^ bool(self.pareja_telefono):
            raise ValueError(
                "Debes proporcionar nombre Y teléfono de la pareja, o ninguno."
            )
        # Auto-mejora: si llegan los datos, normalizamos espacios trim.
        if self.pareja_nombre:
            object.__setattr__(self, "pareja_nombre", self.pareja_nombre.strip())
        return self


class Inscripcion(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    reta_id: str
    jugador_id: str
    nombre: str
    telefono: str
    estatus_pago: Literal["Pendiente", "Aprobado", "Expirado"] = "Pendiente"
    bloqueado_hasta: Optional[str] = None  # ISO
    # ===== Soporte parejas (Fase 1 — Foundation) =====
    # UUID compartido por las DOS inscripciones que pertenecen a la misma
    # dupla (creada al momento del checkout coordinado en Fase 2).
    # Null para inscripciones individuales o free-agents sin emparejar.
    pareja_grupo_id: Optional[str] = None
    # Snapshot conveniente del nombre/teléfono del compañero. No es la
    # fuente de verdad (cada miembro tiene su propia fila), pero acelera
    # render en UI sin necesidad de hacer JOIN.
    pareja_nombre: Optional[str] = None
    pareja_telefono: Optional[str] = None
    # True si el jugador se inscribió SOLO a una reta de parejas con la
    # intención de ser emparejado por el organizador (bolsa free-agents).
    # Mutuamente excluyente con `pareja_grupo_id` no-null.
    es_free_agent: bool = False
    creado_en: datetime = Field(default_factory=lambda: datetime.now())


# ============= Lista de espera =============
class WaitlistCreate(BaseModel):
    reta_id: str
    nombre: NombreStr
    telefono: PhoneStr


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

    @model_validator(mode="after")
    def _no_self_play(self) -> "PartidoResultadoCreate":
        # Cada pareja debe tener exactamente 2 jugadores distintos.
        if len(set(self.pareja_a)) != 2:
            raise ValueError("La pareja A debe tener 2 jugadores distintos.")
        if len(set(self.pareja_b)) != 2:
            raise ValueError("La pareja B debe tener 2 jugadores distintos.")
        # Ningún jugador puede estar en ambas parejas (self-play imposible).
        if set(self.pareja_a) & set(self.pareja_b):
            raise ValueError("Un mismo jugador no puede estar en ambas parejas.")
        return self


class PartidoResultado(PartidoResultadoCreate):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    reta_id: str
    # "A" gana, "B" gana, "EMPATE" o "E" → tabla individual los maneja como empate
    ganador: Literal["A", "B", "EMPATE", "E"] = "A"
    partido_jugado: bool = True  # flag explícito — false si admin lo "des-cierra"
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
    nombre: NombreStr
    telefono: PhoneStr
    success_url: Optional[str] = None  # URL absoluta a la que volver tras pago OK
    cancel_url: Optional[str] = None
    # Soporte parejas (Fase 2) — opcionales para retrocompat.
    pareja_nombre: Optional[NombreStr] = None
    pareja_telefono: Optional[PhoneStr] = None
    es_free_agent: bool = False

    @model_validator(mode="after")
    def _coherencia_pareja_stripe(self) -> "StripeCheckoutCreate":
        if self.es_free_agent and (self.pareja_nombre or self.pareja_telefono):
            raise ValueError("'es_free_agent' no admite datos de pareja.")
        if bool(self.pareja_nombre) ^ bool(self.pareja_telefono):
            raise ValueError("Debes proporcionar nombre Y teléfono de la pareja, o ninguno.")
        if self.pareja_nombre:
            object.__setattr__(self, "pareja_nombre", self.pareja_nombre.strip())
        return self


class StripeCheckoutResponse(BaseModel):
    inscripcion_id: str
    checkout_url: str
    session_id: str
    monto_total: Optional[float] = None  # Total cobrado (x2 si es dúo).
    cupos_reservados: Optional[int] = None  # 1 o 2 según modalidad.


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
