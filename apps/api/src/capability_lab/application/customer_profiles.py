"""Customer-profile authoring plus the per-shop attachment that scopes the Studio list.

A customer profile is shop-independent: identity, address book, persona, background, and
hidden facts travel with it. What is per shop is *whether this shop uses it* — the design
direction's "profiles attached to this shop". That attachment is not a definition reference
(it pins no version and never affects a fingerprint), so it is a separate relation with its
own port rather than an entry in the ADR 0012 reference table.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Protocol
from uuid import UUID

from capability_lab.application.customer_profile_payload import (
    customer_profile_content_fingerprint,
    customer_profile_document,
    customer_profile_from_document,
)
from capability_lab.application.definition_authoring import (
    AuthoringErrors,
    DefinitionAuthoringService,
    DefinitionDraftPreview,
    DefinitionDraftRecord,
    DefinitionNotFoundError,
    DefinitionNotPublishableError,
    DefinitionRepository,
    DefinitionVersionNotFoundError,
    DefinitionVersionRecord,
    PayloadCodec,
)
from capability_lab.application.ports import Clock
from capability_lab.application.shops import ShopNotFoundError
from capability_lab.domain.customer_profile import (
    AccountFacts,
    AccountStatus,
    BehavioralPersona,
    CustomerIdentity,
    CustomerProfilePayload,
    LoyaltyTier,
    summarize_customer_profile_changes,
    validate_customer_profile,
)
from capability_lab.domain.definitions import DefinitionId, DefinitionType


class CustomerProfileNotFoundError(DefinitionNotFoundError):
    """Raised when a customer-profile definition has never been created."""


class CustomerProfileVersionNotFoundError(DefinitionVersionNotFoundError):
    """Raised when a published customer-profile version does not exist."""


class CustomerProfileNotPublishableError(DefinitionNotPublishableError):
    """Raised when a customer-profile draft still has publish-gate errors."""

    noun = "customer profile"


CUSTOMER_PROFILE_CODEC: PayloadCodec[CustomerProfilePayload] = PayloadCodec(
    definition_type=DefinitionType.CUSTOMER_PROFILE,
    document=customer_profile_document,
    from_document=customer_profile_from_document,
    fingerprint=customer_profile_content_fingerprint,
    validate=validate_customer_profile,
    summarize_changes=summarize_customer_profile_changes,
)

CustomerProfileDraftRecord = DefinitionDraftRecord[CustomerProfilePayload]
CustomerProfileVersionRecord = DefinitionVersionRecord[CustomerProfilePayload]
CustomerProfileDraftPreview = DefinitionDraftPreview[CustomerProfilePayload]
CustomerProfileRepository = DefinitionRepository[CustomerProfilePayload]


class ShopDirectory(Protocol):
    """Whether a shop definition exists."""

    def exists(self, shop_id: UUID) -> bool: ...


class ShopClaims(Protocol):
    """A shop's draft, claimed before an attachment names the shop.

    Attachment carries no foreign key — it stays an unversioned, unpinned relation — so the
    service checks the shop itself rather than letting a typo create a dangling row that
    Milestone 2's same-shop pickers would have to filter out. It checks by claiming, so the
    answer also holds against a racing delete (ADR 0077).
    """

    def claim(self, shop_id: UUID) -> bool:
        """Take the store's write lock through the shop's draft; whether the draft stood.

        One deleted first answers false; one that stands cannot be deleted until this
        transaction ends.
        """
        ...


class DefinitionShopAttachmentRepository(Protocol):
    """Which shops use a shop-independent definition."""

    def attach(self, definition: DefinitionId, shop_id: UUID, attached_at: datetime) -> None:
        """Attach the definition to a shop; attaching twice is a no-op."""
        ...

    def detach(self, definition: DefinitionId, shop_id: UUID) -> bool:
        """Detach and report whether the attachment existed."""
        ...

    def shops_for(self, definition: DefinitionId) -> tuple[UUID, ...]: ...

    def definitions_for_shop(
        self, definition_type: DefinitionType, shop_id: UUID
    ) -> frozenset[UUID]: ...

    def attachment_counts(self, definition_type: DefinitionType) -> dict[UUID, int]: ...


@dataclass(frozen=True, slots=True)
class CustomerProfileSummary:
    """One row of the Studio's customer index."""

    definition_id: UUID
    display_name: str
    email: str
    persona_traits: tuple[str, ...]
    address_count: int
    default_address_label: str | None
    updated_at: datetime
    latest_published_version: int | None
    published_version_count: int
    attached_shop_count: int


