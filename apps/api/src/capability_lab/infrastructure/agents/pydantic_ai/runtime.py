"""Pydantic AI running one arm's turn, with the lab keeping every rule that matters.

The framework's job here is narrow on purpose: choose tools, call them, and write a reply.
The tool set, its schemas, the arm it runs against, the identity it acts as, and the record
of what it did all come from outside — so this adapter is roughly "map a `ToolContract` to
an SDK tool and map the SDK's failures back to a classified one", and everything a
comparison later reads is identical in shape to what the deterministic control arm produced.

Five things are worth stating.

**The tool schema is derived, never authored twice.** `sandbox_tool_contracts` exists to be
the one description a framework generates its own dialect from (ADR 0021), and
`tool_json_schema` renders it — shared with every other adapter that speaks JSON Schema, so
that both arms of a framework comparison are offered the same document rather than two
similar ones (ADR 0041). Adding a tool to the lab adds it to this framework without touching
this file.

**A tool's SDK name is not its contract name.** Providers accept `[A-Za-z0-9_-]` in a tool
name and the lab's names carry a domain namespace (`orders.read_order`), so the dot is
rewritten for the wire. Nothing maps it back: each tool's closure already knows which
contract it stands for, so the recorded event carries the contract name and the evidence
never depends on a provider's spelling rules.

**Tools run one at a time.** A write is guarded by the revision it was proposed against, and
the recorded sequence is meant to be the order the agent asked; both stop being true the
moment two calls race. The framework is told so rather than being trusted to be serial.

**Usage is passed through, never re-shaped.** The SDK's own run usage carries more than the
lab compares — cache reads, audio tokens, per-request detail — and only the three counts
every provider bills in are reported, because a comparison across frameworks needs the
columns to line up (`model_cost`). What is dropped is not lost evidence; it is evidence the
lab does not claim to compare.

**A usage limit is the same finding as the lab's own budget.** The only limit configured
here is the configuration's tool-call allowance, so exceeding it is reported as the lab's
`AgentToolBudgetExceededError` rather than as a transient provider fault — the run hit a
setting an author chose, which is a finding about the configuration.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from pydantic_ai import Agent
from pydantic_ai.exceptions import (
    ModelAPIError,
    UnexpectedModelBehavior,
    UsageLimitExceeded,
    UserError,
)
from pydantic_ai.messages import ModelMessage, ModelRequest, ModelResponse, TextPart, UserPromptPart
from pydantic_ai.models import Model
from pydantic_ai.settings import ModelSettings as PydanticModelSettings
from pydantic_ai.tools import Tool
from pydantic_ai.usage import RunUsage, UsageLimits

from capability_lab.application.agent_capabilities import PYDANTIC_AI_FRAMEWORK_ID
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
from capability_lab.application.model_cost import ModelUsage
from capability_lab.application.sandbox_tool_contracts import ToolContract
from capability_lab.application.tool_json_schema import tool_json_schema

__all__ = ["PYDANTIC_AI_RUNTIME_FRAMEWORK_ID", "PydanticAiSupportAgentRuntime"]

PYDANTIC_AI_RUNTIME_FRAMEWORK_ID = PYDANTIC_AI_FRAMEWORK_ID
"""Named out of the capability catalog rather than spelled again here (ADR 0041)."""

# The wire name of a tool, separated from its contract name by a spelling providers accept.
_NAMESPACE_SEPARATOR = "__"


class PydanticAiSupportAgentRuntime(SupportAgentRuntime):
    """Answer one arm's turn with Pydantic AI, without an SDK type leaving this module."""

    def __init__(self, model: Callable[[str], Model]) -> None:
        self._model = model

    @classmethod
    def for_test(cls) -> PydanticAiSupportAgentRuntime:
        """A runtime over Pydantic AI's own test model, which calls every tool it is given.

        Deterministic and offline, and still the real adapter: the schema derivation, the
        name mapping, the message history, and the failure translation are all exercised.
        What it cannot exercise is a model *choosing*, which is what the live smoke test is
        for.
        """
        from pydantic_ai.models.test import TestModel

        return cls(lambda _model_id: TestModel())

    @property
    def framework_id(self) -> str:
        return PYDANTIC_AI_RUNTIME_FRAMEWORK_ID

    async def answer(self, request: AgentTurnRequest, tools: SandboxToolInvoker) -> AgentAnswer:
        agent = Agent(
            self._model(request.model.model_id),
            output_type=str,
            instructions=request.instructions,
            tools=[_tool(contract, tools) for contract in request.tools],
        )
        try:
            result = await agent.run(
                request.message,
                message_history=_history(request),
                model_settings=PydanticModelSettings(temperature=float(request.model.temperature)),
                usage_limits=UsageLimits(tool_calls_limit=request.model.max_tool_rounds),
            )
        except SupportAgentRuntimeError:
            # Already classified — the lab's own budget, or a tool the arm was never
            # offered. Re-raised unchanged so the framework's error mapping below cannot
            # relabel a finding about the configuration as a fault of the provider.
            raise
        except UsageLimitExceeded as error:
            raise AgentToolBudgetExceededError(
                "the agent used every tool call this configuration allows"
            ) from error
        except ModelAPIError as error:
            status_code = getattr(error, "status_code", None)
            if status_code == 429 or (isinstance(status_code, int) and status_code >= 500):
                raise SupportAgentTransientError(
                    "the model provider is temporarily unavailable"
                ) from error
            raise SupportAgentProviderError("the model provider rejected the request") from error
        except UnexpectedModelBehavior as error:
            raise SupportAgentResponseError("the model answered in an unusable shape") from error
        except UserError as error:
            raise SupportAgentFrameworkError(
                "the agent framework could not execute this turn"
            ) from error
        return AgentAnswer(body=result.output, usage=_usage(result.usage))


