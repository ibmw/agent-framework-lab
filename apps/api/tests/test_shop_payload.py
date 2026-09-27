import json
from dataclasses import replace
from decimal import Decimal

import pytest

from capability_lab.application.canonical_document import DocumentReader, require_schema_version
from capability_lab.application.canonical_json import CanonicalSerializationError
from capability_lab.application.shop_payload import (
    SHOP_PAYLOAD_CANONICAL_SCHEMA_VERSION,
    SHOP_PAYLOAD_WITH_DERIVED_COLOUR_LOGO_CANONICAL_SCHEMA_VERSION,
    SHOP_PAYLOAD_WITH_LOGO_CANONICAL_SCHEMA_VERSION,
    shop_content_fingerprint,
    shop_payload_canonical_json,
    shop_payload_document,
    shop_payload_from_document,
)
from capability_lab.domain.shop import (
    Currency,
    Money,
    ProductVariant,
    ShopLogo,
    ShopLogoBackground,
    ShopMark,
    ShopMarkColour,
    ShopPayload,
    VariantAvailability,
)
from shop_factories import (
    PRE_LOGO_IDENTITY_ONLY_DOCUMENT,
    PRE_LOGO_IDENTITY_ONLY_FINGERPRINT,
    PRE_LOGO_PUBLISHABLE_FINGERPRINT,
    V2_LOGO_DOCUMENT,
    V2_LOGO_FINGERPRINT,
    identity,
    product,
    publishable_shop,
    variant,
)


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
        shop_payload_from_document({**document, "canonical_schema_version": "shop-payload-v4"})


def test_malformed_stored_documents_report_the_failing_path() -> None:
    document = json.loads(shop_payload_canonical_json(publishable_shop()))
    document["products"][0]["variants"][0]["stock_quantity"] = "many"

    with pytest.raises(CanonicalSerializationError, match=r"stock_quantity must be an integer"):
        shop_payload_from_document(document)


def test_every_currency_the_lab_expresses_can_be_declared_and_priced_in() -> None:
    """The enum is the set an author may use, not a label on the three the seed happens to use.

    A currency that parses but cannot be priced in would be a currency the lab advertises and
    then refuses, so each one is taken through the boundary it would really cross.
    """
    for currency in Currency:
        payload = publishable_shop(
            identity=identity(currencies=(currency,)),
            products=(
                product(variants=(variant(variant_price=Money(Decimal("250.00"), currency)),)),
            ),
        )
        document = json.loads(shop_payload_canonical_json(payload))

        restored = shop_payload_from_document(document)

        assert restored.identity.currencies == (currency,)
        assert restored.products[0].variants[0].price == Money(Decimal("250.00"), currency)


def test_unsupported_enum_values_are_rejected_rather_than_silently_dropped() -> None:
    document = json.loads(shop_payload_canonical_json(publishable_shop()))
    document["identity"]["currencies"] = ["XBT"]

    with pytest.raises(CanonicalSerializationError, match="not a supported Currency"):
        shop_payload_from_document(document)


LOGO = ShopLogo(
    mark=ShopMark.COMPASS, background=ShopLogoBackground.CLAY, mark_colour=ShopMarkColour.INK
)
V1, V2, V3 = (
    SHOP_PAYLOAD_CANONICAL_SCHEMA_VERSION,
    SHOP_PAYLOAD_WITH_DERIVED_COLOUR_LOGO_CANONICAL_SCHEMA_VERSION,
    SHOP_PAYLOAD_WITH_LOGO_CANONICAL_SCHEMA_VERSION,
)


def test_a_shop_without_a_logo_keeps_the_bytes_and_fingerprint_it_had_before_logos() -> None:
    bare = ShopPayload(identity=identity())

    assert shop_payload_canonical_json(bare) == PRE_LOGO_IDENTITY_ONLY_DOCUMENT
    assert shop_content_fingerprint(bare) == PRE_LOGO_IDENTITY_ONLY_FINGERPRINT
    assert shop_content_fingerprint(publishable_shop()) == PRE_LOGO_PUBLISHABLE_FINGERPRINT
    assert shop_payload_from_document(json.loads(PRE_LOGO_IDENTITY_ONLY_DOCUMENT)) == bare


def test_a_logo_stored_before_the_colour_was_chosen_keeps_its_bytes_and_fingerprint() -> None:
    """A v2 document reads as its derived colour and renders back to the bytes it was stored as."""
    stored = shop_payload_from_document(json.loads(V2_LOGO_DOCUMENT))

    assert stored.logo == ShopLogo(
        mark=ShopMark.COMPASS, background=ShopLogoBackground.OCHRE, mark_colour=None
    )
    assert stored.logo is not None
    assert stored.logo.drawn_mark_colour is ShopMarkColour.INK
    assert shop_payload_canonical_json(stored) == V2_LOGO_DOCUMENT
    assert shop_content_fingerprint(stored) == V2_LOGO_FINGERPRINT


