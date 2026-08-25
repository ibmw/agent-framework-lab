"""Cloning a snapshot into the independently mutable sandbox one arm works in (ADR 0020)."""

from collections.abc import Generator
from dataclasses import replace
from pathlib import Path
from uuid import UUID, uuid4

import pytest
from sqlalchemy.orm import Session

from capability_lab.application.canonical_json import CanonicalSerializationError
from capability_lab.application.sandbox_materialization import (
    SandboxSnapshotNotFoundError,
    SandboxSnapshotRecord,
    SandboxSnapshotService,
)
from capability_lab.application.sandboxes import (
    SANDBOX_STATE_CANONICAL_SCHEMA_VERSION,
    SandboxLabelError,
    SandboxNotFoundError,
    SandboxRevisionConflictError,
    SandboxService,
    fingerprint_sandbox_state,
    sandbox_state_from_envelope,
)
from capability_lab.domain.order_fixture import FrozenShippingAddress, OrderFixturePayload
from capability_lab.domain.sandbox import SandboxMutationError
from capability_lab.infrastructure.database import (
    Base,
    create_database_engine,
    create_session_factory,
    session_scope,
)
from capability_lab.infrastructure.models import SandboxModel
from capability_lab.infrastructure.repositories import (
    SqlAlchemyOrderFixtureRepository,
    SqlAlchemyPublishedVersionDirectory,
    SqlAlchemySandboxRepository,
    SqlAlchemySandboxSnapshotRepository,
    mutation_block_repository,
    objective_block_repository,
    scenario_repository,
    shop_repository,
    ticket_repository,
)
from workspace_factories import (
    AdvancingClock,
    Workspace,
    author,
    publish_prerequisites,
    seed_workspace,
)

SEED = 20260825


@pytest.fixture
def session(tmp_path: Path) -> Generator[Session, None, None]:
    engine = create_database_engine(f"sqlite:///{tmp_path / 'sandboxes.db'}")
    Base.metadata.create_all(engine)
    with session_scope(create_session_factory(engine)) as active:
        yield active


@pytest.fixture
def workspace(session: Session) -> Workspace:
    return seed_workspace(session)


def build_sandboxes(session: Session) -> SandboxService:
    return SandboxService(
        SqlAlchemySandboxRepository(session),
        SqlAlchemySandboxSnapshotRepository(session),
        AdvancingClock(),
    )


def frozen_starting_state(session: Session, workspace: Workspace) -> SandboxSnapshotRecord:
    """Publish the wrong-address recipe and freeze it, as the previous slice does."""
    publish_prerequisites(workspace)
    scenario_id = author(workspace)
    version = workspace.scenarios.publish_scenario(workspace.shop_id, scenario_id)
    snapshots = SandboxSnapshotService(
        SqlAlchemySandboxSnapshotRepository(session),
        scenario_repository(session),
        shop_repository(session),
        ticket_repository(session),
        SqlAlchemyOrderFixtureRepository(session),
        objective_block_repository(session),
        mutation_block_repository(session),
        SqlAlchemyPublishedVersionDirectory(session),
        AdvancingClock(),
    )
    return snapshots.materialize(
        workspace.shop_id, scenario_id, version.published.version, seed=SEED
    )


def moved_to_lyon(order: OrderFixturePayload) -> OrderFixturePayload:
    """The change the wrong-address incident is about, applied inside one arm."""
    return replace(
        order,
        shipping_address=FrozenShippingAddress(
            source_address_id="lyon-current-flat",
            source_label="Lyon — current flat",
            selected_at="2026-08-22T09:15:00.000000Z",
            recipient="Maya Laurent",
            line1="12 rue de la République",
            postal_code="69002",
            city="Lyon",
            country="FR",
        ),
    )


# -- what a clone is --------------------------------------------------------


def test_a_clone_copies_the_snapshot_state_and_records_where_it_started(
    session: Session, workspace: Workspace
) -> None:
    snapshot = frozen_starting_state(session, workspace)

    arm = build_sandboxes(session).clone(workspace.shop_id, snapshot.snapshot_id, "Arm A")

    assert arm.snapshot_id == snapshot.snapshot_id
    assert arm.snapshot_fingerprint == snapshot.sandbox_fingerprint
    assert arm.revision == 0
    assert arm.document["canonical_schema_version"] == SANDBOX_STATE_CANONICAL_SCHEMA_VERSION
    assert arm.content.state == snapshot.content.state


def test_two_arms_of_one_snapshot_begin_at_the_same_fingerprint(
    session: Session, workspace: Workspace
) -> None:
    """The claim a paired comparison rests on: both arms started from one world."""
    snapshot = frozen_starting_state(session, workspace)
    sandboxes = build_sandboxes(session)

    first = sandboxes.clone(workspace.shop_id, snapshot.snapshot_id, "Arm A")
    second = sandboxes.clone(workspace.shop_id, snapshot.snapshot_id, "Arm B")

    assert first.sandbox_id != second.sandbox_id
    assert first.state_fingerprint == second.state_fingerprint
    assert first.snapshot_fingerprint == second.snapshot_fingerprint
    assert {
        arm.sandbox_id for arm in sandboxes.list_sandboxes(workspace.shop_id, snapshot.snapshot_id)
    } == {first.sandbox_id, second.sandbox_id}


