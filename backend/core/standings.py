"""
Tabla de Clasificación Individual (Fase C — Mesa de Control).

Función pura `compute_individual_standings(resultados, ordenar=True, criterio="A")` que dada
una lista de documentos de la colección `resultados`, agrega las estadísticas
por jugador y devuelve la lista ordenada bajo el criterio cascada solicitado:

    1º  Más Partidos Ganados (PG)       (desc)
    2º+ Criterio de desempate configurado en la reta (A / B / C). Ver `Fase 3`.

Fase 3 — Tie-breaker engine (Sección 4):
    El organizador elige al crear la reta cómo desempatar a jugadores con el
    mismo PG. Tres opciones (mismo nombre que el frontend):

    A · Puntos netos individuales — `diferencia` (GF − GC), luego GF, luego nombre.
        (Comportamiento histórico, default.)
    B · Puntos netos por pareja — diferencia "neta cruda" sin segundo nivel GF,
        usando solo la métrica de net y aceptando empates exactos antes del
        nombre. Para retas Americano (parejas rotativas) genera mismos rankings
        que A; para retas de dúos fijos se comporta como compute_duo_standings.
    C · Rendimiento técnico — Ratio GF/GC descendente. Cuando GC=0 (jugador
        invicto en parciales) se considera ∞ (ranking más alto).

Reglas de empate técnico (TIEMPO o resultado idéntico):
    - 1 PJ a cada jugador
    - 0 PG, 0 PP, 1 PE
    - Suma GF/GC normal; DG = 0 cuando score_a == score_b.

Diseño:
    - Función pura (sin db) → testeable con datos sintéticos.
    - O(n + k log k) donde n = #resultados, k = #jugadores distintos.
    - El campo `puntos` se conserva por compat (3 win / 1 empate / 0 derrota),
      pero el ORDENAMIENTO PRINCIPAL ahora es PG→{criterio A/B/C}.
"""
from __future__ import annotations

from typing import Iterable, List, Literal

from models import TablaPosicionEntry

CriterioDesempate = Literal["A", "B", "C"]

# Letras canónicas de `ganador` que aceptamos. EMPATE se acepta también en
# modo PUNTOS (raro pero el backend es elástico).
_VALID_GANADOR = {"A", "B", "E", "EMPATE"}


def _ratio_gf_gc(e: TablaPosicionEntry) -> float:
    """Ratio GF/GC, con GC=0 → ∞ (top). Defensa: si GF=GC=0 → 0.0 (bottom)."""
    if e.juegos_en_contra > 0:
        return e.juegos_a_favor / e.juegos_en_contra
    if e.juegos_a_favor > 0:
        return float("inf")
    return 0.0


def _sort_key(e: TablaPosicionEntry, criterio: CriterioDesempate):
    """Construye el sort key Python según el criterio elegido.

    Primer nivel SIEMPRE es PG (descendente). El resto cambia.
    """
    pg = -e.partidos_ganados
    if criterio == "A":
        return (pg, -e.diferencia, -e.juegos_a_favor, e.nombre.lower())
    if criterio == "B":
        # "Neto crudo": solo diferencia, sin segundo nivel GF.
        return (pg, -e.diferencia, e.nombre.lower())
    # criterio == "C" — Rendimiento técnico (ratio GF/GC).
    return (pg, -_ratio_gf_gc(e), -e.diferencia, e.nombre.lower())


def _add(stats: dict[str, TablaPosicionEntry], name: str) -> TablaPosicionEntry:
    if name not in stats:
        stats[name] = TablaPosicionEntry(nombre=name)
    return stats[name]


def _is_empate(ganador: str, score_a: int, score_b: int) -> bool:
    if ganador in ("E", "EMPATE"):
        return True
    # Defensa: si vino mal el campo `ganador` pero los scores son idénticos,
    # tratamos como empate para no contar PG erróneo.
    return score_a == score_b