def customer_profile_definition_id(profile_id: UUID) -> DefinitionId:
    return DefinitionId(definition_type=DefinitionType.CUSTOMER_PROFILE, id=profile_id)


def new_customer_profile(identity: CustomerIdentity, customer_since: str) -> CustomerProfilePayload:
    """The deliberately incomplete first draft: an identity and nothing else decided."""
    return CustomerProfilePayload(
        identity=identity,
        account=AccountFacts(
            customer_since=customer_since,
            status=AccountStatus.ACTIVE,
            loyalty_tier=LoyaltyTier.NONE,
            marketing_opt_in=False,
        ),
        persona=BehavioralPersona(summary=""),
    )


class CustomerProfileService(DefinitionAuthoringService[CustomerProfilePayload]):
    def __init__(
        self,
        repository: DefinitionRepository[CustomerProfilePayload],
        attachments: DefinitionShopAttachmentRepository,
        shops: ShopClaims,
        clock: Clock,
    ) -> None:
        super().__init__(
            repository,
            clock,
            CUSTOMER_PROFILE_CODEC,
            AuthoringErrors(
                not_found=CustomerProfileNotFoundError,
                version_not_found=CustomerProfileVersionNotFoundError,
                not_publishable=CustomerProfileNotPublishableError,
            ),
            noun="customer profile",
        )
        self._attachments = attachments
        self._shops = shops

    def list_profiles(self, *, shop_id: UUID | None = None) -> tuple[CustomerProfileSummary, ...]:
        """List every profile, or only those attached to one shop.

        An unknown `shop_id` yields an empty list rather than a 404: this is a filter over
        attachments, and "no profile is attached to that shop" is the true answer. Writes —
        create-into-a-shop and attach — do validate the shop, because they would otherwise
        leave a row behind.
        """
        counts = self._attachments.attachment_counts(DefinitionType.CUSTOMER_PROFILE)
        attached = (
            None
            if shop_id is None
            else self._attachments.definitions_for_shop(DefinitionType.CUSTOMER_PROFILE, shop_id)
        )
        summaries: list[CustomerProfileSummary] = []
        for listing in self.list_definitions():
            if attached is not None and listing.definition_id not in attached:
                continue
            payload = listing.payload
            default_address = payload.default_address
            summaries.append(
                CustomerProfileSummary(
                    definition_id=listing.definition_id,
                    display_name=payload.identity.display_name,
                    email=payload.identity.email,
                    persona_traits=payload.persona.traits,
                    address_count=len(payload.addresses),
                    default_address_label=(
                        None if default_address is None else default_address.label
                    ),
                    updated_at=listing.updated_at,
                    latest_published_version=listing.latest_published_version,
                    published_version_count=listing.published_version_count,
                    attached_shop_count=counts.get(listing.definition_id, 0),
                )
            )
        return tuple(summaries)

    def create_profile(
        self, identity: CustomerIdentity, customer_since: str, *, shop_id: UUID | None = None
    ) -> CustomerProfileDraftRecord:
        """Create the profile and, when created from a shop, attach it to that shop."""
        if shop_id is not None:
            self._claim_shop(shop_id)
        record = self.create(new_customer_profile(identity, customer_since))
        if shop_id is not None:
            self._attachments.attach(record.definition, shop_id, self._clock.now())
        return record

    def attached_shops(self, profile_id: UUID) -> tuple[UUID, ...]:
        return self._attachments.shops_for(self._require_profile(profile_id))

    def attach_to_shop(self, profile_id: UUID, shop_id: UUID) -> tuple[UUID, ...]:
        definition = self._require_profile(profile_id)
        self._claim_shop(shop_id)
        self._attachments.attach(definition, shop_id, self._clock.now())
        return self._attachments.shops_for(definition)

    def detach_from_shop(self, profile_id: UUID, shop_id: UUID) -> tuple[UUID, ...]:
        """Detach without deleting: the profile and its other shops are untouched."""
        definition = self._require_profile(profile_id)
        self._attachments.detach(definition, shop_id)
        return self._attachments.shops_for(definition)

    def _require_profile(self, profile_id: UUID) -> DefinitionId:
        definition = customer_profile_definition_id(profile_id)
        if self._repository.get_draft(definition) is None:
            raise CustomerProfileNotFoundError(f"customer profile {profile_id} has no draft")
        return definition

    def _claim_shop(self, shop_id: UUID) -> None:
        """The shop must stand, and stays standing until the attachment is committed."""
        if not self._shops.claim(shop_id):
            raise ShopNotFoundError(f"shop {shop_id} has no draft")
