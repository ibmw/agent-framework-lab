"""What a judge cannot do to an evaluation: fail into it, rerun over it, or be recognized.

Milestone 5's last outcome asks for judge failure and rerun to be tested *separately* from
the deterministic outcome calculation, and its two acceptance criteria say what separately
has to mean: deterministic evidence stays readable and unchanged when a judge is unavailable
or rerun, and every judge output is tied to a model, a prompt, a rubric, and an input
fingerprint while the input itself names none of what ran the arm.

The suites that landed with ADR 0031 prove each mechanism once, at the point it was written.
This one proves the *properties* over the whole set, and it is built the way ADR 0023 built
the tool sweep — from the declared tables rather than from lists somebody thought of:

- every failure this lab records is swept, and the table is asserted to cover
  `JudgeFailure` and every classified error the port declares, so an adapter that gains a
  new way to break joins these tests on the day it declares it;
- every framework the lab has proven is swept for anonymity, from `PROVEN_FRAMEWORKS`
  rather than from a list of words, so a second framework is checked the day it is
  declared; and
- the deterministic reading is compared as the canonical bytes of *every field* of every
  rule-decided row, built from `ObjectiveResult`'s own field list, so a field added to a
  row joins the comparison without an edit here.
"""

from collections.abc import Generator, Mapping
from dataclasses import fields
from decimal import Decimal
from pathlib import Path
from types import MappingProxyType
from typing import cast
from uuid import UUID, uuid4

import pytest
from pydantic_ai.messages import ModelMessage, ModelResponse, TextPart
from pydantic_ai.models.function import AgentInfo, FunctionModel
from sqlalchemy.orm import Session

from agent_factories import READ_TOOL_NAMES, model_settings
from block_factories import parameter, publishable_objective, severity_parameter
from capability_lab.application.agent_capabilities import (
    FAKE_FRAMEWORK_ID,
    PROVEN_FRAMEWORKS,
    PROVEN_FRAMEWORKS_BY_ID,
    ProvenFramework,
)
from capability_lab.application.agent_runtime import (
    SupportAgentRuntime,
    SupportAgentRuntimeRegistry,
)
from capability_lab.application.canonical_json import CanonicalValue, canonical_json_bytes
from capability_lab.application.evaluation import ExperimentEvaluation
from capability_lab.application.experiments import (
    ArmSelection,
    ExperimentDetail,
    StartExperiment,
)
from capability_lab.application.judge_brief import judge_brief_fingerprint
from capability_lab.application.judge_capabilities import OPENAI_JUDGE_PROVIDER
from capability_lab.application.judge_configurations import JudgeConfigurationService
from capability_lab.application.judge_runtime import (
    JudgeProviderError,
    JudgeRequest,
    JudgeResponseError,
    JudgeRuntime,
    JudgeRuntimeError,
    JudgeRuntimeRegistry,
    JudgeTransientError,
    JudgeUnavailableError,
    JudgeVerdict,
)
from capability_lab.application.judgements import JudgementRecord
from capability_lab.application.sandbox_tool_contracts import (
    ADDRESS_CHANGE_APPLY,
    ADDRESS_CHANGE_PROPOSE,
    INTERACTION_CONTEXT,
    ORDER_DETAIL,
)
from capability_lab.domain.blocks import (
    BlockParameterKind,
    ObjectiveAssessment,
    ObjectiveEvidence,
    ObjectiveSeverity,
)
from capability_lab.domain.evaluation import ArmEvaluation, ObjectiveOutcome, ObjectiveResult
from capability_lab.domain.judge import (
    JudgeConfigurationPayload,
    JudgeEvidenceScope,
    JudgeModel,
    JudgeOutcome,
)
from capability_lab.domain.judgement import JudgeFailure, Judgement
from capability_lab.domain.scenario import BoundObjective, ScenarioBinding
from capability_lab.infrastructure.agents.fake import FakeSupportAgentRuntime
from capability_lab.infrastructure.agents.openai_agents import OpenAiAgentsSupportAgentRuntime
from capability_lab.infrastructure.agents.pydantic_ai import PydanticAiSupportAgentRuntime
from capability_lab.infrastructure.database import (
    Base,
    create_database_engine,
    create_session_factory,
    session_scope,
)
from capability_lab.infrastructure.judges import PydanticAiJudgeRuntime
from capability_lab.infrastructure.participants.human import HumanParticipantDriver
from capability_lab.infrastructure.repositories import (
    SqlAlchemyJudgementRepository,
    judge_configuration_repository,
)
from judge_factories import publishable_judge
from workspace_factories import (
    SEED,
    AdvancingClock,
    Workspace,
    author,
    build_evaluation,
    build_experiments,
    build_judge_service,
    build_runner,
    publish_prerequisites,
    published_configuration,
    published_identity,
    read_check,
    seed_workspace,
)

RESOLVED = "resolve-the-incident"
EXPLAINED = "explain-what-changed"
IDENTIFIED = "identify-the-order"
REDIRECTED = "redirect-the-order"
READ_POLICY = "read-shipping-policy"

DETERMINISTIC_ROWS = (READ_POLICY, IDENTIFIED, REDIRECTED)
JUDGED_ROWS = (RESOLVED, EXPLAINED)


