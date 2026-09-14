"""Judge authoring: the gate that reaches outside the payload, and what a publish freezes."""

from collections.abc import Generator
from dataclasses import replace
from pathlib import Path
from uuid import UUID, uuid4

import pytest
from sqlalchemy.orm import Session

from capability_lab.application.judge_capabilities import (
    PROVEN_JUDGES,
    PROVEN_JUDGES_BY_PROVIDER,
    reserved_rubric_terms,
)
from capability_lab.application.judge_configurations import (
    JudgeConfigurationNotFoundError,
    JudgeConfigurationNotPublishableError,
    JudgeConfigurationService,
)
from capability_lab.domain.definitions import DefinitionType
from capability_lab.domain.judge import JudgeEvidenceScope, JudgeModel
from capability_lab.infrastructure.database import (
    Base,
    create_database_engine,
    create_session_factory,
    session_scope,
)
from capability_lab.infrastructure.repositories import judge_configuration_repository
from judge_factories import control_model, publishable_judge
from workspace_factories import AdvancingClock


@pytest.fixture
def session(tmp_path: Path) -> Generator[Session, None, None]:
    engine = create_database_engine(f"sqlite:///{tmp_path / 'judges.db'}")
    Base.metadata.create_all(engine)
    with session_scope(create_session_factory(engine)) as active:
        yield active


@pytest.fixture
def judges(session: Session) -> JudgeConfigurationService:
    return JudgeConfigurationService(judge_configuration_repository(session), AdvancingClock())


def authored(judges: JudgeConfigurationService, **overrides: object) -> UUID:
    created = judges.create_judge("Resolution quality")
    judges.replace_judge(created.definition.id, publishable_judge(**overrides))
    return created.definition.id


def codes(judges: JudgeConfigurationService, judge_id: UUID) -> set[str]:
    return {issue.code for issue in judges.preview_draft(judge_id).validation.issues}


def test_a_new_judge_starts_with_a_proven_model_and_no_rubric(
    judges: JudgeConfigurationService,
) -> None:
    """The rubric is what an author writes; everything else has an answer the lab proved."""
    created = judges.create_judge("Resolution quality")

    assert created.payload.rubric == ""
    assert created.payload.model.provider in PROVEN_JUDGES_BY_PROVIDER
    assert created.payload.evidence
    assert "rubric_empty" in codes(judges, created.definition.id)


def test_a_judge_the_lab_cannot_run_is_refused(judges: JudgeConfigurationService) -> None:
    judge_id = authored(
        judges,
        model=JudgeModel(provider="acme", model_id="oracle"),
    )

    assert "judge_provider_not_proven" in codes(judges, judge_id)


def test_a_model_the_lab_does_not_exercise_is_a_warning_rather_than_a_refusal(
    judges: JudgeConfigurationService,
) -> None:
    judge_id = authored(
        judges,
        model=replace(control_model(), model_id="something-else"),
    )
    validation = judges.preview_draft(judge_id).validation

    assert validation.publishable
    assert "judge_model_not_exercised" in {issue.code for issue in validation.issues}


def test_the_two_judge_gate_messages_are_the_exact_words_the_studio_repeats(
    judges: JudgeConfigurationService,
) -> None:
    """The judge half of the pin `test_agent_capabilities.py` explains.

    The provider sentence is deliberately not the agent gate's: a judge names no framework, so
    the Studio keeps two functions rather than one with an empty subject.
    """
    unproven = judges.preview_draft(
        authored(judges, model=JudgeModel(provider="acme", model_id="oracle"))
    ).validation
    unexercised = judges.preview_draft(
        authored(judges, model=replace(control_model(), model_id="something-else"))
    ).validation

    provider = next(issue for issue in unproven.issues if issue.code == "judge_provider_not_proven")
    model = next(issue for issue in unexercised.issues if issue.code == "judge_model_not_exercised")

    assert provider.message == "acme is not a provider the lab has proven it can judge with"
    assert model.message == (
        "something-else is not a model the lab exercises; "
        "Deterministic control is proven on deterministic"
    )


def test_a_rubric_that_names_what_an_arm_runs_is_refused(
    judges: JudgeConfigurationService,
) -> None:
    """The brief is anonymized; a rubric naming a framework would undo that in one sentence."""
    judge_id = authored(
        judges,
        rubric="Prefer the pydantic-ai arm when the two disagree.",
    )

    assert "rubric_names_an_arm" in codes(judges, judge_id)


def test_the_reserved_terms_are_read_off_what_the_lab_actually_runs() -> None:
    """A second framework joins this list the day it is proven, without an edit here."""
    terms = {term.casefold() for term in reserved_rubric_terms()}

    assert "pydantic-ai" in terms
    assert "gpt-5-mini" in terms
    assert terms


def test_a_reserved_term_inside_a_longer_word_is_not_a_finding(
    judges: JudgeConfigurationService,
) -> None:
    judge_id = authored(judges, rubric="Refuse any faked tracking number the arm invents.")

    assert "rubric_names_an_arm" not in codes(judges, judge_id)


def test_a_judge_cannot_be_published_while_the_gate_refuses_it(
    judges: JudgeConfigurationService,
) -> None:
    judge_id = authored(judges, rubric="")

    with pytest.raises(JudgeConfigurationNotPublishableError):
        judges.publish(judge_id)


def test_a_published_judge_stays_frozen_while_its_draft_moves_on(
    judges: JudgeConfigurationService,
) -> None:
    judge_id = authored(judges)
    published = judges.publish(judge_id)

    judges.replace_judge(judge_id, publishable_judge(rubric="Score whether the arm was brief."))

    frozen = judges.get_version(judge_id, published.published.version)
    assert frozen.payload.rubric == published.payload.rubric
    assert judges.get_draft(judge_id).payload.rubric == "Score whether the arm was brief."


def test_a_judge_pins_nothing_because_it_names_no_definition(
    judges: JudgeConfigurationService,
) -> None:
    published = judges.publish(authored(judges))

    assert published.published.definition.definition_type is DefinitionType.JUDGE_CONFIGURATION
    assert published.published.references == ()


def test_a_judge_that_does_not_exist_is_named_as_missing(
    judges: JudgeConfigurationService,
) -> None:
    with pytest.raises(JudgeConfigurationNotFoundError):
        judges.get_draft(uuid4())


def test_the_index_reports_each_judge_and_its_published_provenance(
    judges: JudgeConfigurationService,
) -> None:
    judge_id = authored(judges)
    judges.publish(judge_id)

    (summary,) = judges.list_judges()

    assert summary.judge_id == judge_id
    assert summary.latest_published_version == 1
    assert summary.provider_label == PROVEN_JUDGES_BY_PROVIDER[summary.provider].label
    assert summary.evidence_count == 3


def test_the_resources_offer_only_what_the_gate_accepts(
    judges: JudgeConfigurationService,
) -> None:
    resources = judges.resources()

    assert resources.judges == PROVEN_JUDGES
    assert set(resources.evidence) == set(JudgeEvidenceScope)
    assert resources.reserved_terms == reserved_rubric_terms()
