"""Starting one experiment: two arms of one incident, and the turns that drive them.

Everything this needs already exists. A published scenario version is a recipe (ADR 0018),
materializing it is canonical starting state (ADR 0019), cloning it is one arm's own world
(ADR 0020), and a published agent configuration is what an arm runs (ADR 0024). What was
missing is the record that holds them together — and, until now, the caller that gives
`resolve_experiment_inputs` a reason to exist. ADR 0012 wrote that resolution before there
was anything to resolve for; this module is the thing it was written for.

Four decisions shape it.

**Starting is composed, never re-implemented.** `start` materializes through
`SandboxSnapshotService` and clones through `SandboxService` rather than writing its own
freeze and copy. Both already carry rules an experiment must not be able to sidestep — the
publish gate re-run against today's orders, the fingerprint that identifies a snapshot, the
per-arm row that *is* the isolation.

**Both arms open with the scenario's trigger, not with a driver's.** The pinned ticket
carries the first message every arm receives (ADR 0016). It is recorded as each run's turn
zero with a source of its own, before any driver is consulted, so "the arms started from the
same question" is a property of the starting state rather than of a driver behaving.

**The gate reaches outside the payload, and it runs twice.** `preview` and `start` share one
rule set, the way `SandboxSnapshotService` shares the authoring gate with the publication it
re-judges. It answers the check ADR 0024 deferred to here — a tone-of-voice override is
resolved against the shop the scenario pinned, which is the first moment a target shop
exists — and it counts the dimensions along which the arms differ, because an experiment
with two differences measures neither of them.

**A turn is delivered per arm, and the composition that produced it is recorded.** The
operator writes once and chooses which arms receive it; the arms that received one
composition share its `turn_id`. That is the divergence evidence, and it is written at
delivery because nothing later can reconstruct whether two identical sentences were one
decision or two.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime
from typing import Protocol, cast
from uuid import UUID, uuid4

from capability_lab.application.agent_configurations import (
    AgentConfigurationVersionNotFoundError,
)
from capability_lab.application.agent_turns import (
    AgentTurnRecord,
    AgentTurnRepository,
    ToolEventRecord,
    ToolEventRepository,
)
from capability_lab.application.canonical_document import DocumentReader
from capability_lab.application.canonical_json import CanonicalValue
from capability_lab.application.definition_authoring import (
    DefinitionRepository,
    DefinitionVersionRecord,
)
from capability_lab.application.definition_resolution import (
    ConflictingReferenceVersionsError,
    DefinitionResolutionError,
    ExperimentResolution,
    MissingReferenceVersionError,
    PublishedVersionReader,
    ResolvedDefinition,
    resolve_experiment_inputs,
)
from capability_lab.application.experiment_document import (
    ExperimentDocument,
    experiment_from_document,
    fingerprint_experiment,
)
from capability_lab.application.mutation_events import MutationEventRecord
from capability_lab.application.participants import (
    ParticipantDriver,
    ParticipantRequest,
)
from capability_lab.application.ports import Clock
from capability_lab.application.run_metrics import ArmMetrics, arm_metrics
from capability_lab.application.sandbox_materialization import (
    SANDBOX_TOOL_CONTRACT_VERSIONS,
    SandboxSnapshotRecord,
    SandboxSnapshotService,
)
from capability_lab.application.sandboxes import SandboxRecord, SandboxService
from capability_lab.application.scenario_mutations import ScenarioMutationRuntime
from capability_lab.application.scenarios import (
    ScenarioVersionNotFoundError,
    scenario_definition_id,
)
from capability_lab.application.state_diff import ArmStateDiff, arm_state_diff
from capability_lab.domain.agent_configuration import (
    AgentConfigurationPayload,
    ToneOfVoiceSource,
)
from capability_lab.domain.content import require_label
from capability_lab.domain.definitions import (
    DefinitionId,
    DefinitionIssue,
    DefinitionType,
    DefinitionValidation,
    PublishedDefinitionVersion,
    VersionRef,
    issue_error,
    issue_warning,
    validation_of,
)
from capability_lab.domain.experiment import (
    ArmStanding,
    ComparedArm,
    ComparisonDimension,
    ComparisonVariable,
    DerivationKind,
    ExperimentConfigurationError,
    ParticipantDriverType,
    ParticipantTurn,
    ParticipantTurnSource,
    compare_configurations,
    derivation_variables,
    stand_arm,
)
from capability_lab.domain.sandbox import SandboxState
from capability_lab.domain.scenario import ScenarioPayload
from capability_lab.domain.shop import ShopPayload
from capability_lab.domain.ticket import TicketPayload

__all__ = [
    "ArmRuntime",
    "ArmSelection",
    "ExperimentCompletedError",
    "ExperimentDerivation",
    "ExperimentDerivationRepository",
    "ExperimentDetail",
    "ExperimentLabelError",
    "ExperimentNotFoundError",
    "ExperimentNotStartableError",
    "ExperimentOrigin",
    "ExperimentPreview",
    "ExperimentRecord",
    "ExperimentRepository",
    "ExperimentRunNotFoundError",
    "ExperimentRunRepository",
    "ExperimentService",
    "ParticipantDriverMismatchError",
    "ParticipantTurnRecord",
    "ParticipantTurnRepository",
    "RunRecord",
    "StartExperiment",
]

# Arm labels when the operator does not name them. The arm's position is what a comparison
# refers to ("arm A resolved the order, arm B never read the policy"), so the default is the
# position rather than the configuration's name, which two arms are allowed to share.
ARM_LABELS = ("Arm A", "Arm B")
MAX_ARMS = len(ARM_LABELS)


class ExperimentNotFoundError(DefinitionResolutionError):
    """Raised when an experiment identifier names nothing in this shop."""


class ExperimentRunNotFoundError(DefinitionResolutionError):
    """Raised when a run identifier names no arm of this experiment."""


class ExperimentLabelError(DefinitionResolutionError):
    """Raised when an experiment is started without a name an operator can find it by."""


class ExperimentArmError(DefinitionResolutionError):
    """Raised when the arms an experiment was asked for cannot be run against each other."""


class ParticipantDriverMismatchError(DefinitionResolutionError):
    """Raised when a turn is delivered by a driver the experiment did not record.

    The participant driver is a recorded input, not a per-message choice: a run half typed
    by a person and half generated by a simulator would carry one label for two things.
    """


class ExperimentCompletedError(DefinitionResolutionError):
    """Raised when an arm that has reached its scenario's turn cap is driven again.

    The cap is what guarantees a run terminates (ADR 0012), so it has to refuse rather than
    warn: an arm allowed one turn past it would be answering a longer conversation than the
    arm beside it, and the two would no longer be comparable.
    """


class ExperimentNotStartableError(DefinitionResolutionError):
    """Raised when the setup gate refuses the experiment it was asked to start."""

    def __init__(self, validation: DefinitionValidation) -> None:
        super().__init__("this experiment cannot be started")
        self.validation = validation


@dataclass(frozen=True, slots=True)
class ArmSelection:
    """One arm as the operator chose it: an exact published configuration version."""

    configuration_id: UUID
    version: int
    label: str = ""


@dataclass(frozen=True, slots=True)
class StartExperiment:
    """Everything an operator settles before an experiment exists."""

    label: str
    scenario_id: UUID
    scenario_version: int
    seed: int
    arms: tuple[ArmSelection, ...]
    participant_driver: ParticipantDriverType = ParticipantDriverType.HUMAN


@dataclass(frozen=True, slots=True)
class ExperimentRecord:
    """One immutable experiment: its provenance columns and the document behind them.

    The document is authoritative for the resolved inputs, exactly as a snapshot's is for
    its starting state. The columns beside it exist so a shop's experiments can be listed
    and recognized, never as a second source of truth.
    """

    experiment_id: UUID
    shop_id: UUID
    label: str
    scenario_id: UUID
    scenario_version: int
    seed: int
    snapshot_id: UUID
    sandbox_fingerprint: str
    resolution_fingerprint: str
    participant_driver: ParticipantDriverType
    document: dict[str, CanonicalValue]
    created_at: datetime

    def content(self, sandbox_inputs: tuple[ResolvedDefinition, ...]) -> ExperimentDocument:
        """The stored envelope decoded, with the shared pins supplied from the snapshot."""
        return experiment_from_document(self.document, sandbox_inputs=sandbox_inputs)

    @property
    def canonical_schema_version(self) -> str:
        """The schema token this row's own document carries.

        Read out of the document rather than from the build's constant, because the document
        is what was fingerprinted. The day an `experiment-v2` exists, every experiment frozen
        before it must keep saying `experiment-v1` — a row that reported the running build's
        token would claim to be a document it is not.
        """
        return DocumentReader(self.document, "experiment").text("canonical_schema_version")


@dataclass(frozen=True, slots=True)
class RunRecord:
    """One arm of one experiment: the configuration it runs and the sandbox it works in."""

    run_id: UUID
    experiment_id: UUID
    shop_id: UUID
    position: int
    label: str
    agent_configuration_id: UUID
    agent_configuration_version: int
    sandbox_id: UUID
    created_at: datetime
    model_base_url: str | None = None
    """The endpoint this arm reached, written on the first advance that reached one.

    `None` means no provider was reached, which is the honest record for the deterministic
    control and for every row written before the lab knew where it was pointed — a results
    surface renders it as *endpoint not recorded* and deliberately not as *offline*, because
    the two are different facts and only one of them is known (ADR 0052).

    Last and defaulted, because an arm is created without one: it is the only field of this
    record a run acquires after it is written.
    """


@dataclass(frozen=True, slots=True)
class ParticipantTurnRecord:
    """One customer turn as one run received it, with when it arrived."""

    run_id: UUID
    experiment_id: UUID
    turn: ParticipantTurn
    created_at: datetime


class ExperimentRepository(Protocol):
    """Immutable storage: an experiment is written once and never updated."""

    def get(self, shop_id: UUID, experiment_id: UUID) -> ExperimentRecord | None: ...

    def list_for_shop(self, shop_id: UUID) -> tuple[ExperimentRecord, ...]: ...

    def list_all(self) -> tuple[ExperimentRecord, ...]:
        """Every experiment this lab has run, newest first, across every shop.

        Beside `list_for_shop` rather than replacing it: the bench asks what has been run
        *here* and history asks what has been run at all, and a caller that had to filter a
        whole lab down to one shop would be doing in Python what the index already does.
        """
        ...

    def save(self, record: ExperimentRecord) -> ExperimentRecord: ...


class ExperimentRunRepository(Protocol):
    """One row per arm, the way one sandbox row per arm is the isolation (ADR 0020)."""

    def list_for_experiment(self, experiment_id: UUID) -> tuple[RunRecord, ...]: ...

    def save(self, record: RunRecord) -> RunRecord: ...

    def pin_endpoint(self, run_id: UUID, base_url: str) -> str:
        """Record the endpoint this arm reached if it has none, and answer with the one in force.

        The one update this otherwise append-only table takes, and it is written to be safe to
        repeat and safe to race. Idempotent: an arm advanced ten times against one endpoint
        pins it once and reads the same value back every time. Concurrency-safe: the write
        applies only where nothing is pinned yet, so two advances that reached different
        endpoints cannot both win — the loser reads the winner's value and the caller refuses
        the advance rather than writing half an arm against each (ADR 0052).

        Answering with the pinned value rather than with a boolean is what makes that refusal
        possible to write correctly: the caller compares what it reached with what stands,
        and there is no window between the two where the answer could change.
        """
        ...


class ParticipantTurnRepository(Protocol):
    """Append-only per run; the ordinal is unique inside one run and never rewritten."""

    def list_for_experiment(self, experiment_id: UUID) -> tuple[ParticipantTurnRecord, ...]: ...

    def append(self, record: ParticipantTurnRecord) -> ParticipantTurnRecord: ...


@dataclass(frozen=True, slots=True)
class ExperimentDerivation:
    """That one experiment was derived from another, in which way, and when.

    Stored beside the experiments rather than inside either of them, for the reason a note
    is (ADR 0036): `experiments` is written once because its document is what explains the
    result, and a derived run's source is not one of its inputs — the derived run would run
    identically without knowing where it came from. Putting it in the envelope would also put
    a runtime identifier into fingerprinted bytes, which ADR 0012 keeps out of them.

    One record for both derivations rather than one per operation. A replay and a fork write
    the same three facts and are read by the same three surfaces; what differs is the word a
    reader has to be shown, so the word is a column (ADR 0039).
    """

    experiment_id: UUID
    source_experiment_id: UUID
    kind: DerivationKind
    created_at: datetime


@dataclass(frozen=True, slots=True)
class ExperimentOrigin:
    """The experiment a derived one came from, as a reader needs to name it.

    The label is read from the source row rather than copied at derivation time: an
    experiment is written once, so the name it was started under cannot drift, and a copy
    here would be a second source of truth for a string that has one.
    """

    experiment_id: UUID
    label: str
    kind: DerivationKind
    changed: tuple[ComparisonDimension, ...]
    """The dimensions this derivation moved from its source, and empty for a replay.

    A reading rather than a stored column, like everything else on the detail beside it: both
    experiments are written once and their arms are pinned by content, so the answer cannot
    drift, and a copy taken at derivation time would be a second source of truth for
    something the two records already say. It is what makes a fork's claim checkable — the
    thing it changed is the only thing that changed — and it is what says out loud when that
    claim does not hold (ADR 0039)."""


class ExperimentDerivationRepository(Protocol):
    """Which experiments were derived from which, written once per derivation.

    Two methods and no listing. History reads a derived row's origin through the same
    `get_experiment` it projects every other column from, so a batch read would be a second
    way to answer a question one already answers — and the annotation repository's `list_all`
    exists because an annotation is *not* on the run, which is the difference.
    """

    def get(self, experiment_id: UUID) -> ExperimentDerivation | None: ...

    def save(self, record: ExperimentDerivation) -> ExperimentDerivation: ...


@dataclass(frozen=True, slots=True)
class ExperimentPreview:
    """What starting this experiment would produce, and what still refuses it."""

    validation: DefinitionValidation
    comparison: tuple[ComparisonVariable, ...]
    arm_labels: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class ArmRuntime:
    """What one arm runs, read from the exact configuration version it pinned.

    Alongside the comparison matrix rather than inside it: the matrix answers "do these arms
    differ here", which is a question about the pair, while this answers "what does this arm
    run", which a client needs for one arm on its own — to label it, and to say which
    project-owned adapter produced its turns (ADR 0027).
    """

    run_id: UUID
    configuration_name: str
    framework_id: str
    provider: str
    model_id: str


@dataclass(frozen=True, slots=True)
class ExperimentDetail:
    """One experiment in full: its record, its arms, and both sides of their threads.

    The customer turns and the agent's answers are read together rather than through two
    operations: an arm's thread is one thing, and a client that had to stitch two listings
    together could render an answer beside a question it does not belong to.

    `standings` is that same pair read once more, as the one thing an operator opening this
    experiment cold needs before anything else: what each arm is waiting for. It travels
    beside the streams rather than being left to the client, because the runner reads the
    identical rule to decide what an advance does (ADR 0029).

    `metrics` is the third such reading, and the only one that is about the run rather than
    about the incident: what each arm has spent so far. It travels here for the reason the
    standing does — it is a projection of the same streams, and a client that counted them
    again would be free to count them differently (ADR 0032).

    `scenario` and `starting_state` are what the whole record is judged against: the recipe
    version the snapshot pinned — which says how many turns an arm may take and what
    objectives it is measured by — and the state every arm was cloned from, which is what a
    change in one arm's sandbox is a change *from* (ADR 0030). Both are resolved once here
    because everything downstream reads them together.

    `state_diffs` is that last sentence made literal: each arm read against the starting
    state beside it, field by field. It travels with the standing and the metrics because it
    is the same kind of reading — a projection of documents already resolved here — and
    because a client holding both states would otherwise be free to decide for itself what
    "changed" means (ADR 0035).

    `derived_from` is the one field here that is neither an input nor a reading of the run:
    it is where this experiment came from, and it is `None` for every experiment an operator
    started themselves. It travels on the detail rather than through an operation of its own
    — unlike the annotation, which ADR 0036 kept off the run — because it is a nullable
    identifier rather than text, and because a derived run that did not say what it derives
    from would be exactly the provenance this outcome is named for (ADR 0038, ADR 0039).
    """

    record: ExperimentRecord
    resolution: ExperimentResolution
    scenario: DefinitionVersionRecord[ScenarioPayload]
    starting_state: SandboxState
    comparison: tuple[ComparisonVariable, ...]
    arm_runtimes: tuple[ArmRuntime, ...]
    standings: tuple[ArmStanding, ...]
    metrics: tuple[ArmMetrics, ...]
    state_diffs: tuple[ArmStateDiff, ...]
    derived_from: ExperimentOrigin | None
    runs: tuple[RunRecord, ...]
    sandboxes: tuple[SandboxRecord, ...]
    turns: tuple[ParticipantTurnRecord, ...]
    agent_turns: tuple[AgentTurnRecord, ...]
    tool_events: tuple[ToolEventRecord, ...]
    mutation_events: tuple[MutationEventRecord, ...]


class ExperimentService:
    """Start experiments, read them back, and deliver the customer turns that drive them."""

    def __init__(
        self,
        experiments: ExperimentRepository,
        runs: ExperimentRunRepository,
        turns: ParticipantTurnRepository,
        agent_turns: AgentTurnRepository,
        tool_events: ToolEventRepository,
        derivations: ExperimentDerivationRepository,
        snapshots: SandboxSnapshotService,
        sandboxes: SandboxService,
        scenarios: DefinitionRepository[ScenarioPayload],
        shops: DefinitionRepository[ShopPayload],
        tickets: DefinitionRepository[TicketPayload],
        configurations: DefinitionRepository[AgentConfigurationPayload],
        mutations: ScenarioMutationRuntime,
        published_versions: PublishedVersionReader,
        clock: Clock,
    ) -> None:
        self._experiments = experiments
        self._runs = runs
        self._turns = turns
        self._agent_turns = agent_turns
        self._tool_events = tool_events
        self._derivations = derivations
        self._snapshots = snapshots
        self._sandboxes = sandboxes
        self._scenarios = scenarios
        self._shops = shops
        self._tickets = tickets
        self._configurations = configurations
        self._mutations = mutations
        self._published_versions = published_versions
        self._clock = clock

    # -- reading ---------------------------------------------------------------

    def list_experiments(self, shop_id: UUID) -> tuple[ExperimentRecord, ...]:
        return self._experiments.list_for_shop(shop_id)

    def get_experiment(self, shop_id: UUID, experiment_id: UUID) -> ExperimentDetail:
        record = self._experiments.get(shop_id, experiment_id)
        if record is None:
            raise ExperimentNotFoundError(f"experiment {experiment_id} is not in shop {shop_id}")
        snapshot = self._snapshots.get_snapshot(shop_id, record.snapshot_id)
        runs = self._runs.list_for_experiment(experiment_id)
        # Resolved once and read twice: the matrix compares the arms, and each arm's own
        # framework and model label it.
        arms = tuple(self._run_arm(run) for run in runs)
        payloads = tuple(arm.payload for arm in arms)
        turns = self._turns.list_for_experiment(experiment_id)
        agent_turns = self._agent_turns.list_for_experiment(experiment_id)
        tool_events = self._tool_events.list_for_experiment(experiment_id)
        # The version the snapshot pinned rather than the scenario as it reads now: an arm
        # stands against the cap its own experiment was started under, and an evaluation
        # judges it against the objectives that experiment froze (ADR 0030).
        scenario = self._pinned(snapshot, DefinitionType.SCENARIO, self._scenarios)
        # Read once and paired to their arms by position, exactly as the standings and the
        # metrics are. The starting state is the snapshot's rather than anything stored per
        # arm, so both arms' diffs are differences from one common world (ADR 0035).
        sandboxes = tuple(self._sandboxes.get_sandbox(shop_id, run.sandbox_id) for run in runs)
        return ExperimentDetail(
            record=record,
            resolution=record.content(snapshot.content.pins).resolution,
            scenario=scenario,
            starting_state=snapshot.content.state,
            comparison=compare_configurations(tuple(arm.compared for arm in arms)),
            arm_runtimes=tuple(
                ArmRuntime(
                    run_id=run.run_id,
                    # The name the version this arm pinned was published under, never the
                    # one the configuration answers to now: a configuration renamed after a
                    # run would otherwise rename what that run says it ran.
                    configuration_name=payload.name,
                    framework_id=payload.framework_id,
                    # The provider beside the model because a rate is declared for the pair
                    # (`model_cost`): two providers can serve one model name, and a cost
                    # read against the wrong one would be a number nobody could check.
                    provider=payload.model.provider,
                    model_id=payload.model.model_id,
                )
                for run, payload in zip(runs, payloads, strict=True)
            ),
            standings=tuple(
                _standing(run, turns, agent_turns, scenario.payload.completion.max_turns)
                for run in runs
            ),
            metrics=tuple(
                _metrics(run, turns, agent_turns, tool_events, payload)
                for run, payload in zip(runs, payloads, strict=True)
            ),
            state_diffs=tuple(
                arm_state_diff(
                    run.run_id, before=snapshot.content.state, after=sandbox.content.state
                )
                for run, sandbox in zip(runs, sandboxes, strict=True)
            ),
            derived_from=self._origin(shop_id, experiment_id, runs, arms),
            runs=runs,
            sandboxes=sandboxes,
            turns=turns,
            agent_turns=agent_turns,
            tool_events=tool_events,
            mutation_events=self._mutations.list_events(experiment_id),
        )

    # -- the setup gate --------------------------------------------------------

    def preview(self, shop_id: UUID, command: StartExperiment) -> ExperimentPreview:
        """Judge an experiment without starting it, with the rules `start` applies.

        Deliberately materializes nothing. An operator comparing two configurations before
        committing must not be freezing starting state on every keystroke, and the two
        answers the setup screen needs — what differs, and what refuses — are both
        answerable from the published versions alone.
        """
        arms = self._selected(command)
        return ExperimentPreview(
            validation=self._gate(shop_id, command, arms).validation,
            comparison=compare_configurations(tuple(arm.compared for arm in arms)),
            arm_labels=_arm_labels(command),
        )

    # -- starting --------------------------------------------------------------

    def start(
        self, shop_id: UUID, command: StartExperiment, *, starting_state: UUID | None = None
    ) -> ExperimentDetail:
        """Freeze the starting state, clone one arm per configuration, and open the thread.

        Deliberately not idempotent, for the reason cloning is not (ADR 0020): the same
        scenario run twice is two experiments, and collapsing them would delete the second
        result rather than reuse the first.

        `starting_state` names a snapshot to clone instead of freezing today's world, and
        exists for exactly one caller: a replay, which has to start in the world its source
        started in (ADR 0038). Materializing again would re-copy the shop's order fixtures
        as they read now and re-run the publish gate against them, so an order edited or
        deleted since would silently make the derived run a different experiment — or refuse
        it outright. A snapshot is immutable and identified by its fingerprint (ADR 0019), so
        cloning the recorded one is the only way to claim the same starting state.
        """
        try:
            require_label(command.label, "experiment label", error=ExperimentConfigurationError)
        except ExperimentConfigurationError as error:
            raise ExperimentLabelError(str(error)) from error

        arms = self._selected(command)
        judged = self._gate(shop_id, command, arms)
        if judged.validation.errors or judged.resolution is None:
            raise ExperimentNotStartableError(judged.validation)

        snapshot = (
            self._snapshots.materialize(
                shop_id, command.scenario_id, command.scenario_version, seed=command.seed
            )
            if starting_state is None
            else self._recorded_state(shop_id, starting_state, command)
        )
        resolution = judged.resolution
        comparison = compare_configurations(tuple(arm.compared for arm in arms))
        fingerprint = fingerprint_experiment(
            resolution,
            sandbox_fingerprint=snapshot.sandbox_fingerprint,
            comparison_variables=tuple(
                variable.dimension for variable in comparison if variable.differs
            ),
        )

        now = self._clock.now()
        experiment_id = uuid4()
        record = self._experiments.save(
            ExperimentRecord(
                experiment_id=experiment_id,
                shop_id=shop_id,
                label=command.label,
                scenario_id=command.scenario_id,
                scenario_version=command.scenario_version,
                seed=command.seed,
                snapshot_id=snapshot.snapshot_id,
                sandbox_fingerprint=snapshot.sandbox_fingerprint,
                resolution_fingerprint=fingerprint.resolution_fingerprint,
                participant_driver=command.participant_driver,
                document=_document_of(fingerprint.canonical_json),
                created_at=now,
            )
        )

        labels = _arm_labels(command)
        runs = tuple(
            self._runs.save(
                RunRecord(
                    run_id=uuid4(),
                    experiment_id=experiment_id,
                    shop_id=shop_id,
                    position=position,
                    label=labels[position],
                    agent_configuration_id=arm.selection.configuration_id,
                    agent_configuration_version=arm.selection.version,
                    # Every arm is a clone of the one snapshot, which is what makes the two
                    # provably equal at the start and independent afterwards.
                    sandbox_id=self._sandboxes.clone(
                        shop_id, snapshot.snapshot_id, labels[position]
                    ).sandbox_id,
                    created_at=now,
                )
            )
            for position, arm in enumerate(arms)
        )

        self._open(record, runs, snapshot)
        return self.get_experiment(shop_id, experiment_id)

    def _recorded_state(
        self, shop_id: UUID, snapshot_id: UUID, command: StartExperiment
    ) -> SandboxSnapshotRecord:
        """The snapshot a derived experiment starts in, checked against what it claims.

        The columns are compared rather than trusted because they are what the experiment
        row will carry: a snapshot of another recipe, version, or seed would produce an
        experiment whose provenance columns describe starting state it is not in, and the
        fingerprint beside them could not be used to tell.

        The tool contract set is checked for a stronger reason. It is part of the sandbox
        fingerprint (ADR 0021) precisely so that a build publishing a newer contract counts
        as different starting state — but a *reused* snapshot is not re-fingerprinted, while
        the `experiment-v1` envelope beside it records the versions this build publishes and
        the runtime runs this build's handlers. So a snapshot frozen against a tool set this
        build no longer publishes would produce the one record in the lab whose two
        fingerprints disagree about which tools ran. Materializing cannot produce that pair,
        because it stamps both from the same resolution; only reuse can, so only reuse has to
        refuse it.
        """
        snapshot = self._snapshots.get_snapshot(shop_id, snapshot_id)
        if (
            snapshot.scenario_id != command.scenario_id
            or snapshot.scenario_version != command.scenario_version
            or snapshot.seed != command.seed
        ):
            raise ExperimentConfigurationError(
                f"snapshot {snapshot_id} does not freeze scenario {command.scenario_id} "
                f"version {command.scenario_version} at seed {command.seed}"
            )
        published = tuple(sorted(SANDBOX_TOOL_CONTRACT_VERSIONS.items()))
        if snapshot.content.tool_contracts != published:
            raise ExperimentConfigurationError(
                f"snapshot {snapshot_id} was frozen against a tool contract set this build "
                "no longer publishes, so it cannot be reused as starting state"
            )
        return snapshot

    # -- driving ---------------------------------------------------------------

    def deliver_turn(
        self,
        shop_id: UUID,
        experiment_id: UUID,
        run_ids: tuple[UUID, ...],
        driver: ParticipantDriver,
    ) -> tuple[ParticipantTurnRecord, ...]:
        """Ask the driver for one turn per named arm and record what it answered.

        One call is one composition, however many arms it reaches, so every turn it writes
        shares a `turn_id`. Two calls are two compositions even when the words match — which
        is exactly the case a comparison must be able to tell apart.
        """
        record = self._experiments.get(shop_id, experiment_id)
        if record is None:
            raise ExperimentNotFoundError(f"experiment {experiment_id} is not in shop {shop_id}")
        if driver.driver_type is not record.participant_driver:
            raise ParticipantDriverMismatchError(
                f"this experiment is driven by its {record.participant_driver} participant, "
                f"not by a {driver.driver_type} one"
            )

        runs = {run.run_id: run for run in self._runs.list_for_experiment(experiment_id)}
        targets: list[RunRecord] = []
        for run_id in run_ids:
            run = runs.get(run_id)
            if run is None:
                raise ExperimentRunNotFoundError(
                    f"run {run_id} is not an arm of experiment {experiment_id}"
                )
            if run not in targets:
                targets.append(run)
        if not targets:
            raise ExperimentRunNotFoundError("name at least one arm to deliver this turn to")

        history = self._turns.list_for_experiment(experiment_id)
        # Every named arm is judged before any of them is written, so a composition that one
        # arm cannot receive is refused whole rather than delivered by halves.
        max_turns = self._cap(shop_id, record)
        for run in targets:
            if len(_thread(history, run)) > max_turns:
                # What is counted is turns *received*: an arm holding its last allowed turn
                # is closed to another one whether or not it has answered that one yet, and a
                # message claiming it answered would be a claim about the agent.
                raise ExperimentCompletedError(
                    f"{run.label} has received the {max_turns} turns this scenario allows"
                )
        turn_id = uuid4()
        now = self._clock.now()
        delivered: list[ParticipantTurnRecord] = []
        for run in targets:
            seen = _thread(history, run)
            body = driver.next_turn(
                ParticipantRequest(
                    run_id=run.run_id,
                    arm_label=run.label,
                    driver=record.participant_driver,
                    turns=seen,
                )
            )
            delivered.append(
                self._turns.append(
                    ParticipantTurnRecord(
                        run_id=run.run_id,
                        experiment_id=experiment_id,
                        turn=ParticipantTurn(
                            turn_id=turn_id,
                            # The next position in *this* arm. Arms are allowed to be at
                            # different depths — one may have been driven twice while the
                            # other waited — so the ordinal is per run and never shared.
                            ordinal=len(seen),
                            source=ParticipantTurnSource.PARTICIPANT,
                            driver=record.participant_driver,
                            body=body,
                        ),
                        created_at=now,
                    )
                )
            )
        return tuple(delivered)

    # -- internals -------------------------------------------------------------

    def _open(
        self,
        record: ExperimentRecord,
        runs: tuple[RunRecord, ...],
        snapshot: SandboxSnapshotRecord,
    ) -> None:
        """Write the scenario's triggering message into every arm as turn zero.

        One `turn_id` across the arms, because it *is* one composition — the author's, made
        once when the ticket was published. Recording it per arm rather than once on the
        experiment is what lets a later reading of one arm be a complete thread.
        """
        trigger = self._trigger(snapshot)
        turn_id = uuid4()
        for run in runs:
            self._turns.append(
                ParticipantTurnRecord(
                    run_id=run.run_id,
                    experiment_id=record.experiment_id,
                    turn=ParticipantTurn(
                        turn_id=turn_id,
                        ordinal=0,
                        source=ParticipantTurnSource.TRIGGER,
                        driver=None,
                        body=trigger,
                    ),
                    created_at=record.created_at,
                )
            )

    def _origin(
        self,
        shop_id: UUID,
        experiment_id: UUID,
        runs: tuple[RunRecord, ...],
        arms: tuple[_SelectedArm, ...],
    ) -> ExperimentOrigin | None:
        """The experiment this one came from, named by the row it was derived through.

        A missing source is reported as no origin rather than raised: experiments are
        write-once and never deleted, so this cannot happen in a lab that has one store,
        and a read of an experiment must not fail because a *different* experiment could not
        be found.
        """
        derivation = self._derivations.get(experiment_id)
        if derivation is None:
            return None
        source = self._experiments.get(shop_id, derivation.source_experiment_id)
        if source is None:  # pragma: no cover - an experiment is never deleted
            return None
        return ExperimentOrigin(
            experiment_id=source.experiment_id,
            label=source.label,
            kind=derivation.kind,
            changed=self._moved(source.experiment_id, runs, arms),
        )

    def _moved(
        self,
        source_experiment_id: UUID,
        runs: tuple[RunRecord, ...],
        arms: tuple[_SelectedArm, ...],
    ) -> tuple[ComparisonDimension, ...]:
        """What this derivation changed about the arms, read against the run it came from.

        The pins are compared first and the payloads only for the arms whose pins differ.
        That makes a replay free — it pins every arm to the exact version its source ran, so
        there is nothing to resolve — and it is also the honest test: a fork is a fork
        because the operator asked for different published content, whether or not the two
        versions turn out to compare equal along every dimension this lab reads.
        """
        source_runs = self._runs.list_for_experiment(source_experiment_id)
        if len(source_runs) != len(runs):  # pragma: no cover - a derivation keeps the arms
            return ()
        return derivation_variables(
            tuple(
                (self._run_arm(before).compared, after.compared)
                for before, run, after in zip(source_runs, runs, arms, strict=True)
                if (before.agent_configuration_id, before.agent_configuration_version)
                != (run.agent_configuration_id, run.agent_configuration_version)
            )
        )

    def _trigger(self, snapshot: SandboxSnapshotRecord) -> str:
        ticket = self._pinned(snapshot, DefinitionType.TICKET, self._tickets).payload
        if ticket.trigger is None:  # pragma: no cover - the publish gate refuses this
            raise MissingReferenceVersionError(
                "the ticket this snapshot pinned carries no triggering message"
            )
        return ticket.trigger.body

    def _gate(
        self, shop_id: UUID, command: StartExperiment, arms: tuple[_SelectedArm, ...]
    ) -> _Judged:
        """Everything that refuses an experiment before it has a snapshot.

        Only the questions the surrounding world answers. Whether the scenario version can
        be frozen at all is `SandboxSnapshotService`'s gate, re-run against today's orders
        (ADR 0019), and is deliberately not restated here: two copies of that rule set would
        be two chances to disagree about the same starting state.

        The resolution it computes travels back with the findings rather than being redone by
        `start`. Resolving is what discovers a closure that disagrees with itself, so an
        operator has to be able to read that in the preview instead of meeting it only once
        they commit — and computing it twice would be two chances to disagree about the pins.
        """
        scenario = self._scenario_version(shop_id, command)
        shop = self._pinned_shop(scenario)
        resolution, resolution_issues = self._resolution(command, arms)
        return _Judged(
            validation=validation_of(
                [
                    *self._tone_issues(shop, arms),
                    # Whether the lab can actually carry out the faults this recipe composes
                    # (ADR 0028). A publishing author may compose one no build injects yet;
                    # an experiment that started with it would produce evidence reading
                    # "the fault changed nothing", which is the one thing it must not mean.
                    *self._mutations.issues(command.scenario_id, command.scenario_version),
                    *_comparison_issues(arms),
                    *resolution_issues,
                ]
            ),
            resolution=resolution,
        )

    def _tone_issues(
        self, shop: ShopPayload, arms: tuple[_SelectedArm, ...]
    ) -> tuple[DefinitionIssue, ...]:
        """Resolve each arm's tone-of-voice override against the shop the scenario pinned.

        The check ADR 0024 deferred to experiment setup, arriving where it said it would. A
        configuration is shop-independent, so the publish gate could only warn that the
        override names a guideline nobody had chosen a shop for yet; here the shop is known,
        and an override it does not publish is an error rather than a warning — the arm
        would run in a tone the target shop never authored.
        """
        published = frozenset(guideline.id for guideline in shop.tone_of_voice_guidelines)
        return tuple(
            issue_error(
                "tone_override_unknown_in_shop",
                f"{arm.payload.name} writes in tone-of-voice guideline "
                f"'{arm.payload.tone_of_voice.guideline_id}', which this scenario's shop "
                "does not publish",
                f"arms[{position}].tone_of_voice",
            )
            for position, arm in enumerate(arms)
            if arm.payload.tone_of_voice.source is ToneOfVoiceSource.OVERRIDE
            and arm.payload.tone_of_voice.guideline_id not in published
        )

    def _resolution(
        self, command: StartExperiment, arms: tuple[_SelectedArm, ...]
    ) -> tuple[ExperimentResolution | None, tuple[DefinitionIssue, ...]]:
        """Resolve every pin the experiment would freeze, or say why it cannot.

        Reads published versions and materializes nothing, which is what lets the preview run
        it too.
        """
        try:
            return (
                resolve_experiment_inputs(
                    self._published_versions,
                    scenario=VersionRef(
                        definition=scenario_definition_id(command.scenario_id),
                        version=command.scenario_version,
                    ),
                    agent_configurations=tuple(arm.ref for arm in arms),
                    seed=command.seed,
                    tool_contract_versions=SANDBOX_TOOL_CONTRACT_VERSIONS,
                    participant_driver=command.participant_driver,
                ),
                (),
            )
        except ConflictingReferenceVersionsError as error:
            # The same closure disagreement a snapshot reports as a finding, reaching an
            # experiment through its arms instead. A finding rather than an exception for the
            # reason ADR 0019 gave: starting again cannot fix it, so the author has to read it
            # beside everything else that refuses this setup. `str(error)` already names the
            # definition and both versions.
            return None, (issue_error("experiment_conflicting_pin", str(error), "definitions"),)

    def _selected(self, command: StartExperiment) -> tuple[_SelectedArm, ...]:
        if not 1 <= len(command.arms) <= MAX_ARMS:
            raise ExperimentArmError(
                f"an experiment runs one or {MAX_ARMS} arms, not {len(command.arms)}"
            )
        return tuple(self._arm(selection) for selection in command.arms)

    def _arm(self, selection: ArmSelection) -> _SelectedArm:
        ref = VersionRef(
            definition=DefinitionId(
                definition_type=DefinitionType.AGENT_CONFIGURATION, id=selection.configuration_id
            ),
            version=selection.version,
        )
        record = self._configurations.get_version(ref)
        if record is None:
            # The configuration's own not-found error, for the reason ADR 0024 gave when it
            # refused an unknown identity with the identity's: a caller has to be able to
            # tell a stale arm from a stale experiment.
            raise AgentConfigurationVersionNotFoundError(
                f"agent configuration {selection.configuration_id} has no published version "
                f"{selection.version}"
            )
        return _SelectedArm(
            selection=selection,
            ref=ref,
            payload=record.payload,
            support_identity_version=_pinned_identity_version(record),
        )

    def _run_arm(self, run: RunRecord) -> _SelectedArm:
        """The arm a recorded run ran, resolved to the configuration version it pinned."""
        return self._arm(
            ArmSelection(
                configuration_id=run.agent_configuration_id,
                version=run.agent_configuration_version,
            )
        )

    def _scenario_version(
        self, shop_id: UUID, command: StartExperiment
    ) -> PublishedDefinitionVersion:
        published = self._published_versions.get_published(
            VersionRef(
                definition=scenario_definition_id(command.scenario_id),
                version=command.scenario_version,
            )
        )
        if published is None or published.shop is None or published.shop.id != shop_id:
            raise ScenarioVersionNotFoundError(
                f"scenario {command.scenario_id} version {command.scenario_version} "
                f"is not published in shop {shop_id}"
            )
        return published

    def _cap(self, shop_id: UUID, record: ExperimentRecord) -> int:
        """The turn cap the scenario version this experiment pinned declares.

        Read from the snapshot rather than from the scenario as it is now, for the reason
        every other resolution here is: an experiment is explained by the versions it pinned,
        and a cap that moved when an author republished would change what a running arm may
        still do.
        """
        snapshot = self._snapshots.get_snapshot(shop_id, record.snapshot_id)
        pinned = self._pinned(snapshot, DefinitionType.SCENARIO, self._scenarios)
        return pinned.payload.completion.max_turns

    def _pinned_shop(self, scenario: PublishedDefinitionVersion) -> ShopPayload:
        ref = scenario.scope_ref
        if ref is None:  # pragma: no cover - a scenario is shop-scoped by construction
            raise MissingReferenceVersionError("this scenario version pins no shop")
        record = self._shops.get_version(ref)
        if record is None:
            raise MissingReferenceVersionError(
                f"shop {ref.definition.id} version {ref.version} is not resolvable"
            )
        return record.payload

    def _pinned[PayloadT](
        self,
        snapshot: SandboxSnapshotRecord,
        definition_type: DefinitionType,
        repository: DefinitionRepository[PayloadT],
    ) -> DefinitionVersionRecord[PayloadT]:
        pin = next(
            (
                entry
                for entry in snapshot.content.pins
                if entry.definition.definition_type is definition_type
            ),
            None,
        )
        if pin is None:
            raise MissingReferenceVersionError(f"this snapshot pins no {definition_type}")
        record = repository.get_version(pin.ref)
        if record is None:
            raise MissingReferenceVersionError(
                f"{definition_type} {pin.definition.id} version {pin.version} is not resolvable"
            )
        return record


@dataclass(frozen=True, slots=True)
class _Judged:
    """One run of the setup gate: what it found, and the pins it resolved on the way.

    `resolution` is `None` exactly when a finding says why it could not be computed, so a
    caller that has checked for errors has a resolution.
    """

    validation: DefinitionValidation
    resolution: ExperimentResolution | None


@dataclass(frozen=True, slots=True)
class _SelectedArm:
    """One chosen arm, resolved to the published version it names."""

    selection: ArmSelection
    ref: VersionRef
    payload: AgentConfigurationPayload
    support_identity_version: int

    @property
    def compared(self) -> ComparedArm:
        return ComparedArm(
            configuration=self.payload, support_identity_version=self.support_identity_version
        )


def _pinned_identity_version(record: DefinitionVersionRecord[AgentConfigurationPayload]) -> int:
    """The support identity version this configuration version pinned when it was published.

    Read off the configuration version rather than out of an experiment's resolution, and
    deliberately: it is the very pin the resolution copies into each arm's closure (a
    published version is immutable, so the two cannot disagree), and it is there for every
    caller — including a preview whose resolution failed on a conflicting pin elsewhere in
    the closure, which still has to draw the matrix beside the finding that refuses it.
    """
    identity = record.payload.support_identity_id
    pin = next(
        (
            reference
            for reference in record.published.references
            if reference.definition.definition_type is DefinitionType.SUPPORT_IDENTITY
            and reference.definition.id == identity
        ),
        None,
    )
    if pin is None:  # pragma: no cover - the publish gate pins the identity the payload names
        raise MissingReferenceVersionError(
            f"agent configuration {record.published.definition.id} version "
            f"{record.published.version} pins no version of support identity {identity}"
        )
    return pin.version


def _thread(
    history: tuple[ParticipantTurnRecord, ...], run: RunRecord
) -> tuple[ParticipantTurn, ...]:
    """The customer turns one arm has received, out of the experiment's whole listing."""
    return tuple(entry.turn for entry in history if entry.run_id == run.run_id)


