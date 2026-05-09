"""Tests for the decision engine — the heart of the bot.

Covers root-node resolution, standard answer flows, and safety around
unknown/no-data handling so the bot does not silently route clinicians into
the wrong branch.
"""
import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.engine.decision_engine import DecisionEngine
from app.models import Schema, Node, Option, Final, Section, Edge


@pytest.mark.asyncio
async def test_start_session_uses_schema_root(db: AsyncSession, seeded_schema: str):
    """When Schema.root_node_id is set, the engine starts there — not at the
    legacy N000 fallback."""
    engine = DecisionEngine(db, schema_id=seeded_schema)
    session = await engine.start_session(user_id="u1")
    assert session.current_node_id == f"{seeded_schema}::N1"
    assert session.status == "active"


@pytest.mark.asyncio
async def test_start_session_legacy_n000_fallback(db: AsyncSession):
    """If root_node_id is NULL but a node '{schema}::N000' exists, we fall
    back to it so the original endo-bot schema keeps working."""
    sid = "legacy"
    db.add(Schema(id=sid, name="Legacy", root_node_id=None))
    from app.models import Section
    db.add(Section(id=f"{sid}::overview", schema_id=sid, slug="overview", label="O", order=0))
    db.add(Node(id=f"{sid}::N000", schema_id=sid, section="overview",
                text="Legacy root", input_type="info"))
    await db.commit()

    engine = DecisionEngine(db, schema_id=sid)
    session = await engine.start_session(user_id="u1")
    assert session.current_node_id == f"{sid}::N000"


@pytest.mark.asyncio
async def test_start_session_unconfigured_returns_null(db: AsyncSession):
    """No root_node_id and no N000 ⇒ current_node_id is NULL. The API layer
    surfaces a clear message; we make sure the engine doesn't invent one."""
    sid = "empty"
    db.add(Schema(id=sid, name="Empty", root_node_id=None))
    await db.commit()
    engine = DecisionEngine(db, schema_id=sid)
    session = await engine.start_session(user_id="u1")
    assert session.current_node_id is None


@pytest.mark.asyncio
async def test_start_session_dangling_root_falls_back(db: AsyncSession):
    """root_node_id pointing to a deleted node must not leave the engine
    stuck — it should clear and fall through to None (or N000 if present)."""
    sid = "dangling"
    db.add(Schema(id=sid, name="Dangling", root_node_id=f"{sid}::GHOST"))
    await db.commit()
    engine = DecisionEngine(db, schema_id=sid)
    session = await engine.start_session(user_id="u1")
    assert session.current_node_id is None


@pytest.mark.asyncio
async def test_process_answer_single_choice_happy_path(db: AsyncSession, seeded_schema: str):
    """Answering 'yes' on N1 advances to N2 (terminal) and completes session."""
    engine = DecisionEngine(db, schema_id=seeded_schema)
    session = await engine.start_session(user_id="u1")
    res = await engine.process_answer(session, "N1", "yes")
    assert res.get("next_node_id") == "N2"
    assert session.status == "completed"  # N2 is_terminal
    assert session.collected_data.get("N1") == "yes"


@pytest.mark.asyncio
async def test_process_answer_leads_to_final(db: AsyncSession, seeded_schema: str):
    """Option 'no' on N1 points to a final diagnosis — engine returns
    final_id and marks session completed."""
    engine = DecisionEngine(db, schema_id=seeded_schema)
    session = await engine.start_session(user_id="u1")
    res = await engine.process_answer(session, "N1", "no")
    assert res.get("final_id") == "F1"
    assert res.get("status") == "completed"


@pytest.mark.asyncio
async def test_multi_choice_empty_selection_is_not_unknown(db: AsyncSession):
    sid = "multi-empty"
    db.add(Schema(id=sid, name="Multi empty", root_node_id=f"{sid}::M1"))
    db.add(Section(id=f"{sid}::overview", schema_id=sid, slug="overview", label="Overview", order=0))
    db.add(Node(id=f"{sid}::M1", schema_id=sid, section="overview",
                text="Risk factors", input_type="multi_choice", unknown_action="skip_with_flag"))
    db.add(Node(id=f"{sid}::M2", schema_id=sid, section="overview",
                text="Next", input_type="info", is_terminal=True))
    await db.flush()
    db.add(Edge(from_node_id=f"{sid}::M1", schema_id=sid, to_node_id=f"{sid}::M2", label="next"))
    await db.commit()

    engine = DecisionEngine(db, schema_id=sid)
    session = await engine.start_session(user_id="u1")
    res = await engine.process_answer(session, "M1", [])

    assert res.get("next_node_id") == "M2"
    assert session.unknown_flags == []
    assert session.collected_data.get("M1") == []


