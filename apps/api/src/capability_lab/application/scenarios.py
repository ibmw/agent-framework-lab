"""Authoring shop-scoped scenario definitions.

A scenario is the second shop-scoped definition and the first that references more than one
thing: its ticket, and every objective and mutation template it composes. All of them are
derived from the payload (ADR 0012), so publishing pins the shop version, the ticket version,
and one version per distinct template in a single step — a template bound twice is still one
reference, because a reference is per definition rather than per instance.

What this service adds on top of the shared lifecycle is the surrounding answer to "does this
resolve?": the shop's documents, catalog, orders and customers, the ticket's own customer, and
the two libraries' templates as the publish gate needs to see them. They are gathered once
into a `ScenarioAuthoringContext` so the rules stay pure and the preview an author reads is
the same rule set that refuses publication.

It also derives the **resolved-state preview**: the shop, ticket, customer, documents,
entities, and template versions a publication would freeze. That is derived on every read
rather than stored, because every one of those lives elsewhere and would go stale the moment
it moved.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from capability_lab.application.blocks import (
    MutationBlockRepository,
    ObjectiveBlockRepository,
    mutation_block_definition_id,
    objective_block_definition_id,
)
from capability_lab.application.customer_profiles import (
    DefinitionShopAttachmentRepository,
    customer_profile_definition_id,
)
from capability_lab.application.definition_authoring import (
    AuthoringErrors,
    DefinitionAuthoringService,
    DefinitionDraftPreview,
    DefinitionDraftRecord,
    DefinitionNotFoundError,
    DefinitionNotPublishableError,
    DefinitionRepository,
    DefinitionVersionNotFoundError,
    DefinitionVersionRecord,
    PayloadCodec,
    PublishedVersionDirectory,
    ShopScopedDefinitionRepository,
)
from capability_lab.application.definition_resolution import DefinitionResolutionError
from capability_lab.application.order_fixtures import OrderFixtureRecord, OrderFixtureRepository
from capability_lab.application.ports import Clock
from capability_lab.application.scenario_payload import (
    scenario_content_fingerprint,
    scenario_document,
    scenario_from_document,
)
from capability_lab.application.shops import ShopNotFoundError
from capability_lab.application.tickets import (
    TicketRepository,
    shop_definition_id,
    ticket_definition_id,
)
from capability_lab.domain.blocks import BlockParameter, BlockPayload
from capability_lab.domain.customer_profile import CustomerProfilePayload
from capability_lab.domain.definitions import (
    DefinitionId,
    DefinitionType,
    DefinitionValidation,
    PublishedDefinitionVersion,
)
from capability_lab.domain.order_fixture import FulfilmentStatus, PaymentStatus
from capability_lab.domain.scenario import (
    BlockTemplate,
    ContextDocument,
    EntityReference,
    ScenarioAuthoringContext,
    ScenarioEntityKind,
    ScenarioPayload,
    parse_data_reference,
    parse_entity_reference,
    summarize_scenario_changes,
    validate_scenario,
    validate_scenario_content,
)
from capability_lab.domain.shop import Currency, ShopDocumentKind, ShopPayload
from capability_lab.domain.ticket import TicketPayload


class ScenarioNotFoundError(DefinitionNotFoundError):
    """Raised when a shop has no scenario with the requested identifier."""


class ScenarioVersionNotFoundError(DefinitionVersionNotFoundError):
    """Raised when a published scenario version does not exist."""


class ScenarioNotPublishableError(DefinitionNotPublishableError):
    """Raised when a scenario draft still has publish-gate errors."""

    noun = "scenario"


class ScenarioNameExistsError(DefinitionResolutionError):
    """Raised when another scenario in the same shop already answers to that name."""


class ScenarioTicketChangeError(DefinitionResolutionError):
    """Raised when a write would rebuild a scenario on a different ticket."""


class ScenarioTicketNotInShopError(DefinitionResolutionError):
    """Raised when a scenario names a ticket that is not this shop's."""


def scenario_definition_id(scenario_id: UUID) -> DefinitionId:
    return DefinitionId(definition_type=DefinitionType.SCENARIO, id=scenario_id)


