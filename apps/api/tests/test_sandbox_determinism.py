"""The bytes a starting state is identified by, and the claim that they are reproducible.

Every slice of this milestone proved its own behavior against the wrong-address incident.
This suite proves the property all of them rest on and none of them owns: that the same
inputs produce the same bytes, that those bytes are the ones the store holds, and that the
identifier they hash to is a value this lab has *published* rather than whatever the current
serializer happens to emit.

The three golden constants below are the point of the module. Each is the identity of a
fixed, hand-authored input, owned here rather than borrowed from a shared factory, so it
moves only when the serializer or an envelope moves. When one of them fails, the question to
answer is not "what is the new value" but "is every snapshot frozen before this change a
different starting state now" — which, per ADR 0019, it is. That answer is sometimes yes and
must never be silent.
"""

from collections.abc import Generator
from dataclasses import dataclass
from decimal import Decimal
from pathlib import Path
from uuid import UUID

import pytest
from sqlalchemy import text
from sqlalchemy.orm import Session

from capability_lab.application.canonical_json import (
    CanonicalValue,
    canonical_json_bytes,
    canonical_sha256,
)
from capability_lab.application.definition_resolution import (
    ResolvedDefinition,
    SandboxResolution,
)
from capability_lab.application.sandbox_materialization import (
    SandboxSnapshotRecord,
    SandboxSnapshotService,
)
from capability_lab.application.sandbox_snapshot import (
    SANDBOX_CANONICAL_SCHEMA_VERSION,
    fingerprint_sandbox_snapshot,
)
from capability_lab.application.sandbox_tool_contracts import (
    SANDBOX_TOOL_CONTRACTS,
    TOOL_CONTRACT_VERSIONS,
)
from capability_lab.application.sandboxes import (
    SANDBOX_STATE_CANONICAL_SCHEMA_VERSION,
    fingerprint_sandbox_state,
)
from capability_lab.domain.definitions import DefinitionId, DefinitionType
from capability_lab.domain.order_fixture import (
    FrozenShippingAddress,
    FulfilmentState,
    FulfilmentStatus,
    OrderEvent,
    OrderEventKind,
    OrderFixturePayload,
    OrderLine,
    PaymentState,
    PaymentStatus,
)
from capability_lab.domain.sandbox import (
    SandboxInteraction,
    SandboxOrder,
    SandboxState,
)
from capability_lab.domain.shop import Currency, Money, SupportChannel
from capability_lab.domain.ticket import TicketOrigin, TicketOriginKind
from capability_lab.infrastructure.database import (
    Base,
    create_database_engine,
    create_session_factory,
    session_scope,
)
from workspace_factories import (
    SEED,
    Workspace,
    author,
    build_sandboxes,
    build_snapshots,
    publish_prerequisites,
    seed_workspace,
)

# -- the fixed world these goldens are the identity of ----------------------

GOLDEN_CUSTOMER_ID = UUID("0a1a1e1c-6f4c-4a1b-9a5d-6f5b4f2ac101")
GOLDEN_ORDER_ID = UUID("4b7c0c2e-1f2a-4c3d-8e5f-6a7b8c9d0e1f")
GOLDEN_SHOP_ID = UUID("1d0f9c8b-7a6e-4d5c-8b3a-2f1e0d9c8b7a")
GOLDEN_TICKET_ID = UUID("2e1f0d9c-8b7a-4e6d-9c5b-3a2f1e0d9c8b")
GOLDEN_SEED = 4242
"""Deliberately not the workspace seed: a golden owns every one of its inputs."""
GOLDEN_SNAPSHOT_FINGERPRINT = "c" * 64

PLACED_AT = "2026-08-20T14:55:00.000000Z"
CAPTURED_AT = "2026-08-21T13:12:00.000000Z"


def golden_order() -> OrderFixturePayload:
    """The paid order that ships to the stale address, authored here and never elsewhere.

    A golden owns its input. Reading this from `order_factories` would make the published
    fingerprint below move whenever an unrelated suite wanted a different example, which is
    the one thing a published identity must not do.
    """
    return OrderFixturePayload(
        reference="NS-10482",
        customer_profile_id=GOLDEN_CUSTOMER_ID,
        currency=Currency.EUR,
        placed_at=PLACED_AT,
        lines=(
            OrderLine(
                id="ns-asj-ob-m",
                sku="NS-ASJ-OB-M",
                product_handle="alpine-shell-jacket",
                title="Alpine Shell Jacket",
                variant_summary="Ocean Blue · M",
                unit_price=Money(amount=Decimal("249.00"), currency=Currency.EUR),
                quantity=1,
            ),
        ),
        payment=PaymentState(
            status=PaymentStatus.PAID,
            method_id="card",
            method_name="Card · synthetic",
            paid_at=CAPTURED_AT,
        ),
        fulfilment=FulfilmentState(
            status=FulfilmentStatus.UNFULFILLED,
            method_id="standard",
            method_name="Standard 3-5 days",
        ),
        shipping_fee=Money(amount=Decimal("0.00"), currency=Currency.EUR),
        shipping_address=FrozenShippingAddress(
            source_address_id="bordeaux-previous-flat",
            source_label="Bordeaux — previous flat",
            selected_at=PLACED_AT,
            recipient="Maya Laurent",
            line1="42 cours de la Marne",
            line2=None,
            postal_code="33800",
            city="Bordeaux",
            region=None,
            country="FR",
        ),
        events=(
            OrderEvent(
                id="order-created",
                kind=OrderEventKind.PLACED,
                occurred_at=PLACED_AT,
                summary="Order created — checkout, order page",
            ),
        ),
    )


