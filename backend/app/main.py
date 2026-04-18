from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.db.database import engine, Base
from app.api import auth, nodes, edges, finals, sessions, schemas_api, bots
from app.models import Schema, DEFAULT_SCHEMA_ID


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    # Ensure the default schema row exists (idempotent). New DB bootstraps need
    # this so FKs pointing to it resolve without a manual migration.
    from sqlalchemy.ext.asyncio import AsyncSession
    from sqlalchemy import select
    async with AsyncSession(engine) as db:
        existing = (await db.execute(select(Schema).where(Schema.id == DEFAULT_SCHEMA_ID))).scalar_one_or_none()
        if not existing:
            db.add(Schema(id=DEFAULT_SCHEMA_ID, name="Эндо-бот",
                          description="Исходная схема эндоскопической диагностики"))
            await db.commit()
    yield
    await engine.dispose()


app = FastAPI(
    title="Endo Bot API",
    description="API для Telegram-бота диагностики ЖКК у детей и административной панели",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/api")
app.include_router(schemas_api.router, prefix="/api")

# Entity routers are mounted twice:
#   1. Legacy un-scoped routes ("/api/nodes/...") — used by the Telegram bot
#      and historically by the admin. schema_id defaults to 'endo-bot'.
#   2. Scoped routes ("/api/schemas/{schema_id}/nodes/...") — used by the
#      multi-schema admin panel. schema_id comes from the URL path.
# Both sets share the same handler functions; the `_scoping.resolve_schema_id`
# dependency reads schema_id from path_params or header.
app.include_router(nodes.router, prefix="/api")
app.include_router(nodes.router, prefix="/api/schemas/{schema_id}")
app.include_router(edges.router, prefix="/api")
app.include_router(edges.router, prefix="/api/schemas/{schema_id}")
app.include_router(finals.router, prefix="/api")
app.include_router(finals.router, prefix="/api/schemas/{schema_id}")
app.include_router(sessions.router, prefix="/api")
app.include_router(sessions.router, prefix="/api/schemas/{schema_id}")
# Bot binding is inherently per-schema, so we only expose it on the scoped path.
app.include_router(bots.router, prefix="/api/schemas/{schema_id}")


@app.get("/api/health")
async def health():
    return {"status": "ok"}
