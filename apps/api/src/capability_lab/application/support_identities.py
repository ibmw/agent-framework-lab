"""Support-identity authoring: draft editing, publish gate, and immutable versions.

Support identities are shop-independent and hold no definition references, so like shops
they use the shared lifecycle unchanged; only the codec, the publish gate, and the list
projection are specific to them.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

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
from capability_lab.application.support_identity_payload import (
    support_identity_content_fingerprint,
    support_identity_document,
    support_identity_from_document,
)
from capability_lab.domain.definitions import DefinitionId, DefinitionType
from capability_lab.domain.support_identity import (
    SupportIdentityPayload,
    SupportRole,
    summarize_support_identity_changes,
    validate_support_identity,
)


class SupportIdentityNotFoundError(DefinitionNotFoundError):
    """Raised when a support-identity definition has never been created."""


class SupportIdentityVersionNotFoundError(DefinitionVersionNotFoundError):
    """Raised when a published support-identity version does not exist."""


class SupportIdentityNotPublishableError(DefinitionNotPublishableError):
    """Raised when a support-identity draft still has publish-gate errors."""

    noun = "support identity"


SUPPORT_IDENTITY_CODEC: PayloadCodec[SupportIdentityPayload] = PayloadCodec(
    definition_type=DefinitionType.SUPPORT_IDENTITY,
    document=support_identity_document,
    from_document=support_identity_from_document,
    fingerprint=support_identity_content_fingerprint,
    validate=validate_support_identity,
    summarize_changes=summarize_support_identity_changes,
)

SupportIdentityDraftRecord = DefinitionDraftRecord[SupportIdentityPayload]
SupportIdentityVersionRecord = DefinitionVersionRecord[SupportIdentityPayload]
SupportIdentityDraftPreview = DefinitionDraftPreview[SupportIdentityPayload]
SupportIdentityRepository = DefinitionRepository[SupportIdentityPayload]


@dataclass(frozen=True, slots=True)
class SupportIdentitySummary:
    """One row of the Studio's support-identity index."""

    definition_id: UUID
    name: str
    title: str
    permission_count: int
    guidance_count: int
    updated_at: datetime
    latest_published_version: int | None
    published_version_count: int


def support_identity_definition_id(identity_id: UUID) -> DefinitionId:
    return DefinitionId(definition_type=DefinitionType.SUPPORT_IDENTITY, id=identity_id)


class SupportIdentityService(DefinitionAuthoringService[SupportIdentityPayload]):
    def __init__(
        self, repository: DefinitionRepository[SupportIdentityPayload], clock: Clock
    ) -> None:
        super().__init__(
            repository,
            clock,
            SUPPORT_IDENTITY_CODEC,
            AuthoringErrors(
                not_found=SupportIdentityNotFoundError,
                version_not_found=SupportIdentityVersionNotFoundError,
                not_publishable=SupportIdentityNotPublishableError,
            ),
            noun="support identity",
        )

    def list_identities(self) -> tuple[SupportIdentitySummary, ...]:
        return tuple(
            SupportIdentitySummary(
                definition_id=listing.definition_id,
                name=listing.payload.role.name,
                title=listing.payload.role.title,
                permission_count=len(listing.payload.permissions),
                guidance_count=len(listing.payload.guidance),
                updated_at=listing.updated_at,
                latest_published_version=listing.latest_published_version,
                published_version_count=listing.published_version_count,
            )
            for listing in self.list_definitions()
        )

    def create_identity(self, role: SupportRole) -> SupportIdentityDraftRecord:
        """Create the identity's stable identity and its first, incomplete draft."""
        return self.create(SupportIdentityPayload(role=role))
