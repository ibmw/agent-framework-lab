"""The one commerce mutation an arm may make, and the protocol that makes it safe.

`orders.propose_address_change` works out what redirecting an order would do and changes
nothing. `orders.apply_address_change` presents the proposal's name back and does it. Four
guarantees come out of that split, and each one is a different failure this module refuses:

- **Authorization.** Both steps check the acting support identity's granted permissions, so
  an agent whose identity cannot change an address cannot discover what changing it would
  do either. The permission each write needs is declared on its contract, so this check and
  the agent-configuration publish gate read one table rather than two literals.
- **Confirmation.** A proposal is named by the hash of its own content. Applying without
  that name, or with a name that stands for a different change, is refused — the
  "verifiable prior confirmation" `docs/api-and-schema-conventions.md` requires of a
  data-modifying tool, verifiable because the name is looked up rather than merely
  recomputed.
- **Idempotency.** A proposal applies exactly once. Presenting it again returns the result
  the first apply recorded, writes nothing, and leaves the revision where it is. The
  confirmation is therefore also the idempotency key the same convention requires — issued
  by the lab rather than chosen by the caller, deliberately: in a run the caller is model
  output, and a model reusing one key for two different changes would collapse them into
  one.
- **Optimistic concurrency.** A proposal records the revision it was computed at, and the
  apply writes against exactly that. An arm that moved in between refuses — which is not an
  edge case here but the point of the scenario: the wrong-address recipe binds a
  `concurrent-entity-mutation` fault to the very order being redirected.

A conflict is a **refusal**, not an error. The world moving under an agent is a fact the
agent has to notice and recover from, exactly like an order reference that names nothing;
reporting it as a transport failure would make the fault block's whole purpose read as the
lab breaking (ADR 0021's rule about who was wrong).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Protocol
from uuid import UUID

from capability_lab.application.canonical_json import (
    CanonicalValue,
    canonical_json_bytes,
    canonical_sha256,
    canonical_timestamp,
)
from capability_lab.application.ports import Clock
from capability_lab.application.sandbox_tool_context import SandboxToolContext, resolve_order
from capability_lab.application.sandbox_tool_contracts import (
    ADDRESS_CHANGE_APPLY,
    ADDRESS_CHANGE_PROPOSE,
    TOOL_VERSION,
    WRITE_TOOL_CONTRACTS,
    ToolContract,
    ToolContractError,
    ToolRefusalCode,
    ToolRefusedError,
)
from capability_lab.application.sandbox_tool_views import frozen_address, proposed_address
from capability_lab.application.sandboxes import (
    SandboxRecord,
    SandboxRevisionConflictError,
    SandboxService,
)
from capability_lab.domain.address_change import (
    AddressChangePlan,
    AddressChangeRefusalCode,
    AddressChangeRefusedError,
    apply_address_change,
    plan_address_change,
)
from capability_lab.domain.order_fixture import OrderFixturePayload
from capability_lab.domain.sandbox import SandboxOrder
from capability_lab.domain.support_identity import SupportIdentityPayload

__all__ = [
    "ADDRESS_CHANGE_PROPOSAL_SCHEMA_VERSION",
    "ActionProposalRecord",
    "ProposalAlreadyAppliedError",
    "SandboxActionProposalRepository",
    "SandboxActionService",
    "ToolActor",
    "confirmation_of",
]

ADDRESS_CHANGE_PROPOSAL_SCHEMA_VERSION = "address-change-proposal-v1"
"""What a confirmation is the hash of. Versioned because the name binds the consent."""

CONFIRMATION_EVENT_DIGITS = 12
"""How much of the confirmation names the order event the change writes.

