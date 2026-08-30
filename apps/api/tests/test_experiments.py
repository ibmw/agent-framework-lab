"""Starting an experiment, reading it back, and driving its arms (ADR 0025)."""

from collections.abc import Generator
from dataclasses import replace
from pathlib import Path
from uuid import UUID, uuid4

import pytest
from sqlalchemy.orm import Session

from agent_factories import model_settings
from capability_lab.application.agent_capabilities import FAKE_FRAMEWORK_ID
from capability_lab.application.experiment_document import EXPERIMENT_CANONICAL_SCHEMA_VERSION
from capability_lab.application.experiments import (
    ArmSelection,
    ExperimentArmError,
    ExperimentDetail,
    ExperimentLabelError,
    ExperimentNotFoundError,
    ExperimentNotStartableError,
    ExperimentRunNotFoundError,
    ParticipantDriverMismatchError,
    StartExperiment,
)
from capability_lab.application.participants import (
    ParticipantRequest,
    ParticipantTurnUnavailableError,
)
from capability_lab.application.sandbox_materialization import SANDBOX_TOOL_CONTRACT_VERSIONS
from capability_lab.domain.agent_configuration import (
    ModelSettings,
    ToneOfVoiceSelection,
    ToneOfVoiceSource,
)
from capability_lab.domain.definitions import DefinitionType
from capability_lab.domain.experiment import (
    ComparisonDimension,
    ParticipantDriverType,
    ParticipantTurnSource,
)
from capability_lab.domain.order_fixture import FrozenShippingAddress, OrderFixturePayload
from capability_lab.domain.scenario import BoundMutation, ScenarioBinding
from capability_lab.infrastructure.database import (
    Base,
    create_database_engine,
    create_session_factory,
    session_scope,
)
from capability_lab.infrastructure.participants.human import HumanParticipantDriver
from workspace_factories import (
    SEED,
    Workspace,
    author,
    build_experiments,
    build_sandboxes,
    publish_prerequisites,
    published_configuration,
    published_identity,
    seed_workspace,
)


@pytest.fixture
def session(tmp_path: Path) -> Generator[Session, None, None]:
    engine = create_database_engine(f"sqlite:///{tmp_path / 'experiments.db'}")
    Base.metadata.create_all(engine)
    with session_scope(create_session_factory(engine)) as active:
        yield active


@pytest.fixture
def workspace(session: Session) -> Workspace:
    return seed_workspace(session)


def published_scenario(
    workspace: Workspace, mutations: tuple[BoundMutation, ...] = ()
) -> tuple[UUID, int]:
    """The wrong-address recipe, published and ready to be frozen."""
    publish_prerequisites(workspace)
    scenario_id = author(workspace, mutations=mutations)
    version = workspace.scenarios.publish_scenario(workspace.shop_id, scenario_id)
    return scenario_id, version.published.version


def unobservable_fault(workspace: Workspace) -> BoundMutation:
    """A fault bound to sandbox time, which no snapshot carries and no run can observe."""
    return BoundMutation(
        id="order-moves-under-the-arm",
        block_id=workspace.mutation_block_id,
        bindings=(
            ScenarioBinding(parameter="entity_ref", value=f"order:{workspace.order_id}"),
            ScenarioBinding(parameter="timing", value="at_offset:PT30M"),
        ),
    )


def command(
    workspace: Workspace,
    arms: tuple[ArmSelection, ...],
    mutations: tuple[BoundMutation, ...] = (),
    **overrides: object,
) -> StartExperiment:
    scenario_id, version = published_scenario(workspace, mutations)
    fields: dict[str, object] = {
        "label": "Framework comparison",
        "scenario_id": scenario_id,
        "scenario_version": version,
        "seed": SEED,
        "arms": arms,
    }
    fields.update(overrides)
    return StartExperiment(**fields)  # type: ignore[arg-type]


def fake_model() -> ModelSettings:
    """The only provider and model the deterministic adapter has been proven with."""
    return model_settings(provider="fake", model_id="deterministic")


