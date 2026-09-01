"""Judge authoring: draft editing, publish gate, and immutable versions.

A judge configuration is shop-independent and references no other definition — it names a
provider, a model, a rubric, and what it is shown, and none of those are definitions. So it
uses the shared lifecycle with nothing but a codec and a gate, which is the smallest a
definition type has been since ADR 0014 extracted the lifecycle.

The gate reaches outside the payload for exactly two things, both of which belong to the
surrounding world rather than to the content:

- what the lab has proven it can judge with (`judge_capabilities`); and
- what the arms run, because a rubric may not name any of it.

There is deliberately no preview resolution beside the gate. An agent configuration resolves
its prompt against a shop because a run injects those values (ADR 0024); a judge's rubric
names nothing the lab resolves — what it is shown is a document built from one arm's record
at scoring time, and a preview of it would need an experiment, which is not what an author
is looking at.
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
from capability_lab.application.judge_capabilities import (
    DEFAULT_JUDGE_EVIDENCE,
    PROVEN_JUDGES,
    PROVEN_JUDGES_BY_PROVIDER,
    ProvenJudge,
    default_judge_model,
    judge_capability_issues,
    reserved_rubric_terms,
)
from capability_lab.application.judge_payload import (
    judge_configuration_content_fingerprint,
    judge_configuration_document,
    judge_configuration_from_document,
)
from capability_lab.application.ports import Clock
from capability_lab.domain.definitions import (
    DefinitionId,
    DefinitionIssue,
    DefinitionType,
    DefinitionValidation,
    validation_of,
)
from capability_lab.domain.judge import (
    JudgeConfigurationPayload,
    JudgeEvidenceScope,
    judge_configuration_issues,
    summarize_judge_configuration_changes,
    validate_judge_configuration,
)

__all__ = [
    "JUDGE_CONFIGURATION_CODEC",
    "JudgeConfigurationDraftPreview",
    "JudgeConfigurationDraftRecord",
    "JudgeConfigurationNotFoundError",
    "JudgeConfigurationNotPublishableError",
    "JudgeConfigurationRepository",
    "JudgeConfigurationResources",
    "JudgeConfigurationService",
    "JudgeConfigurationSummary",
    "JudgeConfigurationVersionNotFoundError",
    "JudgeConfigurationVersionRecord",
    "judge_configuration_definition_id",
    "new_judge_configuration",
]


class JudgeConfigurationNotFoundError(DefinitionNotFoundError):
    """Raised when a judge-configuration definition has never been created."""


class JudgeConfigurationVersionNotFoundError(DefinitionVersionNotFoundError):
    """Raised when a published judge-configuration version does not exist."""


class JudgeConfigurationNotPublishableError(DefinitionNotPublishableError):
    """Raised when a judge-configuration draft still has publish-gate errors."""

    noun = "judge configuration"


def judge_configuration_definition_id(judge_id: UUID) -> DefinitionId:
    return DefinitionId(definition_type=DefinitionType.JUDGE_CONFIGURATION, id=judge_id)


JUDGE_CONFIGURATION_CODEC: PayloadCodec[JudgeConfigurationPayload] = PayloadCodec(
    definition_type=DefinitionType.JUDGE_CONFIGURATION,
    document=judge_configuration_document,
    from_document=judge_configuration_from_document,
    fingerprint=judge_configuration_content_fingerprint,
    validate=validate_judge_configuration,
    summarize_changes=summarize_judge_configuration_changes,
)

JudgeConfigurationDraftRecord = DefinitionDraftRecord[JudgeConfigurationPayload]
JudgeConfigurationVersionRecord = DefinitionVersionRecord[JudgeConfigurationPayload]
JudgeConfigurationDraftPreview = DefinitionDraftPreview[JudgeConfigurationPayload]
JudgeConfigurationRepository = DefinitionRepository[JudgeConfigurationPayload]


@dataclass(frozen=True, slots=True)
class JudgeConfigurationSummary:
    """One row of the Studio's judge index."""

    judge_id: UUID
    name: str
    provider: str
    provider_label: str
    model_id: str
    evidence_count: int
    updated_at: datetime
    latest_published_version: int | None
    published_version_count: int


@dataclass(frozen=True, slots=True)
class JudgeConfigurationResources:
    """Exactly what a judge may name, so a picker cannot offer a gate error."""

    judges: tuple[ProvenJudge, ...]
    evidence: tuple[JudgeEvidenceScope, ...]
    reserved_terms: tuple[str, ...]


def new_judge_configuration(name: str) -> JudgeConfigurationPayload:
    """The deliberately incomplete first draft: a judge with no rubric.

    The rubric is the whole of what a judge is, and a default one would be published by
    someone who never wrote it — a versioned evaluator saying something nobody decided. What
    *is* defaulted is the model and the evidence, because those have a right answer the lab
    has already proven (`judge_capabilities`) and an author changes them deliberately.
    """
    return JudgeConfigurationPayload(
        name=name,
        model=default_judge_model(),
        evidence=DEFAULT_JUDGE_EVIDENCE,
    )


class JudgeConfigurationService(DefinitionAuthoringService[JudgeConfigurationPayload]):
    """Author, validate, and publish the lab's cross-shop judges."""

    def __init__(self, repository: JudgeConfigurationRepository, clock: Clock) -> None:
        super().__init__(
            repository,
            clock,
            JUDGE_CONFIGURATION_CODEC,
            AuthoringErrors(
                not_found=JudgeConfigurationNotFoundError,
                version_not_found=JudgeConfigurationVersionNotFoundError,
                not_publishable=JudgeConfigurationNotPublishableError,
            ),
            noun="judge configuration",
        )

    def _validate(self, record: JudgeConfigurationDraftRecord) -> DefinitionValidation:
        """Judge the draft against its own content, the catalog, and what the arms run."""
        issues: list[DefinitionIssue] = list(judge_configuration_issues(record.payload))
        issues.extend(judge_capability_issues(record.payload))
        return validation_of(issues)

    def list_judges(self) -> tuple[JudgeConfigurationSummary, ...]:
        return tuple(
            JudgeConfigurationSummary(
                judge_id=listing.definition_id,
                name=listing.payload.name,
                provider=listing.payload.model.provider,
                provider_label=_provider_label(listing.payload.model.provider),
                model_id=listing.payload.model.model_id,
                evidence_count=len(listing.payload.evidence),
                updated_at=listing.updated_at,
                latest_published_version=listing.latest_published_version,
                published_version_count=listing.published_version_count,
            )
            for listing in self.list_definitions()
        )

    def create_judge(self, name: str) -> JudgeConfigurationDraftRecord:
        return self.create(new_judge_configuration(name))

    def replace_judge(
        self, judge_id: UUID, payload: JudgeConfigurationPayload
    ) -> JudgeConfigurationDraftRecord:
        return self.replace_draft(judge_id, payload)

    def resources(self) -> JudgeConfigurationResources:
        return JudgeConfigurationResources(
            judges=PROVEN_JUDGES,
            evidence=tuple(JudgeEvidenceScope),
            reserved_terms=reserved_rubric_terms(),
        )


def _provider_label(provider: str) -> str:
    judge = PROVEN_JUDGES_BY_PROVIDER.get(provider)
    return provider if judge is None else judge.label
