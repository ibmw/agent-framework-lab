"""The runtimes that can answer one arm's turn (ADR 0026, ADR 0041).

All are exercised against a stub invoker rather than a live sandbox: what is under test
here is the adapter — which tools it asks for, in what order, and how a framework's failure
becomes a classified one — and the runner's own tests already prove that a call through the
real invoker reaches the real arm.

The file opens with a sweep over every framework the catalog declares, holding each to what
the port promises regardless of what runs it: contract names, string arguments, the lab's
budget, the arm's thread, and an answer of words and a meter. That sweep is what makes a
two-arm comparison about the framework — evidence that differed in *shape* between arms
would be evidence about the adapters, and nothing a reviewer could attribute to either.
A second sweep does the same for the failure taxonomy, because an operator comparing two
arms' failure codes has to be comparing one vocabulary.

Everything after that is one framework at a time, which is where they are allowed to differ:
the control policy's steps, each SDK's own second guard on the tool allowance, and the
handful of behaviors that belong to exactly one of them.
"""

from collections.abc import Callable, Mapping
from decimal import Decimal
from uuid import uuid4

import httpx2
import pytest
from agents.exceptions import UserError
from agents.testing import ModelStep, ScriptedModel, function_call
from openai import APIStatusError
from pydantic_ai.exceptions import ModelHTTPError
from pydantic_ai.messages import ModelResponse
from pydantic_ai.models.function import FunctionModel

from capability_lab.application.agent_capabilities import (
    FAKE_FRAMEWORK_ID,
    OPENAI_AGENTS_FRAMEWORK_ID,
    PROVEN_FRAMEWORKS_BY_ID,
    PYDANTIC_AI_FRAMEWORK_ID,
)
from capability_lab.application.agent_runtime import (
    AgentAnswer,
    AgentMessage,
    AgentRole,
    AgentToolBudgetExceededError,
    AgentTurnRequest,
    SandboxToolInvoker,
    SupportAgentFrameworkError,
    SupportAgentProviderError,
    SupportAgentResponseError,
    SupportAgentRuntime,
    SupportAgentTransientError,
)
from capability_lab.application.canonical_json import CanonicalValue
from capability_lab.application.model_cost import ModelUsage
from capability_lab.application.sandbox_tool_contracts import (
    ADDRESS_CHANGE_APPLY,
    ADDRESS_CHANGE_PROPOSE,
    CUSTOMER_PROFILE,
    INTERACTION_CONTEXT,
    ORDER_DETAIL,
    SANDBOX_TOOL_CONTRACTS,
    TOOL_RESULT_CANONICAL_SCHEMA_VERSION,
    ToolContract,
)
from capability_lab.application.sandbox_tools import ToolOutcome
from capability_lab.domain.agent_configuration import ModelSettings
from capability_lab.domain.agent_turn import AgentTurnFailure
from capability_lab.infrastructure.agents.fake import FakeSupportAgentRuntime
from capability_lab.infrastructure.agents.openai_agents import OpenAiAgentsSupportAgentRuntime
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


# Wide enough that offering the whole published set never trips a budget. The sweeps below
# are about what an adapter sends, and an allowance spent halfway through would make them
# about how many tools the lab happens to publish.
WHOLE_SET_ROUNDS = len(SANDBOX_TOOL_CONTRACTS) + 2


# -- what every framework owes, whichever one it is -----------------------------

RuntimeFactory = Callable[[], SupportAgentRuntime]

MODEL_BACKED: tuple[tuple[str, RuntimeFactory], ...] = (
    (PYDANTIC_AI_FRAMEWORK_ID, PydanticAiSupportAgentRuntime.for_test),
    (OPENAI_AGENTS_FRAMEWORK_ID, OpenAiAgentsSupportAgentRuntime.for_test),
)
"""The frameworks that run a model's loop, each over its SDK's own offline model."""

EVERY_RUNTIME: tuple[tuple[str, RuntimeFactory], ...] = (
    (FAKE_FRAMEWORK_ID, FakeSupportAgentRuntime),
    *MODEL_BACKED,
)

FRAMEWORK_IDS = [framework_id for framework_id, _ in EVERY_RUNTIME]
BACKED_IDS = [framework_id for framework_id, _ in MODEL_BACKED]


