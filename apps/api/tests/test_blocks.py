"""Block-library services and storage: the lab-unique name, versions, and the publish gate."""

from collections.abc import Generator
from dataclasses import dataclass, replace
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import uuid4

import pytest
from sqlalchemy.orm import Session

from block_factories import (
    parameter,
    publishable_mutation,
    publishable_objective,
    severity_parameter,
)
from capability_lab.application.blocks import (
    BlockNameExistsError,
    MutationBlockNotFoundError,
    MutationBlockNotPublishableError,
    MutationBlockService,
    ObjectiveBlockNotFoundError,
    ObjectiveBlockNotPublishableError,
    ObjectiveBlockService,
    ObjectiveBlockVersionNotFoundError,
    ObjectiveBlockVersionRecord,
)
from capability_lab.application.definition_resolution import PublishedVersionExistsError
from capability_lab.domain.blocks import BlockParameterKind, ObjectiveEvidence
from capability_lab.domain.definitions import DefinitionType
from capability_lab.infrastructure.database import (
    Base,
    create_database_engine,
    create_session_factory,
    session_scope,
)
from capability_lab.infrastructure.repositories import (
    mutation_block_repository,
    objective_block_repository,
)


@dataclass(slots=True)
class AdvancingClock:
    value: datetime = datetime(2026, 8, 25, 12, 0, tzinfo=UTC)

    def now(self) -> datetime:
        self.value += timedelta(seconds=1)
        return self.value


@pytest.fixture
def session(tmp_path: Path) -> Generator[Session, None, None]:
    engine = create_database_engine(f"sqlite:///{tmp_path / 'blocks.db'}")
    Base.metadata.create_all(engine)
    with session_scope(create_session_factory(engine)) as active:
        yield active


@pytest.fixture
def objectives(session: Session) -> ObjectiveBlockService:
    return ObjectiveBlockService(objective_block_repository(session), AdvancingClock())


@pytest.fixture
def mutations(session: Session) -> MutationBlockService:
    return MutationBlockService(mutation_block_repository(session), AdvancingClock())


def test_a_new_block_starts_as_one_incomplete_shop_independent_draft(
    objectives: ObjectiveBlockService,
) -> None:
    record = objectives.create_block("read-required-document")

    assert record.definition.definition_type is DefinitionType.OBJECTIVE_BLOCK
    assert record.payload.name == "read-required-document"
    assert record.payload.parameters == ()
    # A template belongs to no shop and references no other definition (ADR 0012).
    assert record.draft.shop is None
    assert record.draft.references == ()


def test_an_incomplete_block_saves_but_refuses_to_publish(
    objectives: ObjectiveBlockService,
) -> None:
    record = objectives.create_block("identify-entity")

    with pytest.raises(ObjectiveBlockNotPublishableError) as raised:
        objectives.publish(record.definition.id)

    assert {issue.code for issue in raised.value.validation.errors} == {
        "block_without_statement",
        "block_without_description",
    }


def test_a_mutation_without_a_timing_parameter_refuses_to_publish(
    mutations: MutationBlockService,
) -> None:
    record = mutations.create_block("clock-advance")
    block_id = record.definition.id
    mutations.replace_block(
        block_id,
        publishable_mutation(
            name="clock-advance",
            parameters=(parameter("entity_ref", kind=BlockParameterKind.ENTITY_REFERENCE),),
        ),
    )

    with pytest.raises(MutationBlockNotPublishableError) as raised:
        mutations.publish(block_id)

    assert "mutation_without_timing" in {issue.code for issue in raised.value.validation.errors}


def test_a_block_name_is_unique_across_the_library(objectives: ObjectiveBlockService) -> None:
    """A scenario binds a template by name, so two templates cannot share one."""
    objectives.create_block("read-required-document")

    with pytest.raises(BlockNameExistsError, match="read-required-document"):
        objectives.create_block("read-required-document")


def test_renaming_a_block_onto_a_taken_name_is_refused(
    objectives: ObjectiveBlockService,
) -> None:
    objectives.create_block("read-required-document")
    other = objectives.create_block("identify-entity")

    with pytest.raises(BlockNameExistsError):
        objectives.replace_block(
            other.definition.id, publishable_objective(name="read-required-document")
        )


