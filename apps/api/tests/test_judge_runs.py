"""Scoring an experiment: what a judge is asked, what is recorded, and what a rerun does."""

from collections.abc import Generator
from pathlib import Path
from uuid import UUID, uuid4

import pytest
from sqlalchemy.orm import Session

from agent_factories import READ_TOOL_NAMES, model_settings
from block_factories import publishable_objective
from capability_lab.application.agent_capabilities import FAKE_FRAMEWORK_ID
from capability_lab.application.experiments import ArmSelection, ExperimentDetail, StartExperiment
from capability_lab.application.judge_configurations import JudgeConfigurationService
from capability_lab.application.judge_runs import JudgeUnpublishedError
from capability_lab.application.judge_runtime import (
    JudgeProviderError,
    JudgeRequest,
    JudgeRuntime,
    JudgeRuntimeError,
    JudgeRuntimeRegistry,
    JudgeUnavailableError,
    JudgeVerdict,
)
from capability_lab.application.judgements import JudgementConflictError
from capability_lab.application.sandbox_tool_contracts import (
    ADDRESS_CHANGE_APPLY,
    ADDRESS_CHANGE_PROPOSE,
)
from capability_lab.domain.blocks import ObjectiveAssessment, ObjectiveEvidence, ObjectiveSeverity
from capability_lab.domain.evaluation import ArmEvaluation, ObjectiveOutcome
from capability_lab.domain.judge import JudgeEvidenceScope, JudgeOutcome
from capability_lab.domain.judgement import JudgeFailure
from capability_lab.domain.scenario import BoundObjective
from capability_lab.infrastructure.database import (
    Base,
    create_database_engine,
    create_session_factory,
    session_scope,
)
from capability_lab.infrastructure.judges import ControlJudgeRuntime
from capability_lab.infrastructure.repositories import (
    SqlAlchemyJudgementRepository,
    judge_configuration_repository,
)
from judge_factories import control_model, publishable_judge
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
    published_judge,
    read_check,
    seed_workspace,
)

JUDGED_OBJECTIVE = "resolve-the-incident"


@pytest.fixture
def session(tmp_path: Path) -> Generator[Session, None, None]:
    engine = create_database_engine(f"sqlite:///{tmp_path / 'judging.db'}")
    Base.metadata.create_all(engine)
    with session_scope(create_session_factory(engine)) as active:
        yield active


@pytest.fixture
def workspace(session: Session) -> Workspace:
    return seed_workspace(session)


class StubJudge(JudgeRuntime):
    """A judge whose answer the test decides, so the recording is what is under test."""

    def __init__(self, verdict: JudgeVerdict | None = None, error: Exception | None = None) -> None:
        self._verdict = verdict or JudgeVerdict(outcome=JudgeOutcome.MET, rationale="it resolved")
        self._error = error
        self.requests: list[JudgeRequest] = []

    @property
    def provider(self) -> str:
        return "fake"

    async def score(self, request: JudgeRequest) -> JudgeVerdict:
        self.requests.append(request)
        if self._error is not None:
            raise self._error
        return self._verdict


def registry(runtime: JudgeRuntime) -> JudgeRuntimeRegistry:
    return JudgeRuntimeRegistry({runtime.provider: runtime})


def control_arm(session: Session) -> ArmSelection:
    return published_configuration(
        session,
        published_identity(session),
        framework_id=FAKE_FRAMEWORK_ID,
        model=model_settings(provider="fake", model_id="deterministic"),
        tools=(*READ_TOOL_NAMES, ADDRESS_CHANGE_PROPOSE, ADDRESS_CHANGE_APPLY),
    )


