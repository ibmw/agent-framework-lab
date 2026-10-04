"""Typed support tickets: the incident record a scenario is built on.

A ticket **is** a versioned definition (ADR 0012), unlike the order fixture beside it. The
difference is what each one is for: an order is state a run mutates, while a ticket is the
recipe's opening move — the channel, the page the customer was on, the history the agent
may read, and the exact first message every arm receives. Two arms must receive byte-identical
triggers, so the trigger has to be frozen, and freezing is what a published version does.

A ticket is scoped to one shop and references exactly one customer profile. The reference is
pinned to an exact published version at publication; the shop version is pinned alongside it,
so a published ticket names the catalog and support configuration it was authored against.

Everything a ticket points at is **selected, never typed**: the channel comes from the shop's
configured channels, the origin names a catalog handle or an order fixture, and a suggested
document names a shop document by its ID. What a ticket genuinely authors is prose — the
subject and the message bodies — and that prose is the sensitive part of the document.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from functools import partial
from uuid import UUID

from capability_lab.domain.content import (
    FieldSensitivity,
    require_business_reference,
    require_instance,
    require_label,
    require_slug,
    require_text,
    require_unique,
    require_utc_timestamp,
)
from capability_lab.domain.content import (
    unclassified_paths as unclassified_document_paths,
)
from capability_lab.domain.definitions import (
    DefinitionChange,
    DefinitionChangeKind,
    DefinitionIssue,
    DefinitionValidation,
    diff_keyed_collection,
    field_changes,
    issue_error,
    issue_warning,
    validation_of,
)
from capability_lab.domain.entities import DomainError
from capability_lab.domain.shop import ShopDocumentKind, SupportChannel

MAX_TICKET_HISTORY = 40
MAX_TICKET_TAGS = 12
MAX_LINKED_ORDERS = 10
MAX_SUGGESTED_DOCUMENTS = 10


class TicketConfigurationError(DomainError):
    """Raised when ticket content violates a structural invariant."""


_error_type = TicketConfigurationError
_require_slug = partial(require_slug, error=_error_type)
_require_label = partial(require_label, error=_error_type)
_require_text = partial(require_text, error=_error_type)
_require_unique = partial(require_unique, error=_error_type)
_require_instance = partial(require_instance, error=_error_type)
_require_utc_timestamp = partial(require_utc_timestamp, error=_error_type)
_require_business_reference = partial(require_business_reference, error=_error_type)


class TicketStatus(StrEnum):
    """Where the incident stands.

    Deliberately without a transition graph, unlike an order's two status axes. An order's
    statuses describe money and goods moving in one direction; a ticket is reopened all the
    time, and a fixture authored after the fact may legitimately record either state.
    """

    OPEN = "open"
    RESOLVED = "resolved"


class TicketAuthor(StrEnum):
    """Who wrote one fixture message.

    `SUPPORT_AGENT` is recorded history — a past human agent — never the agent under test.
    Live replies belong to a run, not to the ticket.
    """

    CUSTOMER = "customer"
    SUPPORT_AGENT = "support_agent"


class TicketOriginKind(StrEnum):
    """Where the customer was when the incident started."""

    PRODUCT_PAGE = "product_page"
    ORDER_PAGE = "order_page"
    CHECKOUT = "checkout"
    FAQ = "faq"
    SUPPORT_ENTRY = "support_entry"


# Which origins name a resource, and which one. An origin that names nothing is not
# incomplete — a customer really can open a chat from the generic support entry.
ORIGIN_PRODUCT_KINDS: frozenset[TicketOriginKind] = frozenset({TicketOriginKind.PRODUCT_PAGE})
ORIGIN_ORDER_KINDS: frozenset[TicketOriginKind] = frozenset({TicketOriginKind.ORDER_PAGE})


# A suggestion points into the same three collections a scenario's context documents and a
# read-check's binding do, so the set lives with the shop that owns them (ADR 0018).
SuggestedDocumentKind = ShopDocumentKind


@dataclass(frozen=True, slots=True)
class TicketOrigin:
    """The minimal resource reference the interaction started from.

    Minimal on purpose: the agent resolves "this product" or "this order" through tools, so
    the ticket carries an identifier and never an embedded copy of the resource. A product
    is named by its catalog handle, which is the shop's own key for it; an order is named by
    its stable identifier rather than its reference, because an author may rename a
    reference and a renamed order is still the same order.
    """

    kind: TicketOriginKind
    product_handle: str | None = None
    order_id: UUID | None = None

    def __post_init__(self) -> None:
        _require_instance(
            self.kind, TicketOriginKind, "ticket origin kind must be a supported kind"
        )
        if self.product_handle is not None:
            _require_slug(self.product_handle, "ticket origin product handle")
            if self.kind not in ORIGIN_PRODUCT_KINDS:
                raise TicketConfigurationError(f"a {self.kind.value} origin cannot name a product")
        if self.order_id is not None:
            _require_instance(self.order_id, UUID, "ticket origin order must be an order ID")
            if self.kind not in ORIGIN_ORDER_KINDS:
                raise TicketConfigurationError(f"a {self.kind.value} origin cannot name an order")

    @property
    def names_resource(self) -> bool:
        return self.product_handle is not None or self.order_id is not None

    @property
    def requires_resource(self) -> bool:
        return self.kind in ORIGIN_PRODUCT_KINDS | ORIGIN_ORDER_KINDS


@dataclass(frozen=True, slots=True)
class TicketMessage:
    """One fixture message in the ticket thread.

    Identified by the author so an edit keeps its identity across saves, the way an order
    event does. `sent_at` is canonical UTC: the thread's order is what the history means.
    """

    id: str
    author: TicketAuthor
    body: str
    sent_at: str

    def __post_init__(self) -> None:
        _require_slug(self.id, "ticket message ID")
        _require_instance(self.author, TicketAuthor, "ticket message author must be a known author")
        _require_text(self.body, "ticket message body")
        _require_utc_timestamp(self.sent_at, "ticket message time")


@dataclass(frozen=True, slots=True)
class SuggestedDocument:
    """A shop document worth reading for this incident.

    Authoring convenience, not sandbox content: a suggestion pre-fills the context documents
    of a scenario built on this ticket. The agent never sees the suggestion itself — it
    reaches a document through a tool, and whether it did is the scenario's evidence.
    """

    kind: SuggestedDocumentKind
    document_id: str

    def __post_init__(self) -> None:
        _require_instance(
            self.kind, SuggestedDocumentKind, "suggested document kind must be a supported kind"
        )
        _require_slug(self.document_id, "suggested document ID")

    @property
    def key(self) -> str:
        return f"{self.kind.value}:{self.document_id}"


@dataclass(frozen=True, slots=True)
class TicketPayload:
    """The complete authored content of one ticket draft or published version.

    `customer_profile_id` is an ADR 0012 **reference**, unlike the order fixture's
    same-named field: publishing pins it to an exact published customer-profile version, so
    a published ticket names the customer as they read when the incident was frozen.

    `history` is the prior conversation and `trigger` is the message every arm receives at
    experiment start. They are separate fields rather than one flagged list because they
    have different lifetimes: history is context an agent may read, while the trigger is the
    single input the comparison holds identical across arms.
    """

    reference: str
    subject: str
    customer_profile_id: UUID
    channel: SupportChannel
    status: TicketStatus = TicketStatus.OPEN
    origin: TicketOrigin = TicketOrigin(kind=TicketOriginKind.SUPPORT_ENTRY)
    tags: tuple[str, ...] = ()
    history: tuple[TicketMessage, ...] = ()
    trigger: TicketMessage | None = None
    linked_order_ids: tuple[UUID, ...] = ()
    suggested_documents: tuple[SuggestedDocument, ...] = ()

    def __post_init__(self) -> None:
        _require_business_reference(self.reference, "ticket reference")
        _require_label(self.subject, "ticket subject")
        _require_instance(self.customer_profile_id, UUID, "a ticket must name its customer profile")
        _require_instance(self.channel, SupportChannel, "ticket channel must be a support channel")
        _require_instance(self.status, TicketStatus, "ticket status must be a supported status")
        _require_instance(self.origin, TicketOrigin, "a ticket must declare where it started")
        if len(self.history) > MAX_TICKET_HISTORY:
            raise TicketConfigurationError(
                f"a ticket can carry at most {MAX_TICKET_HISTORY} prior messages"
            )
        if len(self.tags) > MAX_TICKET_TAGS:
            raise TicketConfigurationError(f"a ticket can carry at most {MAX_TICKET_TAGS} tags")
        if len(self.linked_order_ids) > MAX_LINKED_ORDERS:
            raise TicketConfigurationError(f"a ticket can link at most {MAX_LINKED_ORDERS} orders")
        if len(self.suggested_documents) > MAX_SUGGESTED_DOCUMENTS:
            raise TicketConfigurationError(
                f"a ticket can suggest at most {MAX_SUGGESTED_DOCUMENTS} documents"
            )
        for tag in self.tags:
            _require_slug(tag, "ticket tag")
        _require_unique(self.tags, "ticket tags")
        for order_id in self.linked_order_ids:
            _require_instance(order_id, UUID, "a linked order must be named by its order ID")
        _require_unique(tuple(str(order_id) for order_id in self.linked_order_ids), "linked orders")
        _require_unique(
            tuple(document.key for document in self.suggested_documents), "suggested documents"
        )
        _require_unique(tuple(message.id for message in self.messages), "ticket message IDs")
        if self.trigger is not None:
            _require_instance(self.trigger, TicketMessage, "the trigger must be a ticket message")
            if self.trigger.author is not TicketAuthor.CUSTOMER:
                # The trigger is by definition what the customer says to open the incident.
                raise TicketConfigurationError("the triggering message must come from the customer")

    @property
    def messages(self) -> tuple[TicketMessage, ...]:
        """The whole thread, prior history first and the trigger last."""
        return self.history if self.trigger is None else (*self.history, self.trigger)

    @property
    def opened_at(self) -> str | None:
        """When the incident opened: the trigger's moment, never authored separately."""
        return None if self.trigger is None else self.trigger.sent_at

    @property
    def referenced_order_ids(self) -> tuple[UUID, ...]:
        """Every order this ticket points at, including the one it was opened from."""
        origin_order = self.origin.order_id
        if origin_order is None or origin_order in self.linked_order_ids:
            return self.linked_order_ids
        return (origin_order, *self.linked_order_ids)


