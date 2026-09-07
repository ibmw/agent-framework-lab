"""Forking one experiment into another: same world, same script, the arms an operator chose.

The mirror of the replay suite beside it (ADR 0038). Everything a replay holds constant a
fork holds constant too — that is what these tests are mostly about — and the one thing a
fork moves is what it is named for (ADR 0039).
"""

from collections.abc import Generator
from dataclasses import replace
from decimal import Decimal
from pathlib import Path
from uuid import uuid4

import pytest
from sqlalchemy.orm import Session

from agent_factories import READ_TOOL_NAMES, model_settings
from block_factories import publishable_objective
from capability_lab.application import experiments as experiments_module
from capability_lab.application.agent_capabilities import FAKE_FRAMEWORK_ID
from capability_lab.application.agent_configurations import (
    AgentConfigurationVersionNotFoundError,
)
from capability_lab.application.experiment_derivations import ForkArm
from capability_lab.application.experiments import (
    ArmSelection,
    ExperimentDetail,
    ExperimentNotFoundError,
    StartExperiment,
)
from capability_lab.application.sandbox_actions import ToolActor
from capability_lab.application.sandbox_materialization import SANDBOX_TOOL_CONTRACT_VERSIONS
from capability_lab.application.sandbox_tool_contracts import (
    ADDRESS_CHANGE_APPLY,
    ADDRESS_CHANGE_PROPOSE,
)
from capability_lab.domain.agent_configuration import ModelSettings
from capability_lab.domain.blocks import (
    MutationEffect,
    ObjectiveAssessment,
    ObjectiveEvidence,
    ObjectiveSeverity,
)
from capability_lab.domain.experiment import (
    ArmAwaiting,
    ComparisonDimension,
    DerivationKind,
    ExperimentConfigurationError,
    ParticipantDriverType,
    ParticipantTurnSource,
)
from capability_lab.domain.scenario import BoundMutation, BoundObjective, ScenarioBinding
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
    build_agent_configurations,
    build_annotations,
    build_derivations,
    build_evaluation,
    build_experiments,
    build_judge_service,
    build_runner,
    build_traces,
    publish_prerequisites,
    published_configuration,
    published_identity,
    published_judge,
    read_check,
    seed_workspace,
)


@pytest.fixture
def session(tmp_path: Path) -> Generator[Session, None, None]:
    engine = create_database_engine(f"sqlite:///{tmp_path / 'forks.db'}")
    Base.metadata.create_all(engine)
    with session_scope(create_session_factory(engine)) as active:
        yield active


@pytest.fixture
def workspace(session: Session) -> Workspace:
    return seed_workspace(session)


def control_model(**overrides: object) -> ModelSettings:
    return model_settings(provider="fake", model_id="deterministic", **overrides)


def control_arm(
    session: Session, actor: ToolActor | None = None, **overrides: object
) -> ArmSelection:
    """One published configuration the offline control runtime can actually run.

    The support identity is a comparison dimension of its own, so a suite that swaps one arm
    for a *different* configuration and wants exactly one dimension to move hands the same
    identity to both.
    """
    fields: dict[str, object] = {
        "framework_id": FAKE_FRAMEWORK_ID,
        "model": control_model(),
        "tools": (*READ_TOOL_NAMES, ADDRESS_CHANGE_PROPOSE, ADDRESS_CHANGE_APPLY),
    }
    fields.update(overrides)
    return published_configuration(
        session, published_identity(session) if actor is None else actor, **fields
    )


def republish(session: Session, arm: ArmSelection, **changes: object) -> ArmSelection:
    """A newer published version of the configuration one arm ran — what a fork moves to."""
    configurations = build_agent_configurations(session)
    draft = configurations.get_draft(arm.configuration_id)
    configurations.replace_configuration(arm.configuration_id, replace(draft.payload, **changes))
    published = configurations.publish(arm.configuration_id)
    return ArmSelection(configuration_id=arm.configuration_id, version=published.published.version)


