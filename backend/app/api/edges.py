from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db
from app.models import Edge
from app.schemas import EdgeRead

router = APIRouter(prefix="/edges", tags=["edges"])


@router.get("/", response_model=list[EdgeRead])
async def list_edges(
    from_node: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    q = select(Edge)
    if from_node:
        q = q.where(Edge.from_node_id == from_node)
    result = await db.execute(q.order_by(Edge.from_node_id, Edge.priority))
    return result.scalars().all()


@router.get("/graph", response_model=list[EdgeRead])
async def get_full_graph(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Edge).order_by(Edge.from_node_id))
    return result.scalars().all()
