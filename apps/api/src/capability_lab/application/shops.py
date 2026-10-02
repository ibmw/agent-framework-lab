"""Shop authoring: draft editing, publish-gate validation, and immutable versions.

A shop holds no definition references and no shop scope, so its lifecycle is exactly the
shared one in `definition_authoring`; what is shop-specific is the payload codec, the
publish gate, and the list projection.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import datetime
from typing import TYPE_CHECKING
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
from capability_lab.domain.definitions import (
    DefinitionId,
    DefinitionIssue,
    DefinitionType,
    DefinitionValidation,
    issue_error,
    validation_of,
)
from capability_lab.domain.shop import (
    ShopIdentity,
    ShopLogo,
    ShopPayload,
    keep_unchosen_logo,
    summarize_shop_changes,
    validate_shop,
)

if TYPE_CHECKING:
    # Only a type: `shop_media` raises this module's `ShopNotFoundError`, so the import runs
    # the other way at runtime.
    from capability_lab.application.shop_media import ShopMediaRepository


class ShopNotFoundError(DefinitionNotFoundError):
    """Raised when a shop definition has never been created."""


class ShopVersionNotFoundError(DefinitionVersionNotFoundError):
    """Raised when a published shop version does not exist."""


class ShopNotPublishableError(DefinitionNotPublishableError):
    """Raised when a shop draft still has publish-gate errors."""

    noun = "shop"


class MediaNotUploadedError(ValueError):
    """Raised when a draft write names a media reference that is not an image the shop holds.

    `paths` are the refused entries, each at the path the publish gate would write for it.
    """

    def __init__(self, paths: tuple[str, ...]) -> None:
        count = "1 entry is" if len(paths) == 1 else f"{len(paths)} entries are"
        super().__init__(f"every media entry must be an image uploaded to this shop; {count} not")
        self.paths = paths


def media_entry_path(product_handle: str, reference: str) -> str:
    """Where a finding about one media entry is written: its product's path, then the entry's."""
    return f"products.{product_handle}.media.{reference}"


def _unheld_media(payload: ShopPayload, held: frozenset[str]) -> tuple[tuple[str, str], ...]:
    """Every media entry not naming an image the shop holds, as (path, product title)."""
    return tuple(
        (media_entry_path(product.handle, entry.reference), product.title)
        for product in payload.products
        for entry in product.media
        if entry.asset is None or entry.asset not in held
    )


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
    def __init__(
        self,
        repository: DefinitionRepository[ShopPayload],
        clock: Clock,
        media: ShopMediaRepository,
    ) -> None:
        self._media = media
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
        # Only uploads are written (ADR 0076): every media entry must name an image this shop
        # holds, whatever the stored draft held, so a written reference is refused here even
        # where it was saved before the rule existed. A stored version still reads its own.
        refused = _unheld_media(payload, self._held_media(definition_id))
        if refused:
            raise MediaNotUploadedError(tuple(path for path, _ in refused))
        return super().replace_draft(definition_id, payload)

    def _held_media(self, definition_id: UUID) -> frozenset[str]:
        return frozenset(asset.sha256 for asset in self._media.list_for_shop(definition_id))

    def _validate(self, record: ShopDraftRecord) -> DefinitionValidation:
        """The payload's own gate, and every media entry that is not an image the shop holds.

        The second finding is the service's rather than `validate_shop`'s because only the
        shop's media rows can answer it; a draft saved before the write rule, or one whose
        image row went away, is held at its preview and its publish alike.
        """
        validation = super()._validate(record)
        held = self._held_media(record.definition.id)
        missing: list[DefinitionIssue] = [
            issue_error(
                "media_asset_missing",
                f"product {title} names an image this shop does not hold",
                media_path,
            )
            for media_path, title in _unheld_media(record.payload, held)
        ]
        if not missing:
            return validation
        return validation_of([*validation.issues, *missing])

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
