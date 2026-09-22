"""The port one arm's agent runs through, and nothing about which framework runs it.

The support agent is the half of the incident the participant driver is not (ADR 0025).
This is its port: given the customer's latest words, the prompt its configuration resolved
to, and the tools that configuration enables, a runtime produces the arm's reply.

It is a **new** port rather than an evolution of `AgentAdapter`. The POC's adapter answers a
persona-first conversation with a pre-assembled `RetailSupportContext` and a structured
support result, which is the opposite of what this milestone requires: an arm is given a
message and discovers everything else through versioned tools against its own sandbox
(ADR 0011, ADR 0021). Bending the old port into this one would have made the POC's
published conversation contract and the target runtime share a shape neither of them wants,
which `AGENTS.md` refuses. The old port keeps serving the old routes untouched.

Four decisions shape it.

**The runtime never touches the sandbox; it asks.** A runtime is handed a
`SandboxToolInvoker` bound to one arm, one acting support identity, and one attempt. It
cannot name another arm, cannot choose the identity it acts as, and cannot reach the
repositories — the same rule that keeps an agent from choosing its own permissions
(ADR 0022), enforced by what the runtime is given rather than by what it is told.

**The invoker is also the recorder.** Every call through it becomes a tool event, so the
evidence is a property of the call path rather than of an adapter remembering to report.
That is what makes "a framework-specific event never leaks into the shared evidence
contract" structural: an SDK's own tool-call objects have nowhere to go.

**A runtime chooses a tool, not a version.** The call names the tool; the invoker supplies
the version the lab publishes, because the tool contract set is a pinned input of the
experiment (ADR 0021) and an agent that could ask for another version would be choosing its
own starting state.

**A failure is classified, not described.** The five errors below are the kinds a run
records, and each carries the code the record keeps. A provider's message is neither stable
across models nor safe to store beside synthetic customer content, so it never becomes
evidence — the same discipline as a failed tool result that refuses to describe itself.

**A runtime reports what it spent, and nothing else about itself.** An answer carries the
provider usage the framework metered, because only the framework can see it. It is the one
thing an adapter says about its own execution, and it is deliberately a count rather than a
story: what the agent *did* is the tool events the invoker wrote, and how long it took is
the runner's clock. A framework that cannot meter itself reports nothing, which the record
keeps as nothing.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from enum import StrEnum
from typing import Protocol
from uuid import UUID

from capability_lab.application.canonical_json import CanonicalValue
from capability_lab.application.model_cost import ModelUsage
from capability_lab.application.sandbox_tool_contracts import ToolContract
from capability_lab.domain.agent_configuration import ModelSettings
from capability_lab.domain.agent_turn import AgentTurnFailure

__all__ = [
    "AgentAnswer",
    "AgentMessage",
    "AgentRole",
    "AgentToolBudgetExceededError",
    "AgentTurnRequest",
    "SandboxToolInvoker",
    "SupportAgentFrameworkError",
    "SupportAgentProviderError",
    "SupportAgentResponseError",
    "SupportAgentRuntime",
    "SupportAgentRuntimeError",
    "SupportAgentRuntimeRegistry",
    "SupportAgentTransientError",
    "SupportAgentUnavailableError",
]


class SupportAgentRuntimeError(RuntimeError):
    """A run that ended without a reply, classified by where it broke.

    `failure` is what the record keeps. Subclasses exist so an adapter raises the kind it
    discovered rather than passing a code around, and so the runner maps them with one
    lookup instead of a chain of `isinstance` checks.
    """

    failure: AgentTurnFailure


class SupportAgentProviderError(SupportAgentRuntimeError):
    failure = AgentTurnFailure.MODEL_PROVIDER


class SupportAgentTransientError(SupportAgentRuntimeError):
    failure = AgentTurnFailure.MODEL_TRANSIENT


class SupportAgentResponseError(SupportAgentRuntimeError):
    failure = AgentTurnFailure.INVALID_RESPONSE


class SupportAgentFrameworkError(SupportAgentRuntimeError):
    failure = AgentTurnFailure.FRAMEWORK


class AgentToolBudgetExceededError(SupportAgentRuntimeError):
    """The agent used every tool round its configuration allows without answering.

    Raised by the invoker rather than by an adapter, so the limit holds however a framework
    implements its own loop — an SDK's usage limit is a second guard, never the only one.
    """

    failure = AgentTurnFailure.TOOL_ROUND_LIMIT


class SupportAgentUnavailableError(RuntimeError):
    """No runtime for this framework is running in this process.

    Deliberately **not** a `SupportAgentRuntimeError`, so it can never be recorded as a
    turn. A missing API key is a fact about the operator's machine, not something the agent
    did, and writing it into a run's evidence would put the lab's configuration into a
    comparison. The publish gate reads a declared capability catalog for the same reason it
    is kept apart from the adapter registry (ADR 0024).
    """


class AgentRole(StrEnum):
    """Who spoke one message of the thread a runtime is shown."""

    CUSTOMER = "customer"
    AGENT = "agent"


@dataclass(frozen=True, slots=True)
class AgentMessage:
    """One earlier message in this arm's thread, as the agent should read it back."""

    role: AgentRole
    body: str


