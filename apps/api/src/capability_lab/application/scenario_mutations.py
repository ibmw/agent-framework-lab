"""Firing a scenario's mutations into one arm, at the moments the recipe bound them to.

The last thing a published scenario says that nothing yet did. ADR 0017 gave a mutation
template one timing parameter, ADR 0018 let a recipe bind it to one of its own objects, and
ADR 0019 froze both into the snapshot every arm is cloned from. What was missing is the
runtime that watches an arm and moves its world when the bound moment arrives.

Five decisions shape it.

**A fault fires between an arm's calls, not between its turns.** The motivating case is the
one ADR 0022 wrote down: "the agent proposes against a world, the fault moves that world, and
the write it computed no longer applies". That only happens if the moment can arrive *inside*
an attempt, so the check runs before the agent asks anything and again after every call it
makes. Firing only at turn boundaries would have made the concurrency refusal unreachable and
the fault decorative.

**The lab declares what it can actually apply.** `APPLIABLE_MUTATIONS` is a table in the same
spirit as `sandbox_tool_contracts` and `agent_capabilities`: an effect is here because the lab
has code that performs it and tests that keep performing it. Authoring stays free — a library
may hold a `tool-timeout` template long before anything injects one — but *starting* an
experiment whose scenario composes an effect this build cannot apply is refused, named, and
visible in the preview. A fault that silently never fires is worse than one that refuses.

**A firing is recorded because the world moved, not because a runtime reported it.** The
event is written by the code that performed the write, holding the revisions the sandbox
itself returned. Nothing a framework produces reaches it, and no adapter can claim a fault
fired that did not.

**It fires once per arm, and both arms carry the same schedule.** The schedule is read from
the versions the experiment pinned, so two arms of one experiment are faulted identically —
which is what keeps the mutation out of the comparison. Whether an arm had *already read* the
order when it moved is a property of that arm's behavior, and that is exactly the difference
the experiment is there to show.

**A moment that cannot arrive is refused at setup, never at run time.** An `at_offset` timing
needs sandbox time to measure against and this build has no clock in the sandbox, so an
experiment that composes one is refused where an operator can read it, rather than starting
and quietly never faulting.
"""

from __future__ import annotations

import logging
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from types import MappingProxyType
from uuid import UUID

from capability_lab.application.canonical_json import CanonicalValue, canonical_timestamp
from capability_lab.application.definition_authoring import DefinitionRepository
from capability_lab.application.definition_resolution import MissingReferenceVersionError
from capability_lab.application.mutation_events import (
    MutationEvent,
    MutationEventRecord,
    MutationEventRepository,
)
from capability_lab.application.ports import Clock
from capability_lab.application.sandbox_tool_contracts import ORDER_DETAIL
from capability_lab.application.sandbox_tools import ToolOutcome
from capability_lab.application.sandboxes import SandboxRecord, SandboxService
from capability_lab.application.scenarios import scenario_definition_id
from capability_lab.domain.blocks import (
    BlockParameter,
    BlockParameterKind,
    MutationBlockPayload,
    MutationEffect,
    MutationTiming,
    MutationTimingKind,
    parse_timing,
)
from capability_lab.domain.content import MAX_SLUG_LENGTH
from capability_lab.domain.definitions import (
    DefinitionIssue,
    DefinitionType,
    VersionRef,
    issue_error,
)
from capability_lab.domain.mutation import (
    ArmProgress,
    MutationNotApplicableError,
    advance_fulfilment,
    is_due,
)
from capability_lab.domain.order_fixture import OrderFixturePayload
from capability_lab.domain.scenario import (
    BoundMutation,
    EntityReference,
    ScenarioEntityKind,
    ScenarioPayload,
    parse_entity_reference,
)

__all__ = [
    "APPLIABLE_MUTATIONS",
    "APPLIABLE_TIMINGS",
    "MUTATION_APPLIERS",
    "AppliableMutation",
    "ArmMutations",
    "PinnedTemplate",
    "ScenarioMutationRuntime",
    "ScheduledMutation",
    "entities_read",
    "mutation_issues",
    "schedule_of",
]

_logger = logging.getLogger(__name__)

_EVENT_ID_PREFIX = "mutation-"
"""What a firing's order-history entry is named after the fault with."""

OrderMutationApplier = Callable[..., OrderFixturePayload]


