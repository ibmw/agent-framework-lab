"""The judge as authored content, and the shape one execution of it is recorded in."""

from decimal import Decimal
from uuid import uuid4

import pytest

from capability_lab.domain.definitions import DefinitionChangeKind, DefinitionIssueSeverity
from capability_lab.domain.judge import (
    MAX_RUBRIC_LENGTH,
    JudgeConfigurationError,
    JudgeEvidenceScope,
    JudgeModel,
    JudgeOutcome,
    summarize_judge_configuration_changes,
    validate_judge_configuration,
)
from capability_lab.domain.judgement import (
    MAX_RATIONALE_LENGTH,
    JudgeFailure,
    Judgement,
    JudgementError,
)
from judge_factories import publishable_judge

FINGERPRINT = "a" * 64


def codes(payload: object) -> set[str]:
    return {issue.code for issue in validate_judge_configuration(payload).issues}  # type: ignore[arg-type]


def judgement(**overrides: object) -> Judgement:
    fields: dict[str, object] = {
        "objective_id": "resolve-the-incident",
        "judge_id": uuid4(),
        "judge_version": 1,
        "provider": "fake",
        "model_id": "deterministic",
        "brief_fingerprint": FINGERPRINT,
        "outcome": JudgeOutcome.MET,
        "rationale": "the arm answered every turn it received",
    }
    fields.update(overrides)
    return Judgement(**fields)  # type: ignore[arg-type]


# -- the authored content -------------------------------------------------------


def test_a_publishable_judge_has_nothing_to_report() -> None:
    validation = validate_judge_configuration(publishable_judge())

    assert validation.publishable
    assert validation.issues == ()


def test_a_judge_without_a_rubric_cannot_be_published() -> None:
    """The rubric is the whole of what a judge is; there is nothing to score without one."""
    validation = validate_judge_configuration(publishable_judge(rubric=""))

    assert not validation.publishable
    assert "rubric_empty" in {issue.code for issue in validation.issues}


def test_a_judge_shown_nothing_cannot_be_published() -> None:
    assert "evidence_scope_empty" in codes(publishable_judge(evidence=()))


def test_a_judge_that_never_reads_the_replies_is_warned_rather_than_refused() -> None:
    """Scoring conduct from the calls alone is a legitimate rubric, deliberately chosen."""
    payload = publishable_judge(evidence=(JudgeEvidenceScope.TOOL_CALLS,))
    validation = validate_judge_configuration(payload)

    assert validation.publishable
    assert [issue.severity for issue in validation.issues] == [DefinitionIssueSeverity.WARNING]
    assert validation.issues[0].code == "evidence_without_agent_replies"


def test_evidence_scopes_are_a_set_however_they_were_ticked() -> None:
    """Two authors who ask to see the same things wrote one judge, so one fingerprint."""
    one = publishable_judge(
        evidence=(JudgeEvidenceScope.TOOL_CALLS, JudgeEvidenceScope.AGENT_REPLIES)
    )
    other = publishable_judge(
        evidence=(JudgeEvidenceScope.AGENT_REPLIES, JudgeEvidenceScope.TOOL_CALLS)
    )

    assert one.evidence == other.evidence


def test_a_scope_cannot_be_asked_for_twice() -> None:
    with pytest.raises(JudgeConfigurationError):
        publishable_judge(evidence=(JudgeEvidenceScope.TOOL_CALLS, JudgeEvidenceScope.TOOL_CALLS))


def test_a_rubric_longer_than_the_field_allows_is_refused() -> None:
    with pytest.raises(JudgeConfigurationError):
        publishable_judge(rubric="a" * (MAX_RUBRIC_LENGTH + 1))


def test_a_judge_temperature_is_an_exact_decimal_in_range() -> None:
    with pytest.raises(JudgeConfigurationError):
        JudgeModel(provider="openai", model_id="gpt-5-mini", temperature=Decimal("2.5"))
    with pytest.raises(JudgeConfigurationError):
        JudgeModel(provider="openai", model_id="gpt-5-mini", temperature=Decimal("0.123"))
    assert (
        JudgeModel(
            provider="openai", model_id="gpt-5-mini", temperature=Decimal("0.2")
        ).canonical_temperature
        == "0.20"
    )


def test_publishing_a_judge_describes_what_it_would_freeze() -> None:
    previous = publishable_judge()
    current = publishable_judge(
        rubric="Score whether the arm was clear.",
        evidence=(JudgeEvidenceScope.AGENT_REPLIES, JudgeEvidenceScope.STATE_CHANGES),
    )

    changes = summarize_judge_configuration_changes(previous, current)
    described = {(change.kind, change.path) for change in changes}

    assert (DefinitionChangeKind.UPDATED, ".rubric") in described
    assert (DefinitionChangeKind.ADDED, "evidence.state_changes") in described
    assert (DefinitionChangeKind.REMOVED, "evidence.tool_calls") in described


def test_a_first_publication_says_so_rather_than_listing_every_field() -> None:
    changes = summarize_judge_configuration_changes(None, publishable_judge())

    assert [change.kind for change in changes] == [DefinitionChangeKind.ADDED]


# -- one execution --------------------------------------------------------------


def test_a_scored_execution_carries_a_verdict_and_may_carry_a_reason() -> None:
    recorded = judgement()

    assert recorded.scored
    assert recorded.outcome is JudgeOutcome.MET


def test_a_failed_execution_carries_a_code_and_no_words() -> None:
    """Nothing can promise a provider's error text is free of the brief's content."""
    recorded = judgement(outcome=None, rationale="", failure=JudgeFailure.PROVIDER)

    assert not recorded.scored
    assert recorded.rationale == ""


def test_an_execution_is_either_a_verdict_or_a_failure_and_never_both() -> None:
    with pytest.raises(JudgementError):
        judgement(failure=JudgeFailure.PROVIDER)
    with pytest.raises(JudgementError):
        judgement(outcome=None, rationale="")


def test_a_failed_execution_may_not_explain_itself() -> None:
    with pytest.raises(JudgementError):
        judgement(outcome=None, rationale="the provider was down", failure=JudgeFailure.TRANSIENT)


def test_an_execution_names_a_published_judge_version_and_the_input_it_read() -> None:
    with pytest.raises(JudgementError):
        judgement(judge_version=0)
    with pytest.raises(JudgementError):
        judgement(brief_fingerprint="not-a-fingerprint")


def test_an_attempt_counts_from_one() -> None:
    with pytest.raises(JudgementError):
        judgement(attempt=0)
    assert judgement(attempt=2).attempt == 2


def test_a_rationale_longer_than_the_record_holds_is_refused() -> None:
    with pytest.raises(JudgementError):
        judgement(rationale="a" * (MAX_RATIONALE_LENGTH + 1))
