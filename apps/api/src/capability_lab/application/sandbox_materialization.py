"""Materialize a published scenario version into a canonical sandbox snapshot.

A published scenario version is a recipe, not starting state. It pins its shop, its ticket,
and every composed template, but it names an order fixture by identifier only — and an order
fixture keeps being edited after the publication (ADR 0015). Materialization is where those
two lifetimes meet: the pins are recorded, the orders are copied, and the result is
fingerprinted so the whole starting state can be recognized again.

Two rules make that safe, and both are in `materialize` below:

- **The gate runs again, against the world as it is now.** A published version is immutable,
  but the orders it names are not, so the same rules that refused the publication refuse the
  freeze. One rule set, re-run — never a second copy that could disagree with the first.
- **A snapshot is identified by its fingerprint, not by its inputs.** Re-materializing the
  same scenario version with the same seed returns the existing snapshot; doing it after an
  order moved produces a new one, because it *is* different starting state.
"""

from __future__ import annotations

import json
from collections.abc import Mapping
from dataclasses import dataclass, replace
from datetime import datetime
from typing import Protocol, cast
from uuid import UUID, uuid4

from capability_lab.application.canonical_json import CanonicalValue
from capability_lab.application.definition_authoring import (
    DefinitionRepository,
    DefinitionVersionRecord,
)
from capability_lab.application.definition_resolution import (
    ConflictingReferenceVersionsError,
    DefinitionResolutionError,
    MissingReferenceVersionError,
    PublishedVersionReader,
    SandboxResolution,
    resolve_sandbox_inputs,
)
from capability_lab.application.order_fixtures import (
    OrderFixtureRecord,
    OrderFixtureRepository,
)
from capability_lab.application.ports import Clock
from capability_lab.application.sandbox_snapshot import (
    SandboxSnapshotDocument,
    fingerprint_sandbox_snapshot,
    sandbox_snapshot_from_document,
)
from capability_lab.application.scenarios import (
    ScenarioVersionNotFoundError,
    block_template,
    scenario_definition_id,
    shop_document_ids,
)
from capability_lab.domain.blocks import MutationBlockPayload, ObjectiveBlockPayload
from capability_lab.domain.definitions import (
    DefinitionIssue,
    DefinitionType,
    DefinitionValidation,
    VersionRef,
    issue_error,
)
from capability_lab.domain.sandbox import (
    SandboxOrder,
    SandboxState,
    resolve_interaction,
)
from capability_lab.domain.scenario import (
    BlockTemplate,
    ScenarioAuthoringContext,
    ScenarioPayload,
    validate_scenario,
)
from capability_lab.domain.shop import ShopPayload
from capability_lab.domain.ticket import (
    TicketAuthoringContext,
    TicketPayload,
    validate_ticket,
)

# No tool contract is versioned yet: the read tools arrive with Milestone 2's tool outcome
# and will register their versions here, where the fingerprint already reads them.
SANDBOX_TOOL_CONTRACT_VERSIONS: Mapping[str, str] = {}


class SandboxSnapshotNotFoundError(DefinitionResolutionError):
    """Raised when a snapshot identifier names nothing in this shop."""


class SandboxNotMaterializableError(DefinitionResolutionError):
    """Raised when the starting state a scenario version names no longer resolves."""

    def __init__(self, validation: DefinitionValidation) -> None:
        super().__init__("the scenario version cannot be materialized into starting state")
        self.validation = validation


@dataclass(frozen=True, slots=True)
class SandboxSnapshotRecord:
    """One immutable snapshot: its provenance columns and the document they describe.

    The document is authoritative. Everything a consumer reads about the frozen state is
    decoded from it rather than stored beside it, so what is served is always what was
    fingerprinted.
    """

    snapshot_id: UUID
    shop_id: UUID
    scenario_id: UUID
    scenario_version: int
    seed: int
    sandbox_fingerprint: str
    document: dict[str, CanonicalValue]
    created_at: datetime

    @property
    def content(self) -> SandboxSnapshotDocument:
        """The envelope decoded, schema token checked first.

        Read through one strict decoder rather than a set of lenient accessors: the pins are
        the reproducibility claim, so a drifted document must say so instead of being served
        with a pin quietly missing.
        """
        return sandbox_snapshot_from_document(self.document)


class SandboxSnapshotRepository(Protocol):
    """Immutable storage: a snapshot is written once and never updated."""

    def get(self, shop_id: UUID, snapshot_id: UUID) -> SandboxSnapshotRecord | None: ...

    def find_by_fingerprint(
        self, shop_id: UUID, sandbox_fingerprint: str
    ) -> SandboxSnapshotRecord | None: ...

    def list_for_scenario(
        self, shop_id: UUID, scenario_id: UUID
    ) -> tuple[SandboxSnapshotRecord, ...]: ...

    def save(self, record: SandboxSnapshotRecord) -> SandboxSnapshotRecord:
        """Store the snapshot and return the one the store now holds.

        Two writers can miss the same fingerprint lookup and both insert; the unique
        constraint decides, and the loser gets the winner's record back rather than an
        error. Materializing is idempotent by fingerprint, so there is nothing to report.
        """
        ...


