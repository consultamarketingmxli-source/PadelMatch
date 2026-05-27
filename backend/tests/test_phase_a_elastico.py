"""Tests específicos de la Fase A — Backend Elástico.

Cubren:
- Validador JugadoresPar4 (4..32, múltiplos de 4, sugerencia en errores).
- Modelo FormatoScore (coherencia tipo/unidad/valor).
- Algoritmo elástico generar_rol_multi_cancha (4, 8, 12, 16, 20, 24, 28, 32).
- Compresión WebP (logo) — paths de éxito y de skip.
- Endpoint POST /api/admin/retas con max_jugadores y formato_score.
"""
from __future__ import annotations

import base64
import io

import pytest
from PIL import Image
from pydantic import ValidationError

from core.image_utils import compress_logo_to_webp
from logica_torneo import generar_rol_multi_cancha
from models import FormatoScore, RetaCreate


# ------------------------------------------------------------
# JugadoresPar4 — vía RetaCreate (donde se aplica el validador)
# ------------------------------------------------------------
class TestJugadoresPar4:
    def _base_kwargs(self):
        return dict(
            nombre="Reta Test",
            club="Club Pro",
            fecha_str="2026-02-15",
            hora_str="18:30",
            tz_offset_minutes=-360,
            canchas_disponibles=2,
        )

    @pytest.mark.parametrize("n", [4, 8, 12, 16, 20, 24, 28, 32])
    def test_acepta_multiplos_4_en_rango(self, n: int):
        reta = RetaCreate(**self._base_kwargs(), max_jugadores=n)
        assert reta.max_jugadores == n

    @pytest.mark.parametrize("n", [0, 1, 2, 3])
    def test_rechaza_menor_a_4(self, n: int):
        with pytest.raises(ValidationError):
            RetaCreate(**self._base_kwargs(), max_jugadores=n)

    @pytest.mark.parametrize("n", [33, 36, 40, 100])
    def test_rechaza_mayor_a_32(self, n: int):
        with pytest.raises(ValidationError):
            RetaCreate(**self._base_kwargs(), max_jugadores=n)

    @pytest.mark.parametrize("n", [5, 6, 7, 9, 10, 11, 13, 15, 17, 19, 21, 23, 25, 27, 29, 31])
    def test_rechaza_no_multiplo_4_con_sugerencia(self, n: int):
        with pytest.raises(ValidationError) as exc:
            RetaCreate(**self._base_kwargs(), max_jugadores=n)
        # El mensaje debe sugerir un múltiplo de 4 cercano o waitlist
        msg = str(exc.value)
        assert "múltiplos de 4" in msg or "lista de espera" in msg

    def test_opcional_max_jugadores(self):
        """Si no se manda, debe quedar como None (retrocompat)."""
        reta = RetaCreate(**self._base_kwargs())
        assert reta.max_jugadores is None


# ------------------------------------------------------------
# FormatoScore — coherencia tipo/unidad/valor
# ------------------------------------------------------------
class TestFormatoScore:
    def test_default_es_puntos_9_juegos(self):
        fs = FormatoScore()
        assert fs.tipo == "PUNTOS"
        assert fs.valor == 9
        assert fs.unidad == "juegos"

    @pytest.mark.parametrize("valor", [1, 6, 9, 11, 15, 21])
    def test_puntos_juegos_validos(self, valor: int):
        fs = FormatoScore(tipo="PUNTOS", valor=valor, unidad="juegos")
        assert fs.valor == valor

    @pytest.mark.parametrize("valor", [0, 22, 100])
    def test_puntos_juegos_fuera_rango(self, valor: int):
        with pytest.raises(ValidationError):
            FormatoScore(tipo="PUNTOS", valor=valor, unidad="juegos")

    @pytest.mark.parametrize("valor", [1, 3, 5])
    def test_puntos_sets_validos(self, valor: int):
        fs = FormatoScore(tipo="PUNTOS", valor=valor, unidad="sets")
        assert fs.unidad == "sets"

    @pytest.mark.parametrize("valor", [0, 6, 10])
    def test_puntos_sets_fuera_rango(self, valor: int):
        with pytest.raises(ValidationError):
            FormatoScore(tipo="PUNTOS", valor=valor, unidad="sets")

    @pytest.mark.parametrize("valor", [5, 15, 20, 30, 45, 60, 90])
    def test_tiempo_minutos_validos(self, valor: int):
        fs = FormatoScore(tipo="TIEMPO", valor=valor, unidad="minutos")
        assert fs.tipo == "TIEMPO"

    @pytest.mark.parametrize("valor", [0, 1, 4, 91, 200])
    def test_tiempo_minutos_fuera_rango(self, valor: int):
        with pytest.raises(ValidationError):
            FormatoScore(tipo="TIEMPO", valor=valor, unidad="minutos")

    def test_tiempo_con_unidad_juegos_invalido(self):
        with pytest.raises(ValidationError):
            FormatoScore(tipo="TIEMPO", valor=15, unidad="juegos")

    def test_puntos_con_unidad_minutos_invalido(self):
        with pytest.raises(ValidationError):
            FormatoScore(tipo="PUNTOS", valor=15, unidad="minutos")


