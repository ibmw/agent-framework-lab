"""Running one versioned tool against the sandbox one arm works in.

An arm is given a customer's message and a minimal resource reference, and everything else
it learns it has to ask for (ADR 0011's tool-first rule). This module is where those
questions are answered: eight read tools over one arm's own state and the published versions
its snapshot pinned, and the dispatch that hands a write tool to the service that owns the
one commerce mutation an arm may make.

Three decisions shape the module.

**A tool reads an arm, not a shop.** Every handler is given a resolved context — the arm's
mutable commerce state plus the pinned shop, ticket, and customer-profile versions — and no
tool accepts a shop, a version, or a fingerprint as an argument. An arm cannot ask for a
world other than its own, and two arms of one experiment answer identically until one of
them writes.

**A refusal is a value, not an error.** "That order reference is not one of yours" is a
domain answer the agent has to reason about, so it comes back as a result with an outcome
of `refused` rather than as an exception. Argument mistakes refuse the same way, because in
a run the arguments are model output: an agent that misnames its own argument must be able
to read what it did and try again. The distinction the contract convention requires is kept
where it belongs — `success`, `refused`, and `failed` are three different outcomes, and the
last one means the lab broke rather than the agent misbehaved.

**A tool result is canonical.** Every handler answers with a `CanonicalValue` document, so
the same call against the same state produces the same bytes. Milestone 5's evidence is what
that is for; this module only has to make it true.

The read handlers here are pure: a state in, a document out, no way to move an arm even by
mistake. A write is a different shape — it needs the arm's record, the actor's authority, and
the seam it writes through — and lives in `sandbox_actions`. Which shape runs is decided by
the contract's declared effect rather than by a handler knowing what kind it is, so a read
tool is never handed a writer (ADR 0022).
"""

from __future__ import annotations

import logging
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from enum import StrEnum
from types import MappingProxyType
from typing import Self
from uuid import UUID

from capability_lab.application.canonical_json import CanonicalValue
from capability_lab.application.definition_authoring import (
    DefinitionRepository,
    DefinitionVersionRecord,
)
from capability_lab.application.definition_resolution import (
    DefinitionResolutionError,
    MissingReferenceVersionError,
    ResolvedDefinition,
)
from capability_lab.application.sandbox_actions import SandboxActionService, ToolActor
from capability_lab.application.sandbox_materialization import (
    SandboxSnapshotNotFoundError,
    SandboxSnapshotRepository,
)
from capability_lab.application.sandbox_tool_context import SandboxToolContext, resolve_order
from capability_lab.application.sandbox_tool_contracts import (
    CATALOG_PRODUCT,
    CATALOG_SEARCH,
    CUSTOMER_PROFILE,
    INTERACTION_CONTEXT,
    ORDER_DETAIL,
    ORDER_LIST,
    READ_TOOL_CONTRACTS,
    SANDBOX_TOOL_CONTRACTS,
    SUPPORT_DOCUMENT,
    SUPPORT_SEARCH,
    TOOL_RESULT_CANONICAL_SCHEMA_VERSION,
    ToolArgument,
    ToolArgumentKind,
    ToolContract,
    ToolContractError,
    ToolEffect,
    ToolRefusal,
    ToolRefusalCode,
    ToolRefusedError,
)
from capability_lab.application.sandbox_tool_views import (
    customer_profile,
    document_detail,
    document_summary,
    interaction_context,
    knowledge_documents,
    order_detail,
    order_summary,
    product_detail,
    product_summary,
)
from capability_lab.application.sandboxes import (
    SandboxNotFoundError,
    SandboxRecord,
    SandboxRepository,
)
from capability_lab.application.support_identities import (
    SupportIdentityVersionNotFoundError,
    support_identity_definition_id,
)
from capability_lab.domain.customer_profile import CustomerProfilePayload
from capability_lab.domain.definitions import DefinitionType, VersionRef
from capability_lab.domain.shop import ShopDocumentKind, ShopPayload
from capability_lab.domain.support_identity import SupportIdentityPayload
from capability_lab.domain.ticket import TicketPayload

__all__ = [
    "MAX_SEARCH_RESULTS",
    "SandboxToolContext",
    "SandboxToolService",
    "ToolActor",
    "ToolActorRequiredError",
    "ToolCall",
    "ToolExecution",
    "ToolNotFoundError",
    "ToolOutcome",
    "ToolRefusal",
    "ToolRefusalCode",
    "ToolResult",
]

MAX_SEARCH_RESULTS = 20
"""How many matches a search answers with before it says how many it left out."""

