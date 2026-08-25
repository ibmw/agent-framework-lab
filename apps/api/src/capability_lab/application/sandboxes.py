"""Clone a snapshot into the independently mutable sandbox one arm works in.

A sandbox snapshot is starting state: immutable, shared, and identified by the fingerprint
that makes an experiment reproducible (ADR 0019). It is deliberately not the state a run
mutates — both arms of a comparison start from the same snapshot, and an arm that could
write to it would be writing into the other arm's world.

So a run gets a **clone**: its own copy of the snapshot's state, its own revision, and its
own row. Two facts follow, and the whole module exists to hold them:

- **Both arms provably start from the same starting state.** A clone records the snapshot
  fingerprint it was taken from, and every clone of one snapshot begins at the same
  `state_fingerprint`, because the same bytes hash the same way.
- **A write in one arm is invisible to the other.** The copy is the isolation; there is no
  shared row, no reference back into the snapshot's document, and no update path on the
  snapshot at all.

`state_fingerprint` is what makes divergence readable: it equals the fingerprint every
sibling clone started with until something moves the state, and never again afterwards.

The only writer here is `apply_order_change`, and it is deliberately not reachable over
HTTP yet: the actors that mutate a sandbox are the versioned read tools and the safe
address-change action, and both arrive in later slices of this milestone (ADR 0020). What
this module owns is the write *seam* those callers need — the domain rules, the fingerprint
recomputation, and the optimistic-concurrency guard.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime
from typing import Protocol, cast
from uuid import UUID, uuid4

from capability_lab.application.canonical_document import (
    DocumentReader,
    require_schema_version,
)
from capability_lab.application.canonical_json import (
    CanonicalValue,
    canonical_json_bytes,
    canonical_sha256,
)
from capability_lab.application.definition_resolution import DefinitionResolutionError
from capability_lab.application.ports import Clock
from capability_lab.application.sandbox_materialization import (
    SandboxSnapshotNotFoundError,
    SandboxSnapshotRepository,
)
from capability_lab.application.sandbox_snapshot import (
    sandbox_state_document,
    sandbox_state_from_document,
)
from capability_lab.domain.content import require_label
from capability_lab.domain.order_fixture import OrderFixturePayload
from capability_lab.domain.sandbox import Sandbox, SandboxConfigurationError, SandboxState

SANDBOX_STATE_CANONICAL_SCHEMA_VERSION = "sandbox-state-v1"


class SandboxNotFoundError(DefinitionResolutionError):
    """Raised when a sandbox identifier names nothing in this shop."""


class SandboxLabelError(DefinitionResolutionError):
    """Raised when an arm is cloned without a name an operator can tell it by."""


class SandboxRevisionConflictError(DefinitionResolutionError):
    """Raised when a writer's revision is not the one the sandbox currently holds.

    The optimistic-concurrency refusal an arm's tools rely on: two writers that read the
    same sandbox must not both win, and the loser is told rather than overwritten.

    `actual` is the revision the loser can see, and it is `None` when the store refused the
    write but cannot name the winner — the transaction that overtook it may not be visible
    from inside this one. Saying "the sandbox is no longer at revision 0" is honest there;
    claiming it has moved *to* revision 0 would not be.
    """

    def __init__(self, expected: int, actual: int | None = None) -> None:
        super().__init__(
            f"the sandbox has moved to revision {actual}; the change was written "
            f"against revision {expected}"
            if actual is not None and actual != expected
            else f"the sandbox is no longer at revision {expected}; another writer holds it"
        )
        self.expected = expected
        self.actual = actual


@dataclass(frozen=True, slots=True)
class SandboxStateFingerprint:
    canonical_json: bytes
    state_fingerprint: str


def sandbox_state_envelope(
    state: SandboxState, snapshot_fingerprint: str
) -> dict[str, CanonicalValue]:
    """Render one clone's current state as a `sandbox-state-v1` document.

    The `state` section is the same one `sandbox-v2` carries, rendered by the same codec, so
    a clone and the snapshot it came from cannot describe an order two different ways. What
    the clone adds is `snapshot_fingerprint`: the starting state it claims to have begun at,
    written once and never moved by a change.

    The label and the revision are deliberately absent. A label is operational naming and a
    revision is a write counter; neither is starting state, so neither belongs in the bytes
    that are hashed (ADR 0012).
    """
    return {
        "canonical_schema_version": SANDBOX_STATE_CANONICAL_SCHEMA_VERSION,
        "snapshot_fingerprint": snapshot_fingerprint,
        "state": sandbox_state_document(state),
    }


@dataclass(frozen=True, slots=True)
class SandboxStateDocument:
    """One stored clone document, decoded: where it started and where it is."""

    snapshot_fingerprint: str
    state: SandboxState


def sandbox_state_from_envelope(document: object) -> SandboxStateDocument:
    """Rebuild a stored clone document, checking its schema token first.

    The same rule the snapshot decoder holds: a document that no longer matches this schema
    says so, rather than being served as run state nobody can explain.
    """
    reader = DocumentReader(document, "sandbox state")
    require_schema_version(reader, SANDBOX_STATE_CANONICAL_SCHEMA_VERSION, "sandbox state")
    return SandboxStateDocument(
        snapshot_fingerprint=reader.text("snapshot_fingerprint"),
        state=sandbox_state_from_document(reader.embedded("state")),
    )


def fingerprint_sandbox_state(
    state: SandboxState, snapshot_fingerprint: str
) -> SandboxStateFingerprint:
    """Hash where a clone currently is, so divergence between arms is readable."""
    canonical_json = canonical_json_bytes(sandbox_state_envelope(state, snapshot_fingerprint))
    return SandboxStateFingerprint(
        canonical_json=canonical_json,
        state_fingerprint=canonical_sha256(canonical_json),
    )


@dataclass(frozen=True, slots=True)
class SandboxRecord:
    """One arm's mutable sandbox: its provenance, its position, and its state document.

    `snapshot_fingerprint` is the starting state this arm claims; `state_fingerprint` is
    where it is now. They agree with every sibling clone at revision 0 and stop agreeing the
    moment one arm writes, which is exactly the evidence a comparison needs.
    """

    sandbox_id: UUID
    shop_id: UUID
    snapshot_id: UUID
    label: str
    revision: int
    snapshot_fingerprint: str
    state_fingerprint: str
    document: dict[str, CanonicalValue]
    created_at: datetime
    updated_at: datetime

    @property
    def content(self) -> SandboxStateDocument:
        """The stored document decoded, schema token checked first."""
        return sandbox_state_from_envelope(self.document)

    @property
    def sandbox(self) -> Sandbox:
        """The domain value a change is applied to."""
        return Sandbox(state=self.content.state, revision=self.revision)


class SandboxRepository(Protocol):
    """Per-arm storage. Every clone owns its row; nothing here is shared between arms."""

    def get(self, shop_id: UUID, sandbox_id: UUID) -> SandboxRecord | None: ...

    def list_for_snapshot(self, shop_id: UUID, snapshot_id: UUID) -> tuple[SandboxRecord, ...]: ...

    def save(self, record: SandboxRecord) -> SandboxRecord: ...

    def update(self, record: SandboxRecord, *, expected_revision: int) -> SandboxRecord:
        """Write the next revision, or refuse because the sandbox has moved.

        The guard is the store's, not the caller's: a read-then-write in the service can be
        overtaken between the two statements, and the revision predicate is what makes the
        loser lose. Raises `SandboxRevisionConflictError`.
        """
        ...


class SandboxService:
    """Clone a snapshot into arms, read them, and apply the changes a run makes."""

    def __init__(
        self,
        sandboxes: SandboxRepository,
        snapshots: SandboxSnapshotRepository,
        clock: Clock,
    ) -> None:
        self._sandboxes = sandboxes
        self._snapshots = snapshots
        self._clock = clock

    # -- reading ---------------------------------------------------------------

    def list_sandboxes(self, shop_id: UUID, snapshot_id: UUID) -> tuple[SandboxRecord, ...]:
        return self._sandboxes.list_for_snapshot(shop_id, snapshot_id)

    def get_sandbox(self, shop_id: UUID, sandbox_id: UUID) -> SandboxRecord:
        record = self._sandboxes.get(shop_id, sandbox_id)
        if record is None:
            raise SandboxNotFoundError(f"sandbox {sandbox_id} is not in shop {shop_id}")
        return record

    # -- cloning ---------------------------------------------------------------

    def clone(self, shop_id: UUID, snapshot_id: UUID, label: str) -> SandboxRecord:
        """Take one arm's own copy of a snapshot's starting state.

        Deliberately not idempotent, and this is the one place in the sandbox model where
        that is the point: materializing the same starting state twice is one snapshot,
        while cloning it twice is *two arms*, which is what a paired experiment is made of.
        """
        # One label rule, shared with every other named thing in the lab. It is translated
        # into an application refusal because an arm's name is operational rather than part
        # of the state the domain guards.
        try:
            require_label(label, "sandbox label", error=SandboxConfigurationError)
        except SandboxConfigurationError as error:
            raise SandboxLabelError(str(error)) from error
        snapshot = self._snapshots.get(shop_id, snapshot_id)
        if snapshot is None:
            raise SandboxSnapshotNotFoundError(f"snapshot {snapshot_id} is not in shop {shop_id}")

        state = snapshot.content.state
        fingerprint = fingerprint_sandbox_state(state, snapshot.sandbox_fingerprint)
        now = self._clock.now()
        return self._sandboxes.save(
            SandboxRecord(
                sandbox_id=uuid4(),
                shop_id=shop_id,
                snapshot_id=snapshot_id,
                label=label,
                revision=0,
                snapshot_fingerprint=snapshot.sandbox_fingerprint,
                state_fingerprint=fingerprint.state_fingerprint,
                document=_document_of(fingerprint.canonical_json),
                created_at=now,
                updated_at=now,
            )
        )

    # -- writing ---------------------------------------------------------------

    def apply_order_change(
        self,
        shop_id: UUID,
        sandbox_id: UUID,
        order_id: UUID,
        payload: OrderFixturePayload,
        *,
        expected_revision: int,
    ) -> SandboxRecord:
        """Replace one order's document in one arm, and in no other.

        The seam the read tools and the safe address-change action write through. The domain
        decides whether the change is one a run may make; this decides whether the arm is
        still where the writer thought it was.
        """
        record = self.get_sandbox(shop_id, sandbox_id)
        if record.revision != expected_revision:
            raise SandboxRevisionConflictError(expected_revision, record.revision)

        moved = record.sandbox.with_order(order_id, payload)
        fingerprint = fingerprint_sandbox_state(moved.state, record.snapshot_fingerprint)
        return self._sandboxes.update(
            SandboxRecord(
                sandbox_id=record.sandbox_id,
                shop_id=record.shop_id,
                snapshot_id=record.snapshot_id,
                label=record.label,
                revision=moved.revision,
                snapshot_fingerprint=record.snapshot_fingerprint,
                state_fingerprint=fingerprint.state_fingerprint,
                document=_document_of(fingerprint.canonical_json),
                created_at=record.created_at,
                updated_at=self._clock.now(),
            ),
            expected_revision=expected_revision,
        )


def _document_of(canonical_json: bytes) -> dict[str, CanonicalValue]:
    """Re-read the bytes that were hashed, so the stored document is the fingerprinted one."""
    document: object = json.loads(canonical_json)
    if not isinstance(document, dict):  # pragma: no cover - canonical_json_bytes writes objects
        raise DefinitionResolutionError("a sandbox state document must be an object")
    return cast("dict[str, CanonicalValue]", document)