@pytest.fixture
def session(tmp_path: Path) -> Generator[Session, None, None]:
    engine = create_database_engine(f"sqlite:///{tmp_path / 'independence.db'}")
    Base.metadata.create_all(engine)
    with session_scope(create_session_factory(engine)) as active:
        yield active


@pytest.fixture
def workspace(session: Session) -> Workspace:
    return seed_workspace(session)


# -- the experiment every property is read off ----------------------------------


def published_block(workspace: Workspace, name: str, **template: object) -> UUID:
    created = workspace.objectives.create_block(name)
    block_id = created.definition.id
    workspace.objectives.replace_block(block_id, publishable_objective(name=name, **template))
    workspace.objectives.publish(block_id)
    return block_id


def judged_block(workspace: Workspace, name: str) -> UUID:
    """A template no rule can decide, so its row is only ever a judge's."""
    return published_block(
        workspace,
        name,
        assessment=ObjectiveAssessment.JUDGE,
        evidence=ObjectiveEvidence.DIMENSION,
        parameters=(),
    )


def objectives(workspace: Workspace) -> tuple[BoundObjective, ...]:
    """Three rows a rule decides and two a judge does, in one scenario.

    Three deterministic rows rather than one, because the property under test is that the
    *whole* rule-decided reading is unmoved: one pending, one met from a call, and one met
    from what the arm's world became — the three shapes ADR 0030 reads.
    """
    entity_block = published_block(
        workspace,
        IDENTIFIED,
        parameters=(
            parameter("doc_ref", kind=BlockParameterKind.ENTITY_REFERENCE),
            severity_parameter(),
        ),
    )
    state_block = published_block(
        workspace,
        REDIRECTED,
        evidence=ObjectiveEvidence.STATE,
        parameters=(
            parameter("doc_ref", kind=BlockParameterKind.DATA_REFERENCE),
            severity_parameter(),
        ),
    )
    return (
        read_check(workspace),
        BoundObjective(
            id=IDENTIFIED,
            block_id=entity_block,
            bindings=(ScenarioBinding(parameter="doc_ref", value=f"order:{workspace.order_id}"),),
        ),
        BoundObjective(
            id=REDIRECTED,
            block_id=state_block,
            bindings=(
                ScenarioBinding(
                    parameter="doc_ref", value=f"order:{workspace.order_id}#shipping_address"
                ),
            ),
        ),
        BoundObjective(
            id=RESOLVED,
            block_id=judged_block(workspace, RESOLVED),
            severity=ObjectiveSeverity.REQUIRED,
        ),
        BoundObjective(
            id=EXPLAINED,
            block_id=judged_block(workspace, EXPLAINED),
            severity=ObjectiveSeverity.EXPECTED,
        ),
    )


def arm(
    session: Session,
    framework: ProvenFramework,
    tools: tuple[str, ...] = READ_TOOL_NAMES,
) -> ArmSelection:
    """One published configuration running exactly what the catalog declares for it."""
    return published_configuration(
        session,
        published_identity(session),
        framework_id=framework.framework_id,
        architecture=next(iter(sorted(framework.architectures))),
        model=model_settings(
            provider=next(iter(sorted(framework.providers))),
            model_id=framework.models[0],
            max_tool_rounds=24,
        ),
        tools=tools,
    )


# What the anonymity sweep offers each arm. Narrower than the control arm's set on purpose:
# the offline model behind the Pydantic AI runtime answers by echoing every tool result it
# received, so a wide set produces a reply longer than a turn may hold and the arm records a
# failed attempt instead of words (ADR 0026). Two tools keep every framework in the sweep
# contributing both halves of a brief — what it said and what it called.
SWEPT_TOOLS: tuple[str, ...] = (INTERACTION_CONTEXT, ORDER_DETAIL)


# What the control arm may do. The write tools are here so the scenario's state row is a row
# something actually decides: an arm that can only read never moves its world, and a
# "unchanged" proved over three pending rows would be proved over the easy case.
CONTROL_TOOLS: tuple[str, ...] = (*READ_TOOL_NAMES, ADDRESS_CHANGE_PROPOSE, ADDRESS_CHANGE_APPLY)


def control_arm(session: Session) -> ArmSelection:
    """The offline framework, named out of the catalog like every other arm here."""
    return arm(session, PROVEN_FRAMEWORKS_BY_ID[FAKE_FRAMEWORK_ID], CONTROL_TOOLS)


def runtimes() -> SupportAgentRuntimeRegistry:
    """Every framework the catalog declares, each running offline in this process.

    Built by hand rather than through composition so the sweep below fails loudly when a
    framework joins the catalog with nothing here to run it: an arm the registry cannot
    answer for is refused before anything is recorded (ADR 0026), which would leave the
    anonymity sweep proving nothing about the framework it just declared.
    """
    registered: tuple[SupportAgentRuntime, ...] = (
        FakeSupportAgentRuntime(),
        PydanticAiSupportAgentRuntime.for_test(),
        OpenAiAgentsSupportAgentRuntime.for_test(),
    )
    return SupportAgentRuntimeRegistry({runtime.framework_id: runtime for runtime in registered})


