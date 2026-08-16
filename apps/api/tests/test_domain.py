from datetime import UTC, datetime
from decimal import Decimal
from uuid import uuid4

import pytest

from capability_lab.domain.entities import Customer, DomainError, MemoryRecord, Product


def test_product_rejects_negative_price() -> None:
    with pytest.raises(DomainError, match="cannot be negative"):
        Product(
            id=uuid4(),
            sku="LAB-001",
            name="Test product",
            price_amount=Decimal("-0.01"),
            currency="EUR",
        )


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
