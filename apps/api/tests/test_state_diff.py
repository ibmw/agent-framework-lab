"""What one arm's world became, read against the world it was cloned into (ADR 0035)."""

from dataclasses import replace
from uuid import UUID

from capability_lab.application.sandboxes import fingerprint_sandbox_state
from capability_lab.application.state_diff import (
    FieldChange,
    arm_state_diff,
    canonical_changes,
)
from capability_lab.domain.sandbox import (
    SandboxInteraction,
    SandboxOrder,
    SandboxState,
)
from capability_lab.domain.shop import SupportChannel
from capability_lab.domain.ticket import TicketOrigin, TicketOriginKind
from order_factories import CUSTOMER_ID, frozen_address, paid_order

RUN_ID = UUID("2c9f1f4a-2b31-4a83-9d1e-77b2c0f0aa01")
ORDER_ID = UUID("4b7c0c2e-1f2a-4c3d-8e5f-6a7b8c9d0e1f")
OTHER_ORDER_ID = UUID("9f8e7d6c-5b4a-4938-8271-605f4e3d2c1b")
SNAPSHOT = "0" * 64

LYON = {
    "source_address_id": "home",
    "source_label": "Home",
    "line1": "18 rue des Écoles",
    "postal_code": "69005",
    "city": "Lyon",
}


def state(*orders: SandboxOrder) -> SandboxState:
    return SandboxState(
        customer_profile_id=CUSTOMER_ID,
        interaction=SandboxInteraction(
            origin=TicketOrigin(kind=TicketOriginKind.SUPPORT_ENTRY),
            channel=SupportChannel.EMAIL,
            ticket_reference="T-204",
        ),
        orders=orders,
    )


def order(order_id: UUID = ORDER_ID, **overrides: object) -> SandboxOrder:
    return SandboxOrder(order_id=order_id, payload=paid_order(**overrides))


def changed_to_lyon() -> SandboxOrder:
    """The write the wrong-address incident turns on (ADR 0022)."""
    return order(shipping_address=frozen_address(**LYON))


# -- the reading an operator makes ------------------------------------------------


def test_an_arm_that_wrote_nothing_reads_as_the_world_it_started_in() -> None:
    started = state(order())

    diff = arm_state_diff(RUN_ID, before=started, after=started)

    assert diff.run_id == RUN_ID
    assert diff.orders == ()
    assert diff.other == ()
    assert diff.moved is False


def test_a_redirected_order_reads_as_the_values_on_both_sides() -> None:
    """What a revision counter cannot say: r0 → r1 is true of this and of a typo."""
    diff = arm_state_diff(RUN_ID, before=state(order()), after=state(changed_to_lyon()))

    assert len(diff.orders) == 1
    moved = diff.orders[0]
    assert moved.order_id == ORDER_ID
    # The reference the customer quotes, not a positional label: a run may change what an
    # order says and never which order it is.
    assert moved.reference == "NS-10482"
    assert dict((change.path, (change.before, change.after)) for change in moved.changes) == {
        "shipping_address.city": ("Bordeaux", "Lyon"),
        "shipping_address.line1": ("42 cours de la Marne", "18 rue des Écoles"),
        "shipping_address.postal_code": ("33800", "69005"),
        "shipping_address.source_address_id": ("bordeaux-previous-flat", "home"),
        "shipping_address.source_label": ("Bordeaux — previous flat", "Home"),
    }


def test_only_the_order_that_moved_is_reported() -> None:
    """The card's claim covers everything, so nothing is excluded from the check."""
    untouched = order(OTHER_ORDER_ID, reference="NS-10500")
    before = state(*sorted((order(), untouched), key=lambda entry: str(entry.order_id)))
    after = state(*sorted((changed_to_lyon(), untouched), key=lambda entry: str(entry.order_id)))

    diff = arm_state_diff(RUN_ID, before=before, after=after)

    assert [entry.order_id for entry in diff.orders] == [ORDER_ID]
    assert diff.other == ()


def test_a_field_that_was_not_there_is_absent_rather_than_empty() -> None:
    """`None → "Lyon"` and `"" → "Lyon"` are different facts about an order."""
    diff = arm_state_diff(
        RUN_ID,
        before=state(order(shipping_address=None)),
        after=state(changed_to_lyon()),
    )

    appearing = {change.path: (change.before, change.after) for change in diff.orders[0].changes}
    assert appearing["shipping_address.city"] == (None, "Lyon")
    assert appearing["shipping_address.recipient"] == (None, "Maya Laurent")
    # A field absent on both sides never moved, so it is not a change at all.
    assert "shipping_address.line2" not in appearing