# Every leaf of the `ticket-payload-v1` document, so a newly authored field cannot arrive
# without a decision about whether it may reach a log line or a span. `[]` stands for a list
# index. Selected identifiers are operational — they name shop configuration, not a person —
# while everything a human wrote in their own words about this incident is sensitive.
FIELD_SENSITIVITY: dict[str, FieldSensitivity] = {
    "canonical_schema_version": FieldSensitivity.OPERATIONAL,
    "reference": FieldSensitivity.OPERATIONAL,
    # Written by a customer about their own incident, so it can carry anything they typed.
    "subject": FieldSensitivity.SENSITIVE,
    "customer_profile_id": FieldSensitivity.OPERATIONAL,
    "channel": FieldSensitivity.OPERATIONAL,
    "status": FieldSensitivity.OPERATIONAL,
    "origin.kind": FieldSensitivity.OPERATIONAL,
    "origin.product_handle": FieldSensitivity.OPERATIONAL,
    "origin.order_id": FieldSensitivity.OPERATIONAL,
    "tags[]": FieldSensitivity.OPERATIONAL,
    "history[].id": FieldSensitivity.OPERATIONAL,
    "history[].author": FieldSensitivity.OPERATIONAL,
    "history[].body": FieldSensitivity.SENSITIVE,
    "history[].sent_at": FieldSensitivity.OPERATIONAL,
    "trigger.id": FieldSensitivity.OPERATIONAL,
    "trigger.author": FieldSensitivity.OPERATIONAL,
    "trigger.body": FieldSensitivity.SENSITIVE,
    "trigger.sent_at": FieldSensitivity.OPERATIONAL,
    "linked_order_ids[]": FieldSensitivity.OPERATIONAL,
    "suggested_documents[].kind": FieldSensitivity.OPERATIONAL,
    "suggested_documents[].document_id": FieldSensitivity.OPERATIONAL,
}


