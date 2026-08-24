"""The draft/published authoring lifecycle shared by every definition type.

ADR 0012 fixes one lifecycle for all authorable definitions and ADR 0013 records that only
the payload codec and the publish gate are per-type. This module is that shared half:
create a stable identity with an incomplete draft, replace the draft, preview what
publishing would freeze, and freeze it into the next immutable version.

The types covered here are the shop-independent, reference-free ones (shop, customer
profile, support identity). Shop-scoped types that pin references — tickets and scenarios —
arrive with Milestone 2 and extend `publish` with a reference-pinning step rather than
copying this one.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime
from typing import Protocol
from uuid import UUID, uuid4

from capability_lab.application.canonical_json import CanonicalValue
from capability_lab.application.definition_resolution import DefinitionResolutionError
from capability_lab.application.ports import Clock
from capability_lab.domain.definitions import (
    DefinitionChange,
    DefinitionDraft,
    DefinitionId,
    DefinitionType,
    DefinitionValidation,
    PublishedDefinitionVersion,
    VersionRef,
    publish_draft,
)


class DefinitionNotFoundError(DefinitionResolutionError):
    """Raised when a definition has never been created."""


class DefinitionVersionNotFoundError(DefinitionResolutionError):
    """Raised when a published version of a definition does not exist."""


class DefinitionNotPublishableError(DefinitionResolutionError):
    """Raised when a draft still has publish-gate errors."""

    noun = "definition"

    def __init__(self, validation: DefinitionValidation) -> None:
        super().__init__(
            f"the {self.noun} draft has {len(validation.errors)} error(s) that block publication"
        )
        self.validation = validation


@dataclass(frozen=True, slots=True)
class DefinitionDraftRecord[PayloadT]:
    """The single mutable draft of one definition and the content it holds."""

    draft: DefinitionDraft
    payload: PayloadT
    created_at: datetime
    updated_at: datetime

    @property
    def definition(self) -> DefinitionId:
        return self.draft.definition


@dataclass(frozen=True, slots=True)
class DefinitionVersionRecord[PayloadT]:
    """One immutable published version and the content it froze."""

    published: PublishedDefinitionVersion
    payload: PayloadT

    @property
    def ref(self) -> VersionRef:
        return self.published.ref


@dataclass(frozen=True, slots=True)
class DefinitionListing[PayloadT]:
    """One index-table row: the draft's content plus its published-version provenance."""

    definition_id: UUID
    payload: PayloadT
    created_at: datetime
    updated_at: datetime
    latest_published_version: int | None
    published_version_count: int


@dataclass(frozen=True, slots=True)
class DefinitionDraftPreview[PayloadT]:
    """What publishing this draft would freeze, and what still blocks it."""

    payload: PayloadT
    validation: DefinitionValidation
    changes: tuple[DefinitionChange, ...]
    content_fingerprint: str
    latest_published_version: int | None
    next_version: int
    matches_latest_published: bool


@dataclass(frozen=True, slots=True)
class PayloadCodec[PayloadT]:
    """Everything that is per-type about one definition payload.

    Held as callables rather than subclass hooks so a payload module stays a set of pure
    functions the domain and the tests can use without an object graph.
    """

    definition_type: DefinitionType
    document: Callable[[PayloadT], dict[str, CanonicalValue]]
    from_document: Callable[[object], PayloadT]
    fingerprint: Callable[[PayloadT], str]
    validate: Callable[[PayloadT], DefinitionValidation]
    summarize_changes: Callable[[PayloadT | None, PayloadT], tuple[DefinitionChange, ...]]


class DefinitionRepository[PayloadT](Protocol):
    """Persistence port for one definition type's drafts and published versions."""

    def list_definitions(self) -> tuple[DefinitionListing[PayloadT], ...]: ...

    def get_draft(self, definition: DefinitionId) -> DefinitionDraftRecord[PayloadT] | None: ...

    def save_draft(self, record: DefinitionDraftRecord[PayloadT]) -> None: ...

    def latest_published_version(self, definition: DefinitionId) -> int | None: ...

    def get_version(self, ref: VersionRef) -> DefinitionVersionRecord[PayloadT] | None: ...

    def list_versions(self, definition: DefinitionId) -> tuple[PublishedDefinitionVersion, ...]: ...

    def save_version(self, record: DefinitionVersionRecord[PayloadT]) -> None:
        """Persist a new published version; never overwrite an existing one."""
        ...


@dataclass(frozen=True, slots=True)
class AuthoringErrors:
    """The per-type error family, so the HTTP layer can name the refused resource."""

    not_found: type[DefinitionNotFoundError]
    version_not_found: type[DefinitionVersionNotFoundError]
    not_publishable: type[DefinitionNotPublishableError]


