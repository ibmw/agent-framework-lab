import json
from dataclasses import replace
from decimal import Decimal

import pytest

from capability_lab.application.canonical_json import CanonicalSerializationError
from capability_lab.application.shop_payload import (
    SHOP_PAYLOAD_CANONICAL_SCHEMA_VERSION,
    shop_content_fingerprint,
    shop_payload_canonical_json,
    shop_payload_document,
    shop_payload_from_document,
)
from capability_lab.domain.shop import Currency, Money, ProductVariant, VariantAvailability
from shop_factories import identity, product, publishable_shop, variant


def test_payload_round_trips_through_its_canonical_document() -> None:
    payload = publishable_shop(
        products=(
            product(
                variants=(
                    variant(),
                    ProductVariant(
                        sku="NS-ASJ-CH-L",
                        option_values=(("color", "Charcoal"), ("size", "L")),
                        availability=VariantAvailability.BACKORDER,
                        stock_quantity=0,
                    ),
                )
            ),
        )
    )
    document = json.loads(shop_payload_canonical_json(payload))

    assert shop_payload_from_document(document) == payload


def test_canonical_json_is_sorted_compact_utf8_without_binary_floats() -> None:
    canonical = shop_payload_canonical_json(publishable_shop())

    assert canonical.startswith(b'{"canonical_schema_version":"shop-payload-v1"')
    assert b", " not in canonical
    assert b'"amount":"249.00"' in canonical


def test_fingerprint_changes_for_every_behaviorally_relevant_edit() -> None:
    payload = publishable_shop()
    baseline = shop_content_fingerprint(payload)

    assert shop_content_fingerprint(publishable_shop()) == baseline
    assert (
        shop_content_fingerprint(
            replace(payload, identity=identity(currencies=(Currency.EUR, Currency.USD)))
        )
        != baseline
    )
    assert (
        shop_content_fingerprint(
            replace(
                payload,
                products=(
                    product(
                        variants=(variant(variant_price=Money(Decimal("250.00"), Currency.EUR)),)
                    ),
                ),
            )
        )
        != baseline
    )


def test_document_declares_its_schema_version_and_rejects_another() -> None:
    document = shop_payload_document(publishable_shop())
    assert document["canonical_schema_version"] == SHOP_PAYLOAD_CANONICAL_SCHEMA_VERSION

    with pytest.raises(CanonicalSerializationError, match="unsupported shop payload schema"):
        shop_payload_from_document({**document, "canonical_schema_version": "shop-payload-v2"})


def test_malformed_stored_documents_report_the_failing_path() -> None:
    document = json.loads(shop_payload_canonical_json(publishable_shop()))
    document["products"][0]["variants"][0]["stock_quantity"] = "many"

    with pytest.raises(CanonicalSerializationError, match=r"stock_quantity must be an integer"):
        shop_payload_from_document(document)


def test_unsupported_enum_values_are_rejected_rather_than_silently_dropped() -> None:
    document = json.loads(shop_payload_canonical_json(publishable_shop()))
    document["identity"]["currencies"] = ["XBT"]

    with pytest.raises(CanonicalSerializationError, match="not a supported Currency"):
        shop_payload_from_document(document)