def judged_objective(workspace: Workspace) -> BoundObjective:
    """A bound objective whose template says a judge decides it, and nothing else can."""
    created = workspace.objectives.create_block("resolve-the-incident")
    block_id = created.definition.id
    workspace.objectives.replace_block(
        block_id,
        publishable_objective(
            name="resolve-the-incident",
            statement="Resolve the incident the customer opened",
            assessment=ObjectiveAssessment.JUDGE,
            evidence=ObjectiveEvidence.DIMENSION,
            parameters=(),
        ),
    )
    workspace.objectives.publish(block_id)
    return BoundObjective(
        id=JUDGED_OBJECTIVE, block_id=block_id, severity=ObjectiveSeverity.REQUIRED
    )


def start(session: Session, workspace: Workspace, *arms: ArmSelection) -> ExperimentDetail:
    objectives = (read_check(workspace), judged_objective(workspace))
    publish_prerequisites(workspace)
    scenario_id = author(workspace, objectives=objectives)
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


async def advance(session: Session, detail: ExperimentDetail, position: int = 0) -> None:
    run = detail.runs[position]
    await build_runner(session).advance(run.shop_id, run.experiment_id, run.run_id)


async def score(
    session: Session,
    detail: ExperimentDetail,
    judge_id: UUID,
    runtime: JudgeRuntime | None = None,
) -> None:
    service = build_judge_service(session, None if runtime is None else registry(runtime))
    await service.score(detail.record.shop_id, detail.record.experiment_id, judge_id)


def evaluate(session: Session, detail: ExperimentDetail) -> tuple[ArmEvaluation, ...]:
    return (
        build_evaluation(session).evaluate(detail.record.shop_id, detail.record.experiment_id).arms
    )


def row(evaluation: ArmEvaluation, objective_id: str = JUDGED_OBJECTIVE):
    return next(result for result in evaluation.results if result.objective_id == objective_id)


# -- a judge fills the row nothing else could ----------------------------------


@pytest.mark.asyncio
async def test_an_unscored_judge_row_says_a_judge_decides_it(
    session: Session, workspace: Workspace
) -> None:
    detail = start(session, workspace, control_arm(session))

    judged = row(evaluate(session, detail)[0])

    assert judged.outcome is ObjectiveOutcome.DEFERRED
    assert judged.judgement is None


@pytest.mark.asyncio
async def test_scoring_fills_the_judge_row_with_the_verdict_and_its_reason(
    session: Session, workspace: Workspace
) -> None:
    detail = start(session, workspace, control_arm(session))
    await advance(session, detail)

    await score(session, detail, published_judge(session))

    judged = row(evaluate(session, detail)[0])
    assert judged.outcome is ObjectiveOutcome.MET
    assert judged.detail


@pytest.mark.asyncio
async def test_a_verdict_names_the_judge_the_model_and_the_input_it_read(
    session: Session, workspace: Workspace
) -> None:
    """A verdict an operator cannot trace to a rubric version and an input is a number."""
    detail = start(session, workspace, control_arm(session))
    await advance(session, detail)
    judge_id = published_judge(session)

    await score(session, detail, judge_id)

    judgement = row(evaluate(session, detail)[0]).judgement
    assert judgement is not None
    assert judgement.judge_id == judge_id
    assert judgement.judge_version == 1
    assert judgement.model_id == control_model().model_id
    assert len(judgement.brief_fingerprint) == 64
    assert judgement.attempt == 1


@pytest.mark.asyncio
async def test_a_deterministic_row_is_untouched_by_the_judge(
    session: Session, workspace: Workspace
) -> None:
    detail = start(session, workspace, control_arm(session))
    await advance(session, detail)

    await score(session, detail, published_judge(session))

    read = row(evaluate(session, detail)[0], "read-shipping-policy")
    assert read.outcome is ObjectiveOutcome.PENDING
    assert read.judgement is None


@pytest.mark.asyncio
async def test_only_the_objectives_a_judge_owns_are_scored(
    session: Session, workspace: Workspace
) -> None:
    detail = start(session, workspace, control_arm(session))
    await advance(session, detail)
    stub = StubJudge()

    await score(session, detail, published_judge(session), stub)

    asked = [request.brief["objective"] for request in stub.requests]
    assert [entry["id"] for entry in asked] == [JUDGED_OBJECTIVE]  # type: ignore[index]


