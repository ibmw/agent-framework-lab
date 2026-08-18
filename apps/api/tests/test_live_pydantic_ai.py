import os

import pytest
from pydantic_ai import Agent

from capability_lab.infrastructure.agents.pydantic_ai.adapter import create_openai_model


@pytest.mark.live_model
@pytest.mark.skipif(
    os.getenv("AGENT_LAB_RUN_LIVE_MODEL_TESTS") != "1" or not os.getenv("AGENT_LAB_OPENAI_API_KEY"),
    reason="live model smoke tests require an explicit opt-in and local credential",
)
def test_configured_openai_model_smoke_call() -> None:
    api_key = os.environ["AGENT_LAB_OPENAI_API_KEY"]

    model = create_openai_model("gpt-5-mini", api_key)

    result = Agent(model).run_sync("Reply with the single word OK.")

    assert result.output.strip()