def start(
    session: Session,
    workspace: Workspace,
    *arms: ArmSelection,
    mutations: tuple[BoundMutation, ...] = (),
    objectives: tuple[BoundObjective, ...] | None = None,
) -> ExperimentDetail:
    publish_prerequisites(workspace)
    overrides: dict[str, object] = {"mutations": mutations}
    if objectives is not None:
        overrides["objectives"] = objectives
    scenario_id = author(workspace, **overrides)
    version = workspace.scenarios.publish_scenario(workspace.shop_id, scenario_id)
    return build_experiments(session).start(
        workspace.shop_id,
        StartExperiment(
            label="Wrong shipping address",
            scenario_id=scenario_id,
            scenario_version=version.published.version,
            seed=SEED,
            arms=arms,
        ),
    )


def judged_objective(workspace: Workspace) -> BoundObjective:
    """A bound objective whose template says a judge decides it, and nothing else can."""
    created = workspace.objectives.create_block("resolve-the-incident")
    block_id = created.definition.id
    workspace.objectives.replace_block(
        block_id,
        publishable_objective(
            name="resolve-the-incident",
            statement="Resolve the incident the customer opened",
            assessment=ObjectiveAssessment.JUDGE,
            evidence=ObjectiveEvidence.DIMENSION,
            parameters=(),
        ),
    )
    workspace.objectives.publish(block_id)
    return BoundObjective(
        id="resolve-the-incident", block_id=block_id, severity=ObjectiveSeverity.REQUIRED
    )


def say(session: Session, detail: ExperimentDetail, message: str, *positions: int) -> None:
    """One composition, delivered to the arms an operator chose."""
    build_experiments(session).deliver_turn(
        detail.record.shop_id,
        detail.record.experiment_id,
        tuple(detail.runs[position].run_id for position in positions),
        HumanParticipantDriver(message),
    )


async def run_arm(session: Session, detail: ExperimentDetail, position: int = 0) -> None:
    run = detail.runs[position]
    await build_runner(session).advance(run.shop_id, run.experiment_id, run.run_id)


def reread(session: Session, detail: ExperimentDetail) -> ExperimentDetail:
    return build_experiments(session).get_experiment(
        detail.record.shop_id, detail.record.experiment_id
    )


def thread(detail: ExperimentDetail, position: int) -> list[tuple[int, str]]:
    run_id = detail.runs[position].run_id
    return [
        (entry.turn.ordinal, entry.turn.body)
        for entry in sorted(
            (entry for entry in detail.turns if entry.run_id == run_id),
            key=lambda entry: entry.turn.ordinal,
        )
    ]


def pins(detail: ExperimentDetail) -> list[tuple[object, int]]:
    return [(run.agent_configuration_id, run.agent_configuration_version) for run in detail.runs]


def arms_of(detail: ExperimentDetail) -> tuple[ForkArm, ...]:
    """The fork command that would change nothing: every arm as its source pinned it."""
    return tuple(
        ForkArm(
            configuration_id=run.agent_configuration_id,
            version=run.agent_configuration_version,
        )
        for run in detail.runs
    )


def moving(detail: ExperimentDetail, position: int, to: ArmSelection) -> tuple[ForkArm, ...]:
    """The same command with one arm pointed somewhere else."""
    chosen = list(arms_of(detail))
    chosen[position] = ForkArm(configuration_id=to.configuration_id, version=to.version)
    return tuple(chosen)


# -- what a fork changes -------------------------------------------------------


@pytest.mark.asyncio
async def test_a_fork_runs_the_version_the_operator_chose_and_leaves_the_other_arm_pinned(
    session: Session, workspace: Workspace
) -> None:
    """The one thing a fork varies, and the proof that it varies only that.

    The arm nobody moved keeps the exact version its source ran, so the derived run's own
    two arms are the source's comparison plus one deliberate change."""
    first, second = control_arm(session), control_arm(session)
    source = start(session, workspace, first, second)
    await run_arm(session, source)
    newer = republish(session, second, prompt="Rewritten after the run.")

    derived = await build_derivations(session).fork(
        workspace.shop_id, source.record.experiment_id, moving(source, 1, newer)
    )

    assert newer.version > second.version
    assert pins(derived) == [
        (first.configuration_id, first.version),
        (second.configuration_id, newer.version),
    ]
    assert derived.record.label == "Wrong shipping address (fork)"


