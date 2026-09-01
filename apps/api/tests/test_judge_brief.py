"""The anonymized input a judge is shown: what it carries, and what it must never carry."""

from typing import cast
from uuid import uuid4

from block_factories import publishable_objective
from capability_lab.application.agent_turns import ToolEvent
from capability_lab.application.canonical_json import CanonicalValue
from capability_lab.application.judge_brief import (
    JUDGE_BRIEF_CANONICAL_SCHEMA_VERSION,
    ArmRecord,
    judge_brief,
    judge_brief_fingerprint,
)
from capability_lab.application.sandbox_tool_contracts import ORDER_DETAIL, SUPPORT_DOCUMENT
from capability_lab.application.sandbox_tools import ToolOutcome
from capability_lab.domain.agent_turn import AgentTurn, AgentTurnFailure, AgentTurnOutcome
from capability_lab.domain.experiment import (
    ParticipantDriverType,
    ParticipantTurn,
    ParticipantTurnSource,
)
from capability_lab.domain.judge import JudgeEvidenceScope
from capability_lab.domain.scenario import BoundObjective
from judge_factories import publishable_judge

TURN_ID = uuid4()
BLOCK_ID = uuid4()


def objective() -> BoundObjective:
    return BoundObjective(id="resolve-the-incident", block_id=BLOCK_ID)


def customer(ordinal: int, body: str) -> ParticipantTurn:
    if ordinal == 0:
        return ParticipantTurn(
            turn_id=TURN_ID,
            ordinal=0,
            source=ParticipantTurnSource.TRIGGER,
            driver=None,
            body=body,
        )
    return ParticipantTurn(
        turn_id=uuid4(),
        ordinal=ordinal,
        source=ParticipantTurnSource.PARTICIPANT,
        driver=ParticipantDriverType.HUMAN,
        body=body,
    )


def reply(ordinal: int, body: str) -> AgentTurn:
    return AgentTurn(ordinal=ordinal, attempt=1, outcome=AgentTurnOutcome.ANSWERED, body=body)


def failed(ordinal: int) -> AgentTurn:
    return AgentTurn(
        ordinal=ordinal,
        attempt=1,
        outcome=AgentTurnOutcome.FAILED,
        failure=AgentTurnFailure.MODEL_TRANSIENT,
    )


def call(
    tool: str,
    *,
    sequence: int = 0,
    outcome: ToolOutcome = ToolOutcome.SUCCESS,
    arguments: dict[str, CanonicalValue] | None = None,
    data: dict[str, CanonicalValue] | None = None,
    moved: bool = False,
) -> ToolEvent:
    document: dict[str, CanonicalValue] = {
        "canonical_schema_version": "tool-result-v1",
        "tool": tool,
        "version": "v1",
        "arguments": arguments or {},
        "outcome": outcome.value,
        "data": data,
        "refusal": (
            None
            if outcome is not ToolOutcome.REFUSED
            else {"code": "not_found", "message": "That order reference is not one of yours."}
        ),
    }
    return ToolEvent(
        ordinal=0,
        attempt=1,
        sequence=sequence,
        tool=tool,
        version="v1",
        outcome=outcome,
        document=document,
        revision_before=1,
        revision_after=2 if moved else 1,
        state_fingerprint="f" * 64,
    )


def record(**overrides: object) -> ArmRecord:
    fields: dict[str, object] = {
        "turns": (customer(0, "My parcel is going to my old flat."),),
        "replies": (reply(0, "I found order NS-10482 and redirected it."),),
        "calls": (call(ORDER_DETAIL, arguments={"order_reference": "NS-10482"}),),
    }
    fields.update(overrides)
    return ArmRecord(**fields)  # type: ignore[arg-type]


def leaves(value: object) -> list[str]:
    """Every string anywhere in the brief, so a sweep can read the whole document."""
    if isinstance(value, str):
        return [value]
    if isinstance(value, dict):
        found: list[str] = []
        for key, item in cast("dict[str, object]", value).items():
            found.append(key)
            found.extend(leaves(item))
        return found
    if isinstance(value, list):
        return [leaf for item in cast("list[object]", value) for leaf in leaves(item)]
    return []


def test_the_brief_names_its_schema_and_the_objective_it_asks_about() -> None:
    brief = judge_brief(objective(), publishable_objective(), publishable_judge(), record())

    assert brief["canonical_schema_version"] == JUDGE_BRIEF_CANONICAL_SCHEMA_VERSION
    assert brief["objective"] == {
        "id": "resolve-the-incident",
        "statement": publishable_objective().statement,
        "guidance": publishable_objective().description,
    }


