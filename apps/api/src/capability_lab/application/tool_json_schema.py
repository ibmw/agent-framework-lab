"""What a framework is handed about a tool: the question, and the answer.

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

The *answer* is rendered here for the same reason and it is the half that was missing. A
tool hands back a `tool-result-v1` document, and every SDK turns that object into the text
the provider actually receives by whatever rule it happens to have: Pydantic AI serializes
it as JSON, and the OpenAI Agents SDK falls through to Python's `str()` unless the tool
returns text already — which would have shown one arm `{"applied": false}` and the other
`{'applied': False}`. Two arms shown the same facts in two notations are not being asked
the same question, and no reading of the record downstream could attribute the difference
to anything (ADR 0042). So both adapters render the result themselves, through the lab's
own canonical serializer, and hand their SDK text it passes along untouched.
"""

from __future__ import annotations

from typing import Any

from capability_lab.application.canonical_json import CanonicalValue, canonical_json_text
from capability_lab.application.sandbox_tool_contracts import (
    ToolArgument,
    ToolArgumentKind,
    ToolContract,
)

__all__ = ["tool_json_schema", "tool_result_text"]


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


def tool_result_text(document: dict[str, CanonicalValue]) -> str:
    """One `tool-result-v1` document as the text a model is shown.

    The lab's canonical serialization, which is already "the single definition of what
    canonical serialization *is*" (`canonical_json`) — sorted, unspaced, NFC-normalized, and
    identical for both arms. It is deliberately the same rendering the record is
    fingerprinted from, so what an arm was told and what the evidence says it was told are
    the same bytes rather than two serializations of one object.

    An adapter calls this and returns the text, rather than returning the document and
    letting the SDK decide: that is the only way a framework's own convention cannot become
    a difference between two arms.
    """
    return canonical_json_text(document)


def _property(argument: ToolArgument) -> dict[str, Any]:
    schema: dict[str, Any] = {"type": "string", "description": argument.description}
    if argument.kind is ToolArgumentKind.ENUM:
        schema["enum"] = list(argument.choices)
    return schema