def test_a_v2_logo_given_its_colour_is_written_as_v3() -> None:
    stored = shop_payload_from_document(json.loads(V2_LOGO_DOCUMENT))
    assert stored.logo is not None
    chosen = replace(stored, logo=replace(stored.logo, mark_colour=ShopMarkColour.INK))

    assert shop_payload_document(chosen)["canonical_schema_version"] == V3
    assert shop_content_fingerprint(chosen) != V2_LOGO_FINGERPRINT


@pytest.mark.parametrize(
    ("logo", "written"),
    [
        (LOGO, {"background": "clay", "mark": "compass", "mark_colour": "ink"}),
        (
            ShopLogo(
                mark=None, background=ShopLogoBackground.BRICK, mark_colour=ShopMarkColour.WHITE
            ),
            {"background": "brick", "mark": None, "mark_colour": "white"},
        ),
    ],
)
def test_a_shop_with_a_logo_is_written_as_v3_and_round_trips(
    logo: ShopLogo, written: dict[str, object]
) -> None:
    payload = replace(publishable_shop(), logo=logo)
    document = json.loads(shop_payload_canonical_json(payload))

    assert document["canonical_schema_version"] == V3
    assert document["logo"] == written
    assert shop_payload_from_document(document) == payload
    assert shop_content_fingerprint(payload) != PRE_LOGO_PUBLISHABLE_FINGERPRINT


def test_the_fingerprint_moves_with_the_mark_the_background_and_the_colour() -> None:
    payload = replace(publishable_shop(), logo=LOGO)
    baseline = shop_content_fingerprint(payload)

    for other in (
        replace(LOGO, background=ShopLogoBackground.PINE),
        replace(LOGO, mark=ShopMark.ANCHOR),
        replace(LOGO, mark=None),
        replace(LOGO, mark_colour=ShopMarkColour.WHITE),
    ):
        assert shop_content_fingerprint(replace(payload, logo=other)) != baseline


@pytest.mark.parametrize("reader_token", [V1, V2])
def test_code_that_reads_only_v1_or_v2_refuses_a_v3_document_by_its_token(
    reader_token: str,
) -> None:
    """What the codec before the chosen colour does with a v3 document: refuse it by name."""
    document = shop_payload_document(replace(publishable_shop(), logo=LOGO))

    with pytest.raises(
        CanonicalSerializationError, match="unsupported shop payload schema version shop-payload-v3"
    ):
        require_schema_version(
            DocumentReader(document, "shop payload"), reader_token, "shop payload"
        )


@pytest.mark.parametrize(
    ("token", "logo", "message"),
    [
        (V1, None, r"logo is written only under shop-payload-v3"),
        (
            V1,
            {"background": "clay", "mark": "compass"},
            r"logo is written only under shop-payload-v3",
        ),
        (V2, None, r"logo must be an object"),
        (V2, {"background": "crimson", "mark": "compass"}, r"logo\.background is not a supported"),
        (V2, {"background": "clay", "mark": "rocket"}, r"logo\.mark is not a supported ShopMark"),
        (V2, {"background": "clay", "mark": None}, r"logo\.mark is not a supported ShopMark"),
        (
            V2,
            {"background": "clay", "mark": "compass", "mark_colour": "white"},
            r"logo\.mark_colour is written only under shop-payload-v3",
        ),
        (
            V2,
            {"background": "clay", "mark": "compass", "mark_colour": None},
            r"logo\.mark_colour is written only under shop-payload-v3",
        ),
        (V3, None, r"logo must be an object"),
        (
            V3,
            {"background": "clay", "mark": "compass"},
            r"logo\.mark_colour is not a supported ShopMarkColour",
        ),
        (
            V3,
            {"background": "clay", "mark": "compass", "mark_colour": None},
            r"logo\.mark_colour is not a supported ShopMarkColour",
        ),
        (
            V3,
            {"background": "clay", "mark": "compass", "mark_colour": "red"},
            r"logo\.mark_colour is not a supported ShopMarkColour",
        ),
        (
            V3,
            {"background": "clay", "mark_colour": "white"},
            r"logo\.mark is not a supported ShopMark",
        ),
        (
            V3,
            {"background": "crimson", "mark": None, "mark_colour": "white"},
            r"logo\.background is not a supported ShopLogoBackground",
        ),
    ],
)
def test_a_logo_the_token_does_not_promise_is_refused_with_its_path(
    token: str, logo: object, message: str
) -> None:
    document: dict[str, object] = {
        **shop_payload_document(publishable_shop()),
        "canonical_schema_version": token,
        "logo": logo,
    }

    with pytest.raises(CanonicalSerializationError, match=message):
        shop_payload_from_document(document)


@pytest.mark.parametrize("token", [V2, V3])
def test_a_logo_document_without_its_logo_is_refused(token: str) -> None:
    document = shop_payload_document(publishable_shop())
    document["canonical_schema_version"] = token

    with pytest.raises(CanonicalSerializationError, match=r"shop payload\.logo must be an object"):
        shop_payload_from_document(document)
