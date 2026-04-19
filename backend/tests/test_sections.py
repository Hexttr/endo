"""API tests for /api/sections/ CRUD."""
import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_create_list_update_delete_section(client: AsyncClient, seeded_schema: str):
    headers = {"X-Schema-Id": seeded_schema}

    r = await client.post("/api/sections/", json={
        "slug": "tests",
        "label": "Testing",
        "description": "only for tests",
        "color": "blue",
        "order": 10,
    }, headers=headers)
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["slug"] == "tests"
    assert body["node_count"] == 0

    r = await client.get("/api/sections/", headers=headers)
    assert r.status_code == 200
    slugs = {s["slug"] for s in r.json()}
    # seeded_schema comes with "overview", plus our new "tests"
    assert slugs == {"overview", "tests"}

    r = await client.patch("/api/sections/tests", json={"label": "Renamed"}, headers=headers)
    assert r.status_code == 200
    assert r.json()["label"] == "Renamed"

    r = await client.delete("/api/sections/tests", headers=headers)
    assert r.status_code == 204


@pytest.mark.asyncio
async def test_create_duplicate_slug_rejected(client: AsyncClient, seeded_schema: str):
    headers = {"X-Schema-Id": seeded_schema}
    payload = {"slug": "dup", "label": "D", "order": 0}
    r1 = await client.post("/api/sections/", json=payload, headers=headers)
    assert r1.status_code == 201
    r2 = await client.post("/api/sections/", json=payload, headers=headers)
    assert r2.status_code == 409


@pytest.mark.asyncio
async def test_delete_section_with_nodes_requires_reassign(client: AsyncClient, seeded_schema: str):
    """The seeded schema has 'overview' with 2 nodes in it — deleting it
    without ?reassign_to must return 409, and with it must succeed."""
    headers = {"X-Schema-Id": seeded_schema}

    # Create a second section to reassign to.
    r = await client.post("/api/sections/", json={"slug": "backup", "label": "B", "order": 1}, headers=headers)
    assert r.status_code == 201

    # Without reassign — 409.
    r = await client.delete("/api/sections/overview", headers=headers)
    assert r.status_code == 409

    # With reassign — 204, and nodes end up in 'backup'.
    r = await client.delete("/api/sections/overview?reassign_to=backup", headers=headers)
    assert r.status_code == 204

    r = await client.get("/api/sections/", headers=headers)
    body = r.json()
    backup = next(s for s in body if s["slug"] == "backup")
    assert backup["node_count"] == 2
