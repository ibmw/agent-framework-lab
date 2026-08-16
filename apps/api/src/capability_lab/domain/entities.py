from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from decimal import Decimal
from enum import StrEnum
from uuid import UUID


class DomainError(ValueError):
    """Raised when a domain invariant is violated."""


class OrderStatus(StrEnum):
    PENDING = "pending"
    PAID = "paid"
    CANCELLED = "cancelled"


def _require_utc(value: datetime, field_name: str) -> None:
    # Domain state is canonical UTC; adapters normalize external timestamps before construction.
    if value.utcoffset() != timedelta(0):
        raise DomainError(f"{field_name} must be timezone-aware UTC")


@dataclass(frozen=True, slots=True)
class Customer:
    id: UUID
    email: str
    display_name: str
    created_at: datetime

    def __post_init__(self) -> None:
        if "@" not in self.email:
            raise DomainError("customer email must be valid")
        if not self.display_name.strip():
            raise DomainError("customer display name cannot be empty")
        _require_utc(self.created_at, "customer created_at")


@dataclass(frozen=True, slots=True)
class Product:
    id: UUID
    sku: str
    name: str
    price_amount: Decimal
    currency: str

    def __post_init__(self) -> None:
        if self.price_amount < 0:
            raise DomainError("product price cannot be negative")
        if len(self.currency) != 3:
            raise DomainError("currency must be an ISO 4217 code")


@dataclass(frozen=True, slots=True)
class Order:
    id: UUID
    customer_id: UUID
    created_at: datetime
    status: OrderStatus = OrderStatus.PENDING
    version: int = 1

    def __post_init__(self) -> None:
        if self.version < 1:
            raise DomainError("order version must be positive")
        _require_utc(self.created_at, "order created_at")


@dataclass(frozen=True, slots=True)
class ConversationSession:
    id: UUID
    customer_id: UUID
    seed: int
    scenario_version: str
    initial_state_hash: str
    created_at: datetime

    def __post_init__(self) -> None:
        if not self.scenario_version.strip():
            raise DomainError("scenario version is required")
        if len(self.initial_state_hash) != 64:
            raise DomainError("initial state hash must be a SHA-256 hex digest")
        _require_utc(self.created_at, "session created_at")


@dataclass(frozen=True, slots=True)
class MemoryRecord:
    id: UUID
    session_id: UUID
    namespace: str
    payload: dict[str, object]
    created_at: datetime

    def __post_init__(self) -> None:
        if not self.namespace.strip():
            raise DomainError("memory namespace cannot be empty")
        _require_utc(self.created_at, "memory created_at")
