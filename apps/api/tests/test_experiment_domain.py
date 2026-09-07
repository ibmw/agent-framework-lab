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
    MAX_NOTE_LENGTH,
    MAX_PARTICIPANT_TURN_LENGTH,
    MAX_TAGS,
    ArmAwaiting,
    ComparisonDimension,
    ExperimentConfigurationError,
    ExperimentNote,
    ParticipantDriverType,
    ParticipantTurn,
    ParticipantTurnSource,
    compare_configurations,
    derivation_variables,
    fold_tag,
    fold_tags,
    normalize_tag,
    replay_script,
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


CAP = 12
"""A cap far beyond the turns these threads reach, so only the tests about the cap meet it."""


def opened() -> ParticipantTurn:
    return turn(ordinal=0, source=ParticipantTurnSource.TRIGGER, driver=None)


def test_an_arm_that_has_only_been_opened_waits_for_its_agent() -> None:
    standing = stand_arm((opened(),), (), max_turns=CAP)

    assert standing.awaiting is ArmAwaiting.AGENT
    assert standing.ordinal == 0
    assert standing.attempts == 0
    assert standing.unanswered == ()


def test_an_answered_arm_waits_for_the_customer() -> None:
    standing = stand_arm((opened(),), (answered(0),), max_turns=CAP)

    assert standing.awaiting is ArmAwaiting.CUSTOMER
    assert standing.ordinal == 0


def test_a_failed_attempt_leaves_the_arm_waiting_for_its_agent_with_the_attempt_counted() -> None:
    """A retry is a thing an operator does, so the arm still owes an answer (ADR 0026)."""
    standing = stand_arm((opened(),), (failed(0), failed(0, attempt=2)), max_turns=CAP)

    assert standing.awaiting is ArmAwaiting.AGENT
    assert standing.attempts == 2


def test_the_arm_stands_on_the_last_turn_it_received_not_the_first_it_never_answered() -> None:
    """The customer moved on, and the arm answers the conversation as it stands."""
    standing = stand_arm((opened(), turn(ordinal=1)), (), max_turns=CAP)

    assert standing.ordinal == 1
    assert standing.attempts == 0
    assert standing.unanswered == (0,)


def test_a_turn_the_arm_passed_over_stays_counted_after_the_next_one_is_answered() -> None:
    standing = stand_arm((opened(), turn(ordinal=1)), (answered(1),), max_turns=CAP)

    assert standing.awaiting is ArmAwaiting.CUSTOMER
    assert standing.unanswered == (0,)


def test_an_attempt_at_an_older_turn_is_not_an_attempt_at_this_one() -> None:
    standing = stand_arm((opened(), turn(ordinal=1)), (failed(0),), max_turns=CAP)

    assert standing.ordinal == 1
    assert standing.attempts == 0
    assert standing.unanswered == (0,)


def test_an_arm_that_answered_its_last_allowed_turn_is_completed() -> None:
    """The cap is the half of a scenario's completion conditions a runtime can count."""
    standing = stand_arm((opened(), turn(ordinal=1)), (answered(1),), max_turns=1)

    assert standing.awaiting is ArmAwaiting.COMPLETED
    assert standing.ordinal == 1


def test_an_arm_at_its_cap_that_owes_a_reply_still_waits_for_its_agent() -> None:
    """Running out of turns does not excuse the last one: the arm still has to answer it."""
    standing = stand_arm((opened(), turn(ordinal=1)), (failed(1),), max_turns=1)

    assert standing.awaiting is ArmAwaiting.AGENT
    assert standing.attempts == 1


def test_the_trigger_is_turn_zero_so_a_one_turn_cap_still_allows_one_driven_turn() -> None:
    standing = stand_arm((opened(),), (answered(0),), max_turns=1)

    assert standing.awaiting is ArmAwaiting.CUSTOMER


def test_an_arm_that_was_never_opened_has_no_standing() -> None:
    with pytest.raises(ExperimentConfigurationError, match="no customer turn"):
        stand_arm((), (), max_turns=CAP)


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


# -- what a derivation moved from the run it came from -------------------------


def test_a_derivation_that_moved_one_arm_one_way_moved_one_dimension() -> None:
    identity_id = uuid4()
    before = publishable_configuration(identity_id)
    after = publishable_configuration(identity_id, prompt="Read the policy before acting.")

    assert derivation_variables(((before, after),)) == (ComparisonDimension.PROMPT,)


def test_two_arms_moved_the_same_way_are_one_variable() -> None:
    """Both arms onto the same new prompt asks one question, so it counts as one."""
    identity_id = uuid4()
    before = publishable_configuration(identity_id)
    after = publishable_configuration(identity_id, prompt="Read the policy before acting.")

    assert derivation_variables(((before, after), (before, after))) == (ComparisonDimension.PROMPT,)


