"""Tests for the schema validator — GET /api/schemas/{id}/validate."""
import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Schema, Section, Node, Option


@pytest.mark.asyncio
async def test_validate_happy_path(client: AsyncClient, db: AsyncSession, seeded_schema: str):
    r = await client.get(f"/api/schemas/{seeded_schema}/validate")
    assert r.status_code == 200
    body = r.json()
    assert body["is_valid"] is True
    assert body["counts"]["error"] == 0
    assert body["totals"]["nodes"] == 2
    assert body["totals"]["finals"] == 1


@pytest.mark.asyncio
async def test_validate_missing_root(client: AsyncClient, db: AsyncSession):
    """A schema with no root_node_id is not valid — users must see 'root_missing'."""
    db.add(Schema(id="noroot", name="No root", root_node_id=None))
    await db.commit()
    r = await client.get("/api/schemas/noroot/validate")
    body = r.json()
    assert body["is_valid"] is False
    codes = [i["code"] for i in body["issues"]]
    assert "root_missing" in codes


@pytest.mark.asyncio
async def test_validate_dangling_option(client: AsyncClient, db: AsyncSession, seeded_schema: str):
    """An option pointing to a non-existent target must produce an error."""
    # Add a broken option to N1
    db.add(Option(node_id=f"{seeded_schema}::N1", schema_id=seeded_schema,
                  option_id="broken", label="Broken", next_node_id=f"{seeded_schema}::GHOST"))
    await db.commit()
    r = await client.get(f"/api/schemas/{seeded_schema}/validate")
    body = r.json()
    assert body["is_valid"] is False
    codes = [i["code"] for i in body["issues"]]
    assert "option_dangling" in codes


@pytest.mark.asyncio
async def test_validate_unreachable_node(client: AsyncClient, db: AsyncSession, seeded_schema: str):
    """An orphan node with no incoming edges/options must surface as a warning."""
    db.add(Node(id=f"{seeded_schema}::ORPHAN", schema_id=seeded_schema,
                section="overview", text="orphan", input_type="info"))
    await db.commit()
    r = await client.get(f"/api/schemas/{seeded_schema}/validate")
    body = r.json()
    assert any(i["code"] == "node_unreachable" for i in body["issues"])


@pytest.mark.asyncio
async def test_validate_404_on_missing_schema(client: AsyncClient):
    r = await client.get("/api/schemas/does-not-exist/validate")
    assert r.status_code == 404