def test_cloning_twice_is_two_arms_rather_than_one(session: Session, workspace: Workspace) -> None:
    """The opposite of materializing, which is idempotent by fingerprint on purpose."""
    snapshot = frozen_starting_state(session, workspace)
    sandboxes = build_sandboxes(session)

    sandboxes.clone(workspace.shop_id, snapshot.snapshot_id, "Arm A")
    sandboxes.clone(workspace.shop_id, snapshot.snapshot_id, "Arm A")

    assert len(sandboxes.list_sandboxes(workspace.shop_id, snapshot.snapshot_id)) == 2


def test_an_arm_needs_a_label_an_operator_can_tell_it_by(
    session: Session, workspace: Workspace
) -> None:
    snapshot = frozen_starting_state(session, workspace)

    with pytest.raises(SandboxLabelError, match="sandbox label"):
        build_sandboxes(session).clone(workspace.shop_id, snapshot.snapshot_id, "   ")


# -- isolation --------------------------------------------------------------


def test_a_write_in_one_arm_is_invisible_to_the_other_and_to_the_snapshot(
    session: Session, workspace: Workspace
) -> None:
    snapshot = frozen_starting_state(session, workspace)
    sandboxes = build_sandboxes(session)
    first = sandboxes.clone(workspace.shop_id, snapshot.snapshot_id, "Arm A")
    second = sandboxes.clone(workspace.shop_id, snapshot.snapshot_id, "Arm B")
    order = first.content.state.orders[0]

    moved = sandboxes.apply_order_change(
        workspace.shop_id,
        first.sandbox_id,
        order.order_id,
        moved_to_lyon(order.payload),
        expected_revision=0,
    )

    assert moved.revision == 1
    assert moved.state_fingerprint != first.state_fingerprint
    # The starting state it claims never moves, however far the arm does.
    assert moved.snapshot_fingerprint == snapshot.sandbox_fingerprint

    reread = sandboxes.get_sandbox(workspace.shop_id, first.sandbox_id)
    changed = reread.content.state.orders[0].payload.shipping_address
    assert changed is not None and changed.city == "Lyon"

    untouched = sandboxes.get_sandbox(workspace.shop_id, second.sandbox_id)
    other = untouched.content.state.orders[0].payload.shipping_address
    assert other is not None and other.city == "Bordeaux"
    assert untouched.revision == 0
    assert untouched.state_fingerprint == first.state_fingerprint

    frozen = snapshot.content.state.orders[0].payload.shipping_address
    assert frozen is not None and frozen.city == "Bordeaux"


def test_two_arms_that_make_the_same_change_agree_again(
    session: Session, workspace: Workspace
) -> None:
    """The fingerprint describes state, not history: identical worlds hash identically."""
    snapshot = frozen_starting_state(session, workspace)
    sandboxes = build_sandboxes(session)
    first = sandboxes.clone(workspace.shop_id, snapshot.snapshot_id, "Arm A")
    second = sandboxes.clone(workspace.shop_id, snapshot.snapshot_id, "Arm B")
    order = first.content.state.orders[0]

    left = sandboxes.apply_order_change(
        workspace.shop_id,
        first.sandbox_id,
        order.order_id,
        moved_to_lyon(order.payload),
        expected_revision=0,
    )
    right = sandboxes.apply_order_change(
        workspace.shop_id,
        second.sandbox_id,
        order.order_id,
        moved_to_lyon(order.payload),
        expected_revision=0,
    )

    assert left.state_fingerprint == right.state_fingerprint


# -- optimistic concurrency --------------------------------------------------


def test_a_writer_working_from_a_stale_revision_is_refused(
    session: Session, workspace: Workspace
) -> None:
    snapshot = frozen_starting_state(session, workspace)
    sandboxes = build_sandboxes(session)
    arm = sandboxes.clone(workspace.shop_id, snapshot.snapshot_id, "Arm A")
    order = arm.content.state.orders[0]
    sandboxes.apply_order_change(
        workspace.shop_id,
        arm.sandbox_id,
        order.order_id,
        moved_to_lyon(order.payload),
        expected_revision=0,
    )

    with pytest.raises(SandboxRevisionConflictError) as conflict:
        sandboxes.apply_order_change(
            workspace.shop_id,
            arm.sandbox_id,
            order.order_id,
            moved_to_lyon(order.payload),
            expected_revision=0,
        )

    assert conflict.value.expected == 0
    assert conflict.value.actual == 1
    assert sandboxes.get_sandbox(workspace.shop_id, arm.sandbox_id).revision == 1