@pytest.mark.asyncio
async def test_each_arm_is_scored_on_its_own_record(session: Session, workspace: Workspace) -> None:
    """Two briefs, never one comparison: the operator compares two verdicts, not the judge."""
    detail = start(session, workspace, control_arm(session), control_arm(session))
    await advance(session, detail, 0)
    stub = StubJudge()

    await score(session, detail, published_judge(session), stub)

    assert len(stub.requests) == 2
    fingerprints = {str(request.brief.get("agent_replies")) for request in stub.requests}
    assert len(fingerprints) == 2


@pytest.mark.asyncio
async def test_the_control_judge_reads_the_brief_by_its_declared_rule(
    session: Session, workspace: Workspace
) -> None:
    """An arm that has not answered its turn is unclear, not missed: it is not finished."""
    detail = start(session, workspace, control_arm(session), control_arm(session))
    await advance(session, detail, 0)

    await score(session, detail, published_judge(session), ControlJudgeRuntime())

    answered, silent = evaluate(session, detail)
    assert row(answered).outcome is ObjectiveOutcome.MET
    assert row(silent).outcome is ObjectiveOutcome.MISSED


# -- unclear, failed, and rerun -------------------------------------------------


@pytest.mark.asyncio
async def test_a_judge_that_cannot_tell_is_undecidable_rather_than_a_miss(
    session: Session, workspace: Workspace
) -> None:
    detail = start(session, workspace, control_arm(session))
    await advance(session, detail)
    stub = StubJudge(JudgeVerdict(outcome=JudgeOutcome.UNCLEAR, rationale="the record is thin"))

    await score(session, detail, published_judge(session), stub)

    judged = row(evaluate(session, detail)[0])
    assert judged.outcome is ObjectiveOutcome.UNDECIDABLE
    assert not judged.failed


@pytest.mark.asyncio
async def test_a_failed_execution_leaves_the_row_where_it_stood(
    session: Session, workspace: Workspace
) -> None:
    """The lab's own outage is never the arm's miss."""
    detail = start(session, workspace, control_arm(session))
    await advance(session, detail)
    stub = StubJudge(error=JudgeProviderError("the provider refused"))

    await score(session, detail, published_judge(session), stub)

    judged = row(evaluate(session, detail)[0])
    assert judged.outcome is ObjectiveOutcome.DEFERRED
    assert judged.judgement is not None
    assert judged.judgement.failure is JudgeFailure.PROVIDER
    assert judged.judgement.outcome is None


@pytest.mark.asyncio
async def test_an_unclassified_adapter_failure_is_recorded_rather_than_raised(
    session: Session, workspace: Workspace
) -> None:
    detail = start(session, workspace, control_arm(session))
    await advance(session, detail)
    stub = StubJudge(error=RuntimeError("something the adapter never classified"))

    await score(session, detail, published_judge(session), stub)

    judgement = row(evaluate(session, detail)[0]).judgement
    assert judgement is not None
    assert judgement.failure is JudgeFailure.INVALID_RESPONSE


@pytest.mark.asyncio
async def test_scoring_again_writes_a_new_attempt_and_the_matrix_reads_the_latest(
    session: Session, workspace: Workspace
) -> None:
    detail = start(session, workspace, control_arm(session))
    await advance(session, detail)
    judge_id = published_judge(session)

    await score(session, detail, judge_id, StubJudge(error=JudgeProviderError("down")))
    await score(session, detail, judge_id, StubJudge())

    judgement = row(evaluate(session, detail)[0]).judgement
    assert judgement is not None
    assert judgement.attempt == 2
    assert judgement.outcome is JudgeOutcome.MET


