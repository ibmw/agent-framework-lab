"""Public v1 contract for the versioned read tools and for running one against an arm.

Two operations, and they answer different questions. `GET /tools` publishes the contract
set itself — what a tool is called, at which version, and what it accepts — because a tool
contract is versioned public API in its own right (`docs/api-and-schema-conventions.md`) and
because a sandbox snapshot fingerprints itself against exactly this list. `POST
/shops/{shop_id}/sandboxes/{sandbox_id}/tool-calls` runs one of them against one arm.

Running a read tool is a POST because a call carries structured arguments, not because it
changes anything: every tool here is a read, and two identical calls against an unmoved arm
answer with identical bytes. The write path is still absent — the safe address-change action
is the next outcome of this milestone and is what will first move an arm.

The response envelope carries the outcome the tool reached, not the outcome of the HTTP
request. A refusal is a 200 with `outcome: "refused"`: the tool ran and declined, which is a
domain answer an agent has to reason about rather than a transport failure. Only a call that
never ran is an HTTP error — a sandbox that is not there, or a tool this lab does not
publish.

The tool's own payload travels as an opaque canonical document. Its shape belongs to the
tool contract, which is versioned separately and per tool; restating eight payload schemas
here would create a second source of truth that drifts the first time one tool moves.
"""

from collections.abc import Callable, Generator
from typing import Annotated, Any, Self

from fastapi import APIRouter, Depends
from pydantic import Field

from capability_lab.application.sandbox_tool_contracts import (
    TOOL_RESULT_CANONICAL_SCHEMA_VERSION,
    ToolArgument,
    ToolArgumentKind,
    ToolContract,
)
from capability_lab.application.sandbox_tools import (
    SandboxToolService,
    ToolCall,
    ToolExecution,
    ToolOutcome,
    ToolRefusal,
    ToolRefusalCode,
)
from capability_lab.presentation.base import StrictApiModel
from capability_lab.presentation.definitions import InvalidResponses, NotFoundResponses
from capability_lab.presentation.sandboxes import SandboxIdPath
from capability_lab.presentation.shops import ShopIdPath

MAX_ARGUMENT_LENGTH = 500
MAX_ARGUMENT_NAME_LENGTH = 64
# Comfortably above the widest contract published here, which declares two.
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
    """One published read tool."""

    name: str
    version: str
    summary: str
    arguments: list[ToolArgumentSchema]

    @classmethod
    def from_domain(cls, contract: ToolContract) -> Self:
        return cls(
            name=contract.name,
            version=contract.version,
            summary=contract.summary,
            arguments=[ToolArgumentSchema.from_domain(argument) for argument in contract.arguments],
        )


class ToolContractListResponse(StrictApiModel):
    tools: list[ToolContractSchema]


class ToolCallRequest(StrictApiModel):
    tool: Annotated[str, Field(min_length=1, description="The published tool name to run.")]
    version: Annotated[
        str, Field(min_length=1, description="The version of that tool this caller expects.")
    ]
    arguments: ToolArguments


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
    contract. `sandbox_revision` is provenance rather than part of the answer: it is the
    token the first writer of this milestone will present back when it changes what it read.
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
                        tool=command.tool, version=command.version, arguments=command.arguments
                    ),
                )
            )

        router.add_api_route(
            "/tools",
            list_tool_contracts,
            methods=["GET"],
            response_model=ToolContractListResponse,
            operation_id="listToolContracts",
            summary="List the versioned read tools an experiment arm can be given",
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
            summary="Run one versioned read tool against one arm's sandbox",
            description=(
                "Reads the arm's own state and the exact published versions its snapshot "
                "pinned. A tool that understands the call and declines it answers with "
                "outcome 'refused' and HTTP 200; only a call that could not run at all is an "
                "HTTP error."
            ),
            responses=NotFoundResponses | InvalidResponses,
        )


__all__ = ["SandboxToolRoutes"]
