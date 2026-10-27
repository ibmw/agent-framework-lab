"""Judging an arm against the objectives its scenario composed (ADR 0030).

Two halves. The first is pure: what an observation means, and the declared tables that say
which evidence this build reads at all. The second drives a real experiment, because the
thing being judged is a record — the calls one arm actually got answers from and the sandbox
it moved — and a hand-written record would be judging a fixture rather than the lab.
"""

from collections.abc import Generator, Mapping
from dataclasses import replace
from pathlib import Path
from uuid import UUID, uuid4

import pytest
from sqlalchemy.orm import Session

from agent_factories import READ_TOOL_NAMES, model_settings
from block_factories import parameter, publishable_objective, severity_parameter
from capability_lab.application.agent_capabilities import FAKE_FRAMEWORK_ID
from capability_lab.application.agent_runtime import SupportAgentRuntimeRegistry
from capability_lab.application.agent_turns import ToolEvent
from capability_lab.application.canonical_json import CanonicalValue
from capability_lab.application.evaluation import (
    ENTITY_READS,
    EVALUABLE_OBJECTIVES,
    OBJECTIVE_READERS,
    ORDER_FIELD_READERS,
    ArmEvidence,
    judge_objective,
)
from capability_lab.application.experiments import (
    ArmSelection,
    ExperimentCompletedError,
    ExperimentDetail,
    StartExperiment,
)
from capability_lab.application.sandbox_tool_contracts import (
    ADDRESS_CHANGE_APPLY,
    ADDRESS_CHANGE_PROPOSE,
    CUSTOMER_PROFILE,
    ORDER_DETAIL,
    SUPPORT_DOCUMENT,
)
from capability_lab.application.sandbox_tools import ToolOutcome
from capability_lab.domain.blocks import (
    DETERMINISTIC_EVIDENCE,
    BlockParameterKind,
    ObjectiveAssessment,
    ObjectiveEvidence,
    ObjectiveSeverity,
)
from capability_lab.domain.evaluation import (
    ArmEvaluation,
    DecidingCall,
    EvaluationError,
    EvidencePolarity,
    ExperimentStatus,
    ObjectiveOutcome,
    ObjectiveResult,
    decide,
    stand_experiment,
)
from capability_lab.domain.experiment import ArmAwaiting, ArmStanding
from capability_lab.domain.judge import JudgeOutcome
from capability_lab.domain.judgement import Judgement
from capability_lab.domain.sandbox import SandboxInteraction, SandboxOrder, SandboxState
from capability_lab.domain.scenario import (
    DATA_FIELDS,
    BoundObjective,
    CompletionConditions,
    ScenarioBinding,
    ScenarioEntityKind,
)
from capability_lab.domain.shop import ShopDocumentKind, SupportChannel
from capability_lab.domain.ticket import TicketOrigin, TicketOriginKind
from capability_lab.infrastructure.agents.fake import FakeSupportAgentRuntime
from capability_lab.infrastructure.database import (
    Base,
    create_database_engine,
    create_session_factory,
    session_scope,
)
from capability_lab.infrastructure.participants.human import HumanParticipantDriver
from order_factories import CUSTOMER_ID, paid_order
from workspace_factories import (
    POLICY_REFERENCE,
    SEED,
    Workspace,
    author,
    build_evaluation,
    build_experiments,
    build_runner,
    publish_prerequisites,
    published_configuration,
    published_identity,
    read_check,
    seed_workspace,
)

WRITE_TOOL_NAMES = (ADDRESS_CHANGE_APPLY, ADDRESS_CHANGE_PROPOSE)
ORDER_ID = UUID("2f8c2b60-9d3d-4a77-9f31-1c7f0f3c9a42")


# -- what an observation means --------------------------------------------------


def test_something_required_is_met_the_moment_it_is_observed() -> None:
    assert decide(EvidencePolarity.MUST_OCCUR, observed=True, settled=False) is ObjectiveOutcome.MET


def test_something_required_and_not_yet_observed_is_pending_while_the_arm_can_still_act() -> None:
    """Deterministic evidence is monotone: the next turn can still read the document."""
    outcome = decide(EvidencePolarity.MUST_OCCUR, observed=False, settled=False)

    assert outcome is ObjectiveOutcome.PENDING


def test_something_required_is_missed_once_the_arm_can_no_longer_act() -> None:
    outcome = decide(EvidencePolarity.MUST_OCCUR, observed=False, settled=True)

    assert outcome is ObjectiveOutcome.MISSED


def test_something_forbidden_is_missed_the_moment_it_happens() -> None:
    """A verdict mid-run, because no later turn can unmake it."""
    outcome = decide(EvidencePolarity.MUST_NOT_OCCUR, observed=True, settled=False)

    assert outcome is ObjectiveOutcome.MISSED


def test_something_forbidden_is_pending_until_the_arm_stops_being_able_to_do_it() -> None:
    assert (
        decide(EvidencePolarity.MUST_NOT_OCCUR, observed=False, settled=False)
        is ObjectiveOutcome.PENDING
    )
    assert (
        decide(EvidencePolarity.MUST_NOT_OCCUR, observed=False, settled=True)
        is ObjectiveOutcome.MET
    )


