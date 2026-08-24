"""Public v1 contract for customer-profile authoring, publication, and shop attachment.

Every field of every schema is required, the way the shop contract is: a draft write sends
the whole payload and a response always carries every key, so nullable-but-required
(`phone`, `line2`, `region`, `default_address_label`) is how the contract says "absent".
"""

from collections.abc import Callable, Generator
from typing import Annotated, Literal, Self
from uuid import UUID

from fastapi import APIRouter, Depends, Path, Query
from pydantic import Field

from capability_lab.application.customer_profiles import (
    CustomerProfileDraftPreview,
    CustomerProfileDraftRecord,
    CustomerProfileService,
    CustomerProfileSummary,
    CustomerProfileVersionRecord,
)
from capability_lab.domain.customer_profile import (
    AccountFacts,
    AccountStatus,
    AddressEntry,
    BackgroundEntry,
    BackgroundKind,
    BehavioralPersona,
    CustomerIdentity,
    CustomerProfilePayload,
    HiddenFact,
    LoyaltyTier,
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
    ShopNotFoundResponses,
    Slug,
)

ProfileIdPath = Annotated[UUID, Path(description="Stable customer-profile identifier.")]
ShopIdPath = Annotated[UUID, Path(description="Stable shop definition identifier.")]

IsoDate = Annotated[str, Field(pattern=r"^\d{4}-\d{2}-\d{2}$")]
CountryCode = Annotated[str, Field(pattern=r"^[A-Z]{2}$")]
EmailAddress = Annotated[
    str, Field(min_length=3, max_length=200, pattern=r"^[^@\s]+@[^@\s.]+(?:\.[^@\s.]+)+$")
]
PhoneNumber = Annotated[str, Field(pattern=r"^\+?[0-9][0-9 ()./-]{4,30}$")]
OptionalBody = Annotated[str, Field(max_length=4000)]


class CustomerIdentitySchema(StrictApiModel):
    given_name: Label
    family_name: Label
    email: EmailAddress
    locale: Locale
    phone: PhoneNumber | None = Field(description="Null when the profile has no phone number.")

    @classmethod
    def from_domain(cls, identity: CustomerIdentity) -> Self:
        return cls(
            given_name=identity.given_name,
            family_name=identity.family_name,
            email=identity.email,
            locale=identity.locale,
            phone=identity.phone,
        )

    def to_domain(self) -> CustomerIdentity:
        return CustomerIdentity(
            given_name=self.given_name,
            family_name=self.family_name,
            email=self.email,
            locale=self.locale,
            phone=self.phone,
        )


class AccountFactsSchema(StrictApiModel):
    customer_since: IsoDate
    status: AccountStatus
    loyalty_tier: LoyaltyTier
    marketing_opt_in: bool
    notes: OptionalBody

    @classmethod
    def from_domain(cls, account: AccountFacts) -> Self:
        return cls(
            customer_since=account.customer_since,
            status=account.status,
            loyalty_tier=account.loyalty_tier,
            marketing_opt_in=account.marketing_opt_in,
            notes=account.notes,
        )

    def to_domain(self) -> AccountFacts:
        return AccountFacts(
            customer_since=self.customer_since,
            status=self.status,
            loyalty_tier=self.loyalty_tier,
            marketing_opt_in=self.marketing_opt_in,
            notes=self.notes,
        )


class AddressSchema(StrictApiModel):
    id: Slug
    label: Label
    recipient: Label
    line1: Label
    line2: Label | None
    postal_code: Label
    city: Label
    region: Label | None
    country: CountryCode
    is_default: bool

    @classmethod
    def from_domain(cls, entry: AddressEntry) -> Self:
        return cls(
            id=entry.id,
            label=entry.label,
            recipient=entry.recipient,
            line1=entry.line1,
            line2=entry.line2,
            postal_code=entry.postal_code,
            city=entry.city,
            region=entry.region,
            country=entry.country,
            is_default=entry.is_default,
        )

    def to_domain(self) -> AddressEntry:
        return AddressEntry(
            id=self.id,
            label=self.label,
            recipient=self.recipient,
            line1=self.line1,
            postal_code=self.postal_code,
            city=self.city,
            country=self.country,
            line2=self.line2,
            region=self.region,
            is_default=self.is_default,
        )


class PersonaSchema(StrictApiModel):
    """Operator- and simulator-facing behavior; never part of a support agent's prompt."""

    summary: OptionalBody
    traits: list[Label]

    @classmethod
    def from_domain(cls, persona: BehavioralPersona) -> Self:
        return cls(summary=persona.summary, traits=list(persona.traits))

    def to_domain(self) -> BehavioralPersona:
        return BehavioralPersona(summary=self.summary, traits=tuple(self.traits))


