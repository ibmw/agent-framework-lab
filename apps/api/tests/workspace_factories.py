"""Service-level workspace builders shared by the suites that need a seeded shop.

A ticket suite, a scenario suite, a snapshot suite, and anything after them all need the same
starting point: a shop with a catalog, one attached customer with an address book, a paid
order shipping to the stale address, and the published recipe built on top of them. They share
it through this module rather than by importing one another, so no suite depends on another
suite's internals.
"""

from dataclasses import dataclass, replace
from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy.orm import Session

from block_factories import publishable_mutation, publishable_objective
from capability_lab.application.blocks import MutationBlockService, ObjectiveBlockService
from capability_lab.application.customer_profiles import CustomerProfileService
from capability_lab.application.order_fixtures import (
    OrderEdit,
    OrderEventDraft,
    OrderFixtureService,
    OrderLineSelection,
)
from capability_lab.application.scenarios import ScenarioService
from capability_lab.application.shops import ShopService
from capability_lab.application.tickets import TicketService
from capability_lab.domain.blocks import ObjectiveSeverity
from capability_lab.domain.customer_profile import CustomerProfilePayload
from capability_lab.domain.order_fixture import FulfilmentStatus, PaymentStatus
from capability_lab.domain.scenario import (
    BoundMutation,
    BoundObjective,
    CompletionConditions,
    ContextDocument,
    ScenarioBinding,
    ScenarioPayload,
)
from capability_lab.domain.shop import ShopDocumentKind, SupportChannel
from capability_lab.domain.ticket import SuggestedDocument
from capability_lab.infrastructure.repositories import (
    SqlAlchemyDefinitionShopAttachmentRepository,
    SqlAlchemyOrderFixtureRepository,
    SqlAlchemyPublishedVersionDirectory,
    SqlAlchemyShopDirectory,
    customer_profile_repository,
    mutation_block_repository,
    objective_block_repository,
    scenario_repository,
    shop_repository,
    ticket_repository,
)
from definition_factories import address, customer_identity, publishable_profile
from shop_factories import identity, publishable_shop
from ticket_factories import message

POLICY_REFERENCE = "policy:shipping"
GUIDELINE_REFERENCE = "support_guideline:escalation"

PLACED_AT = "2026-08-20T14:55:00.000000Z"
CAPTURED_AT = "2026-08-21T13:12:00.000000Z"


@dataclass(slots=True)
class AdvancingClock:
    value: datetime = datetime(2026, 8, 24, 12, 0, tzinfo=UTC)

    def now(self) -> datetime:
        self.value += timedelta(seconds=1)
        return self.value


def build_profiles(session: Session) -> CustomerProfileService:
    return CustomerProfileService(
        customer_profile_repository(session),
        SqlAlchemyDefinitionShopAttachmentRepository(session),
        SqlAlchemyShopDirectory(session),
        AdvancingClock(),
    )


def build_orders(session: Session) -> OrderFixtureService:
    return OrderFixtureService(
        SqlAlchemyOrderFixtureRepository(session),
        shop_repository(session),
        customer_profile_repository(session),
        SqlAlchemyDefinitionShopAttachmentRepository(session),
        AdvancingClock(),
    )


def build_tickets(session: Session) -> TicketService:
    return TicketService(
        ticket_repository(session),
        shop_repository(session),
        customer_profile_repository(session),
        SqlAlchemyOrderFixtureRepository(session),
        SqlAlchemyDefinitionShopAttachmentRepository(session),
        SqlAlchemyPublishedVersionDirectory(session),
        AdvancingClock(),
    )


def profile_with_two_addresses() -> CustomerProfilePayload:
    return publishable_profile(
        addresses=(
            address(),
            address(
                "bordeaux-previous-flat",
                label="Bordeaux — previous flat",
                is_default=False,
                city="Bordeaux",
            ),
        )
    )


def seed_order(
    orders: OrderFixtureService,
    shop_id: UUID,
    customer_id: UUID,
    reference: str = "NS-10482",
) -> UUID:
    """The paid, unfulfilled order shipping to the stale address."""
    order_id = orders.create_order(shop_id, reference, customer_id, PLACED_AT).order_id
    orders.replace_order(
        shop_id,
        order_id,
        OrderEdit(
            reference=reference,
            placed_at=PLACED_AT,
            lines=(OrderLineSelection(sku="NS-ASJ-OB-M", quantity=1),),
            payment_status=PaymentStatus.PAID,
            payment_method_id="visa",
            paid_at=CAPTURED_AT,
            fulfilment_status=FulfilmentStatus.UNFULFILLED,
            fulfilment_method_id="standard",
            shipped_at=None,
            shipping_fee_amount="0.00",
            shipping_address_id="bordeaux-previous-flat",
            events=(
                OrderEventDraft(
                    id="order-created",
                    kind="placed",
                    occurred_at=PLACED_AT,
                    summary="Order created — checkout, order page",
                ),
                OrderEventDraft(
                    id="payment-captured",
                    kind="payment_captured",
                    occurred_at=CAPTURED_AT,
                    summary="Payment captured — order marked paid",
                ),
            ),
        ),
    )
    return order_id