def unclassified_paths(document: object) -> frozenset[str]:
    """Document leaves with no sensitivity decision; empty for a complete payload."""
    return unclassified_document_paths(document, FIELD_SENSITIVITY)


def restricted_values(payload: TicketPayload) -> tuple[str, ...]:
    """Every authored value that must never reach a log line, span, or error message."""
    values = [payload.subject, *(message.body for message in payload.messages)]
    # An empty needle would match every haystack in the tests that assert absence.
    return tuple(value for value in values if value)


def telemetry_attributes(payload: TicketPayload) -> dict[str, str | int | bool]:
    """The only ticket attributes the lab may attach to a span or a log line.

    Everything here is an `OPERATIONAL` field or a count, so a trace can describe which
    ticket a run started from without disclosing a word of what anybody wrote.
    """
    return {
        "lab.ticket.reference": payload.reference,
        "lab.ticket.channel": payload.channel.value,
        "lab.ticket.status": payload.status.value,
        "lab.ticket.origin_kind": payload.origin.kind.value,
        "lab.ticket.origin_names_resource": payload.origin.names_resource,
        "lab.ticket.has_trigger": payload.trigger is not None,
        "lab.ticket.history_count": len(payload.history),
        "lab.ticket.tag_count": len(payload.tags),
        "lab.ticket.linked_order_count": len(payload.linked_order_ids),
        "lab.ticket.suggested_document_count": len(payload.suggested_documents),
    }