_logger = logging.getLogger(__name__)


class ToolNotFoundError(DefinitionResolutionError):
    """Raised when a call names a tool or a version this lab does not publish.

    Deliberately an error rather than a refusal: an unknown tool name is a contract
    mistake, not a question about the world. A framework adapter offers a run only the
    tools it registered, so a name that reaches here came from a client reading a contract
    that no longer says what it thinks.
    """


class ToolOutcome(StrEnum):
    """The three answers a tool call can end with, kept apart on purpose."""

    SUCCESS = "success"
    """The tool answered the question."""

    REFUSED = "refused"
    """The tool understood the question and declined it; the agent can act on this."""

    FAILED = "failed"
    """The tool could not run. This is the lab's fault, never the agent's."""


class ToolActorRequiredError(DefinitionResolutionError):
    """Raised when a write tool is called with nobody acting.

    An error rather than a refusal, by the same rule that makes an unknown tool name one:
    the actor is not model output. A call that reaches here came from a client that offered
    a write tool without saying whose authority it runs under, which is the lab's mistake to
    see and fix, not a question about the world for the agent to reason about.
    """


@dataclass(frozen=True, slots=True)
class ToolCall:
    """One request to run a tool: which one, at which version, with what arguments.

    `actor` sits beside the arguments rather than among them. Arguments are what a model
    fills in; the actor is whose authority the call runs under, and a model that could name
    it would be choosing its own permissions. A write tool requires one. A read tool accepts
    one and does not yet consult it: every read published here is over the arm's own
    customer, and per-tool read authorization arrives with agent configurations (ADR 0021).
    """

    tool: str
    version: str
    arguments: Mapping[str, str | None] = field(default_factory=lambda: MappingProxyType({}))
    actor: ToolActor | None = None


@dataclass(frozen=True, slots=True)
class ToolResult:
    """What one tool call answered, as a canonical document.

    `arguments` are the ones the handler actually saw — trimmed, and with the absent ones
    dropped — so the record says what was asked rather than what was typed.
    """

    tool: str
    version: str
    arguments: Mapping[str, str]
    outcome: ToolOutcome
    data: dict[str, CanonicalValue] | None = None
    refusal: ToolRefusal | None = None

    @classmethod
    def succeeded(
        cls, contract: ToolContract, arguments: Mapping[str, str], data: dict[str, CanonicalValue]
    ) -> Self:
        return cls(
            tool=contract.name,
            version=contract.version,
            arguments=arguments,
            outcome=ToolOutcome.SUCCESS,
            data=data,
        )

    @classmethod
    def refused(
        cls, contract: ToolContract, arguments: Mapping[str, str], refusal: ToolRefusal
    ) -> Self:
        return cls(
            tool=contract.name,
            version=contract.version,
            arguments=arguments,
            outcome=ToolOutcome.REFUSED,
            refusal=refusal,
        )

    @classmethod
    def failed(cls, contract: ToolContract, arguments: Mapping[str, str]) -> Self:
        """The lab broke. No refusal accompanies it: there is nothing the agent did wrong."""
        return cls(
            tool=contract.name,
            version=contract.version,
            arguments=arguments,
            outcome=ToolOutcome.FAILED,
        )

    @property
    def document(self) -> dict[str, CanonicalValue]:
        """The `tool-result-v1` document: what was asked and what came back.

        The arm's revision is deliberately outside it. A revision is where the arm stood
        when it answered rather than part of the answer, and two arms holding identical
        state must produce identical bytes — the same rule that keeps a label and a
        revision out of a sandbox's own fingerprint (ADR 0020).
        """
        refusal = self.refusal
        return {
            "canonical_schema_version": TOOL_RESULT_CANONICAL_SCHEMA_VERSION,
            "tool": self.tool,
            "version": self.version,
            "arguments": dict(self.arguments),
            "outcome": self.outcome.value,
            "data": self.data,
            "refusal": None
            if refusal is None
            else {"code": refusal.code.value, "message": refusal.message},
        }


@dataclass(frozen=True, slots=True)
class ToolExecution:
    """One result, and where the arm stood when it was read.

    The revision travels beside the result rather than inside it because it is what the
    next writer has to present: the safe address-change action reads through a tool and
    writes against the revision that read saw.
    """

    result: ToolResult
    revision: int
    state_fingerprint: str


type ToolHandler = Callable[[SandboxToolContext, Mapping[str, str]], dict[str, CanonicalValue]]


# -- the handlers -----------------------------------------------------------------


def _read_interaction(
    context: SandboxToolContext, arguments: Mapping[str, str]
) -> dict[str, CanonicalValue]:
    return interaction_context(context.ticket, context.state)


