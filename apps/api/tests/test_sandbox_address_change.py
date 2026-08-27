"""The safe address-change action against one arm of the wrong-address sandbox (ADR 0022)."""

from collections.abc import Generator
from dataclasses import replace
from pathlib import Path
from typing import cast
from uuid import UUID

import pytest
from sqlalchemy.orm import Session

from capability_lab.application.canonical_json import CanonicalValue, canonical_json_bytes
from capability_lab.application.sandbox_actions import ActionProposalRecord, confirmation_of
from capability_lab.application.sandbox_tool_contracts import (
    ADDRESS_CHANGE_APPLY,
    ADDRESS_CHANGE_PROPOSE,
    ORDER_DETAIL,
    TOOL_VERSION,
)
from capability_lab.application.sandbox_tools import (
    ToolActor,
    ToolActorRequiredError,
    ToolCall,
    ToolOutcome,
    ToolRefusalCode,
    ToolResult,
)
from capability_lab.application.sandboxes import SandboxRecord
from capability_lab.application.support_identities import SupportIdentityVersionNotFoundError
from capability_lab.domain.order_fixture import OrderEventKind
from capability_lab.domain.support_identity import SupportPermission
from capability_lab.infrastructure.database import (
    Base,
    create_database_engine,
    create_session_factory,
    session_scope,
)
from capability_lab.infrastructure.repositories import SqlAlchemySandboxActionProposalRepository
from definition_factories import publishable_identity
from workspace_factories import (
    Workspace,
    build_sandboxes,
    build_tools,
    cloned_arm,
    frozen_starting_state,
    published_identity,
    seed_workspace,
)

STALE = "bordeaux-previous-flat"
CURRENT = "home"
ORDER_REFERENCE = "NS-10482"


@pytest.fixture
def session(tmp_path: Path) -> Generator[Session, None, None]:
    engine = create_database_engine(f"sqlite:///{tmp_path / 'actions.db'}")
    Base.metadata.create_all(engine)
    with session_scope(create_session_factory(engine)) as active:
        yield active


@pytest.fixture
def workspace(session: Session) -> Workspace:
    return seed_workspace(session)


@pytest.fixture
def arm(session: Session, workspace: Workspace) -> SandboxRecord:
    return cloned_arm(session, workspace)


@pytest.fixture
def actor(session: Session) -> ToolActor:
    return published_identity(session)


def call(
    session: Session,
    arm: SandboxRecord,
    tool: str,
    actor: ToolActor | None,
    **arguments: str | None,
) -> ToolResult:
    return (
        build_tools(session)
        .execute(
            arm.shop_id,
            arm.sandbox_id,
            ToolCall(tool=tool, version=TOOL_VERSION, arguments=arguments, actor=actor),
        )
        .result
    )


def data(result: ToolResult) -> dict[str, CanonicalValue]:
    assert result.outcome is ToolOutcome.SUCCESS, result.refusal
    assert result.data is not None
    return result.data


def refusal(result: ToolResult) -> ToolRefusalCode:
    assert result.outcome is ToolOutcome.REFUSED, result.data
    assert result.refusal is not None
    return result.refusal.code


def propose(
    session: Session,
    arm: SandboxRecord,
    actor: ToolActor | None,
    address_id: str = CURRENT,
    order_reference: str | None = ORDER_REFERENCE,
    order_id: str | None = None,
) -> ToolResult:
    return call(
        session,
        arm,
        ADDRESS_CHANGE_PROPOSE,
        actor,
        order_reference=order_reference,
        order_id=order_id,
        address_id=address_id,
    )


def apply(session: Session, arm: SandboxRecord, actor: ToolActor, confirmation: str) -> ToolResult:
    return call(session, arm, ADDRESS_CHANGE_APPLY, actor, confirmation=confirmation)


def reload(session: Session, arm: SandboxRecord) -> SandboxRecord:
    return build_sandboxes(session).get_sandbox(arm.shop_id, arm.sandbox_id)


def ships_to(session: Session, arm: SandboxRecord, actor: ToolActor | None = None) -> str:
    order = data(call(session, arm, ORDER_DETAIL, actor, order_reference=ORDER_REFERENCE))
    address = cast("dict[str, CanonicalValue]", order["shipping_address"])
    return cast("str", address["source_address_id"])