def _standing(
    run: RunRecord,
    turns: tuple[ParticipantTurnRecord, ...],
    agent_turns: tuple[AgentTurnRecord, ...],
    max_turns: int,
) -> ArmStanding:
    """One arm's standing, cut out of the experiment's two streams.

    The listings arrive whole and are narrowed here rather than re-queried per arm: an
    experiment holds at most two arms, and reading the same rows twice would be two chances
    to answer from two different moments.
    """
    return stand_arm(
        tuple(entry.turn for entry in turns if entry.run_id == run.run_id),
        tuple(entry.turn for entry in agent_turns if entry.run_id == run.run_id),
        max_turns=max_turns,
    )


def _metrics(
    run: RunRecord,
    turns: tuple[ParticipantTurnRecord, ...],
    agent_turns: tuple[AgentTurnRecord, ...],
    tool_events: tuple[ToolEventRecord, ...],
    payload: AgentConfigurationPayload,
) -> ArmMetrics:
    """One arm's running cost, cut out of the same three streams the standing reads.

    Narrowed here for the reason `_standing` narrows: the listings are already in hand, and
    reading them again per arm would be two chances to count two different moments.

    The provider and model come from the configuration version this arm *pinned*, never from
    the one published since: a historical run's cost has to be explainable by the inputs it
    recorded (ADR 0025).
    """
    return arm_metrics(
        run.run_id,
        turns=sum(1 for entry in turns if entry.run_id == run.run_id),
        attempts=tuple(entry for entry in agent_turns if entry.run_id == run.run_id),
        events=tuple(entry for entry in tool_events if entry.run_id == run.run_id),
        provider=payload.model.provider,
        model_id=payload.model.model_id,
    )


