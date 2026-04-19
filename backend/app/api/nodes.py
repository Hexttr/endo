from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.db.database import get_db
from app.models import Node, Option, Edge, Section, Schema, AuditLog, User
from app.schemas import (
    NodeRead, NodeCreate, NodeUpdate, NodePositionUpdate,
    OptionRead, OptionCreate, OptionUpdate,
)
from app.api.auth import get_current_user
from app.api._scoping import resolve_schema_id, full_id, short_id


router = APIRouter(prefix="/nodes", tags=["nodes"])


# ── ID projection helpers (turn internal rows into API-facing shapes) ──

def _project_node(node: Node) -> dict:
    """Convert a Node ORM row into a plain dict where every ID is the short
    (un-prefixed) form — matching the NodeRead contract."""
    return {
        "id": short_id(node.id),
        "section": node.section,
        "text": node.text,
        "description": node.description,
        "input_type": node.input_type,
        "unknown_action": node.unknown_action,
        "is_terminal": node.is_terminal,
        "is_pending": node.is_pending,
        "return_node": short_id(node.return_node),
        "allow_multiple": node.allow_multiple,
        "extra": node.extra,
        "position_x": node.position_x,
        "position_y": node.position_y,
        "layout_manual": node.layout_manual,
        "options": [_project_option(o) for o in (node.options or [])],
    }


async def _ensure_section(db: AsyncSession, schema_id: str, slug: str) -> None:
    """Lazily create a Section row if the caller references a new slug.

    The composite FK on Node.section requires a matching Section row. Rather
    than making every node-create call error out when the slug is new, we
    auto-register it here (admin can rename/recolour later from the Dashboard).
    Idempotent — does nothing if the section already exists.
    """
    if not slug:
        return
    existing = (await db.execute(
        select(Section).where(Section.schema_id == schema_id, Section.slug == slug)
    )).scalar_one_or_none()
    if existing:
        return
    db.add(Section(
        id=f"{schema_id}::{slug}",
        schema_id=schema_id,
        slug=slug,
        label=slug,
        order=0,
    ))
    await db.flush()


def _project_option(opt: Option) -> dict:
    return {
        "id": opt.id,
        "option_id": opt.option_id,
        "label": opt.label,
        "next_node_id": short_id(opt.next_node_id),
        "priority": opt.priority,
        "extra": opt.extra,
    }


# ── Meta ──────────────────────────────────────────────────────────

@router.get("/sections/list", response_model=list[str])
async def list_sections(
    db: AsyncSession = Depends(get_db),
    schema_id: str = Depends(resolve_schema_id),
):
    result = await db.execute(
        select(Node.section).where(Node.schema_id == schema_id).distinct().order_by(Node.section)
    )
    return [row[0] for row in result.all()]


# ── Layout positions (declared BEFORE /{node_id}) ─────────────────

@router.patch("/layout/positions", status_code=204)
async def batch_update_positions(
    positions: list[NodePositionUpdate],
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    schema_id: str = Depends(resolve_schema_id),
):
    if not positions:
        return Response(status_code=204)
    full_ids = [full_id(schema_id, p.id) for p in positions]
    result = await db.execute(
        select(Node).where(Node.id.in_(full_ids), Node.schema_id == schema_id)
    )
    nodes_by_id = {n.id: n for n in result.scalars().all()}
    for p in positions:
        n = nodes_by_id.get(full_id(schema_id, p.id))
        if not n:
            continue
        n.position_x = p.position_x
        n.position_y = p.position_y
        n.layout_manual = p.layout_manual
    await db.commit()
    return Response(status_code=204)


@router.post("/layout/reset", status_code=204)
async def reset_layout(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    schema_id: str = Depends(resolve_schema_id),
):
    result = await db.execute(
        select(Node).where(Node.schema_id == schema_id, Node.layout_manual == True)  # noqa: E712
    )
    count = 0
    for n in result.scalars().all():
        n.layout_manual = False
        n.position_x = None
        n.position_y = None
        count += 1
    db.add(AuditLog(
        user_id=current_user.id, action="reset_layout",
        entity_type="node", entity_id="*",
        new_value={"reset_count": count}, schema_id=schema_id,
    ))
    await db.commit()
    return Response(status_code=204)


