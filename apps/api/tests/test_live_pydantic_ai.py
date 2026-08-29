import os

import pytest
from pydantic_ai import Agent

from capability_lab.application.sandbox_tool_contracts import (
    INTERACTION_CONTEXT,
    ORDER_DETAIL,
    SANDBOX_TOOL_CONTRACTS,
)
from capability_lab.infrastructure.agents.pydantic_ai.adapter import create_openai_model
from capability_lab.infrastructure.agents.pydantic_ai.runtime import (
    PydanticAiSupportAgentRuntime,
)
from test_agent_runtimes import StubInvoker, request

LIVE = pytest.mark.skipif(
    os.getenv("AGENT_LAB_RUN_LIVE_MODEL_TESTS") != "1" or not os.getenv("AGENT_LAB_OPENAI_API_KEY"),
    reason="live model smoke tests require an explicit opt-in and local credential",
)
CONTRACTS = {contract.name: contract for contract in SANDBOX_TOOL_CONTRACTS}


@pytest.mark.live_model
@LIVE
def test_configured_openai_model_smoke_call() -> None:
    api_key = os.environ["AGENT_LAB_OPENAI_API_KEY"]

    model = create_openai_model("gpt-5-mini", api_key)

    result = Agent(model).run_sync("Reply with the single word OK.")

    assert result.output.strip()


@pytest.mark.live_model
@LIVE
@pytest.mark.asyncio
async def test_a_live_model_discovers_the_order_through_the_sandbox_tools() -> None:
    """The one thing `TestModel` cannot prove: that a model *chooses* to use these tools.

    Everything else about the adapter — the derived schemas, the wire names, the message
    history, the failure mapping — is covered offline. This asks a real model the incident's
    own question and checks it followed the interaction to the order rather than answering
    from the prompt.
    """
    api_key = os.environ["AGENT_LAB_OPENAI_API_KEY"]
    runtime = PydanticAiSupportAgentRuntime(lambda model_id: create_openai_model(model_id, api_key))
    tools = StubInvoker()

    reply = await runtime.answer(
        request(
            CONTRACTS[INTERACTION_CONTEXT],
            CONTRACTS[ORDER_DETAIL],
            message="I just noticed this is going to my old address. Which one is on it?",
        ),
        tools,
    )

    assert INTERACTION_CONTEXT in tools.called
    assert reply.strip()
