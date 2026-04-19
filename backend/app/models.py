import datetime
from sqlalchemy import (
    Column, String, Text, Integer, Boolean, DateTime, Float, ForeignKey, JSON, Index,
    ForeignKeyConstraint, UniqueConstraint,
)
from sqlalchemy.orm import relationship
import enum

from app.db.database import Base


DEFAULT_SCHEMA_ID = "endo-bot"


class InputType(str, enum.Enum):
    single_choice = "single_choice"
    multi_choice = "multi_choice"
    yes_no = "yes_no"
    numeric = "numeric"
    info = "info"
    action = "action"
    auto = "auto"


class UnknownAction(str, enum.Enum):
    safe_default = "safe_default"
    branch_c = "branch_c"
    skip_with_flag = "skip_with_flag"


class SessionStatus(str, enum.Enum):
    active = "active"
    pending = "pending"
    completed = "completed"
    abandoned = "abandoned"


class Schema(Base):
    __tablename__ = "schemas"

    id = Column(String(50), primary_key=True)
    name = Column(Text, nullable=False)
    description = Column(Text, nullable=True)
    # Full-id of the node where /start begins. Stored as "{schema_id}::{short_id}".
    # Nullable for backward compatibility — engine falls back to N000 if unset.
    root_node_id = Column(String(200), nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)


class Section(Base):
    """A named grouping of nodes within a schema (e.g. "branch_a", "overview").

    Holds the human-readable label, description and UI colour. Previously this
    metadata lived hardcoded in the admin frontend (SECTION_LABELS /
    SECTION_COLORS); moving it here lets non-technical users edit sections from
    the Dashboard and keeps every schema-scoped.

    The slug column is what Node.section references via a composite FK
    (schema_id, section) -> (schema_id, slug). `ON UPDATE CASCADE` lets us
    rename a section slug in one place and have every node follow along.
    """
    __tablename__ = "sections"

    # Full id ("{schema_id}::{slug}") mirrors the Node/Final convention so it's
    # globally unique across schemas.
    id = Column(String(200), primary_key=True)
    schema_id = Column(String(50), ForeignKey("schemas.id", ondelete="CASCADE"),
                       nullable=False, index=True)
    slug = Column(String(100), nullable=False)
    label = Column(String(200), nullable=False)
    description = Column(Text, nullable=True)
    # Tailwind preset key or a raw hex colour — renderer accepts both.
    color = Column(String(30), nullable=True)
    # Manual ordering inside the Dashboard / filters. Lower = earlier.
    order = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime, default=datetime.datetime.utcnow, nullable=False)

    __table_args__ = (
        # (schema_id, slug) must be unique so Node's composite FK can target it.
        UniqueConstraint("schema_id", "slug", name="uq_section_schema_slug"),
    )


class Node(Base):
    __tablename__ = "nodes"

    # IDs are stored internally as "{schema_id}::{short_id}" (e.g. "endo-bot::B010").
    # This keeps SQLAlchemy relationships simple while allowing the same short
    # ID (B010) to exist in multiple schemas. API layer strips the prefix when
    # returning data to clients.
    id = Column(String(100), primary_key=True)
    schema_id = Column(String(50), ForeignKey("schemas.id", ondelete="CASCADE"), nullable=False, default=DEFAULT_SCHEMA_ID, index=True)
    section = Column(String(100), nullable=False, index=True)
    text = Column(Text, nullable=False)
    description = Column(Text, nullable=True)
    input_type = Column(String(20), nullable=False, default="info")
    unknown_action = Column(String(20), nullable=True)
    is_terminal = Column(Boolean, default=False)
    is_pending = Column(Boolean, default=False)
    return_node = Column(String(100), nullable=True)
    allow_multiple = Column(Boolean, default=False)
    extra = Column(JSON, nullable=True)
    position_x = Column(Float, nullable=True)
    position_y = Column(Float, nullable=True)
    layout_manual = Column(Boolean, default=False, nullable=False)

    options = relationship("Option", back_populates="node", cascade="all, delete-orphan")
    edges_from = relationship("Edge", foreign_keys="Edge.from_node_id", back_populates="from_node", cascade="all, delete-orphan")

    # Composite FK ties (schema_id, section) to (sections.schema_id, sections.slug).
    # ON UPDATE CASCADE means renaming a section slug in the UI auto-propagates
    # to every node that references it, zero-downtime.
    __table_args__ = (
        ForeignKeyConstraint(
            ["schema_id", "section"],
            ["sections.schema_id", "sections.slug"],
            name="nodes_section_fkey",
            onupdate="CASCADE",
            ondelete="RESTRICT",
        ),
    )

    def __repr__(self):
        return f"<Node {self.id}: {self.text[:40]}>"


