"""Public v1 contract for the versioned tools and for running one against an arm.

Two operations, and they answer different questions. `GET /tools` publishes the contract
set itself — what a tool is called, at which version, what it may do, and what it accepts —
because a tool contract is versioned public API in its own right (`docs/api-and-schema-
conventions.md`) and because a sandbox snapshot fingerprints itself against exactly this
list. `POST /shops/{shop_id}/sandboxes/{sandbox_id}/tool-calls` runs one of them against one
arm.

One endpoint runs both kinds, and the contract's declared `effect` is what tells them apart.
A second endpoint for writes was rejected: an agent calls tools, not routes, and splitting
them would make the transport carry a distinction the tool contract already publishes — with
the adapter, the console, and the fingerprint each having to learn it twice.

What a write adds to the envelope is the `actor`, and it sits beside the arguments rather
than among them. Arguments are what a model fills in; the actor is whose authority the call
runs under, and a model that could name it would be choosing its own permissions.

The response envelope carries the outcome the tool reached, not the outcome of the HTTP
request. A refusal is a 200 with `outcome: "refused"`: the tool ran and declined, which is a
domain answer an agent has to reason about rather than a transport failure. That includes a
stale write — an arm that moved after the change was proposed is the world the agent has to
notice, not the transport failing, so it refuses at 200 rather than answering 409. Only a
call that never ran is an HTTP error: a sandbox that is not there, a tool this lab does not
publish, or a write offered with nobody acting.

The tool's own payload travels as an opaque canonical document. Its shape belongs to the
tool contract, which is versioned separately and per tool; restating ten payload schemas
here would create a second source of truth that drifts the first time one tool moves.
"""

from collections.abc import Callable, Generator
from typing import Annotated, Any, Self
from uuid import UUID

from fastapi import APIRouter, Depends
from pydantic import Field

from capability_lab.application.sandbox_actions import ToolActor
from capability_lab.application.sandbox_tool_contracts import (
    TOOL_RESULT_CANONICAL_SCHEMA_VERSION,
    ToolArgument,
    ToolArgumentKind,
    ToolContract,
    ToolEffect,
    ToolRefusal,
    ToolRefusalCode,
)
from capability_lab.application.sandbox_tools import (
    SandboxToolService,
    ToolCall,
    ToolExecution,
    ToolOutcome,
)
from capability_lab.presentation.base import StrictApiModel
from capability_lab.presentation.definitions import InvalidResponses, NotFoundResponses
from capability_lab.presentation.sandboxes import SandboxIdPath
from capability_lab.presentation.shops import ShopIdPath

MAX_ARGUMENT_LENGTH = 500
MAX_ARGUMENT_NAME_LENGTH = 64
# Comfortably above the widest contract published here, which declares three.
MAX_ARGUMENTS = 16

ToolArguments = Annotated[
    dict[
        Annotated[str, Field(max_length=MAX_ARGUMENT_NAME_LENGTH)],
        Annotated[str, Field(max_length=MAX_ARGUMENT_LENGTH)] | None,
    ],
    Field(
        default_factory=dict,
        max_length=MAX_ARGUMENTS,
        description=(
            "The arguments this call fills, by name. A null or blank value is read as an "
            "argument the caller chose not to answer."
        ),
    ),
]


class ToolArgumentSchema(StrictApiModel):
    """One argument a tool accepts, in the lab's own typed vocabulary.

    Deliberately not JSON Schema: a framework adapter derives whatever dialect its SDK wants
    from this table, and the Studio renders a field from the same description.
    """

    name: str
    kind: ToolArgumentKind
    description: str
    required: bool
    choices: list[str]

    @classmethod
    def from_domain(cls, argument: ToolArgument) -> Self:
        return cls(
            name=argument.name,
            kind=argument.kind,
            description=argument.description,
            required=argument.required,
            choices=list(argument.choices),
        )


class ToolContractSchema(StrictApiModel):
    """One published tool.

    `effect` is what tells a caller the two kinds apart before it calls either: a write needs
    an actor, and — for the one write published here — has to be proposed before it can be
    applied. An adapter reads it to route the two differently instead of keeping a list of
    tool names it knows to be dangerous.
    """

    name: str
    version: str
    summary: str
    effect: ToolEffect
    arguments: list[ToolArgumentSchema]

    @classmethod
    def from_domain(cls, contract: ToolContract) -> Self:
        return cls(
            name=contract.name,
            version=contract.version,
            summary=contract.summary,
            effect=contract.effect,
            arguments=[ToolArgumentSchema.from_domain(argument) for argument in contract.arguments],
        )


class ToolContractListResponse(StrictApiModel):
    tools: list[ToolContractSchema]


