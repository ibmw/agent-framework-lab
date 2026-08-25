"""Authoring the shared objective- and mutation-block libraries.

Blocks are shop-independent and hold no definition references, so like support identities
they run on the shared lifecycle unchanged (ADR 0012): only the codec, the publish gate, and
the list projection are per-type. What the two services add is the library's own rule — a
block's name is kept free among live drafts, so an author browsing the library never has to
tell two entries apart by nothing.

The two services are separate types rather than one parameterized service because their
errors are separate families: refusing to publish an objective block has to name an objective
block, and the HTTP layer maps one error type to one code.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from capability_lab.application.block_payloads import (
    mutation_block_content_fingerprint,
    mutation_block_document,
    mutation_block_from_document,
    objective_block_content_fingerprint,
    objective_block_document,
    objective_block_from_document,
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
from capability_lab.application.definition_resolution import DefinitionResolutionError
from capability_lab.application.ports import Clock
from capability_lab.domain.blocks import (
    BlockPayload,
    MutationBlockPayload,
    ObjectiveBlockPayload,
    new_mutation_block,
    new_objective_block,
    shop_bound_parameters,
    summarize_mutation_block_changes,
    summarize_objective_block_changes,
    validate_mutation_block,
    validate_objective_block,
)
from capability_lab.domain.definitions import DefinitionId, DefinitionType


class ObjectiveBlockNotFoundError(DefinitionNotFoundError):
    """Raised when an objective block has never been created."""


class ObjectiveBlockVersionNotFoundError(DefinitionVersionNotFoundError):
    """Raised when a published objective-block version does not exist."""


class ObjectiveBlockNotPublishableError(DefinitionNotPublishableError):
    """Raised when an objective-block draft still has publish-gate errors."""

    noun = "objective block"


class MutationBlockNotFoundError(DefinitionNotFoundError):
    """Raised when a mutation block has never been created."""


class MutationBlockVersionNotFoundError(DefinitionVersionNotFoundError):
    """Raised when a published mutation-block version does not exist."""


class MutationBlockNotPublishableError(DefinitionNotPublishableError):
    """Raised when a mutation-block draft still has publish-gate errors."""

    noun = "mutation block"


class BlockNameExistsError(DefinitionResolutionError):
    """Raised when another block in the same library already answers to that name."""


OBJECTIVE_BLOCK_CODEC: PayloadCodec[ObjectiveBlockPayload] = PayloadCodec(
    definition_type=DefinitionType.OBJECTIVE_BLOCK,
    document=objective_block_document,
    from_document=objective_block_from_document,
    fingerprint=objective_block_content_fingerprint,
    validate=validate_objective_block,
    summarize_changes=summarize_objective_block_changes,
)

MUTATION_BLOCK_CODEC: PayloadCodec[MutationBlockPayload] = PayloadCodec(
    definition_type=DefinitionType.MUTATION_BLOCK,
    document=mutation_block_document,
    from_document=mutation_block_from_document,
    fingerprint=mutation_block_content_fingerprint,
    validate=validate_mutation_block,
    summarize_changes=summarize_mutation_block_changes,
)

ObjectiveBlockDraftRecord = DefinitionDraftRecord[ObjectiveBlockPayload]
ObjectiveBlockVersionRecord = DefinitionVersionRecord[ObjectiveBlockPayload]
ObjectiveBlockDraftPreview = DefinitionDraftPreview[ObjectiveBlockPayload]
ObjectiveBlockRepository = DefinitionRepository[ObjectiveBlockPayload]

MutationBlockDraftRecord = DefinitionDraftRecord[MutationBlockPayload]
MutationBlockVersionRecord = DefinitionVersionRecord[MutationBlockPayload]
MutationBlockDraftPreview = DefinitionDraftPreview[MutationBlockPayload]
MutationBlockRepository = DefinitionRepository[MutationBlockPayload]


def objective_block_definition_id(block_id: UUID) -> DefinitionId:
    return DefinitionId(definition_type=DefinitionType.OBJECTIVE_BLOCK, id=block_id)


def mutation_block_definition_id(block_id: UUID) -> DefinitionId:
    return DefinitionId(definition_type=DefinitionType.MUTATION_BLOCK, id=block_id)


@dataclass(frozen=True, slots=True)
class BlockSummary:
    """One row of a block library's index.

    `shop_bound_parameter_count` is the column the libraries' shared warning rests on: it is
    how many bindings a scenario will have to resolve inside its own shop.
    """

    definition_id: UUID
    name: str
    statement: str
    type_label: str
    parameter_count: int
    shop_bound_parameter_count: int
    updated_at: datetime
    latest_published_version: int | None
    published_version_count: int


def _summary(
    definition_id: UUID,
    payload: BlockPayload,
    type_label: str,
    updated_at: datetime,
    latest_published_version: int | None,
    published_version_count: int,
) -> BlockSummary:
    return BlockSummary(
        definition_id=definition_id,
        name=payload.name,
        statement=payload.statement,
        type_label=type_label,
        parameter_count=len(payload.parameters),
        shop_bound_parameter_count=len(shop_bound_parameters(payload.parameters)),
        updated_at=updated_at,
        latest_published_version=latest_published_version,
        published_version_count=published_version_count,
    )


class _BlockLibraryService[PayloadT: BlockPayload](DefinitionAuthoringService[PayloadT]):
    """The half both libraries share: index rows and the lab-unique block name."""

    def list_blocks(self) -> tuple[BlockSummary, ...]:
        return tuple(
            _summary(
                listing.definition_id,
                listing.payload,
                self._type_label(listing.payload),
                listing.updated_at,
                listing.latest_published_version,
                listing.published_version_count,
            )
            for listing in self.list_definitions()
        )

    def _type_label(self, payload: PayloadT) -> str:
        raise NotImplementedError

    def _require_free_name(self, name: str, *, block_id: UUID | None) -> None:
        """Keep the name free among the library's live drafts.

        Deliberately *not* an identity rule. A scenario binds a template by its `DefinitionId`
        and pins an exact `VersionRef`; the name never enters a binding, so two lineages that
        end up sharing one resolve to different blocks regardless. That is what makes renaming
        safe, and renaming in turn means a published version's name can be taken again — this
        check scans drafts only, and deliberately so.

        What it buys is the library index: the one place a human picks a template by reading
        it. Two live drafts called `read-required-document` would be indistinguishable there.

        Checked in the service, like a ticket's reference and with the same caveat: two
        concurrent creations could both pass. Closing it needs a unique index over the
        payload's name on `definition_drafts`, which belongs with the first slice that has a
        real concurrent-authoring requirement.
        """
        for listing in self.list_definitions():
            if listing.payload.name == name and listing.definition_id != block_id:
                raise BlockNameExistsError(
                    f"another block in this library is already drafted as {name}"
                )


class ObjectiveBlockService(_BlockLibraryService[ObjectiveBlockPayload]):
    def __init__(self, repository: ObjectiveBlockRepository, clock: Clock) -> None:
        super().__init__(
            repository,
            clock,
            OBJECTIVE_BLOCK_CODEC,
            AuthoringErrors(
                not_found=ObjectiveBlockNotFoundError,
                version_not_found=ObjectiveBlockVersionNotFoundError,
                not_publishable=ObjectiveBlockNotPublishableError,
            ),
            noun="objective block",
        )

    def _type_label(self, payload: ObjectiveBlockPayload) -> str:
        return f"{payload.assessment.value} · {payload.evidence.value}"

    def create_block(self, name: str) -> ObjectiveBlockDraftRecord:
        """Create the block's stable identity and its first, incomplete draft."""
        self._require_free_name(name, block_id=None)
        return self.create(new_objective_block(name))

    def replace_block(
        self, block_id: UUID, payload: ObjectiveBlockPayload
    ) -> ObjectiveBlockDraftRecord:
        """Replace the whole draft. Renaming is allowed while the new name is free."""
        # Read first so an unknown block answers not-found rather than a name conflict
        # against a block that was never there.
        self.get_draft(block_id)
        self._require_free_name(payload.name, block_id=block_id)
        return self.replace_draft(block_id, payload)


class MutationBlockService(_BlockLibraryService[MutationBlockPayload]):
    def __init__(self, repository: MutationBlockRepository, clock: Clock) -> None:
        super().__init__(
            repository,
            clock,
            MUTATION_BLOCK_CODEC,
            AuthoringErrors(
                not_found=MutationBlockNotFoundError,
                version_not_found=MutationBlockVersionNotFoundError,
                not_publishable=MutationBlockNotPublishableError,
            ),
            noun="mutation block",
        )

    def _type_label(self, payload: MutationBlockPayload) -> str:
        return payload.effect.value

    def create_block(self, name: str) -> MutationBlockDraftRecord:
        """Create the block's stable identity and its first, incomplete draft."""
        self._require_free_name(name, block_id=None)
        return self.create(new_mutation_block(name))

    def replace_block(
        self, block_id: UUID, payload: MutationBlockPayload
    ) -> MutationBlockDraftRecord:
        """Replace the whole draft. Renaming is allowed while the new name is free."""
        # Read first so an unknown block answers not-found rather than a name conflict
        # against a block that was never there.
        self.get_draft(block_id)
        self._require_free_name(payload.name, block_id=block_id)
        return self.replace_draft(block_id, payload)
