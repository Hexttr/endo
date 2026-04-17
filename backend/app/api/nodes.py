from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.db.database import get_db
from app.models import Node, Option, Edge, AuditLog, User
from app.schemas import (
    NodeRead, NodeCreate, NodeUpdate,
    OptionRead, OptionCreate, OptionUpdate,
)
from app.api.auth import get_current_user

router = APIRouter(prefix="/nodes", tags=["nodes"])


# ── Node CRUD ──────────────────────────────────────────────────────

@router.get("/sections/list", response_model=list[str])
async def list_sections(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Node.section).distinct().order_by(Node.section))
    return [row[0] for row in result.all()]


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


@router.post("/", response_model=NodeRead, status_code=201)
async def create_node(
    body: NodeCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    existing = await db.execute(select(Node).where(Node.id == body.id))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail=f"Node '{body.id}' already exists")

    node = Node(**body.model_dump())
    db.add(node)
    db.add(AuditLog(
        user_id=current_user.id, action="create",
        entity_type="node", entity_id=body.id,
        new_value=body.model_dump(),
    ))
    await db.commit()
    result = await db.execute(
        select(Node).options(selectinload(Node.options)).where(Node.id == body.id)
    )
    return result.scalar_one()


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

    db.add(AuditLog(
        user_id=current_user.id, action="update",
        entity_type="node", entity_id=node_id,
        old_value=old_values, new_value=updates,
    ))
    await db.commit()
    await db.refresh(node)
    return node


@router.delete("/{node_id}", status_code=204)
async def delete_node(
    node_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Node).options(selectinload(Node.options)).where(Node.id == node_id)
    )
    node = result.scalar_one_or_none()
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")

    incoming_edges = await db.execute(
        select(func.count()).select_from(Edge).where(Edge.to_node_id == node_id)
    )
    incoming_opts = await db.execute(
        select(func.count()).select_from(Option).where(Option.next_node_id == node_id)
    )
    refs = incoming_edges.scalar() + incoming_opts.scalar()
    if refs > 0:
        raise HTTPException(
            status_code=409,
            detail=f"Cannot delete: {refs} incoming references. Remove them first.",
        )

    db.add(AuditLog(
        user_id=current_user.id, action="delete",
        entity_type="node", entity_id=node_id,
        old_value={"text": node.text, "section": node.section},
    ))
    await db.delete(node)
    await db.commit()
    return Response(status_code=204)


# ── Option CRUD (sub-resource of node) ────────────────────────────

@router.post("/{node_id}/options", response_model=OptionRead, status_code=201)
async def create_option(
    node_id: str,
    body: OptionCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    node = (await db.execute(select(Node).where(Node.id == node_id))).scalar_one_or_none()
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")

    option = Option(node_id=node_id, **body.model_dump())
    db.add(option)
    db.add(AuditLog(
        user_id=current_user.id, action="create",
        entity_type="option", entity_id=f"{node_id}/{body.option_id}",
        new_value=body.model_dump(),
    ))
    await db.commit()
    await db.refresh(option)
    return option


@router.patch("/{node_id}/options/{option_db_id}", response_model=OptionRead)
async def update_option(
    node_id: str,
    option_db_id: int,
    body: OptionUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    option = (await db.execute(
        select(Option).where(Option.id == option_db_id, Option.node_id == node_id)
    )).scalar_one_or_none()
    if not option:
        raise HTTPException(status_code=404, detail="Option not found")

    old_values = {"label": option.label, "next_node_id": option.next_node_id}
    updates = body.model_dump(exclude_unset=True)
    for key, value in updates.items():
        setattr(option, key, value)

    db.add(AuditLog(
        user_id=current_user.id, action="update",
        entity_type="option", entity_id=f"{node_id}/{option.option_id}",
        old_value=old_values, new_value=updates,
    ))
    await db.commit()
    await db.refresh(option)
    return option


@router.delete("/{node_id}/options/{option_db_id}", status_code=204)
async def delete_option(
    node_id: str,
    option_db_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    option = (await db.execute(
        select(Option).where(Option.id == option_db_id, Option.node_id == node_id)
    )).scalar_one_or_none()
    if not option:
        raise HTTPException(status_code=404, detail="Option not found")

    db.add(AuditLog(
        user_id=current_user.id, action="delete",
        entity_type="option", entity_id=f"{node_id}/{option.option_id}",
        old_value={"label": option.label, "next_node_id": option.next_node_id},
    ))
    await db.delete(option)
    await db.commit()
    return Response(status_code=204)
