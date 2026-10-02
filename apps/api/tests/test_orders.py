"""Order-fixture authoring: selection, materialization, and what stays frozen."""

from collections.abc import Generator
from dataclasses import dataclass, replace
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import UUID, uuid4

import pytest
from sqlalchemy.orm import Session

from capability_lab.application.customer_profiles import (
    CustomerProfileNotFoundError,
    CustomerProfileService,
)
from capability_lab.application.order_fixtures import (
    OrderEdit,
    OrderEventDraft,
    OrderFixtureNotFoundError,
    OrderFixtureService,
    OrderLineSelection,
    OrderReferenceExistsError,
    OrderSelectionError,
)
from capability_lab.application.shops import ShopNotFoundError, ShopService
from capability_lab.domain.customer_profile import CustomerProfilePayload
from capability_lab.domain.order_fixture import (
    FulfilmentStatus,
    OrderTransitionError,
    PaymentStatus,
)
from capability_lab.infrastructure.database import (
    Base,
    create_database_engine,
    create_session_factory,
    session_scope,
)
from capability_lab.infrastructure.repositories import (
    SqlAlchemyDefinitionShopAttachmentRepository,
    SqlAlchemyOrderFixtureRepository,
    SqlAlchemyShopDirectory,
    SqlAlchemyShopMediaRepository,
    customer_profile_repository,
    shop_repository,
)
from definition_factories import address, customer_identity, publishable_profile
from shop_factories import identity, saved_shop

PLACED_AT = "2026-08-20T14:55:00.000000Z"
CAPTURED_AT = "2026-08-21T13:12:00.000000Z"


@dataclass(slots=True)
class AdvancingClock:
    value: datetime = datetime(2026, 8, 24, 12, 0, tzinfo=UTC)

    def now(self) -> datetime:
        self.value += timedelta(seconds=1)
        return self.value


@pytest.fixture
def session(tmp_path: Path) -> Generator[Session, None, None]:
    engine = create_database_engine(f"sqlite:///{tmp_path / 'orders.db'}")
    Base.metadata.create_all(engine)
    with session_scope(create_session_factory(engine)) as active:
        yield active


@dataclass(frozen=True, slots=True)
class Workspace:
    """A shop with a catalog, one attached customer, and the order service under test."""

    orders: OrderFixtureService
    profiles: CustomerProfileService
    shop_id: UUID
    customer_id: UUID


def build_orders(session: Session) -> OrderFixtureService:
    return OrderFixtureService(
        SqlAlchemyOrderFixtureRepository(session),
        shop_repository(session),
        customer_profile_repository(session),
        SqlAlchemyDefinitionShopAttachmentRepository(session),
        AdvancingClock(),
    )


def build_profiles(session: Session) -> CustomerProfileService:
    return CustomerProfileService(
        customer_profile_repository(session),
        SqlAlchemyDefinitionShopAttachmentRepository(session),
        SqlAlchemyShopDirectory(session),
        AdvancingClock(),
    )


def profile_with_two_addresses() -> CustomerProfilePayload:
    """Lyon is the default; Bordeaux is the stale entry the scenario exploits."""
    return publishable_profile(
        addresses=(
            address(),
            address(
                "bordeaux-previous-flat",
                label="Bordeaux — previous flat",
                is_default=False,
                line1="42 cours de la Marne",
                postal_code="33800",
                city="Bordeaux",
            ),
        )
    )


def seed_workspace(session: Session) -> tuple[UUID, UUID]:
    """A shop with a catalog plus one attached customer, for tests owning their own engine."""
    shops = ShopService(
        shop_repository(session), AdvancingClock(), SqlAlchemyShopMediaRepository(session)
    )
    shop_id = shops.create_shop(identity()).definition.id
    shops.replace_draft(shop_id, saved_shop())
    profiles = build_profiles(session)
    profile = profiles.create_profile(customer_identity(), "2024-03-14", shop_id=shop_id)
    profiles.replace_draft(profile.definition.id, profile_with_two_addresses())
    return shop_id, profile.definition.id


@pytest.fixture
def workspace(session: Session) -> Workspace:
    shop_id, customer_id = seed_workspace(session)
    return Workspace(
        orders=build_orders(session),
        profiles=build_profiles(session),
        shop_id=shop_id,
        customer_id=customer_id,
    )


def create_order(workspace: Workspace, reference: str = "NS-10482") -> UUID:
    return workspace.orders.create_order(
        workspace.shop_id, reference, workspace.customer_id, PLACED_AT
    ).order_id