def test_a_published_name_can_be_taken_again_once_the_draft_has_moved_on(
    objectives: ObjectiveBlockService,
) -> None:
    """The check scans live drafts, and that is the whole invariant.

    A scenario binds a `DefinitionId` and pins a `VersionRef`; the name never enters a
    binding. So two lineages that end up sharing one published name stay distinct, which is
    what makes renaming safe in the first place.
    """
    first = objectives.create_block("read-required-document")
    objectives.replace_block(first.definition.id, publishable_objective())
    objectives.publish(first.definition.id)
    objectives.replace_block(
        first.definition.id, publishable_objective(name="read-required-document-v2")
    )

    second = objectives.create_block("read-required-document")

    assert second.definition.id != first.definition.id
    frozen = objectives.get_version(first.definition.id, 1)
    assert frozen.payload.name == "read-required-document"
    assert objectives.get_draft(first.definition.id).payload.name == "read-required-document-v2"


def test_a_block_may_keep_its_own_name_while_its_content_changes(
    objectives: ObjectiveBlockService,
) -> None:
    record = objectives.create_block("read-required-document")

    saved = objectives.replace_block(record.definition.id, publishable_objective())

    assert saved.payload.name == "read-required-document"
    assert len(saved.payload.parameters) == 2


def test_the_two_libraries_are_separate_namespaces(
    objectives: ObjectiveBlockService, mutations: MutationBlockService
) -> None:
    """An objective and a mutation are different definition types, so one name serves both."""
    objectives.create_block("clock-advance")
    mutations.create_block("clock-advance")

    assert [summary.name for summary in objectives.list_blocks()] == ["clock-advance"]
    assert [summary.name for summary in mutations.list_blocks()] == ["clock-advance"]


def test_a_mutation_block_is_not_found_through_the_objective_library(
    objectives: ObjectiveBlockService, mutations: MutationBlockService
) -> None:
    record = mutations.create_block("tool-timeout")

    with pytest.raises(ObjectiveBlockNotFoundError):
        objectives.get_draft(record.definition.id)


def test_publishing_freezes_the_template_while_the_draft_moves_on(
    objectives: ObjectiveBlockService,
) -> None:
    record = objectives.create_block("read-required-document")
    block_id = record.definition.id
    objectives.replace_block(block_id, publishable_objective())
    published = objectives.publish(block_id)

    objectives.replace_block(
        block_id,
        publishable_objective(evidence=ObjectiveEvidence.STATE, parameters=(parameter(),)),
    )

    frozen = objectives.get_version(block_id, published.published.version)
    assert frozen.payload.evidence is ObjectiveEvidence.EVENT
    assert len(frozen.payload.parameters) == 2
    assert objectives.get_draft(block_id).payload.evidence is ObjectiveEvidence.STATE


def test_publishing_twice_produces_two_independent_versions(
    objectives: ObjectiveBlockService,
) -> None:
    record = objectives.create_block("read-required-document")
    block_id = record.definition.id
    objectives.replace_block(block_id, publishable_objective())
    first = objectives.publish(block_id)

    objectives.replace_block(
        block_id, publishable_objective(parameters=(parameter(), severity_parameter()))
    )
    objectives.replace_block(block_id, publishable_objective(statement="Read the bound document"))
    second = objectives.publish(block_id)

    assert (first.published.version, second.published.version) == (1, 2)
    assert first.published.content_fingerprint != second.published.content_fingerprint
    assert [published.version for published in objectives.list_versions(block_id)] == [2, 1]


def test_a_published_version_pins_no_shop_and_no_reference(
    mutations: MutationBlockService,
) -> None:
    """Blocks are cross-shop, so a version has nothing to pin but its own content."""
    record = mutations.create_block("concurrent-entity-mutation")
    block_id = record.definition.id
    mutations.replace_block(block_id, publishable_mutation())

    published = mutations.publish(block_id).published

    assert published.shop is None
    assert published.shop_version is None
    assert published.references == ()


