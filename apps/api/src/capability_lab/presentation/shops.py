"""Public v1 contract for shop authoring, validation, publication, and versions."""

from collections.abc import Callable, Generator
from decimal import Decimal, InvalidOperation
from typing import Annotated, Literal, Self
from uuid import UUID

from fastapi import APIRouter, Depends, Path
from pydantic import Field

from capability_lab.application.shops import (
    ShopDraftPreview,
    ShopDraftRecord,
    ShopService,
    ShopSummary,
    ShopVersionRecord,
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
    ShopPayload,
    SupportChannel,
    SupportGuideline,
    ToneOfVoiceGuideline,
    TypedAttribute,
    VariantAvailability,
)
from capability_lab.presentation.base import StrictApiModel
from capability_lab.presentation.definitions import (
    Body,
    DefinitionChangeSchema,
    DefinitionIssueSchema,
    DefinitionVersionPath,
    DefinitionVersionSummarySchema,
    InvalidResponses,
    Label,
    Locale,
    NotFoundResponses,
    PublishFailureResponses,
    Slug,
)

ShopIdPath = Annotated[UUID, Path(description="Stable shop definition identifier.")]

Sku = Annotated[str, Field(min_length=1, max_length=64, pattern=r"^[A-Z0-9]+(?:-[A-Z0-9]+)*$")]
MoneyAmount = Annotated[str, Field(pattern=r"^\d{1,10}(?:\.\d{1,2})?$")]


class MoneySchema(StrictApiModel):
    amount: MoneyAmount = Field(description="Exact decimal amount; never a binary float.")
    currency: Currency

    @classmethod
    def from_domain(cls, money: Money) -> Self:
        return cls(amount=money.canonical_amount, currency=money.currency)

    def to_domain(self) -> Money:
        try:
            amount = Decimal(self.amount)
        except InvalidOperation as error:  # pragma: no cover - the pattern already rejects this
            raise ValueError("amount must be a decimal number") from error
        return Money(amount=amount, currency=self.currency)


class OptionSchema(StrictApiModel):
    key: Slug
    name: Label
    values: list[Label] = Field(min_length=1)

    @classmethod
    def from_domain(cls, option: OptionDefinition) -> Self:
        return cls(key=option.key, name=option.name, values=list(option.values))

    def to_domain(self) -> OptionDefinition:
        return OptionDefinition(key=self.key, name=self.name, values=tuple(self.values))


class VariantOptionValueSchema(StrictApiModel):
    key: Slug
    value: Label


class VariantSchema(StrictApiModel):
    sku: Sku
    option_values: list[VariantOptionValueSchema]
    availability: VariantAvailability
    stock_quantity: int = Field(ge=0)
    price: MoneySchema | None = Field(description="Null while a draft variant is still unpriced.")

    @classmethod
    def from_domain(cls, variant: ProductVariant) -> Self:
        return cls(
            sku=variant.sku,
            option_values=[
                VariantOptionValueSchema(key=key, value=value)
                for key, value in variant.option_values
            ],
            availability=variant.availability,
            stock_quantity=variant.stock_quantity,
            price=None if variant.price is None else MoneySchema.from_domain(variant.price),
        )

    def to_domain(self) -> ProductVariant:
        return ProductVariant(
            sku=self.sku,
            option_values=tuple((entry.key, entry.value) for entry in self.option_values),
            availability=self.availability,
            stock_quantity=self.stock_quantity,
            price=None if self.price is None else self.price.to_domain(),
        )


class AttributeSchema(StrictApiModel):
    key: Slug
    label: Label
    attribute_type: AttributeType
    value: Label
    unit: Label | None
    choices: list[Label]

    @classmethod
    def from_domain(cls, attribute: TypedAttribute) -> Self:
        return cls(
            key=attribute.key,
            label=attribute.label,
            attribute_type=attribute.attribute_type,
            value=attribute.value,
            unit=attribute.unit,
            choices=list(attribute.choices),
        )

    def to_domain(self) -> TypedAttribute:
        return TypedAttribute(
            key=self.key,
            label=self.label,
            attribute_type=self.attribute_type,
            value=self.value,
            unit=self.unit,
            choices=tuple(self.choices),
        )


class MediaReferenceSchema(StrictApiModel):
    reference: Body = Field(description="URL or path metadata; managed upload is deferred.")
    alt_text: Label

    @classmethod
    def from_domain(cls, reference: MediaReference) -> Self:
        return cls(reference=reference.reference, alt_text=reference.alt_text)

    def to_domain(self) -> MediaReference:
        return MediaReference(reference=self.reference, alt_text=self.alt_text)


