"""The OpenAI Agents SDK running one arm's turn, held to the lab's rules from outside.

The second framework the lab can run an experiment arm with, and the first one added after
the port existed. It is deliberately the same *shape* of adapter as the Pydantic AI one —
map a `ToolContract` to an SDK tool, map the arm's thread to the SDK's input, map the SDK's
failures back to the lab's classified ones — because everything else about a run is written
by the invoker, the runner, and the record. A comparison is only about the framework if the
evidence is not about the adapter (ADR 0041).

Six things this SDK made the lab decide.

**The tool schema is not derived here.** `tool_json_schema` renders the published argument
table, and both runtimes hand their SDK the same document. Deriving it twice would have made
"the two arms were offered the same tools" a coincidence.

**Strict function schemas are turned off, on purpose.** The SDK's strict mode rewrites a
schema so that *every* property appears in `required`, which would advertise the lab's
optional arguments — `catalog.search_products`' `limit`, `support.search_knowledge`' `kind` —
as mandatory. That is the dialect editing the contract, and it would change what the model is
asked in one arm and not the other. So `strict_json_schema=False`, and an argument the model
gets wrong is refused by the tool with a code it can act on (ADR 0021), which is where the
lab already decided argument mistakes belong.

**A tool's SDK name is not its contract name.** Providers accept `[A-Za-z0-9_-]` and the
lab's names carry a domain namespace, so the dot is rewritten for the wire and nothing maps
it back: each tool's closure knows which contract it stands for, so the recorded event
carries the contract name.

**The SDK relabels anything a tool raises.** A tool that raises what the SDK does not
recognize comes back as `UserError("Error running tool ...")` with the original on
`__cause__`, and *anything* means anything: the lab's own tool budget, but also a sandbox
that stopped resolving and a database that broke underneath one. So the cause is re-raised
unchanged whenever there is one, and only a `UserError` carrying nothing is reported as the
framework failing. Deciding here what an arbitrary exception means would put a broken lab
into a comparison as this framework's behavior — the exact thing the runner refuses to
record (`experiment_runs`).

**Tool calls are serialized in the SDK, not at the provider.**
`max_function_tool_concurrency=1` makes the SDK start each call only after the previous one
returned, which is what a revision-guarded write (ADR 0022) and a recorded sequence meant to
be the order the agent asked actually need. `parallel_tool_calls` is deliberately *not* set:
it changes the request the provider receives, and the arm beside this one does not send it —
two arms asked different questions is the confound this framework was selected to avoid
(ADR 0041).

**The SDK's own tracing is switched off process-wide.** It exports spans carrying tool
arguments and model output to a provider endpoint by default. The lab records the three
spans it opens itself and never sweeps a framework's instrumentation into the record
(`docs/observability.md`), and it cannot promise the sanitization of an attribute it did not
write — so this one is not merely ignored, it is disabled.
"""

from __future__ import annotations

import json
from collections.abc import Callable, Mapping
from typing import Any, cast

from agents import Agent, FunctionTool, RunConfig, Runner, set_tracing_disabled
from agents.exceptions import (
    AgentsException,
    MaxTurnsExceeded,
    ModelBehaviorError,
    ModelRefusalError,
    ModelTimeoutError,
    UserError,
)
from agents.items import TResponseInputItem
from agents.model_settings import ModelSettings as AgentsModelSettings
from agents.models.interface import Model
from agents.run_config import ToolExecutionConfig
from agents.tool import Tool
from agents.tool_context import ToolContext
from agents.usage import Usage
from openai import APIConnectionError, APIStatusError

from capability_lab.application.agent_runtime import (
    AgentAnswer,
    AgentRole,
    AgentToolBudgetExceededError,
    AgentTurnRequest,
    SandboxToolInvoker,
    SupportAgentFrameworkError,
    SupportAgentProviderError,
    SupportAgentResponseError,
    SupportAgentRuntime,
    SupportAgentRuntimeError,
    SupportAgentTransientError,
)
from capability_lab.application.canonical_json import CanonicalValue
from capability_lab.application.model_cost import ModelUsage
from capability_lab.application.sandbox_tool_contracts import ToolContract
from capability_lab.application.tool_json_schema import tool_json_schema

__all__ = [
    "OPENAI_AGENTS_RUNTIME_FRAMEWORK_ID",
    "OpenAiAgentsSupportAgentRuntime",
    "create_openai_agents_model",
]

OPENAI_AGENTS_RUNTIME_FRAMEWORK_ID = "openai-agents"

# The wire name of a tool, separated from its contract name by a spelling providers accept.
_NAMESPACE_SEPARATOR = "__"

# The agent's name reaches the SDK's handoffs and its own traces, neither of which this lab
# uses. A constant rather than the arm's label: an operator's words for an arm are not the
# framework's to see, and the exported span carries the arm's position instead
# (`docs/observability.md`).
_AGENT_NAME = "support"


