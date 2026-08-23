"""Shared shop fixtures for the domain, payload, service, and API test modules."""

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