@dataclass(frozen=True, slots=True)
class AppliableMutation:
    """One effect the lab performs, and the project-owned code that performs it.

    `entity_kinds` is what the applier can move, which is a property of the code rather than
    of the template: a scenario binding a customer to an entity mutation is asking for
    something no function here does, and the setup gate says so from this table.
    """

    effect: MutationEffect
    entity_kinds: frozenset[ScenarioEntityKind]
    applier: OrderMutationApplier


APPLIABLE_MUTATIONS: Mapping[MutationEffect, AppliableMutation] = MappingProxyType(
    {
        MutationEffect.ENTITY_MUTATION: AppliableMutation(
            effect=MutationEffect.ENTITY_MUTATION,
            entity_kinds=frozenset({ScenarioEntityKind.ORDER}),
            applier=advance_fulfilment,
        )
    }
)
"""The effects this build injects. The three absent ones are absent on purpose.

`tool_fault` and `service_outage` would have to reach inside the tool layer and make a
published contract answer something it never authored; `clock_shift` needs sandbox time,
which no snapshot carries. Each is a slice of its own, and declaring them here before they
exist would let a scenario start an experiment that never faults.
"""

MUTATION_APPLIERS: Mapping[MutationEffect, OrderMutationApplier] = MappingProxyType(
    {effect: contract.applier for effect, contract in APPLIABLE_MUTATIONS.items()}
)
"""Every appliable effect and the project-owned function that performs it.

The mutation half of `TOOL_HANDLERS`, and its only consumer is the timeline (ADR 0027), which
turns a function into a file and a line. Derived from the contract table rather than written
beside it, so what a timeline points at is what actually ran.
"""

APPLIABLE_TIMINGS: frozenset[MutationTimingKind] = frozenset(
    {MutationTimingKind.AFTER_FIRST_READ, MutationTimingKind.AT_TURN}
)
"""The moments a run can observe: what this arm has read, and how far its thread has got.

`at_offset` is absent because a sandbox has no clock. Adding one is a decision about
reproducibility — every arm would have to advance identically — rather than a small feature,
so it waits for a slice that makes it.
"""


@dataclass(frozen=True, slots=True)
class PinnedTemplate:
    """One mutation template as a scenario version pinned it."""

    payload: MutationBlockPayload
    version: int


@dataclass(frozen=True, slots=True)
class ScheduledMutation:
    """One bound mutation, resolved against the template version the scenario pinned."""

    mutation_id: str
    block_id: UUID
    block_version: int
    effect: MutationEffect
    timing: MutationTiming
    timing_value: str
    target: EntityReference

    @property
    def target_id(self) -> UUID | None:
        return self.target.entity_id


def mutation_issues(
    scenario: ScenarioPayload, templates: Mapping[UUID, PinnedTemplate]
) -> tuple[DefinitionIssue, ...]:
    """Everything about this scenario's mutations that refuses to *run*.

    Not a second publish gate. Publishing judges whether a recipe is coherent, which it can
    be while naming a fault no build injects yet; this judges whether the lab can carry it
    out, which is a property of the code that is here. Errors rather than warnings: an
    experiment that started with a fault nobody would fire would produce evidence an operator
    reads as "the fault did not change anything", and that is the one thing it must never
    mean.
    """
    issues: list[DefinitionIssue] = []
    for mutation in scenario.mutations:
        path = f"mutations.{mutation.id}"
        pinned = templates.get(mutation.block_id)
        if pinned is None:  # pragma: no cover - publishing pinned every composed template
            issues.append(
                issue_error(
                    "mutation_template_unresolvable",
                    f"{mutation.id} names a template this scenario version does not pin",
                    path,
                )
            )
            continue
        issues.extend(_instance_issues(mutation, pinned.payload, path))
    return tuple(issues)


def schedule_of(
    scenario: ScenarioPayload, templates: Mapping[UUID, PinnedTemplate]
) -> tuple[ScheduledMutation, ...]:
    """This scenario's mutations, in the order the recipe composed them.

    Order is content for a scenario's mutations (ADR 0018) and it is preserved here, but two
    faults that come due at the same moment fire in it rather than being ordered by anything
    else. Anything this build cannot carry out is absent: the setup gate refused it before an
    experiment existed, and a schedule that carried it would be a promise nothing keeps.
    """
    scheduled: list[ScheduledMutation] = []
    for mutation in scenario.mutations:
        pinned = templates.get(mutation.block_id)
        if pinned is None or _instance_issues(mutation, pinned.payload, ""):
            continue
        timing_parameter = _sole(pinned.payload.parameters, BlockParameterKind.TIMING)
        entity_parameter = _sole(pinned.payload.parameters, BlockParameterKind.ENTITY_REFERENCE)
        if timing_parameter is None or entity_parameter is None:  # pragma: no cover - judged
            continue
        bindings = mutation.binding_values
        timing_value = bindings.get(timing_parameter.name, "")
        timing = parse_timing(timing_value)
        target = parse_entity_reference(bindings.get(entity_parameter.name, ""))
        if timing is None or target is None:  # pragma: no cover - both were judged above
            continue
        scheduled.append(
            ScheduledMutation(
                mutation_id=mutation.id,
                block_id=mutation.block_id,
                block_version=pinned.version,
                effect=pinned.payload.effect,
                timing=timing,
                timing_value=timing_value,
                target=target,
            )
        )
    return tuple(scheduled)


