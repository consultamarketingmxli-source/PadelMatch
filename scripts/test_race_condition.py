"""Test de race condition: 20 inscripciones concurrentes a reta de capacidad 8."""
import asyncio
import os
import httpx
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

load_dotenv("/app/backend/.env")
BASE = "http://localhost:8001/api"


async def setup():
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = client[os.environ["DB_NAME"]]
    reta = await db.retas.find_one({"nombre": "Reta Demo"})
    if not reta:
        return None
    rid = reta["id"]
    await db.inscripciones.delete_many({"reta_id": rid})
    await db.lista_espera.delete_many({"reta_id": rid})
    await db.retas.update_one(
        {"id": rid},
        {"$set": {"inscritos_lock": 0, "waitlist_seq": 0}},
    )
    client.close()
    return rid, reta["max_jugadores"]


async def hit(client, reta_id, i):
    payload = {
        "reta_id": reta_id,
        "nombre": f"Jugador{i:02d}",
        "telefono": f"+5215512300{i:03d}",
    }
    try:
        r = await client.post(
            f"{BASE}/public/retas/{reta_id}/checkout", json=payload, timeout=15,
        )
        return r.status_code
    except Exception as e:
        return f"ERR:{e}"


async def main():
    res = await setup()
    if not res:
        print("Reta no encontrada")
        return
    reta_id, maxj = res
    print(f"Reta {reta_id[:8]}... max_jugadores={maxj}. Disparando 20 concurrentes...")
    async with httpx.AsyncClient() as client:
        tasks = [hit(client, reta_id, i) for i in range(20)]
        statuses = await asyncio.gather(*tasks)
    ok = sum(1 for s in statuses if s == 200)
    conflict = sum(1 for s in statuses if s == 409)
    other = [s for s in statuses if s not in (200, 409)]
    print(f"  200 (cupo asignado): {ok}")
    print(f"  409 (rebote a waitlist): {conflict}")
    if other:
        print(f"  Otros: {other}")
    mc = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = mc[os.environ["DB_NAME"]]
    real = await db.inscripciones.count_documents(
        {"reta_id": reta_id, "estatus_pago": "Pendiente"},
    )
    reta2 = await db.retas.find_one({"id": reta_id})
    print(f"  Inscripciones reales en DB: {real}")
    print(f"  inscritos_lock en reta doc: {reta2.get('inscritos_lock')}")
    mc.close()
    assert ok == maxj, f"FALLA: deberian ser {maxj} OK, fueron {ok}"
    assert real == maxj, f"FALLA: deberian ser {maxj} en DB, hay {real}"
    print("RACE CONDITION FIX VALIDADO OK")


asyncio.run(main())