def compute_individual_standings(
    resultados: Iterable[dict],
    ordenar: bool = True,
    criterio: CriterioDesempate = "A",
) -> List[TablaPosicionEntry]:
    """Calcula la tabla individual desde resultados.

    Args:
        resultados: iterable de docs `{pareja_a, pareja_b, score_a, score_b, ganador, ...}`.
        ordenar: si False devuelve sin ordenar (útil en tests).
        criterio: A/B/C — Fase 3 tie-breaker. Default "A" mantiene comportamiento histórico.

    Returns:
        Lista de TablaPosicionEntry ordenada cascada PG→{criterio A/B/C}→nombre.
    """
    stats: dict[str, TablaPosicionEntry] = {}

    for r in resultados:
        # Validaciones defensivas para no romper si alguien metió basura.
        pareja_a = r.get("pareja_a") or []
        pareja_b = r.get("pareja_b") or []
        if len(pareja_a) != 2 or len(pareja_b) != 2:
            continue
        try:
            score_a = int(r.get("score_a", 0))
            score_b = int(r.get("score_b", 0))
        except (TypeError, ValueError):
            continue
        ganador = r.get("ganador", "")
        empate = _is_empate(ganador, score_a, score_b)

        for n in pareja_a:
            e = _add(stats, n)
            e.partidos_jugados += 1
            e.juegos_a_favor += score_a
            e.juegos_en_contra += score_b
            if empate:
                e.partidos_empatados += 1
                e.puntos += 1
            elif ganador == "A" or (ganador not in _VALID_GANADOR and score_a > score_b):
                e.partidos_ganados += 1
                e.puntos += 3
            else:
                e.partidos_perdidos += 1
        for n in pareja_b:
            e = _add(stats, n)
            e.partidos_jugados += 1
            e.juegos_a_favor += score_b
            e.juegos_en_contra += score_a
            if empate:
                e.partidos_empatados += 1
                e.puntos += 1
            elif ganador == "B" or (ganador not in _VALID_GANADOR and score_b > score_a):
                e.partidos_ganados += 1
                e.puntos += 3
            else:
                e.partidos_perdidos += 1

    # Cálculos derivados
    for e in stats.values():
        e.diferencia = e.juegos_a_favor - e.juegos_en_contra
        e.efectividad = (
            round(e.partidos_ganados / e.partidos_jugados * 100, 1)
            if e.partidos_jugados else 0.0
        )

    if not ordenar:
        return list(stats.values())

    # Cascada estricta: PG desc → criterio A/B/C → nombre asc.
    # Python sort es estable → siempre devuelve mismo orden ante ties exactos.
    return sorted(stats.values(), key=lambda e: _sort_key(e, criterio))


# =============================================================================
# Tabla de Clasificación por DÚOS FIJOS (Fase 3 — Retas de Parejas).
# =============================================================================
def compute_duo_standings(
    resultados: Iterable[dict],
    ordenar: bool = True,
    criterio: CriterioDesempate = "A",
) -> List[TablaPosicionEntry]:
    """Calcula la tabla agrupando por dúo FIJO.

    Cada partido es un enfrentamiento dúo vs dúo. Acumulamos PG/PE/PP/GF/GC
    a nivel de dúo. El `nombre` resultante es "JugadorA & JugadorB"
    (ordenado alfabéticamente para que la misma pareja produzca SIEMPRE
    el mismo key independientemente de cómo lleguen pareja_a/pareja_b).

    Args:
        resultados: iterable de docs con pareja_a/pareja_b/score_a/score_b/ganador.
        ordenar: si False, devuelve sin orden (útil en tests).
        criterio: A/B/C — Fase 3 tie-breaker. Default "A".

    Returns:
        Lista de TablaPosicionEntry. Una fila POR dúo (no por jugador).
    """
    stats: dict[tuple, TablaPosicionEntry] = {}

    def _duo_key(par: list) -> tuple:
        return tuple(sorted([str(n).strip() for n in par if str(n).strip()]))

    def _duo_name(par: list) -> str:
        return " & ".join(_duo_key(par))

    for r in resultados:
        pareja_a = r.get("pareja_a") or []
        pareja_b = r.get("pareja_b") or []
        if len(pareja_a) != 2 or len(pareja_b) != 2:
            continue
        try:
            score_a = int(r.get("score_a", 0))
            score_b = int(r.get("score_b", 0))
        except (TypeError, ValueError):
            continue
        ganador = r.get("ganador", "")
        empate = _is_empate(ganador, score_a, score_b)

        ka = _duo_key(pareja_a)
        kb = _duo_key(pareja_b)

        if ka not in stats:
            stats[ka] = TablaPosicionEntry(nombre=_duo_name(pareja_a))
        if kb not in stats:
            stats[kb] = TablaPosicionEntry(nombre=_duo_name(pareja_b))

        ea = stats[ka]
        eb = stats[kb]
        ea.partidos_jugados += 1
        eb.partidos_jugados += 1
        ea.juegos_a_favor += score_a
        ea.juegos_en_contra += score_b
        eb.juegos_a_favor += score_b
        eb.juegos_en_contra += score_a

        if empate:
            ea.partidos_empatados += 1
            eb.partidos_empatados += 1
            ea.puntos += 1
            eb.puntos += 1
        elif ganador == "A" or (ganador not in _VALID_GANADOR and score_a > score_b):
            ea.partidos_ganados += 1
            ea.puntos += 3
            eb.partidos_perdidos += 1
        else:
            eb.partidos_ganados += 1
            eb.puntos += 3
            ea.partidos_perdidos += 1

    for e in stats.values():
        e.diferencia = e.juegos_a_favor - e.juegos_en_contra
        e.efectividad = (
            round(e.partidos_ganados / e.partidos_jugados * 100, 1)
            if e.partidos_jugados else 0.0
        )

    if not ordenar:
        return list(stats.values())

    return sorted(stats.values(), key=lambda e: _sort_key(e, criterio))
