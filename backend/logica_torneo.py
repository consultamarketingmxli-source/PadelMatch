"""
Motor lógico y algoritmo Round Robin para PadelappRetas OS.
Funciones puras, sin dependencias externas más allá de stdlib.
"""
from datetime import datetime, timedelta, timezone
import math
from typing import List, Tuple, Dict


def construir_fecha_local_iso(fecha_str: str, hora_str: str, tz_offset_minutes: int = 0) -> str:
    """
    Combina inputs locales de fecha (YYYY-MM-DD) y hora (HH:mm) respetando el huso
    horario nativo del cliente para mitigar el clásico error de desfase de días por
    conversión estricta a UTC.

    tz_offset_minutes: offset del cliente respecto a UTC (ej. CDMX = -360).
    Retorna un ISO 8601 con offset explícito.
    """
    year, month, day = (int(x) for x in fecha_str.split("-"))
    hour, minute = (int(x) for x in hora_str.split(":"))

    # Construimos en una zona explícita usando el offset del cliente.
    tz = timezone(timedelta(minutes=tz_offset_minutes))
    dt = datetime(year, month, day, hour, minute, 0, tzinfo=tz)
    return dt.isoformat()


def obtener_distancia_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """
    Fórmula de Haversine. Calcula la distancia lineal en KILÓMETROS entre dos puntos
    GPS (latitud/longitud en grados).
    """
    R = 6371.0  # Radio medio de la Tierra en km
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)

    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return R * c


# -----------------------------------------------------------------------------
# Round Robin Individual perfecto para 8 jugadores por cancha.
# Matriz de rotación estricta de 7 rondas:
#   - Ningún jugador repite pareja.
#   - Todos los jugadores juegan contra todos exactamente 2 veces como rivales.
#   - Todos juegan la misma cantidad de partidos.
# Fuente: tabla de rotación clásica para Round Robin Americano de 8 jugadores.
# Cada ronda contiene 2 partidos: (parejaA vs parejaB) y (parejaC vs parejaD).
# -----------------------------------------------------------------------------

ROUND_ROBIN_8_PERFECTO: List[List[Tuple[Tuple[int, int], Tuple[int, int]]]] = [
    # Validado: 1-factorization (cada par pareja exactamente 1) +
    # cada par rival exactamente 2 veces. Wh(8) tournament.
    [((1, 2), (3, 4)), ((5, 6), (7, 8))],
    [((1, 5), (2, 6)), ((3, 7), (4, 8))],
    [((1, 7), (2, 8)), ((3, 5), (4, 6))],
    [((1, 3), (5, 7)), ((2, 4), (6, 8))],
    [((1, 6), (3, 8)), ((2, 5), (4, 7))],
    [((1, 8), (4, 5)), ((2, 7), (3, 6))],
    [((1, 4), (6, 7)), ((2, 3), (5, 8))],
]


def _construir_whist_8_runtime():
    """Backtracking en runtime (sólo usado para tests/verificación)."""
    from itertools import combinations
    todas = [tuple(sorted(p)) for p in combinations(range(1, 9), 2)]
    partner_used = set()
    rival_count = {p: 0 for p in todas}
    rondas = []

    def enumerar(jug):
        out = []
        smallest = jug[0]
        rest = jug[1:]
        for trio in combinations(rest, 3):
            m1 = sorted([smallest] + list(trio))
            otros = [p for p in jug if p not in m1]
            mp1 = m1[0]
            for pmp1 in m1[1:]:
                pA = tuple(sorted((mp1, pmp1)))
                pB = tuple(sorted([p for p in m1 if p not in (mp1, pmp1)]))
                mp2 = otros[0]
                for pmp2 in otros[1:]:
                    pC = tuple(sorted((mp2, pmp2)))
                    pD = tuple(sorted([p for p in otros if p not in (mp2, pmp2)]))
                    out.append(((pA, pB), (pC, pD)))
        return out

    todos_matches = enumerar(list(range(1, 9)))

    def bt(idx):
        if idx == 7:
            return len(partner_used) == 28 and all(v == 2 for v in rival_count.values())
        for r in todos_matches:
            (a1, a2), (b1, b2) = r
            new_p = [a1, a2, b1, b2]
            if any(p in partner_used for p in new_p):
                continue
            new_r = []
            for pA, pB in ((a1, a2), (b1, b2)):
                for x in pA:
                    for y in pB:
                        new_r.append(tuple(sorted((x, y))))
            if any(rival_count[rr] + new_r.count(rr) > 2 for rr in set(new_r)):
                continue
            for p in new_p:
                partner_used.add(p)
            for rr in new_r:
                rival_count[rr] += 1
            rondas.append(((a1, a2), (b1, b2)))
            if bt(idx + 1):
                return True
            rondas.pop()
            for p in new_p:
                partner_used.discard(p)
            for rr in new_r:
                rival_count[rr] -= 1
        return False

    bt(0)
    return rondas


