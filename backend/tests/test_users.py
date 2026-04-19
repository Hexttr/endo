"""API tests for /api/users/ admin CRUD."""
import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_create_user(client: AsyncClient):
    r = await client.post("/api/users/", json={
        "username": "alice", "password": "secretpw", "fio": "Alice A.", "role": "editor",
    })
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["username"] == "alice"
    assert body["role"] == "editor"
    assert "password" not in body  # never leaks


@pytest.mark.asyncio
async def test_list_users_contains_admin(client: AsyncClient, admin_user):
    r = await client.get("/api/users/")
    assert r.status_code == 200
    usernames = [u["username"] for u in r.json()]
    assert admin_user.username in usernames


@pytest.mark.asyncio
async def test_duplicate_username_rejected(client: AsyncClient):
    payload = {"username": "bob", "password": "secretpw", "role": "editor"}
    r1 = await client.post("/api/users/", json=payload)
    assert r1.status_code == 201
    r2 = await client.post("/api/users/", json=payload)
    assert r2.status_code == 409


@pytest.mark.asyncio
async def test_cannot_demote_last_admin(client: AsyncClient, admin_user):
    """Single admin cannot revoke their own role — UI would be unreachable."""
    r = await client.patch(f"/api/users/{admin_user.id}", json={"role": "editor"})
    assert r.status_code == 409


@pytest.mark.asyncio
async def test_short_password_rejected(client: AsyncClient):
    r = await client.post("/api/users/", json={
        "username": "pw-short", "password": "123", "role": "editor",
    })
    assert r.status_code == 400