def moved_to_lyon(order: OrderFixturePayload) -> OrderFixturePayload:
    """The change the wrong-address incident is about, applied inside one arm."""
    return replace(
        order,
        shipping_address=FrozenShippingAddress(
            source_address_id="lyon-current-flat",
            source_label="Lyon — current flat",
            selected_at="2026-08-22T09:15:00.000000Z",
            recipient="Maya Laurent",
            line1="12 rue de la République",
            postal_code="69002",
            city="Lyon",
            country="FR",
        ),
    )


def start_two_arms(session: Session, workspace: Workspace) -> ExperimentDetail:
    arms = (published_configuration(session), published_configuration(session))
    return build_experiments(session).start(workspace.shop_id, command(workspace, arms))


# -- starting ------------------------------------------------------------------


def test_starting_clones_one_arm_per_configuration_from_one_snapshot(
    session: Session, workspace: Workspace
) -> None:
    detail = start_two_arms(session, workspace)

    assert [run.position for run in detail.runs] == [0, 1]
    assert [run.label for run in detail.runs] == ["Arm A", "Arm B"]
    assert len({run.sandbox_id for run in detail.runs}) == 2
    # The claim the whole comparison rests on: two arms, one starting state.
    assert {arm.snapshot_fingerprint for arm in detail.sandboxes} == {
        detail.record.sandbox_fingerprint
    }
    assert len({arm.state_fingerprint for arm in detail.sandboxes}) == 1


def test_both_arms_open_with_the_scenario_triggering_message(
    session: Session, workspace: Workspace
) -> None:
    detail = start_two_arms(session, workspace)

    openings = [turn for turn in detail.turns if turn.turn.ordinal == 0]

    assert len(openings) == 2
    assert {turn.turn.source for turn in openings} == {ParticipantTurnSource.TRIGGER}
    assert {turn.turn.driver for turn in openings} == {None}
    # One composition — the author's — delivered to both arms, word for word.
    assert len({turn.turn.turn_id for turn in openings}) == 1
    assert len({turn.turn.body for turn in openings}) == 1


def test_the_experiment_pins_the_arm_configurations_and_their_identities(
    session: Session, workspace: Workspace
) -> None:
    detail = start_two_arms(session, workspace)

    assert len(detail.resolution.arms) == 2
    for arm in detail.resolution.arms:
        assert arm.agent_configuration.definition.definition_type is (
            DefinitionType.AGENT_CONFIGURATION
        )
        assert [entry.definition.definition_type for entry in arm.support_identities] == [
            DefinitionType.SUPPORT_IDENTITY
        ]


def test_the_shared_pins_stay_out_of_the_arms_and_the_tools_are_recorded(
    session: Session, workspace: Workspace
) -> None:
    """A sandbox pin explains the world; an arm pin explains the agent. Never mixed."""
    detail = start_two_arms(session, workspace)

    shared = {entry.definition.definition_type for entry in detail.resolution.sandbox_inputs}

    assert DefinitionType.SCENARIO in shared
    assert DefinitionType.AGENT_CONFIGURATION not in shared
    assert DefinitionType.SUPPORT_IDENTITY not in shared
    assert dict(detail.resolution.tool_contract_versions) == dict(SANDBOX_TOOL_CONTRACT_VERSIONS)


def test_one_arm_is_a_complete_experiment(session: Session, workspace: Workspace) -> None:
    detail = build_experiments(session).start(
        workspace.shop_id, command(workspace, (published_configuration(session),))
    )

    assert len(detail.runs) == 1
    assert [variable.differs for variable in detail.comparison] == [False] * len(
        ComparisonDimension
    )


def test_an_arm_can_be_named_by_the_operator(session: Session, workspace: Workspace) -> None:
    arm = replace(published_configuration(session), label="Pydantic AI")

    detail = build_experiments(session).start(workspace.shop_id, command(workspace, (arm,)))

    assert [run.label for run in detail.runs] == ["Pydantic AI"]


