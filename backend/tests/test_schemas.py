"""API tests for /api/schemas/ CRUD — the multi-schema registry."""
import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession


@pytest.mark.asyncio
async def test_create_schema_seeds_default_section(client: AsyncClient):
    r = await client.post("/api/schemas/", json={
        "id": "my-schema", "name": "My Schema", "description": "d",
    })
    assert r.status_code == 201, r.text

    # The endpoint seeds a single 'overview' section so users can add nodes
    # immediately — check that.
    r = await client.get("/api/sections/", headers={"X-Schema-Id": "my-schema"})
    slugs = {s["slug"] for s in r.json()}
    assert slugs == {"overview"}


@pytest.mark.asyncio
async def test_cannot_delete_default_schema(client: AsyncClient):
    # The endo-bot schema is seeded on app startup as a protected default.
    # Manually add it since tests use a fresh DB.
    from app.models import Schema
    from sqlalchemy import select

    # Fetch the scope we need via the API instead of mucking with DB directly.
    await client.post("/api/schemas/", json={"id": "endo-bot", "name": "Default"})

    r = await client.delete("/api/schemas/endo-bot")
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_update_root_node_rejects_foreign_schema_node(
    client: AsyncClient, seeded_schema: str,
):
    """Attempting to set root_node_id to a node from another schema must 422.
    Otherwise a bot could 'point' into an entirely different tree."""
    # Create a second empty schema.
    r = await client.post("/api/schemas/", json={"id": "other", "name": "Other"})
    assert r.status_code == 201

    # Try setting 'other'.root_node_id to seeded_schema's node N1.
    r = await client.patch("/api/schemas/other", json={"root_node_id": f"{seeded_schema}::N1"})
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_invalid_schema_id_rejected(client: AsyncClient):
    r = await client.post("/api/schemas/", json={"id": "Not A Valid ID", "name": "x"})
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_first_node_becomes_root_automatically(client: AsyncClient):
    """Create a fresh schema and a single node — schema.root_node_id must be
    populated automatically so the bot starts responding immediately."""
    await client.post("/api/schemas/", json={"id": "auto", "name": "Auto"})

    headers = {"X-Schema-Id": "auto"}
    r = await client.post("/api/nodes/", json={
        "id": "FIRST", "section": "overview",
        "text": "Hello", "input_type": "info",
    }, headers=headers)
    assert r.status_code == 201, r.text

    r = await client.get("/api/schemas/auto")
    assert r.json()["root_node_id"] == "FIRST"


@pytest.mark.asyncio
async def test_second_node_does_not_override_root(client: AsyncClient):
    """The auto-root heuristic must not trample an explicitly-set root."""
    await client.post("/api/schemas/", json={"id": "pinned", "name": "Pinned"})
    headers = {"X-Schema-Id": "pinned"}
    await client.post("/api/nodes/", json={
        "id": "A", "section": "overview", "text": "a", "input_type": "info",
    }, headers=headers)
    # Second node — must not bump root_node_id away from 'A'.
    await client.post("/api/nodes/", json={
        "id": "B", "section": "overview", "text": "b", "input_type": "info",
    }, headers=headers)
    r = await client.get("/api/schemas/pinned")
    assert r.json()["root_node_id"] == "A"
