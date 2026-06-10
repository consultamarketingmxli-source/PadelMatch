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


# -----------------------------------------------------------------------------
# Round Robin Americano perfecto para 4 jugadores (1 cancha).
# 3 rondas, 3 partidos en total. Cada jugador es pareja una vez con cada otro
# y rival contra los otros 2. Combinación clásica:
#   R1: (1,2) vs (3,4)
#   R2: (1,3) vs (2,4)
#   R3: (1,4) vs (2,3)
# -----------------------------------------------------------------------------
ROUND_ROBIN_4_PERFECTO: List[List[Tuple[Tuple[int, int], Tuple[int, int]]]] = [
    [((1, 2), (3, 4))],
    [((1, 3), (2, 4))],
    [((1, 4), (2, 3))],
]


def generar_rol_filtrado_4_jugadores(
    jugadores: List[str],
    num_rondas: int = 3,
) -> List[Dict]:
    """Rol Round Robin Americano perfecto para 4 jugadores en 1 cancha.
    Soporta num_rondas 1..3. Si se piden más rondas las recicla en ciclo.
    """
    if len(jugadores) != 4:
        raise ValueError(f"Se requieren exactamente 4 jugadores, recibidos: {len(jugadores)}")
    if num_rondas < 1:
        raise ValueError("num_rondas debe ser >= 1")

    rol = []
    for idx in range(num_rondas):
        ronda = ROUND_ROBIN_4_PERFECTO[idx % 3]
        partidos = []
        for (pA, pB) in ronda:
            partidos.append({
                "pareja_a": [jugadores[pA[0] - 1], jugadores[pA[1] - 1]],
                "pareja_b": [jugadores[pB[0] - 1], jugadores[pB[1] - 1]],
            })
        rol.append({"ronda": idx + 1, "partidos": partidos})
    return rol


