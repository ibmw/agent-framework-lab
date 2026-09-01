"""The two judges behind the port: the declared control rule, and Pydantic AI over a brief."""

from decimal import Decimal

import pytest
from pydantic_ai.exceptions import ModelAPIError, UnexpectedModelBehavior
from pydantic_ai.messages import ModelMessage, ModelResponse, TextPart
from pydantic_ai.models.function import AgentInfo, FunctionModel

from capability_lab.application.canonical_json import CanonicalValue
from capability_lab.application.judge_runtime import (
    JudgeProviderError,
    JudgeRequest,
    JudgeResponseError,
    JudgeRuntimeError,
    JudgeRuntimeRegistry,
    JudgeTransientError,
    JudgeUnavailableError,
    JudgeVerdict,
)
from capability_lab.domain.judge import JudgeModel, JudgeOutcome
from capability_lab.domain.judgement import MAX_RATIONALE_LENGTH, JudgeFailure
from capability_lab.infrastructure.judges import ControlJudgeRuntime, PydanticAiJudgeRuntime
from capability_lab.infrastructure.judges.pydantic_ai import JUDGE_FRAMING

RUBRIC = "Score whether the incident was resolved."


def brief(**overrides: CanonicalValue) -> dict[str, CanonicalValue]:
    document: dict[str, CanonicalValue] = {
        "canonical_schema_version": "judge-brief-v1",
        "objective": {"id": "resolve-the-incident", "statement": "Resolve it", "guidance": ""},
        "customer_turns": [{"ordinal": 0, "body": "My parcel is going to my old flat."}],
        "agent_replies": [{"ordinal": 0, "body": "I have redirected it."}],
    }
    document.update(overrides)
    return document


def request(**overrides: CanonicalValue) -> JudgeRequest:
    return JudgeRequest(
        rubric=RUBRIC,
        model=JudgeModel(provider="fake", model_id="deterministic", temperature=Decimal("0.00")),
        brief=brief(**overrides),
    )


# -- the declared control rule ---------------------------------------------------


@pytest.mark.asyncio
async def test_the_control_judge_meets_an_arm_that_answered_everything() -> None:
    verdict = await ControlJudgeRuntime().score(request())

    assert verdict.outcome is JudgeOutcome.MET
    assert verdict.rationale


@pytest.mark.asyncio
async def test_the_control_judge_misses_an_arm_that_never_spoke() -> None:
    verdict = await ControlJudgeRuntime().score(request(agent_replies=[]))

    assert verdict.outcome is JudgeOutcome.MISSED


@pytest.mark.asyncio
async def test_an_arm_still_mid_incident_is_unclear_rather_than_missed() -> None:
    """Running out of answers is not failing; the arm has a turn it has not answered yet."""
    verdict = await ControlJudgeRuntime().score(
        request(
            customer_turns=[
                {"ordinal": 0, "body": "My parcel is going to my old flat."},
                {"ordinal": 1, "body": "Any update?"},
            ]
        )
    )

    assert verdict.outcome is JudgeOutcome.UNCLEAR
    assert "turn 1" in verdict.rationale


@pytest.mark.asyncio
async def test_a_control_judge_shown_no_replies_says_so_rather_than_guessing() -> None:
    """Its rule reads words. Shown none, it reports the limit rather than scoring the arm."""
    document = brief()
    del document["agent_replies"]
    verdict = await ControlJudgeRuntime().score(
        JudgeRequest(
            rubric=RUBRIC,
            model=JudgeModel(provider="fake", model_id="deterministic"),
            brief=document,
        )
    )

    assert verdict.outcome is JudgeOutcome.UNCLEAR


@pytest.mark.asyncio
async def test_the_control_judge_answers_identically_twice_over_one_brief() -> None:
    first = await ControlJudgeRuntime().score(request())
    second = await ControlJudgeRuntime().score(request())

    assert first == second


# -- Pydantic AI over the brief --------------------------------------------------


