"""Tests exhaustivos del motor de fixtures (Fase D — Auditoría Matemática).

Cubre:
  • Regla A — igualdad de partidos (mandatoria).
  • Regla B — no repetir parejas (suave, con badge si se rompe).
  • Regla C — no repetir rivales (más suave aún).
  • Disyuntor max_iterations: NO debe colgar el server con N o R extremos.
  • Modalidad individual y parejas fijas (incl. # impar de dúos).
  • Validador detecta correctamente violaciones.
  • Determinismo bajo seed fijo.
"""
from __future__ import annotations

import math
import time
import pytest

from core.fixture_engine import (
    FixtureIntegrityError,
    generar_fixture,
    generar_fixture_parejas,
    validar_reglas,
)


def _ppj(rol_canchas):
    """Cuenta partidos por jugador a partir de la estructura {cancha,rondas,partidos}."""
    cnt = {}
    for c in rol_canchas:
        for r in c["rondas"]:
            for p in r["partidos"]:
                for n in (*p["pareja_a"], *p["pareja_b"]):
                    cnt[n] = cnt.get(n, 0) + 1
    return cnt


def _parejas_set(rol_canchas):
    out = {}
    for c in rol_canchas:
        for r in c["rondas"]:
            for p in r["partidos"]:
                for pair in (p["pareja_a"], p["pareja_b"]):
                    k = tuple(sorted(pair))
                    out[k] = out.get(k, 0) + 1
    return out


def _rivales_set(rol_canchas):
    out = {}
    for c in rol_canchas:
        for r in c["rondas"]:
            for p in r["partidos"]:
                for a in p["pareja_a"]:
                    for b in p["pareja_b"]:
                        k = tuple(sorted((a, b)))
                        out[k] = out.get(k, 0) + 1
    return out


# =============================================================================
# 1. CASO RÁPIDO — N múltiplo de 4 (matrices estáticas)
# =============================================================================
class TestCasoRapido:
    """Para N=4,8,12,16,…,32 → algoritmo='estatico', metadata limpia."""

    def test_n4_perfecto(self):
        res = generar_fixture([f"J{i}" for i in range(1, 5)], num_rondas=3)
        assert res["metadata"]["algoritmo"] == "estatico"
        assert res["metadata"]["optimizacion_aplicada"] is False
        assert res["validacion"]["ok"]
        ppj = _ppj(res["rol"])
        assert len(set(ppj.values())) == 1  # todos juegan lo mismo
        assert all(v == 3 for v in ppj.values())
        # En n=4 con 3 rondas, cada par juega como pareja exactamente 1 vez.
        parejas = _parejas_set(res["rol"])
        assert all(v == 1 for v in parejas.values())

    def test_n8_perfecto(self):
        res = generar_fixture([f"J{i}" for i in range(1, 9)], num_rondas=7)
        assert res["metadata"]["algoritmo"] == "estatico"
        assert res["validacion"]["regla_a_ok"]
        ppj = _ppj(res["rol"])
        assert all(v == 7 for v in ppj.values())
        # Ninguna pareja se repite (matriz Whist).
        parejas = _parejas_set(res["rol"])
        assert all(v == 1 for v in parejas.values())
        # Cada par de jugadores son rivales exactamente 2 veces (combinatoria forzosa).
        rivales = _rivales_set(res["rol"])
        assert all(v == 2 for v in rivales.values())

    @pytest.mark.parametrize("N", [4, 8, 12, 16, 20, 24, 28, 32])
    def test_multiplos_de_4(self, N):
        rondas = 7 if N >= 8 else 3
        jugadores = [f"J{i}" for i in range(1, N + 1)]
        res = generar_fixture(jugadores, num_rondas=rondas)
        assert res["metadata"]["algoritmo"] == "estatico"
        assert res["validacion"]["regla_a_ok"], f"N={N} viola Regla A"


