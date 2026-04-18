from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db
from app.models import Final, Edge, Option, AuditLog, User
from app.schemas import FinalRead, FinalCreate, FinalUpdate
from app.api.auth import get_current_user
from app.api._scoping import resolve_schema_id, full_id, short_id

router = APIRouter(prefix="/finals", tags=["finals"])


def _project_final(f: Final) -> dict:
    return {
        "id": short_id(f.id),
        "diagnosis": f.diagnosis,
        "endo_picture": f.endo_picture,
        "equipment": f.equipment,
        "algorithm": f.algorithm,
        "routing": f.routing,
        "followup": f.followup,
    }


@router.get("/", response_model=list[FinalRead])
async def list_finals(
    db: AsyncSession = Depends(get_db),
    schema_id: str = Depends(resolve_schema_id),
):
    result = await db.execute(
        select(Final).where(Final.schema_id == schema_id).order_by(Final.id)
    )
    return [_project_final(f) for f in result.scalars().all()]


@router.get("/{final_id}", response_model=FinalRead)
async def get_final(
    final_id: str,
    db: AsyncSession = Depends(get_db),
    schema_id: str = Depends(resolve_schema_id),
):
    fid = full_id(schema_id, final_id)
    result = await db.execute(
        select(Final).where(Final.id == fid, Final.schema_id == schema_id)
    )
    final = result.scalar_one_or_none()
    if not final:
        raise HTTPException(status_code=404, detail="Final not found")
    return _project_final(final)


@router.post("/", response_model=FinalRead, status_code=201)
async def create_final(
    body: FinalCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    schema_id: str = Depends(resolve_schema_id),
):
    fid = full_id(schema_id, body.id)
    existing = (await db.execute(select(Final).where(Final.id == fid))).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=409, detail=f"Final '{body.id}' already exists in '{schema_id}'")

    payload = body.model_dump()
    payload["id"] = fid
    payload["schema_id"] = schema_id
    final = Final(**payload)
    db.add(final)
    db.add(AuditLog(
        user_id=current_user.id, action="create",
        entity_type="final", entity_id=body.id,
        new_value=body.model_dump(), schema_id=schema_id,
    ))
    await db.commit()
    await db.refresh(final)
    return _project_final(final)


@router.patch("/{final_id}", response_model=FinalRead)
async def update_final(
    final_id: str,
    body: FinalUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    schema_id: str = Depends(resolve_schema_id),
):
    fid = full_id(schema_id, final_id)
    result = await db.execute(
        select(Final).where(Final.id == fid, Final.schema_id == schema_id)
    )
    final = result.scalar_one_or_none()
    if not final:
        raise HTTPException(status_code=404, detail="Final not found")

    old_values = {"diagnosis": final.diagnosis, "routing": final.routing}
    updates = body.model_dump(exclude_unset=True)
    for key, value in updates.items():
        setattr(final, key, value)

    db.add(AuditLog(
        user_id=current_user.id, action="update",
        entity_type="final", entity_id=final_id,
        old_value=old_values, new_value=updates, schema_id=schema_id,
    ))
    await db.commit()
    await db.refresh(final)
    return _project_final(final)


@router.delete("/{final_id}", status_code=204)
async def delete_final(
    final_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    schema_id: str = Depends(resolve_schema_id),
):
    fid = full_id(schema_id, final_id)
    final = (await db.execute(
        select(Final).where(Final.id == fid, Final.schema_id == schema_id)
    )).scalar_one_or_none()
    if not final:
        raise HTTPException(status_code=404, detail="Final not found")

    incoming_edges = (await db.execute(
        select(func.count()).select_from(Edge)
        .where(Edge.to_node_id == fid, Edge.schema_id == schema_id)
    )).scalar()
    incoming_opts = (await db.execute(
        select(func.count()).select_from(Option)
        .where(Option.next_node_id == fid, Option.schema_id == schema_id)
    )).scalar()
    refs = incoming_edges + incoming_opts
    if refs > 0:
        raise HTTPException(
            status_code=409,
            detail=f"Cannot delete: {refs} incoming references. Remove them first.",
        )

    db.add(AuditLog(
        user_id=current_user.id, action="delete",
        entity_type="final", entity_id=final_id,
        old_value={"diagnosis": final.diagnosis}, schema_id=schema_id,
    ))
    await db.delete(final)
    await db.commit()
    return Response(status_code=204)
