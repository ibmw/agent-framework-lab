"""What actually moved in one arm's world, field by field, against where it started.

`docs/PLAN.md` Milestone 5 asks an experiment detail to preserve state diffs, and ADR 0033
deferred them by name: the results screen's business-state card reads each arm's writes and
its revisions, which says *that* something moved and never *what*. A revision counter is not
evidence about an incident — "r0 → r1" is true of a redirected order and of a corrected
typo — and the frame the card implements shows the value on both sides.

Four decisions shape this reading.

**It is a diff of the bytes the fingerprint covers.** Both sides are rendered through the
same `sandbox_state_document` codec the clone's `sandbox-state-v1` envelope is hashed from
(ADR 0020) *and* normalized the way the hash normalizes, so this reading and that fingerprint
can never disagree: an arm's diff is empty exactly when its state fingerprint is still the one
every sibling clone started at. A comparison written against the domain objects instead would
be a second opinion about what "changed" means, free to call a run unmoved that the
fingerprint calls moved.

**It walks the document rather than a list of fields worth watching.** The card's claim is
"no other state changed", and that claim is only checkable if nothing was excluded from the
check. It also means the day an order fixture gains an authored field, that field appears in
the diff without a line of code here — the same rule ADR 0023 gave the conformance sweep,
which reads the registry rather than a list somebody kept current.

**It is projected, never stored.** The starting state is the snapshot's and the current state
is the arm's, both already read to serve an experiment, so this is a function of two
documents rather than a third record able to drift from either (ADR 0027, ADR 0030,
ADR 0032).

**Changes are grouped by the order they happened to**, because an order is what a customer
and an agent name — a flat list of `orders[1].document.shipping_address.city` paths would
make the reader do the grouping, and would make it by position rather than by identity.
Anything outside the orders is kept apart rather than dropped: a run cannot move it
(`Sandbox.with_order` is the only writer and it carries the customer and the interaction
through untouched), so a change there is a fact about the lab rather than about the agent,
and reporting nothing would be the way not to find out.
"""

from __future__ import annotations

from collections.abc import Iterator, Mapping
from dataclasses import dataclass
from typing import cast
from uuid import UUID

from capability_lab.application.canonical_json import (
    CanonicalValue,
    canonical_json_text,
    normalize_canonical_value,
)
from capability_lab.application.sandbox_snapshot import sandbox_state_document
from capability_lab.domain.sandbox import SandboxState

__all__ = [
    "ArmStateDiff",
    "FieldChange",
    "OrderStateDiff",
    "arm_state_diff",
    "canonical_changes",
]


@dataclass(frozen=True, slots=True)
class FieldChange:
    """One leaf of a canonical document that reads differently than it started.

    `before` and `after` are the canonical values rendered as text, and `None` means the
    field was *absent* on that side rather than empty — an order that had no shipping
    address and now has one reads as `None → "Lyon"`, which is a different fact from `"" →
    "Lyon"`.
    """

    path: str
    """Where the change is, relative to what it is a change *of*: `shipping_address.city`
    inside an order document, `interaction.channel` outside them. List positions are
    indexed, because a canonical list is ordered and its order is part of the state."""

    before: str | None
    after: str | None


@dataclass(frozen=True, slots=True)
class OrderStateDiff:
    """Everything that moved in one order, named the way the incident names it."""

    order_id: UUID
    reference: str
    """The reference the customer quotes and the agent reads back. Stable by construction: a
    run may change what an order says and never which order it is (ADR 0020)."""

    changes: tuple[FieldChange, ...]


@dataclass(frozen=True, slots=True)
class ArmStateDiff:
    """The difference between the world one arm was cloned into and the one it is in now."""

    run_id: UUID
    orders: tuple[OrderStateDiff, ...]
    """One entry per order that moved, ordered by identifier as the state document is.
    An order nothing touched is absent, so an empty tuple is "this arm changed no order"."""

    other: tuple[FieldChange, ...]
    """Changes outside every order — which nothing in this build can produce.

    Kept rather than dropped because it is the half of "no other state changed" that no
    write seam guarantees: an empty tuple is the check passing, and a non-empty one is a
    finding about the lab that an operator should see rather than a diff quietly hiding."""

    @property
    def moved(self) -> bool:
        """Whether anything at all is different, which the state fingerprint also answers."""
        return bool(self.orders or self.other)


def arm_state_diff(run_id: UUID, *, before: SandboxState, after: SandboxState) -> ArmStateDiff:
    """Read one arm against the starting state it was cloned from.

    `before` is the snapshot's state — the one *both* arms began at — rather than anything
    stored per arm, so the two arms' diffs are differences from one common world and can be
    read beside each other.
    """
    before_document = _canonical(before)
    after_document = _canonical(after)
    return ArmStateDiff(
        run_id=run_id,
        orders=_order_diffs(before_document, after_document),
        other=tuple(
            canonical_changes(_outside_orders(before_document), _outside_orders(after_document))
        ),
    )