def start(session: Session, workspace: Workspace, *arms: ArmSelection) -> ExperimentDetail:
    publish_prerequisites(workspace)
    scenario_id = author(workspace, objectives=objectives(workspace))
    version = workspace.scenarios.publish_scenario(workspace.shop_id, scenario_id)
    return build_experiments(session).start(
        workspace.shop_id,
        StartExperiment(
            label="Wrong shipping address",
            scenario_id=scenario_id,
            scenario_version=version.published.version,
            seed=SEED,
            arms=arms,
        ),
    )


async def advance(
    session: Session, detail: ExperimentDetail, position: int = 0
) -> ExperimentDetail:
    """Advance one arm and hand back the experiment as it now reads.

    An `ExperimentDetail` is a reading taken at a moment (ADR 0027), so a suite that kept the
    one `start` returned would build every brief out of a record from before the arm ran.
    """
    run = detail.runs[position]
    await build_runner(session, runtimes()).advance(run.shop_id, run.experiment_id, run.run_id)
    return reread(session, detail)


def reread(session: Session, detail: ExperimentDetail) -> ExperimentDetail:
    return build_experiments(session).get_experiment(
        detail.record.shop_id, detail.record.experiment_id
    )


def say(session: Session, detail: ExperimentDetail, message: str) -> None:
    build_experiments(session).deliver_turn(
        detail.record.shop_id,
        detail.record.experiment_id,
        tuple(run.run_id for run in detail.runs),
        HumanParticipantDriver(message),
    )


async def score(
    session: Session,
    detail: ExperimentDetail,
    judge_id: UUID,
    runtime: JudgeRuntime | None = None,
) -> ExperimentEvaluation:
    registry = None if runtime is None else JudgeRuntimeRegistry({runtime.provider: runtime})
    return await build_judge_service(session, registry).score(
        detail.record.shop_id, detail.record.experiment_id, judge_id
    )


def evaluate(session: Session, detail: ExperimentDetail) -> tuple[ArmEvaluation, ...]:
    return (
        build_evaluation(session).evaluate(detail.record.shop_id, detail.record.experiment_id).arms
    )


def stored(session: Session, detail: ExperimentDetail) -> tuple[JudgementRecord, ...]:
    """Every execution the store holds for this experiment, bound to the arm that read it."""
    return SqlAlchemyJudgementRepository(session).list_for_experiment(detail.record.experiment_id)


def executions(session: Session, detail: ExperimentDetail) -> tuple[Judgement, ...]:
    """The same, narrowed to what each execution produced."""
    return tuple(record.judgement for record in stored(session, detail))


def row(evaluation: ArmEvaluation, objective_id: str) -> ObjectiveResult:
    return next(result for result in evaluation.results if result.objective_id == objective_id)


class StubJudge(JudgeRuntime):
    """A judge whose answer the test decides, so what is under test is the recording."""

    def __init__(
        self,
        verdict: JudgeVerdict | None = None,
        error: Exception | None = None,
        *,
        by_objective: Mapping[str, JudgeVerdict] | None = None,
    ) -> None:
        self._verdict = verdict or JudgeVerdict(outcome=JudgeOutcome.MET, rationale="it resolved")
        self._error = error
        self._by_objective = by_objective
        self.requests: list[JudgeRequest] = []

    @property
    def provider(self) -> str:
        return "fake"

    async def score(self, request: JudgeRequest) -> JudgeVerdict:
        self.requests.append(request)
        if self._error is not None:
            raise self._error
        if self._by_objective is not None:
            return self._by_objective[asked_about(request)]
        return self._verdict


def asked_about(request: JudgeRequest) -> str:
    objective = request.brief["objective"]
    assert isinstance(objective, dict)
    identifier = objective["id"]
    assert isinstance(identifier, str)
    return identifier


# -- the deterministic reading, as bytes ----------------------------------------


def _readable(value: object) -> CanonicalValue:
    """One field of one row, rendered so the canonical serializer can take its bytes."""
    if isinstance(value, Judgement):
        return {field.name: _readable(getattr(value, field.name)) for field in fields(Judgement)}
    if isinstance(value, UUID):
        return str(value)
    if isinstance(value, bool) or value is None or isinstance(value, int | str):
        return value
    return str(value)


def _row(result: ObjectiveResult) -> dict[str, CanonicalValue]:
    """Every field of a row, read off `ObjectiveResult` rather than listed.

    A field added to a result therefore joins this comparison the day it is declared, which
    is the ADR 0023 rule applied to a golden: what makes "unchanged" worth asserting is that
    nothing is quietly outside it.
    """
    return {field.name: _readable(getattr(result, field.name)) for field in fields(ObjectiveResult)}


def deterministic_rows(arms: tuple[ArmEvaluation, ...]) -> tuple[ObjectiveResult, ...]:
    """Every row of every arm that a rule decided, in scenario order."""
    return tuple(
        result
        for evaluation in arms
        for result in evaluation.results
        if result.assessment is not ObjectiveAssessment.JUDGE
    )


