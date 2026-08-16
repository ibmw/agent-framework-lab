from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum
from typing import Protocol
from uuid import UUID

from capability_lab.domain.entities import (
    ConversationSession,
    Customer,
    MemoryRecord,
    Order,
    Product,
)


class CustomerRepository(Protocol):
    def get(self, customer_id: UUID) -> Customer | None: ...

    def save(self, customer: Customer) -> None: ...


class ProductRepository(Protocol):
    def get(self, product_id: UUID) -> Product | None: ...

    def save(self, product: Product) -> None: ...


class OrderRepository(Protocol):
    def get(self, order_id: UUID) -> Order | None: ...

    def save(self, order: Order, *, expected_version: int, idempotency_key: str) -> None: ...


class SessionRepository(Protocol):
    def get(self, session_id: UUID) -> ConversationSession | None: ...

    def save(self, session: ConversationSession) -> None: ...


class MemoryRepository(Protocol):
    def list_for_session(self, session_id: UUID) -> list[MemoryRecord]: ...

    def append(self, record: MemoryRecord) -> None: ...


class Clock(Protocol):
    def now(self) -> datetime: ...


class AgentCapability(StrEnum):
    TOOL_CALLS = "tool_calls"
    CONVERSATION_MEMORY = "conversation_memory"
    DURABLE_MEMORY = "durable_memory"
    SESSION_RESUME = "session_resume"
    STRUCTURED_OUTPUT = "structured_output"
    CONFIRMATION = "confirmation"
    RETRIES = "retries"
    TRACING = "tracing"


@dataclass(frozen=True, slots=True)
class AgentRequest:
    session_id: UUID
    message: str


@dataclass(frozen=True, slots=True)
class AgentResponse:
    message: str
    trace_id: str | None = None


class AgentAdapter(Protocol):
    @property
    def framework_id(self) -> str: ...

    def capabilities(self) -> frozenset[AgentCapability]: ...

    async def run(self, request: AgentRequest) -> AgentResponse: ...