def test_two_arms_moved_different_ways_are_two_variables_in_the_enums_own_order() -> None:
    """The count is what makes the attribution claim checkable, whichever arm each landed on.

    Reported in the dimension enum's order rather than in the order the arms moved, so two
    derivations that changed the same things read the same way."""
    identity_id = uuid4()
    before = publishable_configuration(identity_id)
    prompted = publishable_configuration(identity_id, prompt="Read the policy before acting.")
    warmer = publishable_configuration(
        identity_id, model=replace(before.model, temperature=Decimal("0.90"))
    )

    assert derivation_variables(((prompted, before), (before, warmer))) == (
        ComparisonDimension.MODEL,
        ComparisonDimension.PROMPT,
    )


def test_a_derivation_that_moved_no_arm_moved_no_dimension() -> None:
    """What a replay's own reading answers, without a payload having to be resolved for it."""
    assert derivation_variables(()) == ()


def test_an_arm_repinned_to_content_that_compares_equal_moved_nothing() -> None:
    """A different published version is still a fork; it just did not move a dimension.

    The kind is recorded rather than inferred from this reading for exactly that reason."""
    identity_id = uuid4()
    payload = publishable_configuration(identity_id)

    assert derivation_variables(((payload, payload),)) == ()


# -- what an operator writes on a run ------------------------------------------


def test_a_note_carries_words_and_an_identity() -> None:
    note = ExperimentNote(note_id=uuid4(), body="Beacon acts before reading the policy.")

    assert note.body == "Beacon acts before reading the policy."


@pytest.mark.parametrize("body", ["", "   ", " padded "])
def test_a_note_with_nothing_in_it_is_not_a_note(body: str) -> None:
    with pytest.raises(ExperimentConfigurationError, match="note body"):
        ExperimentNote(note_id=uuid4(), body=body)


def test_a_note_is_a_paragraph_rather_than_a_report() -> None:
    with pytest.raises(ExperimentConfigurationError, match=f"at most {MAX_NOTE_LENGTH}"):
        ExperimentNote(note_id=uuid4(), body="x" * (MAX_NOTE_LENGTH + 1))


@pytest.mark.parametrize(
    "typed",
    [
        "read-check-gap",
        "Read check gap",
        "  READ_CHECK_GAP  ",
        "read   check\tgap",
        # A hyphen is a separator as well as the one this fold writes, so somebody who spelled
        # the shelf with spaces around it, or doubled one, spelled the shelf they meant.
        "read - check - gap",
        "read -check -gap",
        "read--check--gap",
        "read_check-gap",
    ],
)
def test_every_spelling_of_one_shelf_folds_to_the_same_tag(typed: str) -> None:
    """A tag is what history narrows by, so two spellings cannot be two filter options."""
    assert fold_tag(typed) == "read-check-gap"


def test_folding_a_folded_tag_changes_nothing() -> None:
    """The stored form is what the next fold is applied to, so it has to be a fixed point."""
    once = fold_tag("Read check gap")

    assert fold_tag(once) == once


@pytest.mark.parametrize("typed", ["écoles", "read/check", "-leading", "trailing-", "", "  "])
def test_a_tag_the_fold_cannot_make_a_slug_of_is_refused(typed: str) -> None:
    """Refused rather than mangled: a key nobody would guess is worse than no key.

    A leading or trailing separator survives the fold as a leading or trailing hyphen, which
    is not a slug — so widening the separator class did not quietly start accepting them."""
    with pytest.raises(ExperimentConfigurationError):
        fold_tag(typed)


@pytest.mark.parametrize("typed", ["Read check gap", "écoles", "-leading", ""])
def test_the_filter_half_of_the_fold_normalizes_without_ever_refusing(typed: str) -> None:
    """A query is not authoring: a link nothing matches must narrow to nothing, not 422.

    It is the same normalization a write folds through, which is what makes a hand-typed
    `tag=Read check gap` find the run the dropdown would have found."""
    assert normalize_tag(typed) == normalize_tag(typed).strip()
    assert normalize_tag("Read check gap") == "read-check-gap"


def test_a_tag_set_is_a_set_in_one_order() -> None:
    assert fold_tags(["two-arm", "Read check gap", "two_arm"]) == ("read-check-gap", "two-arm")


def test_a_run_can_be_filed_on_only_so_many_shelves() -> None:
    with pytest.raises(ExperimentConfigurationError, match=f"at most {MAX_TAGS}"):
        fold_tags([f"tag-{index}" for index in range(MAX_TAGS + 1)])


def test_a_string_is_not_a_tag_set() -> None:
    """A caller handing one word over would otherwise be filed under every letter of it."""
    with pytest.raises(ExperimentConfigurationError, match="list of text"):
        fold_tags("read-check-gap")