def _arm_labels(command: StartExperiment) -> tuple[str, ...]:
    """What each arm is called, defaulting to its position.

    Two arms an operator cannot tell apart are refused. A comparison's whole output is "arm A
    did this, arm B did that", so a name held by both arms would make every later reading of
    the result ambiguous — and the arms' own sandboxes would be labelled identically too.
    """
    labels = tuple(
        selection.label.strip() or ARM_LABELS[position]
        for position, selection in enumerate(command.arms)
    )
    if len(set(labels)) != len(labels):
        raise ExperimentArmError("each arm needs a name that tells it from the one beside it")
    return labels


def _comparison_issues(arms: tuple[_SelectedArm, ...]) -> tuple[DefinitionIssue, ...]:
    """Warn when the arms differ along more than one dimension.

    A warning rather than a refusal, deliberately. An experiment with two differences is
    still worth running — it is often how a suspicion starts — but nothing it produces can
    be attributed to either difference, so the count travels with the experiment instead of
    being discovered when someone reads the result months later.
    """
    if len(arms) < 2:
        return ()
    differing = [
        variable
        for variable in compare_configurations(tuple(arm.compared for arm in arms))
        if variable.differs
    ]
    if len(differing) < 2:
        return ()
    named = ", ".join(variable.dimension.value.replace("_", " ") for variable in differing)
    return (
        issue_warning(
            "multiple_comparison_variables",
            f"these arms differ in {len(differing)} dimensions ({named}), so a difference "
            "in behavior cannot be attributed to any one of them",
            "arms",
        ),
    )


def _document_of(canonical_json: bytes) -> dict[str, CanonicalValue]:
    """Re-read the bytes that were hashed, so the stored document is the fingerprinted one."""
    document: object = json.loads(canonical_json)
    if not isinstance(document, dict):  # pragma: no cover - canonical_json_bytes writes objects
        raise DefinitionResolutionError("an experiment document must be an object")
    return cast("dict[str, CanonicalValue]", document)