# -- where a whole experiment stands --------------------------------------------


def standing(awaiting: ArmAwaiting) -> ArmStanding:
    return ArmStanding(awaiting=awaiting, ordinal=1, attempts=1, unanswered=())


def judged(outcome: ObjectiveOutcome, severity: ObjectiveSeverity) -> ArmEvaluation:
    return ArmEvaluation(
        run_id=uuid4(),
        settled=True,
        results=(
            ObjectiveResult(
                objective_id="read-shipping-policy",
                block_id=uuid4(),
                block_version=1,
                statement="Read the shipping policy",
                severity=severity,
                assessment=ObjectiveAssessment.DETERMINISTIC,
                evidence=ObjectiveEvidence.EVENT,
                outcome=outcome,
                detail="",
            ),
        ),
    )


def test_an_experiment_is_running_while_any_arm_can_still_be_acted_on() -> None:
    """Waiting is the stronger statement: the arm beside this one can still meet its own."""
    status = stand_experiment(
        (standing(ArmAwaiting.COMPLETED), standing(ArmAwaiting.CUSTOMER)),
        (
            judged(ObjectiveOutcome.MISSED, ObjectiveSeverity.REQUIRED),
            judged(ObjectiveOutcome.PENDING, ObjectiveSeverity.REQUIRED),
        ),
    )

    assert status is ExperimentStatus.RUNNING


def test_a_finished_experiment_that_missed_a_requirement_failed() -> None:
    status = stand_experiment(
        (standing(ArmAwaiting.COMPLETED),),
        (judged(ObjectiveOutcome.MISSED, ObjectiveSeverity.REQUIRED),),
    )

    assert status is ExperimentStatus.FAILED


def test_a_missed_expectation_finishes_an_experiment_without_failing_it() -> None:
    """Severity decides what a miss costs, never whether it is a miss (ADR 0030)."""
    status = stand_experiment(
        (standing(ArmAwaiting.COMPLETED),),
        (judged(ObjectiveOutcome.MISSED, ObjectiveSeverity.EXPECTED),),
    )

    assert status is ExperimentStatus.COMPLETED


def test_an_arm_standing_read_without_its_own_evaluation_is_refused() -> None:
    with pytest.raises(EvaluationError):
        stand_experiment((standing(ArmAwaiting.COMPLETED),), ())


# -- the tables this build declares ---------------------------------------------


def test_every_evidence_kind_this_build_reads_is_deterministic_and_has_readers() -> None:
    """A judge's dimension is not here, and every declared kind can actually be read."""
    assert set(EVALUABLE_OBJECTIVES) <= DETERMINISTIC_EVIDENCE
    assert EVALUABLE_OBJECTIVES
    for contract in EVALUABLE_OBJECTIVES.values():
        assert contract.reads
        assert contract.reads <= set(OBJECTIVE_READERS)


def test_the_evidence_this_build_does_not_read_is_absent_rather_than_wrong() -> None:
    """`policy` needs a rule registry and `dimension` needs a judge; neither exists yet."""
    assert ObjectiveEvidence.POLICY not in EVALUABLE_OBJECTIVES
    assert ObjectiveEvidence.DIMENSION not in EVALUABLE_OBJECTIVES


def test_a_forbidden_objective_reads_everything_an_expected_one_does() -> None:
    """The polarity is the only difference, so a "never" can be asked of any reading."""
    forbidden = EVALUABLE_OBJECTIVES[ObjectiveEvidence.FORBIDDEN]

    assert forbidden.polarity is EvidencePolarity.MUST_NOT_OCCUR
    assert forbidden.reads == set(OBJECTIVE_READERS)


def test_every_order_field_a_scenario_can_bind_is_readable() -> None:
    """A field the scenario editor offers and this cannot read would be a silent verdict."""
    assert set(ORDER_FIELD_READERS) == set(DATA_FIELDS[ScenarioEntityKind.ORDER])


def test_every_entity_a_scenario_can_bind_names_the_tool_that_reads_it() -> None:
    assert set(ENTITY_READS) == set(ScenarioEntityKind)


# -- reading one arm's record ---------------------------------------------------


def interaction() -> SandboxInteraction:
    return SandboxInteraction(
        origin=TicketOrigin(kind=TicketOriginKind.SUPPORT_ENTRY),
        channel=SupportChannel.CHAT,
        ticket_reference="T-204",
    )


def state(**overrides: object) -> SandboxState:
    return SandboxState(
        customer_profile_id=CUSTOMER_ID,
        interaction=interaction(),
        orders=(SandboxOrder(order_id=ORDER_ID, payload=paid_order(**overrides)),),
    )


