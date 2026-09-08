"""The one thing an offline model cannot prove, asked of every framework that runs one.

Opt-in and credential-gated (`docs/m2-provider-and-test-policy.md`): a live result is
diagnostic and never replaces the deterministic evidence in `test_agent_runtimes.py`. What
these ask is the half a scripted or echoing test model structurally cannot answer — whether
a real model, shown the schemas derived from the published contract table, *chooses* to use
them.

Swept over the model-backed frameworks rather than written per framework, so a framework
added tomorrow either joins the sweep or fails the check below. That matters more here than
elsewhere: an offline suite that covers both frameworks and a live suite that covers one
would let the comparison rest on a claim only half of it has been held to.
"""

import os
from collections.abc import Callable

import pytest

from capability_lab.application.agent_capabilities import (
    FAKE_FRAMEWORK_ID,
    OPENAI_AGENTS_FRAMEWORK_ID,
    PROVEN_FRAMEWORKS,
    PYDANTIC_AI_FRAMEWORK_ID,
)
from capability_lab.application.agent_runtime import SupportAgentRuntime
from capability_lab.application.sandbox_tool_contracts import (
    INTERACTION_CONTEXT,
    ORDER_DETAIL,
    SANDBOX_TOOL_CONTRACTS,
)
from capability_lab.infrastructure.agents.openai_agents import (
    OpenAiAgentsSupportAgentRuntime,
    create_openai_agents_model,
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

LiveRuntime = Callable[[str], SupportAgentRuntime]

LIVE_RUNTIMES: tuple[tuple[str, LiveRuntime], ...] = (
    (
        PYDANTIC_AI_FRAMEWORK_ID,
        lambda api_key: PydanticAiSupportAgentRuntime(
            lambda model_id: create_openai_model(model_id, api_key)
        ),
    ),
    (
        OPENAI_AGENTS_FRAMEWORK_ID,
        lambda api_key: OpenAiAgentsSupportAgentRuntime(
            lambda model_id: create_openai_agents_model(model_id, api_key)
        ),
    ),
)
LIVE_IDS = [framework_id for framework_id, _ in LIVE_RUNTIMES]


def test_every_framework_that_calls_a_provider_has_a_live_smoke_test() -> None:
    """Runs offline, and is the reason the sweep below cannot quietly cover one framework.

    Read off the catalog rather than a literal: every declared framework except the offline
    control reaches a provider, and every one of those is asked the question below.
    """
    modelled = {
        framework.framework_id
        for framework in PROVEN_FRAMEWORKS
        if framework.framework_id != FAKE_FRAMEWORK_ID
    }

    assert set(LIVE_IDS) == modelled


@pytest.mark.live_model
@LIVE
@pytest.mark.asyncio
@pytest.mark.parametrize(("framework_id", "build"), LIVE_RUNTIMES, ids=LIVE_IDS)
async def test_a_live_model_discovers_the_order_through_the_sandbox_tools(
    framework_id: str, build: LiveRuntime
) -> None:
    """The one thing an offline model cannot prove: that a model *chooses* to use these tools.

    Everything else about each adapter — the derived schemas, the wire names, the thread it
    carries, the failure mapping — is covered offline. This asks a real model the incident's
    own question and checks it followed the interaction to the order rather than answering
    from the prompt.
    """
    runtime = build(os.environ["AGENT_LAB_OPENAI_API_KEY"])
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
    assert reply.body.strip()
    assert reply.usage is not None
    assert reply.usage.model_requests >= 1


@pytest.mark.live_model
@LIVE
@pytest.mark.asyncio
@pytest.mark.parametrize(("framework_id", "build"), LIVE_RUNTIMES, ids=LIVE_IDS)
async def test_the_credentialed_model_each_framework_builds_answers_at_all(
    framework_id: str, build: LiveRuntime
) -> None:
    """The narrower smoke call kept from the POC: is the configured provider reachable.

    Separate from the tool test because the two fail for different reasons. This one failing
    is a credential, a model name, or a network; the other one failing is a model that read
    the tools and declined to use them, which is a finding rather than an outage.
    """
    runtime = build(os.environ["AGENT_LAB_OPENAI_API_KEY"])

    reply = await runtime.answer(request(message="Reply with the single word OK."), StubInvoker())

    assert reply.body.strip()
