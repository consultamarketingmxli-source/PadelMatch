"""Tests for Módulo Clubes Inteligente (autocomplete + silent enrichment + dedupe)."""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/") or \
           os.environ.get("EXPO_BACKEND_URL", "").rstrip("/")

ADMIN_USER = "admin@padelappretas.com"
ADMIN_PASS = "admin123"


@pytest.fixture(scope="module")
def s():
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json"})
    return sess


@pytest.fixture(scope="module")
def admin_token(s):
    r = s.post(f"{BASE_URL}/api/auth/login",
               json={"username": ADMIN_USER, "password": ADMIN_PASS})
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


def auth_h(tok):
    return {"Authorization": f"Bearer {tok}"}


# ---------- 1. GET /api/public/clubes/buscar?q=padel ----------
def test_buscar_por_texto(s):
    r = s.get(f"{BASE_URL}/api/public/clubes/buscar", params={"q": "padel"})
    assert r.status_code == 200, r.text
    data = r.json()
    assert "results" in data and isinstance(data["results"], list)
    # Schema verification
    for c in data["results"]:
        assert "id" in c and "nombre" in c
        assert "direccion_completa" in c
        assert "latitud" in c and "longitud" in c


# ---------- 2. GET /api/public/clubes/buscar?lat=&lng= ----------
def test_buscar_por_geo_orden_haversine(s):
    r = s.get(f"{BASE_URL}/api/public/clubes/buscar",
              params={"lat": 19.45, "lng": -99.15, "radio_km": 1000})
    assert r.status_code == 200, r.text
    data = r.json()
    results = data["results"]
    # Si hay clubes con coords, verificar distancia_km presente + orden ascendente
    con_dist = [c for c in results if c.get("distancia_km") is not None]
    if con_dist:
        dists = [c["distancia_km"] for c in con_dist]
        assert dists == sorted(dists), f"No ordenado por distancia: {dists}"


# ---------- 3. GET /api/public/clubes/buscar?q=<no existe> ----------
def test_buscar_no_encontrado(s):
    q = f"NuevoClubInventado{uuid.uuid4().hex[:8]}"
    r = s.get(f"{BASE_URL}/api/public/clubes/buscar", params={"q": q})
    assert r.status_code == 200
    assert r.json()["results"] == []


# ---------- Helper: crear reta ----------
def _payload(nombre, club, club_id=None, direccion=None, lat=None, lng=None):
    return {
        "nombre": nombre,
        "club": club,
        "club_id": club_id,
        "club_direccion": direccion,
        "fecha_str": "2026-12-20",
        "hora_str": "19:00",
        "tz_offset_minutes": -360,
        "canchas_disponibles": 1,
        "max_jugadores": 8,
        "costo_inscripcion": 100,
        "modalidad_juego": "PUNTOS",
        "num_rondas": 7,
        "formato_score": {"tipo": "PUNTOS", "valor": 9, "unidad": "juegos"},
        "tipo_acceso": "paga",
        "latitud": lat,
        "longitud": lng,
    }


@pytest.fixture(scope="module")
def created_retas():
    """Track retas/clubes for cleanup."""
    return {"retas": []}


# ---------- 4. POST reta con club_id existente (hereda dir/coords) ----------
def test_create_reta_con_club_id_existente(s, admin_token, created_retas):
    # Buscar/crear un club fuente
    seed_name = f"TEST_ClubFuente_{uuid.uuid4().hex[:8]}"
    # Creamos primero via reta para tenerlo en BD
    r0 = s.post(f"{BASE_URL}/api/retas",
                headers=auth_h(admin_token),
                json=_payload(f"TEST_seedReta_{uuid.uuid4().hex[:6]}",
                              seed_name, direccion="Av. Test 100",
                              lat=19.40, lng=-99.20))
    assert r0.status_code == 200, r0.text
    created_retas["retas"].append(r0.json()["id"])
    club_id = r0.json().get("club_id")
    assert club_id, "No se generó club_id en enriquecimiento"

    # Crear nueva reta usando ese club_id, SIN mandar dir/lat/lng → debería heredarlos
    r1 = s.post(f"{BASE_URL}/api/retas",
                headers=auth_h(admin_token),
                json=_payload(f"TEST_reta_heredera_{uuid.uuid4().hex[:6]}",
                              seed_name, club_id=club_id))
    assert r1.status_code == 200, r1.text
    j = r1.json()
    created_retas["retas"].append(j["id"])
    assert j["club_id"] == club_id
    assert j.get("club_direccion") == "Av. Test 100"
    assert j.get("latitud") == 19.40
    assert j.get("longitud") == -99.20


# ---------- 5. POST reta con texto libre → crea club silenciosamente ----------
def test_create_reta_enriquecimiento_silencioso(s, admin_token, created_retas):
    nuevo = f"TEST_ClubNuevoSilencioso_{uuid.uuid4().hex[:8]}"
    r = s.post(f"{BASE_URL}/api/retas",
               headers=auth_h(admin_token),
               json=_payload(f"TEST_reta_{uuid.uuid4().hex[:6]}",
                             nuevo, direccion="Calle Nueva 5"))
    assert r.status_code == 200, r.text
    j = r.json()
    created_retas["retas"].append(j["id"])
    assert j["club_id"], "club_id debe estar poblado tras enriquecimiento"

    # Verificar que ahora aparece en /buscar
    r2 = s.get(f"{BASE_URL}/api/public/clubes/buscar", params={"q": nuevo})
    assert r2.status_code == 200
    names = [c["nombre"] for c in r2.json()["results"]]
    assert nuevo in names


