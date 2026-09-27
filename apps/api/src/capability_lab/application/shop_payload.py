"""Canonical serialization of the shop definition payload.

ADR 0012 fixes the definition lifecycle and leaves each payload schema to the slice that
introduces it. `shop-payload-v1` is the shop's schema: a lossless canonical document under
the ADR 0007 serialization rules, so a published version's content fingerprint is stable
and a stored version round-trips back into the typed domain aggregate.

A shop without a logo is written as v1, key for key, so no document stored before the logo
existed renders to different bytes — and no recorded fingerprint moves (ADR 0070).

`shop-payload-v3` is v1 plus a required `logo` of `{background, mark, mark_colour}`, where
`mark` is `null` for the monogram. It is what every logo is written as now.

`shop-payload-v2` is v1 plus a `logo` of `{background, mark}` only, from before the operator
chose the mark colour. It is still read — as a logo drawn in the colour the lab derived — and
a logo read from it is written back as v2, so a stored v2 version keeps its bytes and its
fingerprint. Nothing authors a v2 logo any more.
"""

from __future__ import annotations

from decimal import Decimal, InvalidOperation

from capability_lab.application.canonical_document import (
    DocumentReader,
    require_schema_version,
)
from capability_lab.application.canonical_json import (
    CanonicalSerializationError,
    CanonicalValue,
    canonical_json_bytes,
    canonical_sha256,
)
from capability_lab.domain.shop import (
    AttributeType,
    Currency,
    FaqEntry,
    FulfilmentMethod,
    MediaReference,
    Money,
    OptionDefinition,
    PaymentMethod,
    PaymentMethodKind,
    PolicyDocument,
    PolicyKind,
    Product,
    ProductReview,
    ProductStatus,
    ProductVariant,
    ShopIdentity,
    ShopLogo,
    ShopLogoBackground,
    ShopMark,
    ShopMarkColour,
    ShopPayload,
    SupportChannel,
    SupportGuideline,
    ToneOfVoiceGuideline,
    TypedAttribute,
    VariantAvailability,
)

SHOP_PAYLOAD_CANONICAL_SCHEMA_VERSION = "shop-payload-v1"
SHOP_PAYLOAD_WITH_DERIVED_COLOUR_LOGO_CANONICAL_SCHEMA_VERSION = "shop-payload-v2"
SHOP_PAYLOAD_WITH_LOGO_CANONICAL_SCHEMA_VERSION = "shop-payload-v3"


def _money_document(price: Money) -> dict[str, CanonicalValue]:
    return {"amount": price.canonical_amount, "currency": price.currency.value}


def _variant_document(variant: ProductVariant) -> dict[str, CanonicalValue]:
    return {
        "availability": variant.availability.value,
        "option_values": [{"key": key, "value": value} for key, value in variant.option_values],
        "price": None if variant.price is None else _money_document(variant.price),
        "sku": variant.sku,
        "stock_quantity": variant.stock_quantity,
    }


def _attribute_document(attribute: TypedAttribute) -> dict[str, CanonicalValue]:
    return {
        "attribute_type": attribute.attribute_type.value,
        "choices": list(attribute.choices),
        "key": attribute.key,
        "label": attribute.label,
        "unit": attribute.unit,
        "value": attribute.value,
    }


def _product_document(product: Product) -> dict[str, CanonicalValue]:
    return {
        "attributes": [_attribute_document(attribute) for attribute in product.attributes],
        "category": product.category,
        "description": product.description,
        "handle": product.handle,
        "media": [
            {"alt_text": reference.alt_text, "reference": reference.reference}
            for reference in product.media
        ],
        "options": [
            {"key": option.key, "name": option.name, "values": list(option.values)}
            for option in product.options
        ],
        "reviews": [
            {
                "author_display_name": review.author_display_name,
                "body": review.body,
                "id": review.id,
                "rating": review.rating,
            }
            for review in product.reviews
        ],
        "status": product.status.value,
        "title": product.title,
        "variants": [_variant_document(variant) for variant in product.variants],
    }


def _logo_document(logo: ShopLogo) -> tuple[str, dict[str, CanonicalValue]]:
    """The logo's token and object: v3 with its chosen colour, v2 for one read without it."""
    colour = logo.mark_colour
    if colour is None:
        # Only a logo read from v2 has no chosen colour, and v2 had no monogram.
        if logo.mark is None:
            raise CanonicalSerializationError("a monogram logo must carry its mark colour")
        return SHOP_PAYLOAD_WITH_DERIVED_COLOUR_LOGO_CANONICAL_SCHEMA_VERSION, {
            "background": logo.background.value,
            "mark": logo.mark.value,
        }
    return SHOP_PAYLOAD_WITH_LOGO_CANONICAL_SCHEMA_VERSION, {
        "background": logo.background.value,
        "mark": None if logo.mark is None else logo.mark.value,
        "mark_colour": colour.value,
    }


