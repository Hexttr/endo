"""Schema validation endpoint.

Runs a battery of structural checks on a diagnostic schema and returns a list
of issues with severities ("error" / "warning" / "info"). Used by the admin UI
to surface problems before they cause the bot to misbehave in production.

The validator is read-only and side-effect free: it only reads from the DB.
It is cheap enough to run on every page load of the Dashboard.
"""
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db
from app.models import Schema, Node, Option, Edge, Final, Section
from app.api._scoping import short_id

router = APIRouter(prefix="/schemas", tags=["validation"])

Severity = Literal["error", "warning", "info"]


def _issue(severity: Severity, code: str, message: str, *, entity_type: str | None = None,
           entity_id: str | None = None, hint: str | None = None) -> dict[str, Any]:
    """Structured issue record. `code` is stable and can be used by the UI
    to group/ignore categories; `message` is human-readable Russian."""
    return {
        "severity": severity,
        "code": code,
        "message": message,
        "entity_type": entity_type,
        "entity_id": entity_id,
        "hint": hint,
    }


@router.get("/{schema_id}/validate")
async def validate_schema(schema_id: str, db: AsyncSession = Depends(get_db)) -> dict:
    """Return a structured report of issues for the given schema."""
    schema = (await db.execute(
        select(Schema).where(Schema.id == schema_id)
    )).scalar_one_or_none()
    if not schema:
        raise HTTPException(status_code=404, detail="Schema not found")

    # Load everything once — validations cross-reference each other, so
    # repeated round-trips would be wasteful.
    nodes = (await db.execute(
        select(Node).where(Node.schema_id == schema_id)
    )).scalars().all()
    options = (await db.execute(
        select(Option).where(Option.schema_id == schema_id)
    )).scalars().all()
    edges = (await db.execute(
        select(Edge).where(Edge.schema_id == schema_id)
    )).scalars().all()
    finals = (await db.execute(
        select(Final).where(Final.schema_id == schema_id)
    )).scalars().all()
    sections = (await db.execute(
        select(Section).where(Section.schema_id == schema_id)
    )).scalars().all()

    node_ids: set[str] = {n.id for n in nodes}
    final_ids: set[str] = {f.id for f in finals}
    section_slugs: set[str] = {s.slug for s in sections}
    # Options grouped by source node for reachability BFS.
    opts_by_node: dict[str, list[Option]] = {}
    for o in options:
        opts_by_node.setdefault(o.node_id, []).append(o)
    edges_by_node: dict[str, list[Edge]] = {}
    for e in edges:
        edges_by_node.setdefault(e.from_node_id, []).append(e)

    issues: list[dict[str, Any]] = []

    # --- 1. Root node ------------------------------------------------------
    if not schema.root_node_id:
        issues.append(_issue(
            "error", "root_missing",
            "Не задан стартовый узел. Бот ничего не ответит на /start.",
            entity_type="schema", entity_id=schema_id,
            hint="Откройте «Схемы» → редактирование → выберите стартовый узел из списка.",
        ))
    elif schema.root_node_id not in node_ids:
        issues.append(_issue(
            "error", "root_dangling",
            f"Стартовый узел '{short_id(schema.root_node_id)}' не существует в схеме.",
            entity_type="schema", entity_id=schema_id,
            hint="Видимо, узел был удалён. Назначьте другой стартовый узел.",
        ))

    # --- 2. Empty schema ---------------------------------------------------
    if not nodes:
        issues.append(_issue(
            "error", "schema_empty",
            "В схеме нет ни одного узла.",
            entity_type="schema", entity_id=schema_id,
            hint="Создайте первый узел на странице «Узлы».",
        ))

    # --- 3. Per-node checks ------------------------------------------------
    for n in nodes:
        short = short_id(n.id)

        # 3a. Section FK — after migration v4 the DB enforces this, but we
        # check anyway to be friendly when the integrity lag is a few ms.
        if n.section and n.section not in section_slugs:
            issues.append(_issue(
                "error", "node_section_missing",
                f"Узел '{short}' ссылается на несуществующую секцию '{n.section}'.",
                entity_type="node", entity_id=short,
                hint="Создайте секцию на вкладке «Обзор» или перенесите узел.",
            ))

        # 3b. return_node must exist if set.
        if n.return_node and n.return_node not in node_ids:
            issues.append(_issue(
                "error", "return_node_dangling",
                f"Узел '{short}' имеет узел возврата '{short_id(n.return_node)}', которого нет в схеме.",
                entity_type="node", entity_id=short,
                hint="Укажите корректный узел возврата или очистите поле.",
            ))

        # 3c. Pending node should have a return_node (otherwise after user
        # provides the pending answer, the bot has nowhere to go).
        if n.is_pending and not n.return_node:
            issues.append(_issue(
                "warning", "pending_without_return",
                f"Узел '{short}' помечен «Ожидание», но не задан узел возврата.",
                entity_type="node", entity_id=short,
                hint="Для ожидающих узлов обычно задают узел возврата — иначе диалог зависнет.",
            ))

        # 3d. Terminal with outgoing options (will be silently ignored).
        if n.is_terminal and opts_by_node.get(n.id):
            issues.append(_issue(
                "warning", "terminal_has_options",
                f"Терминальный узел '{short}' имеет варианты ответов — они никогда не сработают.",
                entity_type="node", entity_id=short,
                hint="Снимите галку «Терминальный» или удалите варианты.",
            ))

        # 3e. Non-terminal, non-info node with no way forward is a dead-end.
        if (not n.is_terminal
                and n.input_type != "info"
                and not opts_by_node.get(n.id)
                and not edges_by_node.get(n.id)):
            issues.append(_issue(
                "warning", "dead_end",
                f"Узел '{short}' не терминальный, но не имеет вариантов/связей — диалог застрянет.",
                entity_type="node", entity_id=short,
                hint="Добавьте варианты ответов или отметьте узел терминальным.",
            ))

    # --- 4. Option.next_node_id must resolve ------------------------------
    for o in options:
        if not o.next_node_id:
            continue  # null is allowed (ends conversation)
        if o.next_node_id not in node_ids and o.next_node_id not in final_ids:
            issues.append(_issue(
                "error", "option_dangling",
                f"Вариант «{o.label}» узла '{short_id(o.node_id)}' ведёт в несуществующий "
                f"узел/диагноз '{short_id(o.next_node_id)}'.",
                entity_type="option", entity_id=str(o.id),
                hint="Перенаправьте вариант на существующий узел или создайте цель.",
            ))

    # --- 5. Edge.to_node_id ------------------------------------------------
    for e in edges:
        if e.to_node_id not in node_ids and e.to_node_id not in final_ids:
            issues.append(_issue(
                "warning", "edge_dangling",
                f"Связь '{short_id(e.from_node_id)}' → '{short_id(e.to_node_id)}' ведёт в никуда.",
                entity_type="edge", entity_id=str(e.id),
            ))

    # --- 6. Reachability from root ----------------------------------------
    reachable: set[str] = set()
    if schema.root_node_id and schema.root_node_id in node_ids:
        stack = [schema.root_node_id]
        while stack:
            cur = stack.pop()
            if cur in reachable:
                continue
            reachable.add(cur)
            for o in opts_by_node.get(cur, []):
                if o.next_node_id and o.next_node_id in node_ids:
                    stack.append(o.next_node_id)
            for ed in edges_by_node.get(cur, []):
                if ed.to_node_id in node_ids:
                    stack.append(ed.to_node_id)
            # return_node is *also* reachable — it's a teleport back after
            # pending.
            node = next((nn for nn in nodes if nn.id == cur), None)
            if node and node.return_node and node.return_node in node_ids:
                stack.append(node.return_node)

    unreachable = node_ids - reachable
    # If we couldn't compute reachability (no valid root), skip this check
    # rather than flood the user with N warnings that duplicate root_missing.
    if schema.root_node_id and schema.root_node_id in node_ids:
        for nid in sorted(unreachable):
            issues.append(_issue(
                "warning", "node_unreachable",
                f"Узел '{short_id(nid)}' недостижим от стартового узла.",
                entity_type="node", entity_id=short_id(nid),
                hint="Добавьте связь из достижимого узла, иначе узел только мешает.",
            ))

    # --- 7. Summary -------------------------------------------------------
    errors = sum(1 for i in issues if i["severity"] == "error")
    warnings = sum(1 for i in issues if i["severity"] == "warning")

    return {
        "schema_id": schema_id,
        "is_valid": errors == 0,
        "counts": {"error": errors, "warning": warnings, "info": 0},
        "totals": {
            "nodes": len(nodes),
            "options": len(options),
            "edges": len(edges),
            "finals": len(finals),
            "sections": len(sections),
            "reachable_nodes": len(reachable),
        },
        "issues": issues,
    }