# ── Node CRUD ─────────────────────────────────────────────────────

@router.get("/", response_model=list[NodeRead])
async def list_nodes(
    section: str | None = None,
    db: AsyncSession = Depends(get_db),
    schema_id: str = Depends(resolve_schema_id),
):
    q = select(Node).options(selectinload(Node.options)).where(Node.schema_id == schema_id)
    if section:
        q = q.where(Node.section == section)
    result = await db.execute(q.order_by(Node.id))
    return [_project_node(n) for n in result.scalars().all()]


@router.get("/{node_id}", response_model=NodeRead)
async def get_node(
    node_id: str,
    db: AsyncSession = Depends(get_db),
    schema_id: str = Depends(resolve_schema_id),
):
    result = await db.execute(
        select(Node).options(selectinload(Node.options))
        .where(Node.id == full_id(schema_id, node_id), Node.schema_id == schema_id)
    )
    node = result.scalar_one_or_none()
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")
    return _project_node(node)


@router.post("/", response_model=NodeRead, status_code=201)
async def create_node(
    body: NodeCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    schema_id: str = Depends(resolve_schema_id),
):
    fid = full_id(schema_id, body.id)
    existing = (await db.execute(select(Node).where(Node.id == fid))).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=409, detail=f"Node '{body.id}' already exists in '{schema_id}'")

    payload = body.model_dump()
    payload["id"] = fid
    payload["return_node"] = full_id(schema_id, body.return_node) if body.return_node else None
    payload["schema_id"] = schema_id
    await _ensure_section(db, schema_id, body.section)
    node = Node(**payload)
    db.add(node)
    db.add(AuditLog(
        user_id=current_user.id, action="create",
        entity_type="node", entity_id=body.id,
        new_value=body.model_dump(), schema_id=schema_id,
    ))

    # Convenience: if this is the very first node in the schema and the schema
    # has no root configured yet, auto-promote this node to root. Users creating
    # a brand-new schema otherwise have to remember to visit /schemas and set
    # the starting node by hand — we've watched this be the #1 reason new bots
    # "don't respond" after a fresh setup.
    schema_row = (await db.execute(
        select(Schema).where(Schema.id == schema_id)
    )).scalar_one_or_none()
    if schema_row and not schema_row.root_node_id:
        schema_row.root_node_id = fid
        db.add(AuditLog(
            user_id=current_user.id, action="update",
            entity_type="schema", entity_id=schema_id,
            new_value={"root_node_id": short_id(fid), "auto_set": True},
            schema_id=schema_id,
        ))

    await db.commit()
    result = await db.execute(
        select(Node).options(selectinload(Node.options)).where(Node.id == fid)
    )
    return _project_node(result.scalar_one())


@router.patch("/{node_id}", response_model=NodeRead)
async def update_node(
    node_id: str,
    body: NodeUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    schema_id: str = Depends(resolve_schema_id),
):
    fid = full_id(schema_id, node_id)
    result = await db.execute(
        select(Node).options(selectinload(Node.options))
        .where(Node.id == fid, Node.schema_id == schema_id)
    )
    node = result.scalar_one_or_none()
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")

    old_values = {"text": node.text, "input_type": node.input_type}
    updates = body.model_dump(exclude_unset=True)
    if "return_node" in updates:
        updates["return_node"] = full_id(schema_id, updates["return_node"]) if updates["return_node"] else None
    if "section" in updates and updates["section"]:
        # Lazy-register the target section so the composite FK can resolve.
        await _ensure_section(db, schema_id, updates["section"])
    for key, value in updates.items():
        setattr(node, key, value)

    db.add(AuditLog(
        user_id=current_user.id, action="update",
        entity_type="node", entity_id=node_id,
        old_value=old_values, new_value=body.model_dump(exclude_unset=True),
        schema_id=schema_id,
    ))
    await db.commit()
    await db.refresh(node, attribute_names=["options"])
    return _project_node(node)