def test_two_arms_cannot_share_one_name(session: Session, workspace: Workspace) -> None:
    """A comparison reads "arm A did this, arm B did that"; one name for both says nothing."""
    arm = published_configuration(session)
    arms = (replace(arm, label="Atlas"), replace(arm, label="Atlas"))

    with pytest.raises(ExperimentArmError, match="tells it from the one beside it"):
        build_experiments(session).start(workspace.shop_id, command(workspace, arms))


def test_the_same_scenario_started_twice_is_two_experiments(
    session: Session, workspace: Workspace
) -> None:
    """Deliberately not idempotent, for the reason cloning is not (ADR 0020)."""
    experiments = build_experiments(session)
    arms = (published_configuration(session),)
    scenario_id, version = published_scenario(workspace)
    setup = StartExperiment(
        label="Repeat",
        scenario_id=scenario_id,
        scenario_version=version,
        seed=SEED,
        arms=arms,
    )

    first = experiments.start(workspace.shop_id, setup)
    second = experiments.start(workspace.shop_id, setup)

    assert first.record.experiment_id != second.record.experiment_id
    # The same inputs, so the same recognizable resolution — and the same frozen world.
    assert first.record.resolution_fingerprint == second.record.resolution_fingerprint
    assert first.record.snapshot_id == second.record.snapshot_id
    assert first.runs[0].sandbox_id != second.runs[0].sandbox_id


def test_an_experiment_is_named_so_an_operator_can_find_it(
    session: Session, workspace: Workspace
) -> None:
    with pytest.raises(ExperimentLabelError):
        build_experiments(session).start(
            workspace.shop_id, command(workspace, (published_configuration(session),), label="  ")
        )


def test_a_comparison_runs_one_or_two_arms(session: Session, workspace: Workspace) -> None:
    arms = (published_configuration(session),) * 3

    with pytest.raises(ExperimentArmError, match="one or 2"):
        build_experiments(session).start(workspace.shop_id, command(workspace, arms))


def test_an_arm_names_a_published_configuration_version(
    session: Session, workspace: Workspace
) -> None:
    arm = replace(published_configuration(session), version=99)

    with pytest.raises(Exception, match="has no published version 99"):
        build_experiments(session).start(workspace.shop_id, command(workspace, (arm,)))


def test_the_scenario_version_must_be_published_in_this_shop(
    session: Session, workspace: Workspace
) -> None:
    setup = command(workspace, (published_configuration(session),))

    with pytest.raises(Exception, match="is not published in shop"):
        build_experiments(session).start(uuid4(), setup)


# -- the setup gate ------------------------------------------------------------


def test_a_tone_override_the_shop_does_not_publish_refuses_the_start(
    session: Session, workspace: Workspace
) -> None:
    """The check ADR 0024 deferred to setup, arriving where it said it would."""
    arm = published_configuration(
        session,
        tone_of_voice=ToneOfVoiceSelection(
            source=ToneOfVoiceSource.OVERRIDE, guideline_id="never-authored"
        ),
    )

    with pytest.raises(ExperimentNotStartableError) as refusal:
        build_experiments(session).start(workspace.shop_id, command(workspace, (arm,)))

    codes = [issue.code for issue in refusal.value.validation.errors]
    assert codes == ["tone_override_unknown_in_shop"]


def test_a_fault_this_build_cannot_carry_out_refuses_the_start(
    session: Session, workspace: Workspace
) -> None:
    """A recipe may compose a fault no build injects yet; an experiment may not start on one.

    Reading "the fault changed nothing" off a run that never faulted is the one conclusion an
    experiment must never invite, so the refusal is here rather than at publication.
    """
    setup = command(
        workspace, (published_configuration(session),), (unobservable_fault(workspace),)
    )

    with pytest.raises(ExperimentNotStartableError) as refusal:
        build_experiments(session).start(workspace.shop_id, setup)

    codes = [issue.code for issue in refusal.value.validation.errors]
    assert codes == ["mutation_timing_not_observable"]


