from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db
from app.models import Edge, Node, Final, AuditLog, User
from app.schemas import EdgeRead, EdgeCreate, EdgeUpdate
from app.api.auth import get_current_user
from app.api._scoping import resolve_schema_id, full_id, short_id

router = APIRouter(prefix="/edges", tags=["edges"])


def _project_edge(e: Edge) -> dict:
    return {
        "id": e.id,
        "from_node_id": short_id(e.from_node_id),
        "to_node_id": short_id(e.to_node_id),
        "label": e.label,
        "condition_logic": e.condition_logic,
        "priority": e.priority,
    }


@router.get("/", response_model=list[EdgeRead])
async def list_edges(
    from_node: str | None = None,
    to_node: str | None = None,
    db: AsyncSession = Depends(get_db),
    schema_id: str = Depends(resolve_schema_id),
):
    q = select(Edge).where(Edge.schema_id == schema_id)
    if from_node:
        q = q.where(Edge.from_node_id == full_id(schema_id, from_node))
    if to_node:
        q = q.where(Edge.to_node_id == full_id(schema_id, to_node))
    result = await db.execute(q.order_by(Edge.from_node_id, Edge.priority))
    return [_project_edge(e) for e in result.scalars().all()]


@router.get("/graph", response_model=list[EdgeRead])
async def get_full_graph(
    db: AsyncSession = Depends(get_db),
    schema_id: str = Depends(resolve_schema_id),
):
    result = await db.execute(
        select(Edge).where(Edge.schema_id == schema_id).order_by(Edge.from_node_id)
    )
    return [_project_edge(e) for e in result.scalars().all()]


async def _target_exists(db: AsyncSession, schema_id: str, short: str) -> bool:
    fid = full_id(schema_id, short)
    n = (await db.execute(select(Node).where(Node.id == fid, Node.schema_id == schema_id))).scalar_one_or_none()
    if n:
        return True
    f = (await db.execute(select(Final).where(Final.id == fid, Final.schema_id == schema_id))).scalar_one_or_none()
    return f is not None


@router.post("/", response_model=EdgeRead, status_code=201)
async def create_edge(
    body: EdgeCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    schema_id: str = Depends(resolve_schema_id),
):
    if not await _target_exists(db, schema_id, body.from_node_id):
        raise HTTPException(status_code=400, detail=f"Source '{body.from_node_id}' not found")
    if not await _target_exists(db, schema_id, body.to_node_id):
        raise HTTPException(status_code=400, detail=f"Target '{body.to_node_id}' not found")

    edge = Edge(
        schema_id=schema_id,
        from_node_id=full_id(schema_id, body.from_node_id),
        to_node_id=full_id(schema_id, body.to_node_id),
        label=body.label,
        priority=body.priority,
    )
    db.add(edge)
    db.add(AuditLog(
        user_id=current_user.id, action="create",
        entity_type="edge", entity_id=f"{body.from_node_id}->{body.to_node_id}",
        new_value=body.model_dump(), schema_id=schema_id,
    ))
    await db.commit()
    await db.refresh(edge)
    return _project_edge(edge)


@router.patch("/{edge_id}", response_model=EdgeRead)
async def update_edge(
    edge_id: int,
    body: EdgeUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    schema_id: str = Depends(resolve_schema_id),
):
    edge = (await db.execute(
        select(Edge).where(Edge.id == edge_id, Edge.schema_id == schema_id)
    )).scalar_one_or_none()
    if not edge:
        raise HTTPException(status_code=404, detail="Edge not found")

    old_values = {"to_node_id": short_id(edge.to_node_id), "label": edge.label}
    updates = body.model_dump(exclude_unset=True)

    if "to_node_id" in updates:
        if not await _target_exists(db, schema_id, updates["to_node_id"]):
            raise HTTPException(status_code=400, detail=f"Target '{updates['to_node_id']}' not found")
        updates["to_node_id"] = full_id(schema_id, updates["to_node_id"])

    for key, value in updates.items():
        setattr(edge, key, value)

    db.add(AuditLog(
        user_id=current_user.id, action="update",
        entity_type="edge", entity_id=str(edge_id),
        old_value=old_values, new_value=body.model_dump(exclude_unset=True),
        schema_id=schema_id,
    ))
    await db.commit()
    await db.refresh(edge)
    return _project_edge(edge)


@router.delete("/{edge_id}", status_code=204)
async def delete_edge(
    edge_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    schema_id: str = Depends(resolve_schema_id),
):
    edge = (await db.execute(
        select(Edge).where(Edge.id == edge_id, Edge.schema_id == schema_id)
    )).scalar_one_or_none()
    if not edge:
        raise HTTPException(status_code=404, detail="Edge not found")

    db.add(AuditLog(
        user_id=current_user.id, action="delete",
        entity_type="edge", entity_id=str(edge_id),
        old_value={"from": short_id(edge.from_node_id), "to": short_id(edge.to_node_id), "label": edge.label},
        schema_id=schema_id,
    ))
    await db.delete(edge)
    await db.commit()
    return Response(status_code=204)