@pytest.mark.asyncio
async def test_safe_default_unknown_without_safe_option_does_not_pick_last_option(db: AsyncSession):
    sid = "safe-default"
    db.add(Schema(id=sid, name="Safe default", root_node_id=f"{sid}::S1"))
    db.add(Section(id=f"{sid}::overview", schema_id=sid, slug="overview", label="Overview", order=0))
    db.add(Node(id=f"{sid}::S1", schema_id=sid, section="overview",
                text="Severity?", input_type="single_choice", unknown_action="safe_default"))
    db.add(Final(id=f"{sid}::F1", schema_id=sid, diagnosis="Moderate"))
    db.add(Final(id=f"{sid}::F2", schema_id=sid, diagnosis="Severe"))
    await db.flush()
    db.add(Option(node_id=f"{sid}::S1", schema_id=sid, option_id="moderate",
                  label="Moderate", next_node_id=f"{sid}::F1"))
    db.add(Option(node_id=f"{sid}::S1", schema_id=sid, option_id="severe",
                  label="Severe", next_node_id=f"{sid}::F2"))
    await db.commit()

    engine = DecisionEngine(db, schema_id=sid)
    session = await engine.start_session(user_id="u1")
    res = await engine.process_answer(session, "S1", "unknown")

    assert res.get("next_node_id") is None
    assert res.get("status") == "active"
    assert session.unknown_flags == [{"node": "S1", "reason": "user_unknown"}]


@pytest.mark.asyncio
async def test_multi_choice_unknown_with_routing_rules_uses_deterministic_empty_path(db: AsyncSession):
    sid = "multi-routing"
    db.add(Schema(id=sid, name="Multi routing", root_node_id=f"{sid}::M1"))
    db.add(Section(id=f"{sid}::overview", schema_id=sid, slug="overview", label="Overview", order=0))
    db.add(Node(
        id=f"{sid}::M1",
        schema_id=sid,
        section="overview",
        text="Risk factors",
        input_type="multi_choice",
        unknown_action="skip_with_flag",
        extra={
            "routing_rules": [
                {"condition": "any_from_group('risk')", "next": f"{sid}::HI"},
                {"condition": "count_all() == 0", "next": f"{sid}::LO"},
            ]
        },
    ))
    db.add(Node(id=f"{sid}::HI", schema_id=sid, section="overview",
                text="High", input_type="info", is_terminal=True))
    db.add(Node(id=f"{sid}::LO", schema_id=sid, section="overview",
                text="Low", input_type="info", is_terminal=True))
    await db.flush()
    db.add(Option(node_id=f"{sid}::M1", schema_id=sid, option_id="portal", label="Portal", extra={"group": "risk"}))
    db.add(Edge(from_node_id=f"{sid}::M1", schema_id=sid, to_node_id=f"{sid}::HI", label="unsafe-first", priority=0))
    db.add(Edge(from_node_id=f"{sid}::M1", schema_id=sid, to_node_id=f"{sid}::LO", label="safe-second", priority=1))
    await db.commit()

    engine = DecisionEngine(db, schema_id=sid)
    session = await engine.start_session(user_id="u1")
    res = await engine.process_answer(session, "M1", "unknown")

    assert res.get("next_node_id") == "LO"
    assert session.unknown_flags == [{"node": "M1", "reason": "user_unknown"}]


@pytest.mark.asyncio
async def test_c040_epigastric_nsaids_without_bleeding_routes_to_nsaid_final(db: AsyncSession):
    sid = "c040"
    db.add(Schema(id=sid, name="C040", root_node_id=f"{sid}::C040"))
    db.add(Section(id=f"{sid}::branch_c", schema_id=sid, slug="branch_c", label="Branch C", order=0))
    db.add(Node(
        id=f"{sid}::C040",
        schema_id=sid,
        section="branch_c",
        text="Auto",
        input_type="auto",
        extra={
            "rules": [
                {"id": "C_R7", "priority": 1, "next": f"{sid}::F12"},
                {"id": "C_R8", "priority": 99, "next": f"{sid}::F99"},
            ]
        },
    ))
    db.add(Final(id=f"{sid}::F12", schema_id=sid, diagnosis="NSAID"))
    db.add(Final(id=f"{sid}::F99", schema_id=sid, diagnosis="Fallback"))
    await db.commit()

    engine = DecisionEngine(db, schema_id=sid)
    session = await engine.start_session(user_id="u1")
    session.collected_data = {
        "C010": ["epigastric_pain"],
        "C015": ["nsaids_yes"],
        "C020": [],
        "C030": {},
    }
    res = await engine.process_answer(session, "C040", "next")

    assert res.get("final_id") == "F12"
    assert res.get("status") == "completed"
