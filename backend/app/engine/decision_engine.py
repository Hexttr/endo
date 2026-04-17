"""Core decision engine — interprets the decision tree stored in the DB."""
from __future__ import annotations
from typing import Any, Optional
import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models import Node, Option, Edge, Final, Session

logger = logging.getLogger(__name__)


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
        node = await self._load_node(node_id)
        if not node:
            return {"error": f"Node {node_id} not found"}

        collected = dict(session.collected_data or {})
        flags = list(session.unknown_flags or [])

        collected[node_id] = answer
        next_node_id = None

        if node.input_type in ("info", "action"):
            next_node_id = self._find_option_next(node, answer) if answer and answer != "next" else None
            if not next_node_id:
                next_node_id = self._get_next_field(node)
            if not next_node_id:
                next_node_id = await self._resolve_next_from_edges(node_id)

        elif node.input_type in ("single_choice", "yes_no"):
            if answer == "unknown" and node.unknown_action:
                flags.append({"node": node_id, "reason": "user_unknown"})
                next_node_id = self._resolve_unknown(node, collected)
            else:
                next_node_id = self._find_option_next(node, answer)

        elif node.input_type == "multi_choice":
            selected = answer if isinstance(answer, list) else []
            if not selected or answer == "unknown":
                flags.append({"node": node_id, "reason": "user_unknown"})

            next_node_id = self._resolve_multi_choice(node, selected, collected)
            if not next_node_id:
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

        resolved_id = await self._auto_resolve_chain(next_node_id, collected, max_depth=5)
        if resolved_id != next_node_id:
            session.current_node_id = resolved_id
            next_node_id = resolved_id

        if next_node_id and self._is_final_id(next_node_id):
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

    async def _auto_resolve_chain(self, node_id: str, collected: dict, max_depth: int = 5) -> str:
        """If the next node is 'auto', resolve it transparently until we reach
        a non-auto node that the user needs to interact with."""
        current = node_id
        for _ in range(max_depth):
            if not current or self._is_final_id(current):
                return current
            node = await self._load_node(current)
            if not node or node.input_type != "auto":
                return current
            resolved = await self._resolve_auto(node, collected)
            if not resolved:
                return current
            current = resolved
        return current

    def _is_final_id(self, node_id: str) -> bool:
        return bool(node_id and node_id.startswith("F") and len(node_id) <= 4
                     and node_id[1:].isdigit())

    def _get_next_field(self, node: Node) -> Optional[str]:
        if node.extra and "next" in node.extra:
            return node.extra["next"]
        return None

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

    def _resolve_multi_choice(self, node: Node, selected: list, collected: dict) -> Optional[str]:
        """Handle multi_choice routing, including A010's group-based rules
        and MULTIPLE_A/MULTIPLE_B priority-based routing."""
        if not node.extra:
            return None

        routing_rules = node.extra.get("routing_rules")
        if routing_rules:
            return self._evaluate_routing_rules(node, selected, routing_rules)

        if node.extra.get("priority_order") or node.id.startswith("MULTIPLE"):
            return self._resolve_priority_multi(node, selected)

        return None

    def _resolve_priority_multi(self, node: Node, selected: list) -> Optional[str]:
        """For MULTIPLE_A/B: route to the highest-priority selected option."""
        best_priority = 999
        best_next = None
        for opt in node.options:
            if opt.option_id in selected and opt.next_node_id:
                p = opt.priority if opt.priority is not None else 999
                if p < best_priority:
                    best_priority = p
                    best_next = opt.next_node_id
        if not best_next and selected and node.options:
            for opt in node.options:
                if opt.option_id in selected and opt.next_node_id:
                    return opt.next_node_id
        return best_next

    def _evaluate_routing_rules(self, node: Node, selected: list, rules: list) -> Optional[str]:
        """Evaluate A010-style group-based routing rules."""
        groups = {}
        for opt in node.options:
            group = None
            if opt.extra and "group" in opt.extra:
                group = opt.extra["group"]
            if group:
                groups.setdefault(group, [])
                if opt.option_id in selected:
                    groups[group].append(opt.option_id)

        for rule in rules:
            cond = rule.get("condition", "")

            if "any_from_group" in cond:
                group_name = cond.split("'")[1] if "'" in cond else ""
                if groups.get(group_name):
                    return rule.get("next")

            elif "count_from_group" in cond and ">=" in cond:
                group_name = cond.split("'")[1] if "'" in cond else ""
                threshold = int(cond.split(">=")[1].strip())
                if len(groups.get(group_name, [])) >= threshold:
                    return rule.get("next")

            elif "count_from_group" in cond and "==" in cond:
                group_name = cond.split("'")[1] if "'" in cond else ""
                threshold = int(cond.split("==")[1].strip())
                if len(groups.get(group_name, [])) == threshold:
                    return rule.get("next")

            elif "count_all" in cond and "== 0" in cond:
                if not selected:
                    return rule.get("next")

        return None

    async def _resolve_next_from_edges(self, node_id: str) -> Optional[str]:
        result = await self.db.execute(
            select(Edge).where(Edge.from_node_id == node_id).order_by(Edge.priority)
        )
        edge = result.scalars().first()
        return edge.to_node_id if edge else None

    async def _resolve_auto(self, node: Node, collected: dict) -> Optional[str]:
        if not node.extra:
            return await self._resolve_next_from_edges(node.id)

        rules = node.extra.get("rules")
        if not rules:
            return await self._resolve_next_from_edges(node.id)

        all_selected = self._flatten_selections(collected)

        if node.id == "B077":
            return self._evaluate_b077(rules, all_selected, collected)
        elif node.id == "C040":
            return self._evaluate_c040(rules, all_selected, collected)

        for rule in sorted(rules, key=lambda r: r.get("priority", 999)):
            if self._evaluate_condition(rule.get("conditions", ""), all_selected, collected):
                return rule.get("next")

        return await self._resolve_next_from_edges(node.id)

    def _flatten_selections(self, collected: dict) -> set:
        """Gather all option IDs the user has selected across the session."""
        result = set()
        for value in collected.values():
            if isinstance(value, list):
                result.update(value)
            elif isinstance(value, str):
                result.add(value)
        return result

    def _evaluate_b077(self, rules: list, all_selected: set, collected: dict) -> str:
        """B077: polyp differentiation based on B071-B076 answers."""
        s = all_selected

        ppi_long = "yes" in str(collected.get("B046", ""))

        for rule in rules:
            rid = rule.get("id", "")
            cond = rule.get("conditions", "")

            if rid == "juvenile":
                base_ok = ("BASE_1" in s or "BASE_2" in s)
                app_ok = ("APP_1" in s or "APP_2" in s)
                loc_ok = ("LOC_1" in s or "LOC_3" in s)
                colo_ok = ("COLO_1" in s or "COLO_2" in s)
                family_ok = "family_crr" in s
                if base_ok and app_ok and loc_ok and colo_ok and family_ok:
                    return rule["next"]

            elif rid == "peutz_jeghers":
                if ("pigment_lips" in s and "BASE_2" in s
                        and "LOC_1" in s and "family_pancreas" in s):
                    return rule["next"]

            elif rid == "sap":
                if ("QTY_4" in s and "COLO_2" in s and "APP_3" in s
                        and ("osteomas" in s or "sebaceous_cysts" in s)):
                    return rule["next"]

            elif rid == "hyperplastic":
                qty_ok = ("QTY_1" in s or "QTY_2" in s)
                app_ok = ("APP_3" in s or "APP_5" in s)
                no_ppi = not ppi_long
                no_family = "family_polyposis" not in s
                if qty_ok and "BASE_2" in s and app_ok and no_ppi and no_family:
                    return rule["next"]

            elif rid == "fundic_gland":
                qty_ok = ("QTY_1" in s or "QTY_2" in s)
                loc_only = "LOC_1" in s and "LOC_2" not in s and "LOC_3" not in s and "LOC_4" not in s
                app_ok = ("APP_3" in s or "APP_5" in s)
                if qty_ok and loc_only and app_ok and ppi_long:
                    return rule["next"]

            elif rid == "brunner":
                loc_only = "LOC_3" in s and "LOC_1" not in s and "LOC_2" not in s and "LOC_4" not in s
                if "QTY_1" in s and loc_only and "BASE_2" in s:
                    return rule["next"]

            elif cond == "default":
                return rule["next"]

        return "F07"

    def _evaluate_c040(self, rules: list, all_selected: set, collected: dict) -> str:
        """C040: route from branch C to A or B based on collected symptoms/labs."""
        s = all_selected

        c010 = collected.get("C010", [])
        if isinstance(c010, str):
            c010 = [c010]
        c015 = collected.get("C015", [])
        if isinstance(c015, str):
            c015 = [c015]
        c020 = collected.get("C020", [])
        if isinstance(c020, str):
            c020 = [c020]
        c030 = collected.get("C030", {})

        hb = None
        if isinstance(c030, dict):
            hb = c030.get("hb")
            if hb is not None:
                try:
                    hb = float(hb)
                except (ValueError, TypeError):
                    hb = None

        for rule in sorted(rules, key=lambda r: r.get("priority", 999)):
            rid = rule.get("id", "")

            if rid == "C_R1":
                vomiting_blood = "vomiting" in c010
                stool_blood = "stool" in c010
                shock = "consciousness_impaired" in c020 or "bp_low" in c020
                hb_low = hb is not None and hb < 80
                if vomiting_blood or stool_blood or shock or hb_low:
                    return rule["next"]

            elif rid == "C_R3":
                dysphagia = "dysphagia" in c010
                chemical = any("nsaids" not in x for x in c015 if "cirrhosis" not in x)
                if dysphagia and "chemical" in str(collected):
                    return rule["next"]

            elif rid == "C_R2":
                portal_signs = 0
                if "ascites" in c010:
                    portal_signs += 1
                if "jaundice" in c010:
                    portal_signs += 1
                if "cirrhosis_yes" in c015:
                    portal_signs += 1
                hr_elevated = "hr_elevated" in c020
                if portal_signs >= 2 or ("cirrhosis_yes" in c015 and ("ascites" in c010 or "jaundice" in c010)):
                    return rule["next"]

            elif rid == "C_R4":
                pigment = "pigment" in c010
                family_poly = "family_polyposis" in c015 or "family_crr" in c015
                stool_blood = "stool" in c010
                if pigment or (stool_blood and family_poly):
                    return rule["next"]

            elif rid == "C_R5":
                heartburn = "heartburn" in c010
                pain = "pain" in c010
                if heartburn and pain:
                    return rule["next"]

            elif rid == "C_R6":
                pain = "pain" in c010
                hp_yes = "h_pylori_yes" in c015
                nsaids_yes = "nsaids_yes" in c015
                if pain and (hp_yes or nsaids_yes):
                    return rule["next"]

            elif rid == "C_R7":
                nsaids_yes = "nsaids_yes" in c015
                pain = "pain" in c010
                no_blood = "vomiting" not in c010 and "stool" not in c010
                if nsaids_yes and pain and no_blood:
                    return rule["next"]

            elif rid == "C_R8":
                return rule["next"]

        return "AWAITING_WORKUP"

    def _evaluate_condition(self, condition: str, all_selected: set, collected: dict) -> bool:
        if condition == "default":
            return True
        tokens = set(condition.replace("(", "").replace(")", "").replace("AND", "").replace("OR", "").split())
        matched = tokens & all_selected
        return len(matched) > 0

    async def _load_node(self, node_id: str) -> Optional[Node]:
        result = await self.db.execute(
            select(Node).options(selectinload(Node.options)).where(Node.id == node_id)
        )
        return result.scalar_one_or_none()