def _validar_rotacion():
    """Validador interno (solo invocado en tests) que verifica las propiedades."""
    parejas = set()
    rivales = {}  # par ordenado -> count
    apariciones = {i: 0 for i in range(1, 9)}
    for ronda in ROUND_ROBIN_8_PERFECTO:
        for (pA, pB) in ronda:
            # No repetir parejas
            kA = tuple(sorted(pA))
            kB = tuple(sorted(pB))
            assert kA not in parejas, f"Pareja repetida: {kA}"
            assert kB not in parejas, f"Pareja repetida: {kB}"
            parejas.add(kA)
            parejas.add(kB)
            for j in pA + pB:
                apariciones[j] += 1
            # rivales: cada miembro de pA contra cada miembro de pB
            for a in pA:
                for b in pB:
                    k = tuple(sorted((a, b)))
                    rivales[k] = rivales.get(k, 0) + 1
    # Cada jugador debe aparecer 7 veces (1 por ronda)
    assert all(v == 7 for v in apariciones.values()), apariciones
    # Cada par de jugadores debe ser rival exactamente 2 veces
    pares_posibles = [(i, j) for i in range(1, 9) for j in range(i + 1, 9)]
    for p in pares_posibles:
        assert rivales.get(p, 0) == 2, (p, rivales.get(p, 0))


def generar_rol_filtrado_8_jugadores(
    jugadores: List[str],
    num_rondas: int = 7,
) -> List[Dict]:
    """
    Genera el rol Round Robin para 8 jugadores por cancha.

    Args:
        jugadores: lista exacta de 8 nombres (posiciones 1..8).
        num_rondas: 5, 6 o 7. Garantiza por código una experiencia mínima de
            al menos 5 partidos (lanza error si <5).

    Retorna lista de rondas. Cada ronda es:
        {
          "ronda": int,
          "partidos": [
              {"pareja_a": [n1, n2], "pareja_b": [n3, n4]},
              {"pareja_a": [n5, n6], "pareja_b": [n7, n8]},
          ]
        }
    """
    if len(jugadores) != 8:
        raise ValueError(f"Se requieren exactamente 8 jugadores, recibidos: {len(jugadores)}")
    if num_rondas not in (5, 6, 7):
        raise ValueError("num_rondas debe ser 5, 6 o 7")
    if num_rondas < 5:
        raise ValueError("La experiencia mínima del jugador debe ser de al menos 5 partidos")

    rondas_truncadas = ROUND_ROBIN_8_PERFECTO[:num_rondas]
    rol = []
    for idx, ronda in enumerate(rondas_truncadas, start=1):
        partidos = []
        for (pA, pB) in ronda:
            partidos.append({
                "pareja_a": [jugadores[pA[0] - 1], jugadores[pA[1] - 1]],
                "pareja_b": [jugadores[pB[0] - 1], jugadores[pB[1] - 1]],
            })
        rol.append({"ronda": idx, "partidos": partidos})
    return rol


def generar_rol_multi_cancha(
    jugadores: List[str],
    canchas: int,
    num_rondas: int = 7,
) -> List[Dict]:
    """
    Para torneos con más de 8 jugadores. Particiona en grupos de 8 (uno por cancha)
    y genera el rol Round Robin independiente para cada cancha.
    """
    if len(jugadores) != canchas * 8:
        raise ValueError(
            f"Para {canchas} cancha(s) se requieren exactamente {canchas * 8} jugadores"
        )
    resultado = []
    for c in range(canchas):
        grupo = jugadores[c * 8:(c + 1) * 8]
        rol = generar_rol_filtrado_8_jugadores(grupo, num_rondas)
        resultado.append({"cancha": c + 1, "rondas": rol})
    return resultado
