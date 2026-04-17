"""Core decision engine — interprets the decision tree stored in the DB."""
from __future__ import annotations
from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models import Node, Option, Edge, Final, Session


class DecisionEngine:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def start_session(self, user_id: str) -> Session:
        session = Session(user_id=user_id, current_node_id="N000", collected_data={}, unknown_flags=[], status="active")
        self.db.add(session)
        await self.db.commit()
        await self.db.refresh(session)
        return session

    async def get_current_node(self, session: Session) -> Optional[Node]:
        if not session.current_node_id:
            return None
        result = await self.db.execute(
            select(Node).options(selectinload(Node.options)).where(Node.id == session.current_node_id)
        )
        return result.scalar_one_or_none()

    async def get_final(self, final_id: str) -> Optional[Final]:
        result = await self.db.execute(select(Final).where(Final.id == final_id))
        return result.scalar_one_or_none()

    async def process_answer(self, session: Session, node_id: str, answer: Any) -> dict:
        """Process user answer, update session, return next state."""
        node = await self._load_node(node_id)
        if not node:
            return {"error": f"Node {node_id} not found"}

        collected = dict(session.collected_data or {})
        flags = list(session.unknown_flags or [])

        collected[node_id] = answer
        next_node_id = None

        if node.input_type == "info" or node.input_type == "action":
            next_node_id = await self._resolve_next_from_edges(node_id)
            if not next_node_id and node.extra and "next" in node.extra:
                next_node_id = node.extra["next"]

        elif node.input_type in ("single_choice", "yes_no"):
            if answer == "unknown" and node.unknown_action:
                flags.append({"node": node_id, "reason": "user_unknown"})
                next_node_id = self._resolve_unknown(node, collected)
            else:
                next_node_id = self._find_option_next(node, answer)

        elif node.input_type == "multi_choice":
            if not answer or answer == "unknown":
                flags.append({"node": node_id, "reason": "user_unknown"})
                next_node_id = await self._resolve_next_from_edges(node_id)
            else:
                next_node_id = await self._resolve_next_from_edges(node_id)

        elif node.input_type == "numeric":
            if answer == "unknown" or answer is None:
                flags.append({"node": node_id, "reason": "no_lab_data"})
            next_node_id = await self._resolve_next_from_edges(node_id)

        elif node.input_type == "auto":
            next_node_id = await self._resolve_auto(node, collected)

        if not next_node_id:
            next_node_id = await self._resolve_next_from_edges(node_id)

        session.collected_data = collected
        session.unknown_flags = flags
        session.current_node_id = next_node_id

        if next_node_id and next_node_id.startswith("F") and not next_node_id.startswith("FA"):
            final = await self.get_final(next_node_id)
            if final:
                session.status = "completed"
                await self.db.commit()
                return {"final_id": next_node_id, "status": "completed"}

        next_node = None
        if next_node_id:
            next_node = await self._load_node(next_node_id)
            if next_node and next_node.is_terminal:
                session.status = "completed"
            elif next_node and next_node.is_pending:
                session.status = "pending"

        await self.db.commit()
        return {"next_node_id": next_node_id, "status": session.status}

    def _find_option_next(self, node: Node, answer: Any) -> Optional[str]:
        for opt in node.options:
            if opt.option_id == answer and opt.next_node_id:
                return opt.next_node_id
        return None

    def _resolve_unknown(self, node: Node, collected: dict) -> Optional[str]:
        action = node.unknown_action
        if action == "safe_default":
            for opt in node.options:
                if opt.option_id in ("no", "unknown"):
                    return opt.next_node_id
            if node.options:
                return node.options[-1].next_node_id
        elif action == "branch_c":
            return "C001"
        elif action == "skip_with_flag":
            return None
        return None

    async def _resolve_next_from_edges(self, node_id: str) -> Optional[str]:
        result = await self.db.execute(
            select(Edge).where(Edge.from_node_id == node_id).order_by(Edge.priority)
        )
        edge = result.scalars().first()
        return edge.to_node_id if edge else None

    async def _resolve_auto(self, node: Node, collected: dict) -> Optional[str]:
        """For auto-routing nodes (C040, B077) evaluate rules against collected data."""
        if not node.extra or "rules" not in node.extra:
            return await self._resolve_next_from_edges(node.id)

        rules = node.extra["rules"]
        for rule in sorted(rules, key=lambda r: r.get("priority", 999)):
            if self._evaluate_rule(rule, collected):
                return rule.get("next")
        return await self._resolve_next_from_edges(node.id)

    def _evaluate_rule(self, rule: dict, collected: dict) -> bool:
        """Simplified rule evaluation. Full implementation would parse condition strings."""
        condition = rule.get("conditions", "")
        if condition == "default":
            return True
        return False

    async def _load_node(self, node_id: str) -> Optional[Node]:
        result = await self.db.execute(
            select(Node).options(selectinload(Node.options)).where(Node.id == node_id)
        )
        return result.scalar_one_or_none()