def deterministic_reading(arms: tuple[ArmEvaluation, ...]) -> bytes:
    """The exact bytes of the rule-decided reading of an experiment.

    Compared as bytes rather than field by field so that *any* judge state reaching a
    deterministic row — an outcome, a sentence, a verdict attached to the result — moves the
    comparison instead of being missed by an assertion nobody thought to write.
    """
    return canonical_json_bytes(
        {
            "arms": [
                {
                    "run_id": str(evaluation.run_id),
                    "settled": evaluation.settled,
                    "rows": [
                        _row(result)
                        for result in evaluation.results
                        if result.assessment is not ObjectiveAssessment.JUDGE
                    ],
                }
                for evaluation in arms
            ]
        }
    )


# -- what the failure sweep is over ---------------------------------------------

# Every way a judge execution can end without a verdict, and what the record must call it.
# The keys are the sentence a reader needs; the values are what the port declares. Asserted
# below to cover `JudgeFailure` exactly and every classified error the port publishes, so an
# adapter that gains a way to break joins this sweep rather than waiting to be remembered.
RECORDED_FAILURES: Mapping[str, tuple[Exception, JudgeFailure]] = MappingProxyType(
    {
        "the provider rejected the request": (
            JudgeProviderError("the provider refused"),
            JudgeFailure.PROVIDER,
        ),
        "the provider was briefly unavailable": (
            JudgeTransientError("try again later"),
            JudgeFailure.TRANSIENT,
        ),
        "the verdict could not be read": (
            JudgeResponseError("the judge answered in an unusable shape"),
            JudgeFailure.INVALID_RESPONSE,
        ),
        "an adapter classified nothing": (
            JudgeRuntimeError("an adapter that classified nothing"),
            JudgeFailure.INVALID_RESPONSE,
        ),
        "an adapter raised what it never declared": (
            RuntimeError("something the adapter never classified"),
            JudgeFailure.INVALID_RESPONSE,
        ),
    }
)


def classified_errors() -> set[type[JudgeRuntimeError]]:
    """Every error class the port declares, walked to the leaves.

    Recursive rather than `__subclasses__()` alone, because the port's whole design is that
    an adapter classifies by subclassing: a refinement under `JudgeTransientError` — a
    timeout, say — is exactly the shape a future adapter adds, and a direct-children check
    would let it in without ever being raised through the recorder.

    Resolved when the test runs rather than at import, so this set is the port's own
    declarations plus whatever the *running suite* has defined under them. A subclass
    written in another module to stand in for a provider is then a subclass this sweep is
    asked about, which is the honest reading of "every classified error this lab has".
    """
    found: set[type[JudgeRuntimeError]] = {JudgeRuntimeError}
    pending = [JudgeRuntimeError]
    while pending:
        for subclass in pending.pop().__subclasses__():
            if subclass not in found:
                found.add(subclass)
                pending.append(subclass)
    return found


def test_the_failure_sweep_covers_every_way_an_execution_can_end_without_a_verdict() -> None:
    """The non-vacuity check ADR 0023 made a rule: a sweep asserts what it swept.

    Two claims. Every code the record can carry is exercised, so a failure this lab can
    write is never outside these tests; and every classified error the port declares —
    including one declared under another — is raised through the recorder, so an error class
    added beside them fails here rather than quietly going untested.
    """
    assert RECORDED_FAILURES
    assert {failure for _, failure in RECORDED_FAILURES.values()} == set(JudgeFailure)
    raised = {type(error) for error, _ in RECORDED_FAILURES.values()}
    declared = classified_errors()
    assert declared <= raised
    assert raised - declared, "a sweep of declared errors alone never sees a bug"


@pytest.mark.asyncio
async def test_the_reading_these_sweeps_compare_is_three_rows_a_rule_actually_decided(
    session: Session, workspace: Workspace
) -> None:
    """The other half of non-vacuity: bytes that never held anything cannot change.

    Asserted against a real experiment rather than against the constants above, because what
    the sweeps compare is what this scenario produces — three rows no judge owns, one of each
    shape ADR 0030 reads, and none of them silently absent.
    """
    detail = start(session, workspace, control_arm(session), control_arm(session))
    detail = await advance(session, detail)
    arms = evaluate(session, detail)

    rows = deterministic_rows(arms)
    assert len(rows) == len(DETERMINISTIC_ROWS) * len(arms)
    assert {result.objective_id for result in rows} == set(DETERMINISTIC_ROWS)
    assert all(result.assessment is not ObjectiveAssessment.JUDGE for result in rows)
    assert set(DETERMINISTIC_ROWS) & set(JUDGED_ROWS) == set()
    driven = arms[0]
    assert row(driven, READ_POLICY).outcome is ObjectiveOutcome.PENDING
    assert row(driven, IDENTIFIED).outcome is ObjectiveOutcome.MET
    assert row(driven, REDIRECTED).outcome is ObjectiveOutcome.MET
    # And the rendering is sensitive to what it renders: the arm nobody drove holds the same
    # row at a different outcome, and the bytes say so. A comparison that could not tell these
    # two apart could not have told any of the sweeps above apart either.
    assert _row(row(driven, IDENTIFIED)) != _row(row(arms[1], IDENTIFIED))


# -- a judge that failed changed nothing ----------------------------------------


