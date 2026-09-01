"""Judge payloads the suites publish and score with.

One publishable judge, and the two ways a judge is refused: a rubric that says nothing, and
a rubric that names what an arm runs.
"""

from decimal import Decimal

from capability_lab.application.judge_capabilities import CONTROL_JUDGE_PROVIDER
from capability_lab.domain.judge import (
    JudgeConfigurationPayload,
    JudgeEvidenceScope,
    JudgeModel,
)

RUBRIC = (
    "Score whether the support agent resolved the incident the customer opened: it must "
    "identify the order in question and act on it, and say plainly what it changed."
)


def control_model() -> JudgeModel:
    """The offline judge, so a suite scores without a provider."""
    return JudgeModel(
        provider=CONTROL_JUDGE_PROVIDER,
        model_id="deterministic",
        temperature=Decimal("0.00"),
    )


def publishable_judge(**overrides: object) -> JudgeConfigurationPayload:
    fields: dict[str, object] = {
        "name": "Resolution quality",
        "model": control_model(),
        "description": "Reads the incident as the customer would.",
        "rubric": RUBRIC,
        "evidence": (
            JudgeEvidenceScope.AGENT_REPLIES,
            JudgeEvidenceScope.CUSTOMER_TURNS,
            JudgeEvidenceScope.TOOL_CALLS,
        ),
    }
    fields.update(overrides)
    return JudgeConfigurationPayload(**fields)  # type: ignore[arg-type]
