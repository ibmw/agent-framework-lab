"""Public v1 contract for experiments: starting one, reading it, and driving it.

An experiment is created *started*. There is no draft and no separate "run" call, because
the two would be a lie about what happens: resolving the versions, freezing the starting
state, and cloning the arms are one act, and an experiment that existed without them would
be a record of nothing. `POST /experiments` therefore answers 201 with the arms already
cloned and the trigger already in both threads.

`POST /experiments/preview` is the setup screen's other half: the same gate and the same
comparison, computed without materializing anything. An operator weighing two configurations
must not be freezing starting state on every keystroke.

The participant surface is one operation. `POST /experiments/{id}/participant-turns` names
the arms one composition reaches — both for a linked message, one for a reply meant for that
arm alone — and the response is the turns as each arm received them. A driver-specific field
is deliberately absent from the path: which driver runs is the experiment's recorded input,
and composition selects the implementation (`docs/architecture.md`). What a human driver
needs, it takes from the request body; a future simulator will take nothing from it.

`POST /experiments/{id}/runs/{run_id}/agent-turns` is the agent half, and is deliberately a
separate operation on one arm. Recording what the customer said and running a model are two
acts: the arms progress independently, an advance is where a retry becomes expressible, and
a model call is slow and costly enough that it must not be a side effect of typing. The
request carries no body — everything the turn runs on is already pinned — and the response
is the attempt plus the calls it made.

`POST /experiments/{id}/notes` and `PUT /experiments/{id}/tags` are the one surface here
that writes something the run did not do. They are separate operations because they are
different statements: a note is appended and never edited, and a tag set is replaced whole.
Both answer with everything written on the run, and neither touches the experiment record —
what an operator concluded is stored beside what happened, never inside it (ADR 0036).
"""

from collections.abc import Callable, Generator
from typing import Annotated, Any, Self
from uuid import UUID

from fastapi import APIRouter, Depends, Path
from pydantic import Field, StringConstraints

from capability_lab.application.agent_turns import AgentTurnRecord, ToolEventRecord
from capability_lab.application.definition_resolution import ResolvedDefinition
from capability_lab.application.evaluation import (
    ExperimentEvaluation,
    ExperimentEvaluationService,
)
from capability_lab.application.experiment_annotations import (
    ExperimentAnnotations,
    ExperimentAnnotationService,
    ExperimentNoteRecord,
)
from capability_lab.application.experiment_replays import ExperimentReplayService
from capability_lab.application.experiment_runs import ExperimentRunner, RunTurn
from capability_lab.application.experiment_timeline import (
    ExperimentTimeline,
    ExperimentTimelineService,
    TimelineCategory,
    TimelineEntry,
    TimelineEntryKind,
)
from capability_lab.application.experiment_traces import (
    ExperimentTraces,
    ExperimentTraceService,
    RunTrace,
    RunTraceSpan,
    SpanKind,
)
from capability_lab.application.experiments import (
    MAX_ARMS,
    ArmRuntime,
    ArmSelection,
    ExperimentDetail,
    ExperimentOrigin,
    ExperimentPreview,
    ExperimentRecord,
    ExperimentService,
    ParticipantTurnRecord,
    RunRecord,
    StartExperiment,
)
from capability_lab.application.judge_runs import ExperimentJudgeService
from capability_lab.application.model_cost import EstimatedCost, ModelUsage
from capability_lab.application.mutation_events import MutationEventRecord
from capability_lab.application.participants import ParticipantDriver
from capability_lab.application.run_metrics import ArmMetrics
from capability_lab.application.sandbox_tools import ToolOutcome
from capability_lab.application.sandboxes import SandboxRecord
from capability_lab.application.source_locations import SourceLocation
from capability_lab.application.state_diff import ArmStateDiff, FieldChange, OrderStateDiff
from capability_lab.domain.agent_turn import AgentTurnFailure, AgentTurnOutcome
from capability_lab.domain.blocks import (
    MutationEffect,
    ObjectiveAssessment,
    ObjectiveEvidence,
    ObjectiveSeverity,
)
from capability_lab.domain.content import MAX_LABEL_LENGTH
from capability_lab.domain.entities import MAX_SCENARIO_SEED, MIN_SCENARIO_SEED
from capability_lab.domain.evaluation import ArmEvaluation, ObjectiveOutcome, ObjectiveResult
from capability_lab.domain.experiment import (
    MAX_NOTE_LENGTH,
    MAX_PARTICIPANT_TURN_LENGTH,
    MAX_TAGS,
    ArmAwaiting,
    ArmStanding,
    ComparisonDimension,
    ComparisonVariable,
    ParticipantDriverType,
    ParticipantTurnSource,
)
from capability_lab.domain.judge import JudgeOutcome
from capability_lab.domain.judgement import JudgeFailure, Judgement
from capability_lab.presentation.base import ErrorResponse, StrictApiModel
from capability_lab.presentation.definitions import (
    DefinitionIssueSchema,
    DefinitionVersionPath,
    InvalidResponses,
    NotFoundResponses,
)
from capability_lab.presentation.shops import ShopIdPath

ExperimentIdPath = Annotated[
    UUID, Path(description="Stable experiment identifier inside one shop.")
]
RunIdPath = Annotated[UUID, Path(description="One arm of this experiment.")]


class ArmSelectionSchema(StrictApiModel):
    """One arm: an exact published agent-configuration version, optionally named."""

    configuration_id: UUID
    version: DefinitionVersionPath
    label: Annotated[
        str,
        Field(
            default="",
            max_length=MAX_LABEL_LENGTH,
            description="How an operator tells this arm from the one beside it. Defaults "
            "to the arm's position, because that is what a comparison refers to.",
        ),
    ]

    def to_domain(self) -> ArmSelection:
        return ArmSelection(
            configuration_id=self.configuration_id, version=self.version, label=self.label
        )


class StartExperimentRequest(StrictApiModel):
    """One setup, judged by `previewExperiment` and run by `startExperiment`.

    One shape rather than two, so a preview judges the request a start would make rather than
    something adjacent to it. The name is the single field the two operations read
    differently: starting requires one, and previewing does not, because an operator compares
    two configurations before deciding what to call the experiment. The rule therefore lives
    in the service that starts it rather than being half here and half there.
    """

    label: Annotated[
        str,
        Field(
            max_length=MAX_LABEL_LENGTH,
            description="How an operator finds this experiment again. Required to start one; "
            "a preview judges the setup and does not need it.",
        ),
    ]
    scenario_id: UUID
    scenario_version: DefinitionVersionPath
    seed: Annotated[
        int,
        Field(
            ge=MIN_SCENARIO_SEED,
            le=MAX_SCENARIO_SEED,
            description="The seed the starting state is frozen and fingerprinted with.",
        ),
    ]
    arms: Annotated[list[ArmSelectionSchema], Field(min_length=1, max_length=MAX_ARMS)]
    participant_driver: ParticipantDriverType = ParticipantDriverType.HUMAN

    def to_domain(self) -> StartExperiment:
        return StartExperiment(
            label=self.label,
            scenario_id=self.scenario_id,
            scenario_version=self.scenario_version,
            seed=self.seed,
            arms=tuple(arm.to_domain() for arm in self.arms),
            participant_driver=self.participant_driver,
        )


