"""What this process can run right now, composed from where the lab is pointed.

The three factories here used to read `Settings` and be called once, at start-up, which made
"can this lab reach a model" a property of the process. ADR 0052 moves the connection into
the lab's own database, where it can change while the process runs, so each factory now takes
a **resolved connection** and `create_app` holds the factory rather than the registry it
returns.

**All three move together**, including the POC's `AgentRegistry`: a lab pointed at Ollama that
still sent the POC's conversations to OpenAI would be a split nobody would predict from the
settings page.

**The test environment's short-circuit precedes the chain.** `sdk_doubles` is the first branch
of every factory below, and the resolved connection is not consulted at all when it is set —
which is what keeps every suite in this repository independent of what an operator has saved,
and keeps a double from claiming an endpoint it never called.

**Reading the connection per request is not the same as rebuilding a registry per request**,
and `ComposedPerConnection` is where the two come apart. What ADR 0052 moved is *when the
connection is read*; a registry is what that reading composes, and composing one costs a
provider client. The POC's adapter builds its client eagerly — it takes a `Model` rather than a
factory, unlike the two runtime registries below — so rebuilding it on every conversation turn
and every framework listing would open a connection pool per request and drop it unclosed. So
the resolution is read every request and a registry is rebuilt only when the answer changes,
which is the arrangement that stood before this slice with its lifetime shortened from the
process to the connection.
"""

from __future__ import annotations

from collections.abc import Callable

from capability_lab.application.agent_runtime import (
    SupportAgentRuntime,
    SupportAgentRuntimeRegistry,
)
from capability_lab.application.conversations import AgentRegistry, FrameworkDeclaration
from capability_lab.application.judge_runtime import JudgeRuntime, JudgeRuntimeRegistry
from capability_lab.application.model_connections import ResolvedConnection
from capability_lab.application.ports import AgentAdapter
from capability_lab.infrastructure.agents.fake import FakeAgentAdapter, FakeSupportAgentRuntime
from capability_lab.infrastructure.agents.openai_agents import (
    OpenAiAgentsSupportAgentRuntime,
    create_openai_agents_model,
)
from capability_lab.infrastructure.agents.pydantic_ai import (
    PydanticAiAgentAdapter,
    PydanticAiSupportAgentRuntime,
)
from capability_lab.infrastructure.agents.pydantic_ai.adapter import create_openai_model
from capability_lab.infrastructure.judges import ControlJudgeRuntime, PydanticAiJudgeRuntime
from capability_lab.infrastructure.model_endpoints import UNCREDENTIALED_API_KEY
from capability_lab.infrastructure.telemetry import SanitizedTracingAgentAdapter, Telemetry


class ComposedPerConnection[T]:
    """One registry built from a resolved connection and reused while that resolution stands.

    A single slot rather than a cache with a policy: a lab holds one connection per provider,
    so there is one live answer at a time and an entry that stops being current stops being
    useful in the same instant. Keyed by **the whole resolution** and compared by value, which
    is the part that has to be exactly right — keying on the base URL alone would keep serving
    a client built with a credential the operator has just replaced, which is a staleness bug
    worse than the cost it would save.

    The discarded registry's provider client is not closed, and that is deliberate rather than
    overlooked: it happens once per repointing rather than once per request, and closing an
    `AsyncOpenAI` needs an await this synchronous seam does not have. Nothing closes the held
    one at shutdown either, exactly as nothing closed the start-up registry this replaces.
    Under concurrent first requests two registries may be built and one dropped; the same
    argument covers all three.

    Holding a registry holds the decrypted credential in this process's memory for as long as
    the resolution stands. ADR 0052's rule does not reach that and is not weakened by it — it
    governs what leaves the process, and the composed provider client holds the same key
    whether or not this object keeps the resolution beside it.
    """

    def __init__(self, build: Callable[[ResolvedConnection], T]) -> None:
        self._build = build
        self._held: tuple[ResolvedConnection, T] | None = None

    def __call__(self, connection: ResolvedConnection) -> T:
        held = self._held
        if held is not None and held[0] == connection:
            return held[1]
        built = self._build(connection)
        self._held = (connection, built)
        return built


UNREACHED_PROVIDER = "this lab is not pointed at a model provider"
"""Why a model-backed framework is absent, in the words the POC's declaration carries.

Deliberately no longer `AGENT_LAB_OPENAI_API_KEY is not configured`: that variable is now the
bootstrap rather than the only answer, and a reader told to set it would be told to take the
path the settings page exists to replace (ADR 0052).
"""