def scenario_references(payload: ScenarioPayload) -> tuple[DefinitionId, ...]:
    """The ticket and every distinct template this scenario composes (ADR 0012)."""
    return (
        ticket_definition_id(payload.ticket_id),
        *(objective_block_definition_id(block_id) for block_id in payload.objective_block_ids),
        *(mutation_block_definition_id(block_id) for block_id in payload.mutation_block_ids),
    )


SCENARIO_CODEC: PayloadCodec[ScenarioPayload] = PayloadCodec(
    definition_type=DefinitionType.SCENARIO,
    document=scenario_document,
    from_document=scenario_from_document,
    fingerprint=scenario_content_fingerprint,
    # The shop- and library-aware half of the gate lives on the service, which knows both;
    # this is what a scenario can be judged on with nothing else loaded.
    validate=validate_scenario_content,
    summarize_changes=summarize_scenario_changes,
    references=scenario_references,
)

ScenarioDraftRecord = DefinitionDraftRecord[ScenarioPayload]
ScenarioVersionRecord = DefinitionVersionRecord[ScenarioPayload]
ScenarioDraftPreview = DefinitionDraftPreview[ScenarioPayload]
ScenarioRepository = ShopScopedDefinitionRepository[ScenarioPayload]


@dataclass(frozen=True, slots=True)
class ScenarioSummary:
    """One row of the Studio's scenario index."""

    scenario_id: UUID
    name: str
    ticket_id: UUID
    ticket_reference: str
    ticket_subject: str
    customer_display_name: str
    objective_count: int
    mutation_count: int
    context_document_count: int
    max_turns: int
    updated_at: datetime
    latest_published_version: int | None
    published_version_count: int


@dataclass(frozen=True, slots=True)
class ScenarioOrderOption:
    """One of the ticket customer's orders, as the binding pickers offer it."""

    order_id: UUID
    reference: str
    payment_status: PaymentStatus
    fulfilment_status: FulfilmentStatus
    total_amount: str
    currency: Currency
    shipping_label: str | None


@dataclass(frozen=True, slots=True)
class ScenarioDocumentOption:
    """One shop document a context entry or a read-check may name."""

    kind: ShopDocumentKind
    document_id: str
    title: str


@dataclass(frozen=True, slots=True)
class ScenarioBlockOption:
    """One library template, with everything the editor needs to bind it.

    The parameters travel with the option because binding is the editor's whole job: without
    them a picker could only offer a name, and the author would be typing values blind
    against a gate that already knows the answer.
    """

    block_id: UUID
    name: str
    statement: str
    description: str
    type_label: str
    latest_published_version: int | None
    parameters: tuple[BlockParameter, ...]


@dataclass(frozen=True, slots=True)
class ScenarioCustomerOption:
    profile_id: UUID
    display_name: str


@dataclass(frozen=True, slots=True)
class ScenarioResources:
    """Exactly what this scenario may name, so a picker cannot offer a publish-gate error."""

    documents: tuple[ScenarioDocumentOption, ...]
    orders: tuple[ScenarioOrderOption, ...]
    product_handles: tuple[str, ...]
    customers: tuple[ScenarioCustomerOption, ...]
    objective_blocks: tuple[ScenarioBlockOption, ...]
    mutation_blocks: tuple[ScenarioBlockOption, ...]


@dataclass(frozen=True, slots=True)
class ResolvedDocument:
    kind: ShopDocumentKind
    document_id: str
    title: str | None
    resolved: bool


@dataclass(frozen=True, slots=True)
class ResolvedEntity:
    """One shop object a binding points at, as the resolved-state preview shows it."""

    kind: ScenarioEntityKind
    identifier: str
    label: str | None
    detail: str | None
    resolved: bool


@dataclass(frozen=True, slots=True)
class ResolvedTemplate:
    """One template the scenario composes and the version publishing would pin it at."""

    block_id: UUID
    name: str
    definition_type: DefinitionType
    version: int | None
    instance_count: int


