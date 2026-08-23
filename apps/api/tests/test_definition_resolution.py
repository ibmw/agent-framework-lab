from datetime import UTC, datetime
from uuid import uuid4

import pytest

from capability_lab.application.definition_resolution import (
    ConflictingReferenceVersionsError,
    DefinitionResolutionError,
    MissingDraftError,
    MissingReferenceVersionError,
    ParticipantDriverType,
    PublishedVersionExistsError,
    UnpublishedReferenceError,
    publish_definition,
    resolve_experiment_inputs,
)
from capability_lab.domain.definitions import (
    DefinitionDraft,
    DefinitionId,
    DefinitionType,
    PublishedDefinitionVersion,
    VersionRef,
)

FINGERPRINT = "c" * 64
TOOL_CONTRACTS = {"commerce.read_order": "v1", "commerce.change_address": "v1"}


class FixedClock:
    def now(self) -> datetime:
        return datetime(2026, 8, 23, 12, 0, tzinfo=UTC)


class InMemoryDefinitionRepository:
    def __init__(self) -> None:
        self._drafts: dict[DefinitionId, DefinitionDraft] = {}
        self._published: dict[VersionRef, PublishedDefinitionVersion] = {}

    def get_draft(self, definition: DefinitionId) -> DefinitionDraft | None:
        return self._drafts.get(definition)

    def get_published(self, ref: VersionRef) -> PublishedDefinitionVersion | None:
        return self._published.get(ref)

    def latest_published_version(self, definition: DefinitionId) -> int | None:
        versions = [ref.version for ref in self._published if ref.definition == definition]
        return max(versions) if versions else None

    def save_draft(self, draft: DefinitionDraft) -> None:
        self._drafts[draft.definition] = draft

    def save_published(self, published: PublishedDefinitionVersion) -> None:
        if published.ref in self._published:
            raise PublishedVersionExistsError(
                f"version {published.version} of {published.definition.id} already exists"
            )
        self._published[published.ref] = published


def definition_id(definition_type: DefinitionType) -> DefinitionId:
    return DefinitionId(definition_type=definition_type, id=uuid4())


def draft_and_publish(
    repository: InMemoryDefinitionRepository,
    definition: DefinitionId,
    *,
    shop: DefinitionId | None = None,
    references: tuple[DefinitionId, ...] = (),
) -> PublishedDefinitionVersion:
    repository.save_draft(DefinitionDraft(definition=definition, shop=shop, references=references))
    return publish_definition(
        repository, definition, content_fingerprint=FINGERPRINT, clock=FixedClock()
    )


@pytest.fixture
def repository() -> InMemoryDefinitionRepository:
    return InMemoryDefinitionRepository()


def build_experiment_graph(
    repository: InMemoryDefinitionRepository,
) -> tuple[VersionRef, VersionRef]:
    """Publish a full wrong-address-style definition graph; return scenario and agent refs."""
    shop = definition_id(DefinitionType.SHOP)
    profile = definition_id(DefinitionType.CUSTOMER_PROFILE)
    ticket = definition_id(DefinitionType.TICKET)
    objective = definition_id(DefinitionType.OBJECTIVE_BLOCK)
    mutation = definition_id(DefinitionType.MUTATION_BLOCK)
    scenario = definition_id(DefinitionType.SCENARIO)
    identity = definition_id(DefinitionType.SUPPORT_IDENTITY)
    agent = definition_id(DefinitionType.AGENT_CONFIGURATION)

    draft_and_publish(repository, shop)
    draft_and_publish(repository, profile)
    draft_and_publish(repository, ticket, shop=shop, references=(profile,))
    draft_and_publish(repository, objective)
    draft_and_publish(repository, mutation)
    scenario_version = draft_and_publish(
        repository, scenario, shop=shop, references=(ticket, objective, mutation)
    )
    draft_and_publish(repository, identity)
    agent_version = draft_and_publish(repository, agent, references=(identity,))
    return scenario_version.ref, agent_version.ref


def resolve(
    repository: InMemoryDefinitionRepository,
    scenario: VersionRef,
    *agent_configurations: VersionRef,
):
    return resolve_experiment_inputs(
        repository,
        scenario=scenario,
        agent_configurations=agent_configurations,
        seed=1234,
        tool_contract_versions=TOOL_CONTRACTS,
        participant_driver=ParticipantDriverType.HUMAN,
    )


