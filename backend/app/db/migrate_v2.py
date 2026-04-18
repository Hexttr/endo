"""Phase B migration: introduce multi-schema support.

Strategy
--------
We keep simple scalar PKs on Node/Final (no composite PK refactor) and instead
prefix every stored node/final ID with the schema it belongs to, using the
format  "<schema_id>::<short_id>"  (e.g.  "endo-bot::B010").

This keeps SQLAlchemy relationships trivial (no ForeignKeyConstraint on tuples),
keeps the bot's current code working with a default schema, and turns the
migration into just:

    1. Create `schemas` table.
    2. Widen ID columns to VARCHAR(100) to fit the prefix.
    3. Add `schema_id` columns (default 'endo-bot').
    4. Drop FK constraints that would block renaming IDs.
    5. Rewrite every existing ID value to 'endo-bot::<old>'.
    6. Recreate FK constraints.

The script is IDEMPOTENT: it only rewrites IDs that don't already contain '::',
so it's safe to re-run after a partial-failure rollback.

Run with:
    cd /opt/endo-bot2/backend
    python -m app.db.migrate_v2
"""
from sqlalchemy import create_engine, text

from app.config import settings


# Possible names Postgres auto-assigns to the FK we need to drop. Using
# IF EXISTS makes each statement idempotent even if the constraint was already
# dropped in a partial earlier run.
FK_DROPS = [
    "ALTER TABLE options DROP CONSTRAINT IF EXISTS options_node_id_fkey",
    "ALTER TABLE edges DROP CONSTRAINT IF EXISTS edges_from_node_id_fkey",
    "ALTER TABLE nodes DROP CONSTRAINT IF EXISTS nodes_schema_id_fkey",
    "ALTER TABLE finals DROP CONSTRAINT IF EXISTS finals_schema_id_fkey",
]

# Re-add FKs after IDs have been rewritten. ON DELETE CASCADE matches the
# model definitions in models.py.
FK_ADDS = [
    """ALTER TABLE options
         ADD CONSTRAINT options_node_id_fkey
         FOREIGN KEY (node_id) REFERENCES nodes(id) ON DELETE CASCADE""",
    """ALTER TABLE edges
         ADD CONSTRAINT edges_from_node_id_fkey
         FOREIGN KEY (from_node_id) REFERENCES nodes(id) ON DELETE CASCADE""",
    """ALTER TABLE nodes
         ADD CONSTRAINT nodes_schema_id_fkey
         FOREIGN KEY (schema_id) REFERENCES schemas(id) ON DELETE CASCADE""",
    """ALTER TABLE finals
         ADD CONSTRAINT finals_schema_id_fkey
         FOREIGN KEY (schema_id) REFERENCES schemas(id) ON DELETE CASCADE""",
]