class OpenAiAgentsSupportAgentRuntime(SupportAgentRuntime):
    """Answer one arm's turn with the OpenAI Agents SDK, without an SDK type leaving here."""

    def __init__(self, model: Callable[[str], Model]) -> None:
        # Process-wide, and deliberately at construction rather than at import: composition
        # decides that this framework runs here, and that is the moment the lab takes
        # responsibility for what the SDK would otherwise export.
        set_tracing_disabled(True)
        self._model = model

    @classmethod
    def for_test(cls) -> OpenAiAgentsSupportAgentRuntime:
        """A runtime over the SDK's own scripted model, which calls every tool it is given.

        Deterministic and offline, and still the real adapter: the schema, the name mapping,
        the input history, the serial tool execution, the usage accounting, and the failure
        translation are all exercised through the SDK's own loop. What it cannot exercise is
        a model *choosing*, which is what the live smoke test is for.

        The SDK ships a scripted model rather than a self-driving one, so the script is the
        lab's: call every offered tool once, then answer. That is the behavior Pydantic AI's
        `TestModel` has, chosen so the two runtimes' offline evidence differs only where the
        frameworks do.
        """
        return cls(lambda _model_id: _scripted_model())

    @property
    def framework_id(self) -> str:
        return OPENAI_AGENTS_RUNTIME_FRAMEWORK_ID

    async def answer(self, request: AgentTurnRequest, tools: SandboxToolInvoker) -> AgentAnswer:
        agent = Agent(
            name=_AGENT_NAME,
            instructions=request.instructions,
            output_type=str,
            model=self._model(request.model.model_id),
            # Temperature and nothing else, which is exactly what the Pydantic AI arm
            # sends. Every additional setting is a difference in the request the provider
            # receives, and a difference there is attributed to the framework by everything
            # downstream that reads the two arms.
            model_settings=AgentsModelSettings(temperature=float(request.model.temperature)),
            tools=[_tool(contract, tools) for contract in request.tools],
        )
        try:
            result = await Runner.run(
                agent,
                input=_input(request),
                # One model request per tool round, plus the one that answers. The invoker's
                # per-call budget is the real limit; this stops a framework that keeps
                # talking to itself from running past it for free.
                max_turns=request.model.max_tool_rounds + 1,
                run_config=RunConfig(
                    tool_execution=ToolExecutionConfig(max_function_tool_concurrency=1)
                ),
            )
        except UserError as error:
            # Everything the lab raises inside a tool arrives here wrapped, so this is the
            # only place its own errors can be recovered — and the only place a fault that
            # is nobody's business but the lab's can be let go.
            raise _unwrapped(error) from error
        except MaxTurnsExceeded as error:
            raise AgentToolBudgetExceededError(
                "the agent used every tool round this configuration allows"
            ) from error
        except (ModelBehaviorError, ModelRefusalError) as error:
            raise SupportAgentResponseError("the model answered in an unusable shape") from error
        except (ModelTimeoutError, APIConnectionError) as error:
            raise SupportAgentTransientError(
                "the model provider is temporarily unavailable"
            ) from error
        except APIStatusError as error:
            raise _from_status(error.status_code) from error
        except AgentsException as error:
            raise SupportAgentFrameworkError(
                "the agent framework could not execute this turn"
            ) from error
        return AgentAnswer(
            body=result.final_output_as(str),
            usage=_usage(result.context_wrapper.usage),
        )


def _unwrapped(error: UserError) -> BaseException:
    """What the SDK was actually carrying when a tool raised inside its loop.

    Anything a tool raises that the SDK does not recognize is re-raised as `UserError` with
    the original on `__cause__`, so the cause is what happened and the wrapper is the SDK's
    opinion of it. The cause is handed back untouched, whatever it is.

    Two kinds travel this way and classifying either here ruins it. The lab's own errors —
    the spent tool budget above all — are findings about the *configuration*, and a budget
    reported as "the framework could not execute this turn" would read as the lab breaking.
    And an arm whose snapshot or pins stopped resolving raises a `DefinitionResolutionError`
    from inside the tool: the runner re-raises that without recording anything, precisely so
    a broken lab does not enter a comparison as this framework's behavior, and an adapter
    that renamed it `framework` would take that decision away from the one place that makes
    it. An exception the lab has no name for at all is the runner's too — it logs the type
    and records `framework`, once, rather than differently per SDK.

    Only a `UserError` with no cause is this framework failing: the SDK itself objected, and
    there is nothing underneath it to defer to.
    """
    cause = error.__cause__
    if cause is not None:
        return cause
    return SupportAgentFrameworkError("the agent framework could not execute this turn")


def _from_status(status_code: int) -> SupportAgentRuntimeError:
    """A provider's HTTP answer as the kind of failure the record keeps.

    The same split the Pydantic AI adapter makes, on the same numbers: throttling and a
    provider's own outage are worth retrying, and everything else the provider refused is
    not. Neither carries the provider's words — a message is neither stable across models
    nor safe to store beside synthetic customer content (ADR 0026).
    """
    if status_code == 429 or status_code >= 500:
        return SupportAgentTransientError("the model provider is temporarily unavailable")
    return SupportAgentProviderError("the model provider rejected the request")