def test_the_diff_is_empty_exactly_when_the_fingerprint_has_not_moved() -> None:
    """One reading, not two: the diff walks the same bytes the clone is hashed from."""
    started = state(order())
    moved = state(changed_to_lyon())

    assert arm_state_diff(RUN_ID, before=started, after=started).moved is False
    assert fingerprint_sandbox_state(moved, SNAPSHOT).state_fingerprint != (
        fingerprint_sandbox_state(started, SNAPSHOT).state_fingerprint
    )
    assert arm_state_diff(RUN_ID, before=started, after=moved).moved is True


def test_two_states_the_fingerprint_calls_identical_read_as_unchanged() -> None:
    """The normalization is the hash's, so it has to be the walk's.

    NFC is applied before hashing (ADR 0007), so a composed and a decomposed É are the same
    starting state. A walk that compared them as written would report a change the
    fingerprint says did not happen.
    """
    composed = state(order(shipping_address=frozen_address(line1="18 rue des \u00c9coles")))
    decomposed = state(order(shipping_address=frozen_address(line1="18 rue des E\u0301coles")))

    assert fingerprint_sandbox_state(composed, SNAPSHOT).state_fingerprint == (
        fingerprint_sandbox_state(decomposed, SNAPSHOT).state_fingerprint
    )
    assert arm_state_diff(RUN_ID, before=composed, after=decomposed).moved is False


def test_a_change_outside_the_orders_is_reported_rather_than_dropped() -> None:
    """Nothing in this build can produce one, which is why it must be visible if one is."""
    before = state(order())
    after = replace(
        before,
        interaction=replace(before.interaction, ticket_reference="T-999"),
    )

    diff = arm_state_diff(RUN_ID, before=before, after=after)

    assert diff.orders == ()
    assert diff.other == (
        FieldChange(path="interaction.ticket_reference", before="T-204", after="T-999"),
    )


def test_an_order_the_state_gained_or_lost_is_paired_by_identity() -> None:
    """A run cannot do this; pairing by position would misreport it the day something can."""
    diff = arm_state_diff(
        RUN_ID,
        before=state(order()),
        after=state(order(OTHER_ORDER_ID, reference="NS-10500")),
    )

    lost, gained = sorted(diff.orders, key=lambda entry: entry.reference)
    assert (lost.reference, lost.order_id) == ("NS-10482", ORDER_ID)
    assert (gained.reference, gained.order_id) == ("NS-10500", OTHER_ORDER_ID)
    assert all(change.after is None for change in lost.changes)
    assert all(change.before is None for change in gained.changes)


# -- the walk the reading is built on ---------------------------------------------


def test_a_leaf_is_unchanged_only_when_it_is_the_same_value_of_the_same_type() -> None:
    """`True == 1` in Python, and both are canonical values."""
    assert list(canonical_changes({"n": 1}, {"n": 1})) == []
    assert list(canonical_changes({"n": True}, {"n": 1})) == [
        FieldChange(path="n", before="true", after="1")
    ]


def test_a_list_pairs_by_position_and_reports_the_positions_only_one_side_has() -> None:
    changes = list(canonical_changes({"events": ["placed"]}, {"events": ["placed", "shipped"]}))

    assert changes == [FieldChange(path="events[1]", before=None, after="shipped")]


def test_a_value_that_appears_where_an_object_was_is_reported_whole() -> None:
    """The one way a diff could silently under-report, so it does not descend."""
    changes = list(canonical_changes({"a": {"b": 1}}, {"a": "gone"}))

    assert changes == [FieldChange(path="a", before='{"b":1}', after="gone")]


def test_a_subtree_that_appears_where_nothing_was_reports_every_leaf() -> None:
    """Absence descends: a whole object arriving is every one of its fields arriving."""
    changes = list(canonical_changes({"a": None}, {"a": {"b": 1, "c": [True]}}))

    assert changes == [
        FieldChange(path="a.b", before=None, after="1"),
        FieldChange(path="a.c[0]", before=None, after="true"),
    ]