def shop_payload_document(payload: ShopPayload) -> dict[str, CanonicalValue]:
    """Render one shop payload as its canonical document: v1 without a logo, v3 with one."""
    document: dict[str, CanonicalValue] = {
        "canonical_schema_version": SHOP_PAYLOAD_CANONICAL_SCHEMA_VERSION,
        "faq": [
            {"answer": entry.answer, "id": entry.id, "question": entry.question}
            for entry in payload.faq
        ],
        "fulfilment_methods": [
            {
                "carrier": method.carrier,
                "id": method.id,
                "max_transit_days": method.max_transit_days,
                "min_transit_days": method.min_transit_days,
                "name": method.name,
            }
            for method in payload.fulfilment_methods
        ],
        "identity": {
            "channels": [channel.value for channel in payload.identity.channels],
            "currencies": [currency.value for currency in payload.identity.currencies],
            "locale": payload.identity.locale,
            "name": payload.identity.name,
            "slug": payload.identity.slug,
        },
        "payment_methods": [
            {
                "enabled": method.enabled,
                "id": method.id,
                "kind": method.kind.value,
                "name": method.name,
            }
            for method in payload.payment_methods
        ],
        "policies": [
            {
                "body": policy.body,
                "id": policy.id,
                "kind": policy.kind.value,
                "title": policy.title,
            }
            for policy in payload.policies
        ],
        "products": [_product_document(product) for product in payload.products],
        "support_guidelines": [
            {"body": guideline.body, "id": guideline.id, "title": guideline.title}
            for guideline in payload.support_guidelines
        ],
        "tone_of_voice_guidelines": [
            {
                "guidance": guideline.guidance,
                "id": guideline.id,
                "is_default": guideline.is_default,
                "name": guideline.name,
            }
            for guideline in payload.tone_of_voice_guidelines
        ],
    }
    # Absent means unwritten: a `"logo": null` would move the bytes, and so the fingerprint,
    # of every shop stored before the logo existed.
    if payload.logo is not None:
        document["canonical_schema_version"], document["logo"] = _logo_document(payload.logo)
    return document


def shop_payload_canonical_json(payload: ShopPayload) -> bytes:
    return canonical_json_bytes(shop_payload_document(payload))


def shop_content_fingerprint(payload: ShopPayload) -> str:
    """The SHA-256 content fingerprint a published shop version records."""
    return canonical_sha256(shop_payload_canonical_json(payload))


def _read_money(reader: DocumentReader, key: str) -> Money | None:
    """A variant price, which the schema allows to be null while the draft is unpriced."""
    money = reader.optional_reader(key)
    if money is None:
        return None
    try:
        amount = Decimal(money.text("amount"))
    except InvalidOperation as error:
        raise CanonicalSerializationError(
            f"{money.path}.amount must be a decimal string"
        ) from error
    return Money(amount=amount, currency=money.enum(Currency, "currency"))


def _read_variant(reader: DocumentReader) -> ProductVariant:
    return ProductVariant(
        sku=reader.text("sku"),
        option_values=tuple(
            (entry.text("key"), entry.text("value")) for entry in reader.readers("option_values")
        ),
        availability=reader.enum(VariantAvailability, "availability"),
        stock_quantity=reader.integer("stock_quantity"),
        price=_read_money(reader, "price"),
    )


def _read_product(reader: DocumentReader) -> Product:
    return Product(
        handle=reader.text("handle"),
        title=reader.text("title"),
        description=reader.text("description"),
        status=reader.enum(ProductStatus, "status"),
        category=reader.text("category"),
        options=tuple(
            OptionDefinition(
                key=entry.text("key"), name=entry.text("name"), values=entry.texts("values")
            )
            for entry in reader.readers("options")
        ),
        variants=tuple(_read_variant(entry) for entry in reader.readers("variants")),
        media=tuple(
            MediaReference(reference=entry.text("reference"), alt_text=entry.text("alt_text"))
            for entry in reader.readers("media")
        ),
        attributes=tuple(
            TypedAttribute(
                key=entry.text("key"),
                label=entry.text("label"),
                attribute_type=entry.enum(AttributeType, "attribute_type"),
                value=entry.text("value"),
                unit=entry.optional_text("unit"),
                choices=entry.texts("choices"),
            )
            for entry in reader.readers("attributes")
        ),
        reviews=tuple(
            ProductReview(
                id=entry.text("id"),
                author_display_name=entry.text("author_display_name"),
                rating=entry.integer("rating"),
                body=entry.text("body"),
            )
            for entry in reader.readers("reviews")
        ),
    )