def _usage(usage: Usage) -> ModelUsage:
    """The SDK's run usage as the three counts the lab records.

    The SDK meters more than this — cached input, reasoning tokens, a per-request
    breakdown — and only the three counts every provider bills in are reported, because a
    comparison across frameworks needs the columns to line up (`model_cost`). `requests` is
    how many times the provider was actually called, which is what separates a one-shot
    answer from an agent that went round the tool loop five times.
    """
    return ModelUsage(
        input_tokens=usage.input_tokens,
        output_tokens=usage.output_tokens,
        model_requests=usage.requests,
    )


def _tool(contract: ToolContract, tools: SandboxToolInvoker) -> FunctionTool:
    """One published contract, offered to the model as the tool the invoker will run.

    The closure is what binds the two: the model chooses arguments, and the arm, the actor,
    the version, and the recording are supplied by the invoker it cannot see.
    """

    async def call(_context: ToolContext[Any], arguments: str) -> dict[str, CanonicalValue]:
        return tools.invoke(contract.name, _arguments(arguments))

    return FunctionTool(
        name=contract.name.replace(".", _NAMESPACE_SEPARATOR),
        description=contract.summary,
        params_json_schema=tool_json_schema(contract),
        on_invoke_tool=call,
        # See the module docstring: the strict dialect would make every optional argument
        # mandatory, which is the schema editing the contract.
        strict_json_schema=False,
    )


def _arguments(arguments: str) -> dict[str, str]:
    """The model's argument object as the string table a published tool accepts.

    This SDK hands a tool the raw JSON text rather than validating it against the schema
    first, so the parse is the adapter's. Everything that parses is passed through as text
    and left for the tool to judge: a name the contract does not declare and a value it
    cannot use are refusals the agent can act on (ADR 0021), and deciding them here would
    move the lab's own rule into one framework's adapter.

    Arguments that are not a JSON object at all are the one thing no tool could judge, and
    they end the attempt as an unusable answer rather than being turned into a call the
    model did not make.
    """
    if not arguments.strip():
        return {}
    try:
        parsed: object = json.loads(arguments)
    except ValueError as error:
        raise SupportAgentResponseError("the model answered in an unusable shape") from error
    if not isinstance(parsed, dict):
        raise SupportAgentResponseError("the model answered in an unusable shape")
    supplied = cast("dict[str, object]", parsed)
    return {name: str(value) for name, value in supplied.items() if value is not None}


def _input(request: AgentTurnRequest) -> list[TResponseInputItem]:
    """This arm's thread, and then what the customer just said.

    The customer's words are the user's and the agent's own are the assistant's, which is
    the only faithful mapping: the participant is the user of this agent, and an arm's
    previous replies are what it said rather than what it was told. The history may be
    empty, because a configuration keeping no conversation memory is shown none.
    """
    items: list[TResponseInputItem] = [
        {
            "role": "user" if message.role is AgentRole.CUSTOMER else "assistant",
            "content": message.body,
        }
        for message in request.history
    ]
    items.append({"role": "user", "content": request.message})
    return items


def _scripted_model() -> Model:
    """The SDK's scripted model, driven to call every offered tool once and then answer.

    Fresh per turn: a script is consumed as it runs, so a runtime reused across arms would
    otherwise answer the second one with an exhausted queue.
    """
    from agents.testing import ModelCall, ModelStep, ScriptedModel, assistant_message, function_call

    called = False

    def _schema_of(tool: Tool) -> Mapping[str, Any]:
        return tool.params_json_schema if isinstance(tool, FunctionTool) else {}

    def respond(call: ModelCall) -> list[Any]:
        nonlocal called
        if call.tools and not called:
            called = True
            return [
                function_call(tool.name, _sample(_schema_of(tool)), call_id=f"call-{index}")
                for index, tool in enumerate(call.tools)
            ]
        return [assistant_message("I have checked what this conversation is about.")]

    return ScriptedModel([ModelStep.respond(respond), ModelStep.respond(respond)])


def _sample(schema: Mapping[str, Any]) -> dict[str, str]:
    """Arguments filled from the tool's own schema, the way a test model fills them.

    Read off `params_json_schema` rather than off the contract, so what a call carries is
    what actually survived the round trip through the SDK's tool object — which is the half
    a schema derived from the contract table is meant to prove.
    """
    properties: Mapping[str, Mapping[str, Any]] = schema.get("properties", {})
    return {name: _sample_value(declared) for name, declared in properties.items()}


def _sample_value(declared: Mapping[str, Any]) -> str:
    """A value the argument's own schema admits: an enum's first choice, or free text."""
    choices: list[str] = declared.get("enum", [])
    return choices[0] if choices else "sample"


def create_openai_agents_model(model_id: str, api_key: str) -> Model:
    """Build the credentialed provider model inside this adapter's boundary.

    The Responses API, as the Pydantic AI adapter uses, so the two arms of a framework
    comparison reach the same provider surface and the difference between them stays the
    framework.
    """
    from agents import OpenAIResponsesModel
    from openai import AsyncOpenAI

    return OpenAIResponsesModel(model=model_id, openai_client=AsyncOpenAI(api_key=api_key))
