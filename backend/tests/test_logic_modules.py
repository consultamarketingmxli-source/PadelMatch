"""Unit tests for pure logic modules (Round Robin + Haversine)."""
import pytest

from logica_torneo import (
    ROUND_ROBIN_8_PERFECTO,
    _validar_rotacion,
    construir_fecha_local_iso,
    generar_rol_filtrado_8_jugadores,
    obtener_distancia_km,
)


# --- Round Robin invariants ---
def test_validar_rotacion_no_raises():
    _validar_rotacion()


def test_round_robin_table_has_7_rondas():
    assert len(ROUND_ROBIN_8_PERFECTO) == 7


@pytest.mark.parametrize("num_rondas", [5, 6, 7])
def test_generar_rol_filtrado(num_rondas):
    jugadores = [f"J{i}" for i in range(1, 9)]
    rol = generar_rol_filtrado_8_jugadores(jugadores, num_rondas=num_rondas)
    assert len(rol) == num_rondas
    for ronda in rol:
        assert len(ronda["partidos"]) == 2
        usados = set()
        for p in ronda["partidos"]:
            assert len(p["pareja_a"]) == 2 and len(p["pareja_b"]) == 2
            for n in p["pareja_a"] + p["pareja_b"]:
                assert n not in usados
                usados.add(n)
        assert len(usados) == 8


def test_generar_rol_rechaza_jugadores_incorrectos():
    with pytest.raises(ValueError):
        generar_rol_filtrado_8_jugadores(["A"] * 7, num_rondas=5)


def test_generar_rol_rechaza_rondas_invalidas():
    with pytest.raises(ValueError):
        generar_rol_filtrado_8_jugadores([f"J{i}" for i in range(8)], num_rondas=4)


# --- Haversine ---
def test_haversine_cdmx_aprox_10km():
    d = obtener_distancia_km(19.43, -99.13, 19.50, -99.20)
    # Expected ~ 10.2 km
    assert 9.0 < d < 11.5, f"Distance {d} not in expected ~10km range"


def test_haversine_zero_for_same_point():
    assert obtener_distancia_km(19.43, -99.13, 19.43, -99.13) < 0.001


# --- Fecha ISO ---
def test_construir_fecha_local_iso_offset_cdmx():
    iso = construir_fecha_local_iso("2026-02-15", "18:30", -360)
    assert iso.startswith("2026-02-15T18:30:00")
    assert "-06:00" in iso