@pytest.mark.asyncio
async def test_a_fork_may_swap_an_arm_for_a_different_configuration_entirely(
    session: Session, workspace: Workspace
) -> None:
    """Not only a newer version of the same one: the arm is what a fork chooses.

    The replacement adopts the same support identity, so the one dimension that moves is the
    one this test is about — a swap that also changed the identity would move two."""
    adopted = published_identity(session)
    source = start(session, workspace, control_arm(session, adopted), control_arm(session))
    await run_arm(session, source)
    other = control_arm(session, adopted, prompt="A different agent altogether.")

    derived = await build_derivations(session).fork(
        workspace.shop_id, source.record.experiment_id, moving(source, 0, other)
    )

    assert pins(derived)[0] == (other.configuration_id, other.version)
    assert derived.derived_from is not None
    assert derived.derived_from.changed == (ComparisonDimension.PROMPT,)


@pytest.mark.asyncio
async def test_a_fork_reports_the_one_dimension_it_moved(
    session: Session, workspace: Workspace
) -> None:
    """A fork's whole claim is that what it changed is the only thing that changed."""
    arm = control_arm(session)
    source = start(session, workspace, arm)
    await run_arm(session, source)
    newer = republish(session, arm, prompt="Read the policy before acting.")

    derived = await build_derivations(session).fork(
        workspace.shop_id, source.record.experiment_id, moving(source, 0, newer)
    )

    assert derived.derived_from is not None
    assert derived.derived_from.kind is DerivationKind.FORK
    assert derived.derived_from.changed == (ComparisonDimension.PROMPT,)


@pytest.mark.asyncio
async def test_a_fork_that_moves_two_dimensions_says_so_rather_than_being_refused(
    session: Session, workspace: Workspace
) -> None:
    """The setup gate's comparison warning, one level out (ADR 0025).

    Two variables is still worth running — it is often how a suspicion starts — but nothing
    the derived run produces can be attributed to either of them, so the derivation says
    which two it moved instead of leaving it to be noticed months later."""
    first, second = control_arm(session), control_arm(session)
    source = start(session, workspace, first, second)
    await run_arm(session, source)
    prompted = republish(session, first, prompt="Read the policy before acting.")
    remodelled = republish(session, second, model=control_model(temperature=Decimal("0.9")))

    derived = await build_derivations(session).fork(
        workspace.shop_id,
        source.record.experiment_id,
        (
            ForkArm(configuration_id=prompted.configuration_id, version=prompted.version),
            ForkArm(configuration_id=remodelled.configuration_id, version=remodelled.version),
        ),
    )

    assert derived.derived_from is not None
    assert derived.derived_from.changed == (
        ComparisonDimension.MODEL,
        ComparisonDimension.PROMPT,
    )


@pytest.mark.asyncio
async def test_both_arms_moved_the_same_way_is_one_variable(
    session: Session, workspace: Workspace
) -> None:
    """ "Does the new prompt help either of them" is one question, so it counts as one."""
    first, second = control_arm(session), control_arm(session)
    source = start(session, workspace, first, second)
    await run_arm(session, source)
    newer = (
        republish(session, first, prompt="Read the policy before acting."),
        republish(session, second, prompt="Read the policy before acting."),
    )

    derived = await build_derivations(session).fork(
        workspace.shop_id,
        source.record.experiment_id,
        tuple(ForkArm(configuration_id=arm.configuration_id, version=arm.version) for arm in newer),
    )

    assert derived.derived_from is not None
    assert derived.derived_from.changed == (ComparisonDimension.PROMPT,)