@pytest.mark.asyncio
@pytest.mark.parametrize("mode", sorted(RECORDED_FAILURES))
async def test_a_failed_execution_leaves_the_deterministic_reading_byte_for_byte(
    session: Session, workspace: Workspace, mode: str
) -> None:
    """Every way a judge can break, against the whole rule-decided reading of both arms."""
    error, expected = RECORDED_FAILURES[mode]
    detail = start(session, workspace, control_arm(session), control_arm(session))
    await advance(session, detail, 0)
    before = deterministic_reading(evaluate(session, detail))

    await score(session, detail, published_control_judge(session), StubJudge(error=error))

    assert deterministic_reading(evaluate(session, detail)) == before
    for evaluation in evaluate(session, detail):
        for objective_id in JUDGED_ROWS:
            judged = row(evaluation, objective_id)
            assert judged.outcome is ObjectiveOutcome.DEFERRED
            assert judged.judgement is not None
            assert judged.judgement.failure is expected


@pytest.mark.asyncio
async def test_a_judge_this_lab_cannot_reach_leaves_the_reading_and_records_nothing(
    session: Session, workspace: Workspace
) -> None:
    """A missing key is a fact about the machine, so nothing about the arm may move."""
    detail = start(session, workspace, control_arm(session))
    await advance(session, detail)
    before = deterministic_reading(evaluate(session, detail))

    with pytest.raises(JudgeUnavailableError):
        await build_judge_service(session, JudgeRuntimeRegistry({})).score(
            detail.record.shop_id,
            detail.record.experiment_id,
            published_control_judge(session),
        )

    assert deterministic_reading(evaluate(session, detail)) == before
    assert executions(session, detail) == ()
    assert row(evaluate(session, detail)[0], RESOLVED).judgement is None


@pytest.mark.asyncio
async def test_a_model_answering_outside_the_vocabulary_reaches_the_record_as_a_failure(
    session: Session, workspace: Workspace
) -> None:
    """The whole chain, not the seam: a real adapter, a model that answered nonsense.

    The runtime suite proves the classification; this proves what the classification does to
    an evaluation — the row stays deferred, and no rule-decided row moves.
    """
    detail = start(session, workspace, control_arm(session))
    await advance(session, detail)
    before = deterministic_reading(evaluate(session, detail))

    await score(session, detail, published_openai_judge(session), answering("not a verdict"))

    assert deterministic_reading(evaluate(session, detail)) == before
    judged = row(evaluate(session, detail)[0], RESOLVED)
    assert judged.outcome is ObjectiveOutcome.DEFERRED
    assert judged.judgement is not None
    assert judged.judgement.failure is JudgeFailure.INVALID_RESPONSE


@pytest.mark.asyncio
@pytest.mark.parametrize("mode", sorted(RECORDED_FAILURES))
async def test_a_failed_execution_never_unmakes_the_verdict_that_stands(
    session: Session, workspace: Workspace, mode: str
) -> None:
    """A provider that refused said nothing about the arm, so it cannot erase a reading.

    The record keeps both — the verdict at attempt 1 and the failure at attempt 2 — and what
    the matrix reads is the last thing a judge actually said. Otherwise an outage this
    afternoon would silently delete evidence an operator paid a model to produce.
    """
    error, expected = RECORDED_FAILURES[mode]
    detail = start(session, workspace, control_arm(session))
    await advance(session, detail)
    judge_id = published_control_judge(session)
    await score(session, detail, judge_id, StubJudge())

    await score(session, detail, judge_id, StubJudge(error=error))

    judged = row(evaluate(session, detail)[0], RESOLVED)
    assert judged.outcome is ObjectiveOutcome.MET
    assert judged.judgement is not None
    assert judged.judgement.attempt == 1
    kept = [entry for entry in executions(session, detail) if entry.objective_id == RESOLVED]
    assert [(entry.attempt, entry.outcome, entry.failure) for entry in kept] == [
        (1, JudgeOutcome.MET, None),
        (2, None, expected),
    ]


# -- a judge rerun kept what it had ---------------------------------------------


@pytest.mark.asyncio
async def test_a_rerun_that_disagrees_keeps_both_readings_and_reports_the_newer(
    session: Session, workspace: Workspace
) -> None:
    """ "The judge changed its mind" is a fact this record can state, which is the point."""
    detail = start(session, workspace, control_arm(session))
    await advance(session, detail)
    judge_id = published_control_judge(session)
    await score(session, detail, judge_id, StubJudge(JudgeVerdict(JudgeOutcome.MET, "it did")))

    await score(
        session, detail, judge_id, StubJudge(JudgeVerdict(JudgeOutcome.MISSED, "it did not"))
    )

    judged = row(evaluate(session, detail)[0], RESOLVED)
    assert judged.outcome is ObjectiveOutcome.MISSED
    assert judged.judgement is not None
    assert judged.judgement.attempt == 2
    kept = [entry for entry in executions(session, detail) if entry.objective_id == RESOLVED]
    assert [(entry.attempt, entry.outcome) for entry in kept] == [
        (1, JudgeOutcome.MET),
        (2, JudgeOutcome.MISSED),
    ]


