"""The draft/published authoring lifecycle shared by every definition type.

ADR 0012 fixes one lifecycle for all authorable definitions and ADR 0013 records that only
the payload codec and the publish gate are per-type. This module is that shared half:
create a stable identity with an incomplete draft, replace the draft, preview what
publishing would freeze, and freeze it into the next immutable version.

One service covers both halves of ADR 0012's lifecycle. A shop-independent, reference-free
type (shop, customer profile, support identity) declares neither a scope nor references and
publishes exactly as before. A shop-scoped type (ticket, scenario) declares its owning shop
when the definition is created and derives its references from its own payload, so publishing
pins the exact shop version and the exact target versions in the same step.

References are derived from the payload rather than tracked beside it: a ticket names its
customer profile inside its content, and two sources for one fact would eventually disagree.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime
from typing import Protocol
from uuid import UUID, uuid4

from capability_lab.application.canonical_json import CanonicalValue
from capability_lab.application.definition_resolution import (
    DefinitionResolutionError,
    UnpublishedReferenceError,
)
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


def _no_references(_payload: object) -> tuple[DefinitionId, ...]:
    """Most definition types hold no definition-to-definition reference (ADR 0012)."""
    return ()


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
    # The definition-to-definition references this payload names, derived from its content
    # so the draft cannot hold a reference the payload no longer makes. Types with no
    # references in ADR 0012's table leave the default.
    references: Callable[[PayloadT], tuple[DefinitionId, ...]] = _no_references


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


class ShopScopedDefinitionRepository[PayloadT](DefinitionRepository[PayloadT], Protocol):
    """A definition type whose drafts belong to one shop and are listed per shop."""

    def list_in_shop(self, shop_id: UUID) -> tuple[DefinitionListing[PayloadT], ...]: ...


class PublishedVersionDirectory(Protocol):
    """The latest published version of any definition, whatever payload type it holds.

    Publishing a ticket has to pin its shop and its customer profile, and neither shares the
    ticket's payload type. Only the version provenance is needed, never the content, so this
    port reads it without a codec instead of forcing the caller to hold three typed
    repositories.
    """

    def latest_published(self, definition: DefinitionId) -> PublishedDefinitionVersion | None: ...


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
        versions: PublishedVersionDirectory | None = None,
    ) -> None:
        self._repository = repository
        self._clock = clock
        self._codec = codec
        self._errors = errors
        self._noun = noun
        self._versions = versions

    def _definition(self, definition_id: UUID) -> DefinitionId:
        return DefinitionId(definition_type=self._codec.definition_type, id=definition_id)

    def list_definitions(self) -> tuple[DefinitionListing[PayloadT], ...]:
        return self._repository.list_definitions()

    def create(
        self, payload: PayloadT, *, shop: DefinitionId | None = None
    ) -> DefinitionDraftRecord[PayloadT]:
        """Create the stable identity and its first, deliberately incomplete draft.

        The owning shop is fixed here and never moves: a shop-scoped definition names
        same-shop objects throughout its content, so relocating it would strand every one
        of them.
        """
        now = self._clock.now()
        record = DefinitionDraftRecord[PayloadT](
            draft=self._draft(self._definition(uuid4()), payload, shop),
            payload=payload,
            created_at=now,
            updated_at=now,
        )
        self._repository.save_draft(record)
        return record

    def _draft(
        self, definition: DefinitionId, payload: PayloadT, shop: DefinitionId | None
    ) -> DefinitionDraft:
        return DefinitionDraft(
            definition=definition, shop=shop, references=self._codec.references(payload)
        )

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
            # The scope is identity and survives every edit; the references are content and
            # are re-derived, so a payload that stops naming a target stops referencing it.
            draft=self._draft(existing.definition, payload, existing.draft.shop),
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
            validation=self._validate(record),
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
        validation = self._validate(record)
        if not validation.publishable:
            raise self._errors.not_publishable(validation)

        draft = record.draft
        published = publish_draft(
            draft,
            latest_published_version=self._repository.latest_published_version(record.definition),
            pinned_scope=None if draft.shop is None else self._pin(draft.shop),
            pinned_references=tuple(self._pin(reference) for reference in draft.references),
            content_fingerprint=self._codec.fingerprint(record.payload),
            published_at=self._clock.now(),
        )
        version = DefinitionVersionRecord[PayloadT](published=published, payload=record.payload)
        self._repository.save_version(version)
        return version

    def _validate(self, record: DefinitionDraftRecord[PayloadT]) -> DefinitionValidation:
        """The publish gate for this draft.

        The codec's rules are everything a payload can be judged on alone. A shop-scoped
        type whose findings are mostly the shop's answer to what it points at overrides this
        and validates against the surrounding content, so the preview an author reads and
        the gate that refuses publication can never be two different rule sets.
        """
        return self._codec.validate(record.payload)

    def _latest_published(self, target: DefinitionId) -> int | None:
        """The version a publication would pin this target at, or None if it has none.

        The read half of `_pin`, for a gate that wants to *report* an unpublishable target
        rather than refuse the freeze.
        """
        if self._versions is None:
            return None
        published = self._versions.latest_published(target)
        return None if published is None else published.version

    def _pin(self, target: DefinitionId) -> PublishedDefinitionVersion:
        """Resolve the exact version this publication freezes its target at.

        ADR 0012 pins the *latest* published version at publish time and never substitutes
        one later, so a target that has never been published stops the publication here
        rather than freezing a dangling pointer.
        """
        if self._versions is None:
            raise DefinitionResolutionError(
                f"{self._noun} publication needs a published-version directory to pin "
                f"{target.definition_type} {target.id}"
            )
        published = self._versions.latest_published(target)
        if published is None:
            raise UnpublishedReferenceError(
                f"{target.definition_type} {target.id} has no published version to pin; "
                "publish it before publishing this " + self._noun
            )
        return published

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