# -- what a fork holds constant ------------------------------------------------


@pytest.mark.asyncio
async def test_a_fork_starts_in_the_world_its_source_started_in(
    session: Session, workspace: Workspace
) -> None:
    """The snapshot is reused by identity, exactly as a replay reuses it (ADR 0038).

    Re-freezing would have moved the world as well as the arms, which is the second variable
    a fork exists to avoid."""
    arm = control_arm(session)
    source = start(session, workspace, arm)
    await run_arm(session, source)
    newer = republish(session, arm, prompt="Read the policy before acting.")

    derived = await build_derivations(session).fork(
        workspace.shop_id, source.record.experiment_id, moving(source, 0, newer)
    )

    assert derived.record.snapshot_id == source.record.snapshot_id
    assert derived.record.sandbox_fingerprint == source.record.sandbox_fingerprint
    assert derived.sandboxes[0].snapshot_fingerprint == source.record.sandbox_fingerprint
    assert derived.record.scenario_version == source.record.scenario_version
    assert derived.record.seed == source.record.seed


@pytest.mark.asyncio
async def test_a_fork_is_driven_by_the_compositions_its_source_recorded(
    session: Session, workspace: Workspace
) -> None:
    """Same words, same arms, same depths — so a difference is about the arms."""
    first, second = control_arm(session), control_arm(session)
    source = start(session, workspace, first, second)
    await run_arm(session, source, 0)
    await run_arm(session, source, 1)
    say(session, reread(session, source), "Any update?", 0, 1)
    say(session, reread(session, source), "Only arm A hears this.", 0)
    newer = republish(session, second, prompt="Read the policy before acting.")

    derived = await build_derivations(session).fork(
        workspace.shop_id, source.record.experiment_id, moving(source, 1, newer)
    )

    assert thread(derived, 0) == thread(reread(session, source), 0)
    assert thread(derived, 1) == thread(reread(session, source), 1)
    assert derived.record.participant_driver is ParticipantDriverType.SCRIPTED
    by_composition: dict[object, set[object]] = {}
    for entry in derived.turns:
        if entry.turn.source is ParticipantTurnSource.PARTICIPANT:
            by_composition.setdefault(entry.turn.turn_id, set()).add(entry.run_id)
    assert sorted(len(reached) for reached in by_composition.values()) == [1, 2]


@pytest.mark.asyncio
async def test_a_fork_keeps_the_arm_names_its_source_gave_them(
    session: Session, workspace: Workspace
) -> None:
    """A comparison refers to an arm by its position, and the two records read side by side."""
    arm = control_arm(session)
    source = start(session, workspace, arm, control_arm(session))
    await run_arm(session, source)
    newer = republish(session, arm, prompt="Read the policy before acting.")

    derived = await build_derivations(session).fork(
        workspace.shop_id, source.record.experiment_id, moving(source, 0, newer)
    )

    assert [run.label for run in derived.runs] == [run.label for run in source.runs]
    assert {run.run_id for run in derived.runs}.isdisjoint({run.run_id for run in source.runs})
    assert {run.sandbox_id for run in derived.runs}.isdisjoint(
        {run.sandbox_id for run in source.runs}
    )


@pytest.mark.asyncio
async def test_an_arm_the_operator_never_ran_is_not_run_by_the_fork(
    session: Session, workspace: Workspace
) -> None:
    """The script reproduces what happened, including what did not — even on a moved arm."""
    first, second = control_arm(session), control_arm(session)
    source = start(session, workspace, first, second)
    await run_arm(session, source, 0)
    newer = republish(session, second, prompt="Read the policy before acting.")

    derived = await build_derivations(session).fork(
        workspace.shop_id, source.record.experiment_id, moving(source, 1, newer)
    )

    assert derived.standings[0].awaiting is ArmAwaiting.CUSTOMER
    assert derived.standings[1].awaiting is ArmAwaiting.AGENT