def _canonical(state: SandboxState) -> Mapping[str, CanonicalValue]:
    """Render one state exactly as the fingerprint renders it before hashing.

    The normalization is not decoration: `canonical_json_bytes` applies NFC before it hashes,
    so two strings in different normalization forms hash identically. A walk that compared
    them unnormalized would report a change the fingerprint says did not happen, and the
    property this whole module rests on would hold only because every production caller
    happens to decode from already-normalized bytes.
    """
    # `normalize_canonical_value` preserves the shape it is given, so an object stays one.
    return cast(
        "dict[str, CanonicalValue]", normalize_canonical_value(sandbox_state_document(state))
    )


def canonical_changes(
    before: CanonicalValue, after: CanonicalValue, path: str = ""
) -> Iterator[FieldChange]:
    """Walk two canonical values together and yield every leaf that differs.

    Total over the canonical union (ADR 0007): objects merge their keys, lists pair by
    position and report the positions only one side has, and everything else compares as a
    leaf. A value that is an object on one side and a scalar on the other cannot come out of
    a codec whose shape is fixed, so it is reported as one leaf change over the rendered
    subtree rather than descended into — losing the scalar would be the one way a diff could
    silently under-report.
    """
    if isinstance(before, dict) or isinstance(after, dict):
        if _descendable(before, dict) and _descendable(after, dict):
            yield from _object_changes(before, after, path)
            return
    elif isinstance(before, list) or isinstance(after, list):
        if _descendable(before, list) and _descendable(after, list):
            yield from _list_changes(before, after, path)
            return
    # `True == 1` in Python, and both are canonical values: a leaf is unchanged only when it
    # is the same value *of the same type*.
    elif type(before) is type(after) and before == after:
        return
    yield FieldChange(path=path, before=_text(before), after=_text(after))


def _object_changes(
    before: CanonicalValue, after: CanonicalValue, path: str
) -> Iterator[FieldChange]:
    left = before if isinstance(before, dict) else {}
    right = after if isinstance(after, dict) else {}
    for key in sorted(set(left) | set(right)):
        yield from canonical_changes(left.get(key), right.get(key), _join(path, key))


def _list_changes(
    before: CanonicalValue, after: CanonicalValue, path: str
) -> Iterator[FieldChange]:
    left = before if isinstance(before, list) else []
    right = after if isinstance(after, list) else []
    for index in range(max(len(left), len(right))):
        yield from canonical_changes(
            left[index] if index < len(left) else None,
            right[index] if index < len(right) else None,
            f"{path}[{index}]",
        )


def _order_diffs(
    before: Mapping[str, CanonicalValue], after: Mapping[str, CanonicalValue]
) -> tuple[OrderStateDiff, ...]:
    """Pair the two states' orders by identifier, never by position.

    A run cannot add or remove an order, so the two lists agree today; pairing by index
    anyway would mean that the day one can, every order after the change would read as
    rewritten rather than the one order that moved.
    """
    left = _orders_by_id(before)
    right = _orders_by_id(after)
    diffs: list[OrderStateDiff] = []
    for order_id in sorted(set(left) | set(right)):
        changes = tuple(canonical_changes(left.get(order_id), right.get(order_id)))
        if not changes:
            continue
        diffs.append(
            OrderStateDiff(
                order_id=UUID(order_id),
                reference=_reference(right.get(order_id)) or _reference(left.get(order_id)) or "",
                changes=changes,
            )
        )
    return tuple(diffs)


def _orders_by_id(document: Mapping[str, CanonicalValue]) -> dict[str, CanonicalValue]:
    """The order documents of one state, keyed by the identifier beside each of them."""
    orders = document.get("orders")
    if not isinstance(orders, list):  # pragma: no cover - the codec always writes a list
        return {}
    keyed: dict[str, CanonicalValue] = {}
    for entry in orders:
        if isinstance(entry, dict):
            order_id = entry.get("order_id")
            if isinstance(order_id, str):
                keyed[order_id] = entry.get("document")
    return keyed


def _reference(document: CanonicalValue) -> str | None:
    if isinstance(document, dict):
        reference = document.get("reference")
        if isinstance(reference, str):
            return reference
    return None


def _outside_orders(document: Mapping[str, CanonicalValue]) -> CanonicalValue:
    """Everything a state document holds that is not an order, which is what a run moves."""
    return {key: value for key, value in document.items() if key != "orders"}


def _descendable(value: CanonicalValue, container: type) -> bool:
    """Whether a value can be walked as `container`: it is one, or it is simply not there."""
    return value is None or isinstance(value, container)


def _join(path: str, key: str) -> str:
    return key if not path else f"{path}.{key}"


def _text(value: CanonicalValue) -> str | None:
    """Render one canonical value as the text an operator reads it as.

    `None` stays `None` — the wire distinguishes "this field was not there" from any value
    it could have carried. A container reaches this only through the mismatched-shape branch
    above, and is rendered as the canonical JSON it is rather than as `<object>`, because a
    finding nobody can read is a finding nobody acts on.
    """
    if value is None:
        return None
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, str):
        return value
    if isinstance(value, int):
        return str(value)
    return canonical_json_text(value)