@dataclass(frozen=True, slots=True)
class AgentTurnRequest:
    """Everything a runtime is given to produce one reply.

    Deliberately no shop, customer, order, or ticket. Those are what the tools answer, and
    an arm that received them here would be compared on a prompt rather than on how it
    discovers what it needs — which is the whole of ADR 0011's tool-first rule and the
    reason ADR 0024 declared interaction variables non-injectable.

    `history` is the thread this arm has already had, which may be empty because the
    configuration keeps no conversation memory. That is a comparison variable, so it is
    resolved by the runner from the configuration rather than assumed by the runtime.
    """

    run_id: UUID
    arm_label: str
    instructions: str
    model: ModelSettings
    tools: tuple[ToolContract, ...]
    history: tuple[AgentMessage, ...]
    message: str


@dataclass(frozen=True, slots=True)
class AgentAnswer:
    """What a runtime produced: the reply, and what the provider was asked for.

    Text plus a meter, and still no structured claim about the world. The POC's adapter
    returned a summary and identifier lists; here every fact an arm touched is already the
    tool event that produced it, and asking a model to restate them would make the evidence
    depend on the model's honesty about its own behavior. Usage is different in kind: it is
    not something the model says, it is something the framework counted.

    `usage` is `None` when the framework does not report it, and `ModelUsage.none()` when it
    genuinely called no model — the control arm's reading (`model_cost`).
    """

    body: str
    usage: ModelUsage | None = None


class SandboxToolInvoker(Protocol):
    """The one way a runtime reaches the world, bound to one arm and one actor."""

    def invoke(self, tool: str, arguments: Mapping[str, str]) -> dict[str, CanonicalValue]:
        """Run one published tool and answer with its `tool-result-v1` document.

        A refusal comes back as a document with a `refused` outcome, not as an exception:
        an agent has to be able to read why it was declined and try something else
        (ADR 0021). Raises `AgentToolBudgetExceededError` when the configuration's tool-round
        limit is spent, which ends the attempt rather than answering it.
        """
        ...


class SupportAgentRuntime(Protocol):
    """One framework's implementation of the support agent's turn."""

    @property
    def framework_id(self) -> str: ...

    @property
    def model_base_url(self) -> str | None:
        """The endpoint this runtime reaches, or `None` when it reaches no provider.

        Answered by the runtime rather than derived from the proven-capability catalog or
        from the resolved connection, because those two say what *could* be reached and this
        has to say what *was*. The control arm reaches nothing, and so does an SDK double —
        a test-environment run that pinned the lab's endpoint would be recording a call
        nobody made.

        The default is `None`, which is the safe answer: a runtime that has not been told
        where it points claims no endpoint, and the run it advances stays unpinned rather
        than being pinned to a guess (ADR 0052).
        """
        return None

    async def answer(self, request: AgentTurnRequest, tools: SandboxToolInvoker) -> AgentAnswer:
        """The agent's reply, and what the framework metered producing it.

        The reply is text rather than a structured result, deliberately. The POC's adapter
        returned a summary and identifier lists because a persona-first conversation had
        nowhere else to put them; here every fact an arm touched is already recorded as the
        tool event that produced it, and asking a model to restate them would make the
        evidence depend on the model's honesty about its own behavior.
        """
        ...


class SupportAgentRuntimeRegistry:
    """The runtimes this process can actually run, chosen by composition.

    Kept apart from `PROVEN_FRAMEWORKS` for the reason ADR 0024 gave: the catalog answers
    "may an author publish this", which must not change with the machine, while this
    answers "can this process run it right now", which does.
    """

    def __init__(self, runtimes: Mapping[str, SupportAgentRuntime]) -> None:
        self._runtimes = dict(runtimes)

    def get(self, framework_id: str) -> SupportAgentRuntime:
        runtime = self._runtimes.get(framework_id)
        if runtime is None:
            raise SupportAgentUnavailableError(
                f"no {framework_id} runtime is available in this lab; this arm cannot be run "
                "here until one is configured"
            )
        return runtime

    def framework_ids(self) -> tuple[str, ...]:
        return tuple(sorted(self._runtimes))
