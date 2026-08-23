"""Typed shop configuration: identity, catalog, and support knowledge.

A shop payload is the authored content of a `shop` definition. Structural invariants that
can never be true of a coherent shop are enforced at construction; completeness rules that
an author is expected to satisfy over time are reported by `validate_shop` so a draft can
stay incomplete until it is published.
"""

from __future__ import annotations

import re
from collections.abc import Callable
from dataclasses import dataclass, field
from decimal import Decimal
from enum import StrEnum

from capability_lab.domain.entities import DomainError

MAX_TEXT_LENGTH = 4000
MAX_LABEL_LENGTH = 200
MAX_SLUG_LENGTH = 64
MIN_REVIEW_RATING = 1
MAX_REVIEW_RATING = 5

_SLUG_PATTERN = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*")
_LOCALE_PATTERN = re.compile(r"[a-z]{2}(?:-[A-Z]{2})?")
_SKU_PATTERN = re.compile(r"[A-Z0-9]+(?:-[A-Z0-9]+)*")


class ShopConfigurationError(DomainError):
    """Raised when shop content violates a structural invariant."""


def _require_slug(value: object, field_name: str) -> str:
    if not isinstance(value, str) or _SLUG_PATTERN.fullmatch(value) is None:
        raise ShopConfigurationError(f"{field_name} must be a lowercase kebab-case identifier")
    if len(value) > MAX_SLUG_LENGTH:
        raise ShopConfigurationError(
            f"{field_name} must contain at most {MAX_SLUG_LENGTH} characters"
        )
    return value


def _require_label(value: object, field_name: str) -> str:
    if not isinstance(value, str) or not value.strip() or value != value.strip():
        raise ShopConfigurationError(f"{field_name} must be non-empty text without padding")
    if len(value) > MAX_LABEL_LENGTH:
        raise ShopConfigurationError(
            f"{field_name} must contain at most {MAX_LABEL_LENGTH} characters"
        )
    return value


def _require_text(value: object, field_name: str, *, allow_empty: bool = False) -> str:
    if not isinstance(value, str) or value != value.strip():
        raise ShopConfigurationError(f"{field_name} must be text without surrounding whitespace")
    if not allow_empty and not value:
        raise ShopConfigurationError(f"{field_name} must not be empty")
    if len(value) > MAX_TEXT_LENGTH:
        raise ShopConfigurationError(
            f"{field_name} must contain at most {MAX_TEXT_LENGTH} characters"
        )
    return value


def _require_unique(values: tuple[str, ...], field_name: str) -> None:
    if len(set(values)) != len(values):
        raise ShopConfigurationError(f"{field_name} must be unique")