def test_the_sweep_below_covers_every_framework_the_catalog_declares() -> None:
    """The check that makes each sweep a statement about the lab rather than about a list.

    Read against `PROVEN_FRAMEWORKS` rather than against a literal, so a framework declared
    publishable tomorrow either joins these sweeps or fails here — the same rule ADR 0023
    applied to the tool conformance suite, one level up.
    """
    assert set(FRAMEWORK_IDS) == set(PROVEN_FRAMEWORKS_BY_ID)
    assert len(FRAMEWORK_IDS) == len(EVERY_RUNTIME)
    for framework_id, factory in EVERY_RUNTIME:
        assert factory().framework_id == framework_id


@pytest.mark.asyncio
@pytest.mark.parametrize(("framework_id", "factory"), EVERY_RUNTIME, ids=FRAMEWORK_IDS)
async def test_every_runtime_answers_with_words_and_a_meter_and_nothing_else(
    framework_id: str, factory: RuntimeFactory
) -> None:
    """The port's whole return value, held to one shape across frameworks.

    An `AgentAnswer` of text plus neutral usage is what a comparison reads. A framework that
    answered with a structured claim about the world would be asking to be believed about
    its own behavior (ADR 0026), and one that reported usage in its SDK's own shape would
    put a column in a cost table that lines up with nothing beside it (ADR 0032).
    """
    answer = await factory().answer(
        request(*every_tool(), max_tool_rounds=WHOLE_SET_ROUNDS), StubInvoker()
    )

    assert isinstance(answer, AgentAnswer)
    assert isinstance(answer.body, str)
    assert answer.body.strip()
    assert isinstance(answer.usage, ModelUsage)
    assert answer.usage.input_tokens >= 0
    assert answer.usage.output_tokens >= 0
    assert answer.usage.model_requests >= 0


@pytest.mark.asyncio
@pytest.mark.parametrize(("framework_id", "factory"), EVERY_RUNTIME, ids=FRAMEWORK_IDS)
async def test_every_runtime_reaches_the_world_by_the_contract_name_alone(
    framework_id: str, factory: RuntimeFactory
) -> None:
    """A provider's spelling rules must never reach the evidence.

    Both model-backed frameworks rewrite the namespace dot for the wire, and neither maps it
    back: the closure knows which contract it stands for. A recorded event carrying `__`
    would be a tool event nothing in the lab publishes.
    """
    tools = StubInvoker()

    await factory().answer(request(*every_tool(), max_tool_rounds=WHOLE_SET_ROUNDS), tools)

    assert tools.called
    for name in tools.called:
        assert name in CONTRACTS
        assert "__" not in name


@pytest.mark.asyncio
@pytest.mark.parametrize(("framework_id", "factory"), EVERY_RUNTIME, ids=FRAMEWORK_IDS)
async def test_every_runtime_sends_only_arguments_the_contract_declares_as_text(
    framework_id: str, factory: RuntimeFactory
) -> None:
    """Every argument is text (ADR 0021), so every framework's call is a table of strings.

    A number or an object arriving here would be a value the canonical call record cannot
    hold, and a name outside the contract would be an argument the tool can only refuse.
    """
    tools = StubInvoker()

    await factory().answer(request(*every_tool(), max_tool_rounds=WHOLE_SET_ROUNDS), tools)

    assert tools.calls
    for name, arguments in tools.calls:
        declared = {argument.name for argument in CONTRACTS[name].arguments}
        assert set(arguments) <= declared
        assert all(isinstance(value, str) for value in arguments.values())


@pytest.mark.asyncio
@pytest.mark.parametrize(("framework_id", "factory"), EVERY_RUNTIME, ids=FRAMEWORK_IDS)
async def test_the_labs_own_budget_ends_the_turn_through_every_runtime(
    framework_id: str, factory: RuntimeFactory
) -> None:
    """The invoker enforces the allowance, however a framework implements its own loop.

    An SDK's usage limit is a second guard and never the only one, so the error the invoker
    raises has to survive the framework it is raised inside — which is exactly what one of
    them was found to relabel (ADR 0041).
    """
    with pytest.raises(AgentToolBudgetExceededError):
        await factory().answer(request(*every_tool()), _ExhaustingInvoker())