# -- proposing --------------------------------------------------------------


def test_a_proposal_shows_both_addresses_and_moves_nothing(
    session: Session, arm: SandboxRecord, actor: ToolActor
) -> None:
    proposal = data(propose(session, arm, actor))

    assert proposal["applied"] is False
    assert proposal["order_reference"] == ORDER_REFERENCE
    current = cast("dict[str, CanonicalValue]", proposal["current_address"])
    proposed = cast("dict[str, CanonicalValue]", proposal["proposed_address"])
    assert current["source_address_id"] == STALE
    assert proposed["source_address_id"] == CURRENT
    assert proposed["city"] == "Lyon"
    # A proposal has selected nothing, so the copy it shows carries no selection time.
    assert proposed["selected_at"] is None
    # And the arm has not moved: proposing is a question, not a change.
    assert reload(session, arm).revision == 0
    assert ships_to(session, arm) == STALE


def test_proposing_the_same_change_twice_is_one_proposal_answering_the_same_bytes(
    session: Session, arm: SandboxRecord, actor: ToolActor
) -> None:
    """The confirmation names the change, so a repeat computes the name already stored."""
    first = data(propose(session, arm, actor))
    second = data(propose(session, arm, actor))

    assert canonical_json_bytes(first) == canonical_json_bytes(second)


def test_two_arms_proposing_the_same_change_agree_on_its_name(
    session: Session, workspace: Workspace, actor: ToolActor
) -> None:
    """Comparable evidence: the name is the change's, not the arm's."""
    snapshot = frozen_starting_state(session, workspace)
    sandboxes = build_sandboxes(session)
    left = sandboxes.clone(workspace.shop_id, snapshot.snapshot_id, "Arm A")
    right = sandboxes.clone(workspace.shop_id, snapshot.snapshot_id, "Arm B")

    assert (
        data(propose(session, left, actor))["confirmation"]
        == (data(propose(session, right, actor))["confirmation"])
    )


def test_a_confirmation_minted_in_one_arm_is_not_a_proposal_in_the_other(
    session: Session, workspace: Workspace, actor: ToolActor
) -> None:
    """Agreeing on the name is not sharing the proposal: a row belongs to one arm."""
    snapshot = frozen_starting_state(session, workspace)
    sandboxes = build_sandboxes(session)
    left = sandboxes.clone(workspace.shop_id, snapshot.snapshot_id, "Arm A")
    right = sandboxes.clone(workspace.shop_id, snapshot.snapshot_id, "Arm B")
    confirmation = cast("str", data(propose(session, left, actor))["confirmation"])

    assert refusal(apply(session, right, actor, confirmation)) is ToolRefusalCode.NOT_CONFIRMED


def test_an_address_the_customer_does_not_have_is_refused_as_not_found(
    session: Session, arm: SandboxRecord, actor: ToolActor
) -> None:
    assert (
        refusal(propose(session, arm, actor, "an-address-nobody-has")) is ToolRefusalCode.NOT_FOUND
    )


def test_reselecting_the_address_the_order_already_ships_to_is_refused(
    session: Session, arm: SandboxRecord, actor: ToolActor
) -> None:
    assert refusal(propose(session, arm, actor, STALE)) is ToolRefusalCode.NOT_ALLOWED


def test_a_proposal_names_its_order_the_way_the_read_tool_does(
    session: Session, arm: SandboxRecord, actor: ToolActor
) -> None:
    """One lookup behind both, so reading an order and changing it cannot disagree."""
    by_id = propose(
        session,
        arm,
        actor,
        order_reference=None,
        order_id=str(arm.sandbox.state.orders[0].order_id),
    )
    by_reference = propose(session, arm, actor)

    assert data(by_id)["confirmation"] == data(by_reference)["confirmation"]


def test_naming_the_order_twice_or_not_at_all_is_refused(
    session: Session, arm: SandboxRecord, actor: ToolActor
) -> None:
    both = propose(session, arm, actor, order_id=str(arm.sandbox.state.orders[0].order_id))
    neither = propose(session, arm, actor, order_reference=None)

    assert refusal(both) is ToolRefusalCode.INVALID_ARGUMENTS
    assert refusal(neither) is ToolRefusalCode.INVALID_ARGUMENTS


