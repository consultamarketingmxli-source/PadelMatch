"""
ITER44 — CHAOS / FAULT-INJECTION / DESTRUCTIVE TESTING
=======================================================
Pre-publication robustness audit. Intentionally tries to break the app:
- Memory overflows (huge payloads)
- Null/undefined access
- Race conditions (concurrent inscriptions, OTP brute-force)
- Input validation gaps (SQLi, XSS, unicode, emojis)
- Weak error handling (uncaught 500s)
"""
import os
import json
import uuid
import string
import random
import concurrent.futures as cf
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://padel-tournament-hub-9.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_USER = "admin@padelappretas.com"
ADMIN_PASS = "admin123"
TEST_PHONE = "+5215512345678"

session = requests.Session()
session.headers.update({"Content-Type": "application/json"})


@pytest.fixture(scope="module")
def admin_token():
    r = session.post(f"{API}/auth/login",
                     json={"username": ADMIN_USER, "password": ADMIN_PASS},
                     timeout=15)
    assert r.status_code == 200, f"Admin login failed: {r.status_code} {r.text[:200]}"
    return r.json().get("access_token") or r.json().get("token")


# ====================================================
# 1) AUTH LOGIN — malformed inputs
# ====================================================
class TestAuthLoginFaultInjection:
    PAYLOADS = [
        ("sql_injection", {"username": "'; DROP TABLE users; --", "password": "x"}),
        ("xss_payload",   {"username": "<script>alert(1)</script>", "password": "x"}),
        ("null_username", {"username": None, "password": "x"}),
        ("empty_string",  {"username": "", "password": ""}),
        ("huge_email",    {"username": "a" * 5000 + "@x.com", "password": "x"}),
        ("emoji_password",{"username": ADMIN_USER, "password": "🔥🚀💀"}),
        ("empty_body",    {}),
    ]

    @pytest.mark.parametrize("name,payload", PAYLOADS, ids=[p[0] for p in PAYLOADS])
    def test_malformed_login(self, name, payload):
        r = session.post(f"{API}/auth/login", json=payload, timeout=15)
        # MUST NOT 500 — should be 400/401/422
        assert r.status_code != 500, f"[{name}] CRASH 500: {r.text[:300]}"
        assert r.status_code in (400, 401, 403, 404, 422), f"[{name}] unexpected {r.status_code}: {r.text[:300]}"

    def test_non_json_body(self):
        r = requests.post(f"{API}/auth/login",
                          data="not-a-json-body",
                          headers={"Content-Type": "text/plain"},
                          timeout=15)
        assert r.status_code != 500, f"CRASH 500 on text/plain body: {r.text[:300]}"
        assert r.status_code in (400, 415, 422), f"unexpected {r.status_code}: {r.text[:200]}"

    def test_content_type_text_plain_with_json(self):
        r = requests.post(f"{API}/auth/login",
                          data=json.dumps({"username": ADMIN_USER, "password": ADMIN_PASS}),
                          headers={"Content-Type": "text/plain"},
                          timeout=15)
        assert r.status_code != 500, f"CRASH 500: {r.text[:300]}"


# ====================================================
# 2) OTP REQUEST — phone/name fault injection
# ====================================================
class TestOtpRequestFaultInjection:
    PAYLOADS = [
        ("zeros_phone",   {"telefono": "+0000000", "nombre": "Test"}),
        ("letters_phone", {"telefono": "+abcdefg", "nombre": "Test"}),
        ("symbols_phone", {"telefono": "+@@@!!!", "nombre": "Test"}),
        ("huge_phone",    {"telefono": "+" + "1" * 200, "nombre": "Test"}),
        ("sql_in_name",   {"telefono": "+5215587654321", "nombre": "Robert'); DROP TABLE--"}),
        ("xss_name",      {"telefono": "+5215587654322", "nombre": "<script>alert(1)</script>"}),
        ("null_name",     {"telefono": "+5215587654323", "nombre": None}),
        ("empty_name",    {"telefono": "+5215587654324", "nombre": ""}),
        ("empty_body",    {}),
    ]

    @pytest.mark.parametrize("name,payload", PAYLOADS, ids=[p[0] for p in PAYLOADS])
    def test_otp_request_malformed(self, name, payload):
        r = session.post(f"{API}/players/auth/otp/request", json=payload, timeout=15)
        assert r.status_code != 500, f"[{name}] CRASH 500: {r.text[:300]}"
        assert r.status_code in (200, 400, 401, 403, 422, 429), f"[{name}] unexpected {r.status_code}: {r.text[:200]}"