def generar_rol_con_descansos(
    jugadores: List[str],
    canchas: int,
    num_rondas: int = 7,
) -> List[Dict]:
    """Fase 7 — Wrapper que permite N de jugadores NO múltiplo de 4.

    Estrategia: rellenamos con slots "BYE #i" hasta llegar al siguiente
    múltiplo de 4 (capacidad mínima soportada por el engine subyacente).
    Los partidos donde aparece un BYE se marcan con `descanso=True` y
    NO cuentan para stats (los nombres BYE_n no son usuarios reales).

    Capacidad efectiva máxima: 32 (después de padding). Si N + padding > 32,
    lanzamos error como antes.

    Ejemplos:
        N=5  → padding 3 → grupo de 8 con 3 BYE; cada ronda hay BYEs
        N=9  → padding 3 → 1 cancha de 8 + 1 cancha de 4
        N=13 → padding 3 → 2 canchas de 8
    """
    n = len(jugadores)
    if n < 4:
        raise ValueError(f"Mínimo 4 jugadores (recibidos {n}).")
    needed = ((n + 3) // 4) * 4  # round up to next multiple of 4
    if needed > 32:
        raise ValueError(
            f"Demasiados jugadores ({n}). Capacidad máxima: 32.",
        )
    padded = list(jugadores)
    while len(padded) < needed:
        padded.append(f"BYE {len(padded) - n + 1}")
    rol = generar_rol_multi_cancha(padded, canchas, num_rondas)
    # Anota descanso=true a cualquier partido con BYE en pareja_a/b. El frontend
    # puede ocultarlos o mostrarlos como "Descanso" según prefiera el organizador.
    for cancha_data in rol:
        for ronda in cancha_data.get("rondas", []):
            for partido in ronda.get("partidos", []):
                pareja_a = partido.get("pareja_a") or []
                pareja_b = partido.get("pareja_b") or []
                if any(p.startswith("BYE") for p in pareja_a + pareja_b):
                    partido["descanso"] = True
    return rol


def generar_rol_multi_cancha(
    jugadores: List[str],
    canchas: int,
    num_rondas: int = 7,
) -> List[Dict]:
    """
    Generador ELÁSTICO de rol para capacidades múltiplo de 4.

    Estrategia: se asignan grupos a cada cancha tratando de maximizar grupos
    de 8 (rotación clásica de 7 rondas). El remanente de 4 jugadores —si lo
    hay— se asigna a la última cancha con la rotación americana de 3 rondas.

    Combinaciones soportadas (N = len(jugadores)):
        N=4   -> 1 cancha de 4    (3 rondas)
        N=8   -> 1 cancha de 8    (5..7 rondas)
        N=12  -> 1 cancha de 8 + 1 cancha de 4
        N=16  -> 2 canchas de 8
        N=20  -> 2 canchas de 8 + 1 cancha de 4
        N=24  -> 3 canchas de 8
        N=28  -> 3 canchas de 8 + 1 cancha de 4
        N=32  -> 4 canchas de 8

    El argumento `canchas` se ignora si el N no es coherente; el sistema
    siempre intenta la asignación óptima.
    """
    n = len(jugadores)
    if n < 4 or n > 32 or n % 4 != 0:
        raise ValueError(
            f"Capacidad inválida ({n}). Usa múltiplos de 4 entre 4 y 32."
        )

    grupos_8 = n // 8
    grupos_4 = (n % 8) // 4  # 0 o 1

    resultado: List[Dict] = []
    idx = 0
    cancha_num = 1

    # Asignar grupos de 8 primero
    for _ in range(grupos_8):
        grupo = jugadores[idx:idx + 8]
        rol = generar_rol_filtrado_8_jugadores(grupo, num_rondas=num_rondas)
        resultado.append({"cancha": cancha_num, "rondas": rol})
        idx += 8
        cancha_num += 1

    # Asignar grupo de 4 (si quedó remanente)
    for _ in range(grupos_4):
        grupo = jugadores[idx:idx + 4]
        # Para mini-grupo de 4, generamos hasta 3 rondas (americano clásico).
        rondas_4 = min(num_rondas, 3)
        rol = generar_rol_filtrado_4_jugadores(grupo, num_rondas=rondas_4)
        resultado.append({"cancha": cancha_num, "rondas": rol})
        idx += 4
        cancha_num += 1

    return resultado


# =============================================================================
# Round Robin de PAREJAS FIJAS (Fase 3 — Retas de Parejas).
# =============================================================================
# Para retas de parejas, los dúos son la UNIDAD competitiva: cada partido
# enfrenta a 2 dúos completos (4 jugadores ya pre-agrupados).
#
# Matriz canónica para 4 dúos en 3 rondas (cada dúo juega contra los otros 3):
#   R1: D1 vs D2, D3 vs D4
#   R2: D1 vs D3, D2 vs D4
#   R3: D1 vs D4, D2 vs D3
# -----------------------------------------------------------------------------
ROUND_ROBIN_4_DUOS: List[List[Tuple[int, int]]] = [
    [(1, 2), (3, 4)],
    [(1, 3), (2, 4)],
    [(1, 4), (2, 3)],
]

# Para 2 dúos: solo hay 1 enfrentamiento posible. Si se piden más rondas
# se repiten (rematch).
ROUND_ROBIN_2_DUOS: List[List[Tuple[int, int]]] = [
    [(1, 2)],
]


def generar_rol_filtrado_4_duos(
    duos: List[List[str]],
    num_rondas: int = 3,
) -> List[Dict]:
    """Rol Round Robin para 4 dúos (8 jugadores) en 1 cancha.

    Args:
        duos: lista de 4 dúos. Cada dúo es [nombreA, nombreB].
        num_rondas: cuántas rondas generar. Por defecto 3 (todos vs todos).
            Si se piden más, se ciclan en orden.

    Retorna lista de rondas con `partidos` (pareja_a, pareja_b).
    """
    if len(duos) != 4:
        raise ValueError(f"Se requieren exactamente 4 dúos, recibidos: {len(duos)}")
    if not all(len(d) == 2 for d in duos):
        raise ValueError("Cada dúo debe tener exactamente 2 jugadores.")
    if num_rondas < 1:
        raise ValueError("num_rondas debe ser >= 1")

    rol = []
    for idx in range(num_rondas):
        ronda_def = ROUND_ROBIN_4_DUOS[idx % 3]
        partidos = []
        for (a, b) in ronda_def:
            partidos.append({
                "pareja_a": list(duos[a - 1]),
                "pareja_b": list(duos[b - 1]),
            })
        rol.append({"ronda": idx + 1, "partidos": partidos})
    return rol


def generar_rol_filtrado_2_duos(
    duos: List[List[str]],
    num_rondas: int = 1,
) -> List[Dict]:
    """Rol para 2 dúos (4 jugadores) — solo 1 enfrentamiento posible.
    Si num_rondas > 1, se hacen rematches (D1 vs D2 repetido)."""
    if len(duos) != 2:
        raise ValueError(f"Se requieren exactamente 2 dúos, recibidos: {len(duos)}")
    rol = []
    for idx in range(max(1, num_rondas)):
        rol.append({"ronda": idx + 1, "partidos": [{
            "pareja_a": list(duos[0]),
            "pareja_b": list(duos[1]),
        }]})
    return rol


def generar_rol_multi_cancha_parejas(
    duos: List[List[str]],
    canchas: int,
    num_rondas: int = 3,
) -> List[Dict]:
    """Generador de rol Round Robin ELÁSTICO para PAREJAS FIJAS.

    Asignación a canchas:
      • Bloques de 4 dúos → 1 cancha de 8 jugadores (3 rondas RR perfecto).
      • Bloque remanente de 2 dúos → 1 cancha de 4 jugadores (1+ rematches).

    Combinaciones soportadas (D = #duos):
        D=2  -> 1 cancha de 4    (1+ rondas con rematch)
        D=4  -> 1 cancha de 8    (3 rondas perfectas)
        D=6  -> 1 cancha de 8 + 1 cancha de 4
        D=8  -> 2 canchas de 8
        ...

    Args:
        duos: lista de N dúos (cada uno = [nombreA, nombreB]).
        canchas: hint informativo (se ignora; se recalcula).
        num_rondas: 1..7. Default 3 (RR perfecto de 4 dúos).

    Retorna estructura idéntica a `generar_rol_multi_cancha`:
        [{"cancha": int, "rondas": [{ronda, partidos: [...]}, ...]}, ...]
    """
    n = len(duos)
    if n < 2:
        raise ValueError(f"Se requieren al menos 2 dúos para una reta de parejas (recibidos: {n}).")

    grupos_4d = n // 4   # cuántos bloques de 4 dúos
    grupos_2d = (n % 4) // 2  # 0 o 1 bloque de 2 dúos remanente
    sobrantes = n - (grupos_4d * 4 + grupos_2d * 2)
    if sobrantes != 0:
        raise ValueError(
            f"Número de dúos inválido ({n}). Usa cantidades pares (2, 4, 6, 8, ...)."
        )

    resultado: List[Dict] = []
    idx = 0
    cancha_num = 1

    # Asignar bloques de 4 dúos primero (cancha de 8 jugadores).
    for _ in range(grupos_4d):
        bloque = duos[idx:idx + 4]
        rondas_4d = min(max(num_rondas, 1), 7)
        rol = generar_rol_filtrado_4_duos(bloque, num_rondas=rondas_4d)
        resultado.append({"cancha": cancha_num, "rondas": rol})
        idx += 4
        cancha_num += 1

    # Asignar bloque de 2 dúos remanente (cancha de 4 jugadores).
    for _ in range(grupos_2d):
        bloque = duos[idx:idx + 2]
        # Para 2 dúos solo hay 1 partido posible — toleramos rematches.
        rondas_2d = min(max(num_rondas, 1), 3)
        rol = generar_rol_filtrado_2_duos(bloque, num_rondas=rondas_2d)
        resultado.append({"cancha": cancha_num, "rondas": rol})
        idx += 2
        cancha_num += 1

    return resultado
