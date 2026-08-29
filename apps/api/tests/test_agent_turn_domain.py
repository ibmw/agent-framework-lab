"""What an agent turn refuses to be recorded as (ADR 0026)."""

import pytest

from capability_lab.domain.agent_turn import (
    MAX_AGENT_TURN_LENGTH,
    AgentTurn,
    AgentTurnError,
    AgentTurnFailure,
    AgentTurnOutcome,
)


def answered(**overrides: object) -> AgentTurn:
    fields: dict[str, object] = {
        "ordinal": 0,
        "attempt": 1,
        "outcome": AgentTurnOutcome.ANSWERED,
        "body": "I found order NS-10482.",
    }
    fields.update(overrides)
    return AgentTurn(**fields)  # type: ignore[arg-type]


def test_a_reply_is_addressed_to_the_customer_turn_it_answers() -> None:
    """The ordinal is the question's, so the two streams pair without a shared counter."""
    turn = answered(ordinal=3)

    assert turn.ordinal == 3
    assert turn.attempt == 1
    assert turn.failure is None


def test_an_attempt_counts_from_one() -> None:
    with pytest.raises(AgentTurnError, match="counts from 1"):
        answered(attempt=0)


def test_an_attempt_must_be_a_number() -> None:
    with pytest.raises(AgentTurnError, match="non-negative integer"):
        answered(attempt="second")


def test_an_answered_turn_carries_words() -> None:
    with pytest.raises(AgentTurnError, match="agent turn body"):
        answered(body="")


def test_an_answered_turn_names_no_failure() -> None:
    """The two are exclusive: a reply that also reported where it broke would say both."""
    with pytest.raises(AgentTurnError, match="names no failure"):
        answered(failure=AgentTurnFailure.FRAMEWORK)


def test_a_reply_longer_than_the_thread_can_hold_is_refused() -> None:
    with pytest.raises(AgentTurnError, match=f"at most {MAX_AGENT_TURN_LENGTH}"):
        answered(body="x" * (MAX_AGENT_TURN_LENGTH + 1))


def test_a_failed_attempt_says_where_it_broke() -> None:
    with pytest.raises(AgentTurnError, match="where the attempt broke"):
        AgentTurn(ordinal=0, attempt=1, outcome=AgentTurnOutcome.FAILED)


def test_a_failed_attempt_carries_no_reply() -> None:
    """A framework's error text is not something the agent said, so it is never a body."""
    with pytest.raises(AgentTurnError, match="carries no reply"):
        AgentTurn(
            ordinal=0,
            attempt=1,
            outcome=AgentTurnOutcome.FAILED,
            failure=AgentTurnFailure.MODEL_PROVIDER,
            body="the provider returned 400",
        )


def test_a_failed_attempt_is_recorded_with_its_kind() -> None:
    turn = AgentTurn(
        ordinal=2,
        attempt=3,
        outcome=AgentTurnOutcome.FAILED,
        failure=AgentTurnFailure.TOOL_ROUND_LIMIT,
    )

    assert turn.outcome is AgentTurnOutcome.FAILED
    assert turn.failure is AgentTurnFailure.TOOL_ROUND_LIMIT
    assert turn.body == ""


def test_an_outcome_must_be_one_the_record_knows() -> None:
    with pytest.raises(AgentTurnError, match="must declare an outcome"):
        answered(outcome="answered")