def _require_non_negative_int(value: object, field_name: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise ShopConfigurationError(f"{field_name} must be a non-negative integer")
    return value


def _require_instance(value: object, expected: type, message: str) -> None:
    """Guard a typed field against callers that bypass static checking."""
    if not isinstance(value, expected):
        raise ShopConfigurationError(message)


def _require_bool(value: object, field_name: str) -> None:
    _require_instance(value, bool, f"{field_name} must be a boolean")


def _require_integer_in_range(value: object, minimum: int, maximum: int, field_name: str) -> None:
    if isinstance(value, bool) or not isinstance(value, int) or not minimum <= value <= maximum:
        raise ShopConfigurationError(
            f"{field_name} must be an integer between {minimum} and {maximum}"
        )


class Currency(StrEnum):
    """Currencies the lab can express; extend deliberately, never from authored input."""

    EUR = "EUR"
    USD = "USD"
    GBP = "GBP"


@dataclass(frozen=True, slots=True)
class Money:
    """An exact minor-unit-safe amount; never a binary float."""

    amount: Decimal
    currency: Currency

    def __post_init__(self) -> None:
        _require_instance(self.currency, Currency, "money must use a supported currency")
        _require_instance(self.amount, Decimal, "money amount must be a finite decimal")
        if not self.amount.is_finite():
            raise ShopConfigurationError("money amount must be a finite decimal")
        if self.amount < 0:
            raise ShopConfigurationError("money amount cannot be negative")
        exponent = self.amount.as_tuple().exponent
        if not isinstance(exponent, int) or exponent < -2:
            raise ShopConfigurationError("money amount cannot have more than two fractional digits")

    @property
    def canonical_amount(self) -> str:
        return f"{self.amount:.2f}"


class ProductStatus(StrEnum):
    DRAFT = "draft"
    ACTIVE = "active"
    ARCHIVED = "archived"


class VariantAvailability(StrEnum):
    IN_STOCK = "in_stock"
    BACKORDER = "backorder"
    OUT_OF_STOCK = "out_of_stock"
    DISCONTINUED = "discontinued"


class AttributeType(StrEnum):
    """The first bounded set of author-defined typed attributes."""

    TEXT = "text"
    NUMBER = "number"
    BOOLEAN = "boolean"
    CHOICE = "choice"
    MEASUREMENT = "measurement"


class PolicyKind(StrEnum):
    RETURNS = "returns"
    SHIPPING = "shipping"
    CANCELLATION = "cancellation"
    PRIVACY = "privacy"
    WARRANTY = "warranty"
    TERMS = "terms"


class PaymentMethodKind(StrEnum):
    CARD = "card"
    WALLET = "wallet"
    BANK_TRANSFER = "bank_transfer"
    GIFT_CARD = "gift_card"


class SupportChannel(StrEnum):
    CHAT = "chat"
    EMAIL = "email"
    PHONE = "phone"


@dataclass(frozen=True, slots=True)
class OptionDefinition:
    """A named product option such as size or color and its ordered values."""

    key: str
    name: str
    values: tuple[str, ...]

    def __post_init__(self) -> None:
        _require_slug(self.key, "option key")
        _require_label(self.name, "option name")
        if not self.values:
            raise ShopConfigurationError("an option definition must declare at least one value")
        for value in self.values:
            _require_label(value, "option value")
        _require_unique(self.values, "option values")


@dataclass(frozen=True, slots=True)
class TypedAttribute:
    """An administrator-defined typed attribute; never unvalidated free-form JSON."""

    key: str
    label: str
    attribute_type: AttributeType
    value: str
    unit: str | None = None
    choices: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        _require_slug(self.key, "attribute key")
        _require_label(self.label, "attribute label")
        _require_instance(
            self.attribute_type,
            AttributeType,
            "attribute type must be a supported attribute type",
        )
        _require_label(self.value, "attribute value")
        if self.attribute_type is AttributeType.NUMBER:
            _require_decimal_text(self.value, "number attribute value")
        if self.attribute_type is AttributeType.BOOLEAN and self.value not in {"true", "false"}:
            raise ShopConfigurationError("boolean attribute value must be 'true' or 'false'")
        if self.attribute_type is AttributeType.MEASUREMENT:
            _require_decimal_text(self.value, "measurement attribute value")
            if self.unit is None:
                raise ShopConfigurationError("a measurement attribute must declare a unit")
        elif self.unit is not None:
            raise ShopConfigurationError(f"a {self.attribute_type} attribute cannot declare a unit")
        if self.unit is not None:
            _require_label(self.unit, "attribute unit")
        if self.attribute_type is AttributeType.CHOICE:
            if not self.choices:
                raise ShopConfigurationError("a choice attribute must declare its choices")
            for choice in self.choices:
                _require_label(choice, "attribute choice")
            _require_unique(self.choices, "attribute choices")
            if self.value not in self.choices:
                raise ShopConfigurationError("choice attribute value must be one of its choices")
        elif self.choices:
            raise ShopConfigurationError(
                f"a {self.attribute_type} attribute cannot declare choices"
            )


def _require_decimal_text(value: str, field_name: str) -> None:
    try:
        parsed = Decimal(value)
    except ArithmeticError as error:
        raise ShopConfigurationError(f"{field_name} must be a decimal number") from error
    if not parsed.is_finite():
        raise ShopConfigurationError(f"{field_name} must be a finite decimal number")


@dataclass(frozen=True, slots=True)
class MediaReference:
    """URL or path metadata only; managed binary upload is deferred."""

    reference: str
    alt_text: str

    def __post_init__(self) -> None:
        _require_text(self.reference, "media reference")
        _require_label(self.alt_text, "media alt text")


@dataclass(frozen=True, slots=True)
class ProductVariant:
    """A sellable variant. Price stays optional so an unfinished draft can be saved."""

    sku: str
    option_values: tuple[tuple[str, str], ...]
    availability: VariantAvailability
    stock_quantity: int
    price: Money | None = None

    def __post_init__(self) -> None:
        _require_instance(self.sku, str, "variant SKU must be uppercase alphanumeric kebab-case")
        if _SKU_PATTERN.fullmatch(self.sku) is None:
            raise ShopConfigurationError("variant SKU must be uppercase alphanumeric kebab-case")
        if len(self.sku) > MAX_SLUG_LENGTH:
            raise ShopConfigurationError(
                f"variant SKU must contain at most {MAX_SLUG_LENGTH} characters"
            )
        _require_instance(
            self.availability,
            VariantAvailability,
            "variant availability must be a supported value",
        )
        _require_non_negative_int(self.stock_quantity, "variant stock quantity")
        if self.price is not None:
            _require_instance(self.price, Money, "variant price must be money")
        keys = tuple(key for key, _ in self.option_values)
        for key, value in self.option_values:
            _require_slug(key, "variant option key")
            _require_label(value, "variant option value")
        _require_unique(keys, "variant option keys")


@dataclass(frozen=True, slots=True)
class ProductReview:
    """A synthetic customer review; ratings are derived from the reviews on a product."""

    id: str
    author_display_name: str
    rating: int
    body: str

    def __post_init__(self) -> None:
        _require_slug(self.id, "review ID")
        _require_label(self.author_display_name, "review author")
        _require_integer_in_range(
            self.rating, MIN_REVIEW_RATING, MAX_REVIEW_RATING, "review rating"
        )
        _require_text(self.body, "review body")


@dataclass(frozen=True, slots=True)
class RatingSummary:
    """Derived rating evidence; authors edit reviews, never the aggregate."""

    review_count: int
    average_rating: Decimal | None


@dataclass(frozen=True, slots=True)
class Product:
    handle: str
    title: str
    description: str
    status: ProductStatus
    category: str
    options: tuple[OptionDefinition, ...] = ()
    variants: tuple[ProductVariant, ...] = ()
    media: tuple[MediaReference, ...] = ()
    attributes: tuple[TypedAttribute, ...] = ()
    reviews: tuple[ProductReview, ...] = ()

    def __post_init__(self) -> None:
        _require_slug(self.handle, "product handle")
        _require_label(self.title, "product title")
        _require_text(self.description, "product description", allow_empty=True)
        _require_instance(self.status, ProductStatus, "product status must be a supported status")
        _require_label(self.category, "product category")
        _require_unique(tuple(option.key for option in self.options), "product option keys")
        _require_unique(tuple(variant.sku for variant in self.variants), "product variant SKUs")
        _require_unique(tuple(review.id for review in self.reviews), "product review IDs")
        _require_unique(
            tuple(attribute.key for attribute in self.attributes), "product attribute keys"
        )
        _require_unique(
            tuple(reference.reference for reference in self.media), "product media references"
        )

    @property
    def ratings(self) -> RatingSummary:
        if not self.reviews:
            return RatingSummary(review_count=0, average_rating=None)
        total = sum(review.rating for review in self.reviews)
        average = (Decimal(total) / Decimal(len(self.reviews))).quantize(Decimal("0.1"))
        return RatingSummary(review_count=len(self.reviews), average_rating=average)


@dataclass(frozen=True, slots=True)
class FaqEntry:
    id: str
    question: str
    answer: str

    def __post_init__(self) -> None:
        _require_slug(self.id, "FAQ entry ID")
        _require_label(self.question, "FAQ question")
        _require_text(self.answer, "FAQ answer")


@dataclass(frozen=True, slots=True)
class PolicyDocument:
    id: str
    title: str
    kind: PolicyKind
    body: str

    def __post_init__(self) -> None:
        _require_slug(self.id, "policy ID")
        _require_label(self.title, "policy title")
        _require_instance(self.kind, PolicyKind, "policy kind must be a supported kind")
        _require_text(self.body, "policy body")


@dataclass(frozen=True, slots=True)
class PaymentMethod:
    id: str
    name: str
    kind: PaymentMethodKind
    enabled: bool

    def __post_init__(self) -> None:
        _require_slug(self.id, "payment method ID")
        _require_label(self.name, "payment method name")
        _require_instance(
            self.kind, PaymentMethodKind, "payment method kind must be a supported kind"
        )
        _require_bool(self.enabled, "payment method enabled")


@dataclass(frozen=True, slots=True)
class FulfilmentMethod:
    id: str
    name: str
    carrier: str
    min_transit_days: int
    max_transit_days: int

    def __post_init__(self) -> None:
        _require_slug(self.id, "fulfilment method ID")
        _require_label(self.name, "fulfilment method name")
        _require_label(self.carrier, "fulfilment carrier")
        _require_non_negative_int(self.min_transit_days, "minimum transit days")
        _require_non_negative_int(self.max_transit_days, "maximum transit days")
        if self.max_transit_days < self.min_transit_days:
            raise ShopConfigurationError(
                "maximum transit days cannot be shorter than minimum transit days"
            )


@dataclass(frozen=True, slots=True)
class SupportGuideline:
    id: str
    title: str
    body: str

    def __post_init__(self) -> None:
        _require_slug(self.id, "support guideline ID")
        _require_label(self.title, "support guideline title")
        _require_text(self.body, "support guideline body")


@dataclass(frozen=True, slots=True)
class ToneOfVoiceGuideline:
    """A named tone of voice owned by the shop; agent configurations select one."""

    id: str
    name: str
    guidance: str
    is_default: bool = False

    def __post_init__(self) -> None:
        _require_slug(self.id, "tone-of-voice ID")
        _require_label(self.name, "tone-of-voice name")
        _require_text(self.guidance, "tone-of-voice guidance")
        _require_bool(self.is_default, "tone-of-voice default flag")


@dataclass(frozen=True, slots=True)
class ShopIdentity:
    name: str
    slug: str
    locale: str
    currencies: tuple[Currency, ...]
    channels: tuple[SupportChannel, ...]

    def __post_init__(self) -> None:
        _require_label(self.name, "shop name")
        _require_slug(self.slug, "shop slug")
        if _LOCALE_PATTERN.fullmatch(self.locale) is None:
            raise ShopConfigurationError("shop locale must look like 'en' or 'en-GB'")
        if not self.currencies:
            raise ShopConfigurationError("a shop must declare at least one currency")
        for currency in self.currencies:
            _require_instance(currency, Currency, "shop currencies must be supported currencies")
        _require_unique(tuple(currency.value for currency in self.currencies), "shop currencies")
        if not self.channels:
            raise ShopConfigurationError("a shop must declare at least one support channel")
        for channel in self.channels:
            _require_instance(
                channel, SupportChannel, "shop channels must be supported support channels"
            )
        _require_unique(tuple(channel.value for channel in self.channels), "shop channels")

    @property
    def default_currency(self) -> Currency:
        return self.currencies[0]


@dataclass(frozen=True, slots=True)
class ShopPayload:
    """The complete authored content of one shop draft or published version."""

    identity: ShopIdentity
    products: tuple[Product, ...] = ()
    faq: tuple[FaqEntry, ...] = ()
    policies: tuple[PolicyDocument, ...] = ()
    payment_methods: tuple[PaymentMethod, ...] = ()
    fulfilment_methods: tuple[FulfilmentMethod, ...] = ()
    support_guidelines: tuple[SupportGuideline, ...] = ()
    tone_of_voice_guidelines: tuple[ToneOfVoiceGuideline, ...] = ()

    def __post_init__(self) -> None:
        _require_instance(self.identity, ShopIdentity, "a shop payload must declare its identity")
        _require_unique(tuple(product.handle for product in self.products), "product handles")
        _require_unique(tuple(entry.id for entry in self.faq), "FAQ entry IDs")
        _require_unique(tuple(policy.id for policy in self.policies), "policy IDs")
        _require_unique(tuple(method.id for method in self.payment_methods), "payment method IDs")
        _require_unique(
            tuple(method.id for method in self.fulfilment_methods), "fulfilment method IDs"
        )
        _require_unique(
            tuple(guideline.id for guideline in self.support_guidelines),
            "support guideline IDs",
        )
        _require_unique(
            tuple(guideline.id for guideline in self.tone_of_voice_guidelines),
            "tone-of-voice IDs",
        )
        _require_unique(
            tuple(variant.sku for product in self.products for variant in product.variants),
            "variant SKUs across the shop",
        )
        defaults = [
            guideline for guideline in self.tone_of_voice_guidelines if guideline.is_default
        ]
        if len(defaults) > 1:
            raise ShopConfigurationError("a shop can declare at most one default tone of voice")

    @property
    def default_tone_of_voice(self) -> ToneOfVoiceGuideline | None:
        for guideline in self.tone_of_voice_guidelines:
            if guideline.is_default:
                return guideline
        return None


class ShopIssueSeverity(StrEnum):
    ERROR = "error"
    WARNING = "warning"


@dataclass(frozen=True, slots=True)
class ShopIssue:
    """One publish-gate finding. Errors block publication; warnings never do."""

    severity: ShopIssueSeverity
    code: str
    message: str
    path: str


@dataclass(frozen=True, slots=True)
class ShopValidation:
    issues: tuple[ShopIssue, ...] = field(default=())

    @property
    def errors(self) -> tuple[ShopIssue, ...]:
        return tuple(issue for issue in self.issues if issue.severity is ShopIssueSeverity.ERROR)

    @property
    def warnings(self) -> tuple[ShopIssue, ...]:
        return tuple(issue for issue in self.issues if issue.severity is ShopIssueSeverity.WARNING)

    @property
    def publishable(self) -> bool:
        return not self.errors


def _error(code: str, message: str, path: str) -> ShopIssue:
    return ShopIssue(severity=ShopIssueSeverity.ERROR, code=code, message=message, path=path)


def _warning(code: str, message: str, path: str) -> ShopIssue:
    return ShopIssue(severity=ShopIssueSeverity.WARNING, code=code, message=message, path=path)


def _validate_product(product: Product, payload: ShopPayload) -> list[ShopIssue]:
    path = f"products.{product.handle}"
    issues: list[ShopIssue] = []
    if not product.variants:
        issues.append(
            _error(
                "product_without_variant",
                f"product {product.title} has no sellable variant",
                path,
            )
        )
    if not product.description:
        issues.append(
            _warning(
                "product_without_description",
                f"product {product.title} has no description for support agents to read",
                path,
            )
        )
    if not product.media:
        issues.append(
            _warning(
                "product_without_media",
                f"product {product.title} has no media reference",
                path,
            )
        )

    option_values = {option.key: set(option.values) for option in product.options}
    for variant in product.variants:
        variant_path = f"{path}.variants.{variant.sku}"
        if variant.price is None:
            issues.append(
                _error(
                    "variant_without_price",
                    f"variant {variant.sku} is missing a price",
                    variant_path,
                )
            )
        elif variant.price.currency not in payload.identity.currencies:
            issues.append(
                _error(
                    "variant_currency_unsupported",
                    f"variant {variant.sku} is priced in {variant.price.currency}, "
                    "which the shop does not sell in",
                    variant_path,
                )
            )
        declared = {key for key, _ in variant.option_values}
        for key in sorted(option_values.keys() - declared):
            issues.append(
                _error(
                    "variant_missing_option",
                    f"variant {variant.sku} does not choose a value for option {key}",
                    variant_path,
                )
            )
        for key, value in variant.option_values:
            if key not in option_values:
                issues.append(
                    _error(
                        "variant_unknown_option",
                        f"variant {variant.sku} uses undeclared option {key}",
                        variant_path,
                    )
                )
            elif value not in option_values[key]:
                issues.append(
                    _error(
                        "variant_unknown_option_value",
                        f"variant {variant.sku} uses value {value}, "
                        f"which option {key} does not declare",
                        variant_path,
                    )
                )
        if variant.availability is VariantAvailability.IN_STOCK and variant.stock_quantity == 0:
            issues.append(
                _error(
                    "variant_in_stock_without_inventory",
                    f"variant {variant.sku} is in stock but holds no inventory",
                    variant_path,
                )
            )

    combinations = [tuple(sorted(variant.option_values)) for variant in product.variants]
    if len(set(combinations)) != len(combinations):
        issues.append(
            _error(
                "duplicate_variant_options",
                f"product {product.title} has two variants with the same option values",
                path,
            )
        )
    return issues


def validate_shop(payload: ShopPayload) -> ShopValidation:
    """Report every publish-gate finding for a shop draft, errors before warnings."""
    issues: list[ShopIssue] = []
    if not payload.products:
        issues.append(
            _error(
                "shop_without_product",
                "a published shop must sell at least one product",
                "products",
            )
        )
    for product in payload.products:
        issues.extend(_validate_product(product, payload))

    if not payload.tone_of_voice_guidelines:
        issues.append(
            _error(
                "shop_without_tone_of_voice",
                "a published shop must define at least one tone-of-voice guideline",
                "tone_of_voice_guidelines",
            )
        )
    elif payload.default_tone_of_voice is None:
        issues.append(
            _error(
                "tone_of_voice_without_default",
                "one tone-of-voice guideline must be the shop default",
                "tone_of_voice_guidelines",
            )
        )

    if not any(method.enabled for method in payload.payment_methods):
        issues.append(
            _error(
                "shop_without_payment_method",
                "a published shop must enable at least one payment method",
                "payment_methods",
            )
        )
    if not payload.fulfilment_methods:
        issues.append(
            _error(
                "shop_without_fulfilment_method",
                "a published shop must offer at least one fulfilment method",
                "fulfilment_methods",
            )
        )
    if not payload.policies:
        issues.append(
            _error(
                "shop_without_policy",
                "a published shop must publish at least one policy for support tools to read",
                "policies",
            )
        )
    if not payload.faq:
        issues.append(
            _warning("shop_without_faq", "the shop's FAQ section has no entries yet", "faq")
        )
    if not payload.support_guidelines:
        issues.append(
            _warning(
                "shop_without_support_guideline",
                "the shop has no support guidelines for the agent to consult",
                "support_guidelines",
            )
        )

    return ShopValidation(
        issues=tuple(
            sorted(
                issues,
                key=lambda issue: (
                    issue.severity is ShopIssueSeverity.WARNING,
                    issue.path,
                    issue.code,
                ),
            )
        )
    )


class ShopChangeKind(StrEnum):
    ADDED = "added"
    REMOVED = "removed"
    UPDATED = "updated"


@dataclass(frozen=True, slots=True)
class ShopChange:
    """One authored difference between a shop draft and its latest published version."""

    kind: ShopChangeKind
    path: str
    description: str


def _keyed[EntryT](entries: tuple[EntryT, ...], key: Callable[[EntryT], str]) -> dict[str, EntryT]:
    return {key(entry): entry for entry in entries}


def _diff_collection[EntryT](
    previous: tuple[EntryT, ...],
    current: tuple[EntryT, ...],
    *,
    key: Callable[[EntryT], str],
    label: Callable[[EntryT], str],
    path: str,
    noun: str,
    include_updates: bool = True,
) -> list[ShopChange]:
    """Diff one keyed collection.

    `include_updates=False` reports only membership, for collections whose entries are
    diffed field by field elsewhere; otherwise one edit would be reported twice.
    """
    before = _keyed(previous, key)
    after = _keyed(current, key)
    changes: list[ShopChange] = []
    for identifier in sorted(after.keys() - before.keys()):
        changes.append(
            ShopChange(
                kind=ShopChangeKind.ADDED,
                path=f"{path}.{identifier}",
                description=f"Added {noun} {label(after[identifier])}",
            )
        )
    for identifier in sorted(before.keys() - after.keys()):
        changes.append(
            ShopChange(
                kind=ShopChangeKind.REMOVED,
                path=f"{path}.{identifier}",
                description=f"Removed {noun} {label(before[identifier])}",
            )
        )
    if include_updates:
        for identifier in sorted(before.keys() & after.keys()):
            if before[identifier] != after[identifier]:
                changes.append(
                    ShopChange(
                        kind=ShopChangeKind.UPDATED,
                        path=f"{path}.{identifier}",
                        description=f"Updated {noun} {label(after[identifier])}",
                    )
                )
    return changes


def _diff_product(previous: Product, current: Product) -> list[ShopChange]:
    path = f"products.{current.handle}"
    changes: list[ShopChange] = []
    for field_name, before, after in (
        ("title", previous.title, current.title),
        ("description", previous.description, current.description),
        ("status", previous.status.value, current.status.value),
        ("category", previous.category, current.category),
    ):
        if before != after:
            changes.append(
                ShopChange(
                    kind=ShopChangeKind.UPDATED,
                    path=f"{path}.{field_name}",
                    description=f"Updated {current.title} {field_name}",
                )
            )
    changes.extend(
        _diff_collection(
            previous.options,
            current.options,
            key=lambda option: option.key,
            label=lambda option: option.name,
            path=f"{path}.options",
            noun="option",
        )
    )
    changes.extend(
        _diff_collection(
            previous.variants,
            current.variants,
            key=lambda variant: variant.sku,
            label=lambda variant: variant.sku,
            path=f"{path}.variants",
            noun="variant",
        )
    )
    changes.extend(
        _diff_collection(
            previous.attributes,
            current.attributes,
            key=lambda attribute: attribute.key,
            label=lambda attribute: attribute.label,
            path=f"{path}.attributes",
            noun="attribute",
        )
    )
    changes.extend(
        _diff_collection(
            previous.media,
            current.media,
            key=lambda reference: reference.reference,
            label=lambda reference: reference.reference,
            path=f"{path}.media",
            noun="media reference",
        )
    )
    changes.extend(
        _diff_collection(
            previous.reviews,
            current.reviews,
            key=lambda review: review.id,
            label=lambda review: review.author_display_name,
            path=f"{path}.reviews",
            noun="review",
        )
    )
    return changes


def summarize_shop_changes(
    previous: ShopPayload | None, current: ShopPayload
) -> tuple[ShopChange, ...]:
    """Describe what a publish would freeze, relative to the latest published version."""
    if previous is None:
        return (
            ShopChange(
                kind=ShopChangeKind.ADDED,
                path="",
                description=f"First published version of {current.identity.name}",
            ),
        )

    changes: list[ShopChange] = []
    if previous.identity != current.identity:
        changes.append(
            ShopChange(
                kind=ShopChangeKind.UPDATED,
                path="identity",
                description="Updated shop identity",
            )
        )

    before_products = _keyed(previous.products, lambda product: product.handle)
    after_products = _keyed(current.products, lambda product: product.handle)
    changes.extend(
        _diff_collection(
            previous.products,
            current.products,
            key=lambda product: product.handle,
            label=lambda product: product.title,
            path="products",
            noun="product",
            # A changed product is described by its own field-level and sub-entry diff.
            include_updates=False,
        )
    )
    for handle in sorted(before_products.keys() & after_products.keys()):
        changes.extend(_diff_product(before_products[handle], after_products[handle]))

    changes.extend(
        _diff_collection(
            previous.faq,
            current.faq,
            key=lambda entry: entry.id,
            label=lambda entry: entry.question,
            path="faq",
            noun="FAQ entry",
        )
    )
    changes.extend(
        _diff_collection(
            previous.policies,
            current.policies,
            key=lambda policy: policy.id,
            label=lambda policy: policy.title,
            path="policies",
            noun="policy",
        )
    )
    changes.extend(
        _diff_collection(
            previous.payment_methods,
            current.payment_methods,
            key=lambda method: method.id,
            label=lambda method: method.name,
            path="payment_methods",
            noun="payment method",
        )
    )
    changes.extend(
        _diff_collection(
            previous.fulfilment_methods,
            current.fulfilment_methods,
            key=lambda method: method.id,
            label=lambda method: method.name,
            path="fulfilment_methods",
            noun="fulfilment method",
        )
    )
    changes.extend(
        _diff_collection(
            previous.support_guidelines,
            current.support_guidelines,
            key=lambda guideline: guideline.id,
            label=lambda guideline: guideline.title,
            path="support_guidelines",
            noun="support guideline",
        )
    )
    changes.extend(
        _diff_collection(
            previous.tone_of_voice_guidelines,
            current.tone_of_voice_guidelines,
            key=lambda guideline: guideline.id,
            label=lambda guideline: guideline.name,
            path="tone_of_voice_guidelines",
            noun="tone of voice",
        )
    )

    return tuple(changes)