def paid_edit(**overrides: object) -> OrderEdit:
    """The wrong-address fixture: paid, unfulfilled, shipping to the stale Bordeaux flat."""
    fields: dict[str, object] = {
        "reference": "NS-10482",
        "placed_at": PLACED_AT,
        "lines": (OrderLineSelection(sku="NS-ASJ-OB-M", quantity=1),),
        "payment_status": PaymentStatus.PAID,
        "payment_method_id": "visa",
        "paid_at": CAPTURED_AT,
        "fulfilment_status": FulfilmentStatus.UNFULFILLED,
        "fulfilment_method_id": "standard",
        "shipped_at": None,
        "shipping_fee_amount": "0.00",
        "shipping_address_id": "bordeaux-previous-flat",
        "events": (
            OrderEventDraft(
                id="payment-captured",
                kind="payment_captured",
                occurred_at=CAPTURED_AT,
                summary="Payment captured — order marked paid",
            ),
            OrderEventDraft(
                id="order-created",
                kind="placed",
                occurred_at=PLACED_AT,
                summary="Order created — checkout, order page",
            ),
        ),
    }
    fields.update(overrides)
    return OrderEdit(**fields)  # type: ignore[arg-type]


def test_a_new_order_starts_empty_with_the_shop_currency(workspace: Workspace) -> None:
    record = workspace.orders.create_order(
        workspace.shop_id, "NS-10482", workspace.customer_id, PLACED_AT
    )

    assert record.payload.lines == ()
    assert record.payload.shipping_address is None
    assert record.payload.payment.status is PaymentStatus.PENDING
    assert record.payload.currency.value == "EUR"
    assert not workspace.orders.validate_order(workspace.shop_id, record.payload).publishable


def test_an_order_can_only_be_created_for_a_customer_attached_to_the_shop(
    workspace: Workspace,
) -> None:
    elsewhere = workspace.profiles.create_profile(customer_identity(), "2024-03-14")

    with pytest.raises(OrderSelectionError, match="is not attached to shop"):
        workspace.orders.create_order(
            workspace.shop_id, "NS-10483", elsewhere.definition.id, PLACED_AT
        )
    with pytest.raises(CustomerProfileNotFoundError):
        workspace.orders.create_order(workspace.shop_id, "NS-10484", uuid4(), PLACED_AT)


def test_a_reference_names_one_order_inside_a_shop(workspace: Workspace) -> None:
    create_order(workspace)

    with pytest.raises(OrderReferenceExistsError):
        create_order(workspace)

    other = create_order(workspace, "NS-10479")
    with pytest.raises(OrderReferenceExistsError):
        workspace.orders.replace_order(workspace.shop_id, other, paid_edit(reference="NS-10482"))
    # Keeping its own reference is not a collision with itself.
    workspace.orders.replace_order(workspace.shop_id, other, paid_edit(reference="NS-10479"))


def test_lines_are_materialized_from_the_catalog_and_totals_are_derived(
    workspace: Workspace,
) -> None:
    order_id = create_order(workspace)

    record = workspace.orders.replace_order(
        workspace.shop_id,
        order_id,
        paid_edit(lines=(OrderLineSelection(sku="NS-ASJ-OB-M", quantity=2),)),
    )

    line = record.payload.lines[0]
    assert line.title == "Alpine Shell Jacket"
    assert line.variant_summary == "Ocean Blue · M"
    assert line.unit_price.canonical_amount == "249.00"
    assert record.payload.subtotal.canonical_amount == "498.00"
    assert record.payload.total.canonical_amount == "498.00"


def test_a_variant_outside_the_catalog_is_refused_rather_than_stored(
    workspace: Workspace,
) -> None:
    order_id = create_order(workspace)

    with pytest.raises(OrderSelectionError, match="is not in this shop's catalog"):
        workspace.orders.replace_order(
            workspace.shop_id,
            order_id,
            paid_edit(lines=(OrderLineSelection(sku="NS-GHOST", quantity=1),)),
        )


def test_a_method_the_shop_does_not_offer_is_refused(workspace: Workspace) -> None:
    order_id = create_order(workspace)

    with pytest.raises(OrderSelectionError, match="payment method wire is not configured"):
        workspace.orders.replace_order(
            workspace.shop_id, order_id, paid_edit(payment_method_id="wire")
        )