# -- authorization ----------------------------------------------------------


def test_an_identity_without_the_permission_may_not_change_an_address(
    session: Session, arm: SandboxRecord
) -> None:
    reader = published_identity(
        session,
        publishable_identity(
            permissions=(SupportPermission.READ_ORDERS, SupportPermission.READ_POLICIES)
        ),
    )

    assert refusal(propose(session, arm, reader)) is ToolRefusalCode.NOT_PERMITTED


def test_an_identity_without_the_permission_may_not_learn_what_the_change_would_be(
    session: Session, arm: SandboxRecord
) -> None:
    """Authorization is checked before anything is resolved, so the refusal discloses nothing."""
    reader = published_identity(
        session,
        publishable_identity(
            permissions=(SupportPermission.READ_ORDERS, SupportPermission.READ_POLICIES)
        ),
    )

    result = propose(session, arm, reader, "an-address-nobody-has")

    assert refusal(result) is ToolRefusalCode.NOT_PERMITTED
    assert result.data is None


def test_an_identity_that_may_not_act_cannot_apply_what_another_proposed(
    session: Session, arm: SandboxRecord, actor: ToolActor
) -> None:
    confirmation = cast("str", data(propose(session, arm, actor))["confirmation"])
    reader = published_identity(
        session,
        publishable_identity(
            permissions=(SupportPermission.READ_ORDERS, SupportPermission.READ_POLICIES)
        ),
    )

    assert refusal(apply(session, arm, reader, confirmation)) is ToolRefusalCode.NOT_PERMITTED
    assert reload(session, arm).revision == 0


def test_a_write_offered_with_nobody_acting_is_an_error_not_a_refusal(
    session: Session, arm: SandboxRecord
) -> None:
    """The actor is not model output, so getting it wrong is the caller's mistake to see."""
    with pytest.raises(ToolActorRequiredError):
        propose(session, arm, None)


def test_an_actor_naming_a_version_that_was_never_published_is_an_error(
    session: Session, arm: SandboxRecord, actor: ToolActor
) -> None:
    with pytest.raises(SupportIdentityVersionNotFoundError):
        propose(session, arm, replace(actor, version=actor.version + 1))


def test_a_read_tool_still_needs_no_actor(session: Session, arm: SandboxRecord) -> None:
    """Every read here is over the arm's own customer; read authorization is Milestone 3."""
    assert ships_to(session, arm) == STALE


# -- applying ---------------------------------------------------------------


def test_applying_a_proposal_redirects_the_order_and_advances_the_arm(
    session: Session, arm: SandboxRecord, actor: ToolActor
) -> None:
    confirmation = cast("str", data(propose(session, arm, actor))["confirmation"])

    applied = data(apply(session, arm, actor, confirmation))

    assert applied["applied"] is True
    assert applied["confirmation"] == confirmation
    address = cast("dict[str, CanonicalValue]", applied["shipping_address"])
    assert address["source_address_id"] == CURRENT
    assert address["city"] == "Lyon"
    # Applied stamps the copy, where the proposal could not.
    assert address["selected_at"] is not None
    event = cast("dict[str, CanonicalValue]", applied["event"])
    assert event["kind"] == OrderEventKind.ADDRESS_UPDATED.value
    assert reload(session, arm).revision == 1
    assert ships_to(session, arm) == CURRENT


def test_the_order_carries_the_history_that_explains_where_it_now_ships(
    session: Session, arm: SandboxRecord, actor: ToolActor
) -> None:
    """The event is what tells a redirected order from one authored at its destination."""
    confirmation = cast("str", data(propose(session, arm, actor))["confirmation"])
    apply(session, arm, actor, confirmation)

    order = data(call(session, arm, ORDER_DETAIL, actor, order_reference=ORDER_REFERENCE))
    events = cast("list[dict[str, CanonicalValue]]", order["events"])
    updates = [entry for entry in events if entry["kind"] == OrderEventKind.ADDRESS_UPDATED.value]

    assert len(updates) == 1
    assert "Northstar tier 1" in cast("str", updates[0]["summary"])