@dataclass(frozen=True, slots=True)
class Workspace:
    """A publishable shop, customer, order, ticket, and one template in each library."""

    scenarios: ScenarioService
    shops: ShopService
    profiles: CustomerProfileService
    tickets: TicketService
    objectives: ObjectiveBlockService
    mutations: MutationBlockService
    shop_id: UUID
    customer_id: UUID
    order_id: UUID
    ticket_id: UUID
    read_block_id: UUID
    mutation_block_id: UUID


def build_scenarios(session: Session) -> ScenarioService:
    return ScenarioService(
        scenario_repository(session),
        shop_repository(session),
        ticket_repository(session),
        customer_profile_repository(session),
        SqlAlchemyOrderFixtureRepository(session),
        objective_block_repository(session),
        mutation_block_repository(session),
        SqlAlchemyDefinitionShopAttachmentRepository(session),
        SqlAlchemyPublishedVersionDirectory(session),
        AdvancingClock(),
    )


def seed_workspace(session: Session) -> Workspace:
    shops = ShopService(shop_repository(session), AdvancingClock())
    shop_id = shops.create_shop(identity()).definition.id
    shops.replace_draft(shop_id, publishable_shop())

    profiles = build_profiles(session)
    profile = profiles.create_profile(customer_identity(), "2024-03-14", shop_id=shop_id)
    customer_id = profile.definition.id
    profiles.replace_draft(customer_id, profile_with_two_addresses())

    order_id = seed_order(build_orders(session), shop_id, customer_id)

    tickets = build_tickets(session)
    ticket = tickets.create_ticket(
        shop_id, "T-204", "Wrong address concern", customer_id, SupportChannel.CHAT
    )
    ticket_id = ticket.definition.id
    tickets.replace_ticket(
        shop_id,
        ticket_id,
        replace(
            ticket.payload,
            trigger=message(),
            linked_order_ids=(order_id,),
            # The documents a scenario built on this ticket should start from.
            suggested_documents=(
                SuggestedDocument(kind=ShopDocumentKind.POLICY, document_id="shipping"),
                SuggestedDocument(
                    kind=ShopDocumentKind.SUPPORT_GUIDELINE, document_id="escalation"
                ),
            ),
        ),
    )

    objectives = ObjectiveBlockService(objective_block_repository(session), AdvancingClock())
    read_block = objectives.create_block("read-required-document")
    objectives.replace_block(read_block.definition.id, publishable_objective())

    mutations = MutationBlockService(mutation_block_repository(session), AdvancingClock())
    mutation_block = mutations.create_block("concurrent-entity-mutation")
    mutations.replace_block(mutation_block.definition.id, publishable_mutation())

    return Workspace(
        scenarios=build_scenarios(session),
        shops=shops,
        profiles=profiles,
        tickets=tickets,
        objectives=objectives,
        mutations=mutations,
        shop_id=shop_id,
        customer_id=customer_id,
        order_id=order_id,
        ticket_id=ticket_id,
        read_block_id=read_block.definition.id,
        mutation_block_id=mutation_block.definition.id,
    )


def read_check(
    workspace: Workspace,
    objective_id: str = "read-shipping-policy",
    document: str = POLICY_REFERENCE,
    severity: ObjectiveSeverity = ObjectiveSeverity.REQUIRED,
) -> BoundObjective:
    return BoundObjective(
        id=objective_id,
        block_id=workspace.read_block_id,
        severity=severity,
        bindings=(ScenarioBinding(parameter="doc_ref", value=document),),
    )


def concurrent_mutation(workspace: Workspace) -> BoundMutation:
    return BoundMutation(
        id="order-moves-under-the-arm",
        block_id=workspace.mutation_block_id,
        bindings=(
            ScenarioBinding(parameter="entity_ref", value=f"order:{workspace.order_id}"),
            ScenarioBinding(parameter="timing", value="after_first_read"),
        ),
    )


def publishable_payload(workspace: Workspace, **overrides: object) -> ScenarioPayload:
    """The wrong-address recipe, bound to this workspace's real shop objects."""
    fields: dict[str, object] = {
        "name": "Wrong shipping address",
        "ticket_id": workspace.ticket_id,
        "context_documents": (
            ContextDocument(kind=ShopDocumentKind.POLICY, document_id="shipping"),
        ),
        "objectives": (read_check(workspace),),
        "mutations": (),
        "hidden_facts": "Maya confirms the Lyon address only if asked.",
        "completion": CompletionConditions(
            statement="The order ships to the confirmed address.", max_turns=12
        ),
    }
    fields.update(overrides)
    return ScenarioPayload(**fields)  # type: ignore[arg-type]


def publish_prerequisites(workspace: Workspace) -> None:
    """Everything a scenario publication has to pin, published in dependency order."""
    workspace.shops.publish(workspace.shop_id)
    workspace.profiles.publish(workspace.customer_id)
    workspace.tickets.publish_ticket(workspace.shop_id, workspace.ticket_id)
    workspace.objectives.publish(workspace.read_block_id)
    workspace.mutations.publish(workspace.mutation_block_id)


def author(workspace: Workspace, **overrides: object) -> UUID:
    """Create the scenario and put a publishable draft on it."""
    created = workspace.scenarios.create_scenario(
        workspace.shop_id, "Wrong shipping address", workspace.ticket_id
    )
    scenario_id = created.definition.id
    workspace.scenarios.replace_scenario(
        workspace.shop_id, scenario_id, publishable_payload(workspace, **overrides)
    )
    return scenario_id
