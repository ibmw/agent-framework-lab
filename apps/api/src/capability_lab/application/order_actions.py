from __future__ import annotations

import hashlib
import hmac
import json
from dataclasses import dataclass, replace
from enum import StrEnum
from uuid import UUID, uuid5

from capability_lab.application.conversations import AgentRegistry, ConversationNotFoundError
from capability_lab.application.ports import (
    ActionDecisionIdempotencyRepository,
    ActionProposalRepository,
    Clock,
    GeneratedScenarioRepository,
    OrderRepository,
    OrderWriteConflictError,
    OrderWriteTransientError,
    SessionRepository,
)
from capability_lab.domain.entities import (
    Order,
    OrderActionRefusedError,
    StaleOrderVersionError,
)

CANCEL_ORDER_TOOL_NAME = "cancel_order"
ACTION_TOOL_VERSION = "v1"
ACTION_SCENARIO_ID = "retail-order-cancellation"


class OrderActionType(StrEnum):
    CANCEL_ORDER = "cancel_order"


class ActionStatus(StrEnum):
    PROPOSED = "proposed"
    CONFIRMED = "confirmed"
    CANCELLED = "cancelled"
    EXECUTED = "executed"


class ActionProposalNotFoundError(LookupError):
    """Raised when an action proposal is unavailable in the scoped session."""


class ActionConflictError(ValueError):
    """Raised when action state, command identity, or order version conflicts."""


class ActionConfirmationError(ValueError):
    """Raised when confirmation is absent or does not match the exact proposal."""


class ActionRefusedError(ValueError):
    """Raised when business policy refuses an action."""


class ActionTransientError(RuntimeError):
    """Raised after safe retry attempts cannot complete a modifying action."""


@dataclass(frozen=True, slots=True)
class OrderActionRequest:
    session_id: UUID
    customer_id: UUID
    order: Order
    action_type: OrderActionType
    expected_version: int


@dataclass(frozen=True, slots=True)
class ActionProposalDraft:
    action_type: OrderActionType
    tool_name: str
    tool_version: str
    order_id: UUID
    expected_version: int
    summary: str


@dataclass(frozen=True, slots=True)
class ActionProposal:
    id: UUID
    session_id: UUID
    action_type: OrderActionType
    tool_name: str
    tool_version: str
    order_id: UUID
    expected_version: int
    summary: str
    confirmation_token: str
    status: ActionStatus
    attempts: int
    result_order_status: str | None
    result_order_version: int | None


