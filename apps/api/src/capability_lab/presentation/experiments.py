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
"""

from collections.abc import Callable, Generator
from typing import Annotated, Any, Self
from uuid import UUID

from fastapi import APIRouter, Depends, Path
from pydantic import Field

from capability_lab.application.agent_turns import AgentTurnRecord, ToolEventRecord
from capability_lab.application.definition_resolution import ResolvedDefinition
from capability_lab.application.experiment_runs import ExperimentRunner, RunTurn
from capability_lab.application.experiments import (
    MAX_ARMS,
    ArmSelection,
    ExperimentDetail,
    ExperimentPreview,
    ExperimentRecord,
    ExperimentService,
    ParticipantTurnRecord,
    RunRecord,
    StartExperiment,
)
from capability_lab.application.participants import ParticipantDriver
from capability_lab.application.sandbox_tools import ToolOutcome
from capability_lab.application.sandboxes import SandboxRecord
from capability_lab.domain.agent_turn import AgentTurnFailure, AgentTurnOutcome
from capability_lab.domain.content import MAX_LABEL_LENGTH
from capability_lab.domain.entities import MAX_SCENARIO_SEED, MIN_SCENARIO_SEED
from capability_lab.domain.experiment import (
    MAX_PARTICIPANT_TURN_LENGTH,
    ComparisonDimension,
    ComparisonVariable,
    ParticipantDriverType,
    ParticipantTurnSource,
)
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


class ExperimentRunSchema(StrictApiModel):
    """One arm: what it runs, where it works, and how far its world has moved.

    The two fingerprints are the arm's own, read off the sandbox rather than restated:
    `snapshot_fingerprint` is where it started and agrees with every sibling arm forever;
    `state_fingerprint` is where it is now and stops agreeing the moment something writes.
    """

    run_id: UUID
    position: int
    label: str
    agent_configuration_id: UUID
    agent_configuration_version: int
    sandbox_id: UUID
    revision: int
    snapshot_fingerprint: str
    state_fingerprint: str

    @classmethod
    def from_records(cls, run: RunRecord, sandbox: SandboxRecord) -> Self:
        return cls(
            run_id=run.run_id,
            position=run.position,
            label=run.label,
            agent_configuration_id=run.agent_configuration_id,
            agent_configuration_version=run.agent_configuration_version,
            sandbox_id=run.sandbox_id,
            revision=sandbox.revision,
            snapshot_fingerprint=sandbox.snapshot_fingerprint,
            state_fingerprint=sandbox.state_fingerprint,
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
        )


class RunTurnResponse(StrictApiModel):
    """What advancing one arm produced: the attempt, and the calls it made."""

    turn: AgentTurnSchema
    tool_events: list[ToolEventSchema]

    @classmethod
    def from_domain(cls, produced: RunTurn) -> Self:
        return cls(
            turn=AgentTurnSchema.from_record(produced.turn),
            tool_events=[ToolEventSchema.from_record(event) for event in produced.tool_events],
        )


class ExperimentResponse(ExperimentSummarySchema):
    """One experiment in full: the versions it pinned, its arms, and their threads."""

    sandbox_inputs: list[ResolvedDefinitionSchema]
    arm_inputs: list[list[ResolvedDefinitionSchema]]
    tool_contracts: dict[str, str]
    comparison: list[ComparisonVariableSchema]
    runs: list[ExperimentRunSchema]
    turns: list[ParticipantTurnSchema]
    agent_turns: list[AgentTurnSchema]
    tool_events: list[ToolEventSchema]

    @classmethod
    def from_detail(cls, detail: ExperimentDetail) -> Self:
        resolution = detail.resolution
        sandboxes = {sandbox.sandbox_id: sandbox for sandbox in detail.sandboxes}
        return cls(
            **ExperimentSummarySchema.from_record(detail.record).model_dump(),
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
                ExperimentRunSchema.from_records(run, sandboxes[run.sandbox_id])
                for run in detail.runs
            ],
            turns=[ParticipantTurnSchema.from_record(turn) for turn in detail.turns],
            agent_turns=[AgentTurnSchema.from_record(turn) for turn in detail.agent_turns],
            tool_events=[ToolEventSchema.from_record(event) for event in detail.tool_events],
        )


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
    ) -> None:
        self._service = service
        self._driver = driver
        self._runner = runner

    def register(self, router: APIRouter) -> None:
        dependency = Depends(self._service)
        runner_dependency = Depends(self._runner)

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
                    "description": "The driver has no turn to deliver, or does not drive this "
                    "experiment",
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
                "enables. Answers with the attempt and every tool call it made. Idempotent "
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