def test_applying_without_a_proposal_is_refused(
    session: Session, arm: SandboxRecord, actor: ToolActor
) -> None:
    result = apply(session, arm, actor, "0" * 64)

    assert refusal(result) is ToolRefusalCode.NOT_CONFIRMED
    assert reload(session, arm).revision == 0


def test_a_confirmation_that_stands_for_a_different_change_is_not_this_ones(
    session: Session, arm: SandboxRecord, actor: ToolActor
) -> None:
    """The name is the hash of the change, so a change nobody proposed has no name here."""
    invented = confirmation_of(
        order_id=arm.sandbox.state.orders[0].order_id,
        address_id=CURRENT,
        state_fingerprint="a-world-this-arm-was-never-in",
    )

    assert refusal(apply(session, arm, actor, invented)) is ToolRefusalCode.NOT_CONFIRMED


# -- idempotency ------------------------------------------------------------


def test_applying_the_same_proposal_twice_changes_the_arm_once(
    session: Session, arm: SandboxRecord, actor: ToolActor
) -> None:
    confirmation = cast("str", data(propose(session, arm, actor))["confirmation"])

    first = data(apply(session, arm, actor, confirmation))
    second = data(apply(session, arm, actor, confirmation))

    # The same answer, byte for byte, and one revision rather than two.
    assert canonical_json_bytes(first) == canonical_json_bytes(second)
    assert reload(session, arm).revision == 1


def test_a_replayed_apply_writes_no_second_event(
    session: Session, arm: SandboxRecord, actor: ToolActor
) -> None:
    confirmation = cast("str", data(propose(session, arm, actor))["confirmation"])
    apply(session, arm, actor, confirmation)
    apply(session, arm, actor, confirmation)

    order = data(call(session, arm, ORDER_DETAIL, actor, order_reference=ORDER_REFERENCE))
    events = cast("list[dict[str, CanonicalValue]]", order["events"])

    assert [entry["kind"] for entry in events].count(OrderEventKind.ADDRESS_UPDATED.value) == 1


# -- optimistic concurrency --------------------------------------------------


def test_a_proposal_computed_before_the_arm_moved_is_refused_as_a_conflict(
    session: Session, arm: SandboxRecord, actor: ToolActor
) -> None:
    """What the scenario's concurrent-mutation fault does to an agent mid-change."""
    confirmation = cast("str", data(propose(session, arm, actor))["confirmation"])
    # Something else moves the arm between the two steps — the fault block, in a run.
    order = arm.sandbox.state.orders[0]
    build_sandboxes(session).apply_order_change(
        arm.shop_id,
        arm.sandbox_id,
        order.order_id,
        replace(order.payload, placed_at="2026-08-20T14:56:00.000000Z"),
        expected_revision=0,
    )

    result = apply(session, arm, actor, confirmation)

    assert refusal(result) is ToolRefusalCode.CONFLICT
    # Refused, not applied: the arm is where the other writer left it.
    assert reload(session, arm).revision == 1
    assert ships_to(session, arm) == STALE


def test_the_change_can_be_proposed_again_against_the_world_as_it_now_is(
    session: Session, arm: SandboxRecord, actor: ToolActor
) -> None:
    """A conflict is recoverable by the agent, which is why it is a refusal."""
    stale_confirmation = cast("str", data(propose(session, arm, actor))["confirmation"])
    order = arm.sandbox.state.orders[0]
    build_sandboxes(session).apply_order_change(
        arm.shop_id,
        arm.sandbox_id,
        order.order_id,
        replace(order.payload, placed_at="2026-08-20T14:56:00.000000Z"),
        expected_revision=0,
    )
    apply(session, arm, actor, stale_confirmation)

    moved = reload(session, arm)
    fresh = cast("str", data(propose(session, moved, actor))["confirmation"])

    assert fresh != stale_confirmation
    assert data(apply(session, moved, actor, fresh))["applied"] is True
    assert ships_to(session, moved) == CURRENT


# -- isolation ---------------------------------------------------------------