class ParticipantTurnRequest(StrictApiModel):
    """One composition and the arms it reaches.

    `message` is what a human operator wrote. It is optional in the schema and required by
    the driver that needs it, deliberately: the field belongs to the human implementation,
    and a future generating driver will refuse a request that carries one rather than having
    the contract change shape underneath it.
    """

    run_ids: Annotated[
        list[UUID],
        Field(
            min_length=1,
            max_length=MAX_ARMS,
            description="The arms this composition is delivered to. Naming both is a linked "
            "turn; naming one is a reply that arm alone received.",
        ),
    ]
    message: Annotated[str, Field(default="", max_length=MAX_PARTICIPANT_TURN_LENGTH)]


class AddExperimentNoteRequest(StrictApiModel):
    """One thing an operator wants recorded about this run.

    Stripped here rather than left to the domain, because padding is a fact about a text box
    and not about what the reviewer wrote. Length is then measured on what will actually be
    stored, so a body of spaces is the contract's own "must not be empty" rather than a
    domain refusal the 422 description does not describe.
    """

    body: Annotated[
        str,
        StringConstraints(strip_whitespace=True, min_length=1, max_length=MAX_NOTE_LENGTH),
        Field(description="What the reviewer concluded, in their own words."),
    ]


class SetExperimentTagsRequest(StrictApiModel):
    """Every shelf this run should be filed on, which is the whole set.

    Not an add and not a remove: the operator is looking at the chips and saying what they
    are, and two requests that crossed would otherwise leave a set neither of them asked for.
    """

    tags: Annotated[
        list[str],
        Field(
            max_length=MAX_TAGS,
            description="The run's whole tag set. Each value is folded to lowercase "
            "kebab-case, so 'Read check gap' and 'read_check_gap' are one tag.",
        ),
    ]


class ExperimentNoteSchema(StrictApiModel):
    """One note as it was written: the words, and when."""

    note_id: UUID
    body: str
    created_at: str

    @classmethod
    def from_record(cls, record: ExperimentNoteRecord) -> Self:
        return cls(
            note_id=record.note_id, body=record.body, created_at=record.created_at.isoformat()
        )


class ExperimentAnnotationsResponse(StrictApiModel):
    """Everything an operator has written on one run.

    Answered by both writes as well as by the read, for the reason a scoring pass answers
    with the whole evaluation: a client that had to merge one appended note into a list it
    read separately would be holding two readings of one run.
    """

    notes: list[ExperimentNoteSchema]
    """Oldest first — successive reviewers reading one run, in the order they read it."""
    tags: list[str]
    """The folded set, in one order, so two operators who filed a run the same way agree."""

    @classmethod
    def from_domain(cls, annotations: ExperimentAnnotations) -> Self:
        return cls(
            notes=[ExperimentNoteSchema.from_record(note) for note in annotations.notes],
            tags=list(annotations.tags),
        )


AnnotationNotFoundResponses: dict[int | str, dict[str, Any]] = {
    404: {"model": ErrorResponse, "description": "The experiment is not found in this shop"}
}
NoteResponses: dict[int | str, dict[str, Any]] = AnnotationNotFoundResponses | {
    422: {"model": ErrorResponse, "description": "The note is empty or too long"}
}
TagResponses: dict[int | str, dict[str, Any]] = AnnotationNotFoundResponses | {
    409: {
        "model": ErrorResponse,
        "description": "Another request filed this run while this one was filing it; "
        "read its tags and set them again",
    },
    422: {
        "model": ErrorResponse,
        "description": "A tag is not a lowercase kebab-case identifier once folded, or "
        "there are too many of them",
    },
}


class ComparisonVariableSchema(StrictApiModel):
    """One dimension of the setup matrix: what each arm holds, and whether they disagree."""

    dimension: ComparisonDimension
    values: list[str]
    differs: bool

    @classmethod
    def from_domain(cls, variable: ComparisonVariable) -> Self:
        return cls(
            dimension=variable.dimension, values=list(variable.values), differs=variable.differs
        )


class ExperimentPreviewResponse(StrictApiModel):
    """The setup gate and the comparison matrix, computed without starting anything."""

    issues: list[DefinitionIssueSchema]
    comparison: list[ComparisonVariableSchema]
    arm_labels: list[str]

    @classmethod
    def from_domain(cls, preview: ExperimentPreview) -> Self:
        return cls(
            issues=[
                DefinitionIssueSchema.from_domain(issue) for issue in preview.validation.issues
            ],
            comparison=[
                ComparisonVariableSchema.from_domain(variable) for variable in preview.comparison
            ],
            arm_labels=list(preview.arm_labels),
        )


class ExperimentValidationErrorResponse(ErrorResponse):
    """A start refusal that carries the exact setup-gate findings."""

    issues: list[DefinitionIssueSchema]


# The arm bound comes from the application rather than being restated: two arms is what a
# paired comparison is (ADR 0011), and a contract that declared its own number could publish
# a request the service would then refuse.
StartResponses: dict[int | str, dict[str, Any]] = {
    404: {"model": ErrorResponse, "description": "The shop, scenario version, or arm is not found"},
    422: {
        "model": ExperimentValidationErrorResponse,
        "description": "The setup gate refuses this experiment",
    },
}


class ResolvedDefinitionSchema(StrictApiModel):
    """One exact published version this experiment pinned."""

    definition_type: str
    definition_id: UUID
    version: int
    content_fingerprint: str


class ExperimentSummarySchema(StrictApiModel):
    """One row of the bench's experiment list."""

    experiment_id: UUID
    label: str
    scenario_id: UUID
    scenario_version: int
    seed: int
    snapshot_id: UUID
    sandbox_fingerprint: str
    resolution_fingerprint: str
    participant_driver: ParticipantDriverType
    canonical_schema_version: str
    created_at: str

    @classmethod
    def from_record(cls, record: ExperimentRecord) -> Self:
        return cls(
            experiment_id=record.experiment_id,
            label=record.label,
            scenario_id=record.scenario_id,
            scenario_version=record.scenario_version,
            seed=record.seed,
            snapshot_id=record.snapshot_id,
            sandbox_fingerprint=record.sandbox_fingerprint,
            resolution_fingerprint=record.resolution_fingerprint,
            participant_driver=record.participant_driver,
            # The token this row's document carries, never the running build's.
            canonical_schema_version=record.canonical_schema_version,
            created_at=record.created_at.isoformat(),
        )


class ArmStandingSchema(StrictApiModel):
    """What one arm is waiting for, and where in its thread it is waiting.

    Served rather than left to the client because the runner reads the same rule to decide
    what an advance does (ADR 0029): a client that derived it again would be free to offer a
    button for something the backend would answer differently.
    """

    awaiting: ArmAwaiting
    ordinal: int
    attempts: int
    unanswered: list[int]
    """The earlier turns this arm never answered, in order — the ordinals, not a count.

    A client labels those turns in the thread it is already drawing, so it needs to know
    which ones they are; deriving that from a count means reading the two streams again,
    which is the second derivation this object exists to remove."""

    @classmethod
    def from_domain(cls, standing: ArmStanding) -> Self:
        return cls(
            awaiting=standing.awaiting,
            ordinal=standing.ordinal,
            attempts=standing.attempts,
            unanswered=list(standing.unanswered),
        )