@pytest.mark.asyncio
async def test_a_row_only_ever_failed_on_reads_as_one_nothing_has_scored(
    session: Session, workspace: Workspace
) -> None:
    """The case the standing-verdict rule starts from, kept explicit.

    A failure stands only while nothing has been scored, and a later failure replaces an
    earlier one — so two outages read as the newer outage rather than as a verdict, and the
    row is still a row waiting for a judge.
    """
    detail = start(session, workspace, control_arm(session))
    await advance(session, detail)
    judge_id = published_control_judge(session)

    await score(session, detail, judge_id, StubJudge(error=JudgeProviderError("refused")))
    await score(session, detail, judge_id, StubJudge(error=JudgeTransientError("later")))

    judged = row(evaluate(session, detail)[0], RESOLVED)
    assert judged.outcome is ObjectiveOutcome.DEFERRED
    assert judged.judgement is not None
    assert judged.judgement.attempt == 2
    assert judged.judgement.failure is JudgeFailure.TRANSIENT
    assert judged.judgement.outcome is None


@pytest.mark.asyncio
async def test_a_verdict_after_a_failure_that_followed_a_verdict_is_the_one_that_stands(
    session: Session, workspace: Workspace
) -> None:
    """Three attempts, and the newest verdict wins — not the newest attempt, and not the first.

    The rule holds a verdict against an outage; it must not hold one against the operator
    who scored the row again on purpose.
    """
    detail = start(session, workspace, control_arm(session))
    await advance(session, detail)
    judge_id = published_control_judge(session)
    await score(session, detail, judge_id, StubJudge(JudgeVerdict(JudgeOutcome.MET, "it did")))
    await score(session, detail, judge_id, StubJudge(error=JudgeProviderError("down")))

    await score(
        session, detail, judge_id, StubJudge(JudgeVerdict(JudgeOutcome.MISSED, "on reflection"))
    )

    judged = row(evaluate(session, detail)[0], RESOLVED)
    assert judged.outcome is ObjectiveOutcome.MISSED
    assert judged.judgement is not None
    assert judged.judgement.attempt == 3
    kept = [entry for entry in executions(session, detail) if entry.objective_id == RESOLVED]
    assert [(entry.attempt, entry.outcome) for entry in kept] == [
        (1, JudgeOutcome.MET),
        (2, None),
        (3, JudgeOutcome.MISSED),
    ]


@pytest.mark.asyncio
async def test_a_rerun_after_a_failure_scores_the_row_the_failure_left_alone(
    session: Session, workspace: Workspace
) -> None:
    detail = start(session, workspace, control_arm(session))
    await advance(session, detail)
    judge_id = published_control_judge(session)
    before = deterministic_reading(evaluate(session, detail))
    await score(session, detail, judge_id, StubJudge(error=JudgeTransientError("later")))

    await score(session, detail, judge_id, StubJudge())

    judged = row(evaluate(session, detail)[0], RESOLVED)
    assert judged.outcome is ObjectiveOutcome.MET
    assert judged.judgement is not None
    assert judged.judgement.attempt == 2
    assert deterministic_reading(evaluate(session, detail)) == before


@pytest.mark.asyncio
async def test_scoring_a_row_again_never_moves_the_rule_decided_reading(
    session: Session, workspace: Workspace
) -> None:
    """Four readings of one experiment across four judge states, and one set of bytes."""
    detail = start(session, workspace, control_arm(session))
    await advance(session, detail)
    judge_id = published_control_judge(session)
    readings = [deterministic_reading(evaluate(session, detail))]

    for runtime in (
        StubJudge(error=JudgeProviderError("down")),
        StubJudge(JudgeVerdict(JudgeOutcome.MISSED, "it did not")),
        StubJudge(JudgeVerdict(JudgeOutcome.MET, "on reflection it did")),
    ):
        await score(session, detail, judge_id, runtime)
        readings.append(deterministic_reading(evaluate(session, detail)))

    assert len(readings) == 4
    assert len(set(readings)) == 1


# -- the separation itself -------------------------------------------------------


@pytest.mark.asyncio
@pytest.mark.parametrize("verdict", sorted(JudgeOutcome))
async def test_no_verdict_a_judge_can_return_moves_a_rule_decided_row(
    session: Session, workspace: Workspace, verdict: JudgeOutcome
) -> None:
    """Swept over the closed vocabulary, so a fourth value could not slip past unchecked."""
    detail = start(session, workspace, control_arm(session))
    await advance(session, detail)
    before = deterministic_reading(evaluate(session, detail))

    await score(
        session,
        detail,
        published_control_judge(session),
        StubJudge(JudgeVerdict(outcome=verdict, rationale="as the record reads")),
    )

    assert deterministic_reading(evaluate(session, detail)) == before
    assert row(evaluate(session, detail)[0], RESOLVED).judgement is not None