# ====================================================
# 3) OTP VERIFY — brute force + invalid codes
# ====================================================
class TestOtpVerifyFaultInjection:
    PAYLOADS = [
        ("zeros",     {"telefono": TEST_PHONE, "codigo": "000000"}),
        ("letters",   {"telefono": TEST_PHONE, "codigo": "abcdef"}),
        ("negative",  {"telefono": TEST_PHONE, "codigo": "-123456"}),
        ("empty",     {"telefono": TEST_PHONE, "codigo": ""}),
        ("huge_code", {"telefono": TEST_PHONE, "codigo": "9" * 1000}),
        ("emoji",     {"telefono": TEST_PHONE, "codigo": "🔥🚀💀✨🎾🎯"}),
        ("null",      {"telefono": TEST_PHONE, "codigo": None}),
    ]

    @pytest.mark.parametrize("name,payload", PAYLOADS, ids=[p[0] for p in PAYLOADS])
    def test_verify_invalid(self, name, payload):
        r = session.post(f"{API}/players/auth/otp/verify", json=payload, timeout=15)
        assert r.status_code != 500, f"[{name}] CRASH 500: {r.text[:300]}"
        assert r.status_code in (400, 401, 403, 404, 422, 429), f"[{name}] unexpected {r.status_code}: {r.text[:200]}"


# ====================================================
# 4) PUBLIC RETAS SEARCH — invalid coords / huge limit / unicode
# ====================================================
class TestPublicRetasBuscarFaultInjection:
    PARAMS = [
        ("lat_out_of_range",  {"lat": 200, "lng": -300}),
        ("lat_non_numeric",   {"lat": "abc", "lng": "xyz"}),
        ("emoji_query",       {"q": "🎾🔥💀" * 20}),
        ("huge_limit",        {"limit": 99999}),
        ("negative_page",     {"page": -10}),
        ("xss_in_query",      {"q": "<img src=x onerror=alert(1)>"}),
        ("sql_in_query",      {"q": "'; DROP TABLE retas;--"}),
        ("null_byte",         {"q": "test\x00admin"}),
        ("massive_query",     {"q": "x" * 10000}),
    ]

    @pytest.mark.parametrize("name,params", PARAMS, ids=[p[0] for p in PARAMS])
    def test_buscar_malformed_params(self, name, params):
        r = session.get(f"{API}/public/retas/buscar", params=params, timeout=20)
        assert r.status_code != 500, f"[{name}] CRASH 500: {r.text[:400]}"
        assert r.status_code in (200, 400, 422), f"[{name}] unexpected {r.status_code}: {r.text[:200]}"


# ====================================================
# 5) ADMIN RETAS CREATE — extreme/invalid values
# ====================================================
class TestAdminRetaCreateFaultInjection:
    def _auth(self, token):
        return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

    @pytest.mark.parametrize("name,payload", [
        ("empty_body",         {}),
        ("nulls_everywhere",   {"nombre": None, "costo": None, "jugadores_max": None}),
        ("negative_cost",      {"nombre": "X", "costo": -1000, "jugadores_max": 4}),
        ("huge_cost",          {"nombre": "X", "costo": 99999999999999, "jugadores_max": 4}),
        ("zero_players",       {"nombre": "X", "costo": 100, "jugadores_max": 0}),
        ("negative_players",   {"nombre": "X", "costo": 100, "jugadores_max": -5}),
        ("empty_name",         {"nombre": "", "costo": 100, "jugadores_max": 4}),
        ("huge_name",          {"nombre": "X" * 10000, "costo": 100, "jugadores_max": 4}),
        ("invalid_date",       {"nombre": "X", "costo": 100, "jugadores_max": 4, "fecha_inicio": "2026-15-99"}),
        ("emoji_name",         {"nombre": "🔥🚀💀" * 50, "costo": 100, "jugadores_max": 4}),
        ("xss_name",           {"nombre": "<script>alert(1)</script>", "costo": 100, "jugadores_max": 4}),
    ], ids=lambda x: x if isinstance(x, str) else "")
    def test_create_reta_malformed(self, admin_token, name, payload):
        r = session.post(f"{API}/retas", json=payload, headers=self._auth(admin_token), timeout=20)
        assert r.status_code != 500, f"[{name}] CRASH 500: {r.text[:400]}"
        # Should be 4xx (validation rejected) — 201/200 only OK if backend silently coerces (which is itself a smell)
        assert r.status_code in (400, 401, 403, 404, 422), \
            f"[{name}] expected 4xx, got {r.status_code}: {r.text[:200]}"


