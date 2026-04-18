"""HTTP client for the backend API.

Multi-schema aware: every call accepts a schema_id and targets the
schema-scoped endpoints under `/api/schemas/{schema_id}/...`. The schema_id
is provided by the caller (typically taken from `context.bot_data["schema_id"]`
which the orchestrator sets at Application build time).
"""
from __future__ import annotations
from typing import Any

import httpx

from config import bot_settings

BASE = bot_settings.API_BASE_URL.rstrip("/")


def _scoped(schema_id: str, path: str) -> str:
    return f"{BASE}/schemas/{schema_id}{path}"


async def start_session(schema_id: str, user_id: str) -> dict:
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.post(
            _scoped(schema_id, "/sessions/start"),
            json={"user_id": user_id},
        )
        resp.raise_for_status()
        return resp.json()


async def submit_answer(schema_id: str, session_id: int, node_id: str, answer: Any) -> dict:
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.post(
            _scoped(schema_id, "/sessions/answer"),
            json={"session_id": session_id, "node_id": node_id, "answer": answer},
        )
        resp.raise_for_status()
        return resp.json()


async def get_session(schema_id: str, session_id: int) -> dict:
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.get(_scoped(schema_id, f"/sessions/{session_id}"))
        resp.raise_for_status()
        return resp.json()


async def get_node(schema_id: str, node_id: str) -> dict:
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.get(_scoped(schema_id, f"/nodes/{node_id}"))
        resp.raise_for_status()
        return resp.json()


async def get_final(schema_id: str, final_id: str) -> dict:
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.get(_scoped(schema_id, f"/finals/{final_id}"))
        resp.raise_for_status()
        return resp.json()