def golden_state() -> SandboxState:
    return SandboxState(
        customer_profile_id=GOLDEN_CUSTOMER_ID,
        interaction=SandboxInteraction(
            origin=TicketOrigin(kind=TicketOriginKind.ORDER_PAGE, order_id=GOLDEN_ORDER_ID),
            channel=SupportChannel.CHAT,
            ticket_reference="T-204",
        ),
        orders=(SandboxOrder(order_id=GOLDEN_ORDER_ID, payload=golden_order()),),
    )


def golden_resolution() -> SandboxResolution:
    return SandboxResolution(
        sandbox_inputs=(
            ResolvedDefinition(
                definition=DefinitionId(definition_type=DefinitionType.SHOP, id=GOLDEN_SHOP_ID),
                version=1,
                content_fingerprint="a" * 64,
            ),
            ResolvedDefinition(
                definition=DefinitionId(definition_type=DefinitionType.TICKET, id=GOLDEN_TICKET_ID),
                version=2,
                content_fingerprint="b" * 64,
            ),
        ),
        seed=GOLDEN_SEED,
        tool_contract_versions=(("orders.read_order", "v1"),),
    )


# -- the serializer ---------------------------------------------------------

GOLDEN_DOCUMENT: dict[str, CanonicalValue] = {
    # Deliberately out of sorted order, and deliberately covering every member of the
    # canonical union: the sort, the separators, the UTF-8, and the exactness of a large
    # integer are all things a later library swap could change without anyone noticing.
    "zeta": None,
    "nested": {"b": [1, "café"], "a": {"deep": False}},
    "alpha": True,
    "empty": [],
    "count": 10_000_000_000_000_000_001,
    "amount": "249.00",
}

GOLDEN_JSON = (
    b'{"alpha":true,"amount":"249.00","count":10000000000000000001,"empty":[],'
    b'"nested":{"a":{"deep":false},"b":[1,"caf\xc3\xa9"]},"zeta":null}'
)


def test_the_canonical_serializer_writes_one_documented_byte_string() -> None:
    """Keys sorted, no whitespace, UTF-8 rather than escapes, and integers left exact.

    A binary float cannot represent 10000000000000000001; a JSON writer that ever routed a
    number through one would round it, and every fingerprint in the lab would move at once.
    """
    written = canonical_json_bytes(GOLDEN_DOCUMENT)

    assert written == GOLDEN_JSON
    assert b"caf\\u00e9" not in written
    assert canonical_sha256(written) == canonical_sha256(GOLDEN_JSON)


def test_the_order_keys_were_written_in_is_not_part_of_the_document() -> None:
    """Two callers building the same facts in a different order must agree on the bytes."""
    rewritten = dict(reversed(list(GOLDEN_DOCUMENT.items())))

    assert list(rewritten) != list(GOLDEN_DOCUMENT)
    assert canonical_json_bytes(rewritten) == GOLDEN_JSON


# -- the two published envelopes -------------------------------------------

GOLDEN_SANDBOX_FINGERPRINT = "0eec34000be2b7ac7a01bcb93cd7056a07324246fe41578989e4179f1bf81862"
GOLDEN_STATE_FINGERPRINT = "73da4e3d86f3930409d44f5dfe6e03e4453750a18a166154a2153164289a9722"


def test_a_fixed_starting_state_freezes_to_a_published_fingerprint() -> None:
    """The `sandbox-v2` identity of one fixed world, recorded so it cannot move quietly."""
    envelope = fingerprint_sandbox_snapshot(golden_resolution(), golden_state())

    assert envelope.sandbox_fingerprint == GOLDEN_SANDBOX_FINGERPRINT
    assert canonical_sha256(envelope.canonical_json) == envelope.sandbox_fingerprint
    assert SANDBOX_CANONICAL_SCHEMA_VERSION.encode() in envelope.canonical_json


def test_a_fixed_arm_carries_a_published_fingerprint_of_its_own() -> None:
    """The `sandbox-state-v1` identity, which is what divergence between arms is read from."""
    envelope = fingerprint_sandbox_state(golden_state(), GOLDEN_SNAPSHOT_FINGERPRINT)

    assert envelope.state_fingerprint == GOLDEN_STATE_FINGERPRINT
    assert canonical_sha256(envelope.canonical_json) == envelope.state_fingerprint
    assert SANDBOX_STATE_CANONICAL_SCHEMA_VERSION.encode() in envelope.canonical_json