class ModelUsageSchema(StrictApiModel):
    """What one attempt asked of a provider, in the units every provider bills in.

    Three counts and no provider detail. Cache reads, audio tokens, and reasoning
    breakdowns differ by provider and by model generation, and a comparison across two
    frameworks needs the columns to line up more than it needs any one of them complete.
    """

    input_tokens: int
    output_tokens: int
    model_requests: int

    @classmethod
    def from_domain(cls, usage: ModelUsage | None) -> Self | None:
        return (
            None
            if usage is None
            else cls(
                input_tokens=usage.input_tokens,
                output_tokens=usage.output_tokens,
                model_requests=usage.model_requests,
            )
        )


class EstimatedCostSchema(StrictApiModel):
    """What the lab's declared rates say one arm's usage was worth.

    `amount` is a decimal string rather than a number, for the reason money is everywhere
    else in this contract: a binary float cannot hold a rate exactly, and a cost a client
    re-renders must be the cost the lab computed.

    `recorded_on` is when the rate behind this amount was read off the provider's public
    pricing. It travels because an estimate whose age is invisible is a number an operator
    cannot weigh — and because a client cannot look it up: the table is the lab's.
    """

    amount: str
    currency: str
    recorded_on: str

    @classmethod
    def from_domain(cls, cost: EstimatedCost | None) -> Self | None:
        return (
            None
            if cost is None
            else cls(
                amount=cost.canonical_amount,
                currency=cost.currency,
                recorded_on=cost.recorded_on.isoformat(),
            )
        )


class ArmMetricsSchema(StrictApiModel):
    """What one arm has spent so far: turns, calls, tokens, time, and an estimate.

    Served rather than counted by the client for the reason the standing is (ADR 0029): the
    rows are already here, and a client that counted them again would be free to count them
    differently. Every number is of the record as it stands, so an arm still being driven
    reports a growing total rather than waiting for a completion nobody sets.

    Deliberately no aggregate and no arm-versus-arm delta. An efficiency reading is only
    interpretable beside the outcome, which is the evaluation's, and the product direction
    forbids collapsing evidence into one score.
    """

    turns: int
    answered_turns: int
    attempts: int
    retries: int
    failures: dict[AgentTurnFailure, int]
    """How many attempts ended in each kind of failure; absent kinds are simply not there."""

    tool_calls: int
    tool_writes: int
    model_requests: int | None
    usage: ModelUsageSchema | None
    duration_ms: int | None
    tool_duration_ms: int | None
    measured_attempts: int
    """How many attempts contributed a duration — the denominator of `duration_ms`."""

    metered_attempts: int
    """How many attempts contributed usage — the denominator of `usage` and the cost.

    Below `attempts` whenever one of them failed: a failed attempt reports nothing it spent,
    so a retried arm's tokens cover fewer attempts than it made."""

    estimated_cost: EstimatedCostSchema | None
    """Null when either half is unknown: unreported usage, or a model the lab has not priced."""

    @classmethod
    def from_domain(cls, metrics: ArmMetrics) -> Self:
        return cls(
            turns=metrics.turns,
            answered_turns=metrics.answered_turns,
            attempts=metrics.attempts,
            retries=metrics.retries,
            failures=dict(metrics.failures),
            tool_calls=metrics.tool_calls,
            tool_writes=metrics.tool_writes,
            model_requests=metrics.model_requests,
            usage=ModelUsageSchema.from_domain(metrics.usage),
            duration_ms=metrics.duration_ms,
            tool_duration_ms=metrics.tool_duration_ms,
            measured_attempts=metrics.measured_attempts,
            metered_attempts=metrics.metered_attempts,
            estimated_cost=EstimatedCostSchema.from_domain(metrics.estimated_cost),
        )


class FieldChangeSchema(StrictApiModel):
    """One field of one canonical document that reads differently than it started.

    `null` on either side means the field was *absent* there rather than empty: an order
    that had no shipping address and now has one is a different fact from one whose city
    was blanked.
    """

    path: str
    before: str | None
    after: str | None

    @classmethod
    def from_domain(cls, change: FieldChange) -> Self:
        return cls(path=change.path, before=change.before, after=change.after)


class OrderStateDiffSchema(StrictApiModel):
    """Everything that moved in one order, named the way the incident names it."""

    order_id: UUID
    reference: str
    changes: list[FieldChangeSchema]

    @classmethod
    def from_domain(cls, diff: OrderStateDiff) -> Self:
        return cls(
            order_id=diff.order_id,
            reference=diff.reference,
            changes=[FieldChangeSchema.from_domain(change) for change in diff.changes],
        )


class ArmStateDiffSchema(StrictApiModel):
    """What one arm's world is, read against the world it was cloned into.

    Served rather than computed by the client for the reason the standing and the metrics
    are: it is a difference between the exact bytes two fingerprints cover, and a client
    comparing its own two readings would be free to decide differently what changed.

    `other` carries changes outside every order, which nothing in this build can produce —
    an empty list is the "no other state changed" check passing rather than a section with
    nothing in it.
    """

    orders: list[OrderStateDiffSchema]
    other: list[FieldChangeSchema]

    @classmethod
    def from_domain(cls, diff: ArmStateDiff) -> Self:
        return cls(
            orders=[OrderStateDiffSchema.from_domain(order) for order in diff.orders],
            other=[FieldChangeSchema.from_domain(change) for change in diff.other],
        )


class ExperimentRunSchema(StrictApiModel):
    """One arm: what it runs, where it works, how far its world has moved, and what next.

    The two fingerprints are the arm's own, read off the sandbox rather than restated:
    `snapshot_fingerprint` is where it started and agrees with every sibling arm forever;
    `state_fingerprint` is where it is now and stops agreeing the moment something writes.
    `state_diff` is what that second fingerprint moved *to*, field by field: the fingerprint
    says an arm's world is not the one it started in, and the diff says what about it is not.
    """

    run_id: UUID
    position: int
    label: str
    agent_configuration_id: UUID
    agent_configuration_version: int
    agent_configuration_name: str
    framework_id: str
    provider: str
    model_id: str
    sandbox_id: UUID
    revision: int
    snapshot_fingerprint: str
    state_fingerprint: str
    standing: ArmStandingSchema
    metrics: ArmMetricsSchema
    state_diff: ArmStateDiffSchema

    @classmethod
    def from_records(
        cls,
        run: RunRecord,
        sandbox: SandboxRecord,
        runtime: ArmRuntime,
        standing: ArmStanding,
        metrics: ArmMetrics,
        state_diff: ArmStateDiff,
    ) -> Self:
        return cls(
            run_id=run.run_id,
            position=run.position,
            label=run.label,
            agent_configuration_id=run.agent_configuration_id,
            agent_configuration_version=run.agent_configuration_version,
            # Read from the configuration version this arm pinned, not from anything the
            # process is currently able to run: what an arm ran is a recorded input. The
            # name is pinned for the same reason: a configuration renamed after a run must
            # not rename what that run says it ran.
            agent_configuration_name=runtime.configuration_name,
            framework_id=runtime.framework_id,
            provider=runtime.provider,
            model_id=runtime.model_id,
            sandbox_id=run.sandbox_id,
            revision=sandbox.revision,
            snapshot_fingerprint=sandbox.snapshot_fingerprint,
            state_fingerprint=sandbox.state_fingerprint,
            standing=ArmStandingSchema.from_domain(standing),
            metrics=ArmMetricsSchema.from_domain(metrics),
            state_diff=ArmStateDiffSchema.from_domain(state_diff),
        )