@pytest.mark.asyncio
async def test_a_scenario_fault_fires_again_into_the_forked_arm(
    session: Session, workspace: Workspace
) -> None:
    """The once-per-arm key is the arm's (ADR 0028), and a forked arm is a new one."""
    fault = BoundMutation(
        id="order-moves-under-the-arm",
        block_id=workspace.mutation_block_id,
        bindings=(
            ScenarioBinding(parameter="entity_ref", value=f"order:{workspace.order_id}"),
            ScenarioBinding(parameter="timing", value="after_first_read"),
        ),
    )
    arm = control_arm(session)
    source = start(session, workspace, arm, mutations=(fault,))
    await run_arm(session, source)
    answered = reread(session, source)
    newer = republish(session, arm, prompt="Read the policy before acting.")

    derived = await build_derivations(session).fork(
        workspace.shop_id, source.record.experiment_id, moving(source, 0, newer)
    )

    assert [event.event.mutation_id for event in answered.mutation_events] == [
        "order-moves-under-the-arm"
    ]
    assert [event.event.mutation_id for event in derived.mutation_events] == [
        "order-moves-under-the-arm"
    ]
    assert derived.mutation_events[0].event.effect is MutationEffect.ENTITY_MUTATION


# -- what a fork leaves alone --------------------------------------------------


@pytest.mark.asyncio
async def test_forking_a_run_changes_nothing_about_it(
    session: Session, workspace: Workspace
) -> None:
    """An experiment is immutable, so the derivation has to be readable as a second record."""
    arm = control_arm(session)
    source = start(session, workspace, arm)
    await run_arm(session, source)
    before = reread(session, source)
    recorded_traces = build_traces(session).traces(workspace.shop_id, source.record.experiment_id)
    newer = republish(session, arm, prompt="Read the policy before acting.")

    await build_derivations(session).fork(
        workspace.shop_id, source.record.experiment_id, moving(source, 0, newer)
    )
    after = reread(session, source)

    assert after.record == before.record
    assert after.turns == before.turns
    assert after.agent_turns == before.agent_turns
    assert after.tool_events == before.tool_events
    assert after.mutation_events == before.mutation_events
    assert [entry.state_fingerprint for entry in after.sandboxes] == [
        entry.state_fingerprint for entry in before.sandboxes
    ]
    assert [entry.revision for entry in after.sandboxes] == [
        entry.revision for entry in before.sandboxes
    ]
    # The one reading stored rather than projected (ADR 0037): a derived run opens its own
    # spans, and none of them may land on the arm it was derived from.
    assert (
        build_traces(session).traces(workspace.shop_id, source.record.experiment_id)
        == recorded_traces
    )
    # The source pins the version it ran, however far the configuration has been republished.
    assert after.runs[0].agent_configuration_version == arm.version
    assert after.derived_from is None


@pytest.mark.asyncio
async def test_a_verdict_and_a_note_stay_on_the_run_they_were_made_about(
    session: Session, workspace: Workspace
) -> None:
    """A judge scored one arm's brief (ADR 0031) and a reviewer read this evidence (ADR 0036).

    A fork changes the arm, so copying a verdict onto it would be inventing evidence about a
    configuration nobody ran."""
    judged = judged_objective(workspace)
    arm = control_arm(session)
    source = start(session, workspace, arm, objectives=(read_check(workspace), judged))
    await run_arm(session, source)
    experiment_id = source.record.experiment_id
    await build_judge_service(session).score(
        workspace.shop_id, experiment_id, published_judge(session)
    )
    annotations = build_annotations(session)
    annotations.add_note(workspace.shop_id, experiment_id, "Atlas acted before it read.")
    annotations.set_tags(workspace.shop_id, experiment_id, ("read-check-gap",))
    newer = republish(session, arm, prompt="Read the policy before acting.")

    derived = await build_derivations(session).fork(
        workspace.shop_id, experiment_id, moving(source, 0, newer)
    )

    evaluations = build_evaluation(session)
    unscored = evaluations.evaluate(workspace.shop_id, derived.record.experiment_id)
    owned = [
        result
        for judged_arm in unscored.arms
        for result in judged_arm.results
        if result.assessment is ObjectiveAssessment.JUDGE
    ]
    assert [result.judgement for result in owned] == [None]
    scored = evaluations.evaluate(workspace.shop_id, experiment_id)
    assert [
        result.judgement is not None
        for judged_arm in scored.arms
        for result in judged_arm.results
        if result.assessment is ObjectiveAssessment.JUDGE
    ] == [True]
    written = annotations.get(workspace.shop_id, derived.record.experiment_id)
    assert (written.notes, written.tags) == ((), ())
    kept = annotations.get(workspace.shop_id, experiment_id)
    assert [note.body for note in kept.notes] == ["Atlas acted before it read."]
    assert kept.tags == ("read-check-gap",)


