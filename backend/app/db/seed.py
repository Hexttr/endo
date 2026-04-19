"""Seed the database from decision_tree.json."""
import json
import sys
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import Session as DBSession

from app.config import settings
from app.db.database import Base
from app.models import (
    Node, Option, Edge, Final, Classification, User, Schema, Section,
    DEFAULT_SCHEMA_ID,
)

from passlib.context import CryptContext

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

DATA_PATH = Path(__file__).resolve().parent.parent.parent.parent / "data" / "decision_tree.json"


def seed_database(drop_existing: bool = False):
    engine = create_engine(settings.DATABASE_URL_SYNC, echo=False)

    if drop_existing:
        Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)

    with open(DATA_PATH, "r", encoding="utf-8") as f:
        tree = json.load(f)

    with DBSession(engine) as db:
        existing_nodes = db.query(Node).count()
        if existing_nodes > 0 and not drop_existing:
            print(f"Database already has {existing_nodes} nodes. Use --drop to re-seed.")
            return

        # Seed the default schema row first so FK (nodes.schema_id -> schemas.id)
        # resolves cleanly.
        if not db.query(Schema).filter(Schema.id == DEFAULT_SCHEMA_ID).first():
            db.add(Schema(id=DEFAULT_SCHEMA_ID, name="Эндо-бот",
                          description="Исходная схема эндоскопической диагностики"))

        # Pre-create Section rows for every distinct section slug referenced
        # in decision_tree.json. The composite FK on Node.section requires a
        # matching Section row; seed.py must therefore insert sections before
        # nodes. Labels default to the slug and can be edited from Dashboard.
        distinct_slugs = {node_data.get("section", "unknown") for node_data in tree["nodes"].values()}
        for slug in distinct_slugs:
            if not db.query(Section).filter(
                Section.schema_id == DEFAULT_SCHEMA_ID, Section.slug == slug,
            ).first():
                db.add(Section(
                    id=f"{DEFAULT_SCHEMA_ID}::{slug}",
                    schema_id=DEFAULT_SCHEMA_ID,
                    slug=slug, label=slug,
                ))
        db.flush()

        for node_id, node_data in tree["nodes"].items():
            extra = {}
            for key in ("fields", "rules", "routing_rules", "multiple_findings_priority", "priority_order", "data_transfer"):
                if key in node_data:
                    extra[key] = node_data[key]
            if "next" in node_data:
                extra["next"] = node_data["next"]
            if "description" in node_data:
                extra["description_text"] = node_data["description"]

            node = Node(
                id=node_id,
                section=node_data.get("section", "unknown"),
                text=node_data["text"],
                description=node_data.get("description"),
                input_type=node_data.get("input_type", "info"),
                unknown_action=node_data.get("unknown_action"),
                is_terminal=node_data.get("is_terminal", False),
                is_pending=node_data.get("is_pending", False),
                return_node=node_data.get("return_node"),
                allow_multiple=node_data.get("allow_multiple", False),
                extra=extra if extra else None,
            )
            db.add(node)

            for opt in node_data.get("options", []):
                option = Option(
                    node_id=node_id,
                    option_id=opt["id"],
                    label=opt["label"],
                    next_node_id=opt.get("next"),
                    priority=opt.get("priority"),
                    extra={k: v for k, v in opt.items() if k not in ("id", "label", "next", "priority")} or None,
                )
                db.add(option)

            if "next" in node_data and not node_data.get("options"):
                option = Option(
                    node_id=node_id,
                    option_id="next",
                    label="Далее",
                    next_node_id=node_data["next"],
                )
                db.add(option)

        all_node_ids = set(tree["nodes"].keys())
        all_final_ids = set(tree.get("finals", {}).keys())
        all_targets = all_node_ids | all_final_ids

        edge_set = set()
        for edge_data in tree.get("edges", []):
            edge = Edge(
                from_node_id=edge_data["from"],
                to_node_id=edge_data["to"],
                label=edge_data.get("label"),
                priority=edge_data.get("priority", 0),
            )
            db.add(edge)
            edge_set.add((edge_data["from"], edge_data["to"]))

        for node_id, node_data in tree["nodes"].items():
            for rule in node_data.get("rules", []):
                target = rule.get("next")
                if target and target in all_targets and (node_id, target) not in edge_set:
                    db.add(Edge(from_node_id=node_id, to_node_id=target,
                                label=rule.get("label", rule.get("id", ""))[:80],
                                priority=rule.get("priority", 0)))
                    edge_set.add((node_id, target))
            for rule in node_data.get("routing_rules", []):
                target = rule.get("next")
                if target and target in all_targets and (node_id, target) not in edge_set:
                    db.add(Edge(from_node_id=node_id, to_node_id=target,
                                label=rule.get("condition", "")[:80],
                                priority=0))
                    edge_set.add((node_id, target))

        for final_id, final_data in tree.get("finals", {}).items():
            final = Final(
                id=final_id,
                diagnosis=final_data["diagnosis"],
                endo_picture=final_data.get("endo_picture"),
                equipment=final_data.get("equipment"),
                algorithm=final_data.get("algorithm"),
                routing=final_data.get("routing"),
                followup=final_data.get("followup"),
            )
            db.add(final)

        for cls_id, cls_data in tree.get("classifications", {}).items():
            classification = Classification(
                id=cls_id,
                name=cls_data["name"],
                data=cls_data,
            )
            db.add(classification)

        admin = User(
            username="admin",
            password_hash=pwd_context.hash("admin"),
            fio="Администратор",
            role="admin",
        )
        db.add(admin)

        db.commit()
        node_count = db.query(Node).count()
        final_count = db.query(Final).count()
        print(f"Seeded: {node_count} nodes, {final_count} finals, "
              f"{db.query(Edge).count()} edges, {db.query(Classification).count()} classifications")


if __name__ == "__main__":
    drop = "--drop" in sys.argv
    seed_database(drop_existing=drop)