def test_the_shipping_address_is_a_frozen_labeled_copy_of_an_address_book_entry(
    workspace: Workspace,
) -> None:
    order_id = create_order(workspace)

    record = workspace.orders.replace_order(workspace.shop_id, order_id, paid_edit())

    frozen = record.payload.shipping_address
    assert frozen is not None
    assert frozen.source_address_id == "bordeaux-previous-flat"
    assert frozen.source_label == "Bordeaux — previous flat"
    assert frozen.city == "Bordeaux"
    assert frozen.selected_at.endswith("Z")


def test_an_address_outside_the_customer_address_book_is_refused(
    workspace: Workspace,
) -> None:
    order_id = create_order(workspace)

    with pytest.raises(OrderSelectionError, match="is not in this customer's address book"):
        workspace.orders.replace_order(
            workspace.shop_id, order_id, paid_edit(shipping_address_id="warehouse")
        )


def test_editing_the_address_book_never_rewrites_an_existing_order(
    workspace: Workspace,
) -> None:
    """The order ships to the copy it froze; reselecting is the only way to move it."""
    order_id = create_order(workspace)
    workspace.orders.replace_order(workspace.shop_id, order_id, paid_edit())

    workspace.profiles.replace_draft(
        workspace.customer_id,
        publishable_profile(
            addresses=(
                address(),
                address(
                    "bordeaux-previous-flat",
                    label="Bordeaux — sold",
                    is_default=False,
                    line1="1 rue Inconnue",
                    postal_code="33000",
                    city="Bordeaux",
                ),
            )
        ),
    )

    # Saving the order again with the same selection keeps the original frozen copy.
    record = workspace.orders.replace_order(workspace.shop_id, order_id, paid_edit())
    frozen = record.payload.shipping_address
    assert frozen is not None
    assert frozen.line1 == "42 cours de la Marne"
    assert frozen.source_label == "Bordeaux — previous flat"


def test_reselecting_another_entry_freezes_a_new_copy(workspace: Workspace) -> None:
    order_id = create_order(workspace)
    workspace.orders.replace_order(workspace.shop_id, order_id, paid_edit())

    record = workspace.orders.replace_order(
        workspace.shop_id, order_id, paid_edit(shipping_address_id="home")
    )

    frozen = record.payload.shipping_address
    assert frozen is not None
    assert frozen.source_label == "Home"
    assert frozen.city == "Lyon"


def test_a_repriced_variant_never_changes_an_order_that_already_holds_it(
    workspace: Workspace, session: Session
) -> None:
    order_id = create_order(workspace)
    workspace.orders.replace_order(workspace.shop_id, order_id, paid_edit())

    shops = ShopService(
        shop_repository(session), AdvancingClock(), SqlAlchemyShopMediaRepository(session)
    )
    catalog = saved_shop()
    product = catalog.products[0]
    variant = product.variants[0]
    from decimal import Decimal

    from capability_lab.domain.shop import Currency, Money

    shops.replace_draft(
        workspace.shop_id,
        replace(
            catalog,
            products=(
                replace(
                    product,
                    variants=(
                        replace(
                            variant,
                            price=Money(amount=Decimal("199.00"), currency=Currency.EUR),
                        ),
                    ),
                ),
            ),
        ),
    )

    record = workspace.orders.replace_order(workspace.shop_id, order_id, paid_edit())
    assert record.payload.lines[0].unit_price.canonical_amount == "249.00"

    validation = workspace.orders.validate_order(workspace.shop_id, record.payload)
    assert {issue.code for issue in validation.warnings} == {"line_price_differs_from_catalog"}


def test_the_storage_boundary_is_the_last_word_on_a_reference(tmp_path: Path) -> None:
    """The service checks first, but a lost race must not create a second NS-10482.

    Its own engine: the refused insert poisons the transaction it happened in, exactly as it
    would in the losing request.
    """
    engine = create_database_engine(f"sqlite:///{tmp_path / 'reference.db'}")
    Base.metadata.create_all(engine)
    factory = create_session_factory(engine)
    with session_scope(factory) as writing:
        shop_id, customer_id = seed_workspace(writing)
        orders = build_orders(writing)
        order_id = orders.create_order(shop_id, "NS-10482", customer_id, PLACED_AT).order_id
        taken = SqlAlchemyOrderFixtureRepository(writing).get(shop_id, order_id)
        assert taken is not None

    with pytest.raises(OrderReferenceExistsError), session_scope(factory) as racing:
        SqlAlchemyOrderFixtureRepository(racing).save(replace(taken, order_id=uuid4()))


