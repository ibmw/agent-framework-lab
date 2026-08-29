from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Protocol

from capability_lab.application.ports import Clock
from capability_lab.domain.definitions import (
    DefinitionDraft,
    DefinitionId,
    DefinitionType,
    PublishedDefinitionVersion,
    VersionRef,
    publish_draft,
)
from capability_lab.domain.entities import MAX_SCENARIO_SEED, MIN_SCENARIO_SEED
from capability_lab.domain.experiment import ParticipantDriverType


class DefinitionResolutionError(ValueError):
    """Raised when a definition lifecycle or resolution request cannot be satisfied."""


class MissingDraftError(DefinitionResolutionError):
    """Raised when publishing is requested for a definition without a draft."""


class UnpublishedReferenceError(DefinitionResolutionError):
    """Raised when a referenced definition has no published version to pin."""


class MissingReferenceVersionError(DefinitionResolutionError):
    """Raised when a pinned reference names a version the repository does not hold."""


class PublishedVersionExistsError(DefinitionResolutionError):
    """Raised when a write would overwrite an already published version."""


class ConflictingReferenceVersionsError(DefinitionResolutionError):
    """Raised when a resolution closure pins two versions of the same definition."""


class PublishedVersionReader(Protocol):
    """Reading one published version's provenance, without its payload codec.

    A resolution walks a closure that spans definition *types* — a scenario reaches its
    ticket, its shop, its customer profile, and both libraries — so it reads version rows
    rather than decoding five different payload documents.
    """

    def get_published(self, ref: VersionRef) -> PublishedDefinitionVersion | None: ...


class DefinitionRepository(PublishedVersionReader, Protocol):
    def get_draft(self, definition: DefinitionId) -> DefinitionDraft | None: ...

    def latest_published_version(self, definition: DefinitionId) -> int | None: ...

    def save_draft(self, draft: DefinitionDraft) -> None: ...

    def save_published(self, published: PublishedDefinitionVersion) -> None:
        """Persist a new published version; never overwrite an existing one."""
        ...


def _latest_published(
    repository: DefinitionRepository, reference: DefinitionId
) -> PublishedDefinitionVersion:
    latest = repository.latest_published_version(reference)
    if latest is None:
        raise UnpublishedReferenceError(
            f"referenced {reference.definition_type} {reference.id} has no published version"
        )
    target = repository.get_published(VersionRef(definition=reference, version=latest))
    if target is None:
        raise MissingReferenceVersionError(
            f"referenced {reference.definition_type} {reference.id} version {latest} "
            "is not resolvable"
        )
    return target


def publish_definition(
    repository: DefinitionRepository,
    definition: DefinitionId,
    *,
    content_fingerprint: str,
    clock: Clock,
) -> PublishedDefinitionVersion:
    """Publish the definition's draft, pinning every reference to its latest version."""
    draft = repository.get_draft(definition)
    if draft is None:
        raise MissingDraftError(
            f"{definition.definition_type} {definition.id} has no draft to publish"
        )

    pinned_scope = None if draft.shop is None else _latest_published(repository, draft.shop)
    published = publish_draft(
        draft,
        latest_published_version=repository.latest_published_version(definition),
        pinned_scope=pinned_scope,
        pinned_references=tuple(
            _latest_published(repository, reference) for reference in draft.references
        ),
        content_fingerprint=content_fingerprint,
        published_at=clock.now(),
    )
    repository.save_published(published)
    return published


@dataclass(frozen=True, slots=True)
class ResolvedDefinition:
    """One exact behaviorally relevant input identified by an experiment resolution."""

    definition: DefinitionId
    version: int
    content_fingerprint: str

    @property
    def ref(self) -> VersionRef:
        return VersionRef(definition=self.definition, version=self.version)


@dataclass(frozen=True, slots=True)
class ArmResolution:
    """The per-arm inputs that never enter the shared sandbox fingerprint."""

    agent_configuration: ResolvedDefinition
    support_identities: tuple[ResolvedDefinition, ...]


@dataclass(frozen=True, slots=True)
class SandboxResolution:
    """The shared half of a resolution: what both arms start from, and nothing else.

    A snapshot is materialized from a scenario alone, before any agent configuration is
    chosen, so this is resolvable on its own. An experiment resolution carries the same
    three fields and the arms beside them.
    """

    sandbox_inputs: tuple[ResolvedDefinition, ...]
    seed: int
    tool_contract_versions: tuple[tuple[str, str], ...]


@dataclass(frozen=True, slots=True)
class ExperimentResolution:
    """Every input needed to explain an experiment, split by fingerprint relevance."""

    sandbox_inputs: tuple[ResolvedDefinition, ...]
    arms: tuple[ArmResolution, ...]
    seed: int
    tool_contract_versions: tuple[tuple[str, str], ...]
    participant_driver: ParticipantDriverType


def _resolved(published: PublishedDefinitionVersion) -> ResolvedDefinition:
    return ResolvedDefinition(
        definition=published.definition,
        version=published.version,
        content_fingerprint=published.content_fingerprint,
    )