class BackgroundEntrySchema(StrictApiModel):
    id: Slug
    kind: BackgroundKind
    occurred_on: IsoDate
    note: Body

    @classmethod
    def from_domain(cls, entry: BackgroundEntry) -> Self:
        return cls(id=entry.id, kind=entry.kind, occurred_on=entry.occurred_on, note=entry.note)

    def to_domain(self) -> BackgroundEntry:
        return BackgroundEntry(
            id=self.id, kind=self.kind, occurred_on=self.occurred_on, note=self.note
        )


class HiddenFactSchema(StrictApiModel):
    """Known to the customer side of a simulation only."""

    id: Slug
    note: Body
    revealed_when: OptionalBody

    @classmethod
    def from_domain(cls, fact: HiddenFact) -> Self:
        return cls(id=fact.id, note=fact.note, revealed_when=fact.revealed_when)

    def to_domain(self) -> HiddenFact:
        return HiddenFact(id=self.id, note=self.note, revealed_when=self.revealed_when)


class CustomerProfilePayloadSchema(StrictApiModel):
    """The whole authored content of a customer-profile draft or published version."""

    identity: CustomerIdentitySchema
    account: AccountFactsSchema
    persona: PersonaSchema
    addresses: list[AddressSchema]
    background: list[BackgroundEntrySchema]
    hidden_facts: list[HiddenFactSchema]

    def to_domain(self) -> CustomerProfilePayload:
        return CustomerProfilePayload(
            identity=self.identity.to_domain(),
            account=self.account.to_domain(),
            persona=self.persona.to_domain(),
            addresses=tuple(entry.to_domain() for entry in self.addresses),
            background=tuple(entry.to_domain() for entry in self.background),
            hidden_facts=tuple(fact.to_domain() for fact in self.hidden_facts),
        )


class CustomerProfileContentSchema(CustomerProfilePayloadSchema):
    """A customer profile as the API returns it, with derived read-only evidence."""

    display_name: str
    default_address_id: str | None

    @classmethod
    def from_domain(cls, payload: CustomerProfilePayload) -> Self:
        default_address = payload.default_address
        return cls(
            identity=CustomerIdentitySchema.from_domain(payload.identity),
            account=AccountFactsSchema.from_domain(payload.account),
            persona=PersonaSchema.from_domain(payload.persona),
            addresses=[AddressSchema.from_domain(entry) for entry in payload.addresses],
            background=[BackgroundEntrySchema.from_domain(entry) for entry in payload.background],
            hidden_facts=[HiddenFactSchema.from_domain(fact) for fact in payload.hidden_facts],
            display_name=payload.identity.display_name,
            default_address_id=None if default_address is None else default_address.id,
        )


class CreateCustomerProfileRequest(StrictApiModel):
    identity: CustomerIdentitySchema
    customer_since: IsoDate
    shop_id: UUID | None = Field(
        description="Attach the new profile to this shop; null creates it unattached."
    )


class ReplaceCustomerProfileDraftRequest(StrictApiModel):
    payload: CustomerProfilePayloadSchema


class AttachCustomerProfileRequest(StrictApiModel):
    shop_id: UUID


class CustomerProfileDraftResponse(StrictApiModel):
    profile_id: UUID
    lifecycle_state: Literal["draft"] = "draft"
    content: CustomerProfileContentSchema
    created_at: str
    updated_at: str

    @classmethod
    def from_record(cls, record: CustomerProfileDraftRecord) -> Self:
        return cls(
            profile_id=record.definition.id,
            content=CustomerProfileContentSchema.from_domain(record.payload),
            created_at=record.created_at.isoformat(),
            updated_at=record.updated_at.isoformat(),
        )


class CustomerProfileVersionResponse(StrictApiModel):
    profile_id: UUID
    lifecycle_state: Literal["published"] = "published"
    version: int
    content_fingerprint: str
    published_at: str
    content: CustomerProfileContentSchema

    @classmethod
    def from_record(cls, record: CustomerProfileVersionRecord) -> Self:
        return cls(
            profile_id=record.published.definition.id,
            version=record.published.version,
            content_fingerprint=record.published.content_fingerprint,
            published_at=record.published.published_at.isoformat(),
            content=CustomerProfileContentSchema.from_domain(record.payload),
        )


class CustomerProfileVersionListResponse(StrictApiModel):
    versions: list[DefinitionVersionSummarySchema]


class CustomerProfileSummarySchema(StrictApiModel):
    profile_id: UUID
    display_name: str
    email: str
    persona_traits: list[str]
    address_count: int
    default_address_label: str | None
    updated_at: str
    latest_published_version: int | None
    published_version_count: int
    attached_shop_count: int

    @classmethod
    def from_domain(cls, summary: CustomerProfileSummary) -> Self:
        return cls(
            profile_id=summary.definition_id,
            display_name=summary.display_name,
            email=summary.email,
            persona_traits=list(summary.persona_traits),
            address_count=summary.address_count,
            default_address_label=summary.default_address_label,
            updated_at=summary.updated_at.isoformat(),
            latest_published_version=summary.latest_published_version,
            published_version_count=summary.published_version_count,
            attached_shop_count=summary.attached_shop_count,
        )


