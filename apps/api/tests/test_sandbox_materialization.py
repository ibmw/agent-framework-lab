"""Materializing a published scenario version into canonical starting state (ADR 0019)."""

from collections.abc import Generator
from dataclasses import replace
from pathlib import Path
from uuid import UUID, uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.orm import Session

from capability_lab.application.definition_resolution import MissingReferenceVersionError
from capability_lab.application.order_fixtures import OrderEdit, OrderLineSelection
from capability_lab.application.sandbox_materialization import (
    SandboxNotMaterializableError,
    SandboxSnapshotNotFoundError,
    SandboxSnapshotService,
)
from capability_lab.application.sandbox_snapshot import SANDBOX_CANONICAL_SCHEMA_VERSION
from capability_lab.application.sandbox_tool_contracts import TOOL_CONTRACT_VERSIONS
from capability_lab.application.scenarios import ScenarioVersionNotFoundError
from capability_lab.domain.definitions import DefinitionType
from capability_lab.domain.order_fixture import FulfilmentStatus, PaymentStatus
from capability_lab.domain.ticket import TicketOrigin, TicketOriginKind
from capability_lab.infrastructure.database import (
    Base,
    create_database_engine,
    create_session_factory,
    session_scope,
)
from capability_lab.infrastructure.repositories import (
    SqlAlchemyOrderFixtureRepository,
    SqlAlchemyPublishedVersionDirectory,
    SqlAlchemySandboxSnapshotRepository,
    mutation_block_repository,
    objective_block_repository,
    scenario_repository,
    shop_repository,
    ticket_repository,
)
from shop_factories import saved_shop
from workspace_factories import (
    PLACED_AT,
    AdvancingClock,
    Workspace,
    author,
    build_orders,
    concurrent_mutation,
    publish_prerequisites,
    seed_order,
    seed_workspace,
)

SEED = 20260825


@pytest.fixture
def session(tmp_path: Path) -> Generator[Session, None, None]:
    engine = create_database_engine(f"sqlite:///{tmp_path / 'snapshots.db'}")
    Base.metadata.create_all(engine)
    with session_scope(create_session_factory(engine)) as active:
        yield active


@pytest.fixture
def workspace(session: Session) -> Workspace:
    return seed_workspace(session)


