"""Iter52 - Google Search Console HTML verification endpoint tests.

Verifies:
  - GET /googlea85e4f73dfe1ad08.html → 200 + text/html + exact body
  - GET /googleXYZ.html            → 404
  - GET /something-random          → 404 (no catch-all shadowing)
  - Env-driven config uses os.getenv
  - Regression: .well-known/* still work
  - Regression: /api/ root still returns 200 (no route collision)
"""
import os

import pytest
import requests

BASE_URL = "http://localhost:8001"
GOOGLE_FILE = os.getenv("GOOGLE_VERIFICATION_FILE_NAME", "googlea85e4f73dfe1ad08.html")
GOOGLE_BODY = os.getenv(
    "GOOGLE_VERIFICATION_FILE_CONTENT",
    "google-site-verification: googlea85e4f73dfe1ad08.html",
)


# ── New endpoint: Google Search Console verification ─────────────────────
class TestGoogleVerificationEndpoint:
    def test_correct_filename_returns_200_with_exact_body(self):
        r = requests.get(f"{BASE_URL}/{GOOGLE_FILE}", timeout=10)
        assert r.status_code == 200
        assert r.headers.get("content-type", "").lower().startswith("text/html")
        # Body must match content (with or without trailing newline)
        assert r.text.strip() == GOOGLE_BODY.strip()

    def test_wrong_google_filename_returns_404(self):
        r = requests.get(f"{BASE_URL}/googleXYZ.html", timeout=10)
        assert r.status_code == 404

    def test_random_path_returns_404_no_catchall(self):
        r = requests.get(f"{BASE_URL}/something-random", timeout=10)
        assert r.status_code == 404

    def test_env_driven_config_uses_getenv(self):
        # Static inspection: source should reference os.getenv for both vars
        with open("/app/backend/routers/wellknown.py") as f:
            src = f.read()
        assert "os.getenv(" in src
        assert "GOOGLE_VERIFICATION_FILE_NAME" in src
        assert "GOOGLE_VERIFICATION_FILE_CONTENT" in src


# ── Regression: .well-known/* endpoints ──────────────────────────────────
class TestWellKnownRegression:
    def test_apple_aasa_still_200(self):
        r = requests.get(f"{BASE_URL}/.well-known/apple-app-site-association", timeout=10)
        assert r.status_code == 200
        assert "application/json" in r.headers.get("content-type", "").lower()
        data = r.json()
        assert "applinks" in data
        assert "details" in data["applinks"]

    def test_android_assetlinks_still_200(self):
        r = requests.get(f"{BASE_URL}/.well-known/assetlinks.json", timeout=10)
        assert r.status_code == 200
        assert "application/json" in r.headers.get("content-type", "").lower()
        data = r.json()
        assert isinstance(data, list)
        assert data[0]["target"]["namespace"] == "android_app"


# ── Regression: /api/* not shadowed by /{filename} ───────────────────────
class TestApiRouteIntegrity:
    def test_api_root_still_returns_200(self):
        r = requests.get(f"{BASE_URL}/api/", timeout=10)
        assert r.status_code == 200
        data = r.json()
        assert data.get("status") == "ok"


# ── Frontend public file exists ──────────────────────────────────────────
class TestFrontendPublicFile:
    def test_public_file_exists_with_correct_content(self):
        path = f"/app/frontend/public/{GOOGLE_FILE}"
        assert os.path.exists(path), f"Missing: {path}"
        with open(path) as f:
            body = f.read().strip()
        assert body == GOOGLE_BODY.strip()