def _search_products(
    context: SandboxToolContext, arguments: Mapping[str, str]
) -> dict[str, CanonicalValue]:
    query = arguments.get("query", "").casefold()
    matches = [
        product
        for product in sorted(context.shop.products, key=lambda entry: entry.handle)
        # Each field is matched on its own: joining them first would let a query with a
        # space match one field's last word against the next field's first.
        if _matches(query, product.handle, product.title, product.category)
    ]
    return {
        "match_count": len(matches),
        "products": [product_summary(product) for product in matches[:MAX_SEARCH_RESULTS]],
        # Truncation is stated rather than implied: a capped list that says nothing reads
        # like a complete one.
        "truncated": len(matches) > MAX_SEARCH_RESULTS,
    }


def _read_product(
    context: SandboxToolContext, arguments: Mapping[str, str]
) -> dict[str, CanonicalValue]:
    handle = arguments["handle"]
    product = next(
        (entry for entry in context.shop.products if entry.handle == handle),
        None,
    )
    if product is None:
        raise ToolRefusedError(
            ToolRefusalCode.NOT_FOUND, f"this shop has no product with the handle {handle!r}"
        )
    return product_detail(product)


def _read_customer(
    context: SandboxToolContext, arguments: Mapping[str, str]
) -> dict[str, CanonicalValue]:
    return customer_profile(context.state.customer_profile_id, context.customer)


def _list_orders(
    context: SandboxToolContext, arguments: Mapping[str, str]
) -> dict[str, CanonicalValue]:
    # Newest first, as a helpdesk shows them, and by reference where two were placed at the
    # same moment so the order never depends on how the sandbox happened to store them.
    ordered = sorted(
        context.state.orders,
        key=lambda order: (order.payload.placed_at, order.payload.reference),
        reverse=True,
    )
    return {"orders": [order_summary(order) for order in ordered]}


def _read_order(
    context: SandboxToolContext, arguments: Mapping[str, str]
) -> dict[str, CanonicalValue]:
    return order_detail(resolve_order(context.state, arguments))


def _search_knowledge(
    context: SandboxToolContext, arguments: Mapping[str, str]
) -> dict[str, CanonicalValue]:
    query = arguments.get("query", "").casefold()
    kind = arguments.get("kind")
    matches = [
        document
        for document in knowledge_documents(context.shop)
        if (kind is None or document["kind"] == kind)
        and _matches(query, document["title"], document["body"])
    ]
    return {
        "match_count": len(matches),
        "documents": [document_summary(document) for document in matches[:MAX_SEARCH_RESULTS]],
        "truncated": len(matches) > MAX_SEARCH_RESULTS,
    }


def _read_document(
    context: SandboxToolContext, arguments: Mapping[str, str]
) -> dict[str, CanonicalValue]:
    kind = ShopDocumentKind(arguments["kind"])
    document_id = arguments["document_id"]
    document = next(
        (
            candidate
            for candidate in knowledge_documents(context.shop)
            if candidate["kind"] == kind.value and candidate["document_id"] == document_id
        ),
        None,
    )
    if document is None:
        raise ToolRefusedError(
            ToolRefusalCode.NOT_FOUND,
            f"this shop has no {kind.value.replace('_', ' ')} with the ID {document_id!r}",
        )
    return document_detail(document)


READ_TOOL_HANDLERS: Mapping[str, ToolHandler] = {
    INTERACTION_CONTEXT: _read_interaction,
    CATALOG_SEARCH: _search_products,
    CATALOG_PRODUCT: _read_product,
    CUSTOMER_PROFILE: _read_customer,
    ORDER_LIST: _list_orders,
    ORDER_DETAIL: _read_order,
    SUPPORT_SEARCH: _search_knowledge,
    SUPPORT_DOCUMENT: _read_document,
}


def _require_complete_registry() -> None:
    """A declared tool with no handler is a published contract nothing answers."""
    declared = {contract.name for contract in READ_TOOL_CONTRACTS}
    implemented = set(READ_TOOL_HANDLERS)
    if declared != implemented:
        difference = sorted(declared ^ implemented)
        raise ToolContractError(
            f"the read tool registry disagrees with the published contracts: {difference}"
        )
    misdeclared = sorted(
        contract.name
        for contract in SANDBOX_TOOL_CONTRACTS
        if (contract.effect is ToolEffect.READ) != (contract.name in READ_TOOL_HANDLERS)
    )
    if misdeclared:
        # A write answered by a pure read handler would be a published mutation that changes
        # nothing, and a read routed to the writer would need an actor no reader is given.
        raise ToolContractError(
            f"these tools are declared with an effect nothing implements: {misdeclared}"
        )


