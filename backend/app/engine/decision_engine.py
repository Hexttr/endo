"""Core decision engine — interprets the decision tree stored in the DB.

All DB-facing IDs are stored prefixed as "{schema_id}::{short_id}".
This engine keeps that convention internally so that node/option/final
lookups against the DB work without further translation. External callers
(API layer) may pass short IDs; we normalise with `_fid`.
"""
from __future__ import annotations
from typing import Any, Optional
import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models import Node, Option, Edge, Final, Session, Schema, DEFAULT_SCHEMA_ID

logger = logging.getLogger(__name__)

SEP = "::"


def _short(full_id: Optional[str]) -> Optional[str]:
    if full_id is None:
        return None
    return full_id.split(SEP, 1)[1] if SEP in full_id else full_id


class DecisionEngine:
    def __init__(self, db: AsyncSession, schema_id: str = DEFAULT_SCHEMA_ID):
        self.db = db
        self.schema_id = schema_id

    # ── ID helpers ────────────────────────────────────────────────

    def _fid(self, short_id: Optional[str]) -> Optional[str]:
        """Normalise a short ID to its full '{schema_id}::{short}' form."""
        if short_id is None:
            return None
        if SEP in short_id:
            return short_id
        return f"{self.schema_id}{SEP}{short_id}"

    # ── Session / node / final lookup ─────────────────────────────

    async def start_session(self, user_id: str) -> Session:
        """Start a new conversation at the schema's configured root node.

        Precedence:
          1. `Schema.root_node_id` — explicit, admin-set starting point.
          2. Legacy `"{schema}::N000"` if such a node exists (keeps the
             original 'endo-bot' schema working without migration data).
          3. Leave `current_node_id = NULL` — the API/bot surface a clear
             "root is not configured" message instead of silently advancing
             into a ghost node.
        """
        root_id: Optional[str] = None
        schema_row = (await self.db.execute(
            select(Schema).where(Schema.id == self.schema_id)
        )).scalar_one_or_none()
        if schema_row and schema_row.root_node_id:
            # Stored as full id — but defend against half-migrated rows.
            candidate = (
                schema_row.root_node_id
                if SEP in schema_row.root_node_id
                else self._fid(schema_row.root_node_id)
            )
            if await self._node_exists(candidate):
                root_id = candidate
            else:
                logger.warning(
                    "Schema %s root_node_id=%s not found; falling back",
                    self.schema_id, schema_row.root_node_id,
                )
        if not root_id:
            legacy = self._fid("N000")
            if legacy and await self._node_exists(legacy):
                root_id = legacy

        session = Session(
            schema_id=self.schema_id,
            user_id=user_id,
            current_node_id=root_id,
            collected_data={}, unknown_flags=[], status="active",
        )
        self.db.add(session)
        await self.db.commit()
        await self.db.refresh(session)
        return session

    async def _node_exists(self, full_node_id: str) -> bool:
        result = await self.db.execute(
            select(Node.id).where(Node.id == full_node_id, Node.schema_id == self.schema_id)
        )
        return result.scalar_one_or_none() is not None

    async def get_current_node(self, session: Session) -> Optional[Node]:
        if not session.current_node_id:
            return None
        result = await self.db.execute(
            select(Node).options(selectinload(Node.options))
            .where(Node.id == self._fid(session.current_node_id), Node.schema_id == self.schema_id)
        )
        return result.scalar_one_or_none()

    async def get_final(self, final_id: str) -> Optional[Final]:
        result = await self.db.execute(
            select(Final).where(Final.id == self._fid(final_id), Final.schema_id == self.schema_id)
        )
        return result.scalar_one_or_none()

    # ── Answer processing ─────────────────────────────────────────

    async def process_answer(self, session: Session, node_id: str, answer: Any) -> dict:
        node = await self._load_node(node_id)
        if not node:
            return {"error": f"Node {node_id} not found"}

        short_node_id = _short(node.id)

        collected = dict(session.collected_data or {})
        flags = list(session.unknown_flags or [])

        # Store under the short ID — hardcoded engine rules reference short keys
        # like "C010", "C015" etc.
        collected[short_node_id] = answer
        next_node_id = None

        if node.input_type in ("info", "action"):
            next_node_id = self._find_option_next(node, answer) if answer and answer != "next" else None
            if not next_node_id:
                next_node_id = self._fid(self._get_next_field(node))
            if not next_node_id:
                next_node_id = await self._resolve_next_from_edges(node.id)

        elif node.input_type in ("single_choice", "yes_no"):
            if answer == "unknown":
                # Record the "no data" gap regardless of how we resolve it.
                flags.append({"node": short_node_id, "reason": "user_unknown"})
                # Prefer an explicit `option_id='unknown'` wired by the admin —
                # it's the schema's authoritative source of truth for gap
                # handling. Only fall back to the global `unknown_action`
                # heuristic if no such option exists. This matches the
                # intent of admins who add a "Нет данных" button to a node.
                next_node_id = self._find_option_next(node, "unknown")
                if not next_node_id and node.unknown_action:
                    next_node_id = self._resolve_unknown(node, collected)
            else:
                next_node_id = self._find_option_next(node, answer)

        elif node.input_type == "multi_choice":
            selected = answer if isinstance(answer, list) else []
            if not selected or answer == "unknown":
                flags.append({"node": short_node_id, "reason": "user_unknown"})
                # Same preference as single_choice: if the admin wired an
                # explicit `option_id='unknown'` route, use it before trying
                # routing_rules / priority / edges.
                explicit = self._find_option_next(node, "unknown")
                if explicit:
                    next_node_id = explicit

            if not next_node_id:
                next_node_id = self._resolve_multi_choice(node, selected, collected)
            if not next_node_id:
                next_node_id = await self._resolve_next_from_edges(node.id)

        elif node.input_type == "numeric":
            if answer == "unknown" or answer is None:
                flags.append({"node": short_node_id, "reason": "no_lab_data"})
            next_node_id = await self._resolve_next_from_edges(node.id)

        elif node.input_type == "auto":
            next_node_id = await self._resolve_auto(node, collected)

        if not next_node_id:
            next_node_id = await self._resolve_next_from_edges(node.id)

        session.collected_data = collected
        session.unknown_flags = flags
        session.current_node_id = next_node_id

        resolved_id = await self._auto_resolve_chain(next_node_id, collected, max_depth=5)
        if resolved_id != next_node_id:
            session.current_node_id = resolved_id
            next_node_id = resolved_id

        if next_node_id and await self._is_final(next_node_id):
            final = await self.get_final(next_node_id)
            if final:
                session.status = "completed"
                await self.db.commit()
                return {"final_id": _short(next_node_id), "status": "completed"}

        next_node = None
        if next_node_id:
            next_node = await self._load_node(next_node_id)
            if next_node and next_node.is_terminal:
                session.status = "completed"
            elif next_node and next_node.is_pending:
                session.status = "pending"

        await self.db.commit()
        return {"next_node_id": _short(next_node_id), "status": session.status}

    async def _auto_resolve_chain(self, node_id: str, collected: dict, max_depth: int = 5) -> Optional[str]:
        current = node_id
        for _ in range(max_depth):
            if not current or await self._is_final(current):
                return current
            node = await self._load_node(current)
            if not node or node.input_type != "auto":
                return current
            resolved = await self._resolve_auto(node, collected)
            if not resolved:
                return current
            current = resolved
        return current

    async def _is_final(self, node_id: str) -> bool:
        """Authoritative final check — hits the finals table rather than
        pattern-matching on ID shape (user-created schemas may not follow
        the 'F07' convention)."""
        if not node_id:
            return False
        f = (await self.db.execute(
            select(Final.id).where(Final.id == self._fid(node_id), Final.schema_id == self.schema_id)
        )).scalar_one_or_none()
        return f is not None

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
            return self._fid("C001")
        elif action == "skip_with_flag":
            return None
        return None

    def _resolve_multi_choice(self, node: Node, selected: list, collected: dict) -> Optional[str]:
        if not node.extra:
            return None

        routing_rules = node.extra.get("routing_rules")
        if routing_rules:
            return self._evaluate_routing_rules(node, selected, routing_rules)

        short_nid = _short(node.id) or ""
        if node.extra.get("priority_order") or short_nid.startswith("MULTIPLE"):
            return self._resolve_priority_multi(node, selected)

        return None

    def _resolve_priority_multi(self, node: Node, selected: list) -> Optional[str]:
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
            nxt = rule.get("next")

            if "any_from_group" in cond:
                group_name = cond.split("'")[1] if "'" in cond else ""
                if groups.get(group_name):
                    return self._fid(nxt)

            elif "count_from_group" in cond and ">=" in cond:
                group_name = cond.split("'")[1] if "'" in cond else ""
                threshold = int(cond.split(">=")[1].strip())
                if len(groups.get(group_name, [])) >= threshold:
                    return self._fid(nxt)

            elif "count_from_group" in cond and "==" in cond:
                group_name = cond.split("'")[1] if "'" in cond else ""
                threshold = int(cond.split("==")[1].strip())
                if len(groups.get(group_name, [])) == threshold:
                    return self._fid(nxt)

            elif "count_all" in cond and "== 0" in cond:
                if not selected:
                    return self._fid(nxt)

        return None

    async def _resolve_next_from_edges(self, node_id: str) -> Optional[str]:
        result = await self.db.execute(
            select(Edge).where(
                Edge.from_node_id == self._fid(node_id), Edge.schema_id == self.schema_id
            ).order_by(Edge.priority)
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
        short_nid = _short(node.id)

        if short_nid == "B077":
            return self._evaluate_b077(rules, all_selected, collected)
        elif short_nid == "C040":
            return self._evaluate_c040(rules, all_selected, collected)

        for rule in sorted(rules, key=lambda r: r.get("priority", 999)):
            if self._evaluate_condition(rule.get("conditions", ""), all_selected, collected):
                return self._fid(rule.get("next"))

        return await self._resolve_next_from_edges(node.id)

    def _flatten_selections(self, collected: dict) -> set:
        result = set()
        for value in collected.values():
            if isinstance(value, list):
                result.update(value)
            elif isinstance(value, str):
                result.add(value)
        return result

    def _evaluate_b077(self, rules: list, all_selected: set, collected: dict) -> str:
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
                    return self._fid(rule["next"])

            elif rid == "peutz_jeghers":
                if ("pigment_lips" in s and "BASE_2" in s
                        and "LOC_1" in s and "family_pancreas" in s):
                    return self._fid(rule["next"])

            elif rid == "sap":
                if ("QTY_4" in s and "COLO_2" in s and "APP_3" in s
                        and ("osteomas" in s or "sebaceous_cysts" in s)):
                    return self._fid(rule["next"])

            elif rid == "hyperplastic":
                qty_ok = ("QTY_1" in s or "QTY_2" in s)
                app_ok = ("APP_3" in s or "APP_5" in s)
                no_ppi = not ppi_long
                no_family = "family_polyposis" not in s
                if qty_ok and "BASE_2" in s and app_ok and no_ppi and no_family:
                    return self._fid(rule["next"])

            elif rid == "fundic_gland":
                qty_ok = ("QTY_1" in s or "QTY_2" in s)
                loc_only = "LOC_1" in s and "LOC_2" not in s and "LOC_3" not in s and "LOC_4" not in s
                app_ok = ("APP_3" in s or "APP_5" in s)
                if qty_ok and loc_only and app_ok and ppi_long:
                    return self._fid(rule["next"])

            elif rid == "brunner":
                loc_only = "LOC_3" in s and "LOC_1" not in s and "LOC_2" not in s and "LOC_4" not in s
                if "QTY_1" in s and loc_only and "BASE_2" in s:
                    return self._fid(rule["next"])

            elif cond == "default":
                return self._fid(rule["next"])

        return self._fid("F07")

    def _evaluate_c040(self, rules: list, all_selected: set, collected: dict) -> str:
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
                    return self._fid(rule["next"])

            elif rid == "C_R3":
                dysphagia = "dysphagia" in c010
                if dysphagia and "chemical" in str(collected):
                    return self._fid(rule["next"])

            elif rid == "C_R2":
                portal_signs = 0
                if "ascites" in c010:
                    portal_signs += 1
                if "jaundice" in c010:
                    portal_signs += 1
                if "cirrhosis_yes" in c015:
                    portal_signs += 1
                if portal_signs >= 2 or ("cirrhosis_yes" in c015 and ("ascites" in c010 or "jaundice" in c010)):
                    return self._fid(rule["next"])

            elif rid == "C_R4":
                pigment = "pigment" in c010
                family_poly = "family_polyposis" in c015 or "family_crr" in c015
                stool_blood = "stool" in c010
                if pigment or (stool_blood and family_poly):
                    return self._fid(rule["next"])

            elif rid == "C_R5":
                heartburn = "heartburn" in c010
                pain = "pain" in c010
                if heartburn and pain:
                    return self._fid(rule["next"])

            elif rid == "C_R6":
                pain = "pain" in c010
                hp_yes = "h_pylori_yes" in c015
                nsaids_yes = "nsaids_yes" in c015
                if pain and (hp_yes or nsaids_yes):
                    return self._fid(rule["next"])

            elif rid == "C_R7":
                nsaids_yes = "nsaids_yes" in c015
                pain = "pain" in c010
                no_blood = "vomiting" not in c010 and "stool" not in c010
                if nsaids_yes and pain and no_blood:
                    return self._fid(rule["next"])

            elif rid == "C_R8":
                return self._fid(rule["next"])

        return self._fid("AWAITING_WORKUP")

    def _evaluate_condition(self, condition: str, all_selected: set, collected: dict) -> bool:
        if condition == "default":
            return True
        tokens = set(condition.replace("(", "").replace(")", "").replace("AND", "").replace("OR", "").split())
        matched = tokens & all_selected
        return len(matched) > 0

    async def _load_node(self, node_id: str) -> Optional[Node]:
        result = await self.db.execute(
            select(Node).options(selectinload(Node.options))
            .where(Node.id == self._fid(node_id), Node.schema_id == self.schema_id)
        )
        return result.scalar_one_or_none()