def test_a_change_applied_in_one_arm_is_invisible_to_the_arm_beside_it(
    session: Session, workspace: Workspace, actor: ToolActor
) -> None:
    snapshot = frozen_starting_state(session, workspace)
    sandboxes = build_sandboxes(session)
    left = sandboxes.clone(workspace.shop_id, snapshot.snapshot_id, "Arm A")
    right = sandboxes.clone(workspace.shop_id, snapshot.snapshot_id, "Arm B")
    confirmation = cast("str", data(propose(session, left, actor))["confirmation"])

    apply(session, left, actor, confirmation)

    assert ships_to(session, left) == CURRENT
    assert ships_to(session, right) == STALE
    assert reload(session, right).revision == 0
    # And the starting state both were taken from is untouched.
    assert reload(session, left).snapshot_fingerprint == snapshot.sandbox_fingerprint


# -- the proposal record -----------------------------------------------------


def test_a_change_stays_appliable_when_the_arm_returns_to_a_state_it_left(
    session: Session, arm: SandboxRecord, actor: ToolActor
) -> None:
    """A confirmation covers the world, not the write counter, and the two can disagree.

    An arm that changes and changes back sits at a higher revision holding the bytes it had
    before, so a re-proposal computes the name already stored. Left at the revision it was
    recorded with, that proposal could never be applied: the write would lose to the revision
    guard forever while the refusal told the agent to propose again — which mints the same
    name and finds the same stale row.
    """
    first = cast("str", data(propose(session, arm, actor))["confirmation"])
    order = arm.sandbox.state.orders[0]
    sandboxes = build_sandboxes(session)
    # Away, and back: two writes, and the arm ends where it started.
    sandboxes.apply_order_change(
        arm.shop_id,
        arm.sandbox_id,
        order.order_id,
        replace(order.payload, placed_at="2026-08-20T14:56:00.000000Z"),
        expected_revision=0,
    )
    returned = sandboxes.apply_order_change(
        arm.shop_id, arm.sandbox_id, order.order_id, order.payload, expected_revision=1
    )
    assert returned.revision == 2
    assert returned.state_fingerprint == arm.state_fingerprint

    again = cast("str", data(propose(session, returned, actor))["confirmation"])

    assert again == first
    assert data(apply(session, returned, actor, again))["applied"] is True
    assert ships_to(session, arm) == CURRENT


def test_an_applied_proposal_keeps_the_revision_it_recorded(
    session: Session, arm: SandboxRecord, actor: ToolActor
) -> None:
    """An applied row is history: re-opening it would offer a second application."""
    confirmation = cast("str", data(propose(session, arm, actor))["confirmation"])
    apply(session, arm, actor, confirmation)
    proposals = SqlAlchemySandboxActionProposalRepository(session)
    closed = proposals.get(arm.sandbox_id, confirmation)
    assert closed is not None and closed.applied

    unchanged = proposals.save(replace(closed, expected_revision=99, applied_at=None, result=None))

    assert unchanged.expected_revision == closed.expected_revision
    assert unchanged.result == closed.result


def test_two_proposals_racing_one_name_read_the_winner_rather_than_failing(
    session: Session, arm: SandboxRecord, actor: ToolActor
) -> None:
    """The loser has lost nothing: the row that won says exactly what its proposal said.

    Reported as the lab breaking otherwise — an uncaught `IntegrityError` becomes a `failed`
    outcome, which this module defines as never the agent's fault and never a thing to retry.
    """

    class RacedRepository(SqlAlchemySandboxActionProposalRepository):
        """A repository whose first lookup ran before the winner's row landed."""

        blind = True

        def get(self, sandbox_id: UUID, confirmation: str) -> ActionProposalRecord | None:
            if self.blind:
                self.blind = False
                return None
            return super().get(sandbox_id, confirmation)

    winner = cast("str", data(propose(session, arm, actor))["confirmation"])
    recorded = SqlAlchemySandboxActionProposalRepository(session).get(arm.sandbox_id, winner)
    assert recorded is not None
    # The winner is another transaction, so its row is committed before the loser's insert
    # fails. That is also what makes the loser's rollback safe in a real call: recording a
    # proposal is the only write a propose makes, so there is nothing of its own to lose.
    session.commit()

    loser = RacedRepository(session).save(recorded)

    assert loser.confirmation == winner
    # And the proposal is still appliable, by whichever writer gets to it.
    assert data(apply(session, arm, actor, winner))["applied"] is True