# -- what a fork refuses -------------------------------------------------------


@pytest.mark.asyncio
async def test_a_fork_that_changes_no_arm_is_refused(
    session: Session, workspace: Workspace
) -> None:
    """It is a replay, and calling it a fork would tell every later reader something untrue."""
    source = start(session, workspace, control_arm(session), control_arm(session))
    await run_arm(session, source)

    with pytest.raises(ExperimentConfigurationError, match="changes nothing is a replay"):
        await build_derivations(session).fork(
            workspace.shop_id, source.record.experiment_id, arms_of(source)
        )


@pytest.mark.asyncio
async def test_a_fork_names_one_arm_per_arm_of_its_source(
    session: Session, workspace: Workspace
) -> None:
    """The script is written in arm positions, so a fork cannot add or drop one."""
    source = start(session, workspace, control_arm(session), control_arm(session))
    await run_arm(session, source)
    other = control_arm(session)

    with pytest.raises(ExperimentConfigurationError, match="has 2 arm"):
        await build_derivations(session).fork(
            workspace.shop_id,
            source.record.experiment_id,
            (ForkArm(configuration_id=other.configuration_id, version=other.version),),
        )


@pytest.mark.asyncio
async def test_a_fork_onto_a_version_nobody_published_is_refused(
    session: Session, workspace: Workspace
) -> None:
    """The same refusal a start makes: an arm is an exact published version (ADR 0024)."""
    arm = control_arm(session)
    source = start(session, workspace, arm)
    await run_arm(session, source)

    with pytest.raises(AgentConfigurationVersionNotFoundError):
        await build_derivations(session).fork(
            workspace.shop_id,
            source.record.experiment_id,
            (ForkArm(configuration_id=arm.configuration_id, version=arm.version + 99),),
        )


@pytest.mark.asyncio
async def test_an_experiment_of_another_shop_cannot_be_forked(
    session: Session, workspace: Workspace
) -> None:
    arm = control_arm(session)
    source = start(session, workspace, arm)
    newer = republish(session, arm, prompt="Read the policy before acting.")

    with pytest.raises(ExperimentNotFoundError):
        await build_derivations(session).fork(
            uuid4(), source.record.experiment_id, moving(source, 0, newer)
        )


