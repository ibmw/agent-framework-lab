"""One valid call per published tool, against the workspace `workspace_factories` seeds.

A sweep over a hand-written list of calls covers the tools somebody remembered. This table
is checked against `SANDBOX_TOOL_CONTRACTS` instead, so publishing a tool without adding a
call here fails a test rather than quietly shrinking every sweep that reads it.

The arguments are the ones the wrong-address incident actually makes an arm send: the
product the ticket opens on, the order the customer quotes, the shipping policy the incident
turns on, and the address-book entry the change redirects to.
"""

from collections.abc import Mapping
from typing import cast

from capability_lab.application.sandbox_actions import ToolActor
from capability_lab.application.sandbox_tool_contracts import (
    ADDRESS_CHANGE_APPLY,
    ADDRESS_CHANGE_PROPOSE,
    CATALOG_PRODUCT,
    CATALOG_SEARCH,
    CUSTOMER_PROFILE,
    INTERACTION_CONTEXT,
    ORDER_DETAIL,
    ORDER_LIST,
    SANDBOX_TOOL_CONTRACTS,
    SUPPORT_DOCUMENT,
    SUPPORT_SEARCH,
    TOOL_VERSION,
    ToolContract,
)
from capability_lab.application.sandbox_tools import (
    SandboxToolService,
    ToolCall,
    ToolOutcome,
)
from capability_lab.application.sandboxes import SandboxRecord

PRODUCT_HANDLE = "alpine-shell-jacket"
ORDER_REFERENCE = "NS-10482"
CURRENT_ADDRESS_ID = "home"
"""The entry the stale order does *not* ship to, so a proposal is a real change."""

PROPOSED = "«the confirmation the proposal answered with»"
"""Stand-in for a value only a live arm can mint; `sample_call` resolves it by proposing."""

SAMPLE_ARGUMENTS: Mapping[str, Mapping[str, str]] = {
    INTERACTION_CONTEXT: {},
    CATALOG_SEARCH: {"query": "jacket"},
    CATALOG_PRODUCT: {"handle": PRODUCT_HANDLE},
    CUSTOMER_PROFILE: {},
    ORDER_LIST: {},
    ORDER_DETAIL: {"order_reference": ORDER_REFERENCE},
    SUPPORT_SEARCH: {"query": "address", "kind": "policy"},
    SUPPORT_DOCUMENT: {"kind": "policy", "document_id": "shipping"},
    ADDRESS_CHANGE_PROPOSE: {
        "order_reference": ORDER_REFERENCE,
        "address_id": CURRENT_ADDRESS_ID,
    },
    ADDRESS_CHANGE_APPLY: {"confirmation": PROPOSED},
}


def sample_call(
    service: SandboxToolService,
    arm: SandboxRecord,
    contract: ToolContract,
    actor: ToolActor | None = None,
    **overrides: str,
) -> ToolCall:
    """A call this arm can answer, with `PROPOSED` resolved against the arm it will run on.

    Applying a change needs a confirmation that names one exact change to one exact arm, so
    it cannot be tabulated. Proposing first is not a shortcut around that rule — it is the
    rule, and running it here is how a sweep reaches the apply handler at all.
    """
    arguments = dict(SAMPLE_ARGUMENTS[contract.name])
    arguments.update(overrides)
    if arguments.get("confirmation") == PROPOSED:
        arguments["confirmation"] = propose(service, arm, actor)
    return ToolCall(tool=contract.name, version=contract.version, arguments=arguments, actor=actor)


def propose(service: SandboxToolService, arm: SandboxRecord, actor: ToolActor | None) -> str:
    """Run the proposal and hand back the confirmation it named the change by."""
    result = service.execute(
        arm.shop_id,
        arm.sandbox_id,
        ToolCall(
            tool=ADDRESS_CHANGE_PROPOSE,
            version=TOOL_VERSION,
            arguments=SAMPLE_ARGUMENTS[ADDRESS_CHANGE_PROPOSE],
            actor=actor,
        ),
    ).result
    assert result.outcome is ToolOutcome.SUCCESS, result.refusal
    assert result.data is not None
    return cast("str", result.data["confirmation"])


def uncovered_tools() -> list[str]:
    """The published tools this table has no call for, and the calls that name no tool."""
    return sorted(SAMPLE_ARGUMENTS.keys() ^ {contract.name for contract in SANDBOX_TOOL_CONTRACTS})