@dataclass(frozen=True, slots=True)
class ScenarioResolution:
    """The complete starting state publishing this draft would freeze.

    Frame 4's right rail: the shop, the ticket and its customer, the documents and entities
    every binding resolves to, and the exact template version each composed block would pin.
    A `None` version is a target with nothing to pin, which the publish gate reports as an
    error beside it.
    """

    shop_name: str
    shop_version: int | None
    ticket_id: UUID
    ticket_reference: str
    ticket_subject: str
    ticket_version: int | None
    customer_profile_id: UUID | None
    customer_display_name: str
    customer_profile_version: int | None
    documents: tuple[ResolvedDocument, ...]
    entities: tuple[ResolvedEntity, ...]
    templates: tuple[ResolvedTemplate, ...]
    objective_count: int
    mutation_count: int
    max_turns: int


@dataclass(frozen=True, slots=True)
class ScenarioPreview:
    """The publish gate and the resolved state, which an author reads side by side."""

    draft: ScenarioDraftPreview
    resolution: ScenarioResolution


def new_scenario(
    name: str, ticket_id: UUID, context_documents: tuple[ContextDocument, ...]
) -> ScenarioPayload:
    """The deliberately incomplete first draft: a recipe that asserts nothing yet.

    The context documents are the ticket's suggestions, which is what a suggestion is for —
    the author who wrote "read the address-change policy" beside the incident should not have
    to say it twice. Everything else is composed in the editor.
    """
    return ScenarioPayload(name=name, ticket_id=ticket_id, context_documents=context_documents)


