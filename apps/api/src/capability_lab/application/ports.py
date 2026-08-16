from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum
from typing import TYPE_CHECKING, Protocol
from uuid import UUID

from capability_lab.domain.entities import (
    ConversationSession,
    Customer,
    MemoryRecord,
    Order,
    Persona,
    Product,
)

if TYPE_CHECKING:
    from capability_lab.application.scenario_generation import GeneratedScenario


class CustomerRepository(Protocol):
    def get(self, customer_id: UUID) -> Customer | None: ...

    def save(self, customer: Customer) -> None: ...


class PersonaRepository(Protocol):
    def get(self, persona_id: UUID) -> Persona | None: ...

    def save(self, persona: Persona) -> None: ...


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


class GeneratedScenarioRepository(Protocol):
    def get(
        self,
        scenario_id: str,
        scenario_version: str,
        seed: int,
    ) -> GeneratedScenario | None: ...

    def save(self, generated: GeneratedScenario) -> None: ...


class ScenarioGenerationIdempotencyRepository(Protocol):
    def claim(
        self,
        idempotency_key: str,
        scenario_id: str,
        scenario_version: str,
        seed: int,
        created_at: datetime,
    ) -> tuple[str, str, int] | None:
        """Return an existing command identity, or None after claiming a new key."""
        ...


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