class ParticipantTurnSchema(StrictApiModel):
    """One customer turn as one arm received it."""

    run_id: UUID
    turn_id: UUID
    ordinal: int
    source: ParticipantTurnSource
    driver: ParticipantDriverType | None
    body: str
    created_at: str

    @classmethod
    def from_record(cls, record: ParticipantTurnRecord) -> Self:
        return cls(
            run_id=record.run_id,
            turn_id=record.turn.turn_id,
            ordinal=record.turn.ordinal,
            source=record.turn.source,
            driver=record.turn.driver,
            body=record.turn.body,
            created_at=record.created_at.isoformat(),
        )


class ToolEventSchema(StrictApiModel):
    """One tool call one attempt made, and what it did to the arm.

    `result` is the `tool-result-v1` document the tool answered with, served whole rather
    than summarized: it is the published envelope already (ADR 0021), and a client that read
    a summary here would be reading a second description of evidence it can read directly.

    `revision_before` and `revision_after` are the state change. They are equal for a read;
    the one write this milestone publishes moves the arm by one, and the confirmation that
    authorized it is inside `result`.
    """

    run_id: UUID
    ordinal: int
    attempt: int
    sequence: int
    tool: str
    version: str
    outcome: ToolOutcome
    result: dict[str, Any]
    revision_before: int
    revision_after: int
    state_fingerprint: str
    created_at: str
    duration_ms: int | None
    """How long this one call took, or null on a row recorded before the lab measured."""

    @classmethod
    def from_record(cls, record: ToolEventRecord) -> Self:
        event = record.event
        return cls(
            run_id=record.run_id,
            ordinal=event.ordinal,
            attempt=event.attempt,
            sequence=event.sequence,
            tool=event.tool,
            version=event.version,
            outcome=event.outcome,
            result=dict(event.document),
            revision_before=event.revision_before,
            revision_after=event.revision_after,
            state_fingerprint=event.state_fingerprint,
            created_at=record.created_at.isoformat(),
            duration_ms=event.duration_ms,
        )


class MutationEventSchema(StrictApiModel):
    """One scenario fault that fired into one arm, and what it did to that arm.

    No agent asked for this and no agent can see it (ADR 0017): it is the scenario's own
    fault arriving at the moment the recipe bound it to. It is served because an *operator*
    has to be able to explain what the arm met — a write refused as too late, with no visible
    cause, is the one thing a fault must never look like.

    `after_calls` is how many calls the attempt had already made when it fired, which is what
    places it between two of the agent's calls rather than merely inside the same turn.

    `revision_before` and `revision_after` are the state change, recorded the way a tool
    event records one. There is no copy of what changed: the arm's own state is the world
    afterwards, and a second description could disagree with it.
    """

    run_id: UUID
    mutation_id: str
    block_id: UUID
    block_version: int
    effect: MutationEffect
    timing: str
    target: str
    ordinal: int
    attempt: int
    after_calls: int
    revision_before: int
    revision_after: int
    state_fingerprint: str
    created_at: str

    @classmethod
    def from_record(cls, record: MutationEventRecord) -> Self:
        event = record.event
        return cls(
            run_id=record.run_id,
            mutation_id=event.mutation_id,
            block_id=event.block_id,
            block_version=event.block_version,
            effect=event.effect,
            timing=event.timing,
            target=event.target,
            ordinal=event.ordinal,
            attempt=event.attempt,
            after_calls=event.after_calls,
            revision_before=event.revision_before,
            revision_after=event.revision_after,
            state_fingerprint=event.state_fingerprint,
            created_at=record.created_at.isoformat(),
        )


class AgentTurnSchema(StrictApiModel):
    """One attempt at one arm's reply.

    `ordinal` is the customer turn being answered rather than a counter of its own, so a
    client renders a thread by pairing the two streams on it instead of interleaving by
    time. `attempt` counts retries: a failed attempt stays, and the next one sits beside it.

    A failed attempt carries a `failure` code and no `body`. There is deliberately no
    message: a framework's error text is not something the agent said, and it would read as
    the reply everywhere a transcript is shown.
    """

    run_id: UUID
    ordinal: int
    attempt: int
    outcome: AgentTurnOutcome
    failure: AgentTurnFailure | None
    body: str
    created_at: str
    duration_ms: int | None
    """Wall-clock milliseconds this attempt took, model and tool calls together.

    Null when the lab did not measure it, never zero: a zero would be counted into a total
    as if the attempt had been instantaneous."""

    usage: ModelUsageSchema | None
    """What the framework metered, or null when it does not meter itself.

    `ModelUsage.none()` — zeros with zero requests — is a different answer: it says the
    runtime called no provider at all, which is what the deterministic control arm does."""

    @classmethod
    def from_record(cls, record: AgentTurnRecord) -> Self:
        turn = record.turn
        return cls(
            run_id=record.run_id,
            ordinal=turn.ordinal,
            attempt=turn.attempt,
            outcome=turn.outcome,
            failure=turn.failure,
            body=turn.body,
            created_at=record.created_at.isoformat(),
            duration_ms=record.duration_ms,
            usage=ModelUsageSchema.from_domain(record.usage),
        )


class RunTurnResponse(StrictApiModel):
    """What advancing one arm produced: the attempt, its calls, and the faults it met.

    `mutation_events` is empty for almost every advance and is the whole explanation when it
    is not: the scenario moved this arm's world while the agent was working.
    """

    turn: AgentTurnSchema
    tool_events: list[ToolEventSchema]
    mutation_events: list[MutationEventSchema]

    @classmethod
    def from_domain(cls, produced: RunTurn) -> Self:
        return cls(
            turn=AgentTurnSchema.from_record(produced.turn),
            tool_events=[ToolEventSchema.from_record(event) for event in produced.tool_events],
            mutation_events=[
                MutationEventSchema.from_record(event) for event in produced.mutation_events
            ],
        )


class ExperimentOriginSchema(StrictApiModel):
    """The experiment a derived one replays, named as a reader would name it."""

    experiment_id: UUID
    label: str

    @classmethod
    def from_domain(cls, origin: ExperimentOrigin) -> Self:
        return cls(experiment_id=origin.experiment_id, label=origin.label)