class ScenarioService(DefinitionAuthoringService[ScenarioPayload]):
    """Author, validate, and publish the scenarios of one shop."""

    def __init__(
        self,
        repository: ScenarioRepository,
        shops: DefinitionRepository[ShopPayload],
        tickets: TicketRepository,
        profiles: DefinitionRepository[CustomerProfilePayload],
        orders: OrderFixtureRepository,
        objective_blocks: ObjectiveBlockRepository,
        mutation_blocks: MutationBlockRepository,
        attachments: DefinitionShopAttachmentRepository,
        versions: PublishedVersionDirectory,
        clock: Clock,
    ) -> None:
        super().__init__(
            repository,
            clock,
            SCENARIO_CODEC,
            AuthoringErrors(
                not_found=ScenarioNotFoundError,
                version_not_found=ScenarioVersionNotFoundError,
                not_publishable=ScenarioNotPublishableError,
            ),
            noun="scenario",
            versions=versions,
        )
        self._scenarios = repository
        self._shops = shops
        self._tickets = tickets
        self._profiles = profiles
        self._orders = orders
        self._objective_blocks = objective_blocks
        self._mutation_blocks = mutation_blocks
        self._attachments = attachments

    # -- the shop- and library-aware publish gate -------------------------------

    def _validate(self, record: ScenarioDraftRecord) -> DefinitionValidation:
        """Judge the draft against its shop, its ticket, and the two libraries."""
        shop = record.draft.shop
        if shop is None:
            # A scenario is shop-scoped by construction; a draft without a scope is a
            # persistence bug, not authored content, and must not silently pass the gate.
            raise ScenarioNotFoundError(
                f"scenario {record.definition.id} has no owning shop and cannot be validated"
            )
        return validate_scenario(record.payload, self.authoring_context(shop.id, record.payload))

    def authoring_context(
        self, shop_id: UUID, payload: ScenarioPayload
    ) -> ScenarioAuthoringContext:
        shop = self._require_shop(shop_id)
        ticket = self._ticket_payload(shop_id, payload.ticket_id)
        customer_id = None if ticket is None else ticket.customer_profile_id
        orders = self._orders.list_for_shop(shop_id)
        return ScenarioAuthoringContext(
            ticket_in_shop=ticket is not None,
            ticket_published=(
                ticket is not None
                and self._latest_published(ticket_definition_id(payload.ticket_id)) is not None
            ),
            # What publishing this scenario would have to pin. Reported as findings so an
            # author never reads a clean gate and then gets a refusal on the click.
            shop_published=self._latest_published(shop_definition_id(shop_id)) is not None,
            ticket_customer_profile_id=customer_id,
            document_ids=_document_ids(shop),
            product_handles=frozenset(product.handle for product in shop.products),
            shop_order_ids=frozenset(order.order_id for order in orders),
            customer_order_ids=frozenset(
                order.order_id
                for order in orders
                if order.payload.customer_profile_id == customer_id
            ),
            shop_customer_profile_ids=self._attachments.definitions_for_shop(
                DefinitionType.CUSTOMER_PROFILE, shop_id
            ),
            objective_blocks=self._objective_templates(),
            mutation_blocks=self._mutation_templates(),
        )

    def _objective_templates(self) -> dict[UUID, BlockTemplate]:
        return {
            listing.definition_id: _template(
                listing.payload, listing.latest_published_version is not None
            )
            for listing in self._objective_blocks.list_definitions()
        }

    def _mutation_templates(self) -> dict[UUID, BlockTemplate]:
        return {
            listing.definition_id: _template(
                listing.payload, listing.latest_published_version is not None
            )
            for listing in self._mutation_blocks.list_definitions()
        }

    # -- reading ---------------------------------------------------------------

    def list_scenarios(self, shop_id: UUID) -> tuple[ScenarioSummary, ...]:
        self._require_shop(shop_id)
        tickets = {
            listing.definition_id: listing.payload
            for listing in self._tickets.list_in_shop(shop_id)
        }
        names = self._customer_names()
        summaries: list[ScenarioSummary] = []
        for listing in self._scenarios.list_in_shop(shop_id):
            payload = listing.payload
            ticket = tickets.get(payload.ticket_id)
            summaries.append(
                ScenarioSummary(
                    scenario_id=listing.definition_id,
                    name=payload.name,
                    ticket_id=payload.ticket_id,
                    ticket_reference="—" if ticket is None else ticket.reference,
                    ticket_subject="Unknown ticket" if ticket is None else ticket.subject,
                    customer_display_name=(
                        "Unknown customer"
                        if ticket is None
                        else names.get(ticket.customer_profile_id, "Unknown customer")
                    ),
                    objective_count=len(payload.objectives),
                    mutation_count=len(payload.mutations),
                    context_document_count=len(payload.context_documents),
                    max_turns=payload.completion.max_turns,
                    updated_at=listing.updated_at,
                    latest_published_version=listing.latest_published_version,
                    published_version_count=listing.published_version_count,
                )
            )
        return tuple(summaries)

    def get_scenario(self, shop_id: UUID, scenario_id: UUID) -> ScenarioDraftRecord:
        return self._require_scenario(shop_id, scenario_id)

    def preview_scenario(self, shop_id: UUID, scenario_id: UUID) -> ScenarioPreview:
        """The publish gate and the resolved state publishing this draft would freeze."""
        record = self._require_scenario(shop_id, scenario_id)
        return ScenarioPreview(
            draft=self.preview_draft(scenario_id),
            resolution=self.resolve(shop_id, record.payload),
        )

    def list_scenario_versions(
        self, shop_id: UUID, scenario_id: UUID
    ) -> tuple[PublishedDefinitionVersion, ...]:
        self._require_scenario(shop_id, scenario_id)
        return self.list_versions(scenario_id)

    def get_scenario_version(
        self, shop_id: UUID, scenario_id: UUID, version: int
    ) -> ScenarioVersionRecord:
        self._require_scenario(shop_id, scenario_id)
        return self.get_version(scenario_id, version)

    def scenario_resources(self, shop_id: UUID, scenario_id: UUID) -> ScenarioResources:
        """Everything the editor's pickers may offer, filtered to what the gate accepts."""
        record = self._require_scenario(shop_id, scenario_id)
        shop = self._require_shop(shop_id)
        ticket = self._ticket_payload(shop_id, record.payload.ticket_id)
        customer_id = None if ticket is None else ticket.customer_profile_id
        names = self._customer_names()
        return ScenarioResources(
            documents=_document_options(shop),
            # Only this customer's orders: a picker offering somebody else's would be
            # offering a publish-gate error.
            orders=tuple(
                _order_option(order)
                for order in self._orders.list_for_shop(shop_id)
                if order.payload.customer_profile_id == customer_id
            ),
            product_handles=tuple(product.handle for product in shop.products),
            customers=tuple(
                ScenarioCustomerOption(
                    profile_id=customer_id,
                    display_name=names.get(customer_id, "Unknown customer"),
                )
                for customer_id in ((customer_id,) if customer_id is not None else ())
            ),
            objective_blocks=tuple(
                _block_option(
                    listing.definition_id,
                    listing.payload,
                    f"{listing.payload.assessment.value} · {listing.payload.evidence.value}",
                    listing.latest_published_version,
                )
                for listing in self._objective_blocks.list_definitions()
            ),
            mutation_blocks=tuple(
                _block_option(
                    listing.definition_id,
                    listing.payload,
                    listing.payload.effect.value,
                    listing.latest_published_version,
                )
                for listing in self._mutation_blocks.list_definitions()
            ),
        )

    def resolve(self, shop_id: UUID, payload: ScenarioPayload) -> ScenarioResolution:
        """Resolve every reference this scenario makes into what a publish would freeze."""
        shop = self._require_shop(shop_id)
        ticket = self._ticket_payload(shop_id, payload.ticket_id)
        customer_id = None if ticket is None else ticket.customer_profile_id
        titles = _document_titles(shop)
        orders = {order.order_id: order for order in self._orders.list_for_shop(shop_id)}
        # One listing, read twice below: the customer name and every bound customer entity
        # come from the same set of profiles.
        names = self._customer_names()
        return ScenarioResolution(
            shop_name=shop.identity.name,
            shop_version=self._latest_published(shop_definition_id(shop_id)),
            ticket_id=payload.ticket_id,
            ticket_reference="—" if ticket is None else ticket.reference,
            ticket_subject="Unknown ticket" if ticket is None else ticket.subject,
            ticket_version=self._latest_published(ticket_definition_id(payload.ticket_id)),
            customer_profile_id=customer_id,
            customer_display_name=(
                "Unknown customer"
                if customer_id is None
                else names.get(customer_id, "Unknown customer")
            ),
            customer_profile_version=(
                None
                if customer_id is None
                else self._latest_published(customer_profile_definition_id(customer_id))
            ),
            documents=tuple(
                ResolvedDocument(
                    kind=document.kind,
                    document_id=document.document_id,
                    title=titles.get(document.key),
                    resolved=document.key in titles,
                )
                for document in payload.context_documents
            ),
            entities=_resolved_entities(payload, shop, orders, names),
            templates=self._resolved_templates(payload),
            objective_count=len(payload.objectives),
            mutation_count=len(payload.mutations),
            max_turns=payload.completion.max_turns,
        )

    def _resolved_templates(self, payload: ScenarioPayload) -> tuple[ResolvedTemplate, ...]:
        objectives = self._objective_templates()
        mutations = self._mutation_templates()
        resolved: list[ResolvedTemplate] = []
        for block_id in payload.objective_block_ids:
            template = objectives.get(block_id)
            resolved.append(
                ResolvedTemplate(
                    block_id=block_id,
                    name="Unknown template" if template is None else template.name,
                    definition_type=DefinitionType.OBJECTIVE_BLOCK,
                    version=self._latest_published(objective_block_definition_id(block_id)),
                    instance_count=sum(
                        1 for objective in payload.objectives if objective.block_id == block_id
                    ),
                )
            )
        for block_id in payload.mutation_block_ids:
            template = mutations.get(block_id)
            resolved.append(
                ResolvedTemplate(
                    block_id=block_id,
                    name="Unknown template" if template is None else template.name,
                    definition_type=DefinitionType.MUTATION_BLOCK,
                    version=self._latest_published(mutation_block_definition_id(block_id)),
                    instance_count=sum(
                        1 for mutation in payload.mutations if mutation.block_id == block_id
                    ),
                )
            )
        return tuple(resolved)

    # -- writing ---------------------------------------------------------------

    def create_scenario(self, shop_id: UUID, name: str, ticket_id: UUID) -> ScenarioDraftRecord:
        """Create the scenario inside one shop, on one of that shop's tickets."""
        self._require_shop(shop_id)
        ticket = self._ticket_payload(shop_id, ticket_id)
        if ticket is None:
            raise ScenarioTicketNotInShopError(f"shop {shop_id} has no ticket {ticket_id}")
        self._require_free_name(shop_id, name, scenario_id=None)
        return self.create(
            new_scenario(
                name,
                ticket_id,
                tuple(
                    ContextDocument(kind=document.kind, document_id=document.document_id)
                    for document in ticket.suggested_documents
                ),
            ),
            shop=shop_definition_id(shop_id),
        )

    def replace_scenario(
        self, shop_id: UUID, scenario_id: UUID, payload: ScenarioPayload
    ) -> ScenarioDraftRecord:
        """Replace the whole draft, keeping the scenario on the ticket it was built on.

        The ticket is fixed the way a ticket's customer is: the context documents, the
        bindings, and the hidden facts are all about this incident, so rebuilding on another
        ticket would leave every one of them describing something else. Create a second
        scenario instead.
        """
        existing = self._require_scenario(shop_id, scenario_id)
        if payload.ticket_id != existing.payload.ticket_id:
            # Unreachable through the v1 contract, whose draft-write shape carries no ticket at
            # all, and deliberately kept: the rule belongs to the service, not to one wire
            # shape, and a later caller or a wider request model must still meet it.
            raise ScenarioTicketChangeError(
                "a scenario's ticket cannot be changed; its context, bindings, and hidden "
                "facts all describe the incident it was built on"
            )
        self._require_free_name(shop_id, payload.name, scenario_id=scenario_id)
        return self.replace_draft(scenario_id, payload)

    def publish_scenario(self, shop_id: UUID, scenario_id: UUID) -> ScenarioVersionRecord:
        """Freeze the draft, pinning the shop, ticket, and template versions it composed."""
        self._require_scenario(shop_id, scenario_id)
        return self.publish(scenario_id)

    # -- lookups ---------------------------------------------------------------

    def _require_scenario(self, shop_id: UUID, scenario_id: UUID) -> ScenarioDraftRecord:
        record = self._repository.get_draft(scenario_definition_id(scenario_id))
        # A scenario of another shop is not this shop's: answering 404 keeps one workspace
        # from confirming that an identifier exists elsewhere in the lab.
        if record is None or record.draft.shop != shop_definition_id(shop_id):
            self._require_shop(shop_id)
            raise ScenarioNotFoundError(f"shop {shop_id} has no scenario {scenario_id}")
        return record

    def _require_shop(self, shop_id: UUID) -> ShopPayload:
        record = self._shops.get_draft(shop_definition_id(shop_id))
        if record is None:
            raise ShopNotFoundError(f"shop {shop_id} has no draft")
        return record.payload

    def _ticket_payload(self, shop_id: UUID, ticket_id: UUID) -> TicketPayload | None:
        """This shop's ticket, or None when it belongs to another shop or is gone."""
        record = self._tickets.get_draft(ticket_definition_id(ticket_id))
        if record is None or record.draft.shop != shop_definition_id(shop_id):
            return None
        return record.payload

    def _customer_names(self) -> dict[UUID, str]:
        return {
            listing.definition_id: listing.payload.identity.display_name
            for listing in self._profiles.list_definitions()
        }

    def _require_free_name(self, shop_id: UUID, name: str, *, scenario_id: UUID | None) -> None:
        """Keep the name free among this shop's scenarios, so the index stays readable.

        Not an identity rule, like a block's name: an experiment binds a scenario by its ID
        and pins an exact version. Checked in the service, like a ticket's reference and with
        the same caveat about concurrent creations.
        """
        for listing in self._scenarios.list_in_shop(shop_id):
            if listing.payload.name == name and listing.definition_id != scenario_id:
                raise ScenarioNameExistsError(
                    f"another scenario in this shop is already called {name}"
                )