class ScenarioMutationRuntime:
    """Read one scenario's fault schedule, and fire it into one arm as the arm runs.

    Holds the sandbox service rather than the repository because a mutation is an ordinary
    sandbox write: it goes through the same revision guard an agent's write does, so the two
    cannot produce a world only one of them believes in.
    """

    def __init__(
        self,
        scenarios: DefinitionRepository[ScenarioPayload],
        mutation_blocks: DefinitionRepository[MutationBlockPayload],
        sandboxes: SandboxService,
        events: MutationEventRepository,
        clock: Clock,
    ) -> None:
        self._scenarios = scenarios
        self._mutation_blocks = mutation_blocks
        self._sandboxes = sandboxes
        self._events = events
        self._clock = clock

    # -- reading ---------------------------------------------------------------

    def list_events(self, experiment_id: UUID) -> tuple[MutationEventRecord, ...]:
        return self._events.list_for_experiment(experiment_id)

    def issues(self, scenario_id: UUID, version: int) -> tuple[DefinitionIssue, ...]:
        """What refuses to run in this scenario version's mutations, for the setup gate."""
        scenario, templates = self._resolve(scenario_id, version)
        return mutation_issues(scenario, templates)

    def schedule(self, scenario_id: UUID, version: int) -> tuple[ScheduledMutation, ...]:
        scenario, templates = self._resolve(scenario_id, version)
        return schedule_of(scenario, templates)

    # -- firing ----------------------------------------------------------------

    def open(
        self,
        *,
        schedule: tuple[ScheduledMutation, ...],
        shop_id: UUID,
        sandbox_id: UUID,
        ordinal: int,
        attempt: int,
        fired: frozenset[str],
        read_entities: frozenset[UUID],
    ) -> ArmMutations:
        """The schedule as one arm carries it through one attempt."""
        return ArmMutations(
            schedule=schedule,
            sandboxes=self._sandboxes,
            clock=self._clock,
            shop_id=shop_id,
            sandbox_id=sandbox_id,
            ordinal=ordinal,
            attempt=attempt,
            fired=fired,
            read_entities=read_entities,
        )

    def append_all(
        self, records: tuple[MutationEventRecord, ...]
    ) -> tuple[MutationEventRecord, ...]:
        return self._events.append_all(records)

    # -- resolution ------------------------------------------------------------

    def _resolve(
        self, scenario_id: UUID, version: int
    ) -> tuple[ScenarioPayload, Mapping[UUID, PinnedTemplate]]:
        """The scenario version and the exact templates its publication pinned.

        Never the templates as they read now. A mutation block edited after the publication
        must not change when a published scenario faults, which is the whole reason
        publishing pinned a version of it (ADR 0018).
        """
        ref = VersionRef(definition=scenario_definition_id(scenario_id), version=version)
        record = self._scenarios.get_version(ref)
        if record is None:
            raise MissingReferenceVersionError(
                f"scenario {scenario_id} version {version} is not resolvable"
            )
        templates: dict[UUID, PinnedTemplate] = {}
        for reference in record.published.references:
            if reference.definition.definition_type is not DefinitionType.MUTATION_BLOCK:
                continue
            template = self._mutation_blocks.get_version(reference)
            if template is None:
                raise MissingReferenceVersionError(
                    f"mutation block {reference.definition.id} version {reference.version} "
                    "is not resolvable"
                )
            templates[reference.definition.id] = PinnedTemplate(
                payload=template.payload, version=reference.version
            )
        return record.payload, templates