def call(
    tool: str,
    data: Mapping[str, CanonicalValue] | None = None,
    outcome: ToolOutcome = ToolOutcome.SUCCESS,
    *,
    ordinal: int = 0,
    attempt: int = 1,
    sequence: int = 1,
) -> ToolEvent:
    return ToolEvent(
        ordinal=ordinal,
        attempt=attempt,
        sequence=sequence,
        tool=tool,
        version="v1",
        outcome=outcome,
        document={"outcome": outcome.value, "data": dict[str, CanonicalValue](data or {})},
        revision_before=0,
        revision_after=0,
        state_fingerprint="f" * 64,
    )


def evidence(*calls: ToolEvent, current: SandboxState | None = None) -> ArmEvidence:
    return ArmEvidence(run_id=uuid4(), calls=calls, starting=state(), current=current or state())


def objective(**overrides: object) -> BoundObjective:
    fields: dict[str, object] = {
        "id": "read-shipping-policy",
        "block_id": uuid4(),
        "severity": ObjectiveSeverity.REQUIRED,
        "bindings": (ScenarioBinding(parameter="doc_ref", value=POLICY_REFERENCE),),
    }
    fields.update(overrides)
    return BoundObjective(**fields)  # type: ignore[arg-type]


def judge(
    bound: BoundObjective, evidence_of: ArmEvidence, *, settled: bool = False, **template: object
) -> ObjectiveOutcome:
    payload = publishable_objective(**template)
    return judge_objective(bound, payload, 1, evidence_of, settled=settled).outcome


def test_a_read_check_is_met_by_the_call_that_answered_with_that_document() -> None:
    answered = call(
        SUPPORT_DOCUMENT, {"kind": ShopDocumentKind.POLICY.value, "document_id": "shipping"}
    )

    assert judge(objective(), evidence(answered)) is ObjectiveOutcome.MET


def test_a_read_check_is_not_met_by_a_call_that_answered_with_another_document() -> None:
    other = call(
        SUPPORT_DOCUMENT, {"kind": ShopDocumentKind.POLICY.value, "document_id": "returns"}
    )
    result = judge_objective(objective(), publishable_objective(), 1, evidence(other), settled=True)

    assert result.outcome is ObjectiveOutcome.MISSED
    assert "never answered policy:shipping" in result.detail


def test_a_refused_call_is_not_a_reading() -> None:
    """ADR 0021 made a refusal a value; it still told the agent nothing about the world."""
    refused = call(
        SUPPORT_DOCUMENT,
        {"kind": ShopDocumentKind.POLICY.value, "document_id": "shipping"},
        ToolOutcome.REFUSED,
    )

    assert judge(objective(), evidence(refused)) is ObjectiveOutcome.PENDING


def test_an_objective_bound_to_an_order_is_met_by_the_call_that_read_that_order() -> None:
    bound = objective(bindings=(ScenarioBinding(parameter="doc_ref", value=f"order:{ORDER_ID}"),))
    entity = parameter("doc_ref", kind=BlockParameterKind.ENTITY_REFERENCE)
    read = call(ORDER_DETAIL, {"order_id": str(ORDER_ID)})

    outcome = judge(bound, evidence(read), parameters=(entity, severity_parameter()))

    assert outcome is ObjectiveOutcome.MET


def test_an_objective_bound_to_a_tool_is_met_by_a_call_that_tool_answered() -> None:
    bound = objective(bindings=(ScenarioBinding(parameter="doc_ref", value=CUSTOMER_PROFILE),))
    tool = parameter("doc_ref", kind=BlockParameterKind.TOOL_REFERENCE)

    outcome = judge(
        bound,
        evidence(call(CUSTOMER_PROFILE, {"customer_profile_id": str(CUSTOMER_ID)})),
        parameters=(tool, severity_parameter()),
    )

    assert outcome is ObjectiveOutcome.MET


def test_a_state_objective_reads_the_field_against_what_the_arm_started_with() -> None:
    bound = objective(
        bindings=(ScenarioBinding(parameter="doc_ref", value=f"order:{ORDER_ID}#shipping_address"),)
    )
    field = parameter("doc_ref", kind=BlockParameterKind.DATA_REFERENCE)
    template = (field, severity_parameter())

    unchanged = judge(bound, evidence(), evidence=ObjectiveEvidence.STATE, parameters=template)
    moved = judge(
        bound,
        evidence(current=state(shipping_address=None)),
        evidence=ObjectiveEvidence.STATE,
        parameters=template,
    )

    assert unchanged is ObjectiveOutcome.PENDING
    assert moved is ObjectiveOutcome.MET


def test_a_forbidden_objective_fails_on_the_very_reading_another_one_would_pass_on() -> None:
    read = call(
        SUPPORT_DOCUMENT, {"kind": ShopDocumentKind.POLICY.value, "document_id": "shipping"}
    )

    assert judge(objective(), evidence(read)) is ObjectiveOutcome.MET
    assert (
        judge(objective(), evidence(read), evidence=ObjectiveEvidence.FORBIDDEN)
        is ObjectiveOutcome.MISSED
    )