def test_the_two_envelopes_are_told_apart_by_more_than_the_state_they_share() -> None:
    """One state, two documents. Neither fingerprint may ever be mistaken for the other."""
    snapshot = fingerprint_sandbox_snapshot(golden_resolution(), golden_state())
    arm = fingerprint_sandbox_state(golden_state(), snapshot.sandbox_fingerprint)

    assert arm.state_fingerprint != snapshot.sandbox_fingerprint


# -- reproduction from recorded inputs --------------------------------------


@pytest.fixture
def session(tmp_path: Path) -> Generator[Session, None, None]:
    engine = create_database_engine(f"sqlite:///{tmp_path / 'determinism.db'}")
    Base.metadata.create_all(engine)
    with session_scope(create_session_factory(engine)) as active:
        yield active


@pytest.fixture
def workspace(session: Session) -> Workspace:
    return seed_workspace(session)


@dataclass(frozen=True, slots=True)
class Recipe:
    """One published scenario version, and the service that freezes it.

    The service is held rather than rebuilt because its clock advances per call: a second
    freeze through a second service would read the same hour as the first, which is exactly
    the coincidence the "the moment is not part of what it is" test needs to avoid.
    """

    snapshots: SandboxSnapshotService
    shop_id: UUID
    scenario_id: UUID
    version: int

    def freeze(self) -> SandboxSnapshotRecord:
        return self.snapshots.materialize(self.shop_id, self.scenario_id, self.version, seed=SEED)


@pytest.fixture
def recipe(session: Session, workspace: Workspace) -> Recipe:
    """The wrong-address recipe, published and ready to be frozen more than once."""
    publish_prerequisites(workspace)
    scenario_id = author(workspace)
    version = workspace.scenarios.publish_scenario(workspace.shop_id, scenario_id)
    return Recipe(
        snapshots=build_snapshots(session),
        shop_id=workspace.shop_id,
        scenario_id=scenario_id,
        version=version.published.version,
    )


def forget(session: Session) -> None:
    """Drop every stored snapshot, leaving the inputs that produced them untouched."""
    session.flush()
    session.execute(text("DELETE FROM sandbox_snapshots"))
    session.expire_all()


def test_a_forgotten_snapshot_is_recomputed_rather_than_recognized(
    session: Session, recipe: Recipe
) -> None:
    """The milestone's reproducibility criterion, with the lookup that could fake it removed.

    Materializing twice normally answers the second time from the store, which proves the
    fingerprint is stable but not that it is *computable*. With the row gone, the second
    freeze has nothing to recognize and has to build the same document again from the
    published versions it pins and the orders it reads now.
    """
    first = recipe.freeze()
    forget(session)
    second = recipe.freeze()

    assert second.sandbox_fingerprint == first.sandbox_fingerprint
    assert second.document == first.document
    # A snapshot is identified by its fingerprint, so the row identifier is free to differ
    # (ADR 0019). Asserting that it does is what keeps the equality above from being trivial.
    assert second.snapshot_id != first.snapshot_id


def test_the_moment_a_snapshot_was_frozen_is_not_part_of_what_it_is(
    session: Session, recipe: Recipe
) -> None:
    first = recipe.freeze()
    forget(session)
    second = recipe.freeze()

    assert second.created_at > first.created_at
    assert second.sandbox_fingerprint == first.sandbox_fingerprint


def test_a_snapshot_is_named_by_the_hash_of_the_document_it_stored(recipe: Recipe) -> None:
    """What is served must be what was hashed, or the pins explain a state nobody ran."""
    record = recipe.freeze()

    assert canonical_sha256(canonical_json_bytes(record.document)) == record.sandbox_fingerprint


def test_the_tool_set_a_snapshot_freezes_against_is_the_one_this_lab_publishes(
    recipe: Recipe,
) -> None:
    """A published tool missing from the fingerprint is a starting state that under-describes
    itself: two snapshots would agree while their arms could ask different questions."""
    record = recipe.freeze()

    assert record.document["tool_contracts"] == dict(TOOL_CONTRACT_VERSIONS)
    assert set(TOOL_CONTRACT_VERSIONS) == {contract.name for contract in SANDBOX_TOOL_CONTRACTS}


def test_both_arms_and_the_snapshot_they_came_from_agree_on_the_state_they_share(
    session: Session, recipe: Recipe
) -> None:
    snapshot = recipe.freeze()
    sandboxes = build_sandboxes(session)

    first = sandboxes.clone(recipe.shop_id, snapshot.snapshot_id, "Arm A")
    second = sandboxes.clone(recipe.shop_id, snapshot.snapshot_id, "Arm B")

    assert first.content.state == second.content.state == snapshot.content.state
    assert first.state_fingerprint == second.state_fingerprint
    assert (
        fingerprint_sandbox_state(
            snapshot.content.state, snapshot.sandbox_fingerprint
        ).state_fingerprint
        == first.state_fingerprint
    )