STMTS_BEFORE_UPDATE = [
    # Create schemas table
    """CREATE TABLE IF NOT EXISTS schemas (
        id VARCHAR(50) PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )""",
    """INSERT INTO schemas (id, name, description)
       VALUES ('endo-bot', 'Эндо-бот',
               'Исходная схема эндоскопической диагностики')
       ON CONFLICT (id) DO NOTHING""",

    # Widen ID columns so the "schema::short" form fits
    "ALTER TABLE nodes ALTER COLUMN id TYPE VARCHAR(100)",
    "ALTER TABLE options ALTER COLUMN node_id TYPE VARCHAR(100)",
    "ALTER TABLE options ALTER COLUMN next_node_id TYPE VARCHAR(100)",
    "ALTER TABLE edges ALTER COLUMN from_node_id TYPE VARCHAR(100)",
    "ALTER TABLE edges ALTER COLUMN to_node_id TYPE VARCHAR(100)",
    "ALTER TABLE nodes ALTER COLUMN return_node TYPE VARCHAR(100)",
    "ALTER TABLE finals ALTER COLUMN id TYPE VARCHAR(100)",
    "ALTER TABLE sessions ALTER COLUMN current_node_id TYPE VARCHAR(100)",

    # Add schema_id columns with sensible default so existing rows backfill
    "ALTER TABLE nodes ADD COLUMN IF NOT EXISTS schema_id VARCHAR(50) NOT NULL DEFAULT 'endo-bot'",
    "ALTER TABLE options ADD COLUMN IF NOT EXISTS schema_id VARCHAR(50) NOT NULL DEFAULT 'endo-bot'",
    "ALTER TABLE edges ADD COLUMN IF NOT EXISTS schema_id VARCHAR(50) NOT NULL DEFAULT 'endo-bot'",
    "ALTER TABLE finals ADD COLUMN IF NOT EXISTS schema_id VARCHAR(50) NOT NULL DEFAULT 'endo-bot'",
    "ALTER TABLE classifications ADD COLUMN IF NOT EXISTS schema_id VARCHAR(50) NOT NULL DEFAULT 'endo-bot'",
    "ALTER TABLE sessions ADD COLUMN IF NOT EXISTS schema_id VARCHAR(50) NOT NULL DEFAULT 'endo-bot'",
    "ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS schema_id VARCHAR(50)",

    # Helpful indexes
    "CREATE INDEX IF NOT EXISTS ix_nodes_schema ON nodes(schema_id)",
    "CREATE INDEX IF NOT EXISTS ix_options_schema_node ON options(schema_id, node_id)",
    "CREATE INDEX IF NOT EXISTS ix_edges_schema_from ON edges(schema_id, from_node_id)",
    "CREATE INDEX IF NOT EXISTS ix_finals_schema ON finals(schema_id)",
    "CREATE INDEX IF NOT EXISTS ix_sessions_schema_user ON sessions(schema_id, user_id)",
]


STMTS_UPDATE = [
    # Rewrite IDs into prefixed form (idempotent: skip already-prefixed).
    # Order: update leaf-refs (next_node_id, to_node_id, return_node,
    # current_node_id) first, then FK-referenced IDs (node_id, from_node_id),
    # then PKs (nodes.id, finals.id).
    "UPDATE nodes SET return_node = schema_id || '::' || return_node WHERE return_node IS NOT NULL AND return_node NOT LIKE '%::%'",
    "UPDATE options SET next_node_id = schema_id || '::' || next_node_id WHERE next_node_id IS NOT NULL AND next_node_id NOT LIKE '%::%'",
    "UPDATE edges SET to_node_id = schema_id || '::' || to_node_id WHERE to_node_id NOT LIKE '%::%'",
    "UPDATE sessions SET current_node_id = schema_id || '::' || current_node_id WHERE current_node_id IS NOT NULL AND current_node_id NOT LIKE '%::%'",
    "UPDATE options SET node_id = schema_id || '::' || node_id WHERE node_id NOT LIKE '%::%'",
    "UPDATE edges SET from_node_id = schema_id || '::' || from_node_id WHERE from_node_id NOT LIKE '%::%'",
    "UPDATE nodes SET id = schema_id || '::' || id WHERE id NOT LIKE '%::%'",
    "UPDATE finals SET id = schema_id || '::' || id WHERE id NOT LIKE '%::%'",
]


def run():
    engine = create_engine(settings.DATABASE_URL_SYNC, echo=False)
    with engine.begin() as conn:
        for s in STMTS_BEFORE_UPDATE:
            print(f"  {s[:120]}{'...' if len(s) > 120 else ''}")
            conn.execute(text(s))

        print("\n  -- Dropping FK constraints --")
        for s in FK_DROPS:
            print(f"  {s}")
            conn.execute(text(s))

        print("\n  -- Rewriting IDs --")
        for s in STMTS_UPDATE:
            print(f"  {s[:120]}{'...' if len(s) > 120 else ''}")
            conn.execute(text(s))

        print("\n  -- Re-adding FK constraints --")
        for s in FK_ADDS:
            print(f"  {s[:120].replace(chr(10), ' ')}")
            conn.execute(text(s))

    print("\nMigration v2 complete (multi-schema prefix).")


if __name__ == "__main__":
    run()