def test_the_storage_boundary_refuses_to_overwrite_a_published_version(tmp_path: Path) -> None:
    """ADR 0012 makes a published version immutable forever, including against its own type."""
    engine = create_database_engine(f"sqlite:///{tmp_path / 'overwrite.db'}")
    Base.metadata.create_all(engine)
    factory = create_session_factory(engine)
    with session_scope(factory) as writing:
        service = ObjectiveBlockService(objective_block_repository(writing), AdvancingClock())
        record = service.create_block("read-required-document")
        block_id = record.definition.id
        service.replace_block(block_id, publishable_objective())
        published = service.publish(block_id)

    with pytest.raises(PublishedVersionExistsError), session_scope(factory) as overwriting:
        objective_block_repository(overwriting).save_version(
            ObjectiveBlockVersionRecord(
                published=published.published,
                payload=publishable_objective(statement="Something else entirely"),
            )
        )


def test_an_unknown_block_and_an_unknown_version_answer_their_own_errors(
    objectives: ObjectiveBlockService, mutations: MutationBlockService
) -> None:
    with pytest.raises(ObjectiveBlockNotFoundError):
        objectives.get_draft(uuid4())
    with pytest.raises(MutationBlockNotFoundError):
        mutations.get_draft(uuid4())

    record = objectives.create_block("read-required-document")
    with pytest.raises(ObjectiveBlockVersionNotFoundError):
        objectives.get_version(record.definition.id, 1)


def test_the_preview_reports_the_gate_before_a_publish_can_refuse_it(
    mutations: MutationBlockService,
) -> None:
    record = mutations.create_block("payment-service-outage")
    block_id = record.definition.id
    mutations.replace_block(block_id, publishable_mutation(name="payment-service-outage"))

    preview = mutations.preview_draft(block_id)

    assert preview.validation.publishable
    assert preview.latest_published_version is None
    assert preview.next_version == 1
    assert not preview.matches_latest_published


def test_the_preview_reports_a_draft_identical_to_the_latest_version(
    objectives: ObjectiveBlockService,
) -> None:
    record = objectives.create_block("read-required-document")
    block_id = record.definition.id
    objectives.replace_block(block_id, publishable_objective())
    objectives.publish(block_id)

    preview = objectives.preview_draft(block_id)

    assert preview.matches_latest_published
    assert preview.changes == ()


def test_the_index_row_counts_the_bindings_a_scenario_will_have_to_resolve(
    objectives: ObjectiveBlockService,
) -> None:
    record = objectives.create_block("read-required-document")
    objectives.replace_block(record.definition.id, publishable_objective())

    (summary,) = objectives.list_blocks()

    assert summary.name == "read-required-document"
    assert summary.statement == "Read document"
    assert summary.type_label == "deterministic · event"
    assert summary.parameter_count == 2
    # Only `doc_ref` points at a shop object; `severity` is a literal.
    assert summary.shop_bound_parameter_count == 1
    assert summary.latest_published_version is None
    assert summary.published_version_count == 0


def test_a_mutation_index_row_carries_its_own_type_axis(
    mutations: MutationBlockService,
) -> None:
    record = mutations.create_block("concurrent-entity-mutation")
    mutations.replace_block(record.definition.id, publishable_mutation())

    (summary,) = mutations.list_blocks()

    assert summary.type_label == "entity_mutation"
    assert summary.shop_bound_parameter_count == 1


def test_the_index_carries_published_provenance_after_a_publication(
    objectives: ObjectiveBlockService,
) -> None:
    record = objectives.create_block("read-required-document")
    block_id = record.definition.id
    objectives.replace_block(block_id, publishable_objective())
    objectives.publish(block_id)
    objectives.replace_block(block_id, publishable_objective(statement="Read the document"))
    objectives.publish(block_id)

    (summary,) = objectives.list_blocks()

    assert summary.latest_published_version == 2
    assert summary.published_version_count == 2


def test_a_stored_draft_survives_a_round_trip_through_the_repository(
    session: Session, objectives: ObjectiveBlockService
) -> None:
    record = objectives.create_block("read-required-document")
    block_id = record.definition.id
    saved = objectives.replace_block(
        block_id, replace(publishable_objective(), description="Reloaded from storage.")
    )
    session.expunge_all()

    assert objectives.get_draft(block_id).payload == saved.payload