def build_snapshots(session: Session) -> SandboxSnapshotService:
    return SandboxSnapshotService(
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


def publish_scenario(workspace: Workspace, **overrides: object) -> tuple[UUID, int]:
    """Everything published in dependency order, and the scenario version to freeze."""
    publish_prerequisites(workspace)
    scenario_id = author(workspace, **overrides)
    version = workspace.scenarios.publish_scenario(workspace.shop_id, scenario_id)
    return scenario_id, version.published.version


# -- what a snapshot freezes -----------------------------------------------


def test_a_snapshot_pins_what_is_immutable_and_copies_what_is_not(
    session: Session, workspace: Workspace
) -> None:
    scenario_id, version = publish_scenario(workspace)

    record = build_snapshots(session).materialize(
        workspace.shop_id, scenario_id, version, seed=SEED
    )

    assert record.document["canonical_schema_version"] == SANDBOX_CANONICAL_SCHEMA_VERSION
    assert record.seed == SEED
    assert len(record.sandbox_fingerprint) == 64

    # Pinned: every immutable input the recipe reaches, each at one exact version.
    pinned = {pin.definition.definition_type: pin.version for pin in record.content.pins}
    assert pinned == {
        DefinitionType.SHOP: 1,
        DefinitionType.CUSTOMER_PROFILE: 1,
        DefinitionType.TICKET: 1,
        DefinitionType.OBJECTIVE_BLOCK: 1,
        DefinitionType.SCENARIO: 1,
    }

    # Copied: the order fixtures, because nothing pinned them.
    state = record.content.state
    assert state.customer_profile_id == workspace.customer_id
    assert [order.order_id for order in state.orders] == [workspace.order_id]
    frozen = state.orders[0].payload
    assert frozen.reference == "NS-10482"
    assert frozen.payment.status is PaymentStatus.PAID
    assert frozen.shipping_address is not None
    assert frozen.shipping_address.city == "Bordeaux"


def test_a_snapshot_records_the_tool_set_its_arms_can_interrogate_it_through(
    session: Session, workspace: Workspace
) -> None:
    """The tool contracts are starting state, not runtime (ADR 0021).

    An arm that can read the shop's policies begins in a different world from one that
    cannot, so the published tool set is fingerprinted with the pins and the orders.
    """
    scenario_id, version = publish_scenario(workspace)

    record = build_snapshots(session).materialize(
        workspace.shop_id, scenario_id, version, seed=SEED
    )

    assert record.document["tool_contracts"] == dict(TOOL_CONTRACT_VERSIONS)
    assert record.document["tool_contracts"] != {}


def test_the_whole_customers_order_history_enters_the_sandbox(
    session: Session, workspace: Workspace
) -> None:
    """An arm can list a customer's orders, so the sandbox holds all of them."""
    other_order = seed_order(
        build_orders(session), workspace.shop_id, workspace.customer_id, reference="NS-10500"
    )
    scenario_id, version = publish_scenario(workspace)

    record = build_snapshots(session).materialize(
        workspace.shop_id, scenario_id, version, seed=SEED
    )

    assert {order.order_id for order in record.content.state.orders} == {
        workspace.order_id,
        other_order,
    }


def test_the_interaction_reference_is_minimal(session: Session, workspace: Workspace) -> None:
    """The origin travels as an identifier; an arm resolves the resource with tools."""
    ticket = workspace.tickets.get_ticket(workspace.shop_id, workspace.ticket_id)
    workspace.tickets.replace_ticket(
        workspace.shop_id,
        workspace.ticket_id,
        replace(
            ticket.payload,
            origin=TicketOrigin(kind=TicketOriginKind.ORDER_PAGE, order_id=workspace.order_id),
        ),
    )
    scenario_id, version = publish_scenario(workspace)

    interaction = (
        build_snapshots(session)
        .materialize(workspace.shop_id, scenario_id, version, seed=SEED)
        .content.state.interaction
    )

    assert interaction.origin.kind is TicketOriginKind.ORDER_PAGE
    assert interaction.origin.order_id == workspace.order_id
    assert interaction.origin.product_handle is None
    assert interaction.ticket_reference == "T-204"


def test_a_product_page_origin_freezes_its_catalog_handle(
    session: Session, workspace: Workspace
) -> None:
    ticket = workspace.tickets.get_ticket(workspace.shop_id, workspace.ticket_id)
    workspace.tickets.replace_ticket(
        workspace.shop_id,
        workspace.ticket_id,
        replace(
            ticket.payload,
            origin=TicketOrigin(
                kind=TicketOriginKind.PRODUCT_PAGE, product_handle="alpine-shell-jacket"
            ),
        ),
    )
    scenario_id, version = publish_scenario(workspace)

    origin = (
        build_snapshots(session)
        .materialize(workspace.shop_id, scenario_id, version, seed=SEED)
        .content.state.interaction.origin
    )

    assert origin.kind is TicketOriginKind.PRODUCT_PAGE
    assert origin.product_handle == "alpine-shell-jacket"
    assert origin.order_id is None


# -- determinism and identity ----------------------------------------------


def test_the_same_inputs_reproduce_the_same_snapshot(
    session: Session, workspace: Workspace
) -> None:
    scenario_id, version = publish_scenario(workspace)
    snapshots = build_snapshots(session)

    first = snapshots.materialize(workspace.shop_id, scenario_id, version, seed=SEED)
    second = snapshots.materialize(workspace.shop_id, scenario_id, version, seed=SEED)

    assert second.snapshot_id == first.snapshot_id
    assert second.sandbox_fingerprint == first.sandbox_fingerprint
    assert snapshots.list_snapshots(workspace.shop_id, scenario_id) == (first,)


def test_another_seed_is_another_snapshot(session: Session, workspace: Workspace) -> None:
    scenario_id, version = publish_scenario(workspace)
    snapshots = build_snapshots(session)

    first = snapshots.materialize(workspace.shop_id, scenario_id, version, seed=SEED)
    second = snapshots.materialize(workspace.shop_id, scenario_id, version, seed=SEED + 1)

    assert second.sandbox_fingerprint != first.sandbox_fingerprint
    assert len(snapshots.list_snapshots(workspace.shop_id, scenario_id)) == 2


def test_an_order_edited_after_publication_is_different_starting_state(
    session: Session, workspace: Workspace
) -> None:
    """The recipe is frozen; the orders it names are not. That is why re-freezing differs."""
    scenario_id, version = publish_scenario(workspace)
    snapshots = build_snapshots(session)
    first = snapshots.materialize(workspace.shop_id, scenario_id, version, seed=SEED)

    orders = build_orders(session)
    current = orders.get_order(workspace.shop_id, workspace.order_id)
    orders.replace_order(
        workspace.shop_id,
        workspace.order_id,
        OrderEdit(
            reference=current.payload.reference,
            placed_at=PLACED_AT,
            lines=(OrderLineSelection(sku="NS-ASJ-OB-M", quantity=2),),
            payment_status=PaymentStatus.PAID,
            payment_method_id="visa",
            paid_at=current.payload.payment.paid_at,
            fulfilment_status=FulfilmentStatus.UNFULFILLED,
            fulfilment_method_id="standard",
            shipped_at=None,
            shipping_fee_amount="0.00",
            shipping_address_id="bordeaux-previous-flat",
            events=(),
        ),
    )

    second = snapshots.materialize(workspace.shop_id, scenario_id, version, seed=SEED)

    assert second.sandbox_fingerprint != first.sandbox_fingerprint
    assert second.content.state.orders[0].payload.item_count == 2
    # The first snapshot keeps what it froze: an edit never rewrites recorded evidence.
    reread = snapshots.get_snapshot(workspace.shop_id, first.snapshot_id)
    assert reread.content.state.orders[0].payload.item_count == 1


def test_a_newer_template_version_does_not_change_a_frozen_recipe(
    session: Session, workspace: Workspace
) -> None:
    """The publication pinned the template, so the gate reads the pin, not the draft."""
    scenario_id, version = publish_scenario(workspace)
    snapshots = build_snapshots(session)
    first = snapshots.materialize(workspace.shop_id, scenario_id, version, seed=SEED)

    draft = workspace.objectives.get_draft(workspace.read_block_id)
    workspace.objectives.replace_block(
        workspace.read_block_id, replace(draft.payload, description="Rewritten after the freeze.")
    )
    workspace.objectives.publish(workspace.read_block_id)

    second = snapshots.materialize(workspace.shop_id, scenario_id, version, seed=SEED)
    assert second.snapshot_id == first.snapshot_id


# -- the gate, re-run --------------------------------------------------------


def test_a_deleted_order_refuses_the_freeze(session: Session, workspace: Workspace) -> None:
    scenario_id, version = publish_scenario(workspace, mutations=(concurrent_mutation(workspace),))
    build_orders(session).delete_order(workspace.shop_id, workspace.order_id)

    with pytest.raises(SandboxNotMaterializableError) as failure:
        build_snapshots(session).materialize(workspace.shop_id, scenario_id, version, seed=SEED)

    codes = {issue.code for issue in failure.value.validation.errors}
    assert "binding_order_missing_from_shop" in codes
    assert "linked_order_missing_from_shop" in codes
    # The finding says which frozen document holds the hole.
    assert all(
        issue.path.startswith(("ticket.", "scenario.")) for issue in failure.value.validation.errors
    )


def test_a_ticket_frozen_against_an_older_shop_version_is_an_actionable_finding(
    session: Session, workspace: Workspace
) -> None:
    """The closure must agree on one shop version; a snapshot cannot pick a winner."""
    workspace.shops.publish(workspace.shop_id)
    workspace.profiles.publish(workspace.customer_id)
    workspace.tickets.publish_ticket(workspace.shop_id, workspace.ticket_id)
    workspace.objectives.publish(workspace.read_block_id)
    workspace.mutations.publish(workspace.mutation_block_id)

    # A second shop version lands between the ticket's publication and the scenario's.
    workspace.shops.replace_draft(workspace.shop_id, replace(saved_shop(), faq=saved_shop().faq))
    workspace.shops.publish(workspace.shop_id)

    scenario_id = author(workspace)
    version = workspace.scenarios.publish_scenario(workspace.shop_id, scenario_id).published.version

    with pytest.raises(SandboxNotMaterializableError) as failure:
        build_snapshots(session).materialize(workspace.shop_id, scenario_id, version, seed=SEED)

    assert [issue.code for issue in failure.value.validation.errors] == ["sandbox_conflicting_pin"]


# -- addressing --------------------------------------------------------------


def test_one_shop_never_finds_another_shops_snapshot(
    session: Session, workspace: Workspace
) -> None:
    scenario_id, version = publish_scenario(workspace)
    snapshots = build_snapshots(session)
    record = snapshots.materialize(workspace.shop_id, scenario_id, version, seed=SEED)

    with pytest.raises(SandboxSnapshotNotFoundError):
        snapshots.get_snapshot(uuid4(), record.snapshot_id)
    assert snapshots.list_snapshots(uuid4(), scenario_id) == ()


def test_an_unpublished_version_cannot_be_materialized(
    session: Session, workspace: Workspace
) -> None:
    publish_prerequisites(workspace)
    scenario_id = author(workspace)

    with pytest.raises(ScenarioVersionNotFoundError):
        build_snapshots(session).materialize(workspace.shop_id, scenario_id, 1, seed=SEED)


def test_a_scenario_of_another_shop_is_not_materializable_here(
    session: Session, workspace: Workspace
) -> None:
    scenario_id, version = publish_scenario(workspace)

    with pytest.raises(ScenarioVersionNotFoundError):
        build_snapshots(session).materialize(uuid4(), scenario_id, version, seed=SEED)


def test_an_out_of_range_seed_is_refused(session: Session, workspace: Workspace) -> None:
    scenario_id, version = publish_scenario(workspace)

    with pytest.raises(ValueError, match="seed"):
        build_snapshots(session).materialize(workspace.shop_id, scenario_id, version, seed=-1)


def test_missing_reference_version_is_reported_as_such(
    session: Session, workspace: Workspace
) -> None:
    """A pinned version that is not resolvable is corruption, not an authoring finding."""
    scenario_id, version = publish_scenario(workspace)
    session.execute(text("DELETE FROM definition_versions WHERE definition_type = 'ticket'"))

    with pytest.raises(MissingReferenceVersionError):
        build_snapshots(session).materialize(workspace.shop_id, scenario_id, version, seed=SEED)


def test_a_concurrent_materialization_of_the_same_state_hands_back_the_winner(
    session: Session, workspace: Workspace
) -> None:
    """Two writers can miss the same lookup; the constraint decides and the loser reads it.

    The winner is committed first, because that is what makes the loser's lookup miss and its
    insert clash: the recovery restarts the losing transaction, so it can only read a row
    another transaction has already committed.
    """
    scenario_id, version = publish_scenario(workspace)
    snapshots = build_snapshots(session)
    winner = snapshots.materialize(workspace.shop_id, scenario_id, version, seed=SEED)
    session.commit()

    repository = SqlAlchemySandboxSnapshotRepository(session)
    losing = replace(winner, snapshot_id=uuid4())
    stored = repository.save(losing)

    assert stored.snapshot_id == winner.snapshot_id
    assert stored.sandbox_fingerprint == winner.sandbox_fingerprint
    assert len(snapshots.list_snapshots(workspace.shop_id, scenario_id)) == 1