def _read_logo(root: DocumentReader) -> ShopLogo | None:
    """The logo the schema token says the document holds: none under v1, one under v2 or v3.

    A key the token does not promise is refused rather than read — `logo` under v1 (even
    `null`), `mark_colour` under v2 — because no writer produces one, and re-rendering it would
    not give back the bytes that were stored.
    """
    token = root.text("canonical_schema_version")
    if token == SHOP_PAYLOAD_WITH_LOGO_CANONICAL_SCHEMA_VERSION:
        logo = root.reader("logo")
        return ShopLogo(
            # `null` is the monogram; an absent `mark` is refused as not a string.
            mark=(
                None
                if logo.has("mark") and logo.optional_text("mark") is None
                else logo.enum(ShopMark, "mark")
            ),
            background=logo.enum(ShopLogoBackground, "background"),
            mark_colour=logo.enum(ShopMarkColour, "mark_colour"),
        )
    if token == SHOP_PAYLOAD_WITH_DERIVED_COLOUR_LOGO_CANONICAL_SCHEMA_VERSION:
        logo = root.reader("logo")
        if logo.has("mark_colour"):
            raise CanonicalSerializationError(
                f"{logo.path}.mark_colour is written only under "
                f"{SHOP_PAYLOAD_WITH_LOGO_CANONICAL_SCHEMA_VERSION}"
            )
        return ShopLogo(
            mark=logo.enum(ShopMark, "mark"),
            background=logo.enum(ShopLogoBackground, "background"),
            mark_colour=None,
        )
    require_schema_version(root, SHOP_PAYLOAD_CANONICAL_SCHEMA_VERSION, "shop payload")
    if root.has("logo"):
        raise CanonicalSerializationError(
            f"{root.path}.logo is written only under "
            f"{SHOP_PAYLOAD_WITH_LOGO_CANONICAL_SCHEMA_VERSION}"
        )
    return None


def shop_payload_from_document(document: object) -> ShopPayload:
    """Rebuild the typed aggregate from a stored canonical document."""
    root = DocumentReader(document, "shop payload")
    logo = _read_logo(root)
    identity = root.reader("identity")
    return ShopPayload(
        identity=ShopIdentity(
            name=identity.text("name"),
            slug=identity.text("slug"),
            locale=identity.text("locale"),
            currencies=identity.enums(Currency, "currencies"),
            channels=identity.enums(SupportChannel, "channels"),
        ),
        products=tuple(_read_product(entry) for entry in root.readers("products")),
        faq=tuple(
            FaqEntry(
                id=entry.text("id"), question=entry.text("question"), answer=entry.text("answer")
            )
            for entry in root.readers("faq")
        ),
        policies=tuple(
            PolicyDocument(
                id=entry.text("id"),
                title=entry.text("title"),
                kind=entry.enum(PolicyKind, "kind"),
                body=entry.text("body"),
            )
            for entry in root.readers("policies")
        ),
        payment_methods=tuple(
            PaymentMethod(
                id=entry.text("id"),
                name=entry.text("name"),
                kind=entry.enum(PaymentMethodKind, "kind"),
                enabled=entry.boolean("enabled"),
            )
            for entry in root.readers("payment_methods")
        ),
        fulfilment_methods=tuple(
            FulfilmentMethod(
                id=entry.text("id"),
                name=entry.text("name"),
                carrier=entry.text("carrier"),
                min_transit_days=entry.integer("min_transit_days"),
                max_transit_days=entry.integer("max_transit_days"),
            )
            for entry in root.readers("fulfilment_methods")
        ),
        support_guidelines=tuple(
            SupportGuideline(
                id=entry.text("id"), title=entry.text("title"), body=entry.text("body")
            )
            for entry in root.readers("support_guidelines")
        ),
        tone_of_voice_guidelines=tuple(
            ToneOfVoiceGuideline(
                id=entry.text("id"),
                name=entry.text("name"),
                guidance=entry.text("guidance"),
                is_default=entry.boolean("is_default"),
            )
            for entry in root.readers("tone_of_voice_guidelines")
        ),
        logo=logo,
    )