class SandboxSnapshotService:
    """Freeze the starting state of one published scenario version."""

    def __init__(
        self,
        snapshots: SandboxSnapshotRepository,
        scenarios: DefinitionRepository[ScenarioPayload],
        shops: DefinitionRepository[ShopPayload],
        tickets: DefinitionRepository[TicketPayload],
        orders: OrderFixtureRepository,
        objective_blocks: DefinitionRepository[ObjectiveBlockPayload],
        mutation_blocks: DefinitionRepository[MutationBlockPayload],
        published_versions: PublishedVersionReader,
        clock: Clock,
    ) -> None:
        self._snapshots = snapshots
        self._scenarios = scenarios
        self._shops = shops
        self._tickets = tickets
        self._orders = orders
        self._objective_blocks = objective_blocks
        self._mutation_blocks = mutation_blocks
        self._published_versions = published_versions
        self._clock = clock

    # -- reading ---------------------------------------------------------------

    def list_snapshots(self, shop_id: UUID, scenario_id: UUID) -> tuple[SandboxSnapshotRecord, ...]:
        return self._snapshots.list_for_scenario(shop_id, scenario_id)

    def get_snapshot(self, shop_id: UUID, snapshot_id: UUID) -> SandboxSnapshotRecord:
        record = self._snapshots.get(shop_id, snapshot_id)
        if record is None:
            raise SandboxSnapshotNotFoundError(f"snapshot {snapshot_id} is not in shop {shop_id}")
        return record

    # -- materializing ---------------------------------------------------------

    def materialize(
        self, shop_id: UUID, scenario_id: UUID, version: int, *, seed: int
    ) -> SandboxSnapshotRecord:
        """Freeze the starting state of one published scenario version.

        Idempotent by fingerprint: the same recipe, seed, and orders yield the same document
        and therefore the same snapshot, while an order edited in between yields a new one.
        """
        scenario = self._scenario_version(shop_id, scenario_id, version)
        shop = self._pinned_shop(scenario)
        ticket = self._pinned_ticket(scenario)
        customer_profile_id = ticket.payload.customer_profile_id
        shop_orders = self._orders.list_for_shop(shop_id)
        orders = tuple(
            record
            for record in shop_orders
            if record.payload.customer_profile_id == customer_profile_id
        )

        validation = self._gate(
            shop, ticket, scenario, shop_orders=shop_orders, customer_orders=orders
        )
        resolution: SandboxResolution | None = None
        try:
            resolution = resolve_sandbox_inputs(
                self._published_versions,
                scenario=scenario.ref,
                seed=seed,
                tool_contract_versions=SANDBOX_TOOL_CONTRACT_VERSIONS,
            )
        except ConflictingReferenceVersionsError as error:
            # The closure disagrees with itself — typically a ticket frozen against an older
            # shop version than the scenario built on it. A snapshot cannot pick a winner and
            # the author fixes it by republishing, so it joins the findings rather than
            # crashing: `str(error)` already names the definition and both versions.
            validation = DefinitionValidation(
                issues=(
                    *validation.issues,
                    issue_error("sandbox_conflicting_pin", str(error), "definitions"),
                )
            )
        if validation.errors or resolution is None:
            raise SandboxNotMaterializableError(validation)

        state = SandboxState(
            customer_profile_id=customer_profile_id,
            interaction=resolve_interaction(ticket.payload),
            orders=tuple(
                SandboxOrder(order_id=record.order_id, payload=record.payload)
                for record in sorted(orders, key=lambda candidate: str(candidate.order_id))
            ),
        )
        fingerprint = fingerprint_sandbox_snapshot(resolution, state)

        existing = self._snapshots.find_by_fingerprint(shop_id, fingerprint.sandbox_fingerprint)
        if existing is not None:
            return existing

        return self._snapshots.save(
            SandboxSnapshotRecord(
                snapshot_id=uuid4(),
                shop_id=shop_id,
                scenario_id=scenario_id,
                scenario_version=version,
                seed=seed,
                sandbox_fingerprint=fingerprint.sandbox_fingerprint,
                document=_document_of(fingerprint.canonical_json),
                created_at=self._clock.now(),
            )
        )

    # -- the gate, re-run against the world as it is now -------------------------

    def _gate(
        self,
        shop: DefinitionVersionRecord[ShopPayload],
        ticket: DefinitionVersionRecord[TicketPayload],
        scenario: DefinitionVersionRecord[ScenarioPayload],
        *,
        shop_orders: tuple[OrderFixtureRecord, ...],
        customer_orders: tuple[OrderFixtureRecord, ...],
    ) -> DefinitionValidation:
        """Judge the frozen recipe against current orders, with the authoring rule sets.

        Everything the two published versions name is pinned and immutable except the order
        fixtures, so the findings that can appear here are precisely the reference rules —
        an order deleted or reassigned since the publication. Reusing `validate_ticket` and
        `validate_scenario` rather than restating them is what keeps "publishable" and
        "materializable" one set of rules.
        """
        customer_id = ticket.payload.customer_profile_id
        document_ids = shop_document_ids(shop.payload)
        product_handles = frozenset(product.handle for product in shop.payload.products)
        shop_order_ids = frozenset(record.order_id for record in shop_orders)
        customer_order_ids = frozenset(record.order_id for record in customer_orders)

        ticket_findings = validate_ticket(
            ticket.payload,
            TicketAuthoringContext(
                shop_channels=frozenset(shop.payload.identity.channels),
                product_handles=product_handles,
                shop_order_ids=shop_order_ids,
                customer_order_ids=customer_order_ids,
                document_ids=document_ids,
            ),
        )
        scenario_findings = validate_scenario(
            scenario.payload,
            ScenarioAuthoringContext(
                ticket_customer_profile_id=customer_id,
                document_ids=document_ids,
                product_handles=product_handles,
                shop_order_ids=shop_order_ids,
                customer_order_ids=customer_order_ids,
                shop_customer_profile_ids=frozenset({customer_id}),
                objective_blocks=self._pinned_templates(
                    scenario, DefinitionType.OBJECTIVE_BLOCK, self._objective_blocks
                ),
                mutation_blocks=self._pinned_templates(
                    scenario, DefinitionType.MUTATION_BLOCK, self._mutation_blocks
                ),
            ),
        )
        return DefinitionValidation(
            issues=(
                *_rooted(ticket_findings.issues, "ticket"),
                *_rooted(scenario_findings.issues, "scenario"),
            )
        )

    # -- reading the pins --------------------------------------------------------

    def _scenario_version(
        self, shop_id: UUID, scenario_id: UUID, version: int
    ) -> DefinitionVersionRecord[ScenarioPayload]:
        record = self._scenarios.get_version(
            VersionRef(definition=scenario_definition_id(scenario_id), version=version)
        )
        if record is None or record.published.shop is None:
            raise ScenarioVersionNotFoundError(
                f"scenario {scenario_id} has no published version {version}"
            )
        if record.published.shop.id != shop_id:
            raise ScenarioVersionNotFoundError(f"scenario {scenario_id} is not in shop {shop_id}")
        return record

    def _pinned_shop(
        self, scenario: DefinitionVersionRecord[ScenarioPayload]
    ) -> DefinitionVersionRecord[ShopPayload]:
        shop = scenario.published.shop
        shop_version = scenario.published.shop_version
        if shop is None or shop_version is None:
            raise MissingReferenceVersionError(
                f"scenario version {scenario.published.version} pins no shop version"
            )
        record = self._shops.get_version(VersionRef(definition=shop, version=shop_version))
        if record is None:
            raise MissingReferenceVersionError(
                f"shop {shop.id} version {shop_version} is not resolvable"
            )
        return record

    def _pinned_ticket(
        self, scenario: DefinitionVersionRecord[ScenarioPayload]
    ) -> DefinitionVersionRecord[TicketPayload]:
        ticket_ref = next(
            (
                reference
                for reference in scenario.published.references
                if reference.definition.definition_type is DefinitionType.TICKET
            ),
            None,
        )
        if ticket_ref is None:
            raise MissingReferenceVersionError(
                f"scenario version {scenario.published.version} pins no ticket version"
            )
        record = self._tickets.get_version(ticket_ref)
        if record is None:
            raise MissingReferenceVersionError(
                f"ticket {ticket_ref.definition.id} version {ticket_ref.version} is not resolvable"
            )
        return record

    def _pinned_templates[PayloadT: ObjectiveBlockPayload | MutationBlockPayload](
        self,
        scenario: DefinitionVersionRecord[ScenarioPayload],
        definition_type: DefinitionType,
        repository: DefinitionRepository[PayloadT],
    ) -> dict[UUID, BlockTemplate]:
        """The templates as the publication pinned them, never as their drafts read now.

        A template edited after the publication must not change what this scenario version
        means, which is the whole reason the publication pinned a version of it.
        """
        templates: dict[UUID, BlockTemplate] = {}
        for reference in scenario.published.references:
            if reference.definition.definition_type is not definition_type:
                continue
            record = repository.get_version(reference)
            if record is None:
                raise MissingReferenceVersionError(
                    f"{definition_type} {reference.definition.id} version {reference.version} "
                    "is not resolvable"
                )
            templates[reference.definition.id] = block_template(record.payload, True)
        return templates


def _rooted(issues: tuple[DefinitionIssue, ...], prefix: str) -> tuple[DefinitionIssue, ...]:
    """Say which frozen document a finding came from, so a hole is locatable."""
    return tuple(replace(issue, path=f"{prefix}.{issue.path}") for issue in issues)


def _document_of(canonical_json: bytes) -> dict[str, CanonicalValue]:
    """Re-read the bytes that were hashed, so the stored document is the fingerprinted one."""
    document: object = json.loads(canonical_json)
    if not isinstance(document, dict):  # pragma: no cover - canonical_json_bytes writes objects
        raise DefinitionResolutionError("a sandbox snapshot document must be an object")
    return cast("dict[str, CanonicalValue]", document)
