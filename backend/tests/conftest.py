"""Shared pytest fixtures for the backend test suite.

Design choices:
  * Each test gets its own in-memory SQLite DB via a fresh engine. That keeps
    tests fully isolated (no cleanup code needed) and fast (a few ms each).
  * We override FastAPI's `get_db` dependency with a session bound to the
    test engine. The app itself is imported once — the dependency override
    is what swaps the backing store.
  * The async_sessionmaker used by the API endpoints lives on `app.db.database`
    and is imported eagerly at module load. To avoid touching Postgres we
    monkey-patch `DATABASE_URL` *before* the app is imported (see the early
    fixture-free assignment at the top of this file).
  * Authenticated endpoints use `get_current_user`. Rather than mint real JWTs
    we override that dependency too, returning a fixture-created admin user.
"""
from __future__ import annotations
import os
# Swap the DB URL before anything imports app.db.database. Using
# aiosqlite in-memory + shared cache means every connection in the test
# sees the same schema/data.
os.environ["DATABASE_URL"] = "sqlite+aiosqlite:///file:pytest_shared?mode=memory&cache=shared&uri=true"
os.environ["SECRET_KEY"] = "test-secret"

import asyncio
import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.pool import StaticPool

from app.db.database import Base, get_db
from app.api.auth import get_current_user
from app.models import User, Schema, Section, Node, Option, Final, DEFAULT_SCHEMA_ID
from app.main import app


@pytest_asyncio.fixture()
async def engine():
    # StaticPool + shared cache are both needed so every AsyncSession sees
    # the same in-memory database for the duration of one test.
    eng = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    async with eng.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield eng
    await eng.dispose()


@pytest_asyncio.fixture()
async def session_factory(engine):
    return async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


@pytest_asyncio.fixture()
async def db(session_factory) -> AsyncSession:
    async with session_factory() as s:
        yield s


@pytest_asyncio.fixture()
async def admin_user(db) -> User:
    """An admin user that get_current_user will return for every test. We
    bypass password hashing entirely — tests don't need to exercise bcrypt."""
    u = User(username="test-admin", password_hash="x", fio="Test Admin", role="admin")
    db.add(u)
    await db.commit()
    await db.refresh(u)
    return u


@pytest_asyncio.fixture()
async def editor_user(db) -> User:
    u = User(username="test-editor", password_hash="x", fio="Test Editor", role="editor")
    db.add(u)
    await db.commit()
    await db.refresh(u)
    return u


@pytest_asyncio.fixture()
async def client(session_factory, admin_user) -> AsyncClient:
    """HTTPX AsyncClient wired into the FastAPI app with our in-memory DB
    and a fixed admin identity for protected endpoints."""
    async def _override_db():
        async with session_factory() as s:
            yield s

    def _override_user():
        return admin_user

    app.dependency_overrides[get_db] = _override_db
    app.dependency_overrides[get_current_user] = _override_user
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()


@pytest_asyncio.fixture()
async def seeded_schema(db) -> str:
    """Seeds a minimal but realistic schema called 'test' with:
        - overview section
        - root node N1 (single_choice) → N2 via option 'yes'
        - leaf node N2 (info, terminal)
        - final F1 (referenced by an option on N1 'no')
    Returns the schema id.
    """
    sid = "test"
    db.add(Schema(id=sid, name="Test schema", root_node_id=f"{sid}::N1"))
    db.add(Section(id=f"{sid}::overview", schema_id=sid, slug="overview",
                   label="Overview", order=0))
    db.add(Node(id=f"{sid}::N1", schema_id=sid, section="overview",
                text="Start?", input_type="single_choice"))
    db.add(Node(id=f"{sid}::N2", schema_id=sid, section="overview",
                text="End", input_type="info", is_terminal=True))
    db.add(Final(id=f"{sid}::F1", schema_id=sid, diagnosis="Example diagnosis"))
    await db.flush()
    db.add(Option(node_id=f"{sid}::N1", schema_id=sid, option_id="yes",
                  label="Yes", next_node_id=f"{sid}::N2"))
    db.add(Option(node_id=f"{sid}::N1", schema_id=sid, option_id="no",
                  label="No", next_node_id=f"{sid}::F1"))
    await db.commit()
    return sid
