from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db
from app.models import Edge, Node, Final, AuditLog, User
from app.schemas import EdgeRead, EdgeCreate, EdgeUpdate
from app.api.auth import get_current_user

router = APIRouter(prefix="/edges", tags=["edges"])


@router.get("/", response_model=list[EdgeRead])
async def list_edges(
    from_node: str | None = None,
    to_node: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    q = select(Edge)
    if from_node:
        q = q.where(Edge.from_node_id == from_node)
    if to_node:
        q = q.where(Edge.to_node_id == to_node)
    result = await db.execute(q.order_by(Edge.from_node_id, Edge.priority))
    return result.scalars().all()


@router.get("/graph", response_model=list[EdgeRead])
async def get_full_graph(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Edge).order_by(Edge.from_node_id))
    return result.scalars().all()


async def _validate_target(db: AsyncSession, node_id: str):
    n = (await db.execute(select(Node).where(Node.id == node_id))).scalar_one_or_none()
    if n:
        return True
    f = (await db.execute(select(Final).where(Final.id == node_id))).scalar_one_or_none()
    return f is not None


@router.post("/", response_model=EdgeRead, status_code=201)
async def create_edge(
    body: EdgeCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not await _validate_target(db, body.from_node_id):
        raise HTTPException(status_code=400, detail=f"Source '{body.from_node_id}' not found")
    if not await _validate_target(db, body.to_node_id):
        raise HTTPException(status_code=400, detail=f"Target '{body.to_node_id}' not found")

    edge = Edge(**body.model_dump())
    db.add(edge)
    db.add(AuditLog(
        user_id=current_user.id, action="create",
        entity_type="edge", entity_id=f"{body.from_node_id}->{body.to_node_id}",
        new_value=body.model_dump(),
    ))
    await db.commit()
    await db.refresh(edge)
    return edge


@router.patch("/{edge_id}", response_model=EdgeRead)
async def update_edge(
    edge_id: int,
    body: EdgeUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    edge = (await db.execute(select(Edge).where(Edge.id == edge_id))).scalar_one_or_none()
    if not edge:
        raise HTTPException(status_code=404, detail="Edge not found")

    old_values = {"to_node_id": edge.to_node_id, "label": edge.label}
    updates = body.model_dump(exclude_unset=True)

    if "to_node_id" in updates and not await _validate_target(db, updates["to_node_id"]):
        raise HTTPException(status_code=400, detail=f"Target '{updates['to_node_id']}' not found")

    for key, value in updates.items():
        setattr(edge, key, value)

    db.add(AuditLog(
        user_id=current_user.id, action="update",
        entity_type="edge", entity_id=str(edge_id),
        old_value=old_values, new_value=updates,
    ))
    await db.commit()
    await db.refresh(edge)
    return edge


@router.delete("/{edge_id}", status_code=204)
async def delete_edge(
    edge_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    edge = (await db.execute(select(Edge).where(Edge.id == edge_id))).scalar_one_or_none()
    if not edge:
        raise HTTPException(status_code=404, detail="Edge not found")

    db.add(AuditLog(
        user_id=current_user.id, action="delete",
        entity_type="edge", entity_id=str(edge_id),
        old_value={"from": edge.from_node_id, "to": edge.to_node_id, "label": edge.label},
    ))
    await db.delete(edge)
    await db.commit()
    return Response(status_code=204)
