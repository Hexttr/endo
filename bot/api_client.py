"""HTTP client for the backend API."""
from __future__ import annotations
from typing import Any, Optional

import httpx

from config import bot_settings

BASE = bot_settings.API_BASE_URL


async def start_session(user_id: str) -> dict:
    async with httpx.AsyncClient() as client:
        resp = await client.post(f"{BASE}/sessions/start", json={"user_id": user_id})
        resp.raise_for_status()
        return resp.json()


async def submit_answer(session_id: int, node_id: str, answer: Any) -> dict:
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{BASE}/sessions/answer",
            json={"session_id": session_id, "node_id": node_id, "answer": answer},
        )
        resp.raise_for_status()
        return resp.json()


async def get_session(session_id: int) -> dict:
    async with httpx.AsyncClient() as client:
        resp = await client.get(f"{BASE}/sessions/{session_id}")
        resp.raise_for_status()
        return resp.json()


async def get_node(node_id: str) -> dict:
    async with httpx.AsyncClient() as client:
        resp = await client.get(f"{BASE}/nodes/{node_id}")
        resp.raise_for_status()
        return resp.json()


async def get_final(final_id: str) -> dict:
    async with httpx.AsyncClient() as client:
        resp = await client.get(f"{BASE}/finals/{final_id}")
        resp.raise_for_status()
        return resp.json()