@dataclass(frozen=True, slots=True)
class TicketAuthoringContext:
    """What the ticket's shop and customer currently offer, for reference-aware validation.

    Passed in rather than looked up so the rules stay pure: the same ticket is complete or
    incomplete purely as a function of the content around it.
    """

    customer_attached: bool = True
    # Whether the two definitions a publication must pin have a version to pin. They belong
    # here rather than only in the pin step so the preview an author reads and the rules that
    # refuse the freeze stay one set: an author must not see a clean gate and then a 422.
    shop_published: bool = True
    customer_published: bool = True
    shop_channels: frozenset[SupportChannel] = frozenset()
    product_handles: frozenset[str] = frozenset()
    # Every order in the shop, and the subset belonging to this ticket's customer. Two sets
    # rather than one, so "that order is gone" and "that order is someone else's" stay
    # distinguishable findings instead of collapsing into one misleading message.
    shop_order_ids: frozenset[UUID] = frozenset()
    customer_order_ids: frozenset[UUID] = frozenset()
    document_ids: dict[SuggestedDocumentKind, frozenset[str]] | None = None

    def documents(self, kind: SuggestedDocumentKind) -> frozenset[str]:
        return (
            frozenset() if self.document_ids is None else self.document_ids.get(kind, frozenset())
        )


def _order_issues(payload: TicketPayload, context: TicketAuthoringContext) -> list[DefinitionIssue]:
    """Check every referenced order twice: it exists here, and it is this customer's.

    A ticket carries no frozen copy of an order — it holds an identifier the sandbox
    resolves — so an unresolvable link is an error rather than the drift warning an order's
    own frozen address earns.
    """
    issues: list[DefinitionIssue] = []
    origin_order = payload.origin.order_id
    for order_id in payload.referenced_order_ids:
        path = "origin.order_id" if order_id == origin_order else "linked_order_ids"
        if order_id not in context.shop_order_ids:
            issues.append(
                issue_error(
                    "linked_order_missing_from_shop",
                    f"order {order_id} is no longer an order of this shop",
                    path,
                )
            )
        elif order_id not in context.customer_order_ids:
            issues.append(
                issue_error(
                    "linked_order_of_another_customer",
                    f"order {order_id} belongs to another customer, and a ticket may only "
                    "show the agent its own customer's orders",
                    path,
                )
            )
    return issues


