"""Read-only API for the audit log.

Every mutating endpoint writes an `AuditLog` row with (user_id, action,
entity_type, entity_id, old_value, new_value, schema_id, created_at). This
module exposes those rows to the admin UI with filtering + pagination.

Access is restricted to admins — editors shouldn't see who did what.
"""
from typing import Optional
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db
from app.models import AuditLog, User
from app.api.auth import get_current_user

router = APIRouter(prefix="/audit", tags=["audit"])


def _require_admin(user: User) -> None:
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Доступно только администраторам")


@router.get("/")
async def list_audit(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    schema_id: Optional[str] = Query(None),
    entity_type: Optional[str] = Query(None),
    user_id: Optional[int] = Query(None),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> dict:
    """Paginated list of audit events, newest first.

    Joins with the users table so callers get a human-readable author label
    without a second round-trip.
    """
    _require_admin(current_user)

    q = select(AuditLog, User).outerjoin(User, User.id == AuditLog.user_id)
    if schema_id:
        q = q.where(AuditLog.schema_id == schema_id)
    if entity_type:
        q = q.where(AuditLog.entity_type == entity_type)
    if user_id:
        q = q.where(AuditLog.user_id == user_id)

    total = (await db.execute(
        select(func.count()).select_from(q.subquery())
    )).scalar_one()

    q = q.order_by(AuditLog.created_at.desc(), AuditLog.id.desc()).limit(limit).offset(offset)
    rows = (await db.execute(q)).all()

    items = []
    for log, user in rows:
        items.append({
            "id": log.id,
            "created_at": log.created_at,
            "action": log.action,
            "entity_type": log.entity_type,
            "entity_id": log.entity_id,
            "schema_id": log.schema_id,
            "old_value": log.old_value,
            "new_value": log.new_value,
            "user": {
                "id": user.id if user else None,
                "username": user.username if user else None,
                "fio": user.fio if user else None,
            } if user else None,
        })

    return {
        "total": total,
        "limit": limit,
        "offset": offset,
        "items": items,
    }
