"""Pydantic AI scoring one objective, with the lab keeping every rule that matters.

The framework's job here is narrower than it is for an arm: no tools, no memory, no loop.
It is handed a rubric and an anonymized document and asked for one value out of three plus a
reason, and structured output is what makes that a contract rather than a hope.

Three things are worth stating.

**The verdict type is the lab's enum, mapped once.** The model is given a closed literal and
the adapter maps it back to `JudgeOutcome`; nothing parses prose for a verdict. A judge whose
free text were scanned for the word "met" would make the scale depend on phrasing.

**The brief is passed as its canonical JSON.** The same bytes the fingerprint is taken over,
so what the model read and what the record says it read cannot drift apart. It is data in
the user turn, deliberately, and the rubric is the instruction — a model told to follow a
document it is also asked to score would have no boundary between the two.

**The lab's framing sits above the author's rubric.** What the outcomes mean, and that
"unclear" is a real answer rather than a failure, are the lab's rules and are not left to
each author to restate — a rubric that forgot them would quietly turn every uncertain row
into a verdict.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Literal

from pydantic import BaseModel
from pydantic_ai import Agent
from pydantic_ai.exceptions import (
    ModelAPIError,
    UnexpectedModelBehavior,
    UsageLimitExceeded,
    UserError,
)
from pydantic_ai.models import Model
from pydantic_ai.settings import ModelSettings as PydanticModelSettings

from capability_lab.application.canonical_json import canonical_json_bytes
from capability_lab.application.judge_capabilities import OPENAI_JUDGE_PROVIDER
from capability_lab.application.judge_runtime import (
    JudgeProviderError,
    JudgeRequest,
    JudgeResponseError,
    JudgeRuntime,
    JudgeTransientError,
    JudgeVerdict,
)
from capability_lab.domain.judge import JudgeOutcome
from capability_lab.domain.judgement import MAX_RATIONALE_LENGTH

__all__ = ["JUDGE_FRAMING", "PydanticAiJudgeRuntime"]

JUDGE_FRAMING = (
    "You are evaluating one support agent's handling of one incident against one objective. "
    "You are shown a structured record of what that agent did and said; you are deliberately "
    "not told what software or model produced it, and you must not speculate about it. "
    "Answer with exactly one outcome: 'met' if the record shows the objective was achieved, "
    "'missed' if the record shows it was not, and 'unclear' if the record does not settle it. "
    "'unclear' is a real answer and is preferred over a guess. Give a short reason that cites "
    "what in the record led you there."
)
"""The lab's own instruction, above every rubric: what the three outcomes mean.

Above rather than merged into the rubric, because these are rules about the *scale* rather
than about the question, and an author must not be able to redefine them by writing a rubric
that says something else.
"""


class _Verdict(BaseModel):
    """The structured output the model is constrained to, mapped once on the way out.

    The rationale is deliberately unbounded here and truncated below. A provider's strict
    structured output does not enforce `maxLength`, so a length constraint would be a
    client-side check the model never saw: a verbose judge would produce a real verdict,
    fail validation, exhaust its retries, and be recorded as an unusable answer on a row it
    actually decided. Truncating what came back keeps the verdict.
    """

    outcome: Literal["met", "missed", "unclear"]
    rationale: str = ""


class PydanticAiJudgeRuntime(JudgeRuntime):
    """Score one objective with Pydantic AI, without an SDK type leaving this module."""

    def __init__(self, model: Callable[[str], Model]) -> None:
        self._model = model

    @classmethod
    def for_test(cls) -> PydanticAiJudgeRuntime:
        """A runtime over Pydantic AI's own test model, which fills the structured output.

        Deterministic and offline, and still the real adapter: the framing, the canonical
        brief, the output constraint, and the failure translation are all exercised. What it
        cannot exercise is a model *deciding*, which is what the live smoke test is for.
        """
        from pydantic_ai.models.test import TestModel

        return cls(lambda _model_id: TestModel())

    @property
    def provider(self) -> str:
        return OPENAI_JUDGE_PROVIDER

    async def score(self, request: JudgeRequest) -> JudgeVerdict:
        agent = Agent(
            self._model(request.model.model_id),
            output_type=_Verdict,
            instructions=f"{JUDGE_FRAMING}\n\nRubric:\n{request.rubric}",
        )
        try:
            result = await agent.run(
                canonical_json_bytes(dict(request.brief)).decode("utf-8"),
                model_settings=PydanticModelSettings(temperature=float(request.model.temperature)),
            )
        except UsageLimitExceeded as error:
            raise JudgeTransientError("the judge exceeded its usage allowance") from error
        except ModelAPIError as error:
            status_code = getattr(error, "status_code", None)
            if status_code == 429 or (isinstance(status_code, int) and status_code >= 500):
                raise JudgeTransientError(
                    "the model provider is temporarily unavailable"
                ) from error
            raise JudgeProviderError("the model provider rejected the request") from error
        except UnexpectedModelBehavior as error:
            raise JudgeResponseError("the judge answered in an unusable shape") from error
        except UserError as error:
            raise JudgeProviderError("the judge could not be executed") from error
        return JudgeVerdict(
            outcome=JudgeOutcome(result.output.outcome),
            rationale=result.output.rationale.strip()[:MAX_RATIONALE_LENGTH],
        )
