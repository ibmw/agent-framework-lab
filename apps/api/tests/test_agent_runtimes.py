"""The two runtimes that can answer one arm's turn (ADR 0026).

Both are exercised against a stub invoker rather than a live sandbox: what is under test
here is the adapter — which tools it asks for, in what order, and how a framework's failure
becomes a classified one — and the runner's own tests already prove that a call through the
real invoker reaches the real arm.
"""

from collections.abc import Mapping
from decimal import Decimal
from uuid import uuid4

import pytest

from capability_lab.application.agent_runtime import (
    AgentMessage,
    AgentRole,
    AgentToolBudgetExceededError,
    AgentTurnRequest,
    SandboxToolInvoker,
)
from capability_lab.application.canonical_json import CanonicalValue
from capability_lab.application.sandbox_tool_contracts import (
    ADDRESS_CHANGE_APPLY,
    ADDRESS_CHANGE_PROPOSE,
    CUSTOMER_PROFILE,
    INTERACTION_CONTEXT,
    ORDER_DETAIL,
    SANDBOX_TOOL_CONTRACTS,
    SUPPORT_SEARCH,
    TOOL_RESULT_CANONICAL_SCHEMA_VERSION,
    ToolContract,
)
from capability_lab.application.sandbox_tools import ToolOutcome
from capability_lab.domain.agent_configuration import ModelSettings
from capability_lab.infrastructure.agents.fake import FakeSupportAgentRuntime
from capability_lab.infrastructure.agents.pydantic_ai import PydanticAiSupportAgentRuntime

CONTRACTS = {contract.name: contract for contract in SANDBOX_TOOL_CONTRACTS}

STALE_ORDER: dict[str, CanonicalValue] = {
    "reference": "NS-10482",
    "ships_to": "9 quai des Chartrons, 33000 Bordeaux",
    "shipping_address": {"source_address_id": "bordeaux-previous-flat"},
}
CUSTOMER: dict[str, CanonicalValue] = {
    "addresses": [
        {
            "id": "bordeaux-previous-flat",
            "line1": "9 quai des Chartrons",
            "postal_code": "33000",
            "city": "Bordeaux",
            "country": "FR",
            "is_default": False,
        },
        {
            "id": "home",
            "line1": "18 rue des Écoles",
            "postal_code": "69005",
            "city": "Lyon",
            "country": "FR",
            "is_default": True,
        },
    ]
}
CONTEXT: dict[str, CanonicalValue] = {
    "origin": {"kind": "order_page", "order_reference": "NS-10482"},
    "linked_orders": [],
}


class StubInvoker(SandboxToolInvoker):
    """Answers each tool from a table and remembers what was asked, in order."""

    def __init__(
        self,
        data: dict[str, dict[str, CanonicalValue]] | None = None,
        refused: frozenset[str] = frozenset(),
    ) -> None:
        self.calls: list[tuple[str, dict[str, str]]] = []
        self._data = data or {
            INTERACTION_CONTEXT: CONTEXT,
            ORDER_DETAIL: STALE_ORDER,
            CUSTOMER_PROFILE: CUSTOMER,
            ADDRESS_CHANGE_PROPOSE: {"confirmation": "c0ffee", "applied": False},
            ADDRESS_CHANGE_APPLY: {"confirmation": "c0ffee", "applied": True},
        }
        self._refused = refused

    def invoke(self, tool: str, arguments: Mapping[str, str]) -> dict[str, CanonicalValue]:
        self.calls.append((tool, dict(arguments)))
        if tool in self._refused:
            return _envelope(tool, ToolOutcome.REFUSED, None)
        return _envelope(tool, ToolOutcome.SUCCESS, self._data.get(tool, {}))

    @property
    def called(self) -> list[str]:
        return [name for name, _ in self.calls]


def _envelope(
    tool: str, outcome: ToolOutcome, data: dict[str, CanonicalValue] | None
) -> dict[str, CanonicalValue]:
    return {
        "canonical_schema_version": TOOL_RESULT_CANONICAL_SCHEMA_VERSION,
        "tool": tool,
        "version": "v1",
        "arguments": {},
        "outcome": outcome.value,
        "data": data,
        "refusal": None
        if outcome is ToolOutcome.SUCCESS
        else {"code": "not_found", "message": "nothing here answers to that"},
    }