def _template(payload: BlockPayload, published: bool) -> BlockTemplate:
    return BlockTemplate(name=payload.name, parameters=payload.parameters, published=published)


def _block_option(
    block_id: UUID, payload: BlockPayload, type_label: str, latest_published_version: int | None
) -> ScenarioBlockOption:
    return ScenarioBlockOption(
        block_id=block_id,
        name=payload.name,
        statement=payload.statement,
        description=payload.description,
        type_label=type_label,
        latest_published_version=latest_published_version,
        parameters=payload.parameters,
    )


def _document_ids(shop: ShopPayload) -> dict[ShopDocumentKind, frozenset[str]]:
    return {
        ShopDocumentKind.POLICY: frozenset(policy.id for policy in shop.policies),
        ShopDocumentKind.SUPPORT_GUIDELINE: frozenset(
            guideline.id for guideline in shop.support_guidelines
        ),
        ShopDocumentKind.FAQ_ENTRY: frozenset(entry.id for entry in shop.faq),
    }


def _document_options(shop: ShopPayload) -> tuple[ScenarioDocumentOption, ...]:
    return (
        *(
            ScenarioDocumentOption(
                kind=ShopDocumentKind.POLICY, document_id=policy.id, title=policy.title
            )
            for policy in shop.policies
        ),
        *(
            ScenarioDocumentOption(
                kind=ShopDocumentKind.SUPPORT_GUIDELINE,
                document_id=guideline.id,
                title=guideline.title,
            )
            for guideline in shop.support_guidelines
        ),
        *(
            ScenarioDocumentOption(
                kind=ShopDocumentKind.FAQ_ENTRY, document_id=entry.id, title=entry.question
            )
            for entry in shop.faq
        ),
    )


