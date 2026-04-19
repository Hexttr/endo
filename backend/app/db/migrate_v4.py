"""Phase v4 migration: promote sections to first-class entities.

Before v4, `Node.section` was a free-form string and the human-readable
label/colour/description lived hardcoded in the admin frontend. v4 introduces:

  * `sections` table — one row per (schema_id, slug), carrying label,
    description, colour and ordering.
  * Composite FK `nodes (schema_id, section) -> sections (schema_id, slug)`
    with `ON UPDATE CASCADE`, so renaming a slug in the UI cascades to every
    node automatically.

Backfill strategy:
  1. Seed the 'endo-bot' schema with the 14 sections that used to be
     hardcoded in `admin/src/pages/NodeEditor.jsx::SECTION_LABELS` and
     `TreeView.jsx::SECTION_COLORS`, preserving labels/colours 1:1.
  2. For every OTHER schema, derive rows from the distinct `nodes.section`
     values that already exist — label defaults to the slug, colour null
     (admin can edit from the Dashboard afterwards).

Only after the seed is complete do we add the composite FK — doing it in
that order avoids `insert or update on table "nodes" violates foreign key
constraint` errors on legacy rows whose section wasn't in the hardcoded map.

Script is IDEMPOTENT: re-running is safe.

Run with:
    cd /opt/endo-bot2/backend
    python -m app.db.migrate_v4
"""
from sqlalchemy import create_engine, text

from app.config import settings


# Mirror of the frontend hardcoded maps. Keep this list the single
# source of truth for the migration — once applied, all of this lives in DB.
ENDO_SECTIONS = [
    # slug, label, colour preset, order
    ("overview", "Начало — маршрутизация по типу ситуации",
     "green", 10,
     "Первый узел диалога: определяем, с какой ситуацией пришёл пациент."),
    ("branch_a", "Ветка A — Острая ситуация", "red", 20,
     "Диагностика при острой клинической картине."),
    ("branch_a_vrvp", "Ветка A — ВРВП при острой ситуации", "pink", 21,
     "Подозрение на кровотечение из варикозно расширенных вен пищевода."),
    ("branch_a_egds", "Ветка A — Результаты ЭГДС", "rose", 22,
     "Интерпретация находок при эндоскопии в остром режиме."),
    ("branch_b", "Ветка B — Хроническая ситуация", "orange", 30,
     "Плановое обследование без признаков кровотечения."),
    ("branch_b_complaints", "Ветка B — Жалобы", "yellow", 31,
     "Сбор жалоб при плановой диагностике."),
    ("branch_b_history", "Ветка B — Анамнез", "amber", 32,
     "Семейный анамнез, предшествующие заболевания."),
    ("branch_b_polyps", "Ветка B — Полипы", "purple", 33,
     "Уточняющие вопросы при обнаружении полипов."),
    ("branch_b_vrvp", "Ветка B — ВРВП (профилактика)", "fuchsia", 34,
     "Профилактика кровотечения из варикозно расширенных вен."),
    ("branch_b_erosions", "Ветка B — Эрозии", "red", 35,
     "Эрозивные изменения слизистой."),
    ("branch_b_ulcers", "Ветка B — Язвенная болезнь", "orange", 36,
     "Язвенные поражения желудка и 12-перстной кишки."),
    ("branch_b_ere", "Ветка B — Эрозивный рефлюкс-эзофагит", "green", 37,
     "Диагностика ГЭРБ."),
    ("branch_b_burn", "Ветка B — Ожоговое поражение", "red", 38,
     "Химические и термические ожоги ЖКТ."),
    ("branch_c", "Ветка C — Неопределённая ситуация", "blue", 40,
     "Случаи с неполными данными, требующие дообследования."),
]


def run():
    engine = create_engine(settings.DATABASE_URL_SYNC, echo=False)
    with engine.begin() as conn:
        # 1. Create the table. Matches the SQLAlchemy model in models.py.
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS sections (
                id          VARCHAR(200) PRIMARY KEY,
                schema_id   VARCHAR(50) NOT NULL REFERENCES schemas(id) ON DELETE CASCADE,
                slug        VARCHAR(100) NOT NULL,
                label       VARCHAR(200) NOT NULL,
                description TEXT,
                color       VARCHAR(30),
                "order"     INTEGER NOT NULL DEFAULT 0,
                created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT uq_section_schema_slug UNIQUE (schema_id, slug)
            )
        """))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_sections_schema ON sections(schema_id)"))

        # 2. Seed endo-bot from the hardcoded map.
        for slug, label, color, order, description in ENDO_SECTIONS:
            conn.execute(text("""
                INSERT INTO sections (id, schema_id, slug, label, description, color, "order")
                VALUES (:id, 'endo-bot', :slug, :label, :description, :color, :order)
                ON CONFLICT (id) DO NOTHING
            """), {
                "id": f"endo-bot::{slug}",
                "slug": slug, "label": label,
                "description": description, "color": color, "order": order,
            })

        # 3. Backfill every schema with any remaining distinct nodes.section values
        #    that weren't in the hardcoded seed (covers custom schemas and
        #    sections admins have already added to endo-bot via raw SQL).
        conn.execute(text("""
            INSERT INTO sections (id, schema_id, slug, label, description, color, "order")
            SELECT
                n.schema_id || '::' || n.section AS id,
                n.schema_id,
                n.section AS slug,
                n.section AS label,
                NULL, NULL, 0
            FROM (SELECT DISTINCT schema_id, section FROM nodes) n
            ON CONFLICT (id) DO NOTHING
        """))

        # 4. Now every Node.section has a matching Section row → safe to
        #    add the composite FK.
        exists = conn.execute(text("""
            SELECT 1 FROM information_schema.table_constraints
            WHERE constraint_name = 'nodes_section_fkey' AND table_name = 'nodes'
        """)).scalar()
        if not exists:
            conn.execute(text("""
                ALTER TABLE nodes
                    ADD CONSTRAINT nodes_section_fkey
                    FOREIGN KEY (schema_id, section)
                    REFERENCES sections (schema_id, slug)
                    ON UPDATE CASCADE
                    ON DELETE RESTRICT
            """))

        # 5. Add user.fio column for the new "Пользователи" admin screen.
        conn.execute(text(
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS fio VARCHAR(200)"
        ))

        # 6. Promote any pre-existing 'admin' username to role='admin' so
        #    they can create additional admins from the UI without a manual
        #    psql step. Idempotent — only updates rows still on 'editor'.
        conn.execute(text("""
            UPDATE users SET role = 'admin'
            WHERE username = 'admin' AND role != 'admin'
        """))

    print("\nMigration v4 complete (sections table + composite FK + users.fio).")


if __name__ == "__main__":
    run()