def request(
    *tools: ToolContract,
    message: str = "This is going to my old address.",
    history: tuple[AgentMessage, ...] = (),
    max_tool_rounds: int = 8,
) -> AgentTurnRequest:
    return AgentTurnRequest(
        run_id=uuid4(),
        arm_label="Arm A",
        instructions="You are a support representative for Northstar Outfitters.",
        model=ModelSettings(
            provider="fake",
            model_id="deterministic",
            temperature=Decimal("0.20"),
            max_tool_rounds=max_tool_rounds,
        ),
        tools=tools,
        history=history,
        message=message,
    )


def every_tool() -> tuple[ToolContract, ...]:
    return SANDBOX_TOOL_CONTRACTS


# -- the deterministic control arm ---------------------------------------------


@pytest.mark.asyncio
async def test_the_control_arm_follows_the_incident_to_the_order_and_redirects_it() -> None:
    tools = StubInvoker()

    reply = await FakeSupportAgentRuntime().answer(request(*every_tool()), tools)

    assert tools.called == [
        INTERACTION_CONTEXT,
        ORDER_DETAIL,
        CUSTOMER_PROFILE,
        ADDRESS_CHANGE_PROPOSE,
        ADDRESS_CHANGE_APPLY,
    ]
    assert "NS-10482" in reply
    assert "18 rue des Écoles" in reply


@pytest.mark.asyncio
async def test_the_control_arm_applies_the_confirmation_the_proposal_answered_with() -> None:
    """Never a confirmation of its own making — that is what makes it a consent binding."""
    tools = StubInvoker()

    await FakeSupportAgentRuntime().answer(request(*every_tool()), tools)

    proposed = dict(tools.calls[3][1])
    applied = dict(tools.calls[4][1])
    assert proposed == {"order_reference": "NS-10482", "address_id": "home"}
    assert applied == {"confirmation": "c0ffee"}


@pytest.mark.asyncio
async def test_the_control_arm_never_calls_a_tool_it_was_not_offered() -> None:
    reads = tuple(CONTRACTS[name] for name in (INTERACTION_CONTEXT, ORDER_DETAIL))
    tools = StubInvoker()

    reply = await FakeSupportAgentRuntime().answer(request(*reads), tools)

    assert tools.called == [INTERACTION_CONTEXT, ORDER_DETAIL]
    assert "18 rue des Écoles" not in reply


@pytest.mark.asyncio
async def test_the_control_arm_leaves_an_order_that_already_ships_to_the_default() -> None:
    """A write spent on a change the world would refuse says more about the fake than the run."""
    tools = StubInvoker(
        data={
            INTERACTION_CONTEXT: CONTEXT,
            ORDER_DETAIL: {**STALE_ORDER, "shipping_address": {"source_address_id": "home"}},
            CUSTOMER_PROFILE: CUSTOMER,
        }
    )

    reply = await FakeSupportAgentRuntime().answer(request(*every_tool()), tools)

    assert ADDRESS_CHANGE_PROPOSE not in tools.called
    assert "already the address on file" in reply


@pytest.mark.asyncio
async def test_a_refusal_stops_the_step_that_depended_on_it() -> None:
    """A refusal is an answer the agent acts on (ADR 0021), not a failure of the turn."""
    tools = StubInvoker(refused=frozenset({INTERACTION_CONTEXT}))

    reply = await FakeSupportAgentRuntime().answer(request(*every_tool()), tools)

    assert tools.called == [INTERACTION_CONTEXT, CUSTOMER_PROFILE]
    assert "could not find an order" in reply


@pytest.mark.asyncio
async def test_a_refused_proposal_leaves_nothing_to_confirm() -> None:
    tools = StubInvoker(refused=frozenset({ADDRESS_CHANGE_PROPOSE}))

    reply = await FakeSupportAgentRuntime().answer(request(*every_tool()), tools)

    assert ADDRESS_CHANGE_APPLY not in tools.called
    assert "redirected" not in reply


