from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from sqlalchemy import (
    JSON,
    BigInteger,
    CheckConstraint,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    UniqueConstraint,
)
from sqlalchemy.ext.mutable import MutableDict
from sqlalchemy.orm import Mapped, mapped_column

from capability_lab.infrastructure.database import Base
from capability_lab.infrastructure.sql_types import UtcDateTime


class CustomerModel(Base):
    __tablename__ = "customers"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    email: Mapped[str] = mapped_column(String(320))
    display_name: Mapped[str] = mapped_column(String(200))
    created_at: Mapped[datetime] = mapped_column(UtcDateTime())


class ProductModel(Base):
    __tablename__ = "products"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    sku: Mapped[str] = mapped_column(String(80))
    name: Mapped[str] = mapped_column(String(200))
    price_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    currency: Mapped[str] = mapped_column(String(3))


class OrderModel(Base):
    __tablename__ = "orders"
    __table_args__ = (
        CheckConstraint("version >= 1", name="ck_orders_version_positive"),
        CheckConstraint(
            "status IN ('pending', 'paid', 'cancelled')",
            name="ck_orders_status_valid",
        ),
        Index("ix_orders_customer_id", "customer_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    customer_id: Mapped[str] = mapped_column(ForeignKey("customers.id"))
    status: Mapped[str] = mapped_column(String(32))
    version: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(UtcDateTime())


class ConversationSessionModel(Base):
    __tablename__ = "conversation_sessions"
    __table_args__ = (Index("ix_conversation_sessions_customer_id", "customer_id"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    customer_id: Mapped[str] = mapped_column(ForeignKey("customers.id"))
    seed: Mapped[int] = mapped_column(BigInteger)
    scenario_id: Mapped[str] = mapped_column(String(64), server_default="retail-profile")
    scenario_version: Mapped[str] = mapped_column(String(64))
    framework_id: Mapped[str] = mapped_column(String(64), server_default="fake")
    initial_state_hash: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(UtcDateTime())


class ConversationTurnModel(Base):
    __tablename__ = "conversation_turns"
    __table_args__ = (
        UniqueConstraint("session_id", "ordinal", name="uq_conversation_turns_ordinal"),
        Index("ix_conversation_turns_session_id", "session_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    session_id: Mapped[str] = mapped_column(ForeignKey("conversation_sessions.id"))
    ordinal: Mapped[int] = mapped_column(Integer)
    request_message: Mapped[str] = mapped_column(String(4000))
    response_message: Mapped[str] = mapped_column(String(8000))
    structured_result: Mapped[dict[str, object]] = mapped_column(JSON)
    tool_activity: Mapped[list[dict[str, object]]] = mapped_column(JSON)
    trace_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    created_at: Mapped[datetime] = mapped_column(UtcDateTime())


class MemoryRecordModel(Base):
    __tablename__ = "memory_records"
    __table_args__ = (Index("ix_memory_records_session_id", "session_id"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    session_id: Mapped[str] = mapped_column(ForeignKey("conversation_sessions.id"))
    namespace: Mapped[str] = mapped_column(String(100))
    payload: Mapped[dict[str, object]] = mapped_column(MutableDict.as_mutable(JSON))
    created_at: Mapped[datetime] = mapped_column(UtcDateTime())


class IdempotencyRecordModel(Base):
    __tablename__ = "idempotency_records"

    key: Mapped[str] = mapped_column(String(128), primary_key=True)
    operation: Mapped[str] = mapped_column(String(100), primary_key=True)
    response: Mapped[dict[str, object]] = mapped_column(MutableDict.as_mutable(JSON))
    created_at: Mapped[datetime] = mapped_column(UtcDateTime())


class PersonaModel(Base):
    __tablename__ = "personas"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    display_name: Mapped[str] = mapped_column(String(200))
    email: Mapped[str] = mapped_column(String(320))
    locale: Mapped[str] = mapped_column(String(32))
    support_traits: Mapped[list[str]] = mapped_column(JSON)


class GeneratedScenarioModel(Base):
    __tablename__ = "generated_scenarios"
    __table_args__ = (
        CheckConstraint("seed >= 0 AND seed <= 4294967295", name="ck_generated_seed_range"),
        UniqueConstraint(
            "scenario_id",
            "scenario_version",
            "seed",
            name="uq_generated_scenarios_reference",
        ),
    )

    initial_state_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    scenario_id: Mapped[str] = mapped_column(String(64))
    scenario_version: Mapped[str] = mapped_column(String(64))
    policy_set_version: Mapped[str] = mapped_column(String(64))
    canonical_schema_version: Mapped[str] = mapped_column(String(64))
    seed: Mapped[int] = mapped_column(BigInteger)
    persona_id: Mapped[str] = mapped_column(ForeignKey("personas.id"))
    customer_id: Mapped[str] = mapped_column(ForeignKey("customers.id"))
    created_at: Mapped[datetime] = mapped_column(UtcDateTime())


class GeneratedScenarioProductModel(Base):
    __tablename__ = "generated_scenario_products"

    initial_state_hash: Mapped[str] = mapped_column(
        ForeignKey("generated_scenarios.initial_state_hash"), primary_key=True
    )
    product_id: Mapped[str] = mapped_column(ForeignKey("products.id"), primary_key=True)


class GeneratedScenarioOrderModel(Base):
    __tablename__ = "generated_scenario_orders"

    initial_state_hash: Mapped[str] = mapped_column(
        ForeignKey("generated_scenarios.initial_state_hash"), primary_key=True
    )
    order_id: Mapped[str] = mapped_column(ForeignKey("orders.id"), primary_key=True)
    customer_id: Mapped[str] = mapped_column(String(36))
    status: Mapped[str] = mapped_column(String(32))
    version: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(UtcDateTime())


class ActionProposalModel(Base):
    __tablename__ = "action_proposals"
    __table_args__ = (
        CheckConstraint(
            "status IN ('proposed', 'confirmed', 'cancelled', 'executed')",
            name="ck_action_proposals_status_valid",
        ),
        Index("ix_action_proposals_session_id", "session_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    session_id: Mapped[str] = mapped_column(ForeignKey("conversation_sessions.id"))
    action_type: Mapped[str] = mapped_column(String(64))
    tool_name: Mapped[str] = mapped_column(String(100))
    tool_version: Mapped[str] = mapped_column(String(64))
    order_id: Mapped[str] = mapped_column(ForeignKey("orders.id"))
    expected_version: Mapped[int] = mapped_column(Integer)
    summary: Mapped[str] = mapped_column(String(1000))
    confirmation_token: Mapped[str] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(32))
    attempts: Mapped[int] = mapped_column(Integer)
    result_order_status: Mapped[str | None] = mapped_column(String(32), nullable=True)
    result_order_version: Mapped[int | None] = mapped_column(Integer, nullable=True)


class DefinitionDraftModel(Base):
    """The single mutable draft of one authorable definition."""

    __tablename__ = "definition_drafts"
    __table_args__ = (
        CheckConstraint(
            "definition_type IN ("
            "'shop', 'customer_profile', 'support_identity', 'ticket', 'scenario', "
            "'objective_block', 'mutation_block', 'agent_configuration')",
            name="ck_definition_drafts_type_valid",
        ),
        Index("ix_definition_drafts_shop_id", "shop_id"),
    )

    definition_type: Mapped[str] = mapped_column(String(32), primary_key=True)
    definition_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    shop_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    references: Mapped[list[dict[str, object]]] = mapped_column(JSON)
    payload: Mapped[dict[str, object]] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(UtcDateTime())
    updated_at: Mapped[datetime] = mapped_column(UtcDateTime())


class DefinitionVersionModel(Base):
    """An immutable published version; the primary key forbids overwriting one."""

    __tablename__ = "definition_versions"
    __table_args__ = (
        CheckConstraint("version >= 1", name="ck_definition_versions_version_positive"),
        CheckConstraint(
            "shop_version IS NULL OR shop_version >= 1",
            name="ck_definition_versions_shop_version_positive",
        ),
        CheckConstraint(
            "definition_type IN ("
            "'shop', 'customer_profile', 'support_identity', 'ticket', 'scenario', "
            "'objective_block', 'mutation_block', 'agent_configuration')",
            name="ck_definition_versions_type_valid",
        ),
        Index("ix_definition_versions_definition", "definition_type", "definition_id"),
    )

    definition_type: Mapped[str] = mapped_column(String(32), primary_key=True)
    definition_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    version: Mapped[int] = mapped_column(Integer, primary_key=True)
    content_fingerprint: Mapped[str] = mapped_column(String(64))
    shop_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    shop_version: Mapped[int | None] = mapped_column(Integer, nullable=True)
    references: Mapped[list[dict[str, object]]] = mapped_column(JSON)
    payload: Mapped[dict[str, object]] = mapped_column(JSON)
    published_at: Mapped[datetime] = mapped_column(UtcDateTime())