def answering(reply: str) -> PydanticAiJudgeRuntime:
    """A runtime over a model whose structured answer this test decides."""

    async def respond(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        respond.seen = messages  # type: ignore[attr-defined]
        respond.info = info  # type: ignore[attr-defined]
        return ModelResponse(parts=[TextPart(content=reply)])

    runtime = PydanticAiJudgeRuntime(lambda _model_id: FunctionModel(respond))
    runtime.responder = respond  # type: ignore[attr-defined]
    return runtime


def raising(error: Exception) -> PydanticAiJudgeRuntime:
    async def respond(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        raise error

    return PydanticAiJudgeRuntime(lambda _model_id: FunctionModel(respond))


@pytest.mark.asyncio
async def test_pydantic_ai_answers_in_the_lab_s_vocabulary() -> None:
    runtime = PydanticAiJudgeRuntime.for_test()

    verdict = await runtime.score(request())

    assert isinstance(verdict, JudgeVerdict)
    assert verdict.outcome in set(JudgeOutcome)


@pytest.mark.asyncio
async def test_the_lab_s_framing_sits_above_the_author_s_rubric() -> None:
    """What the outcomes mean is the lab's rule, and a rubric cannot redefine it."""
    runtime = answering('{"outcome": "met", "rationale": "it resolved"}')

    await runtime.score(request())

    instructions = str(runtime.responder.seen[0].instructions)  # type: ignore[attr-defined]
    assert instructions.startswith(JUDGE_FRAMING)
    assert RUBRIC in instructions


@pytest.mark.asyncio
async def test_the_brief_reaches_the_model_as_the_bytes_the_fingerprint_covers() -> None:
    runtime = answering('{"outcome": "met", "rationale": "it resolved"}')

    await runtime.score(request())

    prompt = str(runtime.responder.seen[0].parts[-1].content)  # type: ignore[attr-defined]
    assert '"canonical_schema_version":"judge-brief-v1"' in prompt
    assert "pydantic" not in prompt.casefold()


@pytest.mark.asyncio
async def test_a_verdict_outside_the_vocabulary_is_an_unusable_answer() -> None:
    runtime = answering('{"outcome": "excellent", "rationale": "nice"}')

    with pytest.raises(JudgeResponseError):
        await runtime.score(request())


@pytest.mark.asyncio
async def test_a_provider_outage_is_transient_and_a_rejection_is_not() -> None:
    class _Status(ModelAPIError):
        def __init__(self, status_code: int) -> None:
            super().__init__("deterministic", "the provider said so")
            self.status_code = status_code

    with pytest.raises(JudgeTransientError):
        await raising(_Status(503)).score(request())
    with pytest.raises(JudgeProviderError):
        await raising(_Status(400)).score(request())


@pytest.mark.asyncio
async def test_an_unusable_model_answer_is_classified_rather_than_raised_raw() -> None:
    with pytest.raises(JudgeResponseError):
        await raising(UnexpectedModelBehavior("nonsense")).score(request())


# -- the registry ----------------------------------------------------------------


def test_every_runtime_error_names_where_the_execution_broke() -> None:
    """Including the base: an adapter that raised it must not escape the classification."""
    assert JudgeRuntimeError("unclassified").failure is JudgeFailure.INVALID_RESPONSE
    assert JudgeProviderError("refused").failure is JudgeFailure.PROVIDER
    assert JudgeTransientError("later").failure is JudgeFailure.TRANSIENT
    assert JudgeResponseError("unusable").failure is JudgeFailure.INVALID_RESPONSE


@pytest.mark.asyncio
async def test_a_rationale_longer_than_the_record_holds_is_truncated_not_refused() -> None:
    """A verbose judge still decided the row; the length cap is the lab's, not the model's."""
    runtime = answering(
        f'{{"outcome": "met", "rationale": "{"a" * (MAX_RATIONALE_LENGTH + 200)}"}}'
    )

    verdict = await runtime.score(request())

    assert verdict.outcome is JudgeOutcome.MET
    assert len(verdict.rationale) == MAX_RATIONALE_LENGTH


def test_a_provider_this_process_cannot_reach_is_refused_rather_than_substituted() -> None:
    registry = JudgeRuntimeRegistry({"fake": ControlJudgeRuntime()})

    assert registry.providers() == ("fake",)
    with pytest.raises(JudgeUnavailableError):
        registry.get("openai")
