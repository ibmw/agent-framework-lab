from datetime import UTC, datetime
from decimal import Decimal
from typing import cast
from uuid import UUID, uuid4

import pytest

from capability_lab.domain.entities import (
    Customer,
    DomainError,
    MemoryRecord,
    Order,
    OrderActionRefusedError,
    OrderStatus,
    Product,
    StaleOrderVersionError,
)


def test_product_rejects_negative_price() -> None:
    with pytest.raises(DomainError, match="cannot be negative"):
        Product(
            id=uuid4(),
            sku="LAB-001",
            name="Test product",
            price_amount=Decimal("-0.01"),
            currency="EUR",
        )


@pytest.mark.parametrize(
    ("price", "message"),
    [
        (Decimal("NaN"), "finite"),
        (Decimal("1.001"), "fractional digits"),
        (cast(Decimal, 1.5), "decimal value"),
    ],
)
def test_product_requires_canonical_decimal_money(price: Decimal, message: str) -> None:
    with pytest.raises(DomainError, match=message):
        Product(
            id=uuid4(),
            sku="LAB-001",
            name="Test product",
            price_amount=price,
            currency="EUR",
        )


@pytest.mark.parametrize("price", [Decimal("1E+30"), Decimal("1E+400")])
def test_product_accepts_large_finite_amount_without_decimal_context_error(
    price: Decimal,
) -> None:
    product = Product(
        id=uuid4(),
        sku="LAB-001",
        name="Test product",
        price_amount=price,
        currency="EUR",
    )

    assert product.price_amount == price


def test_product_rejects_subcent_amount_at_tiny_exponent() -> None:
    with pytest.raises(DomainError, match="fractional digits"):
        Product(
            id=uuid4(),
            sku="LAB-001",
            name="Test product",
            price_amount=Decimal("1E-400"),
            currency="EUR",
        )


def test_product_requires_uuid_identifier() -> None:
    with pytest.raises(DomainError, match="product ID must be a UUID"):
        Product(
            id=cast(UUID, "not-a-uuid"),
            sku="LAB-001",
            name="Test product",
            price_amount=Decimal("1.00"),
            currency="EUR",
        )


@pytest.mark.parametrize(
    ("sku", "name", "currency", "message"),
    [
        (" ", "Test product", "EUR", "SKU"),
        ("LAB-001", " ", "EUR", "name"),
        ("LAB-001", "Test product", "eur", "uppercase ISO 4217"),
    ],
)
def test_product_requires_canonical_catalog_fields(
    sku: str,
    name: str,
    currency: str,
    message: str,
) -> None:
    with pytest.raises(DomainError, match=message):
        Product(
            id=uuid4(),
            sku=sku,
            name=name,
            price_amount=Decimal("1.00"),
            currency=currency,
        )


@pytest.mark.parametrize("version", [0, True, cast(int, 1.5)])
def test_order_requires_a_positive_integer_version(version: int) -> None:
    with pytest.raises(DomainError, match="positive integer"):
        Order(
            id=uuid4(),
            customer_id=uuid4(),
            created_at=datetime(2026, 8, 16, tzinfo=UTC),
            version=version,
        )


def test_order_rejects_unsupported_status() -> None:
    with pytest.raises(DomainError, match="supported status"):
        Order(
            id=uuid4(),
            customer_id=uuid4(),
            created_at=datetime(2026, 8, 16, tzinfo=UTC),
            status=cast(OrderStatus, "shipped"),
        )


def test_paid_order_cancellation_is_versioned_and_rejects_stale_or_repeated_actions() -> None:
    paid = Order(
        id=uuid4(),
        customer_id=uuid4(),
        created_at=datetime(2026, 8, 16, tzinfo=UTC),
        status=OrderStatus.PAID,
        version=3,
    )

    cancelled = paid.cancel(expected_version=3)

    assert cancelled.status is OrderStatus.CANCELLED
    assert cancelled.version == 4
    assert paid.status is OrderStatus.PAID
    with pytest.raises(StaleOrderVersionError, match="stale"):
        paid.cancel(expected_version=2)
    with pytest.raises(OrderActionRefusedError, match="only a paid order"):
        cancelled.cancel(expected_version=4)


def test_customer_requires_an_explicit_utc_timestamp() -> None:
    with pytest.raises(DomainError, match="timezone-aware UTC"):
        Customer(
            id=uuid4(),
            email="customer@example.com",
            display_name="Customer",
            created_at=datetime(2026, 8, 16),
        )


def test_memory_record_rejects_empty_namespace() -> None:
    with pytest.raises(DomainError, match="namespace cannot be empty"):
        MemoryRecord(
            id=uuid4(),
            session_id=uuid4(),
            namespace=" ",
            payload={},
            created_at=datetime(2026, 8, 16, tzinfo=UTC),
        )