# =============================================================================
# 2. CASO CSP — N no múltiplo de 4
# =============================================================================
class TestCSP:

    @pytest.mark.parametrize("N,R", [(5, 5), (6, 3), (7, 7), (9, 9), (10, 5), (11, 11)])
    def test_n_impar_regla_a_es_invariante(self, N, R):
        jugadores = [f"J{i}" for i in range(1, N + 1)]
        res = generar_fixture(jugadores, num_rondas=R, max_iterations=500)
        # Regla A es absoluta — el delta debe ser ≤1.
        assert res["validacion"]["regla_a_ok"], (
            f"N={N},R={R}: Regla A violada {res['validacion']['errores']}"
        )
        assert res["validacion"]["delta_max"] <= 1
        # Si N no es múltiplo de 4 → algoritmo CSP (degradado o no).
        assert res["metadata"]["algoritmo"].startswith("csp")

    def test_n6_optimizacion_aplicada(self):
        res = generar_fixture([f"J{i}" for i in range(1, 7)], num_rondas=3, seed=42)
        # N=6 con 3 rondas: cada ronda tiene 1 partido y 2 descansan.
        # Cada jugador juega R*4/6 = 2 partidos.
        ppj = _ppj(res["rol"])
        assert all(v == 2 for v in ppj.values()), ppj
        # Optimización aplicada SI hay repetición de rival O pareja.
        meta = res["metadata"]
        # En N=6, R=3 → 12 slots / 6 jugadores = 2 partidos cada uno: factible sin repetir parejas.
        # Pero rivales podrían repetirse. Verificamos coherencia entre metadata y validación.
        if meta["rivales_repetidos_extra"] > 0:
            assert meta["optimizacion_aplicada"]
            assert "optimizado" in meta["motivo"].lower()

    def test_n5_caso_extremo(self):
        """N=5 es matemáticamente muy restringido: 1 partido/ronda, 1 descanso."""
        res = generar_fixture([f"J{i}" for i in range(1, 6)], num_rondas=5, seed=7)
        ppj = _ppj(res["rol"])
        # Cada jugador debería jugar 4 partidos (5*4/5=4).
        assert all(v == 4 for v in ppj.values()), ppj
        assert res["metadata"]["optimizacion_aplicada"]


# =============================================================================
# 3. DISYUNTOR — no debe colgarse nunca
# =============================================================================
class TestDisyuntor:

    def test_max_iterations_bajo_no_se_cuelga(self):
        """Con max_iterations=20 (muy bajo), debe degradar a relax_level=2
        y devolver SIEMPRE un rol con Regla A (aunque sea con muchas concesiones)."""
        start = time.time()
        res = generar_fixture([f"J{i}" for i in range(1, 8)], num_rondas=7, max_iterations=20)
        elapsed = time.time() - start
        assert elapsed < 2.0, f"Demasiado lento: {elapsed:.2f}s"
        assert res["validacion"]["regla_a_ok"]

    def test_n_grande_no_cuelga(self):
        """N=11, R=11 con max_iterations=500 debe terminar rápido."""
        start = time.time()
        res = generar_fixture([f"J{i}" for i in range(1, 12)], num_rondas=11, max_iterations=500)
        elapsed = time.time() - start
        assert elapsed < 3.0, f"Demasiado lento: {elapsed:.2f}s"
        assert res["validacion"]["regla_a_ok"]


