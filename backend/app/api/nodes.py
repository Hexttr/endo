from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.db.database import get_db
from app.models import Node, AuditLog, User
from app.schemas import NodeRead, NodeUpdate
from app.api.auth import get_current_user

router = APIRouter(prefix="/nodes", tags=["nodes"])


@router.get("/", response_model=list[NodeRead])
async def list_nodes(
    section: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    q = select(Node).options(selectinload(Node.options))
    if section:
        q = q.where(Node.section == section)
    result = await db.execute(q.order_by(Node.id))
    return result.scalars().all()


@router.get("/{node_id}", response_model=NodeRead)
async def get_node(node_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Node).options(selectinload(Node.options)).where(Node.id == node_id)
    )
    node = result.scalar_one_or_none()
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")
    return node


@router.patch("/{node_id}", response_model=NodeRead)
async def update_node(
    node_id: str,
    body: NodeUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Node).options(selectinload(Node.options)).where(Node.id == node_id)
    )
    node = result.scalar_one_or_none()
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")

    old_values = {"text": node.text, "input_type": node.input_type}
    updates = body.model_dump(exclude_unset=True)
    for key, value in updates.items():
        setattr(node, key, value)

    audit = AuditLog(
        user_id=current_user.id,
        action="update",
        entity_type="node",
        entity_id=node_id,
        old_value=old_values,
        new_value=updates,
    )
    db.add(audit)
    await db.commit()
    await db.refresh(node)
    return node


@router.get("/sections/list", response_model=list[str])
async def list_sections(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Node.section).distinct().order_by(Node.section))
    return [row[0] for row in result.all()]