@pytest.mark.asyncio
async def test_a_verdict_recorded_against_a_rule_decided_row_is_not_read_into_it(
    session: Session, workspace: Workspace
) -> None:
    """The one code path that could leak, exercised rather than argued about.

    Verdicts are addressed by objective ID, and an objective ID is the scenario's own name
    for a row. A judgement carrying a *deterministic* row's name — a template republished
    with a different assessment, a scoring pass with a wider net, a hand-written row — must
    not reach that row, because what decides it is the record and nothing else.
    """
    detail = start(session, workspace, control_arm(session))
    await advance(session, detail)
    before = deterministic_reading(evaluate(session, detail))

    SqlAlchemyJudgementRepository(session).append_all(
        (
            JudgementRecord(
                run_id=detail.runs[0].run_id,
                experiment_id=detail.record.experiment_id,
                judgement=Judgement(
                    objective_id=IDENTIFIED,
                    judge_id=uuid4(),
                    judge_version=1,
                    provider="fake",
                    model_id="deterministic",
                    brief_fingerprint="a" * 64,
                    outcome=JudgeOutcome.MISSED,
                    rationale="a verdict on a row no judge owns",
                ),
                created_at=AdvancingClock().now(),
            ),
        )
    )

    assert deterministic_reading(evaluate(session, detail)) == before
    identified = row(evaluate(session, detail)[0], IDENTIFIED)
    assert identified.judgement is None
    assert identified.outcome is ObjectiveOutcome.MET


# -- the brief names nothing about what ran the arm ------------------------------


def framework_identity_terms() -> tuple[str, ...]:
    """Every word that would name what ran an arm, read off the declared catalog.

    Derived rather than listed for ADR 0023's reason and ADR 0031's: the publish gate builds
    its reserved terms from `PROVEN_FRAMEWORKS`, and the sweep that proves the *brief* is
    blind must be built from the same declaration — otherwise the day a second framework is
    proven, the gate refuses its name in a rubric while nothing checks it stays out of the
    input.
    """
    terms: set[str] = set()
    for framework in PROVEN_FRAMEWORKS:
        terms.add(framework.framework_id)
        terms.add(framework.label)
        terms.update(framework.models)
        terms.update(framework.providers)
        terms.update(architecture.value for architecture in framework.architectures)
    return tuple(sorted(terms, key=str.casefold))


def leaves(value: object) -> list[str]:
    """Every string anywhere in a document, keys included."""
    if isinstance(value, str):
        return [value]
    if isinstance(value, dict):
        found: list[str] = []
        for key, item in cast("dict[str, object]", value).items():
            found.append(str(key))
            found.extend(leaves(item))
        return found
    if isinstance(value, list):
        return [leaf for item in cast("list[object]", value) for leaf in leaves(item)]
    return []


def test_the_anonymity_sweep_is_over_the_catalog_and_not_over_a_list() -> None:
    """Non-vacuity: every declared framework contributes its own identity to the sweep."""
    terms = {term.casefold() for term in framework_identity_terms()}

    assert PROVEN_FRAMEWORKS
    assert terms
    for framework in PROVEN_FRAMEWORKS:
        assert framework.framework_id.casefold() in terms
        assert framework.label.casefold() in terms
        assert {model.casefold() for model in framework.models} <= terms
        assert {provider.casefold() for provider in framework.providers} <= terms


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "framework", PROVEN_FRAMEWORKS, ids=[entry.framework_id for entry in PROVEN_FRAMEWORKS]
)
async def test_the_brief_of_an_arm_names_nothing_the_catalog_declares_about_it(
    session: Session, workspace: Workspace, framework: ProvenFramework
) -> None:
    """One arm per proven framework, actually run, and the brief it was scored on.

    Read off a real scoring pass rather than rebuilt beside one. A helper that narrowed the
    arm's record itself would be the same *type* through different code, so a change to how
    the pass narrows an arm would never reach this sweep — and what the criterion is about is
    what a judge is actually handed. So the arm is scored with a judge published to see
    everything there is to see, and the sweep reads the documents the runtime received.

    A framework proven tomorrow is swept the day it is declared, and until this test runs its
    arm nothing here can pass by saying "framework" is absent from a document nobody produced.
    """
    detail = start(session, workspace, arm(session, framework, SWEPT_TOOLS))
    detail = await advance(session, detail)
    stub = StubJudge()

    await score(session, detail, published_omniscient_judge(session), stub)

    shown = [request.brief for request in stub.requests]
    assert shown, "an arm that was never scored proves nothing about anonymity"
    assert all(brief.get("agent_replies") and brief.get("tool_calls") for brief in shown), (
        "this arm recorded neither words nor calls to be judged on"
    )
    written = " ".join(leaf for brief in shown for leaf in leaves(dict(brief))).casefold()
    for term in framework_identity_terms():
        assert term.casefold() not in written
    assert detail.runs[0].label.casefold() not in written
    assert str(detail.runs[0].run_id) not in written
    assert str(detail.record.experiment_id) not in written


# -- every verdict names what produced it ----------------------------------------