@pytest.mark.asyncio
async def test_the_control_arm_answers_identically_twice_over_one_world() -> None:
    """The whole point of a control: a difference between two runs is never the agent."""
    runtime = FakeSupportAgentRuntime()

    first = await runtime.answer(request(*every_tool()), StubInvoker())
    second = await runtime.answer(request(*every_tool()), StubInvoker())

    assert first == second


# -- Pydantic AI ----------------------------------------------------------------


@pytest.mark.asyncio
async def test_pydantic_ai_offers_every_tool_the_configuration_enables() -> None:
    """Pydantic AI's test model calls each tool once, which is what proves they arrived."""
    tools = StubInvoker()
    offered = tuple(CONTRACTS[name] for name in (INTERACTION_CONTEXT, ORDER_DETAIL))

    reply = await PydanticAiSupportAgentRuntime.for_test().answer(request(*offered), tools)

    assert sorted(tools.called) == sorted([INTERACTION_CONTEXT, ORDER_DETAIL])
    assert reply


@pytest.mark.asyncio
async def test_pydantic_ai_records_the_contract_name_not_the_wire_name() -> None:
    """A provider's spelling rules must never reach the evidence."""
    tools = StubInvoker()

    await PydanticAiSupportAgentRuntime.for_test().answer(request(CONTRACTS[SUPPORT_SEARCH]), tools)

    assert tools.called == [SUPPORT_SEARCH]
    assert "__" not in tools.called[0]


@pytest.mark.asyncio
async def test_pydantic_ai_derives_its_argument_schema_from_the_contract() -> None:
    """Every argument is text, so a model can only fill in what the contract declares."""
    tools = StubInvoker()

    await PydanticAiSupportAgentRuntime.for_test().answer(request(CONTRACTS[SUPPORT_SEARCH]), tools)

    _, arguments = tools.calls[0]
    assert set(arguments) <= {"query", "kind"}
    assert all(isinstance(value, str) for value in arguments.values())


@pytest.mark.asyncio
async def test_pydantic_ai_maps_its_own_usage_limit_to_the_configuration_s_budget() -> None:
    """The only limit configured is the tool allowance, so exceeding it is that finding.

    A transient provider fault would be the wrong answer: nothing was unavailable, the run
    used every tool call an author allowed it.
    """
    with pytest.raises(AgentToolBudgetExceededError):
        await PydanticAiSupportAgentRuntime.for_test().answer(
            request(*every_tool(), max_tool_rounds=1), StubInvoker()
        )


@pytest.mark.asyncio
async def test_the_lab_s_own_budget_ends_the_turn_through_the_framework() -> None:
    """The invoker's budget is the backstop for a framework whose limit is looser or absent."""
    with pytest.raises(AgentToolBudgetExceededError):
        await PydanticAiSupportAgentRuntime.for_test().answer(
            request(*every_tool(), max_tool_rounds=50), _ExhaustingInvoker()
        )


@pytest.mark.asyncio
async def test_pydantic_ai_carries_the_arm_s_earlier_thread() -> None:
    history = (
        AgentMessage(role=AgentRole.CUSTOMER, body="Can you change the address?"),
        AgentMessage(role=AgentRole.AGENT, body="Which address should it go to?"),
    )

    reply = await PydanticAiSupportAgentRuntime.for_test().answer(
        request(CONTRACTS[INTERACTION_CONTEXT], history=history), StubInvoker()
    )

    assert reply


class _ExhaustingInvoker(SandboxToolInvoker):
    """Refuses the second call the way the lab's own invoker refuses a spent budget."""

    def __init__(self) -> None:
        self._spent = 0

    def invoke(self, tool: str, arguments: Mapping[str, str]) -> dict[str, CanonicalValue]:
        if self._spent >= 1:
            raise AgentToolBudgetExceededError("this configuration allows 1 tool call per turn")
        self._spent += 1
        return _envelope(tool, ToolOutcome.SUCCESS, {})
