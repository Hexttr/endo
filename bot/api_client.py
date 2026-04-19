"""HTTP client for the backend API.

Multi-schema aware: every call accepts a schema_id, which is forwarded to
the backend via the `X-Schema-Id` header. The backend resolves the header
in `app.api._scoping.resolve_schema_id`.

History: earlier revisions used path-scoped URLs like
`/api/schemas/{schema_id}/sessions/start`. Those duplicate routes were
removed during the v5 refactor, so the client now uses the un-scoped
endpoints + the X-Schema-Id header. Same behaviour, one source of truth.
"""
from __future__ import annotations
from typing import Any

import httpx

from config import bot_settings

BASE = bot_settings.API_BASE_URL.rstrip("/")


def _headers(schema_id: str) -> dict:
    return {"X-Schema-Id": schema_id}


async def start_session(schema_id: str, user_id: str) -> dict:
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.post(
            f"{BASE}/sessions/start",
            json={"user_id": user_id},
            headers=_headers(schema_id),
        )
        resp.raise_for_status()
        return resp.json()


async def submit_answer(schema_id: str, session_id: int, node_id: str, answer: Any) -> dict:
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.post(
            f"{BASE}/sessions/answer",
            json={"session_id": session_id, "node_id": node_id, "answer": answer},
            headers=_headers(schema_id),
        )
        resp.raise_for_status()
        return resp.json()


async def get_session(schema_id: str, session_id: int) -> dict:
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.get(
            f"{BASE}/sessions/{session_id}",
            headers=_headers(schema_id),
        )
        resp.raise_for_status()
        return resp.json()


async def get_node(schema_id: str, node_id: str) -> dict:
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.get(
            f"{BASE}/nodes/{node_id}",
            headers=_headers(schema_id),
        )
        resp.raise_for_status()
        return resp.json()


async def get_final(schema_id: str, final_id: str) -> dict:
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.get(
            f"{BASE}/finals/{final_id}",
            headers=_headers(schema_id),
        )
        resp.raise_for_status()
        return resp.json()