Enough to be unique among one order's history and short enough to keep the event ID inside
the lab's slug rule, which is what an authored event ID has to satisfy too.
"""


class ProposalAlreadyAppliedError(RuntimeError):
    """Raised when a proposal that already has a result is closed a second time.

    A programming error rather than a refusal: the apply path returns the recorded result
    before it ever reaches the store, so reaching this means the check above it was skipped.
    """


@dataclass(frozen=True, slots=True)
class ToolActor:
    """Whose authority a call runs under: one published support-identity version.

    Deliberately **not** a tool argument. Arguments are model output, and an agent that
    could name its own actor would be choosing its own permissions. The actor travels in the
    call envelope, resolved by the lab — today from the operator's selection in the Studio
    console, and from Milestone 3 onward from the run's published agent configuration.
    """

    support_identity_id: UUID
    version: int


@dataclass(frozen=True, slots=True)
class ActionProposalRecord:
    """One proposed change to one arm, and the single result of applying it.

    The row is both the consent record and the idempotency record, because those are the
    same question asked twice: which exact change is this, and has it already happened?

    `confirmation` is the content hash rather than a fresh identifier, so two arms of one
    experiment proposing the same change against the same state agree on the name — the
    comparability Milestone 5 reads as evidence. Isolation comes from the row being scoped
    to one arm, so a name minted in one arm finds nothing in the arm beside it.
    """

    sandbox_id: UUID
    shop_id: UUID
    confirmation: str
    tool: str
    version: str
    order_id: UUID
    address_id: str
    expected_revision: int
    proposal: dict[str, CanonicalValue]
    created_at: datetime
    applied_at: datetime | None = None
    applied_revision: int | None = None
    result: dict[str, CanonicalValue] | None = None

    @property
    def applied(self) -> bool:
        return self.applied_at is not None


class SandboxActionProposalRepository(Protocol):
    """Per-arm storage for proposed changes; nothing here is shared between arms."""

    def get(self, sandbox_id: UUID, confirmation: str) -> ActionProposalRecord | None: ...

    def save(self, record: ActionProposalRecord) -> ActionProposalRecord:
        """Record a proposal, or return the one already recorded under the same name.

        Proposing twice against a byte-identical world is one proposal: the confirmation is
        the hash of the change, so the second call computes the name the first one stored.

        An unapplied row is returned at the revision the incoming proposal was computed
        against, which is not always the one it was stored with. The confirmation covers the
        arm's whole state but not its revision — a counter of writes rather than a
        description of state — so an arm that changed and changed back offers the same name
        at a higher revision. Refreshing is what keeps such a proposal appliable; leaving it
        would make the write lose to the revision guard forever while the refusal told the
        agent to propose again, minting the same name and finding the same stale row.

        An applied row is returned exactly as recorded. It is history, and its result is
        what a replay must answer with.
        """
        ...

    def mark_applied(
        self,
        record: ActionProposalRecord,
        *,
        applied_at: datetime,
        applied_revision: int,
        result: dict[str, CanonicalValue],
    ) -> ActionProposalRecord:
        """Close a proposal against its single application.

        The store decides, not the caller: the predicate is that the row is still open, so
        two applies racing the same confirmation cannot both write. Raises
        `ProposalAlreadyAppliedError`.
        """
        ...


def confirmation_of(*, order_id: UUID, address_id: str, state_fingerprint: str) -> str:
    """Name a proposed change by its content.

    Three things and no more. The order and the address-book entry are *what* would change;
    the state fingerprint is the world it was worked out against, so a proposal computed
    before the arm moved can never be mistaken for the same proposal computed after.

    The arm's identifier is deliberately absent, so two arms of one experiment that propose
    the same change against the same starting state produce the same name and the same
    bytes. They stay isolated all the same: a proposal is stored per arm and looked up per
    arm, so the name minted in one is not a proposal in the other.

    This is a binding value, not a secret (the reasoning ADR 0009 recorded for the POC's
    cancellation token). Its job is to prove which change was consented to, not to
    authenticate whoever presents it — that is what the actor's permissions are for.
    """
    return canonical_sha256(
        canonical_json_bytes(
            {
                "canonical_schema_version": ADDRESS_CHANGE_PROPOSAL_SCHEMA_VERSION,
                "tool": ADDRESS_CHANGE_PROPOSE,
                "version": TOOL_VERSION,
                "order_id": str(order_id),
                "address_id": address_id,
                "state_fingerprint": state_fingerprint,
            }
        )
    )


DISPATCHED_WRITE_TOOLS: frozenset[str] = frozenset({ADDRESS_CHANGE_PROPOSE, ADDRESS_CHANGE_APPLY})
"""The write tools `SandboxActionService.execute` knows how to run."""


def _require_complete_write_registry() -> None:
    """A published write nothing dispatches is a mutation an agent can call and never make.

    The mirror of the read side's registry check (`sandbox_tools`), and needed for the same
    reason: that check pairs every read contract with a handler, so a newly declared *write*
    passes it without anything having agreed to run it.
    """
    declared = frozenset(contract.name for contract in WRITE_TOOL_CONTRACTS)
    if declared != DISPATCHED_WRITE_TOOLS:
        difference = sorted(declared ^ DISPATCHED_WRITE_TOOLS)
        raise ToolContractError(
            f"the write tool dispatch disagrees with the published contracts: {difference}"
        )


_require_complete_write_registry()


class SandboxActionService:
    """Propose and apply the safe address change, against one arm at a time."""

    def __init__(
        self,
        sandboxes: SandboxService,
        proposals: SandboxActionProposalRepository,
        clock: Clock,
    ) -> None:
        self._sandboxes = sandboxes
        self._proposals = proposals
        self._clock = clock

    def execute(
        self,
        contract: ToolContract,
        context: SandboxToolContext,
        record: SandboxRecord,
        actor: SupportIdentityPayload,
        arguments: dict[str, str],
    ) -> dict[str, CanonicalValue]:
        """Run one write tool. Refusals raise `ToolRefusedError` and become results."""
        self._require_permission(contract, actor)
        if contract.name == ADDRESS_CHANGE_PROPOSE:
            return self._propose(context, record, arguments)
        if contract.name == ADDRESS_CHANGE_APPLY:
            return self._apply(context, record, actor, arguments)
        # Unreachable while the import-time check below holds. Kept because the alternative
        # is a third write tool silently falling into the apply branch and dying on an
        # argument it never declared — a published mutation reported as the lab breaking.
        raise ToolContractError(  # pragma: no cover - the import-time check above prevents it
            f"{contract.name} is a published write this service does not dispatch"
        )

    # -- proposing -------------------------------------------------------------

    def _propose(
        self,
        context: SandboxToolContext,
        record: SandboxRecord,
        arguments: dict[str, str],
    ) -> dict[str, CanonicalValue]:
        order = resolve_order(context.state, arguments)
        plan = self._plan(context, order, arguments["address_id"])
        confirmation = confirmation_of(
            order_id=order.order_id,
            address_id=plan.entry.id,
            state_fingerprint=record.state_fingerprint,
        )
        document = _proposal_document(confirmation, plan)
        self._proposals.save(
            ActionProposalRecord(
                sandbox_id=record.sandbox_id,
                shop_id=record.shop_id,
                confirmation=confirmation,
                tool=ADDRESS_CHANGE_PROPOSE,
                version=TOOL_VERSION,
                order_id=order.order_id,
                address_id=plan.entry.id,
                expected_revision=record.revision,
                proposal=document,
                created_at=self._clock.now(),
            )
        )
        return document

    # -- applying --------------------------------------------------------------

    def _apply(
        self,
        context: SandboxToolContext,
        record: SandboxRecord,
        actor: SupportIdentityPayload,
        arguments: dict[str, str],
    ) -> dict[str, CanonicalValue]:
        proposal = self._proposals.get(record.sandbox_id, arguments["confirmation"])
        if proposal is None:
            # Scoped to this arm, so a confirmation minted in the arm beside it reads as
            # never proposed — which, in this arm, is what it is.
            raise ToolRefusedError(
                ToolRefusalCode.NOT_CONFIRMED,
                "no change was proposed under this confirmation; propose the change first and "
                "apply the confirmation the proposal answered with",
            )
        recorded = proposal.result
        if recorded is not None:
            # The whole of idempotency: the change already happened, so the same answer
            # comes back, the arm does not move again, and no second event is written.
            return recorded

        order = context.state.order(proposal.order_id)
        if order is None:  # pragma: no cover - an arm never loses an order it held
            raise ToolRefusedError(
                ToolRefusalCode.NOT_FOUND, "this arm no longer holds the order that was proposed"
            )
        # Re-planned rather than replayed out of the stored proposal: between the two steps
        # the world may have made the change unsafe, and the rules — not a document written
        # earlier — are what decide whether it is still allowed.
        plan = self._plan(context, order, proposal.address_id)
        event_id = f"address-change-{proposal.confirmation[:CONFIRMATION_EVENT_DIGITS]}"
        # One reading of the clock for both, so the moment the order says the change happened
        # and the moment the proposal says it was closed cannot straddle a tick.
        applied_at = self._clock.now()
        changed = apply_address_change(
            order.payload,
            plan,
            event_id=event_id,
            occurred_at=canonical_timestamp(applied_at),
            actor=actor.role.name,
        )
        moved = self._write(record, order, changed, expected_revision=proposal.expected_revision)
        document = _applied_document(proposal.confirmation, plan, changed, event_id)
        self._proposals.mark_applied(
            proposal,
            applied_at=applied_at,
            applied_revision=moved.revision,
            result=document,
        )
        return document

    def _write(
        self,
        record: SandboxRecord,
        order: SandboxOrder,
        changed: OrderFixturePayload,
        *,
        expected_revision: int,
    ) -> SandboxRecord:
        try:
            return self._sandboxes.apply_order_change(
                record.shop_id,
                record.sandbox_id,
                order.order_id,
                changed,
                expected_revision=expected_revision,
            )
        except SandboxRevisionConflictError as conflict:
            raise ToolRefusedError(
                ToolRefusalCode.CONFLICT,
                "this arm has changed since the change was proposed; read the order again and "
                "propose the change against what it says now",
            ) from conflict

    # -- shared ----------------------------------------------------------------

    @staticmethod
    def _require_permission(contract: ToolContract, actor: SupportIdentityPayload) -> None:
        """Authorize before resolving anything.

        Checked first on purpose: an identity that may not redirect an order must not learn
        from a refusal's wording whether the order exists or where it currently ships.

        The permission comes from the contract rather than from a literal here, so the
        runtime and the agent-configuration publish gate cannot disagree about what a tool
        needs: a configuration is refused at publication for exactly the grant this refuses
        at call time.
        """
        required = contract.required_permission
        if required is None:  # pragma: no cover - a write always declares one
            raise ToolContractError(f"write tool {contract.name} declares no permission")
        if required not in actor.granted:
            raise ToolRefusedError(
                ToolRefusalCode.NOT_PERMITTED,
                f"{actor.role.title} is not authorized to {required.value.replace('_', ' ')}",
            )

    @staticmethod
    def _plan(
        context: SandboxToolContext, order: SandboxOrder, address_id: str
    ) -> AddressChangePlan:
        """Ask the domain, and turn each reason it refuses into one an agent can act on."""
        try:
            return plan_address_change(order.order_id, order.payload, context.customer, address_id)
        except AddressChangeRefusedError as refused:
            # An address nobody has is a lookup that found nothing; the rest are the world
            # saying no to everyone, which is a different thing for an agent to do about it.
            raise ToolRefusedError(
                ToolRefusalCode.NOT_FOUND
                if refused.refusal.code is AddressChangeRefusalCode.ADDRESS_NOT_IN_BOOK
                else ToolRefusalCode.NOT_ALLOWED,
                refused.refusal.message,
            ) from refused


def _proposal_document(confirmation: str, plan: AddressChangePlan) -> dict[str, CanonicalValue]:
    """What a proposal answers with: the change, side by side, and its name.

    `applied` is stated rather than implied, so a proposal and the result of applying it are
    told apart by reading one field instead of by noticing which keys are missing.
    """
    return {
        "confirmation": confirmation,
        "applied": False,
        "order_id": str(plan.order_id),
        "order_reference": plan.reference,
        "current_address": frozen_address(plan.current),
        "proposed_address": proposed_address(plan.entry),
    }


def _applied_document(
    confirmation: str,
    plan: AddressChangePlan,
    changed: OrderFixturePayload,
    event_id: str,
) -> dict[str, CanonicalValue]:
    """What applying answers with: where the order ships now, and the line that says so.

    The event is looked up by the ID the change was written under rather than taken off the
    end of the history, because an order's events are ordered by when they happened and a
    change applied inside a sandbox is not guaranteed to be the latest thing in it.
    """
    event = next(entry for entry in changed.events if entry.id == event_id)
    return {
        "confirmation": confirmation,
        "applied": True,
        "order_id": str(plan.order_id),
        "order_reference": changed.reference,
        "shipping_address": frozen_address(changed.shipping_address),
        "event": {
            "id": event.id,
            "kind": event.kind.value,
            "occurred_at": event.occurred_at,
            "summary": event.summary,
        },
    }
