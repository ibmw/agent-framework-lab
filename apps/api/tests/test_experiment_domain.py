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
from capability_lab.domain.agent_turn import AgentTurn, AgentTurnFailure, AgentTurnOutcome
from capability_lab.domain.experiment import (
    MAX_PARTICIPANT_TURN_LENGTH,
    ArmAwaiting,
    ComparisonDimension,
    ExperimentConfigurationError,
    ParticipantDriverType,
    ParticipantTurn,
    ParticipantTurnSource,
    compare_configurations,
    stand_arm,
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


def answered(ordinal: int, attempt: int = 1) -> AgentTurn:
    return AgentTurn(
        ordinal=ordinal,
        attempt=attempt,
        outcome=AgentTurnOutcome.ANSWERED,
        body="I can redirect that order.",
    )


def failed(ordinal: int, attempt: int = 1) -> AgentTurn:
    return AgentTurn(
        ordinal=ordinal,
        attempt=attempt,
        outcome=AgentTurnOutcome.FAILED,
        failure=AgentTurnFailure.MODEL_TRANSIENT,
    )


def opened() -> ParticipantTurn:
    return turn(ordinal=0, source=ParticipantTurnSource.TRIGGER, driver=None)


def test_an_arm_that_has_only_been_opened_waits_for_its_agent() -> None:
    standing = stand_arm((opened(),), ())

    assert standing.awaiting is ArmAwaiting.AGENT
    assert standing.ordinal == 0
    assert standing.attempts == 0
    assert standing.unanswered == ()


def test_an_answered_arm_waits_for_the_customer() -> None:
    standing = stand_arm((opened(),), (answered(0),))

    assert standing.awaiting is ArmAwaiting.CUSTOMER
    assert standing.ordinal == 0


def test_a_failed_attempt_leaves_the_arm_waiting_for_its_agent_with_the_attempt_counted() -> None:
    """A retry is a thing an operator does, so the arm still owes an answer (ADR 0026)."""
    standing = stand_arm((opened(),), (failed(0), failed(0, attempt=2)))

    assert standing.awaiting is ArmAwaiting.AGENT
    assert standing.attempts == 2


def test_the_arm_stands_on_the_last_turn_it_received_not_the_first_it_never_answered() -> None:
    """The customer moved on, and the arm answers the conversation as it stands."""
    standing = stand_arm((opened(), turn(ordinal=1)), ())

    assert standing.ordinal == 1
    assert standing.attempts == 0
    assert standing.unanswered == (0,)


def test_a_turn_the_arm_passed_over_stays_counted_after_the_next_one_is_answered() -> None:
    standing = stand_arm((opened(), turn(ordinal=1)), (answered(1),))

    assert standing.awaiting is ArmAwaiting.CUSTOMER
    assert standing.unanswered == (0,)


def test_an_attempt_at_an_older_turn_is_not_an_attempt_at_this_one() -> None:
    standing = stand_arm((opened(), turn(ordinal=1)), (failed(0),))

    assert standing.ordinal == 1
    assert standing.attempts == 0
    assert standing.unanswered == (0,)


def test_an_arm_that_was_never_opened_has_no_standing() -> None:
    with pytest.raises(ExperimentConfigurationError, match="no customer turn"):
        stand_arm((), ())


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
