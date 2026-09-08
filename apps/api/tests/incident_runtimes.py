"""Each framework's offline model, driven by the one incident declaration beside it.

`incident_script` says what the agent decides; this says how each SDK is told. The two are
separate files on purpose: the declaration imports no SDK, so neither framework can quietly
acquire a decision of its own, and a reviewer can see that the two arms of the offline
comparison are reading the same script by reading one of them.

Both runtimes below are the **real** adapters — the schema derivation, the wire naming, the
serial execution, the message mapping, the usage accounting and the failure translation all
run. Only the model is a double, at each SDK's own provider-neutral seam, which is the same
place `for_test()` substitutes one.
"""

from __future__ import annotations

from collections.abc import Sequence
from itertools import count
from typing import cast

from agents.items import TResponseOutputItem
from agents.models.interface import Model
from agents.testing import ModelCall, ModelStep, ScriptedModel, assistant_message, function_call
from agents.usage import Usage
from pydantic_ai.messages import (
    ModelMessage,
    ModelRequest,
    ModelResponse,
    TextPart,
    ToolCallPart,
    ToolReturnPart,
)
from pydantic_ai.models.function import AgentInfo, FunctionModel

from capability_lab.application.agent_capabilities import (
    OPENAI_AGENTS_FRAMEWORK_ID,
    PYDANTIC_AI_FRAMEWORK_ID,
)
from capability_lab.application.agent_runtime import SupportAgentRuntime
from capability_lab.application.canonical_json import CanonicalValue
from capability_lab.infrastructure.agents.openai_agents import OpenAiAgentsSupportAgentRuntime
from capability_lab.infrastructure.agents.pydantic_ai import PydanticAiSupportAgentRuntime
from incident_script import (
    INCIDENT_REPLY,
    INCIDENT_SCRIPT,
    IncidentDriver,
    parse_result,
)

__all__ = ["INCIDENT_RUNTIMES", "incident_runtimes"]

# What the OpenAI Agents SDK's scripted model reports having spent per provider call. The
# figure is invented — no offline model meters a call it did not make — and it is deliberately
# not zero, because zero is the reading `model_cost` reserves for an arm that called no
# provider at all (ADR 0041). Pydantic AI's `FunctionModel` estimates its own from the
# messages, so only this side needs telling.
_SCRIPTED_USAGE_PER_CALL = Usage(requests=1, input_tokens=100, output_tokens=25, total_tokens=125)


def _pydantic_ai_incident() -> FunctionModel:
    """Pydantic AI's function model, walking the script once for this turn."""
    driver = IncidentDriver()

    def respond(messages: list[ModelMessage], _info: AgentInfo) -> ModelResponse:
        call = driver.next_call(_returns(messages))
        if call is None:
            return ModelResponse(parts=[TextPart(content=INCIDENT_REPLY)])
        name, arguments = call
        return ModelResponse(parts=[ToolCallPart(tool_name=name, args=dict(arguments))])

    return FunctionModel(respond)


def _returns(messages: Sequence[ModelMessage]) -> list[dict[str, CanonicalValue]]:
    """Every tool result this turn has seen, in the order the calls were made.

    Asked of the part rather than filtered for text: the adapter renders the document itself
    (`tool_json_schema`), so the two are the same string today, and a driver that kept only
    strings would go blind against an adapter that stopped rendering — spending the tool
    budget instead of reporting the rendering it found.
    """
    return [
        parse_result(part.model_response_str())
        for message in messages
        if isinstance(message, ModelRequest)
        for part in message.parts
        if isinstance(part, ToolReturnPart)
    ]


def _openai_agents_incident() -> Model:
    """The OpenAI Agents SDK's scripted model, walking the same script.

    One step per call the script can make plus the one that answers. Steps the turn does not
    reach are left unconsumed, which is what a skipped step means: the script ran out of
    calls it could fill, not out of provider calls it was allowed.
    """
    driver = IncidentDriver()
    calls = count()

    def respond(call: ModelCall) -> list[TResponseOutputItem]:
        step = driver.next_call(_outputs(call.input))
        if step is None:
            return [assistant_message(INCIDENT_REPLY)]
        name, arguments = step
        return [function_call(name, arguments, call_id=f"call-{next(calls)}")]

    return ScriptedModel(
        [ModelStep.respond(respond) for _ in range(len(INCIDENT_SCRIPT) + 1)],
        default_usage=_SCRIPTED_USAGE_PER_CALL,
    )


def _outputs(items: object) -> list[dict[str, CanonicalValue]]:
    """Every tool result this turn has seen, out of the SDK's own input list.

    The adapter hands the SDK the rendered text, and the SDK passes text through untouched,
    so what comes back here is the same document the other driver reads.
    """
    if not isinstance(items, list):  # pragma: no cover - the adapter always sends a list
        return []
    entries = cast("list[object]", items)
    outputs: list[dict[str, CanonicalValue]] = []
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        item = cast("dict[str, object]", entry)
        output = item.get("output")
        if item.get("type") == "function_call_output" and isinstance(output, str):
            outputs.append(parse_result(output))
    return outputs


def incident_runtimes() -> tuple[SupportAgentRuntime, ...]:
    """One runtime per model-backed framework, each running the incident offline.

    Fresh per call: each SDK's double is built per turn from the factory the adapter holds,
    and a suite that shared runtimes across experiments would share nothing but the factory
    anyway. Returned as a tuple so the caller decides what registry they belong in.
    """
    return (
        PydanticAiSupportAgentRuntime(lambda _model_id: _pydantic_ai_incident()),
        OpenAiAgentsSupportAgentRuntime(lambda _model_id: _openai_agents_incident()),
    )


INCIDENT_RUNTIMES: tuple[str, ...] = (PYDANTIC_AI_FRAMEWORK_ID, OPENAI_AGENTS_FRAMEWORK_ID)
"""The frameworks this module can run the incident with, for a sweep to check itself against."""