class ReviewSchema(StrictApiModel):
    id: Slug
    author_display_name: Label
    rating: int = Field(ge=1, le=5)
    body: Body

    @classmethod
    def from_domain(cls, review: ProductReview) -> Self:
        return cls(
            id=review.id,
            author_display_name=review.author_display_name,
            rating=review.rating,
            body=review.body,
        )

    def to_domain(self) -> ProductReview:
        return ProductReview(
            id=self.id,
            author_display_name=self.author_display_name,
            rating=self.rating,
            body=self.body,
        )


class RatingSummarySchema(StrictApiModel):
    review_count: int
    average_rating: str | None = Field(
        description="Derived from the product's reviews; never authored directly."
    )


class ProductSchema(StrictApiModel):
    handle: Slug
    title: Label
    description: Annotated[str, Field(max_length=4000)]
    status: ProductStatus
    category: Label
    options: list[OptionSchema]
    variants: list[VariantSchema]
    media: list[MediaReferenceSchema]
    attributes: list[AttributeSchema]
    reviews: list[ReviewSchema]

    @classmethod
    def from_domain(cls, product: Product) -> Self:
        return cls(
            handle=product.handle,
            title=product.title,
            description=product.description,
            status=product.status,
            category=product.category,
            options=[OptionSchema.from_domain(option) for option in product.options],
            variants=[VariantSchema.from_domain(variant) for variant in product.variants],
            media=[MediaReferenceSchema.from_domain(entry) for entry in product.media],
            attributes=[AttributeSchema.from_domain(entry) for entry in product.attributes],
            reviews=[ReviewSchema.from_domain(review) for review in product.reviews],
        )

    def to_domain(self) -> Product:
        return Product(
            handle=self.handle,
            title=self.title,
            description=self.description,
            status=self.status,
            category=self.category,
            options=tuple(option.to_domain() for option in self.options),
            variants=tuple(variant.to_domain() for variant in self.variants),
            media=tuple(entry.to_domain() for entry in self.media),
            attributes=tuple(entry.to_domain() for entry in self.attributes),
            reviews=tuple(review.to_domain() for review in self.reviews),
        )


class ProductViewSchema(ProductSchema):
    """A product as the API returns it, including its derived rating evidence."""

    ratings: RatingSummarySchema

    @classmethod
    def from_domain(cls, product: Product) -> Self:
        ratings = product.ratings
        return cls(
            **ProductSchema.from_domain(product).model_dump(),
            ratings=RatingSummarySchema(
                review_count=ratings.review_count,
                average_rating=(
                    None if ratings.average_rating is None else format(ratings.average_rating, "f")
                ),
            ),
        )


class FaqEntrySchema(StrictApiModel):
    id: Slug
    question: Label
    answer: Body

    @classmethod
    def from_domain(cls, entry: FaqEntry) -> Self:
        return cls(id=entry.id, question=entry.question, answer=entry.answer)

    def to_domain(self) -> FaqEntry:
        return FaqEntry(id=self.id, question=self.question, answer=self.answer)


class PolicySchema(StrictApiModel):
    id: Slug
    title: Label
    kind: PolicyKind
    body: Body

    @classmethod
    def from_domain(cls, policy: PolicyDocument) -> Self:
        return cls(id=policy.id, title=policy.title, kind=policy.kind, body=policy.body)

    def to_domain(self) -> PolicyDocument:
        return PolicyDocument(id=self.id, title=self.title, kind=self.kind, body=self.body)


class PaymentMethodSchema(StrictApiModel):
    id: Slug
    name: Label
    kind: PaymentMethodKind
    enabled: bool

    @classmethod
    def from_domain(cls, method: PaymentMethod) -> Self:
        return cls(id=method.id, name=method.name, kind=method.kind, enabled=method.enabled)

    def to_domain(self) -> PaymentMethod:
        return PaymentMethod(id=self.id, name=self.name, kind=self.kind, enabled=self.enabled)


class FulfilmentMethodSchema(StrictApiModel):
    id: Slug
    name: Label
    carrier: Label
    min_transit_days: int = Field(ge=0, le=365)
    max_transit_days: int = Field(ge=0, le=365)

    @classmethod
    def from_domain(cls, method: FulfilmentMethod) -> Self:
        return cls(
            id=method.id,
            name=method.name,
            carrier=method.carrier,
            min_transit_days=method.min_transit_days,
            max_transit_days=method.max_transit_days,
        )

    def to_domain(self) -> FulfilmentMethod:
        return FulfilmentMethod(
            id=self.id,
            name=self.name,
            carrier=self.carrier,
            min_transit_days=self.min_transit_days,
            max_transit_days=self.max_transit_days,
        )