def _usage(usage: RunUsage) -> ModelUsage:
    """The SDK's run usage as the three counts the lab records.

    `requests` is how many times the provider was actually called, which is what separates
    a one-shot answer from an agent that went round the tool loop five times — the "model
    calls" a comparison reads beside the tool calls the invoker counted.
    """
    return ModelUsage(
        input_tokens=usage.input_tokens,
        output_tokens=usage.output_tokens,
        model_requests=usage.requests,
    )


def _tool(contract: ToolContract, tools: SandboxToolInvoker) -> Tool[None]:
    """One published contract, offered to the model as the tool the invoker will run.

    The closure is what binds the two: the model chooses arguments, and the arm, the actor,
    the version, and the recording are supplied by the invoker it cannot see.
    """

    def call(**arguments: Any) -> dict[str, Any]:
        return tools.invoke(
            contract.name,
            {name: str(value) for name, value in arguments.items() if value is not None},
        )

    return Tool.from_schema(
        call,
        name=contract.name.replace(".", _NAMESPACE_SEPARATOR),
        description=contract.summary,
        json_schema=tool_json_schema(contract),
        # One call at a time. Two reasons, and either alone would be enough: a write is
        # guarded by the revision it was proposed against (ADR 0022), so calls that raced
        # would refuse each other for no reason the agent could act on; and the recorded
        # sequence is meant to be the order the agent asked, which concurrent calls would
        # make a matter of which finished first.
        sequential=True,
    )


def _history(request: AgentTurnRequest) -> list[ModelMessage]:
    """This arm's earlier thread in the SDK's own message shape.

    The customer's words become requests and the agent's become responses, which is the
    only faithful mapping: the participant is the user of this agent, and an arm's previous
    replies are what it said, not what it was told.
    """
    return [_message(message.role, message.body) for message in request.history]


def _message(role: AgentRole, body: str) -> ModelMessage:
    if role is AgentRole.CUSTOMER:
        return ModelRequest(parts=[UserPromptPart(content=body)])
    return ModelResponse(parts=[TextPart(content=body)])