@pytest.mark.asyncio
@pytest.mark.parametrize(("framework_id", "factory"), EVERY_RUNTIME, ids=FRAMEWORK_IDS)
async def test_every_runtime_answers_an_arm_that_has_already_been_talking(
    framework_id: str, factory: RuntimeFactory
) -> None:
    """Conversation memory is a comparison dimension, so every framework must carry it.

    The history is the runner's to resolve — a configuration keeping none is shown none —
    and what is asserted here is only that a framework given one still answers rather than
    failing on a message shape it does not recognize.
    """
    history = (
        AgentMessage(role=AgentRole.CUSTOMER, body="Can you change the address?"),
        AgentMessage(role=AgentRole.AGENT, body="Which address should it go to?"),
    )

    answer = await factory().answer(
        request(CONTRACTS[INTERACTION_CONTEXT], history=history), StubInvoker()
    )

    assert answer.body.strip()


@pytest.mark.asyncio
@pytest.mark.parametrize(("framework_id", "factory"), MODEL_BACKED, ids=BACKED_IDS)
async def test_every_model_backed_runtime_offers_every_tool_the_configuration_enables(
    framework_id: str, factory: RuntimeFactory
) -> None:
    """Each SDK's offline model calls every tool it is given, which is what proves they arrived."""
    tools = StubInvoker()
    offered = tuple(CONTRACTS[name] for name in (INTERACTION_CONTEXT, ORDER_DETAIL))

    answer = await factory().answer(request(*offered), tools)

    assert sorted(tools.called) == sorted([INTERACTION_CONTEXT, ORDER_DETAIL])
    assert answer.body.strip()


@pytest.mark.asyncio
async def test_two_frameworks_answering_one_world_leave_evidence_of_the_same_shape() -> None:
    """What makes the first controlled framework comparison readable (ADR 0041).

    The two arms are allowed to differ in what they said, which tools they chose, how many
    arguments they filled in, and what the provider metered — those are the differences a
    comparison exists to show. They are not allowed to differ in the *shape* of any of it:
    calls named by published contracts, arguments drawn from those contracts and carried as
    text, a reply of words, and a usage reading with the same three counts. A difference in
    shape would be a difference between the adapters, and no comparison could attribute it
    to the frameworks.
    """
    offered = tuple(CONTRACTS[name] for name in (INTERACTION_CONTEXT, ORDER_DETAIL))
    swept: list[str] = []
    for framework_id, factory in MODEL_BACKED:
        tools = StubInvoker()

        answer = await factory().answer(request(*offered), tools)

        swept.append(framework_id)
        assert set(tools.called) == {INTERACTION_CONTEXT, ORDER_DETAIL}
        for name, arguments in tools.calls:
            assert set(arguments) <= {argument.name for argument in CONTRACTS[name].arguments}
            assert all(isinstance(value, str) for value in arguments.values())
        assert isinstance(answer.body, str)
        assert answer.body.strip()
        assert isinstance(answer.usage, ModelUsage)
        assert answer.usage.model_requests >= 1
    assert swept == BACKED_IDS


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
    assert "NS-10482" in reply.body
    assert "18 rue des Écoles" in reply.body


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
    assert "18 rue des Écoles" not in reply.body


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
    assert "already the address on file" in reply.body


@pytest.mark.asyncio
async def test_a_refusal_stops_the_step_that_depended_on_it() -> None:
    """A refusal is an answer the agent acts on (ADR 0021), not a failure of the turn."""
    tools = StubInvoker(refused=frozenset({INTERACTION_CONTEXT}))

    reply = await FakeSupportAgentRuntime().answer(request(*every_tool()), tools)

    assert tools.called == [INTERACTION_CONTEXT, CUSTOMER_PROFILE]
    assert "could not find an order" in reply.body


@pytest.mark.asyncio
async def test_a_refused_proposal_leaves_nothing_to_confirm() -> None:
    tools = StubInvoker(refused=frozenset({ADDRESS_CHANGE_PROPOSE}))

    reply = await FakeSupportAgentRuntime().answer(request(*every_tool()), tools)

    assert ADDRESS_CHANGE_APPLY not in tools.called
    assert "redirected" not in reply.body


@pytest.mark.asyncio
async def test_the_control_arm_answers_identically_twice_over_one_world() -> None:
    """The whole point of a control: a difference between two runs is never the agent."""
    runtime = FakeSupportAgentRuntime()

    first = await runtime.answer(request(*every_tool()), StubInvoker())
    second = await runtime.answer(request(*every_tool()), StubInvoker())

    assert first == second


# -- Pydantic AI ----------------------------------------------------------------


