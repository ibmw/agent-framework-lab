"""What the versioned tools are, declared apart from what they do.

A tool contract is a public, versioned contract in its own right (`docs/api-and-schema-
conventions.md`): its name carries a domain namespace, its schema has a documented version,
and its result distinguishes domain success, refusal, and technical failure. This module is
the declaration half — the names, the versions, and the arguments each tool accepts.

It is separate from `sandbox_tools`, which implements them, because a snapshot's fingerprint
reads the *declaration* and nothing else. `fingerprint_sandbox_snapshot` has carried a
`tool_contracts` section since ADR 0019 and materialization has left it empty ever since,
waiting for this slice; a tool set that changes what an arm can see changes the starting
state an experiment is explained by, so the versions belong in the hash. Keeping them here
means the materializer reads a declaration rather than importing the handlers, their
repositories, and the sandbox they run against.

Each contract declares its `effect`. A read answers a question and can be repeated; a write
moves the arm, needs an authorized actor, and — for the one write this milestone publishes —
has to be proposed before it can be applied. Declaring it rather than inferring it from the
name is what lets a framework adapter route the two kinds differently without a list of
special cases.

Every argument is text. The lab has no numeric or nested tool argument yet, and a
string-only argument space keeps the canonical serialization of a call trivial and leaves
the JSON Schema a framework adapter needs (Milestone 3) derivable from this table rather
than authored twice.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from enum import StrEnum
from types import MappingProxyType

from capability_lab.domain.support_identity import SupportPermission

__all__ = [
    "ADDRESS_CHANGE_APPLY",
    "ADDRESS_CHANGE_PROPOSE",
    "CATALOG_PRODUCT",
    "CATALOG_SEARCH",
    "CUSTOMER_PROFILE",
    "INTERACTION_CONTEXT",
    "ORDER_DETAIL",
    "ORDER_LIST",
    "READ_TOOL_CONTRACTS",
    "SANDBOX_TOOL_CONTRACTS",
    "SUPPORT_DOCUMENT",
    "SUPPORT_SEARCH",
    "TOOL_CONTRACT_VERSIONS",
    "TOOL_RESULT_CANONICAL_SCHEMA_VERSION",
    "TOOL_VERSION",
    "WRITE_TOOL_CONTRACTS",
    "ToolArgument",
    "ToolArgumentKind",
    "ToolContract",
    "ToolContractError",
    "ToolEffect",
    "ToolRefusal",
    "ToolRefusalCode",
    "ToolRefusedError",
]

TOOL_RESULT_CANONICAL_SCHEMA_VERSION = "tool-result-v1"

TOOL_VERSION = "v1"
"""The version every tool in this first contract set carries.

One version for the whole set is not a rule — a tool is versioned individually, and the
fingerprint records a version per name so one of them can move alone.
"""

INTERACTION_CONTEXT = "interaction.read_context"
CATALOG_SEARCH = "catalog.search_products"
CATALOG_PRODUCT = "catalog.read_product"
CUSTOMER_PROFILE = "customer.read_profile"
ORDER_LIST = "orders.list_orders"
ORDER_DETAIL = "orders.read_order"
SUPPORT_SEARCH = "support.search_knowledge"
SUPPORT_DOCUMENT = "support.read_document"
ADDRESS_CHANGE_PROPOSE = "orders.propose_address_change"
ADDRESS_CHANGE_APPLY = "orders.apply_address_change"


class ToolContractError(ValueError):
    """Raised when a tool contract is declared in a shape no caller could use."""


class ToolEffect(StrEnum):
    """Whether running a tool can move the arm it runs against.

    Declared rather than inferred from the name, because it decides three things a caller
    must not have to guess: whether the call needs an authorized actor, whether a framework
    adapter has to route it through a confirmation step, and whether two identical calls
    against an unmoved arm are guaranteed to answer with identical bytes.
    """

    READ = "read"
    """Answers a question. Repeating it against an unmoved arm repeats the same bytes."""

    WRITE = "write"
    """Changes the arm. Requires an actor whose permissions allow it."""


class ToolRefusalCode(StrEnum):
    """Why a tool declined, in a vocabulary an agent can branch on.

    Declared beside the contracts rather than beside the handlers because a refusal code is
    published API: an adapter branches on it, and an evaluation reads it back as evidence.
    """

    INVALID_ARGUMENTS = "invalid_arguments"
    """The call did not fill the contract: a missing, unknown, or unusable argument."""

    NOT_FOUND = "not_found"
    """Nothing in this arm's world answers to what the call named."""

    NOT_PERMITTED = "not_permitted"
    """The acting support identity is not authorized to do this."""

    NOT_ALLOWED = "not_allowed"
    """The world permits nobody to do this to this order, whoever asked."""

    NOT_CONFIRMED = "not_confirmed"
    """The change was never proposed, so nothing consented to exactly this command."""

    CONFLICT = "conflict"
    """The arm moved after the change was proposed; it was computed against a stale world."""


