from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db
from app.models import Session as BotSession
from app.schemas import SessionRead, SessionCreate, AnswerSubmit, EngineResponse, NodeRead, FinalRead
from app.engine.decision_engine import DecisionEngine

router = APIRouter(prefix="/sessions", tags=["sessions"])


@router.post("/start", response_model=EngineResponse)
async def start_session(body: SessionCreate, db: AsyncSession = Depends(get_db)):
    engine = DecisionEngine(db)
    session = await engine.start_session(body.user_id)
    node = await engine.get_current_node(session)
    return EngineResponse(
        session_id=session.id,
        current_node=NodeRead.model_validate(node) if node else None,
        status=session.status,
        collected_data=session.collected_data or {},
        unknown_flags=session.unknown_flags or [],
    )


@router.post("/answer", response_model=EngineResponse)
async def submit_answer(body: AnswerSubmit, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(BotSession).where(BotSession.id == body.session_id))
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.status == "completed":
        raise HTTPException(status_code=400, detail="Session already completed")

    engine = DecisionEngine(db)
    outcome = await engine.process_answer(session, body.node_id, body.answer)

    if "error" in outcome:
        raise HTTPException(status_code=400, detail=outcome["error"])

    if outcome.get("final_id"):
        final = await engine.get_final(outcome["final_id"])
        return EngineResponse(
            session_id=session.id,
            final=FinalRead.model_validate(final) if final else None,
            status="completed",
            collected_data=session.collected_data or {},
            unknown_flags=session.unknown_flags or [],
            message=f"Диагноз: {final.diagnosis}" if final else None,
        )

    node = await engine.get_current_node(session)
    return EngineResponse(
        session_id=session.id,
        current_node=NodeRead.model_validate(node) if node else None,
        status=session.status,
        collected_data=session.collected_data or {},
        unknown_flags=session.unknown_flags or [],
    )


@router.get("/{session_id}", response_model=SessionRead)
async def get_session(session_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(BotSession).where(BotSession.id == session_id))
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return session


@router.get("/", response_model=list[SessionRead])
async def list_sessions(
    user_id: str | None = None,
    status: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    q = select(BotSession)
    if user_id:
        q = q.where(BotSession.user_id == user_id)
    if status:
        q = q.where(BotSession.status == status)
    result = await db.execute(q.order_by(BotSession.updated_at.desc()).limit(100))
    return result.scalars().all()
