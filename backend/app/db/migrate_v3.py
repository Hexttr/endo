"""Phase v3 migration: multi-bot robustness.

Adds two small but critical pieces on top of v2:

1. `schemas.root_node_id` (VARCHAR 200, NULL) — explicit per-schema starting
   point for the conversation. The decision engine used to hardcode "N000",
   which broke as soon as a second schema was created with a differently
   named root node. We backfill the column for every existing schema that
   has a "{schema_id}::N000" node, so 'endo-bot' and any clone keep working
   out of the box.

2. `UNIQUE INDEX ux_bots_token ON bots(token)` — defence in depth. The bots
   API already rejects duplicate tokens across schemas, but a direct-SQL path
   (seed scripts, manual INSERTs) could bypass it and produce two supervisors
   polling the same Telegram bot → `Conflict 409` → both bots go silent.
   A DB-level unique index closes that window.

The script is IDEMPOTENT (IF NOT EXISTS / conditional backfill), so it's
safe to re-run.

Run with:
    cd /opt/endo-bot2/backend
    python -m app.db.migrate_v3
"""
from sqlalchemy import create_engine, text

from app.config import settings


STMTS = [
    # 1. Add the new column with a sane width. We store the full
    #    "{schema_id}::{short}" form here, matching nodes.id layout.
    "ALTER TABLE schemas ADD COLUMN IF NOT EXISTS root_node_id VARCHAR(200)",

    # 2. Backfill: for each schema whose "<id>::N000" node exists, use it as
    #    the default root. Schemas without an N000 node stay NULL, and the
    #    admin can set the root explicitly from the UI.
    """UPDATE schemas s
       SET root_node_id = s.id || '::N000'
       WHERE root_node_id IS NULL
         AND EXISTS (
           SELECT 1 FROM nodes n
           WHERE n.id = s.id || '::N000' AND n.schema_id = s.id
         )""",

    # 3. Enforce one-token-one-schema at the DB level. Matches the guard
    #    already present in api/bots.py::upsert_bot but catches direct-SQL
    #    bypasses and legacy seed rows.
    "CREATE UNIQUE INDEX IF NOT EXISTS ux_bots_token ON bots(token)",
]


def run():
    engine = create_engine(settings.DATABASE_URL_SYNC, echo=False)
    with engine.begin() as conn:
        for s in STMTS:
            first_line = s.strip().splitlines()[0][:120]
            print(f"  {first_line}{'...' if len(s) > 120 else ''}")
            conn.execute(text(s))
    print("\nMigration v3 complete (root_node_id + bots.token unique index).")


if __name__ == "__main__":
    run()
