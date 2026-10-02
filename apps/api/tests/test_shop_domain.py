from decimal import Decimal

import pytest

from capability_lab.domain.shop import (
    AttributeType,
    Currency,
    FulfilmentMethod,
    MediaAssetReference,
    MediaReference,
    Money,
    PolicyDocument,
    PolicyKind,
    ProductReview,
    ProductStatus,
    ProductVariant,
    ShopChangeKind,
    ShopConfigurationError,
    ShopIssueSeverity,
    ShopPayload,
    ToneOfVoiceGuideline,
    TypedAttribute,
    VariantAvailability,
    summarize_shop_changes,
    validate_shop,
)
from shop_factories import identity, price, product, publishable_shop, variant


def test_money_rejects_negative_and_over_precise_amounts() -> None:
    with pytest.raises(ShopConfigurationError, match="cannot be negative"):
        Money(amount=Decimal("-1.00"), currency=Currency.EUR)
    with pytest.raises(ShopConfigurationError, match="two fractional digits"):
        Money(amount=Decimal("1.005"), currency=Currency.EUR)
    assert price("7").canonical_amount == "7.00"


def test_typed_attributes_enforce_their_declared_type() -> None:
    with pytest.raises(ShopConfigurationError, match="must declare a unit"):
        TypedAttribute(
            key="waterproof",
            label="Waterproof rating",
            attribute_type=AttributeType.MEASUREMENT,
            value="20000",
        )
    with pytest.raises(ShopConfigurationError, match="one of its choices"):
        TypedAttribute(
            key="fit",
            label="Fit",
            attribute_type=AttributeType.CHOICE,
            value="Boxy",
            choices=("Regular", "Slim"),
        )
    with pytest.raises(ShopConfigurationError, match="'true' or 'false'"):
        TypedAttribute(
            key="recycled",
            label="Recycled shell",
            attribute_type=AttributeType.BOOLEAN,
            value="yes",
        )
    with pytest.raises(ShopConfigurationError, match="cannot declare choices"):
        TypedAttribute(
            key="care",
            label="Care",
            attribute_type=AttributeType.TEXT,
            value="Machine wash",
            choices=("a",),
        )


def test_product_ratings_are_derived_from_reviews() -> None:
    assert product().ratings.average_rating is None
    rated = product(
        reviews=(
            ProductReview(id="one", author_display_name="Camille", rating=5, body="Dry."),
            ProductReview(id="two", author_display_name="Ade", rating=4, body="Warm."),
        )
    )
    assert rated.ratings.review_count == 2
    assert rated.ratings.average_rating == Decimal("4.5")


def test_shop_rejects_duplicate_keys_and_multiple_default_tones() -> None:
    with pytest.raises(ShopConfigurationError, match="variant SKUs across the shop"):
        publishable_shop(
            products=(
                product(),
                product(handle="second-jacket", title="Second", variants=(variant(),)),
            )
        )
    with pytest.raises(ShopConfigurationError, match="at most one default tone of voice"):
        publishable_shop(
            tone_of_voice_guidelines=(
                ToneOfVoiceGuideline(id="a", name="A", guidance="x", is_default=True),
                ToneOfVoiceGuideline(id="b", name="B", guidance="y", is_default=True),
            )
        )


def test_a_complete_shop_has_no_publish_gate_errors() -> None:
    validation = validate_shop(publishable_shop())
    assert validation.publishable
    assert validation.errors == ()
    assert validation.warnings == ()


def test_an_empty_shop_reports_every_publish_gate_error() -> None:
    validation = validate_shop(ShopPayload(identity=identity()))
    assert not validation.publishable
    assert {issue.code for issue in validation.errors} == {
        "shop_without_product",
        "shop_without_tone_of_voice",
        "shop_without_payment_method",
        "shop_without_fulfilment_method",
        "shop_without_policy",
    }
    assert {issue.code for issue in validation.warnings} == {
        "shop_without_faq",
        "shop_without_support_guideline",
    }
    assert [issue.severity for issue in validation.issues] == sorted(
        [issue.severity for issue in validation.issues],
        key=lambda severity: severity is ShopIssueSeverity.WARNING,
    )