class ExperimentResponse(ExperimentSummarySchema):
    """One experiment in full: the versions it pinned, its arms, and their threads."""

    replay_of: ExperimentOriginSchema | None = None
    """The experiment this one was derived from, and `null` for one an operator started.

    Served on the experiment rather than through an operation of its own — unlike the notes
    beside it (ADR 0036) — because it is a nullable identifier rather than text, and because
    a derived run that did not say what it derives from would be missing the provenance the
    derivation exists for (ADR 0038)."""

    sandbox_inputs: list[ResolvedDefinitionSchema]
    arm_inputs: list[list[ResolvedDefinitionSchema]]
    tool_contracts: dict[str, str]
    comparison: list[ComparisonVariableSchema]
    runs: list[ExperimentRunSchema]
    turns: list[ParticipantTurnSchema]
    agent_turns: list[AgentTurnSchema]
    tool_events: list[ToolEventSchema]
    mutation_events: list[MutationEventSchema]

    @classmethod
    def from_detail(cls, detail: ExperimentDetail) -> Self:
        resolution = detail.resolution
        sandboxes = {sandbox.sandbox_id: sandbox for sandbox in detail.sandboxes}
        return cls(
            **ExperimentSummarySchema.from_record(detail.record).model_dump(),
            replay_of=(
                None
                if detail.replay_of is None
                else ExperimentOriginSchema.from_domain(detail.replay_of)
            ),
            sandbox_inputs=[_resolved(entry) for entry in resolution.sandbox_inputs],
            arm_inputs=[
                [
                    _resolved(arm.agent_configuration),
                    *(_resolved(entry) for entry in arm.support_identities),
                ]
                for arm in resolution.arms
            ],
            tool_contracts=dict(resolution.tool_contract_versions),
            comparison=[
                ComparisonVariableSchema.from_domain(variable) for variable in detail.comparison
            ],
            runs=[
                ExperimentRunSchema.from_records(
                    run, sandboxes[run.sandbox_id], runtime, standing, metrics, state_diff
                )
                for run, runtime, standing, metrics, state_diff in zip(
                    detail.runs,
                    detail.arm_runtimes,
                    detail.standings,
                    detail.metrics,
                    detail.state_diffs,
                    strict=True,
                )
            ],
            turns=[ParticipantTurnSchema.from_record(turn) for turn in detail.turns],
            agent_turns=[AgentTurnSchema.from_record(turn) for turn in detail.agent_turns],
            tool_events=[ToolEventSchema.from_record(event) for event in detail.tool_events],
            mutation_events=[
                MutationEventSchema.from_record(event) for event in detail.mutation_events
            ],
        )


class SourceLocationSchema(StrictApiModel):
    """One place in this project's own source.

    `path` is relative to the import root, never absolute: an absolute path is a fact about
    the machine that answered rather than about the code, and the same experiment read from
    two checkouts would otherwise report two different locations for identical work.
    """

    module: str
    path: str
    symbol: str
    line: int

    @classmethod
    def from_domain(cls, location: SourceLocation) -> Self:
        return cls(
            module=location.module,
            path=location.path,
            symbol=location.symbol,
            line=location.line,
        )


class TimelineEntrySchema(StrictApiModel):
    """One normalized event in an experiment's execution.

    Deliberately carries no message, reply, or tool argument. The thread `getExperiment`
    serves is where what was said belongs; this stream says what happened, so it can be
    filtered, counted, and later handed to an evaluation without carrying synthetic customer
    content along with it.

    `step` is the customer composition this entry belongs to and is the one coordinate both
    arms share — `ordinal` counts one arm's own turns, and two arms driven to different
    depths hold different ordinals for the same message.

    `source` is where the project's own code that ran this lives, and is absent whenever it
    is not the project's to point at: a framework's internals, an adapter this process does
    not have, or a tool this build no longer publishes.
    """

    step: int
    kind: TimelineEntryKind
    categories: list[TimelineCategory]
    run_ids: list[UUID]
    occurred_at: str
    composition_id: UUID | None
    ordinal: int | None
    attempt: int | None
    sequence: int | None
    tool: str | None
    tool_version: str | None
    tool_outcome: ToolOutcome | None
    mutation: str | None
    mutation_effect: MutationEffect | None
    turn_outcome: AgentTurnOutcome | None
    failure: AgentTurnFailure | None
    revision_before: int | None
    revision_after: int | None
    source: SourceLocationSchema | None

    @classmethod
    def from_domain(cls, entry: TimelineEntry) -> Self:
        return cls(
            step=entry.step,
            kind=entry.kind,
            categories=list(entry.categories),
            run_ids=list(entry.run_ids),
            occurred_at=entry.occurred_at.isoformat(),
            composition_id=entry.composition_id,
            ordinal=entry.ordinal,
            attempt=entry.attempt,
            sequence=entry.sequence,
            tool=entry.tool,
            tool_version=entry.tool_version,
            tool_outcome=entry.tool_outcome,
            mutation=entry.mutation,
            mutation_effect=entry.mutation_effect,
            turn_outcome=entry.turn_outcome,
            failure=entry.failure,
            revision_before=entry.revision_before,
            revision_after=entry.revision_after,
            source=(
                None if entry.source is None else SourceLocationSchema.from_domain(entry.source)
            ),
        )


class ExperimentTimelineResponse(StrictApiModel):
    """One experiment's execution as one ordered, framework-neutral stream."""

    experiment_id: UUID
    entries: list[TimelineEntrySchema]

    @classmethod
    def from_domain(cls, timeline: ExperimentTimeline) -> Self:
        return cls(
            experiment_id=timeline.experiment_id,
            entries=[TimelineEntrySchema.from_domain(entry) for entry in timeline.entries],
        )


class RunTraceSpanSchema(StrictApiModel):
    """One span of one attempt, with what the record says it was about joined onto it.

    The stored span carries no attribute of its own — only hex identifiers, a closed kind,
    and two millisecond counts — so a trace can never become the way synthetic customer
    content leaves the lab. `tool`, `tool_version`, and `tool_outcome` are read from the tool
    event this span's `sequence` names, which is the same document the timeline reads.

    `started_offset_ms` is measured from the start of the attempt, and it is the one fact
    here that no other reading of an experiment can supply: the record timestamps an attempt
    and every call it made from one reading of the clock, so where inside the attempt a call
    ran — and therefore how much of the attempt was the framework thinking rather than the
    lab answering — is gone unless it is recorded.
    """

    span_id: str
    parent_span_id: str | None
    kind: SpanKind
    started_offset_ms: int
    duration_ms: int
    sequence: int | None
    tool: str | None
    tool_version: str | None
    tool_outcome: ToolOutcome | None

    @classmethod
    def from_domain(cls, span: RunTraceSpan) -> Self:
        return cls(
            span_id=span.span_id,
            parent_span_id=span.parent_span_id,
            kind=span.kind,
            started_offset_ms=span.started_offset_ms,
            duration_ms=span.duration_ms,
            sequence=span.sequence,
            tool=span.tool,
            tool_version=span.tool_version,
            tool_outcome=span.tool_outcome,
        )


class RunTraceSchema(StrictApiModel):
    """One attempt of one arm, and the trace of it where the lab recorded one.

    Every recorded attempt appears, including the ones made before this lab traced anything:
    `trace_id` is absent and `spans` is empty, which says nobody watched rather than nothing
    happened. An invented waterfall would be the mistake ADR 0032 refused when it left an
    unmeasured duration null.
    """

    run_id: UUID
    arm_label: str
    framework_id: str
    model_id: str
    ordinal: int
    attempt: int
    outcome: AgentTurnOutcome
    failure: AgentTurnFailure | None
    duration_ms: int | None
    trace_id: str | None
    spans: list[RunTraceSpanSchema]

    @classmethod
    def from_domain(cls, trace: RunTrace) -> Self:
        return cls(
            run_id=trace.run_id,
            arm_label=trace.arm_label,
            framework_id=trace.framework_id,
            model_id=trace.model_id,
            ordinal=trace.ordinal,
            attempt=trace.attempt,
            outcome=trace.outcome,
            failure=trace.failure,
            duration_ms=trace.duration_ms,
            trace_id=trace.trace_id,
            spans=[RunTraceSpanSchema.from_domain(span) for span in trace.spans],
        )


class ExperimentTracesResponse(StrictApiModel):
    """Every attempt both arms made, arm by arm and turn by turn."""

    experiment_id: UUID
    traces: list[RunTraceSchema]

    @classmethod
    def from_domain(cls, traces: ExperimentTraces) -> Self:
        return cls(
            experiment_id=traces.experiment_id,
            traces=[RunTraceSchema.from_domain(trace) for trace in traces.traces],
        )