def test_the_preview_reads_the_faults_it_would_have_to_carry_out(
    session: Session, workspace: Workspace
) -> None:
    """The same gate `start` applies, so an operator meets the refusal before committing."""
    setup = command(
        workspace, (published_configuration(session),), (unobservable_fault(workspace),)
    )

    preview = build_experiments(session).preview(workspace.shop_id, setup)

    assert [issue.code for issue in preview.validation.errors] == ["mutation_timing_not_observable"]


def test_arms_differing_in_more_than_one_dimension_warn_but_still_run(
    session: Session, workspace: Workspace
) -> None:
    adopted = published_identity(session)
    left = published_configuration(session, adopted)
    # The deterministic fake is proven only for its own provider and model, so switching
    # framework necessarily switches model too: two dimensions, which is the point.
    right = published_configuration(
        session, adopted, framework_id=FAKE_FRAMEWORK_ID, model=fake_model()
    )

    detail = build_experiments(session).start(workspace.shop_id, command(workspace, (left, right)))

    preview = build_experiments(session).preview(
        workspace.shop_id,
        StartExperiment(
            label="Framework comparison",
            scenario_id=detail.record.scenario_id,
            scenario_version=detail.record.scenario_version,
            seed=SEED,
            arms=(left, right),
        ),
    )
    codes = [issue.code for issue in preview.validation.warnings]

    assert codes == ["multiple_comparison_variables"]
    assert len(detail.runs) == 2


def test_the_stored_schema_token_is_served_rather_than_the_build_s(
    session: Session, workspace: Workspace
) -> None:
    """The document is authoritative, so a row reports the token it actually carries."""
    detail = start_two_arms(session, workspace)

    assert detail.record.canonical_schema_version == EXPERIMENT_CANONICAL_SCHEMA_VERSION
    assert detail.record.document["canonical_schema_version"] == (
        detail.record.canonical_schema_version
    )


def test_a_closure_that_disagrees_with_itself_is_read_in_the_preview(
    session: Session, workspace: Workspace
) -> None:
    """Resolving is what finds a conflicting pin, so the preview has to resolve too.

    The ticket froze shop v1 and the recipe was built on v2, so the experiment would pin the
    shop at two versions. An operator must read that while choosing rather than meeting it
    only once they commit — and `start` refuses on the same finding.
    """
    experiments = build_experiments(session)
    publish_prerequisites(workspace)
    workspace.shops.publish(workspace.shop_id)
    scenario_id = author(workspace)
    version = workspace.scenarios.publish_scenario(workspace.shop_id, scenario_id).published.version
    setup = StartExperiment(
        label="Conflicting pins",
        scenario_id=scenario_id,
        scenario_version=version,
        seed=SEED,
        arms=(published_configuration(session),),
    )

    preview = experiments.preview(workspace.shop_id, setup)

    assert [issue.code for issue in preview.validation.errors] == ["experiment_conflicting_pin"]
    with pytest.raises(ExperimentNotStartableError) as refusal:
        experiments.start(workspace.shop_id, setup)
    assert [issue.code for issue in refusal.value.validation.errors] == [
        "experiment_conflicting_pin"
    ]


def test_the_preview_answers_the_matrix_without_freezing_anything(
    session: Session, workspace: Workspace
) -> None:
    experiments = build_experiments(session)
    adopted = published_identity(session)
    left = published_configuration(session, adopted)
    right = published_configuration(session, adopted, prompt="You are support for {{shop.name}}.")
    setup = command(workspace, (left, right))

    preview = experiments.preview(workspace.shop_id, setup)

    assert preview.arm_labels == ("Arm A", "Arm B")
    assert [variable.dimension for variable in preview.comparison] == list(ComparisonDimension)
    assert [variable.dimension for variable in preview.comparison if variable.differs] == [
        ComparisonDimension.PROMPT
    ]
    assert experiments.list_experiments(workspace.shop_id) == ()


# -- driving -------------------------------------------------------------------