# =============================================================================
# 4. PAREJAS FIJAS — Round Robin de dúos
# =============================================================================
class TestParejasFijas:

    def test_d2_perfecto(self):
        res = generar_fixture_parejas([["A1", "A2"], ["B1", "B2"]], num_rondas=1)
        assert res["validacion"]["ok"]
        # 1 sola ronda con 1 partido.
        rondas = res["rol"][0]["rondas"]
        assert len(rondas) == 1
        assert len(rondas[0]["partidos"]) == 1

    def test_d4_perfecto(self):
        duos = [[f"P{i}A", f"P{i}B"] for i in range(1, 5)]
        res = generar_fixture_parejas(duos, num_rondas=3)
        assert res["metadata"]["algoritmo"] == "estatico"
        # Cada dúo debe jugar 3 partidos (RR perfecto).
        rondas = res["rol"][0]["rondas"]
        partidos_por_duo = {}
        for r in rondas:
            for p in r["partidos"]:
                for pair in (p["pareja_a"], p["pareja_b"]):
                    k = tuple(sorted(pair))
                    partidos_por_duo[k] = partidos_por_duo.get(k, 0) + 1
        assert all(v == 3 for v in partidos_por_duo.values())

    def test_d3_impar_circle_method(self):
        """3 dúos: cada ronda uno descansa rotativamente."""
        duos = [[f"P{i}A", f"P{i}B"] for i in range(1, 4)]
        res = generar_fixture_parejas(duos, num_rondas=3)
        assert res["metadata"]["algoritmo"] == "csp"
        assert res["metadata"]["optimizacion_aplicada"]
        assert "descanso rotativo" in res["metadata"]["motivo"].lower() or "optimizado" in res["metadata"]["motivo"].lower()
        # 3 rondas con 1 partido cada una (los otros 2 dúos juegan, 1 descansa).
        rondas = res["rol"][0]["rondas"]
        assert len(rondas) == 3
        for r in rondas:
            assert len(r["partidos"]) == 1


# =============================================================================
# 5. VALIDADOR — detecta correctamente violaciones
# =============================================================================
class TestValidador:

    def test_validador_detecta_jugador_doble(self):
        # Ronda inválida: jugador 1 aparece dos veces.
        rondas_mal = [[((1, 2), (1, 3))]]
        report = validar_reglas(rondas_mal, N=4)
        assert not report.ok
        assert any("aparece 2 veces" in e for e in report.errores)

    def test_validador_acepta_perfecto(self):
        # Round Robin perfecto n=4, 3 rondas.
        # NOTA: en n=4 con 3 rondas, cada par de jugadores es rival
        # exactamente 2 veces (matemáticamente forzoso: cada uno juega 3
        # partidos contra 2 rivales = 6 enfrentamientos, hay 3 otros
        # jugadores → cada par se enfrenta 2 veces). Esto es la SOLUCIÓN
        # óptima — el validador lo reporta como advertencia, no error.
        rondas = [
            [((1, 2), (3, 4))],
            [((1, 3), (2, 4))],
            [((1, 4), (2, 3))],
        ]
        report = validar_reglas(rondas, N=4)
        assert report.regla_a_ok   # Regla A perfecta
        assert report.regla_b_ok   # Sin parejas repetidas
        # Regla C reporta repetidos extra (forzoso combinatoriamente)
        assert not report.regla_c_ok
        assert report.delta_max == 0
        assert report.ok           # ok=True porque regla A pasa


# =============================================================================
# 6. DETERMINISMO — mismo seed → mismo resultado
# =============================================================================
class TestDeterminismo:

    def test_csp_es_deterministico(self):
        jug = [f"J{i}" for i in range(1, 7)]
        a = generar_fixture(jug, num_rondas=3, seed=123)
        b = generar_fixture(jug, num_rondas=3, seed=123)
        assert a["rol"] == b["rol"]


# =============================================================================
# 7. ROBUSTEZ DE INPUTS
# =============================================================================
class TestInputsInvalidos:

    def test_menos_de_4_jugadores(self):
        with pytest.raises(ValueError):
            generar_fixture(["A", "B", "C"], num_rondas=3)

    def test_rondas_cero(self):
        with pytest.raises(ValueError):
            generar_fixture([f"J{i}" for i in range(1, 9)], num_rondas=0)

    def test_duos_invalidos(self):
        with pytest.raises(ValueError):
            generar_fixture_parejas([["solo"]], num_rondas=1)

    def test_un_solo_duo(self):
        with pytest.raises(ValueError):
            generar_fixture_parejas([["A", "B"]], num_rondas=1)