def _content_issues(payload: TicketPayload) -> list[DefinitionIssue]:
    """Findings that depend on the ticket alone, before the shop around it is consulted."""
    issues: list[DefinitionIssue] = []

    if payload.trigger is None:
        issues.append(
            issue_error(
                "ticket_without_trigger",
                "a published ticket must carry the first message every arm receives at "
                "experiment start",
                "trigger",
            )
        )
    else:
        latest_history = max((message.sent_at for message in payload.history), default=None)
        if latest_history is not None and payload.trigger.sent_at <= latest_history:
            issues.append(
                issue_error(
                    "trigger_precedes_history",
                    "the triggering message is not the newest message in the thread, so the "
                    "history it is supposed to open already answers it",
                    "trigger.sent_at",
                )
            )

    origin = payload.origin
    if origin.requires_resource and not origin.names_resource:
        issues.append(
            issue_error(
                "origin_without_reference",
                f"a {origin.kind.value} origin must name the resource the customer was "
                "looking at, because the agent resolves it through tools",
                "origin",
            )
        )

    if not origin.names_resource and not payload.linked_order_ids:
        issues.append(
            issue_warning(
                "ticket_without_resource_reference",
                "the ticket names no product or order, so the agent has nothing to resolve "
                "from the incident itself",
                "linked_order_ids",
            )
        )

    if not payload.suggested_documents:
        issues.append(
            issue_warning(
                "ticket_without_suggested_document",
                "no shop document is suggested, so a scenario built on this ticket starts "
                "with no context documents",
                "suggested_documents",
            )
        )

    return issues


def _context_issues(
    payload: TicketPayload, context: TicketAuthoringContext
) -> list[DefinitionIssue]:
    """Findings that are the shop's answer to what the ticket points at."""
    issues: list[DefinitionIssue] = []

    if not context.customer_attached:
        issues.append(
            issue_error(
                "customer_not_attached_to_shop",
                "the ticket's customer profile is not attached to this shop, so the "
                "incident belongs to a customer the shop does not have",
                "customer_profile_id",
            )
        )

    if not context.shop_published:
        issues.append(
            issue_error(
                "shop_unpublished",
                "publishing a ticket pins an exact shop version, and this shop has never "
                "been published",
                # The shop is the ticket's scope rather than its content, so this finding
                # names the scope; every other path here is a payload path.
                "shop",
            )
        )

    if not context.customer_published:
        issues.append(
            issue_error(
                "customer_profile_unpublished",
                "publishing a ticket pins an exact customer-profile version, and this "
                "profile has never been published",
                "customer_profile_id",
            )
        )

    if payload.channel not in context.shop_channels:
        issues.append(
            issue_error(
                "channel_not_offered_by_shop",
                f"this shop does not offer support over {payload.channel.value}, so no run "
                "could receive this ticket",
                "channel",
            )
        )

    handle = payload.origin.product_handle
    if handle is not None and handle not in context.product_handles:
        issues.append(
            issue_error(
                "origin_product_missing_from_catalog",
                f"the ticket was opened from product {handle}, which this shop's catalog "
                "no longer contains",
                "origin.product_handle",
            )
        )

    issues.extend(_order_issues(payload, context))

    for document in payload.suggested_documents:
        if document.document_id not in context.documents(document.kind):
            issues.append(
                issue_warning(
                    "suggested_document_missing_from_shop",
                    f"{document.kind.value} {document.document_id} is no longer configured "
                    "by this shop, yet it still pre-fills the context documents of a scenario "
                    "built on this ticket, which names a document nobody could read",
                    "suggested_documents",
                )
            )

    return issues


