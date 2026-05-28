"""
Tabla de Clasificación Individual (Fase C — Mesa de Control).

Función pura `compute_individual_standings(resultados, ordenar=True)` que dada
una lista de documentos de la colección `resultados`, agrega las estadísticas
por jugador y devuelve la lista ordenada bajo el criterio cascada solicitado:

    1º  Más Partidos Ganados (PG)       (desc)
    2º  Mayor Diferencia de Puntos (DG)  (desc)
    3º  Más Puntos a Favor (GF)          (desc)
    4º  Nombre alfabético                (asc, estable)

Reglas de empate técnico (TIEMPO o resultado idéntico):
    - 1 PJ a cada jugador
    - 0 PG, 0 PP, 1 PE
    - Suma GF/GC normal; DG = 0 cuando score_a == score_b.

Diseño:
    - Función pura (sin db) → testeable con datos sintéticos.
    - O(n + k log k) donde n = #resultados, k = #jugadores distintos.
    - El campo `puntos` se conserva por compat (3 win / 1 empate / 0 derrota),
      pero el ORDENAMIENTO PRINCIPAL ahora es PG→DG→GF (no `puntos`).
"""
from __future__ import annotations

from typing import Iterable, List

from models import TablaPosicionEntry

# Letras canónicas de `ganador` que aceptamos. EMPATE se acepta también en
# modo PUNTOS (raro pero el backend es elástico).
_VALID_GANADOR = {"A", "B", "E", "EMPATE"}


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
) -> List[TablaPosicionEntry]:
    """Calcula la tabla individual desde resultados.

    Args:
        resultados: iterable de docs `{pareja_a, pareja_b, score_a, score_b, ganador, ...}`.
        ordenar: si False devuelve sin ordenar (útil en tests).

    Returns:
        Lista de TablaPosicionEntry ordenada cascada PG→DG→GF→nombre.
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

    # Cascada estricta: PG desc → DG desc → GF desc → nombre asc.
    # Python sort es estable → siempre devuelve mismo orden ante ties exactos.
    return sorted(
        stats.values(),
        key=lambda e: (-e.partidos_ganados, -e.diferencia, -e.juegos_a_favor, e.nombre.lower()),
    )


# =============================================================================
# Tabla de Clasificación por DÚOS FIJOS (Fase 3 — Retas de Parejas).
# =============================================================================
def compute_duo_standings(
    resultados: Iterable[dict],
    ordenar: bool = True,
) -> List[TablaPosicionEntry]:
    """Calcula la tabla agrupando por dúo FIJO.

    Cada partido es un enfrentamiento dúo vs dúo. Acumulamos PG/PE/PP/GF/GC
    a nivel de dúo. El `nombre` resultante es "JugadorA & JugadorB"
    (ordenado alfabéticamente para que la misma pareja produzca SIEMPRE
    el mismo key independientemente de cómo lleguen pareja_a/pareja_b).

    Args:
        resultados: iterable de docs con pareja_a/pareja_b/score_a/score_b/ganador.
        ordenar: si False, devuelve sin orden (útil en tests).

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

    return sorted(
        stats.values(),
        key=lambda e: (-e.partidos_ganados, -e.diferencia, -e.juegos_a_favor, e.nombre.lower()),
    )