class OrderActionService:
    def __init__(
        self,
        sessions: SessionRepository,
        generated_scenarios: GeneratedScenarioRepository,
        orders: OrderRepository,
        proposals: ActionProposalRepository,
        decision_idempotency: ActionDecisionIdempotencyRepository,
        agents: AgentRegistry,
        clock: Clock,
        *,
        max_attempts: int = 2,
    ) -> None:
        self._sessions = sessions
        self._generated_scenarios = generated_scenarios
        self._orders = orders
        self._proposals = proposals
        self._decision_idempotency = decision_idempotency
        self._agents = agents
        self._clock = clock
        self._max_attempts = max_attempts

    async def propose_cancel(
        self,
        session_id: UUID,
        *,
        order_id: UUID,
        expected_version: int,
        idempotency_key: str,
    ) -> ActionProposal:
        _validate_idempotency_key(idempotency_key)
        session = self._sessions.get(session_id)
        if session is None:
            raise ConversationNotFoundError("conversation session not found")
        if session.scenario_id != ACTION_SCENARIO_ID:
            raise ActionRefusedError(
                "order cancellation is not enabled for this immutable scenario version"
            )
        proposal_id = uuid5(session.id, f"agent-lab:action-proposal:v1:{idempotency_key}")
        existing = self._proposals.get(proposal_id)
        if existing is not None:
            if (
                existing.session_id != session.id
                or existing.action_type is not OrderActionType.CANCEL_ORDER
                or existing.order_id != order_id
                or existing.expected_version != expected_version
            ):
                raise ActionConflictError(
                    "the idempotency key was already used for a different action proposal"
                )
            return existing
        generated = self._generated_scenarios.get(
            session.scenario_id, session.scenario_version, session.seed
        )
        if generated is None or generated.initial_state_hash != session.initial_state_hash:
            raise ConversationNotFoundError("conversation replay state is unavailable")
        order = self._orders.get(order_id)
        if order is None or order.customer_id != session.customer_id:
            raise ActionProposalNotFoundError("order is not available in this conversation")
        _validate_cancellation(order, expected_version)

        request = OrderActionRequest(
            session_id=session.id,
            customer_id=session.customer_id,
            order=order,
            action_type=OrderActionType.CANCEL_ORDER,
            expected_version=expected_version,
        )
        draft = await self._agents.get(session.framework_id).propose_action(request)
        _validate_draft(draft, request)
        candidate = ActionProposal(
            id=proposal_id,
            session_id=session.id,
            action_type=draft.action_type,
            tool_name=draft.tool_name,
            tool_version=draft.tool_version,
            order_id=draft.order_id,
            expected_version=draft.expected_version,
            summary=draft.summary,
            confirmation_token=_confirmation_token(proposal_id, draft),
            status=ActionStatus.PROPOSED,
            attempts=0,
            result_order_status=None,
            result_order_version=None,
        )
        self._proposals.save(candidate, expected_status=None)
        return candidate

    def get(self, session_id: UUID, proposal_id: UUID) -> ActionProposal:
        proposal = self._proposals.get(proposal_id)
        if proposal is None or proposal.session_id != session_id:
            raise ActionProposalNotFoundError("action proposal not found")
        return proposal

    def decide(
        self,
        session_id: UUID,
        proposal_id: UUID,
        *,
        confirm: bool,
        confirmation_token: str | None,
        idempotency_key: str,
    ) -> ActionProposal:
        _validate_idempotency_key(idempotency_key)
        decision = "confirm" if confirm else "cancel"
        identity = (proposal_id, decision)
        replay_identity = self._decision_idempotency.claim(
            idempotency_key,
            proposal_id,
            decision,
            self._clock.now(),
        )
        if replay_identity is not None:
            if replay_identity != identity:
                raise ActionConflictError(
                    "the idempotency key was already used for a different action decision"
                )
            return self.get(session_id, proposal_id)
        proposal = self.get(session_id, proposal_id)
        desired = ActionStatus.CONFIRMED if confirm else ActionStatus.CANCELLED
        if proposal.status is desired or proposal.status is ActionStatus.EXECUTED:
            return proposal
        if proposal.status is not ActionStatus.PROPOSED:
            raise ActionConflictError(f"action is already {proposal.status.value}")
        if confirm and (
            confirmation_token is None
            or not hmac.compare_digest(confirmation_token, proposal.confirmation_token)
        ):
            raise ActionConfirmationError("confirmation does not match the exact proposed action")
        updated = replace(proposal, status=desired)
        self._proposals.save(updated, expected_status=ActionStatus.PROPOSED)
        return updated

    def execute(
        self,
        session_id: UUID,
        proposal_id: UUID,
        *,
        idempotency_key: str,
    ) -> ActionProposal:
        _validate_idempotency_key(idempotency_key)
        proposal = self.get(session_id, proposal_id)
        if proposal.status is ActionStatus.EXECUTED:
            return proposal
        if proposal.status is not ActionStatus.CONFIRMED:
            raise ActionConfirmationError("the exact proposed action has not been confirmed")
        order = self._orders.get(proposal.order_id)
        if order is None:
            raise ActionProposalNotFoundError("proposed order no longer exists")
        updated_order = _validate_cancellation(order, proposal.expected_version)

        attempt = 0
        for attempt in range(1, self._max_attempts + 1):
            try:
                self._orders.save(
                    updated_order,
                    expected_version=proposal.expected_version,
                    idempotency_key=idempotency_key,
                )
                break
            except OrderWriteTransientError as error:
                if attempt == self._max_attempts:
                    raise ActionTransientError(
                        "the action could not complete after safe retry attempts"
                    ) from error
            except OrderWriteConflictError as error:
                raise ActionConflictError("the order changed before execution") from error
        executed = replace(
            proposal,
            status=ActionStatus.EXECUTED,
            attempts=proposal.attempts + attempt,
            result_order_status=updated_order.status.value,
            result_order_version=updated_order.version,
        )
        self._proposals.save(executed, expected_status=ActionStatus.CONFIRMED)
        return executed


def _validate_cancellation(order: Order, expected_version: int) -> Order:
    try:
        return order.cancel(expected_version=expected_version)
    except StaleOrderVersionError as error:
        raise ActionConflictError(str(error)) from error
    except OrderActionRefusedError as error:
        raise ActionRefusedError(str(error)) from error


def _validate_idempotency_key(value: str) -> None:
    if not value or value != value.strip():
        raise ActionConflictError(
            "idempotency key must not be empty or have surrounding whitespace"
        )


def _validate_draft(draft: ActionProposalDraft, request: OrderActionRequest) -> None:
    if (
        draft.action_type is not request.action_type
        or draft.tool_name != CANCEL_ORDER_TOOL_NAME
        or draft.tool_version != ACTION_TOOL_VERSION
        or draft.order_id != request.order.id
        or draft.expected_version != request.expected_version
    ):
        raise ActionRefusedError("agent proposed an action outside the requested scope")


def _confirmation_token(proposal_id: UUID, draft: ActionProposalDraft) -> str:
    payload = json.dumps(
        {
            "action_type": draft.action_type.value,
            "expected_version": draft.expected_version,
            "order_id": str(draft.order_id),
            "proposal_id": str(proposal_id),
            "tool_name": draft.tool_name,
            "tool_version": draft.tool_version,
        },
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(payload.encode()).hexdigest()
