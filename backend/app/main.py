import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .database import AsyncSessionLocal, Base, engine
from .migrate import auto_migrate
from .routers import (
    auth,
    dashboard,
    directories,
    exports,
    imports,
    inventory,
    materials,
    misc,
    organizations,
    payroll,
    products,
    reports,
    roles,
    services,
    settings as settings_router,
    transactions,
    users,
)
from .seed import seed
from .ws import manager


@asynccontextmanager
async def lifespan(app: FastAPI):
    # wait for DB and create schema
    for attempt in range(20):
        try:
            async with engine.begin() as conn:
                added = await auto_migrate(conn)
                await conn.run_sync(Base.metadata.create_all)
            if added:
                print(f"[startup] migrated {len(added)} column(s): {', '.join(added)}")
            break
        except Exception as exc:  # noqa: BLE001
            if attempt == 19:
                raise
            print(f"[startup] DB not ready ({exc!r}), retry {attempt + 1}/20 ...")
            await asyncio.sleep(2)

    async with AsyncSessionLocal() as db:
        await seed(db)
    print("[startup] ready ✔")
    yield


app = FastAPI(title="PROFIT DIVIDER — Financial Platform", version="1.0.0", lifespan=lifespan)

origins = ["*"] if settings.cors_origins == "*" else settings.cors_origins.split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

for r in (
    auth.router,
    users.router,
    roles.router,
    organizations.router,
    transactions.router,
    products.router,
    materials.router,
    inventory.router,
    payroll.router,
    services.router,
    settings_router.router,
    directories.router,
    reports.router,
    misc.router,
    dashboard.router,
    exports.router,
    imports.router,
):
    app.include_router(r)


@app.get("/api/health")
async def health():
    return {"status": "ok", "company": settings.company_name}


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await manager.connect(ws)
    try:
        await ws.send_json({"event": "connected", "payload": {"msg": "real-time online"}})
        while True:
            # keep the connection alive; we only push server -> client
            await ws.receive_text()
    except WebSocketDisconnect:
        await manager.disconnect(ws)
    except Exception:
        await manager.disconnect(ws)
