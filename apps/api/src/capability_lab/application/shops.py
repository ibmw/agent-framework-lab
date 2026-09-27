"""Shop authoring: draft editing, publish-gate validation, and immutable versions.

A shop holds no definition references and no shop scope, so its lifecycle is exactly the
shared one in `definition_authoring`; what is shop-specific is the payload codec, the
publish gate, and the list projection.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
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
    DefinitionVersionIntegrityError,
    DefinitionVersionNotFoundError,
    DefinitionVersionRecord,
    PayloadCodec,
)
from capability_lab.application.ports import Clock
from capability_lab.application.shop_payload import (
    shop_content_fingerprint,
    shop_payload_document,
    shop_payload_from_document,
)
from capability_lab.domain.definitions import DefinitionId, DefinitionType
from capability_lab.domain.shop import (
    ShopIdentity,
    ShopLogo,
    ShopPayload,
    keep_unchosen_logo,
    summarize_shop_changes,
    validate_shop,
)


class ShopNotFoundError(DefinitionNotFoundError):
    """Raised when a shop definition has never been created."""


class ShopVersionNotFoundError(DefinitionVersionNotFoundError):
    """Raised when a published shop version does not exist."""


class ShopNotPublishableError(DefinitionNotPublishableError):
    """Raised when a shop draft still has publish-gate errors."""

    noun = "shop"


SHOP_CODEC: PayloadCodec[ShopPayload] = PayloadCodec(
    definition_type=DefinitionType.SHOP,
    document=shop_payload_document,
    from_document=shop_payload_from_document,
    fingerprint=shop_content_fingerprint,
    validate=validate_shop,
    summarize_changes=summarize_shop_changes,
)

ShopDraftRecord = DefinitionDraftRecord[ShopPayload]
ShopVersionRecord = DefinitionVersionRecord[ShopPayload]
ShopDraftPreview = DefinitionDraftPreview[ShopPayload]
ShopRepository = DefinitionRepository[ShopPayload]


@dataclass(frozen=True, slots=True)
class ShopSummary:
    """List-view projection: draft identity plus published-version provenance."""

    definition_id: UUID
    name: str
    slug: str
    updated_at: datetime
    latest_published_version: int | None
    published_version_count: int
    logo: ShopLogo | None


def shop_definition_id(shop_id: UUID) -> DefinitionId:
    return DefinitionId(definition_type=DefinitionType.SHOP, id=shop_id)


class ShopService(DefinitionAuthoringService[ShopPayload]):
    def __init__(self, repository: DefinitionRepository[ShopPayload], clock: Clock) -> None:
        super().__init__(
            repository,
            clock,
            SHOP_CODEC,
            AuthoringErrors(
                not_found=ShopNotFoundError,
                version_not_found=ShopVersionNotFoundError,
                not_publishable=ShopNotPublishableError,
            ),
            noun="shop",
        )

    def list_shops(self) -> tuple[ShopSummary, ...]:
        return tuple(
            ShopSummary(
                definition_id=listing.definition_id,
                name=listing.payload.identity.name,
                slug=listing.payload.identity.slug,
                updated_at=listing.updated_at,
                latest_published_version=listing.latest_published_version,
                published_version_count=listing.published_version_count,
                logo=listing.payload.logo,
            )
            for listing in self.list_definitions()
        )

    def replace_draft(self, definition_id: UUID, payload: ShopPayload) -> ShopDraftRecord:
        """Replace the draft, keeping a v2 logo whose derived colour was only echoed back.

        Every writer that reads a draft before writing it sends a stored v2 logo back with the
        colour the lab answered for it (ADR 0070). Held here rather than in any one client, so
        a save that leaves the logo alone leaves its bytes alone. The echo is measured against
        the draft and against the latest published version: a colour changed and changed back
        draws the published v2 logo again, and must be that logo again.
        """
        logo = keep_unchosen_logo(self.get_draft(definition_id).payload.logo, payload.logo)
        logo = keep_unchosen_logo(self._latest_published_logo(definition_id), logo)
        if logo is not payload.logo:
            payload = replace(payload, logo=logo)
        return super().replace_draft(definition_id, payload)

    def _latest_published_logo(self, definition_id: UUID) -> ShopLogo | None:
        """The latest published version's logo, or none to compare with.

        A published version that no longer matches its fingerprint does not block a draft save:
        the save goes ahead without the comparison, and every read of that version still
        reports the corruption.
        """
        latest = self._repository.latest_published_version(shop_definition_id(definition_id))
        if latest is None:
            return None
        try:
            return self.get_version(definition_id, latest).payload.logo
        except DefinitionVersionIntegrityError:
            return None

    def create_shop(self, identity: ShopIdentity, logo: ShopLogo | None = None) -> ShopDraftRecord:
        """Create a shop's stable identity and its first, deliberately incomplete draft."""
        return self.create(ShopPayload(identity=identity, logo=logo))