_require_complete_registry()


# -- arguments --------------------------------------------------------------------


def parse_arguments(contract: ToolContract, arguments: Mapping[str, str | None]) -> dict[str, str]:
    """Check one call against its contract, refusing rather than raising.

    Blank text counts as absent. In a run these values are model output, and an argument
    filled with an empty string is an argument the model chose not to answer; treating it
    as a value would send the handler looking for an order called "".
    """
    unknown = sorted(set(arguments) - {argument.name for argument in contract.arguments})
    if unknown:
        raise ToolRefusedError(
            ToolRefusalCode.INVALID_ARGUMENTS,
            f"{contract.name} does not accept the argument(s) {unknown}",
        )
    parsed: dict[str, str] = {}
    for argument in contract.arguments:
        raw = arguments.get(argument.name)
        value = "" if raw is None else raw.strip()
        if not value:
            if argument.required:
                raise ToolRefusedError(
                    ToolRefusalCode.INVALID_ARGUMENTS,
                    f"{contract.name} requires the argument {argument.name!r}",
                )
            continue
        parsed[argument.name] = _checked(contract, argument, value)
    return parsed


def _checked(contract: ToolContract, argument: ToolArgument, value: str) -> str:
    if argument.kind is ToolArgumentKind.UUID:
        try:
            UUID(value)
        except ValueError as error:
            raise ToolRefusedError(
                ToolRefusalCode.INVALID_ARGUMENTS,
                f"{contract.name} expects {argument.name!r} to be an identifier",
            ) from error
    if argument.kind is ToolArgumentKind.ENUM and value not in argument.choices:
        raise ToolRefusedError(
            ToolRefusalCode.INVALID_ARGUMENTS,
            f"{contract.name} expects {argument.name!r} to be one of {list(argument.choices)}",
        )
    return value


# -- the service ------------------------------------------------------------------