class ArmMutations:
    """One arm's fault schedule during one attempt, and the firings it produced.

    Constructed per attempt and asked twice over: once before the agent is run, and again
    after each call it makes. `after_calls` on the events it produces is what places a firing
    between two of the agent's calls, so the record says the world moved *while* the agent was
    working rather than merely during the same turn.
    """

    def __init__(
        self,
        *,
        schedule: tuple[ScheduledMutation, ...],
        sandboxes: SandboxService,
        clock: Clock,
        shop_id: UUID,
        sandbox_id: UUID,
        ordinal: int,
        attempt: int,
        fired: frozenset[str],
        read_entities: frozenset[UUID],
    ) -> None:
        self._schedule = schedule
        self._sandboxes = sandboxes
        self._clock = clock
        self._shop_id = shop_id
        self._sandbox_id = sandbox_id
        self._ordinal = ordinal
        self._attempt = attempt
        self._settled = set(fired)
        self._read = set(read_entities)
        self._calls = 0
        self._events: list[MutationEvent] = []

    def fire_due(self) -> None:
        """Apply every fault whose moment has arrived and that this arm has not had yet."""
        progress = ArmProgress(ordinal=self._ordinal, read_entities=frozenset(self._read))
        for scheduled in self._schedule:
            if scheduled.mutation_id in self._settled:
                continue
            if not is_due(scheduled.timing, scheduled.target_id, progress):
                continue
            self._apply(scheduled)

    def after_call(self, tool: str, document: Mapping[str, CanonicalValue]) -> None:
        """Note what the call revealed, then fire whatever that made due.

        A read is observed from the answer rather than from the arguments, because the
        arguments are the agent's words for a thing and the answer is the thing: an order
        reached by its reference and one reached by its identifier are the same read.
        """
        self._calls += 1
        self._read.update(entities_read(tool, document))
        self.fire_due()

    @property
    def events(self) -> tuple[MutationEvent, ...]:
        """The firings this attempt produced, in the order they happened."""
        return tuple(self._events)

    def _apply(self, scheduled: ScheduledMutation) -> None:
        contract = APPLIABLE_MUTATIONS[scheduled.effect]
        record = self._sandboxes.get_sandbox(self._shop_id, self._sandbox_id)
        order_id = scheduled.target_id
        order = None if order_id is None else record.sandbox.order(order_id)
        if order is None:  # pragma: no cover - the snapshot holds every order it bound
            _logger.warning(
                "mutation %s targets an entity this arm does not hold", scheduled.mutation_id
            )
            self._settled.add(scheduled.mutation_id)
            return

        occurred_at = self._clock.now()
        try:
            changed = contract.applier(
                order.payload,
                event_id=_event_id(scheduled.mutation_id),
                occurred_at=canonical_timestamp(occurred_at),
            )
        except MutationNotApplicableError:
            # The world has already moved past this fault — an order that shipped before the
            # mutation bound to shipping it came due. Nothing is recorded: an event claiming a
            # firing that changed nothing would read, in a comparison, as a fault this arm
            # withstood. It is settled rather than retried, so one unreachable fault does not
            # cost a sandbox read per call for the rest of the run.
            _logger.info("mutation %s is not applicable to this arm's world", scheduled.mutation_id)
            self._settled.add(scheduled.mutation_id)
            return

        moved = self._sandboxes.apply_order_change(
            self._shop_id,
            self._sandbox_id,
            order.order_id,
            changed,
            expected_revision=record.revision,
        )
        self._settled.add(scheduled.mutation_id)
        self._events.append(
            _event_of(
                scheduled,
                record,
                moved,
                ordinal=self._ordinal,
                attempt=self._attempt,
                after_calls=self._calls,
            )
        )


def _event_of(
    scheduled: ScheduledMutation,
    before: SandboxRecord,
    after: SandboxRecord,
    *,
    ordinal: int,
    attempt: int,
    after_calls: int,
) -> MutationEvent:
    return MutationEvent(
        mutation_id=scheduled.mutation_id,
        block_id=scheduled.block_id,
        block_version=scheduled.block_version,
        effect=scheduled.effect,
        timing=scheduled.timing_value,
        target=scheduled.target.value,
        ordinal=ordinal,
        attempt=attempt,
        after_calls=after_calls,
        revision_before=before.revision,
        revision_after=after.revision,
        state_fingerprint=after.state_fingerprint,
    )