def test_the_store_decides_the_race_two_readers_started(
    session: Session, workspace: Workspace
) -> None:
    """The service's read-then-write can be overtaken, so the guard is in the statement."""
    snapshot = frozen_starting_state(session, workspace)
    sandboxes = build_sandboxes(session)
    arm = sandboxes.clone(workspace.shop_id, snapshot.snapshot_id, "Arm A")
    order = arm.content.state.orders[0]
    repository = SqlAlchemySandboxRepository(session)

    winner = sandboxes.apply_order_change(
        workspace.shop_id,
        arm.sandbox_id,
        order.order_id,
        moved_to_lyon(order.payload),
        expected_revision=0,
    )

    # The loser read revision 0 before the winner wrote and still holds that record.
    with pytest.raises(SandboxRevisionConflictError):
        repository.update(replace(arm, revision=1), expected_revision=0)
    assert repository.get(workspace.shop_id, arm.sandbox_id) == winner


def test_a_write_is_visible_to_a_reader_that_already_loaded_the_row(
    session: Session, workspace: Workspace
) -> None:
    """The UPDATE goes through the session, so the ORM's identity map is synchronized.

    Executed through the connection instead, the statement would bypass the identity map and
    a live instance loaded earlier in this unit of work would keep answering with pre-update
    attributes — freshness by garbage collection rather than by contract.
    """
    snapshot = frozen_starting_state(session, workspace)
    sandboxes = build_sandboxes(session)
    arm = sandboxes.clone(workspace.shop_id, snapshot.snapshot_id, "Arm A")
    order = arm.content.state.orders[0]
    # Hold the loaded row alive, as any other repository or listener in this request could.
    loaded = session.get(SandboxModel, str(arm.sandbox_id))
    assert loaded is not None and loaded.revision == 0

    sandboxes.apply_order_change(
        workspace.shop_id,
        arm.sandbox_id,
        order.order_id,
        moved_to_lyon(order.payload),
        expected_revision=0,
    )

    assert loaded.revision == 1
    reread = sandboxes.get_sandbox(workspace.shop_id, arm.sandbox_id)
    changed = reread.content.state.orders[0].payload.shipping_address
    assert changed is not None and changed.city == "Lyon"


def test_a_run_cannot_write_an_order_the_arm_never_held(
    session: Session, workspace: Workspace
) -> None:
    snapshot = frozen_starting_state(session, workspace)
    sandboxes = build_sandboxes(session)
    arm = sandboxes.clone(workspace.shop_id, snapshot.snapshot_id, "Arm A")
    order = arm.content.state.orders[0]

    with pytest.raises(SandboxMutationError, match="cannot introduce one"):
        sandboxes.apply_order_change(
            workspace.shop_id, arm.sandbox_id, uuid4(), order.payload, expected_revision=0
        )


# -- scoping and storage -----------------------------------------------------


def test_one_shop_never_reaches_another_shops_arm(session: Session, workspace: Workspace) -> None:
    snapshot = frozen_starting_state(session, workspace)
    arm = build_sandboxes(session).clone(workspace.shop_id, snapshot.snapshot_id, "Arm A")

    with pytest.raises(SandboxNotFoundError):
        build_sandboxes(session).get_sandbox(uuid4(), arm.sandbox_id)
    assert build_sandboxes(session).list_sandboxes(uuid4(), snapshot.snapshot_id) == ()


def test_a_snapshot_of_another_shop_cannot_be_cloned(
    session: Session, workspace: Workspace
) -> None:
    snapshot = frozen_starting_state(session, workspace)

    with pytest.raises(SandboxSnapshotNotFoundError):
        build_sandboxes(session).clone(uuid4(), snapshot.snapshot_id, "Arm A")


def test_a_stored_document_of_another_schema_is_refused_by_its_token(
    session: Session, workspace: Workspace
) -> None:
    """Serving run state nobody can explain is worse than serving none."""
    snapshot = frozen_starting_state(session, workspace)
    arm = build_sandboxes(session).clone(workspace.shop_id, snapshot.snapshot_id, "Arm A")
    document = dict(arm.document)
    document["canonical_schema_version"] = "sandbox-state-v0"

    with pytest.raises(
        CanonicalSerializationError, match="unsupported sandbox state schema version"
    ):
        sandbox_state_from_envelope(document)


def test_the_stored_document_is_the_fingerprinted_one(
    session: Session, workspace: Workspace
) -> None:
    snapshot = frozen_starting_state(session, workspace)
    arm = build_sandboxes(session).clone(workspace.shop_id, snapshot.snapshot_id, "Arm A")

    recomputed = fingerprint_sandbox_state(arm.content.state, arm.snapshot_fingerprint)

    assert recomputed.state_fingerprint == arm.state_fingerprint
    assert arm.content.snapshot_fingerprint == snapshot.sandbox_fingerprint


def test_an_unknown_sandbox_is_not_found(session: Session, workspace: Workspace) -> None:
    unknown: UUID = uuid4()
    with pytest.raises(SandboxNotFoundError, match=str(unknown)):
        build_sandboxes(session).get_sandbox(workspace.shop_id, unknown)