class JudgementSchema(StrictApiModel):
    """Which published judge produced one verdict, on what, and from what input.

    Present exactly on a row a judge has scored — including one whose execution failed,
    where the outcome is absent and `failure` says why. Provenance travels *on the row*
    rather than in a listing beside it: a verdict an operator cannot trace to a rubric
    version, a model, and an input fingerprint is a number, which is what this lab refuses
    to report.
    """

    judge_id: UUID
    judge_version: int
    provider: str
    model_id: str
    brief_fingerprint: str
    attempt: int
    outcome: JudgeOutcome | None
    failure: JudgeFailure | None

    @classmethod
    def from_domain(cls, judgement: Judgement) -> Self:
        return cls(
            judge_id=judgement.judge_id,
            judge_version=judgement.judge_version,
            provider=judgement.provider,
            model_id=judgement.model_id,
            brief_fingerprint=judgement.brief_fingerprint,
            attempt=judgement.attempt,
            outcome=judgement.outcome,
            failure=judgement.failure,
        )


class ObjectiveResultSchema(StrictApiModel):
    """One bound objective as one arm's record answers it.

    `detail` is the evidence in a sentence — the call that answered it, or the call that was
    never made. A cell that said only "missed" would be a score; the reason it is missed is
    the finding.
    """

    objective_id: str
    block_id: UUID
    block_version: int
    statement: str
    severity: ObjectiveSeverity
    assessment: ObjectiveAssessment
    evidence: ObjectiveEvidence
    outcome: ObjectiveOutcome
    detail: str
    judgement: JudgementSchema | None = None

    @classmethod
    def from_domain(cls, result: ObjectiveResult) -> Self:
        return cls(
            objective_id=result.objective_id,
            block_id=result.block_id,
            block_version=result.block_version,
            statement=result.statement,
            severity=result.severity,
            assessment=result.assessment,
            evidence=result.evidence,
            outcome=result.outcome,
            detail=result.detail,
            judgement=(
                None if result.judgement is None else JudgementSchema.from_domain(result.judgement)
            ),
        )


class ArmEvaluationSchema(StrictApiModel):
    """One arm judged against every objective its scenario composed.

    `decided` is what `met` is out of, and it is smaller than the objective list whenever a
    judge or a kind of evidence this build does not read owns a row: counting those as
    misses would report the lab's own limits as the agent's.
    """

    run_id: UUID
    settled: bool
    met: int
    decided: int
    failed: bool
    objectives: list[ObjectiveResultSchema]

    @classmethod
    def from_domain(cls, evaluation: ArmEvaluation) -> Self:
        return cls(
            run_id=evaluation.run_id,
            settled=evaluation.settled,
            met=evaluation.met,
            decided=len(evaluation.decided),
            failed=evaluation.failed,
            objectives=[ObjectiveResultSchema.from_domain(result) for result in evaluation.results],
        )


class ExperimentEvaluationResponse(StrictApiModel):
    """Both arms judged against one scenario's objectives, in arm order."""

    experiment_id: UUID
    arms: list[ArmEvaluationSchema]

    @classmethod
    def from_domain(cls, evaluation: ExperimentEvaluation) -> Self:
        return cls(
            experiment_id=evaluation.experiment_id,
            arms=[ArmEvaluationSchema.from_domain(arm) for arm in evaluation.arms],
        )


class ScoreExperimentRequest(StrictApiModel):
    """Which published judge scores this experiment's judge-assessed objectives.

    Named at scoring time rather than pinned by the experiment, because judging is separate
    from the run and rerunnable: what explains a verdict is the judge version recorded on it.
    """

    judge_id: UUID


class ExperimentListResponse(StrictApiModel):
    experiments: list[ExperimentSummarySchema]


class ParticipantTurnListResponse(StrictApiModel):
    turns: list[ParticipantTurnSchema]


def _resolved(entry: ResolvedDefinition) -> ResolvedDefinitionSchema:
    return ResolvedDefinitionSchema(
        definition_type=entry.definition.definition_type.value,
        definition_id=entry.definition.id,
        version=entry.version,
        content_fingerprint=entry.content_fingerprint,
    )