def _resolve_closure(
    repository: PublishedVersionReader, root: VersionRef
) -> tuple[ResolvedDefinition, ...]:
    # The allowed-reference type graph is acyclic, so a visited set only deduplicates
    # diamonds; it cannot mask a cycle built from valid domain objects.
    resolved: dict[DefinitionId, ResolvedDefinition] = {}
    pending: list[VersionRef] = [root]
    while pending:
        ref = pending.pop()
        known = resolved.get(ref.definition)
        if known is not None:
            if known.version != ref.version:
                raise ConflictingReferenceVersionsError(
                    f"{ref.definition.definition_type} {ref.definition.id} is pinned at "
                    f"both version {known.version} and version {ref.version}; republish "
                    "the referencing definitions against one version"
                )
            continue
        published = repository.get_published(ref)
        if published is None:
            raise MissingReferenceVersionError(
                f"{ref.definition.definition_type} {ref.definition.id} "
                f"version {ref.version} is not resolvable"
            )
        resolved[ref.definition] = _resolved(published)
        pending.extend(published.references)
        scope_ref = published.scope_ref
        if scope_ref is not None:
            pending.append(scope_ref)
    return tuple(
        sorted(
            resolved.values(),
            key=lambda entry: (
                entry.definition.definition_type.value,
                str(entry.definition.id),
                entry.version,
            ),
        )
    )


def _require_seed(value: object) -> None:
    if (
        isinstance(value, bool)
        or not isinstance(value, int)
        or not MIN_SCENARIO_SEED <= value <= MAX_SCENARIO_SEED
    ):
        raise DefinitionResolutionError(
            f"seed must be an integer between {MIN_SCENARIO_SEED} and {MAX_SCENARIO_SEED}"
        )


def _require_root_type(ref: VersionRef, expected: DefinitionType, role: str) -> None:
    if ref.definition.definition_type is not expected:
        raise DefinitionResolutionError(
            f"{role} must reference a {expected} definition, not {ref.definition.definition_type}"
        )


def resolve_sandbox_inputs(
    repository: PublishedVersionReader,
    *,
    scenario: VersionRef,
    seed: int,
    tool_contract_versions: Mapping[str, str],
) -> SandboxResolution:
    """Resolve the shared starting inputs one scenario version freezes.

    Materializing a snapshot happens before an experiment exists, so this half resolves on
    its own; `resolve_experiment_inputs` adds the arms to exactly this result.
    """
    _require_root_type(scenario, DefinitionType.SCENARIO, "a sandbox scenario")
    _require_seed(seed)
    for name, version in tool_contract_versions.items():
        if not name or name != name.strip() or not version or version != version.strip():
            raise DefinitionResolutionError(
                "tool contract names and versions must be non-empty strings "
                "without surrounding whitespace"
            )
    return SandboxResolution(
        sandbox_inputs=_resolve_closure(repository, scenario),
        seed=seed,
        tool_contract_versions=tuple(sorted(tool_contract_versions.items())),
    )


def resolve_experiment_inputs(
    # A resolution reads published versions and nothing else, so it asks for the reader that
    # says so. It was declared against the wider repository before it had a caller; the
    # runner that now calls it holds the published-version directory, and narrowing the
    # parameter is what keeps "a resolution never touches a draft" a signature rather than a
    # convention.
    repository: PublishedVersionReader,
    *,
    scenario: VersionRef,
    agent_configurations: tuple[VersionRef, ...],
    seed: int,
    tool_contract_versions: Mapping[str, str],
    participant_driver: ParticipantDriverType,
) -> ExperimentResolution:
    """Resolve one experiment's complete behaviorally relevant input set."""
    if not 1 <= len(agent_configurations) <= 2:
        raise DefinitionResolutionError("an experiment requires one or two agent configurations")
    sandbox = resolve_sandbox_inputs(
        repository,
        scenario=scenario,
        seed=seed,
        tool_contract_versions=tool_contract_versions,
    )

    arms: list[ArmResolution] = []
    for arm_root in agent_configurations:
        _require_root_type(arm_root, DefinitionType.AGENT_CONFIGURATION, "an experiment arm")
        closure = _resolve_closure(repository, arm_root)
        agent_entries = [
            entry
            for entry in closure
            if entry.definition.definition_type is DefinitionType.AGENT_CONFIGURATION
        ]
        arms.append(
            ArmResolution(
                agent_configuration=agent_entries[0],
                support_identities=tuple(
                    entry
                    for entry in closure
                    if entry.definition.definition_type is DefinitionType.SUPPORT_IDENTITY
                ),
            )
        )

    return ExperimentResolution(
        sandbox_inputs=sandbox.sandbox_inputs,
        arms=tuple(arms),
        seed=sandbox.seed,
        tool_contract_versions=sandbox.tool_contract_versions,
        participant_driver=participant_driver,
    )