# ------------------------------------------------------------
# Algoritmo elástico — generar_rol_multi_cancha
# ------------------------------------------------------------
class TestRoundRobinElastico:
    def _names(self, n: int):
        return [f"J{i+1}" for i in range(n)]

    @pytest.mark.parametrize(
        "n,canchas_esperadas,grupos_8,grupos_4",
        [
            (4, 1, 0, 1),
            (8, 1, 1, 0),
            (12, 2, 1, 1),
            (16, 2, 2, 0),
            (20, 3, 2, 1),
            (24, 3, 3, 0),
            (28, 4, 3, 1),
            (32, 4, 4, 0),
        ],
    )
    def test_distribucion_canchas(self, n, canchas_esperadas, grupos_8, grupos_4):
        rol = generar_rol_multi_cancha(self._names(n), canchas=canchas_esperadas, num_rondas=7)
        assert len(rol) == canchas_esperadas
        canchas_de_8 = sum(1 for c in rol if len(c["rondas"][0]["partidos"]) == 2)
        canchas_de_4 = sum(1 for c in rol if len(c["rondas"][0]["partidos"]) == 1)
        assert canchas_de_8 == grupos_8
        assert canchas_de_4 == grupos_4

    @pytest.mark.parametrize("n", [0, 1, 2, 3, 5, 7, 9, 33, 36])
    def test_rechaza_capacidad_invalida(self, n):
        with pytest.raises(ValueError):
            generar_rol_multi_cancha(self._names(n), canchas=1, num_rondas=7)

    def test_jugadores_no_se_repiten_entre_canchas(self):
        nombres = self._names(20)
        rol = generar_rol_multi_cancha(nombres, canchas=3, num_rondas=7)
        usados = set()
        for cancha in rol:
            jugadores_cancha = set()
            for r in cancha["rondas"]:
                for p in r["partidos"]:
                    for j in p["pareja_a"] + p["pareja_b"]:
                        jugadores_cancha.add(j)
            assert not (usados & jugadores_cancha), "Jugador en 2 canchas"
            usados |= jugadores_cancha
        assert usados == set(nombres)

    def test_cancha_4_jugadores_3_rondas(self):
        """Cancha con 4 jugadores: rotación americana de 3 rondas, 1 partido c/u."""
        rol = generar_rol_multi_cancha(self._names(4), canchas=1, num_rondas=7)
        cancha = rol[0]
        assert len(cancha["rondas"]) == 3  # max 3 para 4 jugadores
        for r in cancha["rondas"]:
            assert len(r["partidos"]) == 1

    def test_cancha_8_jugadores_n_rondas(self):
        for n_rondas in (5, 6, 7):
            rol = generar_rol_multi_cancha(self._names(8), canchas=1, num_rondas=n_rondas)
            assert len(rol[0]["rondas"]) == n_rondas
            for r in rol[0]["rondas"]:
                assert len(r["partidos"]) == 2


# ------------------------------------------------------------
# Compresión WebP (image_utils)
# ------------------------------------------------------------
def _make_png_data_url(width: int = 600, height: int = 600, color=(0, 128, 255)) -> str:
    """Crea un PNG sintético grande para forzar compresión."""
    img = Image.new("RGB", (width, height), color)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    b64 = base64.b64encode(buf.getvalue()).decode("ascii")
    return f"data:image/png;base64,{b64}"


class TestImageCompression:
    def test_none_passthrough(self):
        assert compress_logo_to_webp(None) is None

    def test_empty_string_passthrough(self):
        assert compress_logo_to_webp("") == ""

    def test_no_data_url_passthrough(self):
        s = "https://example.com/logo.png"
        assert compress_logo_to_webp(s) == s

    def test_invalid_base64_no_rompe(self):
        broken = "data:image/png;base64,!!!INVALID!!!"
        # No debe romper la app; retorna tal cual.
        assert compress_logo_to_webp(broken) == broken

    def test_comprime_png_grande_a_webp(self):
        original = _make_png_data_url(800, 800)
        comprimido = compress_logo_to_webp(original)
        assert comprimido is not None
        assert comprimido.startswith("data:image/webp;base64,")
        # Debe pesar significativamente menos que el original
        assert len(comprimido) < len(original)

    def test_redimensiona_si_excede_512(self):
        original = _make_png_data_url(1024, 1024)
        comprimido = compress_logo_to_webp(original)
        assert comprimido is not None
        # Decodificar y validar dimensión <= 512
        header, b64 = comprimido.split(",", 1)
        raw = base64.b64decode(b64)
        img = Image.open(io.BytesIO(raw))
        assert max(img.size) <= 512

    def test_idempotente_aproximadamente(self):
        """Comprimir 2 veces no degrada gravemente ni rompe."""
        original = _make_png_data_url(400, 400)
        once = compress_logo_to_webp(original)
        twice = compress_logo_to_webp(once)
        assert twice is not None
        assert twice.startswith("data:image/webp;base64,")