def test_an_objective_a_judge_scores_is_deferred_rather_than_counted() -> None:
    outcome = judge(
        objective(),
        evidence(),
        settled=True,
        assessment=ObjectiveAssessment.JUDGE,
        evidence=ObjectiveEvidence.DIMENSION,
    )

    assert outcome is ObjectiveOutcome.DEFERRED


def test_an_objective_whose_evidence_this_build_does_not_read_says_so() -> None:
    result = judge_objective(
        objective(),
        publishable_objective(evidence=ObjectiveEvidence.POLICY),
        1,
        evidence(),
        settled=True,
    )

    assert result.outcome is ObjectiveOutcome.UNDECIDABLE
    assert "reads no policy evidence" in result.detail


def test_a_field_of_something_no_arm_can_move_is_undecidable_rather_than_missed() -> None:
    """A customer profile is pinned in a published version: no arm ever moved it."""
    bound = objective(
        bindings=(ScenarioBinding(parameter="doc_ref", value=f"customer:{CUSTOMER_ID}#email"),)
    )
    field = parameter("doc_ref", kind=BlockParameterKind.DATA_REFERENCE)
    result = judge_objective(
        bound,
        publishable_objective(
            evidence=ObjectiveEvidence.STATE, parameters=(field, severity_parameter())
        ),
        1,
        evidence(),
        settled=True,
    )

    assert result.outcome is ObjectiveOutcome.UNDECIDABLE
    assert "no customer state" in result.detail


def test_an_instance_binding_nothing_readable_is_undecidable() -> None:
    """A template with only literal parameters names nothing an arm can have done."""
    result = judge_objective(
        objective(bindings=()),
        publishable_objective(parameters=(severity_parameter(),)),
        1,
        evidence(),
        settled=True,
    )

    assert result.outcome is ObjectiveOutcome.UNDECIDABLE


def test_a_forbidden_template_bound_twice_is_violated_by_either() -> None:
    """De Morgan: "never A or B" is broken by A alone, and reading it as "and" would pass it."""
    bound = objective(
        bindings=(
            ScenarioBinding(parameter="doc_ref", value=POLICY_REFERENCE),
            ScenarioBinding(parameter="second_ref", value="policy:returns"),
        )
    )
    both = (parameter("doc_ref"), parameter("second_ref"), severity_parameter())
    read_one = call(
        SUPPORT_DOCUMENT, {"kind": ShopDocumentKind.POLICY.value, "document_id": "shipping"}
    )
    forbidden: dict[str, object] = {
        "evidence": ObjectiveEvidence.FORBIDDEN,
        "parameters": both,
    }

    one_of_two = judge_objective(
        bound,
        publishable_objective(**forbidden),
        1,
        evidence(read_one),
        settled=False,
    )
    neither = judge(bound, evidence(), settled=True, **forbidden)

    assert one_of_two.outcome is ObjectiveOutcome.MISSED
    assert "answered policy:shipping" in one_of_two.detail
    assert neither is ObjectiveOutcome.MET


def test_a_template_a_scenario_binds_twice_asks_for_both() -> None:
    bound = objective(
        bindings=(
            ScenarioBinding(parameter="doc_ref", value=POLICY_REFERENCE),
            ScenarioBinding(parameter="second_ref", value="policy:returns"),
        )
    )
    both = (parameter("doc_ref"), parameter("second_ref"), severity_parameter())
    read_one = call(
        SUPPORT_DOCUMENT, {"kind": ShopDocumentKind.POLICY.value, "document_id": "shipping"}
    )
    read_two = call(
        SUPPORT_DOCUMENT, {"kind": ShopDocumentKind.POLICY.value, "document_id": "returns"}
    )

    assert judge(bound, evidence(read_one), parameters=both) is ObjectiveOutcome.PENDING
    assert judge(bound, evidence(read_one, read_two), parameters=both) is ObjectiveOutcome.MET


# -- the call a verdict rests on (ADR 0030, amended 2026-10-25) -------------------


def policy_read(**coordinate: int) -> ToolEvent:
    return call(
        SUPPORT_DOCUMENT,
        {"kind": ShopDocumentKind.POLICY.value, "document_id": "shipping"},
        **coordinate,  # type: ignore[arg-type]
    )


def deciding(
    bound: BoundObjective, evidence_of: ArmEvidence, *, settled: bool = False, **template: object
) -> ObjectiveResult:
    return judge_objective(
        bound, publishable_objective(**template), 1, evidence_of, settled=settled
    )


def test_a_document_read_twice_is_decided_by_the_read_the_evaluator_stopped_at() -> None:
    """The first answer met the requirement; the second read changed nothing."""
    later = policy_read(ordinal=2, attempt=1, sequence=0)
    earlier = policy_read(ordinal=0, attempt=1, sequence=3)

    result = deciding(objective(), evidence(later, earlier))

    assert result.outcome is ObjectiveOutcome.MET
    assert result.decided_by == DecidingCall(ordinal=0, attempt=1, sequence=3)