class Option(Base):
    __tablename__ = "options"

    id = Column(Integer, primary_key=True, autoincrement=True)
    node_id = Column(String(100), ForeignKey("nodes.id", ondelete="CASCADE"), nullable=False, index=True)
    schema_id = Column(String(50), nullable=False, default=DEFAULT_SCHEMA_ID, index=True)
    option_id = Column(String(100), nullable=False)
    label = Column(Text, nullable=False)
    next_node_id = Column(String(100), nullable=True)
    priority = Column(Integer, nullable=True)
    extra = Column(JSON, nullable=True)

    node = relationship("Node", back_populates="options")

    __table_args__ = (
        Index("ix_option_node_option", "node_id", "option_id", unique=True),
    )


class Edge(Base):
    __tablename__ = "edges"

    id = Column(Integer, primary_key=True, autoincrement=True)
    from_node_id = Column(String(100), ForeignKey("nodes.id", ondelete="CASCADE"), nullable=False, index=True)
    schema_id = Column(String(50), nullable=False, default=DEFAULT_SCHEMA_ID, index=True)
    to_node_id = Column(String(100), nullable=False, index=True)
    label = Column(Text, nullable=True)
    condition_logic = Column(JSON, nullable=True)
    priority = Column(Integer, default=0)

    from_node = relationship("Node", foreign_keys=[from_node_id], back_populates="edges_from")


class Final(Base):
    __tablename__ = "finals"

    id = Column(String(100), primary_key=True)
    schema_id = Column(String(50), ForeignKey("schemas.id", ondelete="CASCADE"), nullable=False, default=DEFAULT_SCHEMA_ID, index=True)
    diagnosis = Column(Text, nullable=False)
    endo_picture = Column(Text, nullable=True)
    equipment = Column(JSON, nullable=True)
    algorithm = Column(Text, nullable=True)
    routing = Column(Text, nullable=True)
    followup = Column(Text, nullable=True)


class Classification(Base):
    __tablename__ = "classifications"

    id = Column(String(50), primary_key=True)
    schema_id = Column(String(50), nullable=False, default=DEFAULT_SCHEMA_ID, index=True)
    name = Column(Text, nullable=False)
    data = Column(JSON, nullable=False)


class Session(Base):
    __tablename__ = "sessions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    schema_id = Column(String(50), nullable=False, default=DEFAULT_SCHEMA_ID, index=True)
    user_id = Column(String(100), nullable=False, index=True)
    current_node_id = Column(String(100), nullable=True)
    collected_data = Column(JSON, default=dict)
    unknown_flags = Column(JSON, default=list)
    status = Column(String(20), default="active")
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, autoincrement=True)
    username = Column(String(100), unique=True, nullable=False)
    password_hash = Column(String(255), nullable=False)
    # Human-readable full name ("Иванов Иван Иванович"). Optional but shown
    # in the admin panel user list and audit log once set.
    fio = Column(String(200), nullable=True)
    # Roles: 'admin' (user CRUD + all editor perms), 'editor' (schema CRUD).
    role = Column(String(20), default="editor")
    created_at = Column(DateTime, default=datetime.datetime.utcnow)


class Bot(Base):
    """Binding of a Telegram bot token to a schema.

    The orchestrator process polls this table and (re)starts one
    python-telegram-bot Application per enabled row. One bot = one schema.
    """
    __tablename__ = "bots"

    id = Column(Integer, primary_key=True, autoincrement=True)
    # One bot per schema (uniqueness enforced by index, not by PK so we can
    # later lift this if needed).
    schema_id = Column(String(50), ForeignKey("schemas.id", ondelete="CASCADE"),
                       nullable=False, unique=True, index=True)
    token = Column(Text, nullable=False)
    username = Column(String(100), nullable=True)   # cached @username from getMe
    enabled = Column(Boolean, nullable=False, default=True)
    # Lifecycle: stopped / starting / running / error / token_conflict
    status = Column(String(20), nullable=False, default="stopped")
    last_error = Column(Text, nullable=True)
    started_at = Column(DateTime, nullable=True)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow,
                        onupdate=datetime.datetime.utcnow, nullable=False)
    created_at = Column(DateTime, default=datetime.datetime.utcnow, nullable=False)


class AuditLog(Base):
    __tablename__ = "audit_log"

    id = Column(Integer, primary_key=True, autoincrement=True)
    schema_id = Column(String(50), nullable=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    action = Column(String(50), nullable=False)
    entity_type = Column(String(50), nullable=False)
    entity_id = Column(String(200), nullable=False)
    old_value = Column(JSON, nullable=True)
    new_value = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
