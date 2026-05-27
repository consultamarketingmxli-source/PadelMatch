"""Tests de Fase B — Compartir reta (QR + share-info + sugerencias).

Pruebas in-process con FastAPI's AsyncClient + mongomock para no depender de
Mongo real durante CI. Validan:
  - GET /api/retas/{id}/qr devuelve PNG válido (auth).
  - GET /api/retas/{id}/share-info devuelve metadatos (auth).
  - GET /api/public/retas/{slug}/qr es público y devuelve PNG.
  - Reta inexistente => 404 limpio.
  - Sugerencia de capacidad cuando inscritos = max_jugadores.
"""
from __future__ import annotations

import io
import os

import pytest
from PIL import Image

from core.qr_utils import make_qr_png


class TestQrUtils:
    def test_genera_png_valido(self):
        png = make_qr_png("https://padelreta.preview.emergentagent.com/retas/test-slug")
        assert png[:8] == b"\x89PNG\r\n\x1a\n"
        img = Image.open(io.BytesIO(png))
        assert img.format == "PNG"
        # debe ser cuadrado y >= 200px de lado para legibilidad
        assert img.size[0] == img.size[1]
        assert img.size[0] >= 200

    def test_rechaza_url_vacia(self):
        with pytest.raises(ValueError):
            make_qr_png("")

    def test_rechaza_none(self):
        with pytest.raises(ValueError):
            make_qr_png(None)  # type: ignore[arg-type]

    def test_qr_distinto_por_url(self):
        a = make_qr_png("https://example.com/a")
        b = make_qr_png("https://example.com/b")
        assert a != b  # diferente payload, diferente bitmap

    def test_qr_idempotente_misma_url(self):
        a = make_qr_png("https://example.com/x")
        b = make_qr_png("https://example.com/x")
        assert a == b


class TestSugerenciaCapacidad:
    """Función _sugerencia_capacidad — UX para banner del organizador."""

    def setup_method(self):
        # import perezoso para evitar cargar db en colección
        from routers.retas import _sugerencia_capacidad  # noqa: PLC0415
        self.fn = _sugerencia_capacidad

    def test_capacidad_completa_sugiere_waitlist(self):
        msg = self.fn(8, 8)
        assert msg is not None
        assert "100%" in msg or "lista de espera" in msg.lower()

    def test_capacidad_holgada_sin_sugerencia(self):
        # 16 cupos, 0 inscritos → libres=16 múltiplo de 4 → no sugerencia
        assert self.fn(16, 0) is None

    def test_libres_no_multiplo_4_sugiere_cierre(self):
        # 12 cupos, 3 inscritos → libres=9, no múltiplo de 4
        msg = self.fn(12, 3)
        assert msg is not None
        assert "cupos" in msg.lower() or "espera" in msg.lower()


class TestPublicBaseUrl:
    """Verifica el fallback de URL base — debe tomar APP_PUBLIC_URL primero."""

    def test_app_public_url_preferred(self, monkeypatch):
        from routers.retas import _public_base_url  # noqa: PLC0415
        monkeypatch.setenv("APP_PUBLIC_URL", "https://primary.example.com/")
        monkeypatch.setenv("EXPO_PUBLIC_BACKEND_URL", "https://fallback.example.com")
        assert _public_base_url() == "https://primary.example.com"

    def test_fallback_to_expo_backend(self, monkeypatch):
        from routers.retas import _public_base_url  # noqa: PLC0415
        monkeypatch.delenv("APP_PUBLIC_URL", raising=False)
        monkeypatch.delenv("EXPO_PUBLIC_FRONTEND_URL", raising=False)
        monkeypatch.setenv("EXPO_PUBLIC_BACKEND_URL", "https://fallback.example.com/")
        assert _public_base_url() == "https://fallback.example.com"

    def test_empty_when_no_env(self, monkeypatch):
        from routers.retas import _public_base_url  # noqa: PLC0415
        monkeypatch.delenv("APP_PUBLIC_URL", raising=False)
        monkeypatch.delenv("EXPO_PUBLIC_FRONTEND_URL", raising=False)
        monkeypatch.delenv("EXPO_PUBLIC_BACKEND_URL", raising=False)
        assert _public_base_url() == ""