def test_a_refused_read_before_the_answered_one_does_not_decide_it() -> None:
    refused = call(
        SUPPORT_DOCUMENT,
        {"kind": ShopDocumentKind.POLICY.value, "document_id": "shipping"},
        ToolOutcome.REFUSED,
        sequence=0,
    )
    answered = policy_read(sequence=4)

    result = deciding(objective(), evidence(refused, answered))

    assert result.decided_by == DecidingCall(ordinal=0, attempt=1, sequence=4)


def test_an_entity_read_is_decided_by_the_call_that_read_that_entity() -> None:
    bound = objective(bindings=(ScenarioBinding(parameter="doc_ref", value=f"order:{ORDER_ID}"),))
    entity = parameter("doc_ref", kind=BlockParameterKind.ENTITY_REFERENCE)
    other = call(ORDER_DETAIL, {"order_id": str(uuid4())}, sequence=0)
    read = call(ORDER_DETAIL, {"order_id": str(ORDER_ID)}, sequence=2)

    result = deciding(bound, evidence(other, read), parameters=(entity, severity_parameter()))

    assert result.decided_by == DecidingCall(ordinal=0, attempt=1, sequence=2)


def test_a_tool_objective_is_decided_by_the_first_answer_that_tool_gave() -> None:
    bound = objective(bindings=(ScenarioBinding(parameter="doc_ref", value=CUSTOMER_PROFILE),))
    tool = parameter("doc_ref", kind=BlockParameterKind.TOOL_REFERENCE)
    retried = call(CUSTOMER_PROFILE, ordinal=1, attempt=2, sequence=0)
    first = call(CUSTOMER_PROFILE, ordinal=1, attempt=1, sequence=5)

    result = deciding(bound, evidence(retried, first), parameters=(tool, severity_parameter()))

    assert result.decided_by == DecidingCall(ordinal=1, attempt=1, sequence=5)


def test_a_requirement_with_two_bindings_is_decided_by_the_read_that_completed_it() -> None:
    """Until the second read the objective was pending, so the second read decided it."""
    bound = objective(
        bindings=(
            ScenarioBinding(parameter="doc_ref", value=POLICY_REFERENCE),
            ScenarioBinding(parameter="second_ref", value="policy:returns"),
        )
    )
    both = (parameter("doc_ref"), parameter("second_ref"), severity_parameter())
    returns = call(
        SUPPORT_DOCUMENT,
        {"kind": ShopDocumentKind.POLICY.value, "document_id": "returns"},
        ordinal=1,
        sequence=0,
    )

    halfway = deciding(bound, evidence(policy_read(sequence=2)), parameters=both)
    result = deciding(bound, evidence(returns, policy_read(sequence=2)), parameters=both)

    assert (halfway.outcome, halfway.decided_by) == (ObjectiveOutcome.PENDING, None)
    assert result.outcome is ObjectiveOutcome.MET
    assert result.decided_by == DecidingCall(ordinal=1, attempt=1, sequence=0)


def test_a_prohibition_broken_twice_is_decided_by_the_first_break() -> None:
    """Nothing after the first forbidden call could unmake the miss."""
    bound = objective(
        bindings=(
            ScenarioBinding(parameter="doc_ref", value=POLICY_REFERENCE),
            ScenarioBinding(parameter="second_ref", value="policy:returns"),
        )
    )
    both = (parameter("doc_ref"), parameter("second_ref"), severity_parameter())
    returns = call(
        SUPPORT_DOCUMENT,
        {"kind": ShopDocumentKind.POLICY.value, "document_id": "returns"},
        ordinal=0,
        sequence=0,
    )

    result = deciding(
        bound,
        evidence(policy_read(ordinal=2, sequence=1), returns),
        evidence=ObjectiveEvidence.FORBIDDEN,
        parameters=both,
    )

    assert result.outcome is ObjectiveOutcome.MISSED
    assert result.decided_by == DecidingCall(ordinal=0, attempt=1, sequence=0)


def test_a_row_no_single_call_decided_names_none() -> None:
    """A miss, a pending row, a kept prohibition: each is an absence, not an event."""
    other = call(
        SUPPORT_DOCUMENT, {"kind": ShopDocumentKind.POLICY.value, "document_id": "returns"}
    )

    missed = deciding(objective(), evidence(other), settled=True)
    pending = deciding(objective(), evidence(other))
    kept = deciding(
        objective(), evidence(other), settled=True, evidence=ObjectiveEvidence.FORBIDDEN
    )

    assert (missed.outcome, missed.decided_by) == (ObjectiveOutcome.MISSED, None)
    assert (pending.outcome, pending.decided_by) == (ObjectiveOutcome.PENDING, None)
    assert (kept.outcome, kept.decided_by) == (ObjectiveOutcome.MET, None)