@pytest.mark.asyncio
async def test_pydantic_ai_maps_its_own_usage_limit_to_the_configurations_budget() -> None:
    """The only limit configured in this SDK is the tool allowance an author chose.

    A transient provider fault would be the wrong answer: nothing was unavailable, the run
    used every tool call the configuration allows. That is a finding about the
    configuration, and one of the behaviors a comparison exists to make visible.
    """
    with pytest.raises(AgentToolBudgetExceededError):
        await PydanticAiSupportAgentRuntime.for_test().answer(
            request(*every_tool(), max_tool_rounds=1), StubInvoker()
        )


# -- how a framework's own failures are classified ------------------------------


def throttled_pydantic_ai() -> SupportAgentRuntime:
    def raise_throttled(*_: object) -> ModelResponse:
        raise ModelHTTPError(status_code=429, model_name="gpt-5-mini", body=None)

    return PydanticAiSupportAgentRuntime(lambda _model_id: FunctionModel(raise_throttled))


def rejected_pydantic_ai() -> SupportAgentRuntime:
    def raise_rejected(*_: object) -> ModelResponse:
        raise ModelHTTPError(status_code=400, model_name="gpt-5-mini", body=None)

    return PydanticAiSupportAgentRuntime(lambda _model_id: FunctionModel(raise_rejected))


def status_error(status_code: int) -> APIStatusError:
    """One provider answer, built with the HTTP client the OpenAI SDK actually carries.

    `httpx2` rather than the `httpx` this project's own dev dependencies carry: the OpenAI
    SDK pins its own client, and a response built from the other one is a different class
    that `APIStatusError` will not accept.
    """
    return APIStatusError(
        "the provider said so",
        response=httpx2.Response(status_code, request=httpx2.Request("POST", "https://provider")),
        body=None,
    )


def raising_openai_agents(error: Exception) -> SupportAgentRuntime:
    return OpenAiAgentsSupportAgentRuntime(
        lambda _model_id: ScriptedModel([ModelStep.raise_error(error)])
    )


# One provider answer, and what each framework's SDK does with it before the lab sees it.
# Held as a sweep because a status code has to mean one thing across the lab: an operator
# reading two arms' failures compares codes, and a 429 recorded as `model_provider` in one
# arm and `model_transient` in the other would be a difference in the adapters.
FAILURE_CASES: tuple[tuple[str, RuntimeFactory, RuntimeFactory], ...] = (
    (PYDANTIC_AI_FRAMEWORK_ID, throttled_pydantic_ai, rejected_pydantic_ai),
    (
        OPENAI_AGENTS_FRAMEWORK_ID,
        lambda: raising_openai_agents(status_error(429)),
        lambda: raising_openai_agents(status_error(400)),
    ),
)


def test_every_model_backed_framework_has_a_failure_case_in_the_sweep_below() -> None:
    assert [framework_id for framework_id, _, _ in FAILURE_CASES] == BACKED_IDS


@pytest.mark.asyncio
@pytest.mark.parametrize(("framework_id", "throttled", "rejected"), FAILURE_CASES, ids=BACKED_IDS)
async def test_a_provider_answer_means_the_same_thing_in_every_framework(
    framework_id: str, throttled: RuntimeFactory, rejected: RuntimeFactory
) -> None:
    """Throttling is worth retrying and a rejected request is not, whichever SDK saw it.

    Neither carries the provider's words into the record: a failed attempt is a code from a
    closed table and no body (ADR 0026).
    """
    with pytest.raises(SupportAgentTransientError):
        await throttled().answer(request(CONTRACTS[INTERACTION_CONTEXT]), StubInvoker())

    with pytest.raises(SupportAgentProviderError):
        await rejected().answer(request(CONTRACTS[INTERACTION_CONTEXT]), StubInvoker())


# -- the OpenAI Agents SDK ------------------------------------------------------


@pytest.mark.asyncio
async def test_the_openai_agents_sdk_calls_tools_in_the_order_it_asked_for_them() -> None:
    """One call at a time, so the recorded sequence is the order the agent asked.

    The SDK starts every call a turn emits concurrently unless told otherwise, and a write
    is guarded by the revision it was proposed against (ADR 0022) — calls that raced would
    refuse each other for no reason the agent could act on.
    """
    offered = tuple(
        CONTRACTS[name] for name in (INTERACTION_CONTEXT, ORDER_DETAIL, CUSTOMER_PROFILE)
    )
    tools = StubInvoker()

    await OpenAiAgentsSupportAgentRuntime.for_test().answer(request(*offered), tools)

    assert tools.called == [INTERACTION_CONTEXT, ORDER_DETAIL, CUSTOMER_PROFILE]


