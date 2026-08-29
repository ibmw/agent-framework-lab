"""Domain rules an experiment's turns and comparison cannot be built without."""

from dataclasses import replace
from decimal import Decimal
from uuid import uuid4

import pytest

from agent_factories import publishable_configuration
from capability_lab.domain.agent_configuration import (
    ToneOfVoiceSelection,
    ToneOfVoiceSource,
)
from capability_lab.domain.experiment import (
    MAX_PARTICIPANT_TURN_LENGTH,
    ComparisonDimension,
    ExperimentConfigurationError,
    ParticipantDriverType,
    ParticipantTurn,
    ParticipantTurnSource,
    compare_configurations,
)


def turn(**overrides: object) -> ParticipantTurn:
    fields: dict[str, object] = {
        "turn_id": uuid4(),
        "ordinal": 1,
        "source": ParticipantTurnSource.PARTICIPANT,
        "driver": ParticipantDriverType.HUMAN,
        "body": "It still says the old address.",
    }
    fields.update(overrides)
    return ParticipantTurn(**fields)  # type: ignore[arg-type]


def test_the_trigger_opens_a_run_and_names_no_driver() -> None:
    opening = turn(ordinal=0, source=ParticipantTurnSource.TRIGGER, driver=None)

    assert opening.ordinal == 0
    assert opening.driver is None


def test_the_trigger_cannot_arrive_after_the_run_has_opened() -> None:
    with pytest.raises(ExperimentConfigurationError, match="first turn"):
        turn(ordinal=1, source=ParticipantTurnSource.TRIGGER, driver=None)


def test_the_trigger_cannot_claim_a_driver_produced_it() -> None:
    with pytest.raises(ExperimentConfigurationError, match="authored by the scenario"):
        turn(ordinal=0, source=ParticipantTurnSource.TRIGGER)


def test_a_run_does_not_open_with_a_driven_turn() -> None:
    with pytest.raises(ExperimentConfigurationError, match="triggering message"):
        turn(ordinal=0)


def test_a_driven_turn_names_the_driver_that_produced_it() -> None:
    with pytest.raises(ExperimentConfigurationError, match="participant driver"):
        turn(driver=None)


def test_a_turn_carries_words() -> None:
    with pytest.raises(ExperimentConfigurationError):
        turn(body="   ")


def test_a_turn_is_bounded_like_the_thread_it_joins() -> None:
    with pytest.raises(ExperimentConfigurationError, match="at most"):
        turn(body="a" * (MAX_PARTICIPANT_TURN_LENGTH + 1))


def test_two_identical_configurations_differ_nowhere() -> None:
    identity_id = uuid4()
    payload = publishable_configuration(identity_id)

    comparison = compare_configurations((payload, payload))

    assert [variable.dimension for variable in comparison] == list(ComparisonDimension)
    assert [variable for variable in comparison if variable.differs] == []


def test_one_arm_is_reported_dimension_by_dimension_and_differs_nowhere() -> None:
    comparison = compare_configurations((publishable_configuration(uuid4()),))

    assert len(comparison) == len(ComparisonDimension)
    assert all(len(variable.values) == 1 and not variable.differs for variable in comparison)


def test_a_changed_framework_is_the_only_dimension_that_differs() -> None:
    identity_id = uuid4()
    left = publishable_configuration(identity_id)
    right = publishable_configuration(identity_id, framework_id="fake")

    differing = [
        variable.dimension for variable in compare_configurations((left, right)) if variable.differs
    ]

    assert differing == [ComparisonDimension.FRAMEWORK]


def test_the_runtime_settings_are_part_of_the_model_arms_are_compared_on() -> None:
    """Two arms on one model at two temperatures are not running the same model."""
    identity_id = uuid4()
    left = publishable_configuration(identity_id)
    right = publishable_configuration(
        identity_id, model=replace(left.model, temperature=Decimal("0.90"))
    )

    differing = [
        variable.dimension for variable in compare_configurations((left, right)) if variable.differs
    ]

    assert differing == [ComparisonDimension.MODEL]


def test_the_tool_set_is_compared_as_a_set_not_as_an_authoring_order() -> None:
    identity_id = uuid4()
    left = publishable_configuration(
        identity_id, tools=("catalog.read_product", "orders.read_order")
    )
    right = publishable_configuration(
        identity_id, tools=("orders.read_order", "catalog.read_product")
    )

    assert [
        variable for variable in compare_configurations((left, right)) if variable.differs
    ] == []


def test_the_tone_selection_is_compared_by_what_it_names() -> None:
    identity_id = uuid4()
    left = publishable_configuration(identity_id)
    right = publishable_configuration(
        identity_id,
        tone_of_voice=ToneOfVoiceSelection(
            source=ToneOfVoiceSource.OVERRIDE, guideline_id="apologetic"
        ),
    )

    differing = [
        variable.dimension for variable in compare_configurations((left, right)) if variable.differs
    ]

    assert differing == [ComparisonDimension.TONE_OF_VOICE]


def test_a_comparison_needs_something_to_compare() -> None:
    with pytest.raises(ExperimentConfigurationError, match="at least one"):
        compare_configurations(())