class CustomerProfileListResponse(StrictApiModel):
    profiles: list[CustomerProfileSummarySchema]


class CustomerProfileShopsResponse(StrictApiModel):
    """The shops that use this profile; identity and content never differ per shop."""

    profile_id: UUID
    shop_ids: list[UUID]


class CustomerProfilePreviewResponse(StrictApiModel):
    """The publish gate: what blocks publication and what a publish would freeze."""

    profile_id: UUID
    publishable: bool
    issues: list[DefinitionIssueSchema]
    changes: list[DefinitionChangeSchema]
    content_fingerprint: str
    latest_published_version: int | None
    next_version: int
    matches_latest_published: bool
    content: CustomerProfileContentSchema

    @classmethod
    def from_preview(cls, profile_id: UUID, preview: CustomerProfileDraftPreview) -> Self:
        return cls(
            profile_id=profile_id,
            publishable=preview.validation.publishable,
            issues=[
                DefinitionIssueSchema.from_domain(issue) for issue in preview.validation.issues
            ],
            changes=[DefinitionChangeSchema.from_domain(change) for change in preview.changes],
            content_fingerprint=preview.content_fingerprint,
            latest_published_version=preview.latest_published_version,
            next_version=preview.next_version,
            matches_latest_published=preview.matches_latest_published,
            content=CustomerProfileContentSchema.from_domain(preview.payload),
        )