@pytest.mark.asyncio
async def test_every_verdict_names_the_rubric_the_model_and_the_bytes_it_read(
    session: Session, workspace: Workspace
) -> None:
    """The acceptance criterion, checked on every row a pass filled rather than on one.

    "Model, prompt, rubric, input fingerprint": the provider and model are on the row, the
    rubric *is* the prompt and is resolved back out of the published version the row names,
    and the fingerprint is the SHA-256 of the bytes the runtime was handed.
    """
    detail = start(session, workspace, control_arm(session), control_arm(session))
    await advance(session, detail, 0)
    judge_id = published_control_judge(session)
    stub = StubJudge()

    await score(session, detail, judge_id, stub)

    published = JudgeConfigurationService(
        judge_configuration_repository(session), AdvancingClock()
    ).get_version(judge_id, 1)
    recorded = executions(session, detail)
    assert len(recorded) == len(JUDGED_ROWS) * len(detail.runs)
    # The fingerprint of the bytes the runtime was *actually handed*, on the row that was
    # handed them. A length check passes on a digest of the wrong brief, and a comparison of
    # unaddressed sets passes on two rows whose fingerprints were swapped; pairing is what
    # makes "this verdict was produced from this input" the thing being asserted. The pass
    # asks arm by arm and, within an arm, objective by objective (`judge_runs.score`), which
    # is what lets a request be addressed at all.
    handed = {
        (run.run_id, asked_about(request)): judge_brief_fingerprint(request.brief)
        for run, request in zip(
            [run for run in detail.runs for _ in JUDGED_ROWS], stub.requests, strict=True
        )
    }
    assert handed == {
        (record.run_id, record.judgement.objective_id): record.judgement.brief_fingerprint
        for record in stored(session, detail)
    }
    assert len(handed) == len(recorded)
    for judgement in recorded:
        assert judgement.judge_id == judge_id
        assert judgement.judge_version == 1
        assert judgement.provider == published.payload.model.provider
        assert judgement.model_id == published.payload.model.model_id
        assert len(judgement.brief_fingerprint) == 64
    assert {request.rubric for request in stub.requests} == {published.payload.rubric}


@pytest.mark.asyncio
async def test_a_fingerprint_moves_when_the_record_the_judge_reads_moves(
    session: Session, workspace: Workspace
) -> None:
    """What ties a verdict to an input has to *change* when the input does, or it ties nothing."""
    detail = start(session, workspace, control_arm(session))
    await advance(session, detail)
    judge_id = published_control_judge(session)
    await score(session, detail, judge_id, StubJudge())
    first = fingerprint_of(session, detail, RESOLVED, attempt=1)

    await score(session, detail, judge_id, StubJudge())
    unchanged = fingerprint_of(session, detail, RESOLVED, attempt=2)
    say(session, detail, "It still shows the Bordeaux address.")
    await score(session, detail, judge_id, StubJudge())
    moved = fingerprint_of(session, detail, RESOLVED, attempt=3)

    assert unchanged == first
    assert moved != first


def fingerprint_of(
    session: Session, detail: ExperimentDetail, objective_id: str, *, attempt: int
) -> str:
    entry = next(
        judgement
        for judgement in executions(session, detail)
        if judgement.objective_id == objective_id and judgement.attempt == attempt
    )
    return entry.brief_fingerprint


@pytest.mark.asyncio
async def test_a_judge_answers_about_the_row_it_was_shown_and_cannot_move_the_one_beside_it(
    session: Session, workspace: Workspace
) -> None:
    """A verdict is addressed by the brief the pass built, never by anything a judge said.

    The port returns an outcome and a reason and no row name, deliberately — so a judge that
    decided one objective cannot name another. This is that structural claim made
    falsifiable: two judged rows in one pass, two different answers, each landing where the
    brief asked.
    """
    detail = start(session, workspace, control_arm(session))
    await advance(session, detail)
    stub = StubJudge(
        by_objective={
            RESOLVED: JudgeVerdict(JudgeOutcome.MET, "the incident was resolved"),
            EXPLAINED: JudgeVerdict(JudgeOutcome.MISSED, "it never said what it changed"),
        }
    )

    await score(session, detail, published_control_judge(session), stub)

    (evaluation,) = evaluate(session, detail)
    assert row(evaluation, RESOLVED).outcome is ObjectiveOutcome.MET
    assert row(evaluation, EXPLAINED).outcome is ObjectiveOutcome.MISSED
    assert sorted(asked_about(request) for request in stub.requests) == sorted(JUDGED_ROWS)


# -- fixtures the module builds on ----------------------------------------------


def published_control_judge(session: Session) -> UUID:
    return published(session, publishable_judge())


def published_omniscient_judge(session: Session) -> UUID:
    """A judge declared to see every scope there is, so the sweep reads the widest brief."""
    return published(session, publishable_judge(evidence=tuple(JudgeEvidenceScope)))


def published_openai_judge(session: Session) -> UUID:
    return published(
        session,
        publishable_judge(
            model=JudgeModel(
                provider=OPENAI_JUDGE_PROVIDER,
                model_id="gpt-5-mini",
                temperature=Decimal("0.00"),
            )
        ),
    )


def published(session: Session, payload: JudgeConfigurationPayload) -> UUID:
    judges = JudgeConfigurationService(judge_configuration_repository(session), AdvancingClock())
    created = judges.create_judge(payload.name)
    judge_id = created.definition.id
    judges.replace_judge(judge_id, payload)
    judges.publish(judge_id)
    return judge_id


def answering(reply: str) -> PydanticAiJudgeRuntime:
    """The real adapter over a model whose answer this test decides."""

    async def respond(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        return ModelResponse(parts=[TextPart(content=reply)])

    return PydanticAiJudgeRuntime(lambda _model_id: FunctionModel(respond))
