from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db
from app.models import Session as BotSession
from app.schemas import SessionRead, SessionCreate, AnswerSubmit, EngineResponse, NodeRead, FinalRead
from app.engine.decision_engine import DecisionEngine
from app.api._scoping import resolve_schema_id, short_id
from app.api.nodes import _project_node
from app.api.finals import _project_final

router = APIRouter(prefix="/sessions", tags=["sessions"])


def _project_session(s: BotSession) -> dict:
    return {
        "id": s.id,
        "user_id": s.user_id,
        "current_node_id": short_id(s.current_node_id),
        "collected_data": s.collected_data or {},
        "unknown_flags": s.unknown_flags or [],
        "status": s.status,
        "created_at": s.created_at,
        "updated_at": s.updated_at,
    }


@router.post("/start", response_model=EngineResponse)
async def start_session(
    body: SessionCreate,
    db: AsyncSession = Depends(get_db),
    schema_id: str = Depends(resolve_schema_id),
):
    engine = DecisionEngine(db, schema_id=schema_id)
    session = await engine.start_session(body.user_id)
    node = await engine.get_current_node(session)
    # When neither Schema.root_node_id nor the legacy N000 fallback resolved to
    # a real node, the session starts "blank". Surface a clear message so the
    # bot (and playground) can tell the user exactly what to do instead of
    # silently saying hi and doing nothing.
    message = None
    if not node:
        message = (
            "Для схемы не задан стартовый узел. "
            "Откройте админ-панель → Схемы → выберите стартовый узел."
        )
    return EngineResponse(
        session_id=session.id,
        current_node=_project_node(node) if node else None,
        status=session.status,
        collected_data=session.collected_data or {},
        unknown_flags=session.unknown_flags or [],
        message=message,
    )


@router.post("/answer", response_model=EngineResponse)
async def submit_answer(
    body: AnswerSubmit,
    db: AsyncSession = Depends(get_db),
    schema_id: str = Depends(resolve_schema_id),
):
    result = await db.execute(select(BotSession).where(BotSession.id == body.session_id))
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.status == "completed":
        raise HTTPException(status_code=400, detail="Session already completed")

    # Use the session's recorded schema to keep the conversation pinned even
    # if the caller forgot to pass X-Schema-Id.
    effective_schema_id = session.schema_id or schema_id

    engine = DecisionEngine(db, schema_id=effective_schema_id)
    outcome = await engine.process_answer(session, body.node_id, body.answer)

    if "error" in outcome:
        raise HTTPException(status_code=400, detail=outcome["error"])

    if outcome.get("final_id"):
        final = await engine.get_final(outcome["final_id"])
        return EngineResponse(
            session_id=session.id,
            final=_project_final(final) if final else None,
            status="completed",
            collected_data=session.collected_data or {},
            unknown_flags=session.unknown_flags or [],
            message=f"Диагноз: {final.diagnosis}" if final else None,
        )

    node = await engine.get_current_node(session)
    return EngineResponse(
        session_id=session.id,
        current_node=_project_node(node) if node else None,
        status=session.status,
        collected_data=session.collected_data or {},
        unknown_flags=session.unknown_flags or [],
    )


@router.get("/{session_id}", response_model=SessionRead)
async def get_session(
    session_id: int,
    db: AsyncSession = Depends(get_db),
    schema_id: str = Depends(resolve_schema_id),
):
    result = await db.execute(
        select(BotSession).where(
            BotSession.id == session_id, BotSession.schema_id == schema_id,
        )
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return _project_session(session)


@router.get("/", response_model=list[SessionRead])
async def list_sessions(
    user_id: str | None = None,
    status: str | None = None,
    db: AsyncSession = Depends(get_db),
    schema_id: str = Depends(resolve_schema_id),
):
    q = select(BotSession).where(BotSession.schema_id == schema_id)
    if user_id:
        q = q.where(BotSession.user_id == user_id)
    if status:
        q = q.where(BotSession.status == status)
    result = await db.execute(q.order_by(BotSession.updated_at.desc()).limit(100))
    return [_project_session(s) for s in result.scalars().all()]