# -- the script a replay reads out of a run ------------------------------------


def trigger(**overrides: object) -> ParticipantTurn:
    fields: dict[str, object] = {
        "ordinal": 0,
        "source": ParticipantTurnSource.TRIGGER,
        "driver": None,
        "body": "My order is going to the wrong address.",
    }
    fields.update(overrides)
    return turn(**fields)


def test_a_script_carries_the_compositions_a_run_recorded_and_not_its_trigger() -> None:
    """The trigger is written from the ticket a snapshot pinned, so a script never copies it."""
    linked = uuid4()

    script = replay_script(
        ((trigger(), turn(turn_id=linked, ordinal=1, body="Any update?")),),
        ((answered(0), answered(1)),),
    )

    assert script.opening == (1,)
    assert [
        [(line.position, line.body, line.attempts) for line in composition.lines]
        for composition in script.compositions
    ] == [[(0, "Any update?", 1)]]


def test_one_composition_that_reached_both_arms_stays_one_composition() -> None:
    """The divergence record (ADR 0025): a linked send must be replayed as a linked send."""
    linked = uuid4()

    script = replay_script(
        (
            (trigger(), turn(turn_id=linked, ordinal=1, body="Any update?")),
            (trigger(), turn(turn_id=linked, ordinal=1, body="Any update?")),
        ),
        ((answered(0),), (answered(0),)),
    )

    assert len(script.compositions) == 1
    assert [line.position for line in script.compositions[0].lines] == [0, 1]


def test_a_composition_only_one_arm_received_reaches_only_that_arm() -> None:
    script = replay_script(
        (
            (trigger(), turn(ordinal=1, body="Any update?")),
            (trigger(),),
        ),
        ((answered(0),), ()),
    )

    assert [line.position for line in script.compositions[0].lines] == [0]
    assert script.opening == (1, 0)


def test_a_composition_carries_what_each_arm_actually_received() -> None:
    """A driver answers one arm at a time, so two arms of one send may hold two sentences."""
    linked = uuid4()

    script = replay_script(
        (
            (trigger(), turn(turn_id=linked, ordinal=1, body="Any update?")),
            (trigger(), turn(turn_id=linked, ordinal=1, body="Still nothing?")),
        ),
        ((), ()),
    )

    assert [line.body for line in script.compositions[0].lines] == ["Any update?", "Still nothing?"]


def test_a_turn_the_operator_never_ran_the_agent_on_is_scripted_with_no_advance() -> None:
    """A skipped turn is part of the record (ADR 0029), so a replay reproduces the skip."""
    script = replay_script(
        ((trigger(), turn(ordinal=1), turn(ordinal=2)),),
        ((answered(2),),),
    )

    assert [line.attempts for composition in script.compositions for line in composition.lines] == [
        0,
        1,
    ]


def test_a_failed_attempt_and_its_retry_are_two_advances() -> None:
    script = replay_script(
        ((trigger(), turn(ordinal=1)),),
        ((failed(0), answered(0, attempt=2), failed(1), answered(1, attempt=2)),),
    )

    assert script.opening == (2,)
    assert script.compositions[0].lines[0].attempts == 2


def test_compositions_are_ordered_so_every_arm_stands_where_it_recorded() -> None:
    """Ordinals are per arm, so the order between two arms' sends is reconstructed here."""
    first = uuid4()
    second = uuid4()
    linked = uuid4()

    script = replay_script(
        (
            (trigger(), turn(turn_id=first, ordinal=1), turn(turn_id=linked, ordinal=2)),
            (trigger(), turn(turn_id=second, ordinal=1), turn(turn_id=linked, ordinal=2)),
        ),
        ((), ()),
    )

    assert [
        [line.position for line in composition.lines] for composition in script.compositions
    ] == [[0], [1], [0, 1]]


def test_a_thread_with_a_hole_in_it_cannot_be_replayed() -> None:
    """A gap is a corrupted stream rather than something a derived run should paper over."""
    with pytest.raises(ExperimentConfigurationError, match="any order"):
        replay_script(((trigger(), turn(ordinal=2)),), ((),))


def test_an_arm_that_was_never_opened_has_no_script() -> None:
    with pytest.raises(ExperimentConfigurationError, match="no script"):
        replay_script(((),), ((),))


def test_a_script_reads_one_attempt_stream_per_arm() -> None:
    with pytest.raises(ExperimentConfigurationError, match="one attempt stream per arm"):
        replay_script(((trigger(),), (trigger(),)), ((),))


def test_an_experiment_with_no_arm_has_nothing_to_replay() -> None:
    with pytest.raises(ExperimentConfigurationError, match="nothing to replay"):
        replay_script((), ())