def test_publish_assigns_monotonic_versions_and_never_overwrites(
    repository: InMemoryDefinitionRepository,
) -> None:
    shop = definition_id(DefinitionType.SHOP)
    first = draft_and_publish(repository, shop)
    second = publish_definition(
        repository, shop, content_fingerprint=FINGERPRINT, clock=FixedClock()
    )
    assert (first.version, second.version) == (1, 2)
    with pytest.raises(PublishedVersionExistsError):
        repository.save_published(first)


def test_publishing_requires_a_draft(repository: InMemoryDefinitionRepository) -> None:
    with pytest.raises(MissingDraftError):
        publish_definition(
            repository,
            definition_id(DefinitionType.SHOP),
            content_fingerprint=FINGERPRINT,
            clock=FixedClock(),
        )


def test_publishing_rejects_unpublished_references(
    repository: InMemoryDefinitionRepository,
) -> None:
    shop = definition_id(DefinitionType.SHOP)
    draft_and_publish(repository, shop)
    ticket = definition_id(DefinitionType.TICKET)
    repository.save_draft(
        DefinitionDraft(
            definition=ticket,
            shop=shop,
            references=(definition_id(DefinitionType.CUSTOMER_PROFILE),),
        )
    )
    with pytest.raises(UnpublishedReferenceError, match="no published version"):
        publish_definition(repository, ticket, content_fingerprint=FINGERPRINT, clock=FixedClock())


def test_publishing_a_scoped_definition_requires_a_published_shop(
    repository: InMemoryDefinitionRepository,
) -> None:
    ticket = definition_id(DefinitionType.TICKET)
    repository.save_draft(
        DefinitionDraft(definition=ticket, shop=definition_id(DefinitionType.SHOP))
    )
    with pytest.raises(UnpublishedReferenceError, match="no published version"):
        publish_definition(repository, ticket, content_fingerprint=FINGERPRINT, clock=FixedClock())


def test_draft_edits_never_change_a_published_version(
    repository: InMemoryDefinitionRepository,
) -> None:
    shop = definition_id(DefinitionType.SHOP)
    profile = definition_id(DefinitionType.CUSTOMER_PROFILE)
    draft_and_publish(repository, shop)
    draft_and_publish(repository, profile)
    ticket = definition_id(DefinitionType.TICKET)
    published = draft_and_publish(repository, ticket, shop=shop, references=(profile,))

    repository.save_draft(DefinitionDraft(definition=ticket, shop=shop, references=()))

    stored = repository.get_published(published.ref)
    assert stored == published
    assert stored is not None
    assert stored.references == (VersionRef(definition=profile, version=1),)


def test_resolution_identifies_every_behaviorally_relevant_input(
    repository: InMemoryDefinitionRepository,
) -> None:
    scenario_ref, agent_ref = build_experiment_graph(repository)
    resolution = resolve(repository, scenario_ref, agent_ref)

    sandbox_types = [entry.definition.definition_type for entry in resolution.sandbox_inputs]
    assert sorted(sandbox_types) == sorted(
        [
            DefinitionType.SHOP,
            DefinitionType.CUSTOMER_PROFILE,
            DefinitionType.TICKET,
            DefinitionType.SCENARIO,
            DefinitionType.OBJECTIVE_BLOCK,
            DefinitionType.MUTATION_BLOCK,
        ]
    )
    assert all(entry.content_fingerprint == FINGERPRINT for entry in resolution.sandbox_inputs)
    assert len(resolution.arms) == 1
    arm = resolution.arms[0]
    assert arm.agent_configuration.ref == agent_ref
    assert [identity.definition.definition_type for identity in arm.support_identities] == [
        DefinitionType.SUPPORT_IDENTITY
    ]
    assert resolution.seed == 1234
    assert resolution.tool_contract_versions == tuple(sorted(TOOL_CONTRACTS.items()))
    assert resolution.participant_driver is ParticipantDriverType.HUMAN


def test_resolution_is_deterministic_and_keeps_arm_inputs_out_of_the_sandbox(
    repository: InMemoryDefinitionRepository,
) -> None:
    scenario_ref, agent_ref = build_experiment_graph(repository)
    first = resolve(repository, scenario_ref, agent_ref, agent_ref)
    second = resolve(repository, scenario_ref, agent_ref, agent_ref)
    assert first == second
    assert len(first.arms) == 2
    sandbox_types = {entry.definition.definition_type for entry in first.sandbox_inputs}
    assert not sandbox_types & {
        DefinitionType.AGENT_CONFIGURATION,
        DefinitionType.SUPPORT_IDENTITY,
    }