def create_agent_registry(
    connection: ResolvedConnection,
    telemetry: Telemetry,
    *,
    model_id: str,
    sdk_doubles: bool = False,
) -> AgentRegistry:
    """The POC's conversation adapters, pointed where the rest of the lab is pointed.

    `model_id` stays process configuration rather than joining the connection: the record
    holds no model (ADR 0052), and this is the one surface where the environment still decides
    which model is reached — the POC's conversation routes, which name no configuration.
    """
    adapters: dict[str, AgentAdapter] = {}
    fake = SanitizedTracingAgentAdapter(FakeAgentAdapter(), telemetry)
    adapters[fake.framework_id] = fake

    pydantic_adapter: AgentAdapter | None = None
    unavailable_reason: str | None = None
    if sdk_doubles:
        pydantic_adapter = PydanticAiAgentAdapter.for_test()
    elif connection.base_url is not None:
        pydantic_adapter = PydanticAiAgentAdapter(
            create_openai_model(
                model_id, connection.api_key or UNCREDENTIALED_API_KEY, connection.base_url
            )
        )
    else:
        unavailable_reason = UNREACHED_PROVIDER

    if pydantic_adapter is not None:
        pydantic_adapter = SanitizedTracingAgentAdapter(pydantic_adapter, telemetry)
        adapters[pydantic_adapter.framework_id] = pydantic_adapter

    declarations = tuple(
        _declaration(
            adapter,
            model_id=model_id if adapter.framework_id == "pydantic-ai" else None,
        )
        for adapter in adapters.values()
    ) + (
        ()
        if pydantic_adapter is not None
        else (
            FrameworkDeclaration(
                framework_id="pydantic-ai",
                available=False,
                model_id=model_id,
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


def create_support_agent_runtimes(
    connection: ResolvedConnection, *, sdk_doubles: bool = False
) -> SupportAgentRuntimeRegistry:
    """The frameworks this process can run an experiment arm with, right now.

    Deliberately a second registry rather than a method on the first. The POC's
    `AgentRegistry` serves the persona-first conversation routes through `AgentAdapter`; an
    arm runs through `SupportAgentRuntime` against its own sandbox. One registry holding two
    unrelated ports would only make it look as though a framework registered for one were
    available for the other.

    The deterministic control arm is always here — an offline lab must still be able to run
    an experiment — while the model-backed one appears only when the resolved connection
    reaches an endpoint. An arm the process cannot run is refused at the moment it is
    advanced and never recorded as a failed turn, because where the lab is pointed is a fact
    about the installation rather than something the agent did.

    "Right now" is the word that changed with ADR 0052. This is called per request, so an
    operator who saves a connection stops being offline without restarting anything — and one
    advance resolves once and runs to completion against what it resolved, so a save landing
    halfway cannot move the endpoint underneath a model call.
    """
    control = FakeSupportAgentRuntime()
    runtimes: dict[str, SupportAgentRuntime] = {control.framework_id: control}
    if sdk_doubles:
        modelled: tuple[SupportAgentRuntime, ...] = (
            PydanticAiSupportAgentRuntime.for_test(),
            OpenAiAgentsSupportAgentRuntime.for_test(),
        )
    elif connection.base_url is not None:
        api_key = connection.api_key or UNCREDENTIALED_API_KEY
        base_url = connection.base_url
        # The model comes from each arm's published configuration, not from this process:
        # what an experiment ran is an authored input (ADR 0024), and a runtime that
        # substituted the environment's model would make two arms unexplainable. The
        # endpoint is the opposite kind of fact — it is the lab's, not the author's — so it
        # is closed over here and recorded on the run that reached it.
        modelled = (
            PydanticAiSupportAgentRuntime(
                lambda model_id: create_openai_model(model_id, api_key, base_url),
                model_base_url=base_url,
            ),
            OpenAiAgentsSupportAgentRuntime(
                lambda model_id: create_openai_agents_model(model_id, api_key, base_url),
                model_base_url=base_url,
            ),
        )
    else:
        # Both model-backed frameworks reach the same endpoint under the same credential,
        # so they appear and disappear together. An arm neither of them can run is refused
        # when it is advanced rather than recorded as a failed turn.
        return SupportAgentRuntimeRegistry(runtimes)
    runtimes.update({runtime.framework_id: runtime for runtime in modelled})
    return SupportAgentRuntimeRegistry(runtimes)


def create_judge_runtimes(
    connection: ResolvedConnection, *, sdk_doubles: bool = False
) -> JudgeRuntimeRegistry:
    """The judges this process can actually score with, right now.

    A third registry rather than a member of either other one, for the reason there are
    already two: an adapter serves the POC's conversations, a runtime runs an experiment
    arm, and a judge reads a record none of them can see. One registry holding three
    unrelated ports would only make it look as though a provider registered for one were
    available for the others.

    The deterministic control judge is always here, so an offline lab can still run an
    evaluation end to end; the model-backed one appears only when the resolved connection
    reaches an endpoint. A judge this process cannot run is refused when it is asked to score
    and never recorded as a failed execution, because where the lab is pointed is a fact about
    the installation rather than something an arm did (ADR 0031).
    """
    control = ControlJudgeRuntime()
    runtimes: dict[str, JudgeRuntime] = {control.provider: control}
    if sdk_doubles:
        judge = PydanticAiJudgeRuntime.for_test()
    elif connection.base_url is not None:
        api_key = connection.api_key or UNCREDENTIALED_API_KEY
        base_url = connection.base_url
        # The model comes from the published judge, not from this process: what scored a run
        # is an authored input, and a runtime that substituted the environment's model would
        # make a recorded verdict unexplainable.
        judge = PydanticAiJudgeRuntime(
            lambda model_id: create_openai_model(model_id, api_key, base_url),
            model_base_url=base_url,
        )
    else:
        return JudgeRuntimeRegistry(runtimes)
    runtimes[judge.provider] = judge
    return JudgeRuntimeRegistry(runtimes)