class CustomerProfileRoutes:
    """Route handlers bound to a request-scoped `CustomerProfileService` dependency."""

    def __init__(
        self, service: Callable[[], Generator[CustomerProfileService, None, None]]
    ) -> None:
        self._service = service

    def register(self, router: APIRouter) -> None:
        dependency = Depends(self._service)

        def list_profiles(
            service: Annotated[CustomerProfileService, dependency],
            shop_id: Annotated[
                UUID | None,
                Query(description="List only the profiles attached to this shop."),
            ] = None,
        ) -> CustomerProfileListResponse:
            return CustomerProfileListResponse(
                profiles=[
                    CustomerProfileSummarySchema.from_domain(summary)
                    for summary in service.list_profiles(shop_id=shop_id)
                ]
            )

        def create_profile(
            command: CreateCustomerProfileRequest,
            service: Annotated[CustomerProfileService, dependency],
        ) -> CustomerProfileDraftResponse:
            return CustomerProfileDraftResponse.from_record(
                service.create_profile(
                    command.identity.to_domain(),
                    command.customer_since,
                    shop_id=command.shop_id,
                )
            )

        def get_profile_draft(
            profile_id: ProfileIdPath,
            service: Annotated[CustomerProfileService, dependency],
        ) -> CustomerProfileDraftResponse:
            return CustomerProfileDraftResponse.from_record(service.get_draft(profile_id))

        def replace_profile_draft(
            profile_id: ProfileIdPath,
            command: ReplaceCustomerProfileDraftRequest,
            service: Annotated[CustomerProfileService, dependency],
        ) -> CustomerProfileDraftResponse:
            return CustomerProfileDraftResponse.from_record(
                service.replace_draft(profile_id, command.payload.to_domain())
            )

        def preview_profile_draft(
            profile_id: ProfileIdPath,
            service: Annotated[CustomerProfileService, dependency],
        ) -> CustomerProfilePreviewResponse:
            return CustomerProfilePreviewResponse.from_preview(
                profile_id, service.preview_draft(profile_id)
            )

        def publish_profile(
            profile_id: ProfileIdPath,
            service: Annotated[CustomerProfileService, dependency],
        ) -> CustomerProfileVersionResponse:
            return CustomerProfileVersionResponse.from_record(service.publish(profile_id))

        def list_profile_versions(
            profile_id: ProfileIdPath,
            service: Annotated[CustomerProfileService, dependency],
        ) -> CustomerProfileVersionListResponse:
            return CustomerProfileVersionListResponse(
                versions=[
                    DefinitionVersionSummarySchema.from_domain(published)
                    for published in service.list_versions(profile_id)
                ]
            )

        def get_profile_version(
            profile_id: ProfileIdPath,
            version: DefinitionVersionPath,
            service: Annotated[CustomerProfileService, dependency],
        ) -> CustomerProfileVersionResponse:
            return CustomerProfileVersionResponse.from_record(
                service.get_version(profile_id, version)
            )

        def list_profile_shops(
            profile_id: ProfileIdPath,
            service: Annotated[CustomerProfileService, dependency],
        ) -> CustomerProfileShopsResponse:
            return CustomerProfileShopsResponse(
                profile_id=profile_id, shop_ids=list(service.attached_shops(profile_id))
            )

        def attach_profile(
            profile_id: ProfileIdPath,
            command: AttachCustomerProfileRequest,
            service: Annotated[CustomerProfileService, dependency],
        ) -> CustomerProfileShopsResponse:
            return CustomerProfileShopsResponse(
                profile_id=profile_id,
                shop_ids=list(service.attach_to_shop(profile_id, command.shop_id)),
            )

        def detach_profile(
            profile_id: ProfileIdPath,
            shop_id: ShopIdPath,
            service: Annotated[CustomerProfileService, dependency],
        ) -> CustomerProfileShopsResponse:
            return CustomerProfileShopsResponse(
                profile_id=profile_id,
                shop_ids=list(service.detach_from_shop(profile_id, shop_id)),
            )

        router.add_api_route(
            "/customer-profiles",
            list_profiles,
            methods=["GET"],
            response_model=CustomerProfileListResponse,
            operation_id="listCustomerProfiles",
            summary="List customer profiles, optionally scoped to one shop's attachments",
            responses=InvalidResponses,
        )
        router.add_api_route(
            "/customer-profiles",
            create_profile,
            methods=["POST"],
            status_code=201,
            response_model=CustomerProfileDraftResponse,
            operation_id="createCustomerProfile",
            summary="Create a customer profile identity and its first draft",
            # Creating into a shop refuses an unknown shop rather than attaching to nothing.
            responses=ShopNotFoundResponses | InvalidResponses,
        )
        router.add_api_route(
            "/customer-profiles/{profile_id}/draft",
            get_profile_draft,
            methods=["GET"],
            response_model=CustomerProfileDraftResponse,
            operation_id="getCustomerProfileDraft",
            summary="Retrieve the mutable customer-profile draft",
            responses=NotFoundResponses | InvalidResponses,
        )
        router.add_api_route(
            "/customer-profiles/{profile_id}/draft",
            replace_profile_draft,
            methods=["PUT"],
            response_model=CustomerProfileDraftResponse,
            operation_id="replaceCustomerProfileDraft",
            summary="Replace the draft without touching any published version",
            responses=NotFoundResponses | InvalidResponses,
        )
        router.add_api_route(
            "/customer-profiles/{profile_id}/draft/preview",
            preview_profile_draft,
            methods=["GET"],
            response_model=CustomerProfilePreviewResponse,
            operation_id="previewCustomerProfileDraft",
            summary="Validate the draft and preview the version publishing would create",
            responses=NotFoundResponses | InvalidResponses,
        )
        router.add_api_route(
            "/customer-profiles/{profile_id}/versions",
            publish_profile,
            methods=["POST"],
            status_code=201,
            response_model=CustomerProfileVersionResponse,
            operation_id="publishCustomerProfile",
            summary="Freeze the draft into the next immutable published version",
            responses=NotFoundResponses | PublishFailureResponses,
        )
        router.add_api_route(
            "/customer-profiles/{profile_id}/versions",
            list_profile_versions,
            methods=["GET"],
            response_model=CustomerProfileVersionListResponse,
            operation_id="listCustomerProfileVersions",
            summary="List a profile's published versions, newest first",
            responses=NotFoundResponses | InvalidResponses,
        )
        router.add_api_route(
            "/customer-profiles/{profile_id}/versions/{version}",
            get_profile_version,
            methods=["GET"],
            response_model=CustomerProfileVersionResponse,
            operation_id="getCustomerProfileVersion",
            summary="Retrieve one immutable published customer-profile version",
            responses=NotFoundResponses | InvalidResponses,
        )
        router.add_api_route(
            "/customer-profiles/{profile_id}/shops",
            list_profile_shops,
            methods=["GET"],
            response_model=CustomerProfileShopsResponse,
            operation_id="listCustomerProfileShops",
            summary="List the shops this profile is attached to",
            responses=NotFoundResponses | InvalidResponses,
        )
        router.add_api_route(
            "/customer-profiles/{profile_id}/shops",
            attach_profile,
            methods=["POST"],
            response_model=CustomerProfileShopsResponse,
            operation_id="attachCustomerProfileToShop",
            summary="Attach the profile to a shop; attaching twice changes nothing",
            responses=ShopNotFoundResponses | InvalidResponses,
        )
        router.add_api_route(
            "/customer-profiles/{profile_id}/shops/{shop_id}",
            detach_profile,
            methods=["DELETE"],
            response_model=CustomerProfileShopsResponse,
            operation_id="detachCustomerProfileFromShop",
            summary="Detach the profile from a shop without deleting the profile",
            responses=NotFoundResponses | InvalidResponses,
        )
