"""One-shot migration: add position_x, position_y, layout_manual columns to nodes table.

Idempotent — safe to run multiple times. Uses ALTER TABLE ... ADD COLUMN IF NOT EXISTS
(PostgreSQL 9.6+).

Usage (on server):
    cd /opt/endo-bot2/backend
    python -m app.db.migrate_positions
"""
from sqlalchemy import create_engine, text

from app.config import settings


def run():
    engine = create_engine(settings.DATABASE_URL_SYNC, echo=False)
    stmts = [
        "ALTER TABLE nodes ADD COLUMN IF NOT EXISTS position_x DOUBLE PRECISION",
        "ALTER TABLE nodes ADD COLUMN IF NOT EXISTS position_y DOUBLE PRECISION",
        "ALTER TABLE nodes ADD COLUMN IF NOT EXISTS layout_manual BOOLEAN NOT NULL DEFAULT FALSE",
    ]
    with engine.begin() as conn:
        for s in stmts:
            print(f"  {s}")
            conn.execute(text(s))
    print("Migration complete.")


if __name__ == "__main__":
    run()