@router.delete("/{node_id}", status_code=204)
async def delete_node(
    node_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    schema_id: str = Depends(resolve_schema_id),
):
    fid = full_id(schema_id, node_id)
    result = await db.execute(
        select(Node).options(selectinload(Node.options))
        .where(Node.id == fid, Node.schema_id == schema_id)
    )
    node = result.scalar_one_or_none()
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")

    incoming_edges = await db.execute(
        select(func.count()).select_from(Edge).where(
            Edge.to_node_id == fid, Edge.schema_id == schema_id,
        )
    )
    incoming_opts = await db.execute(
        select(func.count()).select_from(Option).where(
            Option.next_node_id == fid, Option.schema_id == schema_id,
        )
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
        schema_id=schema_id,
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
    schema_id: str = Depends(resolve_schema_id),
):
    fid = full_id(schema_id, node_id)
    node = (await db.execute(select(Node).where(Node.id == fid, Node.schema_id == schema_id))).scalar_one_or_none()
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")

    data = body.model_dump()
    next_nid = data.pop("next_node_id", None)
    option = Option(
        node_id=fid, schema_id=schema_id,
        next_node_id=full_id(schema_id, next_nid) if next_nid else None,
        **data,
    )
    db.add(option)
    db.add(AuditLog(
        user_id=current_user.id, action="create",
        entity_type="option", entity_id=f"{node_id}/{body.option_id}",
        new_value=body.model_dump(), schema_id=schema_id,
    ))
    await db.commit()
    await db.refresh(option)
    return _project_option(option)


@router.patch("/{node_id}/options/{option_db_id}", response_model=OptionRead)
async def update_option(
    node_id: str,
    option_db_id: int,
    body: OptionUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    schema_id: str = Depends(resolve_schema_id),
):
    fid = full_id(schema_id, node_id)
    option = (await db.execute(
        select(Option).where(
            Option.id == option_db_id, Option.node_id == fid, Option.schema_id == schema_id,
        )
    )).scalar_one_or_none()
    if not option:
        raise HTTPException(status_code=404, detail="Option not found")

    old_values = {"label": option.label, "next_node_id": short_id(option.next_node_id)}
    updates = body.model_dump(exclude_unset=True)
    if "next_node_id" in updates:
        updates["next_node_id"] = full_id(schema_id, updates["next_node_id"]) if updates["next_node_id"] else None
    for key, value in updates.items():
        setattr(option, key, value)

    db.add(AuditLog(
        user_id=current_user.id, action="update",
        entity_type="option", entity_id=f"{node_id}/{option.option_id}",
        old_value=old_values, new_value=body.model_dump(exclude_unset=True),
        schema_id=schema_id,
    ))
    await db.commit()
    await db.refresh(option)
    return _project_option(option)


@router.delete("/{node_id}/options/{option_db_id}", status_code=204)
async def delete_option(
    node_id: str,
    option_db_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    schema_id: str = Depends(resolve_schema_id),
):
    fid = full_id(schema_id, node_id)
    option = (await db.execute(
        select(Option).where(
            Option.id == option_db_id, Option.node_id == fid, Option.schema_id == schema_id,
        )
    )).scalar_one_or_none()
    if not option:
        raise HTTPException(status_code=404, detail="Option not found")

    db.add(AuditLog(
        user_id=current_user.id, action="delete",
        entity_type="option", entity_id=f"{node_id}/{option.option_id}",
        old_value={"label": option.label, "next_node_id": short_id(option.next_node_id)},
        schema_id=schema_id,
    ))
    await db.delete(option)
    await db.commit()
    return Response(status_code=204)
