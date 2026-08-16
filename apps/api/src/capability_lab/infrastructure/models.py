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
)
from sqlalchemy.ext.mutable import MutableDict
from sqlalchemy.orm import Mapped, mapped_column

from capability_lab.infrastructure.database import Base
from capability_lab.infrastructure.sql_types import UtcDateTime


class CustomerModel(Base):
    __tablename__ = "customers"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    email: Mapped[str] = mapped_column(String(320), unique=True)
    display_name: Mapped[str] = mapped_column(String(200))
    created_at: Mapped[datetime] = mapped_column(UtcDateTime())


class ProductModel(Base):
    __tablename__ = "products"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    sku: Mapped[str] = mapped_column(String(80), unique=True)
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
    scenario_version: Mapped[str] = mapped_column(String(64))
    initial_state_hash: Mapped[str] = mapped_column(String(64))
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