def validate_ticket_content(payload: TicketPayload) -> DefinitionValidation:
    """The publish-gate findings a ticket carries on its own.

    Every reference a ticket makes is resolved against a shop, so this covers only the rules
    that hold whatever the shop contains. The authoring service adds the rest; this is what
    a pure caller — a test, or a payload round-trip — can assert without a shop.
    """
    return validation_of(_content_issues(payload))


def validate_ticket(
    payload: TicketPayload, context: TicketAuthoringContext
) -> DefinitionValidation:
    """Report every publish-gate finding for one ticket draft.

    Errors mark a ticket that cannot open a coherent incident; warnings mark authoring the
    scenario built on this ticket will miss, without blocking the freeze.
    """
    return validation_of(_content_issues(payload) + _context_issues(payload, context))


def _describe_message(message: TicketMessage | None) -> str:
    """Name a message without quoting it: a change summary is shown outside the editor."""
    return "none" if message is None else f"{message.author.value} at {message.sent_at}"


def summarize_ticket_changes(
    previous: TicketPayload | None, current: TicketPayload
) -> tuple[DefinitionChange, ...]:
    """Describe what publishing this draft would freeze, against the latest version."""
    if previous is None:
        return (
            DefinitionChange(
                kind=DefinitionChangeKind.ADDED,
                path="",
                description=f"First published version of ticket {current.reference}",
            ),
        )

    changes: list[DefinitionChange] = []
    changes.extend(
        field_changes(
            "ticket",
            (
                ("reference", previous.reference, current.reference),
                ("subject", previous.subject, current.subject),
                ("channel", previous.channel, current.channel),
                ("status", previous.status, current.status),
                ("customer_profile_id", previous.customer_profile_id, current.customer_profile_id),
            ),
            lambda name: f"Updated ticket {name.replace('_', ' ')}",
        )
    )
    changes.extend(
        field_changes(
            "origin",
            (
                ("kind", previous.origin.kind, current.origin.kind),
                ("product_handle", previous.origin.product_handle, current.origin.product_handle),
                ("order_id", previous.origin.order_id, current.origin.order_id),
            ),
            lambda name: f"Updated origin {name.replace('_', ' ')}",
        )
    )
    for tag in sorted(set(current.tags) - set(previous.tags)):
        changes.append(
            DefinitionChange(
                kind=DefinitionChangeKind.ADDED, path=f"tags.{tag}", description=f"Tagged {tag}"
            )
        )
    for tag in sorted(set(previous.tags) - set(current.tags)):
        changes.append(
            DefinitionChange(
                kind=DefinitionChangeKind.REMOVED,
                path=f"tags.{tag}",
                description=f"Removed tag {tag}",
            )
        )
    changes.extend(
        diff_keyed_collection(
            previous.history,
            current.history,
            key=lambda message: message.id,
            label=_describe_message,
            path="history",
            noun="history message",
        )
    )
    if previous.trigger != current.trigger:
        changes.append(
            DefinitionChange(
                kind=DefinitionChangeKind.UPDATED,
                path="trigger",
                description=(
                    f"Updated the triggering message ({_describe_message(current.trigger)})"
                ),
            )
        )
    for order_id in sorted(set(current.linked_order_ids) - set(previous.linked_order_ids)):
        changes.append(
            DefinitionChange(
                kind=DefinitionChangeKind.ADDED,
                path=f"linked_order_ids.{order_id}",
                description=f"Linked order {order_id}",
            )
        )
    for order_id in sorted(set(previous.linked_order_ids) - set(current.linked_order_ids)):
        changes.append(
            DefinitionChange(
                kind=DefinitionChangeKind.REMOVED,
                path=f"linked_order_ids.{order_id}",
                description=f"Unlinked order {order_id}",
            )
        )
    changes.extend(
        diff_keyed_collection(
            previous.suggested_documents,
            current.suggested_documents,
            key=lambda document: document.key,
            label=lambda document: f"{document.kind.value} {document.document_id}",
            path="suggested_documents",
            noun="suggested document",
        )
    )
    return tuple(changes)