def test_resolution_pins_exact_versions_not_latest(
    repository: InMemoryDefinitionRepository,
) -> None:
    scenario_ref, agent_ref = build_experiment_graph(repository)
    before = resolve(repository, scenario_ref, agent_ref)

    ticket_entry = next(
        entry
        for entry in before.sandbox_inputs
        if entry.definition.definition_type is DefinitionType.TICKET
    )
    publish_definition(
        repository,
        ticket_entry.definition,
        content_fingerprint="d" * 64,
        clock=FixedClock(),
    )

    after = resolve(repository, scenario_ref, agent_ref)
    assert after == before


def test_resolution_rejects_unresolvable_versions(
    repository: InMemoryDefinitionRepository,
) -> None:
    scenario_ref, agent_ref = build_experiment_graph(repository)
    missing_scenario = VersionRef(definition=scenario_ref.definition, version=99)
    with pytest.raises(MissingReferenceVersionError, match="not resolvable"):
        resolve(repository, missing_scenario, agent_ref)


def test_resolution_rejects_conflicting_pinned_versions(
    repository: InMemoryDefinitionRepository,
) -> None:
    shop = definition_id(DefinitionType.SHOP)
    profile = definition_id(DefinitionType.CUSTOMER_PROFILE)
    ticket = definition_id(DefinitionType.TICKET)
    scenario = definition_id(DefinitionType.SCENARIO)
    identity = definition_id(DefinitionType.SUPPORT_IDENTITY)
    agent = definition_id(DefinitionType.AGENT_CONFIGURATION)

    draft_and_publish(repository, shop)
    draft_and_publish(repository, profile)
    draft_and_publish(repository, ticket, shop=shop, references=(profile,))
    # The shop republishes, so the scenario pins shop v2 while its ticket pinned shop v1.
    publish_definition(repository, shop, content_fingerprint=FINGERPRINT, clock=FixedClock())
    scenario_version = draft_and_publish(repository, scenario, shop=shop, references=(ticket,))
    draft_and_publish(repository, identity)
    agent_version = draft_and_publish(repository, agent, references=(identity,))

    with pytest.raises(ConflictingReferenceVersionsError, match="pinned at both"):
        resolve(repository, scenario_version.ref, agent_version.ref)


def test_publishing_surfaces_a_repository_missing_the_version_it_reported() -> None:
    class InconsistentRepository(InMemoryDefinitionRepository):
        def get_published(self, ref: VersionRef) -> PublishedDefinitionVersion | None:
            return None

    inconsistent = InconsistentRepository()
    shop = definition_id(DefinitionType.SHOP)
    draft_and_publish(inconsistent, shop)
    ticket = definition_id(DefinitionType.TICKET)
    inconsistent.save_draft(
        DefinitionDraft(
            definition=ticket,
            shop=shop,
            references=(definition_id(DefinitionType.CUSTOMER_PROFILE),),
        )
    )
    with pytest.raises(MissingReferenceVersionError, match="not resolvable"):
        publish_definition(
            inconsistent, ticket, content_fingerprint=FINGERPRINT, clock=FixedClock()
        )


def test_resolution_validates_roots_arms_seed_and_tool_contracts(
    repository: InMemoryDefinitionRepository,
) -> None:
    scenario_ref, agent_ref = build_experiment_graph(repository)

    with pytest.raises(DefinitionResolutionError, match="must reference a scenario"):
        resolve(repository, agent_ref, agent_ref)
    with pytest.raises(DefinitionResolutionError, match="must reference a agent_configuration"):
        resolve(repository, scenario_ref, scenario_ref)
    with pytest.raises(DefinitionResolutionError, match="one or two agent configurations"):
        resolve(repository, scenario_ref)
    with pytest.raises(DefinitionResolutionError, match="one or two agent configurations"):
        resolve(repository, scenario_ref, agent_ref, agent_ref, agent_ref)
    with pytest.raises(DefinitionResolutionError, match="seed must be an integer"):
        resolve_experiment_inputs(
            repository,
            scenario=scenario_ref,
            agent_configurations=(agent_ref,),
            seed=-1,
            tool_contract_versions=TOOL_CONTRACTS,
            participant_driver=ParticipantDriverType.HUMAN,
        )
    with pytest.raises(DefinitionResolutionError, match="non-empty"):
        resolve_experiment_inputs(
            repository,
            scenario=scenario_ref,
            agent_configurations=(agent_ref,),
            seed=1234,
            tool_contract_versions={"commerce.read_order": " "},
            participant_driver=ParticipantDriverType.HUMAN,
        )