def test_a_variant_that_only_lost_its_price_keeps_the_order_intact(
    workspace: Workspace, session: Session
) -> None:
    order_id = create_order(workspace)
    workspace.orders.replace_order(workspace.shop_id, order_id, paid_edit())

    shops = ShopService(
        shop_repository(session), AdvancingClock(), SqlAlchemyShopMediaRepository(session)
    )
    catalog = saved_shop()
    product = catalog.products[0]
    shops.replace_draft(
        workspace.shop_id,
        replace(
            catalog,
            products=(
                replace(
                    product,
                    variants=(replace(product.variants[0], price=None),),
                ),
            ),
        ),
    )

    record = workspace.orders.get_order(workspace.shop_id, order_id)
    validation = workspace.orders.validate_order(workspace.shop_id, record.payload)

    assert {issue.code for issue in validation.issues} == {"line_variant_without_price"}
    assert validation.publishable
    assert record.payload.lines[0].unit_price.canonical_amount == "249.00"


def test_a_status_cannot_move_backwards(workspace: Workspace) -> None:
    order_id = create_order(workspace)
    workspace.orders.replace_order(
        workspace.shop_id,
        order_id,
        paid_edit(
            fulfilment_status=FulfilmentStatus.FULFILLED,
            shipped_at="2026-08-22T08:00:00.000000Z",
        ),
    )

    with pytest.raises(OrderTransitionError, match="cannot move from fulfilled to unfulfilled"):
        workspace.orders.replace_order(workspace.shop_id, order_id, paid_edit())


def test_events_are_stored_chronologically_whatever_order_they_arrive_in(
    workspace: Workspace,
) -> None:
    order_id = create_order(workspace)

    record = workspace.orders.replace_order(workspace.shop_id, order_id, paid_edit())

    assert [event.id for event in record.payload.events] == [
        "order-created",
        "payment-captured",
    ]


def test_an_order_survives_a_new_session_and_lists_with_its_customer(
    tmp_path: Path,
) -> None:
    engine = create_database_engine(f"sqlite:///{tmp_path / 'durable.db'}")
    Base.metadata.create_all(engine)
    factory = create_session_factory(engine)

    with session_scope(factory) as writing:
        shop_id, customer_id = seed_workspace(writing)
        orders = build_orders(writing)
        order_id = orders.create_order(shop_id, "NS-10482", customer_id, PLACED_AT).order_id
        orders.replace_order(shop_id, order_id, paid_edit())

    with session_scope(factory) as reading:
        orders = build_orders(reading)
        summaries = orders.list_orders(shop_id)
        assert len(summaries) == 1
        assert summaries[0].reference == "NS-10482"
        assert summaries[0].customer_display_name == "Maya Laurent"
        assert summaries[0].total_amount == "249.00"
        assert summaries[0].payment_status is PaymentStatus.PAID

        stored = orders.get_order(shop_id, order_id)
        assert stored.payload.shipping_address is not None
        assert stored.payload.shipping_address.city == "Bordeaux"
        assert orders.validate_order(shop_id, stored.payload).issues == ()


def test_deleting_an_order_removes_only_that_order(workspace: Workspace) -> None:
    kept = create_order(workspace, "NS-10479")
    removed = create_order(workspace, "NS-10482")

    workspace.orders.delete_order(workspace.shop_id, removed)

    assert [summary.order_id for summary in workspace.orders.list_orders(workspace.shop_id)] == [
        kept
    ]
    with pytest.raises(OrderFixtureNotFoundError):
        workspace.orders.get_order(workspace.shop_id, removed)
    with pytest.raises(OrderFixtureNotFoundError):
        workspace.orders.delete_order(workspace.shop_id, removed)


def test_an_unknown_shop_is_named_before_an_unknown_order(workspace: Workspace) -> None:
    with pytest.raises(ShopNotFoundError):
        workspace.orders.get_order(uuid4(), uuid4())
    with pytest.raises(ShopNotFoundError):
        workspace.orders.list_orders(uuid4())
    with pytest.raises(OrderFixtureNotFoundError):
        workspace.orders.get_order(workspace.shop_id, uuid4())


def test_orders_are_scoped_to_their_shop(session: Session, workspace: Workspace) -> None:
    create_order(workspace)
    shops = ShopService(
        shop_repository(session), AdvancingClock(), SqlAlchemyShopMediaRepository(session)
    )
    other_shop = shops.create_shop(identity(slug="aurora", name="Aurora Supply")).definition.id

    assert workspace.orders.list_orders(other_shop) == ()
    with pytest.raises(OrderFixtureNotFoundError):
        workspace.orders.get_order(
            other_shop, workspace.orders.list_orders(workspace.shop_id)[0].order_id
        )
