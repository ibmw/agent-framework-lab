"""The published argument table rendered as JSON Schema, once for every framework.

ADR 0021 declared the argument table so that "a framework adapter generates whatever schema
dialect its SDK wants from this table" rather than authoring the schema twice. With one
adapter that was a rule about where a schema comes *from*; with two it becomes a question
about whether the two arms are asked the same thing.

Every SDK the lab has met so far speaks JSON Schema, so the rendering itself is not a
dialect — it is the same document handed to two different libraries. Deriving it here rather
than in each adapter makes "both arms offered the model the same tools" a property of the
code instead of a similarity two files happen to keep, which is the difference between a
comparison about the framework and a comparison about someone's transcription.

What stays in each adapter is genuinely per-SDK: the name a provider will accept, how the
schema is attached to a tool object, and whether the SDK validates arguments against it
before calling.

The mapping is mechanical because the table is deliberately narrow. Every argument is text
(ADR 0021), so a property is a string, an enum lists its choices, a required argument joins
`required`, and nothing else is accepted — a model that invents an argument is refused by
the tool with a code it can act on rather than silently dropped here.
"""

from __future__ import annotations

from typing import Any

from capability_lab.application.sandbox_tool_contracts import (
    ToolArgument,
    ToolArgumentKind,
    ToolContract,
)

__all__ = ["tool_json_schema"]


def tool_json_schema(contract: ToolContract) -> dict[str, Any]:
    """One published contract's arguments, as the object schema a model is shown.

    `required` lists only the arguments the contract actually requires. That is worth
    stating because it is the one place a stricter dialect would disagree: OpenAI's strict
    function schema requires *every* property to appear in `required`, so rendering strictly
    would advertise an optional argument as mandatory and change what the model is asked.
    An adapter whose SDK offers a strict mode therefore turns it off (ADR 0041) rather than
    letting the dialect edit the contract.
    """
    return {
        "type": "object",
        "properties": {argument.name: _property(argument) for argument in contract.arguments},
        "required": [argument.name for argument in contract.arguments if argument.required],
        "additionalProperties": False,
    }


def _property(argument: ToolArgument) -> dict[str, Any]:
    schema: dict[str, Any] = {"type": "string", "description": argument.description}
    if argument.kind is ToolArgumentKind.ENUM:
        schema["enum"] = list(argument.choices)
    return schema
