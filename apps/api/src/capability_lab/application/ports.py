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
    from capability_lab.application.conversations import ConversationListFilter, ConversationSummary
    from capability_lab.application.order_actions import (
        ActionProposal,
        ActionProposalDraft,
        ActionStatus,
        OrderActionRequest,
    )
    from capability_lab.application.scenario_generation import (
        GeneratedScenario,
        GeneratedScenarioSummary,
        PersonaLibraryFilter,
    )
    from capability_lab.application.support_tools import RetailSupportContext


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

    def list_for_customer(self, customer_id: UUID) -> list[Order]: ...

    def save(self, order: Order, *, expected_version: int, idempotency_key: str) -> None: ...


class OrderWriteConflictError(RuntimeError):
    """Raised when an optimistic order update loses a race."""


class OrderWriteTransientError(RuntimeError):
    """Raised when a modifying write can be retried safely."""


class ActionProposalRepository(Protocol):
    def get(self, proposal_id: UUID) -> ActionProposal | None: ...

    def save(
        self,
        proposal: ActionProposal,
        *,
        expected_status: ActionStatus | None,
    ) -> None: ...


class ActionDecisionIdempotencyRepository(Protocol):
    def claim(
        self,
        idempotency_key: str,
        proposal_id: UUID,
        decision: str,
        created_at: datetime,
    ) -> tuple[UUID, str] | None:
        """Return an existing decision identity, or None after claiming a new key."""
        ...


class SessionRepository(Protocol):
    def get(self, session_id: UUID) -> ConversationSession | None: ...

    def save(self, session: ConversationSession) -> None: ...

    def was_deleted(self, session_id: UUID) -> bool:
        """Return whether this deterministic session identity was permanently deleted."""
        ...

    def delete(self, session_id: UUID, *, deleted_at: datetime) -> bool:
        """Hard-delete the session and its dependents; return whether it existed."""
        ...

    def list_summaries(
        self,
        *,
        limit: int,
        offset: int,
        filters: ConversationListFilter,
    ) -> tuple[list[ConversationSummary], int]: ...


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

    def was_deleted(self, scenario_id: str, scenario_version: str, seed: int) -> bool:
        """Return whether this generated persona reference was permanently deleted."""
        ...

    def delete(
        self,
        scenario_id: str,
        scenario_version: str,
        seed: int,
        *,
        deleted_at: datetime,
    ) -> bool:
        """Delete generated state and dependent conversations; return whether it existed."""
        ...

    def list_summaries(
        self,
        *,
        limit: int,
        offset: int,
        filters: PersonaLibraryFilter,
    ) -> tuple[list[GeneratedScenarioSummary], int]: ...


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
    TRACING = "tracing"


@dataclass(frozen=True, slots=True)
class AgentRequest:
    session_id: UUID
    customer_id: UUID
    scenario_version: str
    message: str
    history: tuple[ConversationTurn, ...]
    support_context: RetailSupportContext


@dataclass(frozen=True, slots=True)
class ToolActivity:
    tool_name: str
    tool_version: str
    outcome: str
    result: dict[str, object]


@dataclass(frozen=True, slots=True)
class StructuredSupportResult:
    summary: str
    customer_id: UUID
    product_ids: tuple[UUID, ...]
    order_ids: tuple[UUID, ...]


@dataclass(frozen=True, slots=True)
class AgentResponse:
    message: str
    structured_result: StructuredSupportResult
    tool_activity: tuple[ToolActivity, ...]
    trace_id: str | None = None


@dataclass(frozen=True, slots=True)
class ConversationTurn:
    id: UUID
    session_id: UUID
    ordinal: int
    request_message: str
    response: AgentResponse
    created_at: datetime


class ConversationTurnRepository(Protocol):
    def get(self, turn_id: UUID) -> ConversationTurn | None: ...

    def list_for_session(self, session_id: UUID) -> list[ConversationTurn]: ...

    def save(self, turn: ConversationTurn) -> None: ...


class AgentAdapter(Protocol):
    @property
    def framework_id(self) -> str: ...

    def capabilities(self) -> frozenset[AgentCapability]: ...

    async def run(self, request: AgentRequest) -> AgentResponse: ...

    async def propose_action(self, request: OrderActionRequest) -> ActionProposalDraft: ...