class SupportGuidelineSchema(StrictApiModel):
    id: Slug
    title: Label
    body: Body

    @classmethod
    def from_domain(cls, guideline: SupportGuideline) -> Self:
        return cls(id=guideline.id, title=guideline.title, body=guideline.body)

    def to_domain(self) -> SupportGuideline:
        return SupportGuideline(id=self.id, title=self.title, body=self.body)


class ToneOfVoiceSchema(StrictApiModel):
    id: Slug
    name: Label
    guidance: Body
    is_default: bool

    @classmethod
    def from_domain(cls, guideline: ToneOfVoiceGuideline) -> Self:
        return cls(
            id=guideline.id,
            name=guideline.name,
            guidance=guideline.guidance,
            is_default=guideline.is_default,
        )

    def to_domain(self) -> ToneOfVoiceGuideline:
        return ToneOfVoiceGuideline(
            id=self.id,
            name=self.name,
            guidance=self.guidance,
            is_default=self.is_default,
        )


class ShopIdentitySchema(StrictApiModel):
    name: Label
    slug: Slug
    locale: Locale
    currencies: list[Currency] = Field(min_length=1)
    channels: list[SupportChannel] = Field(min_length=1)

    @classmethod
    def from_domain(cls, identity: ShopIdentity) -> Self:
        return cls(
            name=identity.name,
            slug=identity.slug,
            locale=identity.locale,
            currencies=list(identity.currencies),
            channels=list(identity.channels),
        )

    def to_domain(self) -> ShopIdentity:
        return ShopIdentity(
            name=self.name,
            slug=self.slug,
            locale=self.locale,
            currencies=tuple(self.currencies),
            channels=tuple(self.channels),
        )


class ShopLogoSchema(StrictApiModel):
    """A mark on a named background; the lab derives the mark's colour from the background."""

    mark: ShopMark
    background: ShopLogoBackground

    @classmethod
    def from_domain(cls, logo: ShopLogo) -> Self:
        return cls(mark=logo.mark, background=logo.background)

    def to_domain(self) -> ShopLogo:
        return ShopLogo(mark=self.mark, background=self.background)


class ShopPayloadSchema(StrictApiModel):
    """The whole authored content of a shop draft or published version."""

    identity: ShopIdentitySchema
    products: list[ProductSchema]
    faq: list[FaqEntrySchema]
    policies: list[PolicySchema]
    payment_methods: list[PaymentMethodSchema]
    fulfilment_methods: list[FulfilmentMethodSchema]
    support_guidelines: list[SupportGuidelineSchema]
    tone_of_voice_guidelines: list[ToneOfVoiceSchema]
    logo: ShopLogoSchema | None = Field(
        default=None, description="The shop's logo; absent or null means the shop has none."
    )

    def to_domain(self) -> ShopPayload:
        return ShopPayload(
            identity=self.identity.to_domain(),
            products=tuple(product.to_domain() for product in self.products),
            faq=tuple(entry.to_domain() for entry in self.faq),
            policies=tuple(policy.to_domain() for policy in self.policies),
            payment_methods=tuple(method.to_domain() for method in self.payment_methods),
            fulfilment_methods=tuple(method.to_domain() for method in self.fulfilment_methods),
            support_guidelines=tuple(
                guideline.to_domain() for guideline in self.support_guidelines
            ),
            tone_of_voice_guidelines=tuple(
                guideline.to_domain() for guideline in self.tone_of_voice_guidelines
            ),
            logo=None if self.logo is None else self.logo.to_domain(),
        )


