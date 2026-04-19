"""CRUD for Section, the named grouping of nodes within a schema.

Design notes:
  * Slugs are schema-scoped (unique per schema). Renaming a slug cascades to
    every Node.section via the composite FK — no manual Node rewrite needed.
  * Delete guards: we refuse to drop a section that still has nodes unless
    the caller passes `?reassign_to=<other-slug>`, in which case we move
    every node to that slug first (still inside one transaction).
  * Color accepts either a Tailwind preset key (e.g. "red", "amber") or a
    raw hex string; the admin renderer handles both.
"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import select, update, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db
from app.models import Section, Node, AuditLog, User
from app.schemas import SectionRead, SectionCreate, SectionUpdate
from app.api.auth import get_current_user
from app.api._scoping import resolve_schema_id


router = APIRouter(prefix="/sections", tags=["sections"])


def _full(schema_id: str, slug: str) -> str:
    return f"{schema_id}::{slug}"


async def _node_count(db: AsyncSession, schema_id: str, slug: str) -> int:
    return (await db.execute(
        select(func.count()).select_from(Node)
        .where(Node.schema_id == schema_id, Node.section == slug)
    )).scalar() or 0


def _project(s: Section, node_count: int) -> dict:
    return {
        "slug": s.slug,
        "label": s.label,
        "description": s.description,
        "color": s.color,
        "order": s.order,
        "node_count": node_count,
    }


@router.get("/", response_model=list[SectionRead])
async def list_sections(
    db: AsyncSession = Depends(get_db),
    schema_id: str = Depends(resolve_schema_id),
):
    """List sections with live node_count. Ordering: `order` asc, then label."""
    # One-shot join so we don't issue N+1 counts.
    rows = (await db.execute(
        select(Section, func.count(Node.id).label("cnt"))
        .outerjoin(
            Node,
            (Node.schema_id == Section.schema_id) & (Node.section == Section.slug),
        )
        .where(Section.schema_id == schema_id)
        .group_by(Section.id)
        .order_by(Section.order.asc(), Section.label.asc())
    )).all()
    return [_project(s, cnt) for s, cnt in rows]


@router.post("/", response_model=SectionRead, status_code=201)
async def create_section(
    body: SectionCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    schema_id: str = Depends(resolve_schema_id),
):
    slug = body.slug.strip()
    if not slug:
        raise HTTPException(status_code=400, detail="slug is required")

    existing = (await db.execute(
        select(Section).where(Section.schema_id == schema_id, Section.slug == slug)
    )).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=409,
                            detail=f"Section '{slug}' already exists in '{schema_id}'")

    section = Section(
        id=_full(schema_id, slug),
        schema_id=schema_id,
        slug=slug,
        label=body.label.strip() or slug,
        description=body.description,
        color=body.color,
        order=body.order or 0,
    )
    db.add(section)
    db.add(AuditLog(
        user_id=current_user.id, action="create",
        entity_type="section", entity_id=slug,
        new_value=body.model_dump(), schema_id=schema_id,
    ))
    await db.commit()
    await db.refresh(section)
    return _project(section, 0)


@router.patch("/{slug}", response_model=SectionRead)
async def update_section(
    slug: str,
    body: SectionUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    schema_id: str = Depends(resolve_schema_id),
):
    section = (await db.execute(
        select(Section).where(Section.schema_id == schema_id, Section.slug == slug)
    )).scalar_one_or_none()
    if not section:
        raise HTTPException(status_code=404, detail="Section not found")

    old_values = {
        "slug": section.slug, "label": section.label,
        "color": section.color, "order": section.order,
    }
    updates = body.model_dump(exclude_unset=True)

    # Renaming slug requires also bumping the PK (which is "{schema}::{slug}")
    # and letting the composite FK on `nodes` cascade. We do this before
    # applying the other fields so PK is consistent at commit time.
    new_slug = updates.pop("slug", None)
    if new_slug is not None and new_slug != section.slug:
        new_slug = new_slug.strip()
        if not new_slug:
            raise HTTPException(status_code=400, detail="slug cannot be empty")
        clash = (await db.execute(
            select(Section).where(
                Section.schema_id == schema_id, Section.slug == new_slug,
                Section.id != section.id,
            )
        )).scalar_one_or_none()
        if clash:
            raise HTTPException(status_code=409,
                                detail=f"Section slug '{new_slug}' is already taken")
        section.slug = new_slug
        section.id = _full(schema_id, new_slug)
        # Node.section column follows automatically via ON UPDATE CASCADE.

    for key, value in updates.items():
        setattr(section, key, value)

    db.add(AuditLog(
        user_id=current_user.id, action="update",
        entity_type="section", entity_id=slug,
        old_value=old_values, new_value=body.model_dump(exclude_unset=True),
        schema_id=schema_id,
    ))
    await db.commit()
    await db.refresh(section)
    cnt = await _node_count(db, schema_id, section.slug)
    return _project(section, cnt)


@router.delete("/{slug}", status_code=204)
async def delete_section(
    slug: str,
    reassign_to: Optional[str] = Query(default=None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    schema_id: str = Depends(resolve_schema_id),
):
    """Delete a section.

    If it still has nodes, the caller must provide `?reassign_to=<slug>`;
    we then move every node to that section before deletion. Without the
    parameter we refuse with 409 to avoid accidental data reshuffling.
    """
    section = (await db.execute(
        select(Section).where(Section.schema_id == schema_id, Section.slug == slug)
    )).scalar_one_or_none()
    if not section:
        raise HTTPException(status_code=404, detail="Section not found")

    cnt = await _node_count(db, schema_id, slug)
    if cnt > 0:
        if not reassign_to:
            raise HTTPException(
                status_code=409,
                detail=f"Section '{slug}' has {cnt} node(s). Pass "
                       f"?reassign_to=<other_slug> to move them first.",
            )
        target = (await db.execute(
            select(Section).where(
                Section.schema_id == schema_id, Section.slug == reassign_to,
            )
        )).scalar_one_or_none()
        if not target:
            raise HTTPException(status_code=400,
                                detail=f"reassign_to='{reassign_to}' does not exist")
        await db.execute(
            update(Node)
            .where(Node.schema_id == schema_id, Node.section == slug)
            .values(section=reassign_to)
        )

    db.add(AuditLog(
        user_id=current_user.id, action="delete",
        entity_type="section", entity_id=slug,
        old_value={"label": section.label, "moved_nodes_to": reassign_to, "moved_count": cnt},
        schema_id=schema_id,
    ))
    await db.delete(section)
    await db.commit()
    return Response(status_code=204)