@pytest.mark.asyncio
async def test_a_fork_is_refused_when_this_build_no_longer_publishes_the_frozen_tool_set(
    session: Session, workspace: Workspace, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The reuse refusal is `start`'s, so it covers a fork by construction (ADR 0038).

    A snapshot's fingerprint covers the tool contract set it was frozen against (ADR 0021)
    and reusing it re-fingerprints nothing, so a lab upgraded past that set has to refuse
    rather than write a run whose two fingerprints name two different tool sets. There is one
    door into the reuse and both derivations go through it."""
    arm = control_arm(session)
    source = start(session, workspace, arm)
    await run_arm(session, source)
    newer = republish(session, arm, prompt="Read the policy before acting.")
    upgraded = {**SANDBOX_TOOL_CONTRACT_VERSIONS, ADDRESS_CHANGE_APPLY: "v2"}
    monkeypatch.setattr(experiments_module, "SANDBOX_TOOL_CONTRACT_VERSIONS", upgraded)

    with pytest.raises(ExperimentConfigurationError, match="no longer publishes"):
        await build_derivations(session).fork(
            workspace.shop_id, source.record.experiment_id, moving(source, 0, newer)
        )


# -- chains --------------------------------------------------------------------


@pytest.mark.asyncio
async def test_a_fork_of_a_replay_names_the_replay_and_starts_in_the_first_run_s_world(
    session: Session, workspace: Workspace
) -> None:
    """A derivation names its immediate source, never a claim about the head of the chain."""
    arm = control_arm(session)
    source = start(session, workspace, arm)
    await run_arm(session, source)
    replayed = await build_derivations(session).replay(
        workspace.shop_id, source.record.experiment_id
    )
    newer = republish(session, arm, prompt="Read the policy before acting.")

    forked = await build_derivations(session).fork(
        workspace.shop_id, replayed.record.experiment_id, moving(replayed, 0, newer)
    )

    assert forked.derived_from is not None
    assert forked.derived_from.experiment_id == replayed.record.experiment_id
    assert forked.derived_from.kind is DerivationKind.FORK
    assert forked.derived_from.changed == (ComparisonDimension.PROMPT,)
    # Every run in the chain was cloned from the snapshot the first one froze.
    assert forked.record.sandbox_fingerprint == source.record.sandbox_fingerprint


@pytest.mark.asyncio
async def test_a_fork_of_a_fork_is_read_against_the_run_it_came_from(
    session: Session, workspace: Workspace
) -> None:
    """The difference set is against the immediate source, so a chain reads step by step."""
    arm = control_arm(session)
    source = start(session, workspace, arm)
    await run_arm(session, source)
    prompted = republish(session, arm, prompt="Read the policy before acting.")
    first = await build_derivations(session).fork(
        workspace.shop_id, source.record.experiment_id, moving(source, 0, prompted)
    )
    warmer = republish(session, arm, model=control_model(temperature=Decimal("0.9")))

    second = await build_derivations(session).fork(
        workspace.shop_id, first.record.experiment_id, moving(first, 0, warmer)
    )

    assert second.derived_from is not None
    assert second.derived_from.experiment_id == first.record.experiment_id
    # Against `first`, only the model moved: the prompt change is already in the source.
    assert second.derived_from.changed == (ComparisonDimension.MODEL,)
    assert second.record.sandbox_fingerprint == source.record.sandbox_fingerprint


@pytest.mark.asyncio
async def test_forking_one_run_twice_is_two_derived_experiments(
    session: Session, workspace: Workspace
) -> None:
    arm = control_arm(session)
    source = start(session, workspace, arm)
    await run_arm(session, source)
    newer = republish(session, arm, prompt="Read the policy before acting.")
    derivations = build_derivations(session)

    first = await derivations.fork(
        workspace.shop_id, source.record.experiment_id, moving(source, 0, newer)
    )
    second = await derivations.fork(
        workspace.shop_id, source.record.experiment_id, moving(source, 0, newer)
    )

    assert first.record.experiment_id != second.record.experiment_id
    assert first.record.resolution_fingerprint == second.record.resolution_fingerprint


@pytest.mark.asyncio
async def test_a_fork_is_in_the_shop_listing_the_source_is_in(
    session: Session, workspace: Workspace
) -> None:
    """A derived run nobody can find again is not a derived run (ADR 0034)."""
    arm = control_arm(session)
    source = start(session, workspace, arm)
    await run_arm(session, source)
    newer = republish(session, arm, prompt="Read the policy before acting.")

    derived = await build_derivations(session).fork(
        workspace.shop_id, source.record.experiment_id, moving(source, 0, newer)
    )

    listed = build_experiments(session).list_experiments(workspace.shop_id)
    assert {record.experiment_id for record in listed} == {
        source.record.experiment_id,
        derived.record.experiment_id,
    }
