"""Iter26 — Regression test for Fase 3 + Fase 4.
Verifies that all endpoints mentioned in the review request still work.
"""
import os
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", os.environ.get("EXPO_BACKEND_URL", "")).rstrip("/")


def test_admin_login():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"username": "admin@padelappretas.com", "password": "admin123"},
                      timeout=15)
    assert r.status_code == 200, r.text
    assert "access_token" in r.json()


def test_player_otp_request_and_roles():
    phone = "+5215599998888"
    r = requests.post(f"{BASE_URL}/api/players/auth/otp/request",
                      json={"telefono": phone, "nombre": "TEST Iter26"}, timeout=15)
    # 200 OK or 429 (rate limit) both acceptable for verifying route exists
    assert r.status_code in (200, 429), r.text


def test_public_retas_buscar():
    r = requests.get(f"{BASE_URL}/api/public/retas/buscar", timeout=15)
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data, (list, dict))


def test_admin_retas_list_and_resultados_endpoints():
    login = requests.post(f"{BASE_URL}/api/auth/login",
                          json={"username": "admin@padelappretas.com", "password": "admin123"},
                          timeout=15)
    assert login.status_code == 200
    token = login.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    r = requests.get(f"{BASE_URL}/api/retas", headers=headers, timeout=15)
    assert r.status_code == 200
    retas = r.json()
    assert isinstance(retas, list)

    if retas:
        rid = retas[0]["id"]
        rr = requests.get(f"{BASE_URL}/api/retas/{rid}/resultados", headers=headers, timeout=15)
        assert rr.status_code == 200
        ri = requests.get(f"{BASE_URL}/api/retas/{rid}/inscripciones", headers=headers, timeout=15)
        assert ri.status_code == 200


def test_player_me_roles_unauth_returns_401():
    r = requests.get(f"{BASE_URL}/api/players/me/roles", timeout=15)
    # Should require auth → 401 (interceptor de Fase 2)
    assert r.status_code in (401, 403), r.text
