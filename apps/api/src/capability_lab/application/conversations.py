from __future__ import annotations

from dataclasses import dataclass
from uuid import NAMESPACE_URL, UUID, uuid5

from capability_lab.application.ports import (
    AgentAdapter,
    AgentRequest,
    Clock,
    ConversationTurn,
    ConversationTurnRepository,
    GeneratedScenarioRepository,
    SessionRepository,
)
from capability_lab.application.support_tools import RetailSupportContext
from capability_lab.domain.entities import ConversationSession


class ConversationNotFoundError(LookupError):
    """Raised when a requested conversation does not exist."""


class AgentFrameworkNotFoundError(LookupError):
    """Raised when a requested framework is not registered."""


class ConversationConflictError(ValueError):
    """Raised when an idempotency key is reused for different conversation input."""


class InvalidConversationMessageError(ValueError):
    """Raised when a conversation message is empty or not normalized."""


class AgentExecutionError(RuntimeError):
    code = "agent_execution_error"


class AgentFrameworkError(AgentExecutionError):
    code = "framework_error"


class AgentProviderError(AgentExecutionError):
    code = "model_provider_error"


class AgentTransientError(AgentExecutionError):
    code = "transient_error"


class AgentToolError(AgentExecutionError):
    code = "tool_error"


class AgentValidationError(AgentExecutionError):
    code = "agent_validation_error"


@dataclass(frozen=True, slots=True)
class FrameworkDeclaration:
    framework_id: str
    available: bool
    model_id: str | None
    capabilities: tuple[str, ...]
    unavailability_reason: str | None = None


class AgentRegistry:
    def __init__(
        self,
        adapters: dict[str, AgentAdapter],
        declarations: tuple[FrameworkDeclaration, ...],
    ) -> None:
        self._adapters = dict(adapters)
        self._declarations = declarations

    def declarations(self) -> tuple[FrameworkDeclaration, ...]:
        return self._declarations

    def get(self, framework_id: str) -> AgentAdapter:
        try:
            return self._adapters[framework_id]
        except KeyError as error:
            raise AgentFrameworkNotFoundError(framework_id) from error


class ConversationService:
    def __init__(
        self,
        sessions: SessionRepository,
        turns: ConversationTurnRepository,
        generated_scenarios: GeneratedScenarioRepository,
        agents: AgentRegistry,
        clock: Clock,
    ) -> None:
        self._sessions = sessions
        self._turns = turns
        self._generated_scenarios = generated_scenarios
        self._agents = agents
        self._clock = clock

    def start(
        self,
        *,
        scenario_id: str,
        scenario_version: str,
        seed: int,
        framework_id: str,
        idempotency_key: str,
    ) -> tuple[ConversationSession, list[ConversationTurn]]:
        _validate_idempotency_key(idempotency_key)
        agent = self._agents.get(framework_id)
        generated = self._generated_scenarios.get(scenario_id, scenario_version, seed)
        if generated is None:
            raise ConversationNotFoundError("generated scenario state is required")

        session_id = uuid5(NAMESPACE_URL, f"agent-lab:conversation:v1:{idempotency_key}")
        candidate = ConversationSession(
            id=session_id,
            customer_id=generated.state.customer.id,
            seed=seed,
            scenario_id=scenario_id,
            scenario_version=scenario_version,
            framework_id=agent.framework_id,
            initial_state_hash=generated.initial_state_hash,
            created_at=self._clock.now(),
        )
        existing = self._sessions.get(session_id)
        if existing is not None:
            if _session_identity(existing) != _session_identity(candidate):
                raise ConversationConflictError(
                    "the idempotency key was already used for different conversation inputs"
                )
            return existing, self._turns.list_for_session(existing.id)
        self._sessions.save(candidate)
        return candidate, []

    def get(self, session_id: UUID) -> tuple[ConversationSession, list[ConversationTurn]]:
        session = self._sessions.get(session_id)
        if session is None:
            raise ConversationNotFoundError("conversation session not found")
        return session, self._turns.list_for_session(session_id)

    async def send(
        self,
        session_id: UUID,
        message: str,
        *,
        idempotency_key: str,
    ) -> tuple[ConversationSession, list[ConversationTurn]]:
        _validate_idempotency_key(idempotency_key)
        if not message.strip() or message != message.strip():
            raise InvalidConversationMessageError(
                "message must not be blank or have surrounding whitespace"
            )
        session, history = self.get(session_id)
        turn_id = uuid5(session.id, f"agent-lab:turn:v1:{idempotency_key}")
        existing = self._turns.get(turn_id)
        if existing is not None:
            if existing.request_message != message:
                raise ConversationConflictError(
                    "the idempotency key was already used for a different message"
                )
            return session, self._turns.list_for_session(session_id)

        generated = self._generated_scenarios.get(
            session.scenario_id,
            session.scenario_version,
            session.seed,
        )
        if generated is None or generated.initial_state_hash != session.initial_state_hash:
            raise ConversationNotFoundError("conversation replay state is unavailable")
        response = await self._agents.get(session.framework_id).run(
            AgentRequest(
                session_id=session.id,
                customer_id=session.customer_id,
                scenario_version=session.scenario_version,
                message=message,
                history=tuple(history),
                support_context=RetailSupportContext(
                    customer=generated.state.customer,
                    products=generated.state.products,
                    orders=generated.state.orders,
                ),
            )
        )
        turn = ConversationTurn(
            id=turn_id,
            session_id=session.id,
            ordinal=len(history) + 1,
            request_message=message,
            response=response,
            created_at=self._clock.now(),
        )
        self._turns.save(turn)
        return session, [*history, turn]


def _validate_idempotency_key(value: str) -> None:
    if not value or value != value.strip():
        raise ConversationConflictError(
            "idempotency key must not be empty or have surrounding whitespace"
        )


def _session_identity(session: ConversationSession) -> tuple[object, ...]:
    return (
        session.customer_id,
        session.seed,
        session.scenario_id,
        session.scenario_version,
        session.framework_id,
        session.initial_state_hash,
    )
