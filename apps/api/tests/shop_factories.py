"""Shared shop fixtures for the domain, payload, service, and API test modules."""

from dataclasses import replace
from decimal import Decimal

from capability_lab.domain.shop import (
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
    ProductStatus,
    ProductVariant,
    ShopIdentity,
    ShopPayload,
    SupportChannel,
    SupportGuideline,
    ToneOfVoiceGuideline,
    VariantAvailability,
)


def identity(**overrides: object) -> ShopIdentity:
    fields: dict[str, object] = {
        "name": "Northstar Outfitters",
        "slug": "northstar",
        "locale": "en-GB",
        "currencies": (Currency.EUR,),
        "channels": (SupportChannel.CHAT,),
    }
    fields.update(overrides)
    return ShopIdentity(**fields)  # type: ignore[arg-type]


def price(amount: str = "249.00", currency: Currency = Currency.EUR) -> Money:
    return Money(amount=Decimal(amount), currency=currency)


def variant(
    sku: str = "NS-ASJ-OB-M",
    *,
    option_values: tuple[tuple[str, str], ...] = (("color", "Ocean Blue"), ("size", "M")),
    availability: VariantAvailability = VariantAvailability.IN_STOCK,
    stock_quantity: int = 12,
    variant_price: Money | None = None,
) -> ProductVariant:
    return ProductVariant(
        sku=sku,
        option_values=option_values,
        availability=availability,
        stock_quantity=stock_quantity,
        price=price() if variant_price is None else variant_price,
    )


def product(**overrides: object) -> Product:
    fields: dict[str, object] = {
        "handle": "alpine-shell-jacket",
        "title": "Alpine Shell Jacket",
        "description": "Three-layer waterproof shell with taped seams.",
        "status": ProductStatus.ACTIVE,
        "category": "Jackets",
        "options": (
            OptionDefinition(key="color", name="Color", values=("Ocean Blue", "Charcoal")),
            OptionDefinition(key="size", name="Size", values=("M", "L")),
        ),
        "variants": (variant(),),
        "media": (MediaReference(reference="media/alpine-ocean.jpg", alt_text="Ocean Blue"),),
        "attributes": (),
        "reviews": (),
    }
    fields.update(overrides)
    return Product(**fields)  # type: ignore[arg-type]


def publishable_shop(**overrides: object) -> ShopPayload:
    fields: dict[str, object] = {
        "identity": identity(),
        "products": (product(),),
        "faq": (FaqEntry(id="delivery", question="When does it ship?", answer="Two days."),),
        "policies": (
            PolicyDocument(
                id="shipping",
                title="Shipping policy",
                kind=PolicyKind.SHIPPING,
                body="Addresses can change before dispatch.",
            ),
        ),
        "payment_methods": (
            PaymentMethod(id="visa", name="Visa", kind=PaymentMethodKind.CARD, enabled=True),
        ),
        "fulfilment_methods": (
            FulfilmentMethod(
                id="standard",
                name="Standard",
                carrier="Nordic Post",
                min_transit_days=2,
                max_transit_days=5,
            ),
        ),
        "support_guidelines": (
            SupportGuideline(id="escalation", title="Escalation", body="Escalate above 500."),
        ),
        "tone_of_voice_guidelines": (
            ToneOfVoiceGuideline(
                id="warm", name="Warm and precise", guidance="Be kind.", is_default=True
            ),
        ),
    }
    fields.update(overrides)
    return ShopPayload(**fields)  # type: ignore[arg-type]


def without_media(payload: ShopPayload) -> ShopPayload:
    """`payload` as a draft write accepts it without an upload: no product carries media.

    `product()` and `publishable_shop()` keep their written reference byte for byte, because
    the recorded fingerprints below are taken over them; a stored version still reads it. Only
    a *write* refuses it (ADR 0076), so a suite saving through `ShopService` saves this, or
    uploads first and names the reference the upload returned.
    """
    return replace(
        payload,
        products=tuple(replace(entry, media=()) for entry in payload.products),
    )


def saved_shop(**overrides: object) -> ShopPayload:
    """`publishable_shop()` as a save through the service writes it: without media."""
    return without_media(publishable_shop(**overrides))


# ADR 0070. Both constants were taken from the codec as it stood before the logo existed
# (commit 8105c27): a shop without a logo must still render to these exact bytes, or every
# published shop version would stop matching the fingerprint recorded when it was frozen.
PRE_LOGO_IDENTITY_ONLY_DOCUMENT = (
    b'{"canonical_schema_version":"shop-payload-v1","faq":[],"fulfilment_methods":[],'
    b'"identity":{"channels":["chat"],"currencies":["EUR"],"locale":"en-GB",'
    b'"name":"Northstar Outfitters","slug":"northstar"},"payment_methods":[],"policies":[],'
    b'"products":[],"support_guidelines":[],"tone_of_voice_guidelines":[]}'
)
PRE_LOGO_IDENTITY_ONLY_FINGERPRINT = (
    "230a96f8afb86dd7f7aa61683da3c22ebff11156e6a815dad3bdebce00855d49"
)
PRE_LOGO_PUBLISHABLE_FINGERPRINT = (
    "6f39c79ee7d9a4da9fac8451cda142799d1d99bb6a8222a8b3a941dd2c55cf38"
)

# ADR 0070, amended. What the codec wrote for a logo before the mark colour was chosen
# (commit fcaa115): `identity()` with a compass on Ochre, as `shop-payload-v2`. A stored v2
# logo must still read — drawn in the derived Ink — and render back to these exact bytes.
V2_LOGO_DOCUMENT = (
    b'{"canonical_schema_version":"shop-payload-v2","faq":[],"fulfilment_methods":[],'
    b'"identity":{"channels":["chat"],"currencies":["EUR"],"locale":"en-GB",'
    b'"name":"Northstar Outfitters","slug":"northstar"},'
    b'"logo":{"background":"ochre","mark":"compass"},"payment_methods":[],"policies":[],'
    b'"products":[],"support_guidelines":[],"tone_of_voice_guidelines":[]}'
)
V2_LOGO_FINGERPRINT = "60552fc256f6a83e4e622f1e70323d81146de24a36f83d18875adf5c7ad8af13"