def test_an_unpriced_draft_variant_is_valid_state_but_blocks_publication() -> None:
    draft = publishable_shop(
        products=(
            product(
                variants=(
                    variant(),
                    ProductVariant(
                        sku="NS-ASJ-CH-XL",
                        option_values=(("color", "Charcoal"), ("size", "L")),
                        availability=VariantAvailability.BACKORDER,
                        stock_quantity=0,
                    ),
                )
            ),
        )
    )
    errors = {issue.code: issue for issue in validate_shop(draft).errors}
    assert errors["variant_without_price"].path == (
        "products.alpine-shell-jacket.variants.NS-ASJ-CH-XL"
    )


def test_variant_options_must_match_the_product_option_definitions() -> None:
    codes = {
        issue.code
        for issue in validate_shop(
            publishable_shop(
                products=(
                    product(
                        variants=(
                            variant(option_values=(("color", "Ocean Blue"),)),
                            variant(
                                sku="NS-ASJ-XX",
                                option_values=(("color", "Rust"), ("size", "M")),
                            ),
                            variant(
                                sku="NS-ASJ-YY",
                                option_values=(("finish", "Matte"), ("size", "M")),
                            ),
                        )
                    ),
                )
            )
        ).errors
    }
    assert codes == {
        "variant_missing_option",
        "variant_unknown_option_value",
        "variant_unknown_option",
    }


def test_variant_price_currency_must_be_sold_by_the_shop() -> None:
    codes = {
        issue.code
        for issue in validate_shop(
            publishable_shop(
                products=(product(variants=(variant(variant_price=price(currency=Currency.USD)),)),)
            )
        ).errors
    }
    assert codes == {"variant_currency_unsupported"}


def test_in_stock_variants_must_hold_inventory() -> None:
    codes = {
        issue.code
        for issue in validate_shop(
            publishable_shop(products=(product(variants=(variant(stock_quantity=0),)),))
        ).errors
    }
    assert codes == {"variant_in_stock_without_inventory"}


def test_duplicate_option_combinations_are_rejected_at_publication() -> None:
    codes = {
        issue.code
        for issue in validate_shop(
            publishable_shop(products=(product(variants=(variant(), variant(sku="NS-ASJ-DUP"))),))
        ).errors
    }
    assert codes == {"duplicate_variant_options"}


def test_first_publication_is_summarized_as_one_change() -> None:
    changes = summarize_shop_changes(None, publishable_shop())
    assert [change.kind for change in changes] == [ShopChangeKind.ADDED]
    assert "Northstar Outfitters" in changes[0].description


def test_changes_name_the_added_variant_attribute_and_edited_field() -> None:
    published = publishable_shop()
    draft = publishable_shop(
        products=(
            product(
                description="A shorter description.",
                variants=(
                    variant(),
                    variant(
                        sku="NS-ASJ-CH-L", option_values=(("color", "Charcoal"), ("size", "L"))
                    ),
                ),
                attributes=(
                    TypedAttribute(
                        key="fit",
                        label="Fit",
                        attribute_type=AttributeType.CHOICE,
                        value="Regular",
                        choices=("Regular", "Slim"),
                    ),
                ),
            ),
        )
    )
    # A changed product is reported once, by its field-level and sub-entry diff, never also
    # as an "Updated product" row from the products collection.
    assert [change.description for change in summarize_shop_changes(published, draft)] == [
        "Updated Alpine Shell Jacket description",
        "Added variant NS-ASJ-CH-L",
        "Added attribute Fit",
    ]


def test_correcting_one_word_of_a_policy_is_one_updated_change() -> None:
    """What editing a saved entry in place has to produce, from the summary's side.

    The workspace opens a saved policy, changes a word and writes the entry back with the id
    it already had. `diff_keyed_collection` keys on that id, so the draft reports one update
    — and would report a removal and an addition if the editor had re-derived the id from the
    edited title, which is why it does not.
    """
    published = publishable_shop()
    draft = publishable_shop(
        policies=(
            PolicyDocument(
                id="shipping",
                title="Shipping policy",
                kind=PolicyKind.SHIPPING,
                body="Addresses can change before despatch.",
            ),
        )
    )

    changes = summarize_shop_changes(published, draft)
    assert [(change.kind, change.description) for change in changes] == [
        (ShopChangeKind.UPDATED, "Updated policy Shipping policy")
    ]


def test_renaming_a_policy_id_reads_as_a_removal_and_an_addition() -> None:
    """The other half of the rule, stated rather than assumed."""
    published = publishable_shop()
    draft = publishable_shop(
        policies=(
            PolicyDocument(
                id="shipping-and-delivery",
                title="Shipping policy",
                kind=PolicyKind.SHIPPING,
                body="Addresses can change before dispatch.",
            ),
        )
    )

    assert [change.kind for change in summarize_shop_changes(published, draft)] == [
        ShopChangeKind.ADDED,
        ShopChangeKind.REMOVED,
    ]