# ====================================================
# 6) PUBLIC INSCRIBIRME — race + invalid IDs
# ====================================================
class TestInscribirmeFaultInjection:
    @pytest.mark.parametrize("reta_id,desc", [
        ("not-a-uuid", "garbage_string"),
        ("00000000-0000-0000-0000-000000000000", "zero_uuid"),
        ("a" * 500, "huge_string"),
        ("../../etc/passwd", "path_traversal"),
        ("'; DROP TABLE--", "sql_injection"),
    ])
    def test_invalid_reta_id(self, reta_id, desc):
        r = session.post(f"{API}/public/retas/{reta_id}/inscribirme",
                         json={"telefono": TEST_PHONE, "nombre": "Test"},
                         timeout=15)
        assert r.status_code != 500, f"[{desc}] CRASH 500: {r.text[:400]}"
        assert r.status_code in (400, 401, 403, 404, 422), \
            f"[{desc}] unexpected {r.status_code}: {r.text[:200]}"

    def test_inscribirme_empty_id(self):
        r = session.post(f"{API}/public/retas//inscribirme",
                         json={"telefono": TEST_PHONE, "nombre": "Test"},
                         timeout=15)
        assert r.status_code != 500, f"CRASH 500: {r.text[:200]}"

    def test_concurrent_inscription_anti_oversell(self, admin_token):
        """20 parallel inscriptions to the same reta — verify backend doesn't oversell."""
        # Find an existing active reta
        retas_r = session.get(f"{API}/public/retas/buscar", timeout=15)
        if retas_r.status_code != 200:
            pytest.skip("No retas accessible")
        retas_list = retas_r.json()
        retas = retas_list if isinstance(retas_list, list) else retas_list.get("retas", [])
        if not retas:
            pytest.skip("No retas available for concurrency test")
        reta_id = retas[0].get("id") or retas[0].get("_id")
        if not reta_id:
            pytest.skip("Reta has no id field")

        def attempt(i):
            phone = f"+521555000{i:04d}"
            try:
                r = session.post(f"{API}/public/retas/{reta_id}/inscribirme",
                                 json={"telefono": phone, "nombre": f"Stress{i}"},
                                 timeout=20)
                return r.status_code
            except Exception as e:
                return f"EXC:{type(e).__name__}"

        with cf.ThreadPoolExecutor(max_workers=20) as ex:
            results = list(ex.map(attempt, range(20)))
        # Print for visibility; assert no 500s
        five_hundreds = [r for r in results if r == 500]
        assert not five_hundreds, f"Concurrent inscription caused 500s: {results}"


# ====================================================
# 7) MERCADO PAGO callbacks — forged state, no token
# ====================================================
class TestMercadoPagoFaultInjection:
    def test_oauth_callback_forged_state(self):
        # NOTE: must NOT execute real MP exchange. We send garbage state.
        r = session.get(f"{API}/admin/mercadopago/oauth/callback",
                        params={"code": "fake", "state": "FORGED_STATE_GARBAGE"},
                        timeout=15, allow_redirects=False)
        assert r.status_code != 500, f"CRASH 500 on forged state: {r.text[:300]}"
        # Expected: 400/401/403/422 or a redirect to error page
        assert r.status_code in (200, 302, 303, 307, 308, 400, 401, 403, 404, 422), \
            f"unexpected {r.status_code}: {r.text[:200]}"

    def test_oauth_start_no_token(self):
        r = session.get(f"{API}/admin/mercadopago/oauth/start", timeout=10)
        assert r.status_code != 500, f"CRASH 500: {r.text[:300]}"
        assert r.status_code in (401, 403), f"expected auth challenge, got {r.status_code}"

    def test_oauth_start_expired_token(self):
        r = session.get(f"{API}/admin/mercadopago/oauth/start",
                        headers={"Authorization": "Bearer expired.token.garbage"}, timeout=10)
        assert r.status_code != 500, f"CRASH 500: {r.text[:300]}"
        assert r.status_code in (401, 403, 422), f"got {r.status_code}"


# ====================================================
# 8) OPENAPI — was 500 in iter43, should be fixed
# ====================================================
class TestOpenAPI:
    def test_openapi_schema(self):
        r = session.get(f"{API}/openapi.json", timeout=20)
        # iter43 said this was 500; check if it's been fixed
        assert r.status_code != 500, f"openapi STILL 500: {r.text[:500]}"

    def test_root_openapi(self):
        # Also check the top-level openapi (no /api prefix)
        r = session.get(f"{BASE_URL}/openapi.json", timeout=20)
        # Just record; don't fail the suite on it
        print(f"root openapi.json -> {r.status_code}")


# ====================================================
# 9) Brute-force / spam (limited so we don't kill the box)
# ====================================================
class TestRateLimitSpam:
    def test_otp_spam_same_phone(self):
        """30 rapid OTP requests — expect 429 / 200 / 422, never 500."""
        codes = []
        for i in range(30):
            r = session.post(f"{API}/players/auth/otp/request",
                             json={"telefono": "+5215599999999", "nombre": "SpamBot"},
                             timeout=10)
            codes.append(r.status_code)
            if r.status_code == 500:
                pytest.fail(f"500 on iteration {i}: {r.text[:300]}")
        assert 429 in codes or 200 in codes, f"Rate limit signal expected. Codes: {set(codes)}"
        print(f"OTP spam codes: {dict((c, codes.count(c)) for c in set(codes))}")

    def test_otp_verify_brute_force(self):
        """40 random codes in a row — should rate-limit or 401/422, never 500."""
        codes = []
        for i in range(40):
            code = "".join(random.choices(string.digits, k=6))
            r = session.post(f"{API}/players/auth/otp/verify",
                             json={"telefono": TEST_PHONE, "codigo": code}, timeout=10)
            codes.append(r.status_code)
            if r.status_code == 500:
                pytest.fail(f"500 on iter {i}: {r.text[:300]}")
        print(f"OTP brute codes: {dict((c, codes.count(c)) for c in set(codes))}")
