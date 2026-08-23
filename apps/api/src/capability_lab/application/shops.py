"""Shop authoring: draft editing, publish-gate validation, and immutable versions.

The service owns the shop half of the ADR 0012 lifecycle. A shop holds no definition
references and no shop scope, so publishing reduces to the domain's `publish_draft` rule
plus this slice's publish gate: a draft may stay incomplete, a published version may not.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Protocol
from uuid import UUID, uuid4

from capability_lab.application.definition_resolution import (
    DefinitionResolutionError,
    MissingDraftError,
)
from capability_lab.application.ports import Clock
from capability_lab.application.shop_payload import shop_content_fingerprint
from capability_lab.domain.definitions import (
    DefinitionDraft,
    DefinitionId,
    DefinitionType,
    PublishedDefinitionVersion,
    VersionRef,
    publish_draft,
)
from capability_lab.domain.shop import (
    ShopChange,
    ShopIdentity,
    ShopPayload,
    ShopValidation,
    summarize_shop_changes,
    validate_shop,
)


class ShopNotFoundError(DefinitionResolutionError):
    """Raised when a shop definition has never been created."""


class ShopVersionNotFoundError(DefinitionResolutionError):
    """Raised when a published shop version does not exist."""


class ShopNotPublishableError(DefinitionResolutionError):
    """Raised when a draft still has publish-gate errors."""

    def __init__(self, validation: ShopValidation) -> None:
        super().__init__(
            f"the shop draft has {len(validation.errors)} error(s) that block publication"
        )
        self.validation = validation


@dataclass(frozen=True, slots=True)
class ShopDraftRecord:
    """The single mutable draft of one shop."""

    draft: DefinitionDraft
    payload: ShopPayload
    created_at: datetime
    updated_at: datetime

    @property
    def definition(self) -> DefinitionId:
        return self.draft.definition


@dataclass(frozen=True, slots=True)
class ShopVersionRecord:
    """One immutable published shop version and the content it froze."""

    published: PublishedDefinitionVersion
    payload: ShopPayload

    @property
    def ref(self) -> VersionRef:
        return self.published.ref


@dataclass(frozen=True, slots=True)
class ShopSummary:
    """List-view projection: draft identity plus published-version provenance."""

    definition_id: UUID
    name: str
    slug: str
    updated_at: datetime
    latest_published_version: int | None
    published_version_count: int


@dataclass(frozen=True, slots=True)
class ShopDraftPreview:
    """What publishing this draft would freeze, and what still blocks it."""

    payload: ShopPayload
    validation: ShopValidation
    changes: tuple[ShopChange, ...]
    content_fingerprint: str
    latest_published_version: int | None
    next_version: int
    matches_latest_published: bool


class ShopRepository(Protocol):
    """Persistence port for shop drafts and their immutable published versions."""

    def list_shops(self) -> tuple[ShopSummary, ...]: ...

    def get_draft(self, definition: DefinitionId) -> ShopDraftRecord | None: ...

    def save_draft(self, record: ShopDraftRecord) -> None: ...

    def latest_published_version(self, definition: DefinitionId) -> int | None: ...

    def get_version(self, ref: VersionRef) -> ShopVersionRecord | None: ...

    def list_versions(self, definition: DefinitionId) -> tuple[PublishedDefinitionVersion, ...]: ...

    def save_version(self, record: ShopVersionRecord) -> None:
        """Persist a new published version; never overwrite an existing one."""
        ...


def shop_definition_id(shop_id: UUID) -> DefinitionId:
    return DefinitionId(definition_type=DefinitionType.SHOP, id=shop_id)


class ShopService:
    def __init__(self, repository: ShopRepository, clock: Clock) -> None:
        self._repository = repository
        self._clock = clock

    def list_shops(self) -> tuple[ShopSummary, ...]:
        return self._repository.list_shops()

    def create_shop(self, identity: ShopIdentity) -> ShopDraftRecord:
        """Create a shop's stable identity and its first, deliberately incomplete draft."""
        definition = shop_definition_id(uuid4())
        now = self._clock.now()
        record = ShopDraftRecord(
            draft=DefinitionDraft(definition=definition),
            payload=ShopPayload(identity=identity),
            created_at=now,
            updated_at=now,
        )
        self._repository.save_draft(record)
        return record

    def get_draft(self, shop_id: UUID) -> ShopDraftRecord:
        record = self._repository.get_draft(shop_definition_id(shop_id))
        if record is None:
            raise ShopNotFoundError(f"shop {shop_id} has no draft")
        return record

    def replace_draft(self, shop_id: UUID, payload: ShopPayload) -> ShopDraftRecord:
        """Replace the whole draft payload; published versions are never touched."""
        existing = self.get_draft(shop_id)
        record = ShopDraftRecord(
            draft=existing.draft,
            payload=payload,
            created_at=existing.created_at,
            updated_at=self._clock.now(),
        )
        self._repository.save_draft(record)
        return record

    def preview_draft(self, shop_id: UUID) -> ShopDraftPreview:
        """Validate the draft and describe the version publishing it would create."""
        record = self.get_draft(shop_id)
        latest = self._repository.latest_published_version(record.definition)
        published_payload = None
        if latest is not None:
            published = self._repository.get_version(
                VersionRef(definition=record.definition, version=latest)
            )
            if published is None:
                raise ShopVersionNotFoundError(
                    f"shop {shop_id} version {latest} is recorded but not resolvable"
                )
            published_payload = published.payload
        fingerprint = shop_content_fingerprint(record.payload)
        return ShopDraftPreview(
            payload=record.payload,
            validation=validate_shop(record.payload),
            changes=summarize_shop_changes(published_payload, record.payload),
            content_fingerprint=fingerprint,
            latest_published_version=latest,
            next_version=1 if latest is None else latest + 1,
            matches_latest_published=(
                published_payload is not None
                and shop_content_fingerprint(published_payload) == fingerprint
            ),
        )

    def publish(self, shop_id: UUID) -> ShopVersionRecord:
        """Freeze the draft into the next immutable version once the gate is clear."""
        record = self._repository.get_draft(shop_definition_id(shop_id))
        if record is None:
            raise MissingDraftError(f"shop {shop_id} has no draft to publish")
        validation = validate_shop(record.payload)
        if not validation.publishable:
            raise ShopNotPublishableError(validation)

        published = publish_draft(
            record.draft,
            latest_published_version=self._repository.latest_published_version(record.definition),
            pinned_scope=None,
            pinned_references=(),
            content_fingerprint=shop_content_fingerprint(record.payload),
            published_at=self._clock.now(),
        )
        version = ShopVersionRecord(published=published, payload=record.payload)
        self._repository.save_version(version)
        return version

    def list_versions(self, shop_id: UUID) -> tuple[PublishedDefinitionVersion, ...]:
        definition = shop_definition_id(shop_id)
        if self._repository.get_draft(definition) is None:
            raise ShopNotFoundError(f"shop {shop_id} has no draft")
        return self._repository.list_versions(definition)

    def get_version(self, shop_id: UUID, version: int) -> ShopVersionRecord:
        record = self._repository.get_version(
            VersionRef(definition=shop_definition_id(shop_id), version=version)
        )
        if record is None:
            raise ShopVersionNotFoundError(f"shop {shop_id} has no published version {version}")
        return record
