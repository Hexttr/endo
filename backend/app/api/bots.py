"""CRUD for Telegram bot bindings (one bot per schema).

The orchestrator process reads this table and runs bots accordingly;
this API is purely about configuration. Status fields (`status`,
`last_error`, `started_at`, `username`) are owned by the orchestrator
and should be treated as read-only from the admin panel's perspective.
"""
from __future__ import annotations

import datetime
from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db
from app.models import Bot, Schema, User
from app.schemas import BotRead, BotUpsert, BotEnableToggle
from app.api.auth import get_current_user
from app.api._scoping import resolve_schema_id


router = APIRouter(prefix="/bot", tags=["bots"])


def _project(bot: Bot) -> dict:
    """Serialize a Bot row without leaking the token."""
    return {
        "id": bot.id,
        "schema_id": bot.schema_id,
        "username": bot.username,
        "enabled": bot.enabled,
        "status": bot.status,
        "last_error": bot.last_error,
        "started_at": bot.started_at,
        "updated_at": bot.updated_at,
        "created_at": bot.created_at,
        "has_token": bool(bot.token),
    }


async def _ensure_schema_exists(db: AsyncSession, schema_id: str) -> None:
    exists = (await db.execute(select(Schema).where(Schema.id == schema_id))).scalar_one_or_none()
    if not exists:
        raise HTTPException(status_code=404, detail=f"Schema '{schema_id}' not found")


@router.get("/", response_model=BotRead | None)
async def get_bot(
    schema_id: str = Depends(resolve_schema_id),
    db: AsyncSession = Depends(get_db),
):
    """Return the current binding or null if the schema has no bot yet."""
    await _ensure_schema_exists(db, schema_id)
    bot = (await db.execute(select(Bot).where(Bot.schema_id == schema_id))).scalar_one_or_none()
    if not bot:
        return None
    return _project(bot)


@router.put("/", response_model=BotRead)
async def upsert_bot(
    body: BotUpsert,
    schema_id: str = Depends(resolve_schema_id),
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    """Attach a token to the schema or update the existing binding.

    Setting a new token resets any previous `token_conflict`/`error` state so
    the orchestrator will attempt a fresh start on its next poll.
    """
    await _ensure_schema_exists(db, schema_id)
    token = (body.token or "").strip()
    if len(token) < 20 or ":" not in token:
        raise HTTPException(status_code=422, detail="Telegram token looks malformed (expected format 1234:ABCDEF...)")
    # Prevent the same token from being bound to two schemas — Telegram
    # rejects overlapping getUpdates with 409 anyway, so catch it here.
    conflict = (await db.execute(
        select(Bot).where(Bot.token == token, Bot.schema_id != schema_id)
    )).scalar_one_or_none()
    if conflict:
        raise HTTPException(
            status_code=409,
            detail=f"Этот токен уже привязан к схеме '{conflict.schema_id}'",
        )

    bot = (await db.execute(select(Bot).where(Bot.schema_id == schema_id))).scalar_one_or_none()
    now = datetime.datetime.utcnow()
    if bot:
        token_changed = bot.token != token
        bot.token = token
        if body.enabled is not None:
            bot.enabled = bool(body.enabled)
        if token_changed:
            # Fresh token → clear stale status so orchestrator retries.
            bot.status = "stopped"
            bot.last_error = None
            bot.username = None
        bot.updated_at = now
    else:
        bot = Bot(
            schema_id=schema_id,
            token=token,
            enabled=bool(body.enabled) if body.enabled is not None else True,
            status="stopped",
            created_at=now,
            updated_at=now,
        )
        db.add(bot)
    await db.commit()
    await db.refresh(bot)
    return _project(bot)


@router.patch("/", response_model=BotRead)
async def toggle_enabled(
    body: BotEnableToggle,
    schema_id: str = Depends(resolve_schema_id),
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    await _ensure_schema_exists(db, schema_id)
    bot = (await db.execute(select(Bot).where(Bot.schema_id == schema_id))).scalar_one_or_none()
    if not bot:
        raise HTTPException(status_code=404, detail="Bot not bound to this schema")
    bot.enabled = bool(body.enabled)
    bot.updated_at = datetime.datetime.utcnow()
    # Flipping the switch should not by itself erase stored errors.
    if body.enabled:
        # Wake up orchestrator on next poll by clearing the previous hard stop.
        if bot.status in ("stopped", "error"):
            bot.status = "stopped"
    await db.commit()
    await db.refresh(bot)
    return _project(bot)


@router.delete("/", status_code=204)
async def delete_bot(
    schema_id: str = Depends(resolve_schema_id),
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    await _ensure_schema_exists(db, schema_id)
    bot = (await db.execute(select(Bot).where(Bot.schema_id == schema_id))).scalar_one_or_none()
    if bot:
        await db.delete(bot)
        await db.commit()
    return Response(status_code=204)
