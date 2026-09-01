from __future__ import annotations

from capability_lab.application.agent_runtime import (
    SupportAgentRuntime,
    SupportAgentRuntimeRegistry,
)
from capability_lab.application.conversations import AgentRegistry, FrameworkDeclaration
from capability_lab.application.judge_runtime import JudgeRuntime, JudgeRuntimeRegistry
from capability_lab.application.ports import AgentAdapter
from capability_lab.infrastructure.agents.fake import FakeAgentAdapter, FakeSupportAgentRuntime
from capability_lab.infrastructure.agents.pydantic_ai import (
    PydanticAiAgentAdapter,
    PydanticAiSupportAgentRuntime,
)
from capability_lab.infrastructure.agents.pydantic_ai.adapter import create_openai_model
from capability_lab.infrastructure.config import Settings
from capability_lab.infrastructure.judges import ControlJudgeRuntime, PydanticAiJudgeRuntime
from capability_lab.infrastructure.telemetry import SanitizedTracingAgentAdapter, Telemetry


def create_agent_registry(settings: Settings, telemetry: Telemetry) -> AgentRegistry:
    adapters: dict[str, AgentAdapter] = {}
    fake = SanitizedTracingAgentAdapter(FakeAgentAdapter(), telemetry)
    adapters[fake.framework_id] = fake

    pydantic_adapter: AgentAdapter | None = None
    unavailable_reason: str | None = None
    if settings.environment == "test":
        pydantic_adapter = PydanticAiAgentAdapter.for_test()
    elif settings.openai_api_key is not None:
        pydantic_adapter = PydanticAiAgentAdapter(
            create_openai_model(
                settings.openai_model,
                settings.openai_api_key.get_secret_value(),
            )
        )
    else:
        unavailable_reason = "AGENT_LAB_OPENAI_API_KEY is not configured"

    if pydantic_adapter is not None:
        pydantic_adapter = SanitizedTracingAgentAdapter(pydantic_adapter, telemetry)
        adapters[pydantic_adapter.framework_id] = pydantic_adapter

    declarations = tuple(
        _declaration(
            adapter,
            model_id=settings.openai_model if adapter.framework_id == "pydantic-ai" else None,
        )
        for adapter in adapters.values()
    ) + (
        ()
        if pydantic_adapter is not None
        else (
            FrameworkDeclaration(
                framework_id="pydantic-ai",
                available=False,
                model_id=settings.openai_model,
                capabilities=(),
                unavailability_reason=unavailable_reason,
            ),
        )
    )
    return AgentRegistry(adapters, declarations)


def _declaration(adapter: AgentAdapter, *, model_id: str | None) -> FrameworkDeclaration:
    return FrameworkDeclaration(
        framework_id=adapter.framework_id,
        available=True,
        model_id=model_id,
        capabilities=tuple(sorted(capability.value for capability in adapter.capabilities())),
    )


def create_support_agent_runtimes(settings: Settings) -> SupportAgentRuntimeRegistry:
    """The frameworks this process can run an experiment arm with.

    Deliberately a second registry rather than a method on the first. The POC's
    `AgentRegistry` serves the persona-first conversation routes through `AgentAdapter`; an
    arm runs through `SupportAgentRuntime` against its own sandbox. One registry holding two
    unrelated ports would only make it look as though a framework registered for one were
    available for the other.

    The deterministic control arm is always here — an offline lab must still be able to run
    an experiment — while the model-backed one appears only when this process is configured
    to reach a provider. An arm the process cannot run is refused at the moment it is
    advanced and never recorded as a failed turn, because a missing API key is a fact about
    the machine rather than something the agent did.
    """
    control = FakeSupportAgentRuntime()
    runtimes: dict[str, SupportAgentRuntime] = {control.framework_id: control}
    if settings.environment == "test":
        pydantic_runtime = PydanticAiSupportAgentRuntime.for_test()
    elif settings.openai_api_key is not None:
        api_key = settings.openai_api_key.get_secret_value()
        # The model comes from each arm's published configuration, not from this process:
        # what an experiment ran is an authored input (ADR 0024), and a runtime that
        # substituted the environment's model would make two arms unexplainable.
        pydantic_runtime = PydanticAiSupportAgentRuntime(
            lambda model_id: create_openai_model(model_id, api_key)
        )
    else:
        return SupportAgentRuntimeRegistry(runtimes)
    runtimes[pydantic_runtime.framework_id] = pydantic_runtime
    return SupportAgentRuntimeRegistry(runtimes)


def create_judge_runtimes(settings: Settings) -> JudgeRuntimeRegistry:
    """The judges this process can actually score with.

    A third registry rather than a member of either other one, for the reason there are
    already two: an adapter serves the POC's conversations, a runtime runs an experiment
    arm, and a judge reads a record none of them can see. One registry holding three
    unrelated ports would only make it look as though a provider registered for one were
    available for the others.

    The deterministic control judge is always here, so an offline lab can still run an
    evaluation end to end; the model-backed one appears only when this process is configured
    to reach a provider. A judge this process cannot run is refused when it is asked to score
    and never recorded as a failed execution, because a missing API key is a fact about the
    machine rather than something an arm did (ADR 0031).
    """
    control = ControlJudgeRuntime()
    runtimes: dict[str, JudgeRuntime] = {control.provider: control}
    if settings.environment == "test":
        judge = PydanticAiJudgeRuntime.for_test()
    elif settings.openai_api_key is not None:
        api_key = settings.openai_api_key.get_secret_value()
        # The model comes from the published judge, not from this process: what scored a run
        # is an authored input, and a runtime that substituted the environment's model would
        # make a recorded verdict unexplainable.
        judge = PydanticAiJudgeRuntime(lambda model_id: create_openai_model(model_id, api_key))
    else:
        return JudgeRuntimeRegistry(runtimes)
    runtimes[judge.provider] = judge
    return JudgeRuntimeRegistry(runtimes)