@dataclass(frozen=True, slots=True)
class ToolRefusal:
    code: ToolRefusalCode
    message: str


class ToolRefusedError(Exception):
    """Internal control flow: a handler declining, turned into a refused result.

    Never raised across the service boundary. It exists so a handler can say "no" from
    wherever it discovers there is nothing to answer with, instead of threading a result
    type through every lookup.
    """

    def __init__(self, code: ToolRefusalCode, message: str) -> None:
        super().__init__(message)
        self.refusal = ToolRefusal(code=code, message=message)


class ToolArgumentKind(StrEnum):
    """How one argument's text is checked before a handler ever sees it."""

    TEXT = "text"
    """Free text the customer or the agent would quote, such as an order reference."""

    UUID = "uuid"
    """A stable identifier the lab issued, such as an order ID from the interaction."""

    ENUM = "enum"
    """One of a closed set the contract lists, such as a shop document collection."""


@dataclass(frozen=True, slots=True)
class ToolArgument:
    """One argument a tool accepts, in the lab's own typed vocabulary.

    Deliberately not JSON Schema. A framework adapter generates whatever schema dialect its
    SDK wants from this table; the lab keeps one description that the Studio console, the
    fingerprint, and every future adapter read the same way.
    """

    name: str
    kind: ToolArgumentKind
    description: str
    required: bool = False
    choices: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        if not self.name or self.name != self.name.strip():
            raise ToolContractError("a tool argument must be named")
        if not self.description:
            raise ToolContractError(f"tool argument {self.name} must say what it is for")
        if (self.kind is ToolArgumentKind.ENUM) != bool(self.choices):
            raise ToolContractError(
                f"tool argument {self.name} must list its choices when, and only when, "
                "it is an enum"
            )


@dataclass(frozen=True, slots=True)
class ToolContract:
    """One versioned tool: what it is called, what it may do, and what it can be asked."""

    name: str
    version: str
    summary: str
    effect: ToolEffect = ToolEffect.READ
    arguments: tuple[ToolArgument, ...] = ()
    required_permission: SupportPermission | None = None
    """The granted permission a write needs, declared beside the tool rather than known
    only by its handler. Two callers ask this question and must agree: the runtime, which
    refuses an unauthorized call, and the agent-configuration publish gate, which refuses a
    configuration that enables a tool its support identity may never use. A read declares
    none — ADR 0021 scopes a tool to one arm, so reading needs no permission to withhold."""

    def __post_init__(self) -> None:
        namespace, separator, verb = self.name.partition(".")
        if not namespace or not separator or not verb:
            raise ToolContractError(
                f"tool name {self.name!r} must carry a domain namespace, as in 'orders.read_order'"
            )
        if not self.version or self.version != self.version.strip():
            raise ToolContractError(f"tool {self.name} must declare a version")
        if not self.summary:
            raise ToolContractError(f"tool {self.name} must say what it answers")
        names = [argument.name for argument in self.arguments]
        if len(set(names)) != len(names):
            raise ToolContractError(f"tool {self.name} declares one argument name twice")
        if (self.effect is ToolEffect.WRITE) != (self.required_permission is not None):
            raise ToolContractError(
                f"tool {self.name} must name the permission it needs when, and only when, it writes"
            )

    def argument(self, name: str) -> ToolArgument | None:
        return next((argument for argument in self.arguments if argument.name == name), None)


def _read(name: str, summary: str, *arguments: ToolArgument) -> ToolContract:
    return ToolContract(
        name=name,
        version=TOOL_VERSION,
        summary=summary,
        effect=ToolEffect.READ,
        arguments=arguments,
    )


def _write(
    name: str,
    summary: str,
    permission: SupportPermission,
    *arguments: ToolArgument,
) -> ToolContract:
    return ToolContract(
        name=name,
        version=TOOL_VERSION,
        summary=summary,
        effect=ToolEffect.WRITE,
        arguments=arguments,
        required_permission=permission,
    )


# The order a write tool acts on, named the way `orders.read_order` accepts it, so an agent
# quotes the same identifier to read an order and to change it.
_ORDER_REFERENCE = ToolArgument(
    name="order_reference",
    kind=ToolArgumentKind.TEXT,
    description="The reference the customer quotes, such as NS-10482.",
)
_ORDER_ID = ToolArgument(
    name="order_id",
    kind=ToolArgumentKind.UUID,
    description="The identifier the interaction context carries, when it names an order.",
)