def _instance_issues(
    mutation: BoundMutation, template: MutationBlockPayload, path: str
) -> tuple[DefinitionIssue, ...]:
    """Whether this build can carry out this one bound instance.

    Four questions, in the order they stop being answerable: is the effect one the lab
    performs, does the template shape it into the inputs the applier needs, is the moment one
    a run can observe, and is the entity one the applier can move.
    """
    issues: list[DefinitionIssue] = []
    contract = APPLIABLE_MUTATIONS.get(template.effect)
    if contract is None:
        return (
            issue_error(
                "mutation_effect_not_appliable",
                f"{mutation.id} injects a {template.effect.value}, which this build does not "
                "apply yet, so the experiment would run without the fault its scenario "
                "describes",
                path,
            ),
        )

    timing_parameter = _sole(template.parameters, BlockParameterKind.TIMING)
    entity_parameter = _sole(template.parameters, BlockParameterKind.ENTITY_REFERENCE)
    if entity_parameter is None:
        # The publish gate already requires exactly one timing parameter (ADR 0017); a single
        # bound entity is this applier's requirement rather than the template model's, so it
        # is checked where the applier is declared.
        return (
            issue_error(
                "mutation_without_single_entity",
                f"{mutation.id} injects a {template.effect.value}, which this build applies "
                "to exactly one bound entity, and its template declares none or several",
                path,
            ),
        )
    if timing_parameter is None:  # pragma: no cover - the block publish gate requires one
        return (
            issue_error(
                "mutation_without_single_timing",
                f"{mutation.id} names no single moment to fire at",
                path,
            ),
        )

    if len(_event_id(mutation.id)) > MAX_SLUG_LENGTH:
        # A firing appends one order-history entry named after the fault, and an order's
        # event IDs are unique. A name too long to record would either be truncated into a
        # collision with another fault on the same order or refused by the domain mid-run;
        # said here, it is a finding an author can act on before anything is frozen.
        issues.append(
            issue_error(
                "mutation_id_too_long_to_record",
                f"{mutation.id} is too long to name the order-history entry its firing "
                f"appends, which is '{_EVENT_ID_PREFIX}' plus this name",
                path,
            )
        )

    bindings = mutation.binding_values
    timing = parse_timing(bindings.get(timing_parameter.name, ""))
    if timing is None or timing.kind not in APPLIABLE_TIMINGS:
        issues.append(
            issue_error(
                "mutation_timing_not_observable",
                f"{mutation.id} fires at '{bindings.get(timing_parameter.name, '')}', which "
                "this build cannot observe during a run",
                f"{path}.{timing_parameter.name}" if path else "",
            )
        )
    target = parse_entity_reference(bindings.get(entity_parameter.name, ""))
    if target is None or target.kind not in contract.entity_kinds:
        issues.append(
            issue_error(
                "mutation_entity_not_appliable",
                f"{mutation.id} moves '{bindings.get(entity_parameter.name, '')}', and a "
                f"{template.effect.value} is applied to "
                f"{', '.join(sorted(kind.value for kind in contract.entity_kinds))} only",
                f"{path}.{entity_parameter.name}" if path else "",
            )
        )
    return tuple(issues)


def _sole(
    parameters: tuple[BlockParameter, ...], kind: BlockParameterKind
) -> BlockParameter | None:
    """The one parameter of this kind, or nothing when there is not exactly one."""
    matching = [parameter for parameter in parameters if parameter.kind is kind]
    return matching[0] if len(matching) == 1 else None


def entities_read(tool: str, document: Mapping[str, CanonicalValue]) -> frozenset[UUID]:
    """Which entities a successful call let the agent see.

    Only `orders.read_order`, deliberately. A listing tells an agent an order exists; reading
    it is what puts the address, the status, and the history in front of the agent, and
    "after the first read" is a fault about what the agent has seen.
    """
    if tool != ORDER_DETAIL or document.get("outcome") != ToolOutcome.SUCCESS.value:
        return frozenset()
    data = document.get("data")
    if not isinstance(data, dict):  # pragma: no cover - a successful result carries its data
        return frozenset()
    identifier = data.get("order_id")
    if not isinstance(identifier, str):  # pragma: no cover - an order always names itself
        return frozenset()
    try:
        return frozenset({UUID(identifier)})
    except ValueError:  # pragma: no cover - the view writes a UUID
        return frozenset()


def _event_id(mutation_id: str) -> str:
    """The order-history entry a firing appends, named after the fault that caused it.

    Never truncated. An order's event IDs are unique, so two faults whose names survived
    truncation identically would make the second firing raise inside the domain — a crash
    rather than a finding. The setup gate refuses a name that cannot carry its own entry, so
    what arrives here always fits.
    """
    return f"{_EVENT_ID_PREFIX}{mutation_id}"
