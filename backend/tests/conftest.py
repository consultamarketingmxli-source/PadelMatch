"""Shared pytest fixtures for Pixel Padel OS backend tests."""
import os
import sys
from pathlib import Path

import pytest
import requests
from dotenv import load_dotenv

# Allow importing backend modules (logica_torneo, etc.)
BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

# Load backend env to access MONGO_URL/DB_NAME if needed
load_dotenv(BACKEND_DIR / ".env")

# Use the PUBLIC URL (Kubernetes ingress) — backend serves on /api prefix
BASE_URL = os.environ.get(
    "EXPO_PUBLIC_BACKEND_URL",
    "https://padel-tournament-hub-9.preview.emergentagent.com",
).rstrip("/")

ADMIN_EMAIL = "admin@pixelpadel.com"
ADMIN_PASSWORD = "admin123"


@pytest.fixture(scope="session")
def base_url():
    return BASE_URL


@pytest.fixture(scope="session")
def api_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session")
def admin_token(api_client):
    r = api_client.post(
        f"{BASE_URL}/api/auth/login",
        json={"username": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        timeout=20,
    )
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    data = r.json()
    assert "access_token" in data
    return data["access_token"]


@pytest.fixture(scope="session")
def auth_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}