@pytest.mark.asyncio
async def test_the_labs_budget_survives_the_wrapper_the_sdk_puts_around_a_tool_failure() -> None:
    """The finding the SDK would have relabelled, asserted by the code it keeps.

    Anything a tool raises that the SDK does not recognize comes back as its own `UserError`
    with the original on `__cause__`. The budget is a finding about the configuration an
    author chose; recorded as a framework fault it would read as the lab breaking.
    """
    runtime = OpenAiAgentsSupportAgentRuntime.for_test()

    with pytest.raises(AgentToolBudgetExceededError) as raised:
        await runtime.answer(request(*every_tool()), _ExhaustingInvoker())

    assert raised.value.failure is AgentTurnFailure.TOOL_ROUND_LIMIT


@pytest.mark.asyncio
async def test_an_argument_object_the_sdk_never_validated_is_an_unusable_answer() -> None:
    """This SDK hands a tool the model's raw argument text, so the parse is the adapter's.

    Everything that parses is passed through for the tool to judge, because an argument
    mistake is a refusal the agent can act on (ADR 0021). Text that is not an object at all
    is the one thing no tool could judge, and it ends the attempt rather than being turned
    into a call the model did not make.
    """
    runtime = OpenAiAgentsSupportAgentRuntime(
        lambda _model_id: ScriptedModel(
            [ModelStep(output=[function_call("orders__read_order", "not json", call_id="c1")])]
        )
    )

    with pytest.raises(SupportAgentResponseError):
        await runtime.answer(request(CONTRACTS[ORDER_DETAIL]), StubInvoker())


@pytest.mark.asyncio
async def test_the_openai_agents_sdk_meters_turns_rather_than_tool_calls() -> None:
    """The asymmetry that makes the invoker's budget load-bearing rather than a backstop.

    Pydantic AI carries a tool-call allowance of its own, so the lab configures it and the
    SDK stops the run. This SDK counts model requests and nothing else: ten calls emitted in
    one turn are one turn. Against an invoker that never says no, a configuration allowing a
    single tool call therefore finishes — which is exactly why the allowance is enforced by
    the thing that records the calls rather than by each framework's own limit (ADR 0026).
    """
    answer = await OpenAiAgentsSupportAgentRuntime.for_test().answer(
        request(*every_tool(), max_tool_rounds=1), StubInvoker()
    )

    assert answer.body.strip()


@pytest.mark.asyncio
async def test_the_sdks_turn_ceiling_is_the_configurations_tool_allowance() -> None:
    """The second guard, for a loop the per-call budget would not stop on its own.

    An agent allowed two tool calls needs at most three model requests: one per round and
    one to answer. A framework that kept going past that has used every round the
    configuration allows, which is the same finding as spending the budget.
    """
    runtime = OpenAiAgentsSupportAgentRuntime(
        lambda _model_id: ScriptedModel(
            [
                ModelStep(
                    output=[function_call("interaction__read_context", {}, call_id=f"c{index}")]
                )
                for index in range(6)
            ]
        )
    )

    with pytest.raises(AgentToolBudgetExceededError):
        await runtime.answer(
            request(CONTRACTS[INTERACTION_CONTEXT], max_tool_rounds=2), StubInvoker()
        )


@pytest.mark.asyncio
async def test_a_framework_fault_the_lab_cannot_classify_says_only_that() -> None:
    """An SDK error with nothing of the lab's inside it is the integration breaking.

    Reported as the framework failing rather than as the provider refusing, and without the
    SDK's message: nothing can promise an arbitrary exception's text is free of synthetic
    customer content.
    """
    runtime = raising_openai_agents(UserError("the SDK was misconfigured"))

    with pytest.raises(SupportAgentFrameworkError):
        await runtime.answer(request(CONTRACTS[INTERACTION_CONTEXT]), StubInvoker())


class _ExhaustingInvoker(SandboxToolInvoker):
    """Refuses the second call the way the lab's own invoker refuses a spent budget."""

    def __init__(self) -> None:
        self._spent = 0

    def invoke(self, tool: str, arguments: Mapping[str, str]) -> dict[str, CanonicalValue]:
        if self._spent >= 1:
            raise AgentToolBudgetExceededError("this configuration allows 1 tool call per turn")
        self._spent += 1
        return _envelope(tool, ToolOutcome.SUCCESS, {})