def test_a_field_that_moved_names_no_call() -> None:
    """Two states differ; nothing in the record says which event moved this field."""
    bound = objective(
        bindings=(ScenarioBinding(parameter="doc_ref", value=f"order:{ORDER_ID}#shipping_address"),)
    )
    field = parameter("doc_ref", kind=BlockParameterKind.DATA_REFERENCE)
    write = call(ADDRESS_CHANGE_APPLY, sequence=3)

    result = deciding(
        bound,
        evidence(write, current=state(shipping_address=None)),
        evidence=ObjectiveEvidence.STATE,
        parameters=(field, severity_parameter()),
    )

    assert result.outcome is ObjectiveOutcome.MET
    assert result.decided_by is None


def test_a_prohibition_broken_by_a_call_and_a_moved_field_names_neither() -> None:
    """Which came first, the call or the state change, is not in the record."""
    bound = objective(
        bindings=(
            ScenarioBinding(parameter="doc_ref", value=POLICY_REFERENCE),
            ScenarioBinding(parameter="field_ref", value=f"order:{ORDER_ID}#shipping_address"),
        )
    )
    template = (
        parameter("doc_ref"),
        parameter("field_ref", kind=BlockParameterKind.DATA_REFERENCE),
        severity_parameter(),
    )

    result = deciding(
        bound,
        evidence(policy_read(sequence=2), current=state(shipping_address=None)),
        evidence=ObjectiveEvidence.FORBIDDEN,
        parameters=template,
    )

    assert result.outcome is ObjectiveOutcome.MISSED
    assert result.decided_by is None


def test_an_undecidable_row_names_no_call() -> None:
    result = deciding(objective(), evidence(policy_read()), evidence=ObjectiveEvidence.POLICY)

    assert result.outcome is ObjectiveOutcome.UNDECIDABLE
    assert result.decided_by is None


def test_a_judged_row_names_no_call_even_when_the_judge_said_met() -> None:
    """A judge read the whole thread (ADR 0031); no single call is its evidence."""
    verdict = Judgement(
        objective_id="read-shipping-policy",
        judge_id=uuid4(),
        judge_version=1,
        provider="fake",
        model_id="deterministic",
        brief_fingerprint="a" * 64,
        outcome=JudgeOutcome.MET,
        rationale="the policy was read",
    )
    template = publishable_objective(
        assessment=ObjectiveAssessment.JUDGE, evidence=ObjectiveEvidence.DIMENSION
    )

    unscored = judge_objective(objective(), template, 1, evidence(policy_read()), settled=True)
    scored = judge_objective(
        objective(), template, 1, evidence(policy_read()), settled=True, judgement=verdict
    )

    assert (unscored.outcome, unscored.decided_by) == (ObjectiveOutcome.DEFERRED, None)
    assert (scored.outcome, scored.decided_by) == (ObjectiveOutcome.MET, None)


def test_an_unscored_judged_row_says_no_verdict_is_recorded_and_not_who_scores_it() -> None:
    """The outcome's label says a judge scores the row; the detail says what it does not."""
    template = publishable_objective(
        assessment=ObjectiveAssessment.JUDGE, evidence=ObjectiveEvidence.DIMENSION
    )

    unscored = judge_objective(objective(), template, 1, evidence(policy_read()), settled=True)

    assert unscored.outcome is ObjectiveOutcome.DEFERRED
    assert unscored.detail == "no verdict is recorded for this arm yet"


def test_a_judged_verdict_cannot_carry_a_deciding_call() -> None:
    """A judge read the whole thread; pinning its verdict on one call would misreport it."""
    verdict = Judgement(
        objective_id="read-shipping-policy",
        judge_id=uuid4(),
        judge_version=1,
        provider="fake",
        model_id="deterministic",
        brief_fingerprint="a" * 64,
        outcome=JudgeOutcome.MET,
        rationale="the policy was read",
    )
    with pytest.raises(EvaluationError, match="a judged row names none"):
        ObjectiveResult(
            objective_id="read-shipping-policy",
            block_id=uuid4(),
            block_version=1,
            statement="Read document",
            severity=ObjectiveSeverity.REQUIRED,
            assessment=ObjectiveAssessment.JUDGE,
            evidence=ObjectiveEvidence.DIMENSION,
            outcome=ObjectiveOutcome.MET,
            detail="the policy was read",
            judgement=verdict,
            decided_by=DecidingCall(ordinal=0, attempt=1, sequence=0),
        )


def test_a_row_that_is_not_a_verdict_cannot_carry_a_deciding_call() -> None:
    with pytest.raises(EvaluationError, match="a pending row names none"):
        ObjectiveResult(
            objective_id="read-shipping-policy",
            block_id=uuid4(),
            block_version=1,
            statement="Read document",
            severity=ObjectiveSeverity.REQUIRED,
            assessment=ObjectiveAssessment.DETERMINISTIC,
            evidence=ObjectiveEvidence.EVENT,
            outcome=ObjectiveOutcome.PENDING,
            detail="support.read_document never answered policy:shipping",
            decided_by=DecidingCall(ordinal=0, attempt=1, sequence=0),
        )


# -- over a real experiment -----------------------------------------------------