def test_added_and_removed_products_are_reported_at_the_collection_level() -> None:
    published = publishable_shop()
    draft = publishable_shop(
        products=(product(handle="rain-shell", title="Rain Shell", variants=(variant(),)),)
    )

    assert [change.description for change in summarize_shop_changes(published, draft)] == [
        "Added product Rain Shell",
        "Removed product Alpine Shell Jacket",
    ]


def test_an_unchanged_draft_reports_no_changes() -> None:
    assert summarize_shop_changes(publishable_shop(), publishable_shop()) == ()


# The Studio says these four sentences under the controls that break them, character for
# character (`apps/web/src/lib/fieldRules.ts`, whose test reads this module's templates). These
# assert the rendered messages from this end, and that the rules hold for every product status.


def test_a_transit_window_shorter_at_the_top_than_the_bottom_is_refused() -> None:
    def method(minimum: int, maximum: int) -> FulfilmentMethod:
        return FulfilmentMethod(
            id="express",
            name="Express",
            carrier="Nordic Post",
            min_transit_days=minimum,
            max_transit_days=maximum,
        )

    # Every maximum from zero to one past the minimum: below it refused, from it on taken.
    for maximum in range(7):
        if maximum < 5:
            with pytest.raises(ShopConfigurationError) as refused:
                method(5, maximum)
            assert str(refused.value) == (
                "maximum transit days cannot be shorter than minimum transit days"
            )
        else:
            assert method(5, maximum).max_transit_days == maximum


@pytest.mark.parametrize("status", list(ProductStatus))
def test_the_variant_findings_hold_for_every_product_status(status: ProductStatus) -> None:
    empty = validate_shop(publishable_shop(products=(product(status=status, variants=()),)))
    assert {(issue.code, issue.message) for issue in empty.errors} >= {
        ("product_without_variant", "product Alpine Shell Jacket has no sellable variant")
    }

    unpriced = ProductVariant(
        sku="NS-ASJ-OB-L",
        option_values=(("color", "Ocean Blue"), ("size", "L")),
        availability=VariantAvailability.IN_STOCK,
        stock_quantity=0,
    )
    findings = validate_shop(
        publishable_shop(products=(product(status=status, variants=(variant(), unpriced)),))
    )
    assert {(issue.code, issue.message) for issue in findings.errors} == {
        ("variant_without_price", "variant NS-ASJ-OB-L is missing a price"),
        (
            "variant_in_stock_without_inventory",
            "variant NS-ASJ-OB-L is in stock but holds no inventory",
        ),
    }


def test_a_media_asset_reference_reads_and_renders_asset_sha256_and_nothing_else() -> None:
    sha256 = "0f" * 32
    parsed = MediaAssetReference.parse(f"asset:sha256:{sha256}")

    assert parsed.sha256 == sha256
    assert parsed.reference == f"asset:sha256:{sha256}"
    assert MediaAssetReference(sha256).reference == f"asset:sha256:{sha256}"
    for refused in (
        "media/alpine-ocean.jpg",
        "https://cdn.example/alpine.jpg",
        f"asset:sha256:{sha256.upper()}",
        f"asset:sha256:{sha256[:-1]}",
        f"asset:sha256:{sha256}0",
        f"asset:sha1:{sha256}",
        f" asset:sha256:{sha256}",
        "asset:sha256:",
    ):
        with pytest.raises(ShopConfigurationError):
            MediaAssetReference.parse(refused)
        assert MediaAssetReference.of(refused) is None


def test_an_entry_names_its_asset_and_a_written_reference_still_reads() -> None:
    """A stored version may hold a written reference; it reads, and names no asset."""
    sha256 = "a1" * 32

    assert MediaReference(f"asset:sha256:{sha256}", "Ocean Blue").asset == sha256
    written = MediaReference("media/alpine-ocean.jpg", "Ocean Blue")
    assert written.asset is None
    assert validate_shop(publishable_shop()).publishable


def test_a_product_without_media_is_a_warning_that_says_it_has_no_image() -> None:
    findings = validate_shop(publishable_shop(products=(product(media=()),)))

    assert findings.publishable
    assert [(issue.code, issue.message, issue.severity) for issue in findings.warnings] == [
        (
            "product_without_media",
            "product Alpine Shell Jacket has no image",
            ShopIssueSeverity.WARNING,
        )
    ]
