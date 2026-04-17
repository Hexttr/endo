from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db
from app.models import Final, AuditLog, User
from app.schemas import FinalRead, FinalUpdate
from app.api.auth import get_current_user

router = APIRouter(prefix="/finals", tags=["finals"])


@router.get("/", response_model=list[FinalRead])
async def list_finals(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Final).order_by(Final.id))
    return result.scalars().all()


@router.get("/{final_id}", response_model=FinalRead)
async def get_final(final_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Final).where(Final.id == final_id))
    final = result.scalar_one_or_none()
    if not final:
        raise HTTPException(status_code=404, detail="Final not found")
    return final


@router.patch("/{final_id}", response_model=FinalRead)
async def update_final(
    final_id: str,
    body: FinalUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(select(Final).where(Final.id == final_id))
    final = result.scalar_one_or_none()
    if not final:
        raise HTTPException(status_code=404, detail="Final not found")

    old_values = {"diagnosis": final.diagnosis, "routing": final.routing}
    updates = body.model_dump(exclude_unset=True)
    for key, value in updates.items():
        setattr(final, key, value)

    audit = AuditLog(
        user_id=current_user.id,
        action="update",
        entity_type="final",
        entity_id=final_id,
        old_value=old_values,
        new_value=updates,
    )
    db.add(audit)
    await db.commit()
    await db.refresh(final)
    return final