# ---------- 6. Dedupe: misma reta con mismo nombre reusa club existente ----------
def test_create_reta_dedupe_club(s, admin_token, created_retas):
    nombre_club = f"TEST_DedupeClub_{uuid.uuid4().hex[:8]}"

    r1 = s.post(f"{BASE_URL}/api/retas", headers=auth_h(admin_token),
                json=_payload(f"TEST_r1_{uuid.uuid4().hex[:4]}", nombre_club,
                              direccion="Dir 1"))
    assert r1.status_code == 200
    cid1 = r1.json()["club_id"]
    created_retas["retas"].append(r1.json()["id"])

    # Otra reta con MISMO nombre, distinta capitalización
    r2 = s.post(f"{BASE_URL}/api/retas", headers=auth_h(admin_token),
                json=_payload(f"TEST_r2_{uuid.uuid4().hex[:4]}",
                              nombre_club.upper(), direccion="Dir 2"))
    assert r2.status_code == 200
    cid2 = r2.json()["club_id"]
    created_retas["retas"].append(r2.json()["id"])

    assert cid1 == cid2, "Dedupe fallido: se crearon 2 clubes con mismo nombre"


# ---------- 7. GET /api/public/retas/{slug} devuelve coords + dir + club_id ----------
def test_get_reta_publica_expone_geo(s):
    r = s.get(f"{BASE_URL}/api/public/retas/test-enrich-padel-pro-cdmx-2026-12-25")
    if r.status_code == 404:
        pytest.skip("Reta seed 'test-enrich-padel-pro-cdmx-2026-12-25' no existe en BD")
    assert r.status_code == 200, r.text
    j = r.json()
    assert "latitud" in j and j["latitud"] is not None
    assert "longitud" in j and j["longitud"] is not None
    assert "club_direccion" in j
    assert "club_id" in j


def test_get_reta_publica_sin_geo(s):
    r = s.get(f"{BASE_URL}/api/public/retas/test-tiempo-30-speed-club-2025-12-31")
    if r.status_code == 404:
        pytest.skip("Reta seed 'test-tiempo-30-speed-club-2025-12-31' no existe en BD")
    assert r.status_code == 200, r.text
    # Reta sin geo — latitud/longitud puede ser None
    j = r.json()
    assert "club" in j


# ---------- 8. Race condition: 2 retas con club nuevo en paralelo → 1 club ----------
def test_race_condition_misma_creacion(s, admin_token, created_retas):
    """Simula 2 organizadores creando retas con el mismo club nuevo casi simultáneo.
    El segundo debe reusar el club_id del primero (vía DuplicateKeyError o find)."""
    import concurrent.futures

    nombre_club = f"TEST_RaceClub_{uuid.uuid4().hex[:8]}"

    def crear():
        return s.post(
            f"{BASE_URL}/api/retas",
            headers=auth_h(admin_token),
            json=_payload(f"TEST_rR_{uuid.uuid4().hex[:4]}", nombre_club),
        )

    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as ex:
        futs = [ex.submit(crear) for _ in range(2)]
        responses = [f.result() for f in futs]

    for r in responses:
        assert r.status_code == 200, r.text
        created_retas["retas"].append(r.json()["id"])

    cids = {r.json()["club_id"] for r in responses}
    assert len(cids) == 1, f"Race condition no resuelta: clubes distintos {cids}"


# ---------- 9. q con caracteres especiales no rompe regex ----------
def test_buscar_con_caracteres_especiales(s):
    # Caracteres que romperían un regex sin escape
    for q in [".*", "(", "++", "?", "[a-z]"]:
        r = s.get(f"{BASE_URL}/api/public/clubes/buscar", params={"q": q})
        assert r.status_code == 200, f"Falló con q={q!r}: {r.text}"
        assert "results" in r.json()


# ---------- 10. Lat/lng inválidos son rechazados o ignorados ----------
def test_buscar_geo_invalido(s):
    # Pydantic Query con ge/le debe rechazar 91 (out of range)
    r = s.get(f"{BASE_URL}/api/public/clubes/buscar", params={"lat": 91, "lng": 0})
    assert r.status_code == 422  # FastAPI validation error


# ---------- 11. Update reta hereda enriquecimiento si user borra club_id ----------
def test_update_reta_re_enriquece(s, admin_token, created_retas):
    """PUT reta sin club_id pero con nombre conocido → debe reusar club existente."""
    club_name = f"TEST_UpdateClub_{uuid.uuid4().hex[:8]}"
    r0 = s.post(
        f"{BASE_URL}/api/retas",
        headers=auth_h(admin_token),
        json=_payload(f"TEST_rU_{uuid.uuid4().hex[:4]}", club_name,
                      direccion="Dir A", lat=20.0, lng=-100.0),
    )
    assert r0.status_code == 200
    reta_id = r0.json()["id"]
    created_retas["retas"].append(reta_id)
    cid_orig = r0.json()["club_id"]

    # Ahora PUT sin club_id → re-resolución por enriquecimiento
    payload = _payload(f"TEST_rU_{uuid.uuid4().hex[:4]}", club_name)
    payload["club_id"] = None
    r1 = s.put(f"{BASE_URL}/api/retas/{reta_id}", headers=auth_h(admin_token), json=payload)
    assert r1.status_code == 200, r1.text
    assert r1.json()["club_id"] == cid_orig, "PUT debe reusar club existente"


# ---------- Cleanup ----------
def test_zz_cleanup(s, admin_token, created_retas):
    for rid in created_retas["retas"]:
        s.delete(f"{BASE_URL}/api/retas/{rid}", headers=auth_h(admin_token))