class ToolActorSchema(StrictApiModel):
    """The published support-identity version whose authority the call runs under."""

    support_identity_id: UUID
    version: Annotated[int, Field(ge=1)]

    def to_domain(self) -> ToolActor:
        return ToolActor(support_identity_id=self.support_identity_id, version=self.version)


class ToolCallRequest(StrictApiModel):
    tool: Annotated[str, Field(min_length=1, description="The published tool name to run.")]
    version: Annotated[
        str, Field(min_length=1, description="The version of that tool this caller expects.")
    ]
    arguments: ToolArguments
    actor: Annotated[
        ToolActorSchema | None,
        Field(
            default=None,
            description=(
                "Whose authority this call runs under. Required by a tool whose effect is "
                "'write'; accepted and not yet consulted by a read. Deliberately outside the "
                "arguments: an agent that could name its own actor would be choosing its own "
                "permissions."
            ),
        ),
    ] = None


class ToolRefusalSchema(StrictApiModel):
    """Why the tool declined, in a vocabulary a caller can branch on."""

    code: ToolRefusalCode
    message: str

    @classmethod
    def from_domain(cls, refusal: ToolRefusal) -> Self:
        return cls(code=refusal.code, message=refusal.message)


class ToolCallResponse(StrictApiModel):
    """One tool result, and where the arm stood when it answered.

    `data` is the tool's own `tool-result-v1` payload, whose shape is that tool's versioned
    contract. `sandbox_revision` and `state_fingerprint` are provenance rather than part of
    the answer, and they describe where the arm stood when the call *started*: for a read
    that is simply where it was, and for a write it is the world the change was computed
    against. A caller that needs the arm's new position reads the arm.
    """

    canonical_schema_version: str
    tool: str
    version: str
    arguments: dict[str, str]
    outcome: ToolOutcome
    data: dict[str, Any] | None
    refusal: ToolRefusalSchema | None
    sandbox_revision: int
    state_fingerprint: str

    @classmethod
    def from_execution(cls, execution: ToolExecution) -> Self:
        result = execution.result
        return cls(
            canonical_schema_version=TOOL_RESULT_CANONICAL_SCHEMA_VERSION,
            tool=result.tool,
            version=result.version,
            arguments=dict(result.arguments),
            outcome=result.outcome,
            data=result.data,
            refusal=None
            if result.refusal is None
            else ToolRefusalSchema.from_domain(result.refusal),
            sandbox_revision=execution.revision,
            state_fingerprint=execution.state_fingerprint,
        )


class SandboxToolRoutes:
    """Route handlers bound to a request-scoped `SandboxToolService` dependency."""

    def __init__(self, service: Callable[[], Generator[SandboxToolService, None, None]]) -> None:
        self._service = service

    def register(self, router: APIRouter) -> None:
        dependency = Depends(self._service)

        def list_tool_contracts(
            service: Annotated[SandboxToolService, dependency],
        ) -> ToolContractListResponse:
            return ToolContractListResponse(
                tools=[ToolContractSchema.from_domain(contract) for contract in service.contracts()]
            )

        def call_sandbox_tool(
            shop_id: ShopIdPath,
            sandbox_id: SandboxIdPath,
            command: ToolCallRequest,
            service: Annotated[SandboxToolService, dependency],
        ) -> ToolCallResponse:
            return ToolCallResponse.from_execution(
                service.execute(
                    shop_id,
                    sandbox_id,
                    ToolCall(
                        tool=command.tool,
                        version=command.version,
                        arguments=command.arguments,
                        actor=None if command.actor is None else command.actor.to_domain(),
                    ),
                )
            )

        router.add_api_route(
            "/tools",
            list_tool_contracts,
            methods=["GET"],
            response_model=ToolContractListResponse,
            operation_id="listToolContracts",
            summary="List the versioned tools an experiment arm can be given",
            description=(
                "The tool set a sandbox snapshot is fingerprinted against. A tool is versioned "
                "individually, so this list carries a version per name rather than one for the "
                "set."
            ),
        )
        router.add_api_route(
            "/shops/{shop_id}/sandboxes/{sandbox_id}/tool-calls",
            call_sandbox_tool,
            methods=["POST"],
            response_model=ToolCallResponse,
            operation_id="callSandboxTool",
            summary="Run one versioned tool against one arm's sandbox",
            description=(
                "Reads the arm's own state and the exact published versions its snapshot "
                "pinned, and — for a tool whose effect is 'write' — changes that arm and no "
                "other. A tool that understands the call and declines it answers with outcome "
                "'refused' and HTTP 200, including when the arm moved after the change was "
                "proposed; only a call that could not run at all is an HTTP error."
            ),
            responses=NotFoundResponses | InvalidResponses,
        )


__all__ = ["SandboxToolRoutes"]