def test_a_linked_turn_reaches_both_arms_as_one_composition(
    session: Session, workspace: Workspace
) -> None:
    experiments = build_experiments(session)
    detail = start_two_arms(session, workspace)

    delivered = experiments.deliver_turn(
        workspace.shop_id,
        detail.record.experiment_id,
        tuple(run.run_id for run in detail.runs),
        HumanParticipantDriver("Any update on the address?"),
    )

    assert len({record.turn.turn_id for record in delivered}) == 1
    assert [record.turn.ordinal for record in delivered] == [1, 1]
    assert {record.turn.driver for record in delivered} == {ParticipantDriverType.HUMAN}
    assert {record.turn.source for record in delivered} == {ParticipantTurnSource.PARTICIPANT}


def test_two_arm_specific_replies_are_two_compositions_even_with_the_same_words(
    session: Session, workspace: Workspace
) -> None:
    """The divergence record: identical words sent by two decisions did diverge."""
    experiments = build_experiments(session)
    detail = start_two_arms(session, workspace)
    words = "Any update on the address?"

    first = experiments.deliver_turn(
        workspace.shop_id,
        detail.record.experiment_id,
        (detail.runs[0].run_id,),
        HumanParticipantDriver(words),
    )
    second = experiments.deliver_turn(
        workspace.shop_id,
        detail.record.experiment_id,
        (detail.runs[1].run_id,),
        HumanParticipantDriver(words),
    )

    assert first[0].turn.body == second[0].turn.body
    assert first[0].turn.turn_id != second[0].turn.turn_id


def test_arms_driven_at_different_depths_keep_their_own_ordinals(
    session: Session, workspace: Workspace
) -> None:
    experiments = build_experiments(session)
    detail = start_two_arms(session, workspace)
    arm_a = detail.runs[0].run_id

    experiments.deliver_turn(
        workspace.shop_id, detail.record.experiment_id, (arm_a,), HumanParticipantDriver("One")
    )
    second = experiments.deliver_turn(
        workspace.shop_id, detail.record.experiment_id, (arm_a,), HumanParticipantDriver("Two")
    )
    third = experiments.deliver_turn(
        workspace.shop_id,
        detail.record.experiment_id,
        (detail.runs[1].run_id,),
        HumanParticipantDriver("Only once"),
    )

    assert second[0].turn.ordinal == 2
    assert third[0].turn.ordinal == 1


def test_the_driver_sees_what_this_arm_has_already_received(
    session: Session, workspace: Workspace
) -> None:
    experiments = build_experiments(session)
    detail = start_two_arms(session, workspace)
    seen: list[ParticipantRequest] = []

    class RecordingDriver:
        @property
        def driver_type(self) -> ParticipantDriverType:
            return ParticipantDriverType.HUMAN

        def next_turn(self, request: ParticipantRequest) -> str:
            seen.append(request)
            return "Recorded"

    experiments.deliver_turn(
        workspace.shop_id,
        detail.record.experiment_id,
        (detail.runs[0].run_id,),
        RecordingDriver(),
    )

    assert [request.arm_label for request in seen] == ["Arm A"]
    assert [turn.source for turn in seen[0].turns] == [ParticipantTurnSource.TRIGGER]


def test_a_message_the_operator_padded_is_recorded_without_the_padding(
    session: Session, workspace: Workspace
) -> None:
    """A compose box collects whitespace freely; a recorded turn carries none of it.

    Every raw client sends the trailing newline its input ends with, and refusing that would
    be refusing the message rather than the padding.
    """
    experiments = build_experiments(session)
    detail = start_two_arms(session, workspace)

    delivered = experiments.deliver_turn(
        workspace.shop_id,
        detail.record.experiment_id,
        (detail.runs[0].run_id,),
        HumanParticipantDriver("  Any update on the address?\n"),
    )

    assert delivered[0].turn.body == "Any update on the address?"


def test_an_empty_composition_is_a_run_that_has_not_been_driven(
    session: Session, workspace: Workspace
) -> None:
    experiments = build_experiments(session)
    detail = start_two_arms(session, workspace)

    with pytest.raises(ParticipantTurnUnavailableError, match="Arm A"):
        experiments.deliver_turn(
            workspace.shop_id,
            detail.record.experiment_id,
            (detail.runs[0].run_id,),
            HumanParticipantDriver("   "),
        )


