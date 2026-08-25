"""Service-level workspace builders shared by the suites that need a seeded shop.

A ticket suite, a scenario suite, and anything after them all need the same starting point: a
shop with a catalog, one attached customer with an address book, and a paid order shipping to
the stale address. They share it through this module rather than by importing one another, so
no suite depends on another suite's internals.
"""

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy.orm import Session

from capability_lab.application.customer_profiles import CustomerProfileService
from capability_lab.application.order_fixtures import (
    OrderEdit,
    OrderEventDraft,
    OrderFixtureService,
    OrderLineSelection,
)
from capability_lab.application.tickets import TicketService
from capability_lab.domain.customer_profile import CustomerProfilePayload
from capability_lab.domain.order_fixture import FulfilmentStatus, PaymentStatus
from capability_lab.infrastructure.repositories import (
    SqlAlchemyDefinitionShopAttachmentRepository,
    SqlAlchemyOrderFixtureRepository,
    SqlAlchemyPublishedVersionDirectory,
    SqlAlchemyShopDirectory,
    customer_profile_repository,
    shop_repository,
    ticket_repository,
)
from definition_factories import address, publishable_profile

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