class ShopContentSchema(StrictApiModel):
    """A shop payload as the API returns it, with derived read-only evidence."""

    identity: ShopIdentitySchema
    products: list[ProductViewSchema]
    faq: list[FaqEntrySchema]
    policies: list[PolicySchema]
    payment_methods: list[PaymentMethodSchema]
    fulfilment_methods: list[FulfilmentMethodSchema]
    support_guidelines: list[SupportGuidelineSchema]
    tone_of_voice_guidelines: list[ToneOfVoiceSchema]
    default_tone_of_voice_id: str | None
    logo: ShopLogoSchema | None

    @classmethod
    def from_domain(cls, payload: ShopPayload) -> Self:
        default_tone = payload.default_tone_of_voice
        return cls(
            identity=ShopIdentitySchema.from_domain(payload.identity),
            products=[ProductViewSchema.from_domain(product) for product in payload.products],
            faq=[FaqEntrySchema.from_domain(entry) for entry in payload.faq],
            policies=[PolicySchema.from_domain(policy) for policy in payload.policies],
            payment_methods=[
                PaymentMethodSchema.from_domain(method) for method in payload.payment_methods
            ],
            fulfilment_methods=[
                FulfilmentMethodSchema.from_domain(method) for method in payload.fulfilment_methods
            ],
            support_guidelines=[
                SupportGuidelineSchema.from_domain(guideline)
                for guideline in payload.support_guidelines
            ],
            tone_of_voice_guidelines=[
                ToneOfVoiceSchema.from_domain(guideline)
                for guideline in payload.tone_of_voice_guidelines
            ],
            default_tone_of_voice_id=None if default_tone is None else default_tone.id,
            logo=None if payload.logo is None else ShopLogoSchema.from_domain(payload.logo),
        )


class CreateShopRequest(StrictApiModel):
    identity: ShopIdentitySchema
    logo: ShopLogoSchema | None = Field(
        default=None, description="The new shop's logo; absent or null means it has none."
    )


class ReplaceShopDraftRequest(StrictApiModel):
    payload: ShopPayloadSchema


class ShopDraftResponse(StrictApiModel):
    shop_id: UUID
    lifecycle_state: Literal["draft"] = "draft"
    content: ShopContentSchema
    created_at: str
    updated_at: str

    @classmethod
    def from_record(cls, record: ShopDraftRecord) -> Self:
        return cls(
            shop_id=record.definition.id,
            content=ShopContentSchema.from_domain(record.payload),
            created_at=record.created_at.isoformat(),
            updated_at=record.updated_at.isoformat(),
        )


class ShopVersionResponse(StrictApiModel):
    shop_id: UUID
    lifecycle_state: Literal["published"] = "published"
    version: int
    content_fingerprint: str
    published_at: str
    content: ShopContentSchema

    @classmethod
    def from_record(cls, record: ShopVersionRecord) -> Self:
        return cls(
            shop_id=record.published.definition.id,
            version=record.published.version,
            content_fingerprint=record.published.content_fingerprint,
            published_at=record.published.published_at.isoformat(),
            content=ShopContentSchema.from_domain(record.payload),
        )


class ShopVersionListResponse(StrictApiModel):
    versions: list[DefinitionVersionSummarySchema]


class ShopSummarySchema(StrictApiModel):
    shop_id: UUID
    name: str
    slug: str
    updated_at: str
    latest_published_version: int | None
    published_version_count: int
    logo: ShopLogoSchema | None

    @classmethod
    def from_domain(cls, summary: ShopSummary) -> Self:
        return cls(
            shop_id=summary.definition_id,
            name=summary.name,
            slug=summary.slug,
            updated_at=summary.updated_at.isoformat(),
            latest_published_version=summary.latest_published_version,
            published_version_count=summary.published_version_count,
            logo=None if summary.logo is None else ShopLogoSchema.from_domain(summary.logo),
        )


class ShopListResponse(StrictApiModel):
    shops: list[ShopSummarySchema]


class ShopPreviewResponse(StrictApiModel):
    """The publish gate: what blocks publication and what a publish would freeze."""

    shop_id: UUID
    publishable: bool
    issues: list[DefinitionIssueSchema]
    changes: list[DefinitionChangeSchema]
    content_fingerprint: str
    latest_published_version: int | None
    next_version: int
    matches_latest_published: bool
    content: ShopContentSchema

    @classmethod
    def from_preview(cls, shop_id: UUID, preview: ShopDraftPreview) -> Self:
        return cls(
            shop_id=shop_id,
            publishable=preview.validation.publishable,
            issues=[
                DefinitionIssueSchema.from_domain(issue) for issue in preview.validation.issues
            ],
            changes=[DefinitionChangeSchema.from_domain(change) for change in preview.changes],
            content_fingerprint=preview.content_fingerprint,
            latest_published_version=preview.latest_published_version,
            next_version=preview.next_version,
            matches_latest_published=preview.matches_latest_published,
            content=ShopContentSchema.from_domain(preview.payload),
        )