@pytest.fixture
def session(tmp_path: Path) -> Generator[Session, None, None]:
    engine = create_database_engine(f"sqlite:///{tmp_path / 'evaluation.db'}")
    Base.metadata.create_all(engine)
    with session_scope(create_session_factory(engine)) as active:
        yield active


@pytest.fixture
def workspace(session: Session) -> Workspace:
    return seed_workspace(session)


def control_arm(session: Session) -> ArmSelection:
    return published_configuration(
        session,
        published_identity(session),
        framework_id=FAKE_FRAMEWORK_ID,
        model=model_settings(provider="fake", model_id="deterministic"),
        tools=(*READ_TOOL_NAMES, *WRITE_TOOL_NAMES),
    )


def published_block(workspace: Workspace, name: str, **template: object) -> UUID:
    """One more objective template in this workspace's library, published."""
    created = workspace.objectives.create_block(name)
    block_id = created.definition.id
    workspace.objectives.replace_block(block_id, publishable_objective(name=name, **template))
    workspace.objectives.publish(block_id)
    return block_id


def start(
    session: Session,
    workspace: Workspace,
    *arms: ArmSelection,
    objectives: tuple[BoundObjective, ...] | None = None,
    completion: CompletionConditions | None = None,
) -> ExperimentDetail:
    publish_prerequisites(workspace)
    overrides: dict[str, object] = {}
    if objectives is not None:
        overrides["objectives"] = objectives
    if completion is not None:
        overrides["completion"] = completion
    scenario_id = author(workspace, **overrides)
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
    control = FakeSupportAgentRuntime()
    runner = build_runner(session, SupportAgentRuntimeRegistry({control.framework_id: control}))
    await runner.advance(run.shop_id, run.experiment_id, run.run_id)


def say(session: Session, detail: ExperimentDetail, message: str, *positions: int) -> None:
    runs = detail.runs if not positions else tuple(detail.runs[index] for index in positions)
    build_experiments(session).deliver_turn(
        detail.record.shop_id,
        detail.record.experiment_id,
        tuple(run.run_id for run in runs),
        HumanParticipantDriver(message),
    )


def evaluate(session: Session, detail: ExperimentDetail) -> tuple[ArmEvaluation, ...]:
    service = build_evaluation(session)
    return service.evaluate(detail.record.shop_id, detail.record.experiment_id).arms


def outcomes(evaluation: ArmEvaluation) -> dict[str, ObjectiveOutcome]:
    return {result.objective_id: result.outcome for result in evaluation.results}


@pytest.mark.anyio
async def test_an_arm_that_read_the_order_and_moved_it_meets_what_it_did(
    session: Session, workspace: Workspace
) -> None:
    """The control arm reads the order and redirects it, and never opens a document."""
    entity_block = published_block(
        workspace,
        "identify-the-order",
        parameters=(
            parameter("doc_ref", kind=BlockParameterKind.ENTITY_REFERENCE),
            severity_parameter(),
        ),
    )
    state_block = published_block(
        workspace,
        "redirect-the-order",
        evidence=ObjectiveEvidence.STATE,
        parameters=(
            parameter("doc_ref", kind=BlockParameterKind.DATA_REFERENCE),
            severity_parameter(),
        ),
    )
    detail = start(
        session,
        workspace,
        control_arm(session),
        objectives=(
            read_check(workspace),
            BoundObjective(
                id="identify-the-order",
                block_id=entity_block,
                bindings=(
                    ScenarioBinding(parameter="doc_ref", value=f"order:{workspace.order_id}"),
                ),
            ),
            BoundObjective(
                id="redirect-the-order",
                block_id=state_block,
                bindings=(
                    ScenarioBinding(
                        parameter="doc_ref",
                        value=f"order:{workspace.order_id}#shipping_address",
                    ),
                ),
            ),
        ),
    )

    await advance(session, detail)
    (arm,) = evaluate(session, detail)

    assert outcomes(arm) == {
        "read-shipping-policy": ObjectiveOutcome.PENDING,
        "identify-the-order": ObjectiveOutcome.MET,
        "redirect-the-order": ObjectiveOutcome.MET,
    }
    assert arm.met == 2
    assert not arm.failed
    recorded = build_experiments(session).get_experiment(
        detail.record.shop_id, detail.record.experiment_id
    )
    (read,) = (entry.event for entry in recorded.tool_events if entry.event.tool == ORDER_DETAIL)
    decided = {result.objective_id: result.decided_by for result in arm.results}
    assert decided == {
        "read-shipping-policy": None,
        "identify-the-order": DecidingCall(
            ordinal=read.ordinal, attempt=read.attempt, sequence=read.sequence
        ),
        "redirect-the-order": None,
    }


@pytest.mark.anyio
async def test_the_arm_beside_it_is_judged_on_its_own_record(
    session: Session, workspace: Workspace
) -> None:
    """One arm's calls are never the other's evidence, which is the whole comparison."""
    detail = start(session, workspace, control_arm(session), control_arm(session))

    await advance(session, detail, position=0)
    ran, waiting = evaluate(session, detail)

    assert ran.run_id == detail.runs[0].run_id
    assert waiting.run_id == detail.runs[1].run_id
    assert outcomes(waiting) == {"read-shipping-policy": ObjectiveOutcome.PENDING}
    assert waiting.decided == ()