def test_the_brief_names_nothing_about_what_ran_the_arm() -> None:
    """The whole point: a judge scores behavior, and cannot recognize a framework to prefer."""
    brief = judge_brief(objective(), publishable_objective(), publishable_judge(), record())
    written = " ".join(leaves(brief)).casefold()

    for label in ("pydantic", "gpt-5", "fake", "arm a", "deterministic", "framework"):
        assert label not in written


def test_a_scope_the_judge_did_not_ask_for_is_absent_rather_than_empty() -> None:
    """Absence moves the fingerprint, which is right: it is a different question."""
    words_only = publishable_judge(evidence=(JudgeEvidenceScope.AGENT_REPLIES,))
    brief = judge_brief(objective(), publishable_objective(), words_only, record())

    assert "agent_replies" in brief
    assert "tool_calls" not in brief
    assert "customer_turns" not in brief


def test_two_judges_shown_different_things_read_different_inputs() -> None:
    everything = judge_brief(objective(), publishable_objective(), publishable_judge(), record())
    words_only = judge_brief(
        objective(),
        publishable_objective(),
        publishable_judge(evidence=(JudgeEvidenceScope.AGENT_REPLIES,)),
        record(),
    )

    assert judge_brief_fingerprint(everything) != judge_brief_fingerprint(words_only)


def test_one_arm_read_twice_produces_one_fingerprint() -> None:
    first = judge_brief(objective(), publishable_objective(), publishable_judge(), record())
    second = judge_brief(objective(), publishable_objective(), publishable_judge(), record())

    assert judge_brief_fingerprint(first) == judge_brief_fingerprint(second)


def test_a_call_carries_what_was_asked_and_never_what_the_world_answered() -> None:
    """The facts are deterministic evidence; what a judge adds is a reading of conduct."""
    brief = judge_brief(
        objective(),
        publishable_objective(),
        publishable_judge(),
        record(
            calls=(
                call(
                    SUPPORT_DOCUMENT,
                    arguments={"document_id": "shipping"},
                    data={"body": "Parcels ship within two days."},
                ),
            )
        ),
    )

    assert brief["tool_calls"] == [
        {
            "tool": SUPPORT_DOCUMENT,
            "arguments": {"document_id": "shipping"},
            "outcome": "success",
        }
    ]


def test_a_refused_call_carries_its_code_and_not_its_message() -> None:
    brief = judge_brief(
        objective(),
        publishable_objective(),
        publishable_judge(),
        record(calls=(call(ORDER_DETAIL, outcome=ToolOutcome.REFUSED),)),
    )
    calls = brief["tool_calls"]

    assert isinstance(calls, list)
    assert calls[0]["refusal"] == "not_found"  # type: ignore[index]
    assert "not one of yours" not in " ".join(leaves(brief))


def test_an_attempt_that_failed_contributes_no_words_and_keeps_its_calls() -> None:
    """The agent said nothing, but what it read before it broke is still what it read."""
    brief = judge_brief(
        objective(),
        publishable_objective(),
        publishable_judge(),
        record(replies=(failed(0),), calls=(call(ORDER_DETAIL),)),
    )

    assert brief["agent_replies"] == []
    assert brief["tool_calls"]


def test_the_calls_read_in_the_order_the_agent_asked() -> None:
    brief = judge_brief(
        objective(),
        publishable_objective(),
        publishable_judge(),
        record(
            calls=(
                call(ORDER_DETAIL, sequence=1),
                call(SUPPORT_DOCUMENT, sequence=0),
            )
        ),
    )
    calls = brief["tool_calls"]

    assert isinstance(calls, list)
    assert [entry["tool"] for entry in calls] == [SUPPORT_DOCUMENT, ORDER_DETAIL]  # type: ignore[index]


def test_state_changes_report_only_the_calls_that_moved_the_arm() -> None:
    brief = judge_brief(
        objective(),
        publishable_objective(),
        publishable_judge(evidence=(JudgeEvidenceScope.STATE_CHANGES,)),
        record(
            calls=(
                call(ORDER_DETAIL, sequence=0),
                call("orders.apply_address_change", sequence=1, moved=True),
            )
        ),
    )
    changes = brief["state_changes"]

    assert isinstance(changes, list)
    assert [entry["tool"] for entry in changes] == ["orders.apply_address_change"]  # type: ignore[index]