class ShopRoutes:
    """Route handlers bound to a request-scoped `ShopService` dependency."""

    def __init__(self, service: Callable[[], Generator[ShopService, None, None]]) -> None:
        self._service = service

    def register(self, router: APIRouter) -> None:
        dependency = Depends(self._service)

        def list_shops(service: Annotated[ShopService, dependency]) -> ShopListResponse:
            return ShopListResponse(
                shops=[ShopSummarySchema.from_domain(summary) for summary in service.list_shops()]
            )

        def create_shop(
            command: CreateShopRequest,
            service: Annotated[ShopService, dependency],
        ) -> ShopDraftResponse:
            return ShopDraftResponse.from_record(
                service.create_shop(
                    command.identity.to_domain(),
                    None if command.logo is None else command.logo.to_domain(),
                )
            )

        def get_shop_draft(
            shop_id: ShopIdPath,
            service: Annotated[ShopService, dependency],
        ) -> ShopDraftResponse:
            return ShopDraftResponse.from_record(service.get_draft(shop_id))

        def replace_shop_draft(
            shop_id: ShopIdPath,
            command: ReplaceShopDraftRequest,
            service: Annotated[ShopService, dependency],
        ) -> ShopDraftResponse:
            return ShopDraftResponse.from_record(
                service.replace_draft(shop_id, command.payload.to_domain())
            )

        def preview_shop_draft(
            shop_id: ShopIdPath,
            service: Annotated[ShopService, dependency],
        ) -> ShopPreviewResponse:
            return ShopPreviewResponse.from_preview(shop_id, service.preview_draft(shop_id))

        def publish_shop(
            shop_id: ShopIdPath,
            service: Annotated[ShopService, dependency],
        ) -> ShopVersionResponse:
            return ShopVersionResponse.from_record(service.publish(shop_id))

        def list_shop_versions(
            shop_id: ShopIdPath,
            service: Annotated[ShopService, dependency],
        ) -> ShopVersionListResponse:
            return ShopVersionListResponse(
                versions=[
                    DefinitionVersionSummarySchema.from_domain(published)
                    for published in service.list_versions(shop_id)
                ]
            )

        def get_shop_version(
            shop_id: ShopIdPath,
            version: DefinitionVersionPath,
            service: Annotated[ShopService, dependency],
        ) -> ShopVersionResponse:
            return ShopVersionResponse.from_record(service.get_version(shop_id, version))

        not_found = NotFoundResponses
        invalid = InvalidResponses
        publish_failures = PublishFailureResponses

        router.add_api_route(
            "/shops",
            list_shops,
            methods=["GET"],
            response_model=ShopListResponse,
            operation_id="listShops",
            summary="List shops with their draft identity and published-version provenance",
            responses=invalid,
        )
        router.add_api_route(
            "/shops",
            create_shop,
            methods=["POST"],
            status_code=201,
            response_model=ShopDraftResponse,
            operation_id="createShop",
            summary="Create a shop identity and its first draft",
            responses=invalid,
        )
        router.add_api_route(
            "/shops/{shop_id}/draft",
            get_shop_draft,
            methods=["GET"],
            response_model=ShopDraftResponse,
            operation_id="getShopDraft",
            summary="Retrieve the mutable shop draft",
            responses=not_found | invalid,
        )
        router.add_api_route(
            "/shops/{shop_id}/draft",
            replace_shop_draft,
            methods=["PUT"],
            response_model=ShopDraftResponse,
            operation_id="replaceShopDraft",
            summary="Replace the shop draft without touching any published version",
            responses=not_found | invalid,
        )
        router.add_api_route(
            "/shops/{shop_id}/draft/preview",
            preview_shop_draft,
            methods=["GET"],
            response_model=ShopPreviewResponse,
            operation_id="previewShopDraft",
            summary="Validate the draft and preview the version publishing would create",
            responses=not_found | invalid,
        )
        router.add_api_route(
            "/shops/{shop_id}/versions",
            publish_shop,
            methods=["POST"],
            status_code=201,
            response_model=ShopVersionResponse,
            operation_id="publishShop",
            summary="Freeze the draft into the next immutable published version",
            responses=not_found | publish_failures,
        )
        router.add_api_route(
            "/shops/{shop_id}/versions",
            list_shop_versions,
            methods=["GET"],
            response_model=ShopVersionListResponse,
            operation_id="listShopVersions",
            summary="List a shop's published versions, newest first",
            responses=not_found | invalid,
        )
        router.add_api_route(
            "/shops/{shop_id}/versions/{version}",
            get_shop_version,
            methods=["GET"],
            response_model=ShopVersionResponse,
            operation_id="getShopVersion",
            summary="Retrieve one immutable published shop version",
            responses=not_found | invalid,
        )