@pytest.mark.asyncio
async def test_a_pass_scores_at_the_judge_version_it_resolved(
    session: Session, workspace: Workspace
) -> None:
    """A rubric republished afterwards must not change what a recorded verdict read."""
    detail = start(session, workspace, control_arm(session))
    await advance(session, detail)
    judge_id = published_judge(session)
    await score(session, detail, judge_id, StubJudge())

    judges = JudgeConfigurationService(judge_configuration_repository(session), AdvancingClock())
    judges.replace_judge(
        judge_id,
        publishable_judge(
            rubric="Score whether the arm was brief.",
            evidence=(JudgeEvidenceScope.AGENT_REPLIES,),
        ),
    )
    judges.publish(judge_id)
    stub = StubJudge()
    await score(session, detail, judge_id, stub)

    judgement = row(evaluate(session, detail)[0]).judgement
    assert judgement is not None
    assert judgement.judge_version == 2
    assert stub.requests[0].rubric == "Score whether the arm was brief."


# -- what is refused rather than recorded ---------------------------------------


@pytest.mark.asyncio
async def test_a_judge_that_was_never_published_cannot_score(
    session: Session, workspace: Workspace
) -> None:
    detail = start(session, workspace, control_arm(session))
    judges = JudgeConfigurationService(judge_configuration_repository(session), AdvancingClock())
    created = judges.create_judge("Unfinished")

    with pytest.raises(JudgeUnpublishedError):
        await score(session, detail, created.definition.id)


@pytest.mark.asyncio
async def test_a_provider_this_lab_cannot_reach_records_nothing(
    session: Session, workspace: Workspace
) -> None:
    """A missing key is a fact about the machine, so it never becomes an arm's evidence."""
    detail = start(session, workspace, control_arm(session))
    await advance(session, detail)
    judge_id = published_judge(session)
    empty = JudgeRuntimeRegistry({})

    with pytest.raises(JudgeUnavailableError):
        await build_judge_service(session, empty).score(
            detail.record.shop_id, detail.record.experiment_id, judge_id
        )

    assert row(evaluate(session, detail)[0]).judgement is None


@pytest.mark.asyncio
async def test_a_pass_that_meets_another_pass_s_attempt_is_a_conflict(
    session: Session, workspace: Workspace
) -> None:
    """The store refuses to overwrite a verdict, and says so in words an operator can act on.

    Two passes running at once number the same attempt, because each counts one past the
    highest it read. Written here as a pass that repeats an attempt already stored, which is
    the same collision without a second thread deciding when the test finishes.
    """
    detail = start(session, workspace, control_arm(session))
    await advance(session, detail)
    judge_id = published_judge(session)
    await score(session, detail, judge_id)
    stored = SqlAlchemyJudgementRepository(session).list_for_experiment(detail.record.experiment_id)

    with pytest.raises(JudgementConflictError):
        SqlAlchemyJudgementRepository(session).append_all(stored)
    # What `session_scope` does when the conflict reaches it, so this suite's shared session
    # is usable again: a failed write leaves nothing half-applied.
    session.rollback()


@pytest.mark.asyncio
async def test_an_unclassified_runtime_error_is_still_recorded_as_a_failure(
    session: Session, workspace: Workspace
) -> None:
    """The base error carries a failure, so raising it cannot escape the recorder."""
    detail = start(session, workspace, control_arm(session))
    await advance(session, detail)
    stub = StubJudge(error=JudgeRuntimeError("an adapter that classified nothing"))

    await score(session, detail, published_judge(session), stub)

    judgement = row(evaluate(session, detail)[0]).judgement
    assert judgement is not None
    assert judgement.failure is JudgeFailure.INVALID_RESPONSE


@pytest.mark.asyncio
async def test_a_judge_that_does_not_exist_is_named_as_missing(
    session: Session, workspace: Workspace
) -> None:
    detail = start(session, workspace, control_arm(session))

    with pytest.raises(Exception, match="does not exist"):
        await score(session, detail, uuid4())