class SandboxToolService:
    """Publish the tool contracts and run one of them against one arm."""

    def __init__(
        self,
        sandboxes: SandboxRepository,
        snapshots: SandboxSnapshotRepository,
        shops: DefinitionRepository[ShopPayload],
        tickets: DefinitionRepository[TicketPayload],
        customer_profiles: DefinitionRepository[CustomerProfilePayload],
        support_identities: DefinitionRepository[SupportIdentityPayload],
        actions: SandboxActionService,
        handlers: Mapping[str, ToolHandler] | None = None,
    ) -> None:
        self._sandboxes = sandboxes
        self._snapshots = snapshots
        self._shops = shops
        self._tickets = tickets
        self._customer_profiles = customer_profiles
        self._support_identities = support_identities
        self._actions = actions
        self._handlers = READ_TOOL_HANDLERS if handlers is None else handlers

    def contracts(self) -> tuple[ToolContract, ...]:
        """The published tool set, reads first, in the order it is declared."""
        return SANDBOX_TOOL_CONTRACTS

    def execute(self, shop_id: UUID, sandbox_id: UUID, call: ToolCall) -> ToolExecution:
        """Run one tool against one arm and report where that arm stood.

        The revision reported is the one the arm held *before* the call. For a read that is
        simply where it was; for a write it is what the change was computed against, which
        is the more useful of the two — the arm's new position is the response's to state,
        and a caller that needs it reads the arm.
        """
        contract = self._contract(call)
        record = self._record(shop_id, sandbox_id)
        # What the caller sent, until parsing says what the handler actually saw.
        arguments = _asked(call)
        try:
            arguments = parse_arguments(contract, call.arguments)
            context = self._context(record)
            data = self._run(contract, context, record, call, arguments)
        except ToolRefusedError as refused:
            return self._executed(ToolResult.refused(contract, arguments, refused.refusal), record)
        except DefinitionResolutionError:
            # A sandbox whose snapshot or pins no longer resolve is a broken lab rather than
            # a tool answer, and an operator has to see it as an error instead of as
            # something the agent did.
            raise
        except Exception as error:
            # A broken handler must not end a run, and the result it returns must not
            # describe itself: an exception's text would carry internals into a transcript
            # an agent, a judge, and a trace can all read.
            #
            # The operator still needs somewhere to look, so the failure is logged — the
            # tool that broke and the type that broke it, which is what locates one of eight
            # small pure handlers. The message and the traceback are deliberately withheld
            # from the log as well: `AGENTS.md` forbids logging raw customer content, and
            # nothing can promise an arbitrary exception's text carries none. This is the
            # same discipline the sanitized spans already keep, where an error is recorded
            # as `error.type` and never as what it said.
            _logger.error("tool %s failed with %s", contract.name, type(error).__name__)
            return self._executed(ToolResult.failed(contract, arguments), record)
        return self._executed(ToolResult.succeeded(contract, arguments, data), record)

    # -- dispatch --------------------------------------------------------------

    def _run(
        self,
        contract: ToolContract,
        context: SandboxToolContext,
        record: SandboxRecord,
        call: ToolCall,
        arguments: dict[str, str],
    ) -> dict[str, CanonicalValue]:
        """Send the call to the shape its contract declares, and to no other.

        A read handler is pure and is given a context; a write is given the arm, the actor,
        and the seam. Deciding from the declared effect rather than from the handler map is
        what keeps a published mutation from being answered by something that cannot mutate.
        """
        if contract.effect is ToolEffect.READ:
            return self._handlers[contract.name](context, arguments)
        return self._actions.execute(
            contract, context, record, self._actor(contract, call), arguments
        )

    # -- resolution ------------------------------------------------------------

    def _actor(self, contract: ToolContract, call: ToolCall) -> SupportIdentityPayload:
        """Resolve whose authority a write runs under, from the published version it names."""
        actor = call.actor
        if actor is None:
            raise ToolActorRequiredError(
                f"{contract.name} changes this arm and must name the support identity acting"
            )
        ref = VersionRef(
            definition=support_identity_definition_id(actor.support_identity_id),
            version=actor.version,
        )
        record = self._support_identities.get_version(ref)
        if record is None:
            raise SupportIdentityVersionNotFoundError(
                f"support identity {actor.support_identity_id} has no published version "
                f"{actor.version}"
            )
        return record.payload

    def _contract(self, call: ToolCall) -> ToolContract:
        contract = next(
            (candidate for candidate in SANDBOX_TOOL_CONTRACTS if candidate.name == call.tool), None
        )
        if contract is None:
            raise ToolNotFoundError(f"this lab publishes no tool named {call.tool!r}")
        if contract.version != call.version:
            raise ToolNotFoundError(
                f"tool {call.tool} is published at version {contract.version}, not {call.version!r}"
            )
        return contract

    def _record(self, shop_id: UUID, sandbox_id: UUID) -> SandboxRecord:
        record = self._sandboxes.get(shop_id, sandbox_id)
        if record is None:
            raise SandboxNotFoundError(f"sandbox {sandbox_id} is not in shop {shop_id}")
        return record

    def _context(self, record: SandboxRecord) -> SandboxToolContext:
        """Put the arm's own state beside the versions its snapshot pinned."""
        snapshot = self._snapshots.get(record.shop_id, record.snapshot_id)
        if snapshot is None:
            raise SandboxSnapshotNotFoundError(
                f"snapshot {record.snapshot_id} is not in shop {record.shop_id}"
            )
        pins = snapshot.content.pins
        return SandboxToolContext(
            state=record.content.state,
            shop=self._pinned(pins, DefinitionType.SHOP, self._shops).payload,
            ticket=self._pinned(pins, DefinitionType.TICKET, self._tickets).payload,
            customer=self._pinned(
                pins, DefinitionType.CUSTOMER_PROFILE, self._customer_profiles
            ).payload,
        )

    def _pinned[PayloadT](
        self,
        pins: tuple[ResolvedDefinition, ...],
        definition_type: DefinitionType,
        repository: DefinitionRepository[PayloadT],
    ) -> DefinitionVersionRecord[PayloadT]:
        pin = next(
            (entry for entry in pins if entry.definition.definition_type is definition_type), None
        )
        if pin is None:
            raise MissingReferenceVersionError(f"this snapshot pins no {definition_type}")
        record = repository.get_version(VersionRef(definition=pin.definition, version=pin.version))
        if record is None:
            raise MissingReferenceVersionError(
                f"{definition_type} {pin.definition.id} version {pin.version} is not resolvable"
            )
        return record

    def _executed(self, result: ToolResult, record: SandboxRecord) -> ToolExecution:
        return ToolExecution(
            result=result, revision=record.revision, state_fingerprint=record.state_fingerprint
        )


def _matches(query: str, *fields: str) -> bool:
    """Whether a case-folded query appears in any one of these fields."""
    return any(query in field.casefold() for field in fields)


def _asked(call: ToolCall) -> dict[str, str]:
    """What the caller actually sent, for a result that refused to parse it."""
    return {name: value for name, value in call.arguments.items() if value is not None}
