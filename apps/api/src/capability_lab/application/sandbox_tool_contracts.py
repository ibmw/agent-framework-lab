"""What the versioned read tools are, declared apart from what they do.

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

__all__ = [
    "CATALOG_PRODUCT",
    "CATALOG_SEARCH",
    "CUSTOMER_PROFILE",
    "INTERACTION_CONTEXT",
    "ORDER_DETAIL",
    "ORDER_LIST",
    "READ_TOOL_CONTRACTS",
    "READ_TOOL_CONTRACT_VERSIONS",
    "READ_TOOL_VERSION",
    "SUPPORT_DOCUMENT",
    "SUPPORT_SEARCH",
    "TOOL_RESULT_CANONICAL_SCHEMA_VERSION",
    "ToolArgument",
    "ToolArgumentKind",
    "ToolContract",
    "ToolContractError",
]

TOOL_RESULT_CANONICAL_SCHEMA_VERSION = "tool-result-v1"

READ_TOOL_VERSION = "v1"
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


class ToolContractError(ValueError):
    """Raised when a tool contract is declared in a shape no caller could use."""


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
    """One versioned read tool: what it is called, and what it can be asked."""

    name: str
    version: str
    summary: str
    arguments: tuple[ToolArgument, ...] = ()

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

    def argument(self, name: str) -> ToolArgument | None:
        return next((argument for argument in self.arguments if argument.name == name), None)


def _read(name: str, summary: str, *arguments: ToolArgument) -> ToolContract:
    return ToolContract(name=name, version=READ_TOOL_VERSION, summary=summary, arguments=arguments)


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
        ToolArgument(
            name="order_reference",
            kind=ToolArgumentKind.TEXT,
            description="The reference the customer quotes, such as NS-10482.",
        ),
        ToolArgument(
            name="order_id",
            kind=ToolArgumentKind.UUID,
            description="The identifier the interaction context carries, when it names an order.",
        ),
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


def _versions() -> Mapping[str, str]:
    versions = {contract.name: contract.version for contract in READ_TOOL_CONTRACTS}
    if len(versions) != len(READ_TOOL_CONTRACTS):
        raise ToolContractError("two tool contracts share one name")
    return MappingProxyType(versions)


READ_TOOL_CONTRACT_VERSIONS: Mapping[str, str] = _versions()
"""The name-to-version map a sandbox snapshot fingerprints itself against.

Wiring this in changes the fingerprint of every starting state materialized from now on,
and that is the correct answer rather than a migration: a snapshot *is* its fingerprint
(ADR 0019), and starting state an arm can interrogate through eight tools is not the
starting state an arm could interrogate through none. Snapshots frozen before this slice
remain readable and remain identified by what they froze.
"""
