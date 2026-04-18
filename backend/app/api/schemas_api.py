"""CRUD for the decision-tree schemas (not to be confused with Pydantic schemas).

A "schema" here is a named bundle: one tree of nodes + options + edges +
finals + classifications that a single Telegram bot can run.
"""
import re
from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db
from app.models import (
    Schema, Node, Option, Edge, Final, Classification, AuditLog, User,
    DEFAULT_SCHEMA_ID,
)
from app.schemas import SchemaRead, SchemaCreate, SchemaUpdate, SchemaClone
from app.api.auth import get_current_user
from app.api._scoping import full_id, short_id, SEP


router = APIRouter(prefix="/schemas", tags=["schemas"])

_SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{1,49}$")


def _validate_slug(slug: str) -> None:
    if not _SLUG_RE.match(slug):
        raise HTTPException(
            status_code=422,
            detail="ID схемы должен состоять из латиницы/цифр/'-'/'_', 2-50 символов, первый — буква или цифра",
        )


@router.get("/", response_model=list[SchemaRead])
async def list_schemas(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Schema).order_by(Schema.id))
    return result.scalars().all()


@router.get("/{schema_id}", response_model=SchemaRead)
async def get_schema(schema_id: str, db: AsyncSession = Depends(get_db)):
    s = (await db.execute(select(Schema).where(Schema.id == schema_id))).scalar_one_or_none()
    if not s:
        raise HTTPException(status_code=404, detail="Schema not found")
    return s


@router.post("/", response_model=SchemaRead, status_code=201)
async def create_schema(
    body: SchemaCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _validate_slug(body.id)
    exists = (await db.execute(select(Schema).where(Schema.id == body.id))).scalar_one_or_none()
    if exists:
        raise HTTPException(status_code=409, detail=f"Schema '{body.id}' already exists")
    s = Schema(id=body.id, name=body.name, description=body.description)
    db.add(s)
    db.add(AuditLog(
        user_id=current_user.id, action="create",
        entity_type="schema", entity_id=body.id,
        new_value={"name": body.name, "description": body.description},
        schema_id=body.id,
    ))
    await db.commit()
    await db.refresh(s)
    return s


@router.patch("/{schema_id}", response_model=SchemaRead)
async def update_schema(
    schema_id: str,
    body: SchemaUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    s = (await db.execute(select(Schema).where(Schema.id == schema_id))).scalar_one_or_none()
    if not s:
        raise HTTPException(status_code=404, detail="Schema not found")
    updates = body.model_dump(exclude_unset=True)
    for k, v in updates.items():
        setattr(s, k, v)
    db.add(AuditLog(
        user_id=current_user.id, action="update",
        entity_type="schema", entity_id=schema_id,
        new_value=updates, schema_id=schema_id,
    ))
    await db.commit()
    await db.refresh(s)
    return s


@router.delete("/{schema_id}", status_code=204)
async def delete_schema(
    schema_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if schema_id == DEFAULT_SCHEMA_ID:
        raise HTTPException(
            status_code=403,
            detail="Нельзя удалить базовую схему 'endo-bot'",
        )
    s = (await db.execute(select(Schema).where(Schema.id == schema_id))).scalar_one_or_none()
    if not s:
        raise HTTPException(status_code=404, detail="Schema not found")
    # Cascade via FK would handle nodes/finals, but also clean loose rows
    # that have schema_id but no FK (options/edges/classifications/sessions).
    await db.execute(delete(Option).where(Option.schema_id == schema_id))
    await db.execute(delete(Edge).where(Edge.schema_id == schema_id))
    await db.execute(delete(Classification).where(Classification.schema_id == schema_id))
    await db.delete(s)
    db.add(AuditLog(
        user_id=current_user.id, action="delete",
        entity_type="schema", entity_id=schema_id,
        schema_id=schema_id,
    ))
    await db.commit()
    return Response(status_code=204)


@router.post("/{schema_id}/clone", response_model=SchemaRead, status_code=201)
async def clone_schema(
    schema_id: str,
    body: SchemaClone,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Deep-copy all nodes/options/edges/finals/classifications from source
    schema into a new schema with the given id + name."""
    _validate_slug(body.new_id)
    src = (await db.execute(select(Schema).where(Schema.id == schema_id))).scalar_one_or_none()
    if not src:
        raise HTTPException(status_code=404, detail="Source schema not found")
    if body.new_id == schema_id:
        raise HTTPException(status_code=422, detail="new_id must differ from source")
    dup = (await db.execute(select(Schema).where(Schema.id == body.new_id))).scalar_one_or_none()
    if dup:
        raise HTTPException(status_code=409, detail=f"Schema '{body.new_id}' already exists")

    new_schema = Schema(id=body.new_id, name=body.new_name, description=body.description)
    db.add(new_schema)
    await db.flush()

    def remap(old: str | None) -> str | None:
        if old is None:
            return None
        s = short_id(old)
        return full_id(body.new_id, s)

    # Nodes
    node_rows = (await db.execute(select(Node).where(Node.schema_id == schema_id))).scalars().all()
    for n in node_rows:
        db.add(Node(
            id=remap(n.id),
            schema_id=body.new_id,
            section=n.section,
            text=n.text,
            description=n.description,
            input_type=n.input_type,
            unknown_action=n.unknown_action,
            is_terminal=n.is_terminal,
            is_pending=n.is_pending,
            return_node=remap(n.return_node),
            allow_multiple=n.allow_multiple,
            extra=n.extra,
            position_x=n.position_x,
            position_y=n.position_y,
            layout_manual=n.layout_manual,
        ))

    # Finals
    final_rows = (await db.execute(select(Final).where(Final.schema_id == schema_id))).scalars().all()
    for f in final_rows:
        db.add(Final(
            id=remap(f.id),
            schema_id=body.new_id,
            diagnosis=f.diagnosis,
            endo_picture=f.endo_picture,
            equipment=f.equipment,
            algorithm=f.algorithm,
            routing=f.routing,
            followup=f.followup,
        ))

    await db.flush()  # nodes + finals must exist before options/edges FK

    # Options
    opt_rows = (await db.execute(select(Option).where(Option.schema_id == schema_id))).scalars().all()
    for o in opt_rows:
        db.add(Option(
            node_id=remap(o.node_id),
            schema_id=body.new_id,
            option_id=o.option_id,
            label=o.label,
            next_node_id=remap(o.next_node_id),
            priority=o.priority,
            extra=o.extra,
        ))

    # Edges
    edge_rows = (await db.execute(select(Edge).where(Edge.schema_id == schema_id))).scalars().all()
    for e in edge_rows:
        db.add(Edge(
            from_node_id=remap(e.from_node_id),
            schema_id=body.new_id,
            to_node_id=remap(e.to_node_id),
            label=e.label,
            condition_logic=e.condition_logic,
            priority=e.priority,
        ))

    # Classifications
    cl_rows = (await db.execute(select(Classification).where(Classification.schema_id == schema_id))).scalars().all()
    for c in cl_rows:
        db.add(Classification(
            id=c.id,
            schema_id=body.new_id,
            name=c.name,
            data=c.data,
        ))

    db.add(AuditLog(
        user_id=current_user.id, action="clone",
        entity_type="schema", entity_id=body.new_id,
        new_value={"cloned_from": schema_id, "name": body.new_name},
        schema_id=body.new_id,
    ))

    await db.commit()
    await db.refresh(new_schema)
    return new_schema