def test_a_driver_the_experiment_did_not_record_cannot_drive_it(
    session: Session, workspace: Workspace
) -> None:
    experiments = build_experiments(session)
    detail = start_two_arms(session, workspace)

    class ScriptedDriver:
        @property
        def driver_type(self) -> ParticipantDriverType:
            return ParticipantDriverType.SCRIPTED

        def next_turn(self, request: ParticipantRequest) -> str:
            return "From a script"

    with pytest.raises(ParticipantDriverMismatchError, match="not by a scripted one"):
        experiments.deliver_turn(
            workspace.shop_id,
            detail.record.experiment_id,
            (detail.runs[0].run_id,),
            ScriptedDriver(),
        )


def test_a_turn_cannot_be_delivered_to_an_arm_of_another_experiment(
    session: Session, workspace: Workspace
) -> None:
    experiments = build_experiments(session)
    detail = start_two_arms(session, workspace)

    with pytest.raises(ExperimentRunNotFoundError):
        experiments.deliver_turn(
            workspace.shop_id,
            detail.record.experiment_id,
            (uuid4(),),
            HumanParticipantDriver("Hello"),
        )


def test_naming_one_arm_twice_delivers_one_turn(session: Session, workspace: Workspace) -> None:
    """A repeated arm is the same arm, not a second copy of the message."""
    experiments = build_experiments(session)
    detail = start_two_arms(session, workspace)
    run_id = detail.runs[0].run_id

    delivered = experiments.deliver_turn(
        workspace.shop_id,
        detail.record.experiment_id,
        (run_id, run_id),
        HumanParticipantDriver("Once"),
    )

    assert len(delivered) == 1


# -- reading -------------------------------------------------------------------


def test_an_experiment_is_read_back_with_its_arms_and_threads(
    session: Session, workspace: Workspace
) -> None:
    experiments = build_experiments(session)
    started = start_two_arms(session, workspace)
    experiments.deliver_turn(
        workspace.shop_id,
        started.record.experiment_id,
        (started.runs[0].run_id,),
        HumanParticipantDriver("Still the old address."),
    )

    detail = experiments.get_experiment(workspace.shop_id, started.record.experiment_id)

    assert len(detail.runs) == 2
    assert len(detail.turns) == 3
    assert detail.record.resolution_fingerprint == started.record.resolution_fingerprint


def test_a_shop_lists_its_experiments(session: Session, workspace: Workspace) -> None:
    start_two_arms(session, workspace)

    listed = build_experiments(session).list_experiments(workspace.shop_id)

    assert [record.label for record in listed] == ["Framework comparison"]
    assert build_experiments(session).list_experiments(uuid4()) == ()


def test_an_experiment_of_another_shop_is_not_found(session: Session, workspace: Workspace) -> None:
    detail = start_two_arms(session, workspace)

    with pytest.raises(ExperimentNotFoundError):
        build_experiments(session).get_experiment(uuid4(), detail.record.experiment_id)


def test_a_write_in_one_arm_moves_that_arm_alone(session: Session, workspace: Workspace) -> None:
    """The isolation ADR 0020 built, now read through the experiment that owns both arms."""
    experiments = build_experiments(session)
    detail = start_two_arms(session, workspace)
    order = detail.sandboxes[0].content.state.orders[0]

    build_sandboxes(session).apply_order_change(
        workspace.shop_id,
        detail.runs[0].sandbox_id,
        order.order_id,
        moved_to_lyon(order.payload),
        expected_revision=0,
    )
    moved = experiments.get_experiment(workspace.shop_id, detail.record.experiment_id)

    assert moved.sandboxes[0].state_fingerprint != moved.sandboxes[1].state_fingerprint
    assert moved.sandboxes[1].state_fingerprint == detail.sandboxes[1].state_fingerprint