class DefinitionAuthoringService[PayloadT]:
    """Draft editing, publish-gate validation, and immutable versions for one type."""

    def __init__(
        self,
        repository: DefinitionRepository[PayloadT],
        clock: Clock,
        codec: PayloadCodec[PayloadT],
        errors: AuthoringErrors,
        noun: str,
    ) -> None:
        self._repository = repository
        self._clock = clock
        self._codec = codec
        self._errors = errors
        self._noun = noun

    def _definition(self, definition_id: UUID) -> DefinitionId:
        return DefinitionId(definition_type=self._codec.definition_type, id=definition_id)

    def list_definitions(self) -> tuple[DefinitionListing[PayloadT], ...]:
        return self._repository.list_definitions()

    def create(self, payload: PayloadT) -> DefinitionDraftRecord[PayloadT]:
        """Create the stable identity and its first, deliberately incomplete draft."""
        now = self._clock.now()
        record = DefinitionDraftRecord[PayloadT](
            draft=DefinitionDraft(definition=self._definition(uuid4())),
            payload=payload,
            created_at=now,
            updated_at=now,
        )
        self._repository.save_draft(record)
        return record

    def get_draft(self, definition_id: UUID) -> DefinitionDraftRecord[PayloadT]:
        record = self._repository.get_draft(self._definition(definition_id))
        if record is None:
            raise self._errors.not_found(f"{self._noun} {definition_id} has no draft")
        return record

    def replace_draft(
        self, definition_id: UUID, payload: PayloadT
    ) -> DefinitionDraftRecord[PayloadT]:
        """Replace the whole draft payload; published versions are never touched."""
        existing = self.get_draft(definition_id)
        record = DefinitionDraftRecord[PayloadT](
            draft=existing.draft,
            payload=payload,
            created_at=existing.created_at,
            updated_at=self._clock.now(),
        )
        self._repository.save_draft(record)
        return record

    def preview_draft(self, definition_id: UUID) -> DefinitionDraftPreview[PayloadT]:
        """Validate the draft and describe the version publishing it would create."""
        record = self.get_draft(definition_id)
        latest = self._repository.latest_published_version(record.definition)
        published_payload: PayloadT | None = None
        if latest is not None:
            published = self._repository.get_version(
                VersionRef(definition=record.definition, version=latest)
            )
            if published is None:
                raise self._errors.version_not_found(
                    f"{self._noun} {definition_id} version {latest} is recorded but not resolvable"
                )
            published_payload = published.payload
        fingerprint = self._codec.fingerprint(record.payload)
        return DefinitionDraftPreview[PayloadT](
            payload=record.payload,
            validation=self._codec.validate(record.payload),
            changes=self._codec.summarize_changes(published_payload, record.payload),
            content_fingerprint=fingerprint,
            latest_published_version=latest,
            next_version=1 if latest is None else latest + 1,
            matches_latest_published=(
                published_payload is not None
                and self._codec.fingerprint(published_payload) == fingerprint
            ),
        )

    def publish(self, definition_id: UUID) -> DefinitionVersionRecord[PayloadT]:
        """Freeze the draft into the next immutable version once the gate is clear."""
        record = self._repository.get_draft(self._definition(definition_id))
        if record is None:
            # The same not-found family as every read, so publishing an unknown definition
            # names the resource the caller actually asked for.
            raise self._errors.not_found(f"{self._noun} {definition_id} has no draft to publish")
        validation = self._codec.validate(record.payload)
        if not validation.publishable:
            raise self._errors.not_publishable(validation)

        published = publish_draft(
            record.draft,
            latest_published_version=self._repository.latest_published_version(record.definition),
            pinned_scope=None,
            pinned_references=(),
            content_fingerprint=self._codec.fingerprint(record.payload),
            published_at=self._clock.now(),
        )
        version = DefinitionVersionRecord[PayloadT](published=published, payload=record.payload)
        self._repository.save_version(version)
        return version

    def list_versions(self, definition_id: UUID) -> tuple[PublishedDefinitionVersion, ...]:
        definition = self._definition(definition_id)
        if self._repository.get_draft(definition) is None:
            raise self._errors.not_found(f"{self._noun} {definition_id} has no draft")
        return self._repository.list_versions(definition)

    def get_version(self, definition_id: UUID, version: int) -> DefinitionVersionRecord[PayloadT]:
        record = self._repository.get_version(
            VersionRef(definition=self._definition(definition_id), version=version)
        )
        if record is None:
            raise self._errors.version_not_found(
                f"{self._noun} {definition_id} has no published version {version}"
            )
        return record