@pytest.mark.anyio
async def test_what_was_pending_becomes_missed_when_the_arm_reaches_its_cap(
    session: Session, workspace: Workspace
) -> None:
    """The turn cap is what settles an objective: nothing more will happen in this arm."""
    detail = start(
        session,
        workspace,
        control_arm(session),
        completion=CompletionConditions(statement="The order ships to Lyon.", max_turns=1),
    )

    await advance(session, detail)
    (before,) = evaluate(session, detail)
    assert outcomes(before) == {"read-shipping-policy": ObjectiveOutcome.PENDING}
    assert not before.settled

    say(session, detail, "Any update?")
    await advance(session, detail)
    (after,) = evaluate(session, detail)

    assert after.settled
    assert outcomes(after) == {"read-shipping-policy": ObjectiveOutcome.MISSED}
    assert after.failed


@pytest.mark.anyio
async def test_an_expected_objective_that_is_missed_does_not_fail_the_arm(
    session: Session, workspace: Workspace
) -> None:
    detail = start(
        session,
        workspace,
        control_arm(session),
        objectives=(read_check(workspace, severity=ObjectiveSeverity.EXPECTED),),
        completion=CompletionConditions(statement="The order ships to Lyon.", max_turns=1),
    )

    await advance(session, detail)
    say(session, detail, "Any update?")
    await advance(session, detail)
    (arm,) = evaluate(session, detail)

    assert outcomes(arm) == {"read-shipping-policy": ObjectiveOutcome.MISSED}
    assert not arm.failed


@pytest.mark.anyio
async def test_an_arm_that_answered_its_last_allowed_turn_is_completed(
    session: Session, workspace: Workspace
) -> None:
    detail = start(
        session,
        workspace,
        control_arm(session),
        completion=CompletionConditions(statement="The order ships to Lyon.", max_turns=1),
    )
    await advance(session, detail)
    say(session, detail, "Any update?")
    await advance(session, detail)

    experiments = build_experiments(session)
    reopened = experiments.get_experiment(detail.record.shop_id, detail.record.experiment_id)

    assert reopened.standings[0].awaiting is ArmAwaiting.COMPLETED
    with pytest.raises(ExperimentCompletedError, match="1 turns this scenario allows"):
        say(session, reopened, "And one more thing.")


@pytest.mark.anyio
async def test_an_arm_that_owes_a_reply_on_its_last_turn_still_waits_for_its_agent(
    session: Session, workspace: Workspace
) -> None:
    detail = start(
        session,
        workspace,
        control_arm(session),
        completion=CompletionConditions(statement="The order ships to Lyon.", max_turns=1),
    )
    say(session, detail, "Any update?")

    experiments = build_experiments(session)
    reopened = experiments.get_experiment(detail.record.shop_id, detail.record.experiment_id)

    assert reopened.standings[0].awaiting is ArmAwaiting.AGENT


@pytest.mark.anyio
async def test_an_arm_is_judged_by_the_template_version_its_scenario_pinned(
    session: Session, workspace: Workspace
) -> None:
    """An objective edited and republished afterwards must not rejudge a running arm."""
    detail = start(session, workspace, control_arm(session))
    await advance(session, detail)

    workspace.objectives.replace_block(
        workspace.read_block_id,
        publishable_objective(
            statement="Read the document, again", evidence=ObjectiveEvidence.STATE
        ),
    )
    workspace.objectives.publish(workspace.read_block_id)
    (arm,) = evaluate(session, detail)

    (result,) = arm.results
    assert result.block_version == 1
    assert result.statement == "Read document"
    assert result.evidence is ObjectiveEvidence.EVENT


@pytest.mark.anyio
async def test_a_cap_is_read_from_the_version_the_experiment_pinned(
    session: Session, workspace: Workspace
) -> None:
    """Republishing a longer scenario must not extend an experiment already running."""
    detail = start(
        session,
        workspace,
        control_arm(session),
        completion=CompletionConditions(statement="The order ships to Lyon.", max_turns=1),
    )
    await advance(session, detail)
    say(session, detail, "Any update?")
    await advance(session, detail)

    scenario_id = detail.record.scenario_id
    workspace.scenarios.replace_scenario(
        workspace.shop_id,
        scenario_id,
        replace(
            workspace.scenarios.get_scenario(workspace.shop_id, scenario_id).payload,
            completion=CompletionConditions(statement="The order ships to Lyon.", max_turns=9),
        ),
    )
    workspace.scenarios.publish_scenario(workspace.shop_id, scenario_id)

    experiments = build_experiments(session)
    reopened = experiments.get_experiment(detail.record.shop_id, detail.record.experiment_id)

    assert reopened.standings[0].awaiting is ArmAwaiting.COMPLETED
