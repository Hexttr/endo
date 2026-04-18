"""Helpers for multi-schema entity scoping.

We store node/final IDs internally as "{schema_id}::{short_id}".
Client code deals only with short IDs. These helpers convert between
the two forms and provide a FastAPI dependency that resolves the
schema_id from either a URL path parameter or the X-Schema-Id header,
defaulting to 'endo-bot' for legacy (un-scoped) routes used by the bot.
"""
from typing import Optional
from fastapi import Header, Request

from app.models import DEFAULT_SCHEMA_ID


SEP = "::"


def full_id(schema_id: str, short_id: Optional[str]) -> Optional[str]:
    """Return the fully-qualified internal ID for a short ID."""
    if short_id is None:
        return None
    if SEP in short_id:
        # already fully qualified, leave alone (defensive)
        return short_id
    return f"{schema_id}{SEP}{short_id}"


def short_id(full: Optional[str]) -> Optional[str]:
    """Strip the schema prefix from an internal ID."""
    if full is None:
        return None
    if SEP not in full:
        return full
    return full.split(SEP, 1)[1]


def schema_of(full: Optional[str]) -> Optional[str]:
    if full is None or SEP not in full:
        return None
    return full.split(SEP, 1)[0]


def resolve_schema_id(
    request: Request,
    x_schema_id: Optional[str] = Header(default=None, alias="X-Schema-Id"),
) -> str:
    """Extract schema_id from path, header, or fall back to default.

    Precedence:
      1. `schema_id` URL path parameter (when route is under /api/schemas/{sid}/...)
      2. `X-Schema-Id` header (admin panel sets this based on SchemaContext)
      3. 'endo-bot' default (bot + other legacy callers)
    """
    return request.path_params.get("schema_id") or x_schema_id or DEFAULT_SCHEMA_ID