# The first contract set: one tool per question the wrong-address incident makes an arm ask,
# and none beyond it. A search and a read sit beside each other wherever a collection is
# large enough that an agent has to find something before it can quote it.
READ_TOOL_CONTRACTS: tuple[ToolContract, ...] = (
    _read(
        INTERACTION_CONTEXT,
        "Where this conversation started and the ticket thread it belongs to.",
    ),
    _read(
        CATALOG_SEARCH,
        "Find products in the shop's catalog by handle, title, or category.",
        ToolArgument(
            name="query",
            kind=ToolArgumentKind.TEXT,
            description="Text matched against a product's handle, title, and category.",
        ),
    ),
    _read(
        CATALOG_PRODUCT,
        "Read one product: its options, variants, availability, prices, and reviews.",
        ToolArgument(
            name="handle",
            kind=ToolArgumentKind.TEXT,
            description="The catalog handle, as the interaction context or a search reports it.",
            required=True,
        ),
    ),
    _read(
        CUSTOMER_PROFILE,
        "Read the customer of this conversation: account facts and saved addresses.",
    ),
    _read(ORDER_LIST, "List the orders this customer holds in this shop, newest first."),
    _read(
        ORDER_DETAIL,
        "Read one order in full: lines, totals, payment, fulfilment, address, and events.",
        _ORDER_REFERENCE,
        _ORDER_ID,
    ),
    _read(
        SUPPORT_SEARCH,
        "Find the shop's policies, support guidelines, and FAQ entries.",
        ToolArgument(
            name="query",
            kind=ToolArgumentKind.TEXT,
            description="Text matched against a document's title and body.",
        ),
        ToolArgument(
            name="kind",
            kind=ToolArgumentKind.ENUM,
            description="Restrict the search to one collection.",
            choices=("policy", "support_guideline", "faq_entry"),
        ),
    ),
    _read(
        SUPPORT_DOCUMENT,
        "Read one policy, support guideline, or FAQ entry in full.",
        ToolArgument(
            name="kind",
            kind=ToolArgumentKind.ENUM,
            description="The collection the document lives in.",
            required=True,
            choices=("policy", "support_guideline", "faq_entry"),
        ),
        ToolArgument(
            name="document_id",
            kind=ToolArgumentKind.TEXT,
            description="The shop's own ID for the document, such as 'shipping'.",
            required=True,
        ),
    ),
)


# The one commerce mutation an arm may make, published as two tools rather than one.
#
# Splitting propose from apply is the whole safety model. A proposal resolves the change,
# refuses everything the world does not allow, and names the result by its content; nothing
# moves. Applying presents that name back, which is the "verifiable prior confirmation"
# `docs/api-and-schema-conventions.md` requires of a data-modifying tool — and, because the
# name is issued by the lab and can be applied once, the idempotency key it requires too.
WRITE_TOOL_CONTRACTS: tuple[ToolContract, ...] = (
    _write(
        ADDRESS_CHANGE_PROPOSE,
        "Work out what changing an order's shipping address would do, and confirm nothing.",
        SupportPermission.CHANGE_SHIPPING_ADDRESS,
        _ORDER_REFERENCE,
        _ORDER_ID,
        ToolArgument(
            name="address_id",
            kind=ToolArgumentKind.TEXT,
            description=(
                "The address-book entry to ship to, as customer.read_profile reports its ID."
            ),
            required=True,
        ),
    ),
    _write(
        ADDRESS_CHANGE_APPLY,
        "Apply a proposed shipping-address change, once, to the order it was proposed for.",
        SupportPermission.CHANGE_SHIPPING_ADDRESS,
        ToolArgument(
            name="confirmation",
            kind=ToolArgumentKind.TEXT,
            description="The confirmation the proposal answered with.",
            required=True,
        ),
    ),
)

SANDBOX_TOOL_CONTRACTS: tuple[ToolContract, ...] = READ_TOOL_CONTRACTS + WRITE_TOOL_CONTRACTS


def _versions() -> Mapping[str, str]:
    versions = {contract.name: contract.version for contract in SANDBOX_TOOL_CONTRACTS}
    if len(versions) != len(SANDBOX_TOOL_CONTRACTS):
        raise ToolContractError("two tool contracts share one name")
    return MappingProxyType(versions)


TOOL_CONTRACT_VERSIONS: Mapping[str, str] = _versions()
"""The name-to-version map a sandbox snapshot fingerprints itself against.

Wiring this in changes the fingerprint of every starting state materialized from now on,
and that is the correct answer rather than a migration: a snapshot *is* its fingerprint
(ADR 0019), and starting state an arm can interrogate through eight tools is not the
starting state an arm could interrogate through none. Snapshots frozen before this slice
remain readable and remain identified by what they froze.

The same reasoning admits the write tools: an arm that can redirect an order begins in a
different world from one that can only look at it, so adding them moves the fingerprint
again, deliberately and without a migration.
"""