class ExperimentRoutes:
    """Route handlers bound to a request-scoped `ExperimentService` dependency.

    The participant driver arrives through a factory rather than through the service, because
    it is constructed from the request that carries the operator's words and lives exactly as
    long as one delivery.
    """

    def __init__(
        self,
        service: Callable[[], Generator[ExperimentService, None, None]],
        driver: Callable[[str], ParticipantDriver],
        runner: Callable[[], Generator[ExperimentRunner, None, None]],
        replays: Callable[[], Generator[ExperimentReplayService, None, None]],
        timeline: Callable[[], Generator[ExperimentTimelineService, None, None]],
        traces: Callable[[], Generator[ExperimentTraceService, None, None]],
        evaluation: Callable[[], Generator[ExperimentEvaluationService, None, None]],
        judge: Callable[[], Generator[ExperimentJudgeService, None, None]],
        annotations: Callable[[], Generator[ExperimentAnnotationService, None, None]],
    ) -> None:
        self._service = service
        self._driver = driver
        self._runner = runner
        self._replays = replays
        self._timeline = timeline
        self._traces = traces
        self._evaluation = evaluation
        self._judge = judge
        self._annotations = annotations

    def register(self, router: APIRouter) -> None:
        dependency = Depends(self._service)
        runner_dependency = Depends(self._runner)
        replay_dependency = Depends(self._replays)
        timeline_dependency = Depends(self._timeline)
        traces_dependency = Depends(self._traces)
        evaluation_dependency = Depends(self._evaluation)
        judge_dependency = Depends(self._judge)
        annotation_dependency = Depends(self._annotations)

        def start_experiment(
            shop_id: ShopIdPath,
            command: StartExperimentRequest,
            service: Annotated[ExperimentService, dependency],
        ) -> ExperimentResponse:
            return ExperimentResponse.from_detail(service.start(shop_id, command.to_domain()))

        def preview_experiment(
            shop_id: ShopIdPath,
            command: StartExperimentRequest,
            service: Annotated[ExperimentService, dependency],
        ) -> ExperimentPreviewResponse:
            return ExperimentPreviewResponse.from_domain(
                service.preview(shop_id, command.to_domain())
            )

        def list_experiments(
            shop_id: ShopIdPath,
            service: Annotated[ExperimentService, dependency],
        ) -> ExperimentListResponse:
            return ExperimentListResponse(
                experiments=[
                    ExperimentSummarySchema.from_record(record)
                    for record in service.list_experiments(shop_id)
                ]
            )

        def get_experiment(
            shop_id: ShopIdPath,
            experiment_id: ExperimentIdPath,
            service: Annotated[ExperimentService, dependency],
        ) -> ExperimentResponse:
            return ExperimentResponse.from_detail(service.get_experiment(shop_id, experiment_id))

        def deliver_participant_turn(
            shop_id: ShopIdPath,
            experiment_id: ExperimentIdPath,
            command: ParticipantTurnRequest,
            service: Annotated[ExperimentService, dependency],
        ) -> ParticipantTurnListResponse:
            return ParticipantTurnListResponse(
                turns=[
                    ParticipantTurnSchema.from_record(record)
                    for record in service.deliver_turn(
                        shop_id,
                        experiment_id,
                        tuple(command.run_ids),
                        self._driver(command.message),
                    )
                ]
            )

        def get_experiment_timeline(
            shop_id: ShopIdPath,
            experiment_id: ExperimentIdPath,
            timeline: Annotated[ExperimentTimelineService, timeline_dependency],
        ) -> ExperimentTimelineResponse:
            return ExperimentTimelineResponse.from_domain(timeline.timeline(shop_id, experiment_id))

        def get_experiment_traces(
            shop_id: ShopIdPath,
            experiment_id: ExperimentIdPath,
            traces: Annotated[ExperimentTraceService, traces_dependency],
        ) -> ExperimentTracesResponse:
            return ExperimentTracesResponse.from_domain(traces.traces(shop_id, experiment_id))

        def get_experiment_evaluation(
            shop_id: ShopIdPath,
            experiment_id: ExperimentIdPath,
            evaluation: Annotated[ExperimentEvaluationService, evaluation_dependency],
        ) -> ExperimentEvaluationResponse:
            return ExperimentEvaluationResponse.from_domain(
                evaluation.evaluate(shop_id, experiment_id)
            )

        async def score_experiment(
            shop_id: ShopIdPath,
            experiment_id: ExperimentIdPath,
            command: ScoreExperimentRequest,
            judge: Annotated[ExperimentJudgeService, judge_dependency],
        ) -> ExperimentEvaluationResponse:
            # The whole evaluation, not the verdicts this pass produced: a scoring pass fills
            # some of an arm's rows and none of the others, and one reading of an experiment
            # is what keeps a judged row and a deterministic row beside it consistent.
            return ExperimentEvaluationResponse.from_domain(
                await judge.score(shop_id, experiment_id, command.judge_id)
            )

        def get_experiment_annotations(
            shop_id: ShopIdPath,
            experiment_id: ExperimentIdPath,
            annotations: Annotated[ExperimentAnnotationService, annotation_dependency],
        ) -> ExperimentAnnotationsResponse:
            return ExperimentAnnotationsResponse.from_domain(
                annotations.get(shop_id, experiment_id)
            )

        def add_experiment_note(
            shop_id: ShopIdPath,
            experiment_id: ExperimentIdPath,
            command: AddExperimentNoteRequest,
            annotations: Annotated[ExperimentAnnotationService, annotation_dependency],
        ) -> ExperimentAnnotationsResponse:
            return ExperimentAnnotationsResponse.from_domain(
                annotations.add_note(shop_id, experiment_id, command.body)
            )

        def set_experiment_tags(
            shop_id: ShopIdPath,
            experiment_id: ExperimentIdPath,
            command: SetExperimentTagsRequest,
            annotations: Annotated[ExperimentAnnotationService, annotation_dependency],
        ) -> ExperimentAnnotationsResponse:
            return ExperimentAnnotationsResponse.from_domain(
                annotations.set_tags(shop_id, experiment_id, tuple(command.tags))
            )

        async def replay_experiment(
            shop_id: ShopIdPath,
            experiment_id: ExperimentIdPath,
            replays: Annotated[ExperimentReplayService, replay_dependency],
        ) -> ExperimentResponse:
            # The derived experiment, whole: the caller asked to reproduce a run and what
            # they need back is the run that was produced, in the shape every other reading
            # of an experiment arrives in.
            return ExperimentResponse.from_detail(await replays.replay(shop_id, experiment_id))

        async def advance_run(
            shop_id: ShopIdPath,
            experiment_id: ExperimentIdPath,
            run_id: RunIdPath,
            runner: Annotated[ExperimentRunner, runner_dependency],
        ) -> RunTurnResponse:
            return RunTurnResponse.from_domain(await runner.advance(shop_id, experiment_id, run_id))

        router.add_api_route(
            "/shops/{shop_id}/experiments",
            start_experiment,
            methods=["POST"],
            status_code=201,
            response_model=ExperimentResponse,
            operation_id="startExperiment",
            summary="Start one experiment: freeze the starting state and clone its arms",
            description=(
                "Resolves every published version the experiment names, freezes the "
                "scenario version into a canonical snapshot, clones one independently "
                "mutable arm per agent configuration, and opens each arm's thread with the "
                "ticket's triggering message. Deliberately not idempotent: the same "
                "scenario run twice is two experiments."
            ),
            responses=StartResponses,
        )
        router.add_api_route(
            "/shops/{shop_id}/experiments/preview",
            preview_experiment,
            methods=["POST"],
            response_model=ExperimentPreviewResponse,
            operation_id="previewExperiment",
            summary="Judge an experiment's setup without starting it",
            description=(
                "The same gate `startExperiment` applies, plus the dimension-by-dimension "
                "comparison of the chosen arms. Materializes nothing and stores nothing, and "
                "does not need the name the experiment will be started under."
            ),
            responses=NotFoundResponses | InvalidResponses,
        )
        router.add_api_route(
            "/shops/{shop_id}/experiments",
            list_experiments,
            methods=["GET"],
            response_model=ExperimentListResponse,
            operation_id="listExperiments",
            summary="List a shop's experiments, most recently started first",
            responses=NotFoundResponses | InvalidResponses,
        )
        router.add_api_route(
            "/shops/{shop_id}/experiments/{experiment_id}",
            get_experiment,
            methods=["GET"],
            response_model=ExperimentResponse,
            operation_id="getExperiment",
            summary="Retrieve one experiment, its arms, and every turn they received",
            responses=NotFoundResponses | InvalidResponses,
        )
        router.add_api_route(
            "/shops/{shop_id}/experiments/{experiment_id}/timeline",
            get_experiment_timeline,
            methods=["GET"],
            response_model=ExperimentTimelineResponse,
            operation_id="getExperimentTimeline",
            summary="Read this experiment's execution as one normalized stream",
            description=(
                "Both arms' customer turns, agent attempts, tool calls, and the scenario "
                "faults that fired into them, in one ordered, framework-neutral stream, each "
                "entry carrying the project-owned source "
                "location of the code that ran it where this build can resolve one. Projected "
                "from the records `getExperiment` serves rather than stored beside them, so "
                "the timeline can never describe an experiment differently from its threads. "
                "Deliberately carries no message body: what was said is the thread's, and "
                "what happened is this."
            ),
            responses=NotFoundResponses | InvalidResponses,
        )
        router.add_api_route(
            "/shops/{shop_id}/experiments/{experiment_id}/traces",
            get_experiment_traces,
            methods=["GET"],
            response_model=ExperimentTracesResponse,
            operation_id="getExperimentTraces",
            summary="Read the recorded span tree of every attempt both arms made",
            description=(
                "One trace per recorded attempt: the advance, the framework's turn inside "
                "it, and every tool call it made, each carrying where inside the attempt it "
                "ran. Unlike the timeline beside it, this is stored rather than projected — "
                "an attempt and its calls are timestamped from one reading of the clock, so "
                "how the attempt's milliseconds were spent is not recoverable from the "
                "record afterwards. A stored span carries no attribute of its own: which "
                "tool it timed and what that tool answered are joined from the same tool "
                "events `getExperiment` serves. An attempt made before this lab traced "
                "anything reports no trace rather than an invented one."
            ),
            responses=NotFoundResponses | InvalidResponses,
        )
        router.add_api_route(
            "/shops/{shop_id}/experiments/{experiment_id}/evaluation",
            get_experiment_evaluation,
            methods=["GET"],
            response_model=ExperimentEvaluationResponse,
            operation_id="getExperimentEvaluation",
            summary="Judge each arm against the objectives its scenario composed",
            description=(
                "Every bound objective, per arm, decided from that arm's own recorded calls "
                "and the sandbox it started in and is in now — read against the objective "
                "template versions the scenario version pinned. Deterministic evidence is "
                "monotone, so an objective nothing has met yet is pending rather than "
                "missed until the arm reaches its scenario's turn cap and can no longer act. "
                "An objective a judge decides, or one whose evidence this build does not "
                "read, says so in its own row rather than counting as a miss."
            ),
            responses=NotFoundResponses | InvalidResponses,
        )
        router.add_api_route(
            "/shops/{shop_id}/experiments/{experiment_id}/judgements",
            score_experiment,
            methods=["POST"],
            status_code=201,
            response_model=ExperimentEvaluationResponse,
            operation_id="scoreExperiment",
            summary="Score every objective this scenario left to a judge, in every arm",
            description=(
                "Runs one published judge over each arm's own record, one execution per "
                "objective per arm, and answers with the whole evaluation as it now reads. "
                "Each execution is shown an anonymized brief carrying what that arm did and "
                "said and nothing about what ran it, and the verdict is recorded with the "
                "judge version, the model, and the fingerprint of that exact input. Scoring "
                "again writes a new attempt beside the last rather than over it, so a rerun "
                "is readable as a rerun. A judge execution that fails is recorded and leaves "
                "its objective deferred — the lab's own outage never counts against an arm — "
                "while a provider this lab cannot reach at all is a 422 and records nothing."
            ),
            responses={
                404: {
                    "model": ErrorResponse,
                    "description": "The experiment or the named judge is not found",
                },
                409: {
                    "model": ErrorResponse,
                    "description": "Another scoring pass wrote the attempt this one numbered; "
                    "read the evaluation and score again",
                },
                422: {
                    "model": ErrorResponse,
                    "description": "The judge has no published version, or no runtime for its "
                    "provider is available here",
                },
            },
        )
        router.add_api_route(
            "/shops/{shop_id}/experiments/{experiment_id}/participant-turns",
            deliver_participant_turn,
            methods=["POST"],
            status_code=201,
            response_model=ParticipantTurnListResponse,
            operation_id="deliverParticipantTurn",
            summary="Deliver one customer turn to one or both arms",
            description=(
                "One call is one composition however many arms it reaches, so the turns it "
                "writes share a composition identifier. Two calls are two compositions even "
                "when the words match, which is what makes divergent replies readable later."
            ),
            responses={
                404: {
                    "model": ErrorResponse,
                    "description": "The experiment or one of the named arms is not found",
                },
                422: {
                    "model": ErrorResponse,
                    "description": "The driver has no turn to deliver, does not drive this "
                    "experiment, or an arm has answered every turn its scenario allows",
                },
            },
        )
        router.add_api_route(
            "/shops/{shop_id}/experiments/{experiment_id}/annotations",
            get_experiment_annotations,
            methods=["GET"],
            response_model=ExperimentAnnotationsResponse,
            operation_id="getExperimentAnnotations",
            summary="Read the notes and tags written on this experiment",
            description=(
                "What an operator concluded about a run, stored beside the record rather "
                "than inside it: annotating an experiment never moves the document it is "
                "fingerprinted from. Read separately from the experiment because it has its "
                "own lifecycle — the run is finished, and this is not."
            ),
            responses=AnnotationNotFoundResponses | InvalidResponses,
        )
        router.add_api_route(
            "/shops/{shop_id}/experiments/{experiment_id}/notes",
            add_experiment_note,
            methods=["POST"],
            status_code=201,
            response_model=ExperimentAnnotationsResponse,
            operation_id="addExperimentNote",
            summary="Write one note about this experiment",
            description=(
                "Appended and never edited, for the reason a judge execution is never "
                "overwritten: a note is what a reviewer thought when they read the run. "
                "Deliberately not idempotent — two reviewers who wrote the same sentence "
                "wrote two notes. Answers with everything written on the run."
            ),
            responses=NoteResponses,
        )
        router.add_api_route(
            "/shops/{shop_id}/experiments/{experiment_id}/tags",
            set_experiment_tags,
            methods=["PUT"],
            response_model=ExperimentAnnotationsResponse,
            operation_id="setExperimentTags",
            summary="Replace the tags this experiment is filed under",
            description=(
                "The whole set rather than one tag at a time: the operator is saying what "
                "the chips should be. Each value is folded to lowercase kebab-case so a "
                "shelf has one spelling, and setting the same set again changes nothing. "
                "Answers with everything written on the run."
            ),
            responses=TagResponses,
        )
        router.add_api_route(
            "/shops/{shop_id}/experiments/{experiment_id}/replays",
            replay_experiment,
            methods=["POST"],
            status_code=201,
            response_model=ExperimentResponse,
            operation_id="replayExperiment",
            summary="Derive a new experiment that re-runs this one as it was recorded",
            description=(
                "Clones the snapshot this experiment froze rather than freezing the world "
                "again, so the derived arms start at the same `sandbox_fingerprint` however "
                "far the shop's orders and definitions have moved since; pins each arm to "
                "the exact agent-configuration version this run pinned, because choosing a "
                "newer one is a fork rather than a replay; and drives the derived arms "
                "through the compositions this run recorded, to the same arms, at the same "
                "depths, advancing each arm as often as it was advanced then. The derived "
                "experiment records `scripted` as its participant driver, because that is "
                "what produced its turns, and answers with itself. Deliberately not "
                "idempotent: replaying one run twice is two derived experiments. Nothing "
                "about the replayed experiment changes — the derived run has its own arms, "
                "its own sandboxes, and its own evidence. A model-backed arm will not answer "
                "identically; what a replay reproduces is the input."
            ),
            responses={
                404: {
                    "model": ErrorResponse,
                    "description": "The experiment is not found in this shop",
                },
                422: {
                    "model": ErrorResponse,
                    "description": "The derived experiment cannot be started, or no runtime "
                    "for an arm's framework is available here",
                },
            },
        )
        router.add_api_route(
            "/shops/{shop_id}/experiments/{experiment_id}/runs/{run_id}/agent-turns",
            advance_run,
            methods=["POST"],
            status_code=201,
            response_model=RunTurnResponse,
            operation_id="advanceExperimentRun",
            summary="Run this arm's agent against the customer turn it has not answered",
            description=(
                "Resolves the arm's pinned configuration, renders its prompt against the shop "
                "and support-identity versions the experiment froze, and runs the framework "
                "against this arm's own sandbox with exactly the tools the configuration "
                "enables. Answers with the attempt, every tool call it made, and every "
                "scenario fault that fired into this arm while it worked. Idempotent "
                "over an answer and not over an attempt: an arm whose latest customer turn is "
                "already answered returns that answer and calls no model, while one whose last "
                "attempt failed makes a new attempt beside it. A framework failure is a "
                "recorded turn and a 201, because it is evidence about the run; a framework "
                "this lab cannot run at all is a 422, because it is not."
            ),
            responses={
                404: {
                    "model": ErrorResponse,
                    "description": "The experiment or the named arm is not found",
                },
                422: {
                    "model": ErrorResponse,
                    "description": "No runtime for this arm's framework is available here",
                },
            },
        )


__all__ = ["ExperimentRoutes"]