def _document_titles(shop: ShopPayload) -> dict[str, str]:
    return {
        f"{option.kind.value}:{option.document_id}": option.title
        for option in _document_options(shop)
    }


def _order_option(record: OrderFixtureRecord) -> ScenarioOrderOption:
    address = record.payload.shipping_address
    return ScenarioOrderOption(
        order_id=record.order_id,
        reference=record.payload.reference,
        payment_status=record.payload.payment.status,
        fulfilment_status=record.payload.fulfilment.status,
        total_amount=record.payload.total.canonical_amount,
        currency=record.payload.currency,
        shipping_label=None if address is None else address.source_label,
    )


def _resolved_entities(
    payload: ScenarioPayload,
    shop: ShopPayload,
    orders: dict[UUID, OrderFixtureRecord],
    customer_names: dict[UUID, str],
) -> tuple[ResolvedEntity, ...]:
    """Every shop object the bindings point at, deduplicated and resolved once each.

    Read from the binding values rather than from a stored list: the bindings are where the
    scenario actually names an object, and a second list would drift from them.
    """
    handles = frozenset(product.handle for product in shop.products)
    seen: dict[str, ResolvedEntity] = {}
    for bindings in (
        *(objective.bindings for objective in payload.objectives),
        *(mutation.bindings for mutation in payload.mutations),
    ):
        for binding in bindings:
            entity = parse_entity_reference(binding.value)
            if entity is None:
                data = parse_data_reference(binding.value)
                entity = None if data is None else data.entity
            if entity is None or entity.value in seen:
                continue
            seen[entity.value] = _resolved_entity(entity, orders, customer_names, handles)
    return tuple(seen.values())


def _resolved_entity(
    entity: EntityReference,
    orders: dict[UUID, OrderFixtureRecord],
    customer_names: dict[UUID, str],
    handles: frozenset[str],
) -> ResolvedEntity:
    kind = entity.kind
    identifier = entity.identifier
    entity_id = entity.entity_id
    if kind is ScenarioEntityKind.PRODUCT:
        return ResolvedEntity(
            kind=kind,
            identifier=identifier,
            label=identifier,
            detail=None,
            resolved=identifier in handles,
        )
    if entity_id is None:  # pragma: no cover - only a product reference has no ID
        return ResolvedEntity(
            kind=kind, identifier=identifier, label=None, detail=None, resolved=False
        )
    if kind is ScenarioEntityKind.ORDER:
        order = orders.get(entity_id)
        return ResolvedEntity(
            kind=kind,
            identifier=identifier,
            label=None if order is None else order.payload.reference,
            detail=(
                None
                if order is None
                else f"{order.payload.payment.status.value} · "
                f"{order.payload.fulfilment.status.value}"
            ),
            resolved=order is not None,
        )
    name = customer_names.get(entity_id)
    return ResolvedEntity(
        kind=kind, identifier=identifier, label=name, detail=None, resolved=name is not None
    )
