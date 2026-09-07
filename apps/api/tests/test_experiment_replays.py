"""Replaying one experiment into another: same world, same arms, recorded script (ADR 0038)."""

from collections.abc import Generator
from dataclasses import replace
from pathlib import Path
from uuid import uuid4

import pytest
from sqlalchemy.orm import Session

from agent_factories import READ_TOOL_NAMES, model_settings
from block_factories import publishable_objective
from capability_lab.application import experiments as experiments_module
from capability_lab.application.agent_capabilities import FAKE_FRAMEWORK_ID
from capability_lab.application.agent_runtime import (
    AgentAnswer,
    AgentTurnRequest,
    SandboxToolInvoker,
    SupportAgentProviderError,
    SupportAgentRuntime,
    SupportAgentRuntimeRegistry,
)
from capability_lab.application.experiments import (
    ArmSelection,
    ExperimentDetail,
    ExperimentNotFoundError,
    StartExperiment,
)
from capability_lab.application.order_fixtures import OrderEdit, OrderLineSelection
from capability_lab.application.sandbox_materialization import SANDBOX_TOOL_CONTRACT_VERSIONS
from capability_lab.application.sandbox_tool_contracts import (
    ADDRESS_CHANGE_APPLY,
    ADDRESS_CHANGE_PROPOSE,
)
from capability_lab.domain.agent_configuration import ModelSettings
from capability_lab.domain.agent_turn import AgentTurnOutcome
from capability_lab.domain.blocks import (
    MutationEffect,
    ObjectiveAssessment,
    ObjectiveEvidence,
    ObjectiveSeverity,
)
from capability_lab.domain.experiment import (
    ArmAwaiting,
    DerivationKind,
    ExperimentConfigurationError,
    ParticipantDriverType,
    ParticipantTurnSource,
)
from capability_lab.domain.order_fixture import FulfilmentStatus, PaymentStatus
from capability_lab.domain.scenario import BoundMutation, BoundObjective, ScenarioBinding
from capability_lab.infrastructure.database import (
    Base,
    create_database_engine,
    create_session_factory,
    session_scope,
)
from capability_lab.infrastructure.participants.human import HumanParticipantDriver
from workspace_factories import (
    PLACED_AT,
    SEED,
    Workspace,
    author,
    build_agent_configurations,
    build_annotations,
    build_derivations,
    build_evaluation,
    build_experiments,
    build_judge_service,
    build_orders,
    build_runner,
    build_snapshots,
    build_traces,
    publish_prerequisites,
    published_configuration,
    published_identity,
    published_judge,
    read_check,
    seed_workspace,
)


def _registry(runtime: SupportAgentRuntime) -> SupportAgentRuntimeRegistry:
    return SupportAgentRuntimeRegistry({runtime.framework_id: runtime})


class _FailingRuntime(SupportAgentRuntime):
    """A framework whose provider refuses, so a source can hold a failure and a retry."""

    @property
    def framework_id(self) -> str:
        return FAKE_FRAMEWORK_ID

    async def answer(self, request: AgentTurnRequest, tools: SandboxToolInvoker) -> AgentAnswer:
        raise SupportAgentProviderError("the provider rejected the request")


@pytest.fixture
def session(tmp_path: Path) -> Generator[Session, None, None]:
    engine = create_database_engine(f"sqlite:///{tmp_path / 'replays.db'}")
    Base.metadata.create_all(engine)
    with session_scope(create_session_factory(engine)) as active:
        yield active


@pytest.fixture
def workspace(session: Session) -> Workspace:
    return seed_workspace(session)


def control_model(**overrides: object) -> ModelSettings:
    return model_settings(provider="fake", model_id="deterministic", **overrides)


def control_arm(session: Session, **overrides: object) -> ArmSelection:
    """One published configuration the offline control runtime can actually run."""
    fields: dict[str, object] = {
        "framework_id": FAKE_FRAMEWORK_ID,
        "model": control_model(),
        "tools": (*READ_TOOL_NAMES, ADDRESS_CHANGE_PROPOSE, ADDRESS_CHANGE_APPLY),
    }
    fields.update(overrides)
    return published_configuration(session, published_identity(session), **fields)


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


def move_the_order(session: Session, workspace: Workspace) -> None:
    """Edit the order the recipe names, which is what re-freezing would pick up."""
    orders = build_orders(session)
    current = orders.get_order(workspace.shop_id, workspace.order_id)
    orders.replace_order(
        workspace.shop_id,
        workspace.order_id,
        OrderEdit(
            reference=current.payload.reference,
            placed_at=PLACED_AT,
            lines=(OrderLineSelection(sku="NS-ASJ-OB-M", quantity=3),),
            payment_status=PaymentStatus.PAID,
            payment_method_id="visa",
            paid_at=current.payload.payment.paid_at,
            fulfilment_status=FulfilmentStatus.UNFULFILLED,
            fulfilment_method_id="standard",
            shipped_at=None,
            shipping_fee_amount="0.00",
            shipping_address_id="bordeaux-previous-flat",
            events=(),
        ),
    )


# -- what a replay reuses ------------------------------------------------------


@pytest.mark.asyncio
async def test_a_replay_starts_in_the_world_its_source_started_in(
    session: Session, workspace: Workspace
) -> None:
    """The claim the outcome is named for: the same snapshot, cloned again.

    Not a second freeze of the same recipe — that would copy the shop's order fixtures as
    they read now (ADR 0019), and this test moves one in between to prove the difference is
    real rather than theoretical."""
    source = start(session, workspace, control_arm(session))
    await run_arm(session, source)
    move_the_order(session, workspace)

    derivations = build_derivations(session)
    derived = await derivations.replay(workspace.shop_id, source.record.experiment_id)

    assert derived.record.snapshot_id == source.record.snapshot_id
    assert derived.record.sandbox_fingerprint == source.record.sandbox_fingerprint
    assert derived.sandboxes[0].snapshot_fingerprint == source.record.sandbox_fingerprint
    # The world it was cloned into is the one the source ran in, not the one on the shelf.
    assert derived.starting_state.orders[0].payload.item_count == 1


@pytest.mark.asyncio
async def test_a_replay_of_a_run_whose_order_has_since_been_deleted_still_runs(
    session: Session, workspace: Workspace
) -> None:
    """Re-freezing would be refused outright; cloning the recorded snapshot is not."""
    source = start(session, workspace, control_arm(session))
    await run_arm(session, source)
    build_orders(session).delete_order(workspace.shop_id, workspace.order_id)

    derivations = build_derivations(session)
    derived = await derivations.replay(workspace.shop_id, source.record.experiment_id)

    assert derived.record.sandbox_fingerprint == source.record.sandbox_fingerprint
    assert derived.standings[0].awaiting is not ArmAwaiting.AGENT


@pytest.mark.asyncio
async def test_a_replay_runs_the_configuration_version_the_source_pinned(
    session: Session, workspace: Workspace
) -> None:
    """Choosing a newer version is a fork; a replay would answer a different question."""
    arm = control_arm(session)
    source = start(session, workspace, arm)
    await run_arm(session, source)
    configurations = build_agent_configurations(session)
    draft = configurations.get_draft(arm.configuration_id)
    configurations.replace_configuration(
        arm.configuration_id, replace(draft.payload, prompt="Rewritten after the run.")
    )
    republished = configurations.publish(arm.configuration_id)

    derivations = build_derivations(session)
    derived = await derivations.replay(workspace.shop_id, source.record.experiment_id)

    assert republished.published.version > arm.version
    assert derived.runs[0].agent_configuration_id == arm.configuration_id
    assert derived.runs[0].agent_configuration_version == arm.version


@pytest.mark.asyncio
async def test_a_derived_experiment_is_a_new_experiment_with_its_own_arms(
    session: Session, workspace: Workspace
) -> None:
    source = start(session, workspace, control_arm(session), control_arm(session))
    await run_arm(session, source)

    derivations = build_derivations(session)
    derived = await derivations.replay(workspace.shop_id, source.record.experiment_id)

    assert derived.record.experiment_id != source.record.experiment_id
    assert {run.run_id for run in derived.runs}.isdisjoint({run.run_id for run in source.runs})
    assert {run.sandbox_id for run in derived.runs}.isdisjoint(
        {run.sandbox_id for run in source.runs}
    )
    assert [run.label for run in derived.runs] == [run.label for run in source.runs]


# -- what a replay re-runs -----------------------------------------------------


@pytest.mark.asyncio
async def test_the_recorded_compositions_are_what_drives_the_derived_run(
    session: Session, workspace: Workspace
) -> None:
    """The script: the same words, to the same arms, at the same depths."""
    source = start(session, workspace, control_arm(session), control_arm(session))
    await run_arm(session, source, 0)
    await run_arm(session, source, 1)
    say(session, reread(session, source), "Any update?", 0, 1)
    say(session, reread(session, source), "Only arm A hears this.", 0)

    derivations = build_derivations(session)
    derived = await derivations.replay(workspace.shop_id, source.record.experiment_id)

    assert thread(derived, 0) == thread(reread(session, source), 0)
    assert thread(derived, 1) == thread(reread(session, source), 1)


@pytest.mark.asyncio
async def test_a_linked_send_is_replayed_as_one_composition_and_an_arm_only_send_as_none(
    session: Session, workspace: Workspace
) -> None:
    """Divergence is the composition rather than the words (ADR 0025), so it has to survive."""
    source = start(session, workspace, control_arm(session), control_arm(session))
    await run_arm(session, source, 0)
    await run_arm(session, source, 1)
    say(session, reread(session, source), "Any update?", 0, 1)
    say(session, reread(session, source), "Only arm A hears this.", 0)

    derivations = build_derivations(session)
    derived = await derivations.replay(workspace.shop_id, source.record.experiment_id)

    by_composition: dict[object, set[object]] = {}
    for entry in derived.turns:
        if entry.turn.source is ParticipantTurnSource.PARTICIPANT:
            by_composition.setdefault(entry.turn.turn_id, set()).add(entry.run_id)
    assert sorted(len(arms) for arms in by_composition.values()) == [1, 2]


@pytest.mark.asyncio
async def test_the_derived_run_says_a_script_drove_it(
    session: Session, workspace: Workspace
) -> None:
    """The recorded driver is what produced the turns, and it is a fingerprinted input."""
    source = start(session, workspace, control_arm(session))
    await run_arm(session, source)
    say(session, reread(session, source), "Any update?", 0)

    derivations = build_derivations(session)
    derived = await derivations.replay(workspace.shop_id, source.record.experiment_id)

    assert derived.record.participant_driver is ParticipantDriverType.SCRIPTED
    assert {
        entry.turn.driver
        for entry in derived.turns
        if entry.turn.source is ParticipantTurnSource.PARTICIPANT
    } == {ParticipantDriverType.SCRIPTED}
    # The one input that differs, and it differs in the fingerprint that says which inputs
    # ran. The fingerprint that says which world they ran in is identical.
    assert derived.record.resolution_fingerprint != source.record.resolution_fingerprint
    assert derived.record.sandbox_fingerprint == source.record.sandbox_fingerprint


@pytest.mark.asyncio
async def test_a_deterministic_runtime_replays_an_arm_call_for_call(
    session: Session, workspace: Workspace
) -> None:
    """What a replay guarantees is the input; this runtime is what makes the output agree."""
    source = start(session, workspace, control_arm(session))
    await run_arm(session, source)
    answered = reread(session, source)

    derivations = build_derivations(session)
    derived = await derivations.replay(workspace.shop_id, source.record.experiment_id)

    assert [turn.turn.body for turn in derived.agent_turns] == [
        turn.turn.body for turn in answered.agent_turns
    ]
    assert [event.event.tool for event in derived.tool_events] == [
        event.event.tool for event in answered.tool_events
    ]
    # And the world it ended in is the world the source ended in.
    assert derived.sandboxes[0].state_fingerprint == answered.sandboxes[0].state_fingerprint


@pytest.mark.asyncio
async def test_an_arm_the_operator_never_ran_is_not_run_by_the_replay(
    session: Session, workspace: Workspace
) -> None:
    """A replay reproduces what happened, including what did not."""
    source = start(session, workspace, control_arm(session), control_arm(session))
    await run_arm(session, source, 0)

    derivations = build_derivations(session)
    derived = await derivations.replay(workspace.shop_id, source.record.experiment_id)

    assert derived.standings[0].awaiting is ArmAwaiting.CUSTOMER
    assert derived.standings[1].awaiting is ArmAwaiting.AGENT
    assert {turn.run_id for turn in derived.agent_turns} == {derived.runs[0].run_id}


@pytest.mark.asyncio
async def test_a_scenario_fault_fires_again_into_the_derived_arm(
    session: Session, workspace: Workspace
) -> None:
    """The once-per-arm key is the arm's (ADR 0028), and a derived arm is a new one."""
    fault = BoundMutation(
        id="order-moves-under-the-arm",
        block_id=workspace.mutation_block_id,
        bindings=(
            ScenarioBinding(parameter="entity_ref", value=f"order:{workspace.order_id}"),
            ScenarioBinding(parameter="timing", value="after_first_read"),
        ),
    )
    source = start(session, workspace, control_arm(session), mutations=(fault,))
    await run_arm(session, source)
    answered = reread(session, source)

    derivations = build_derivations(session)
    derived = await derivations.replay(workspace.shop_id, source.record.experiment_id)

    assert [event.event.mutation_id for event in answered.mutation_events] == [
        "order-moves-under-the-arm"
    ]
    assert [event.event.mutation_id for event in derived.mutation_events] == [
        "order-moves-under-the-arm"
    ]
    assert derived.mutation_events[0].event.effect is MutationEffect.ENTITY_MUTATION
    assert {event.run_id for event in derived.mutation_events}.isdisjoint(
        {event.run_id for event in answered.mutation_events}
    )


@pytest.mark.asyncio
async def test_a_retried_turn_is_advanced_as_often_and_records_only_what_happened(
    session: Session, workspace: Workspace
) -> None:
    """Advancing is idempotent over an answer, so the script's count is self-limiting.

    The source needed two advances at turn zero because the first one failed. The derived arm
    answers on the first, and the second returns that answer and calls no model — so the
    replay reproduces what the operator *did* without claiming the derived arm will fail."""
    source = start(session, workspace, control_arm(session))
    run = source.runs[0]
    await build_runner(session, _registry(_FailingRuntime())).advance(
        run.shop_id, run.experiment_id, run.run_id
    )
    await run_arm(session, source)
    assert [turn.turn.attempt for turn in reread(session, source).agent_turns] == [1, 2]

    derivations = build_derivations(session)
    derived = await derivations.replay(workspace.shop_id, source.record.experiment_id)

    assert [turn.turn.attempt for turn in derived.agent_turns] == [1]
    assert derived.agent_turns[0].turn.outcome is AgentTurnOutcome.ANSWERED


@pytest.mark.asyncio
async def test_a_replay_whose_framework_keeps_failing_records_every_advance_the_script_asked(
    session: Session, workspace: Workspace
) -> None:
    """A failure is evidence in a derived run exactly as it is in the run it derives from."""
    source = start(session, workspace, control_arm(session))
    run = source.runs[0]
    await build_runner(session, _registry(_FailingRuntime())).advance(
        run.shop_id, run.experiment_id, run.run_id
    )
    await run_arm(session, source)

    derived = await build_derivations(session, _registry(_FailingRuntime())).replay(
        workspace.shop_id, source.record.experiment_id
    )

    assert [turn.turn.outcome for turn in derived.agent_turns] == [
        AgentTurnOutcome.FAILED,
        AgentTurnOutcome.FAILED,
    ]
    assert [turn.turn.attempt for turn in derived.agent_turns] == [1, 2]
    # A run that owes a reply still owes one, so the operator can retry it by hand.
    assert derived.standings[0].awaiting is ArmAwaiting.AGENT


# -- what a replay leaves alone ------------------------------------------------


@pytest.mark.asyncio
async def test_replaying_a_run_changes_nothing_about_it(
    session: Session, workspace: Workspace
) -> None:
    """An experiment is immutable, so the derivation must be readable as a second record."""
    source = start(session, workspace, control_arm(session))
    await run_arm(session, source)
    before = reread(session, source)
    recorded_traces = build_traces(session).traces(workspace.shop_id, source.record.experiment_id)

    await build_derivations(session).replay(workspace.shop_id, source.record.experiment_id)
    after = reread(session, source)

    assert after.record == before.record
    assert after.turns == before.turns
    assert after.agent_turns == before.agent_turns
    assert after.tool_events == before.tool_events
    assert after.mutation_events == before.mutation_events
    assert [arm.state_fingerprint for arm in after.sandboxes] == [
        arm.state_fingerprint for arm in before.sandboxes
    ]
    assert [arm.revision for arm in after.sandboxes] == [arm.revision for arm in before.sandboxes]
    # The one reading of a run that is stored rather than projected (ADR 0037): a derived run
    # opens its own spans, and none of them may land on the arm it was derived from.
    traces = build_traces(session)
    assert traces.traces(workspace.shop_id, source.record.experiment_id) == recorded_traces
    assert after.derived_from is None


@pytest.mark.asyncio
async def test_what_a_person_concluded_about_a_run_is_never_copied_onto_the_derived_one(
    session: Session, workspace: Workspace
) -> None:
    """A verdict and a note are about the arm and the run they were made against.

    A judge execution is a model's reading of one arm's own brief (ADR 0031) and a note is
    what a reviewer thought when they read this evidence (ADR 0036). Copying either onto a
    different run would be inventing evidence, so a derived run starts unjudged and
    unannotated — and the source keeps both."""
    judged = judged_objective(workspace)
    source = start(
        session, workspace, control_arm(session), objectives=(read_check(workspace), judged)
    )
    await run_arm(session, source)
    experiment_id = source.record.experiment_id
    judge_id = published_judge(session)
    await build_judge_service(session).score(workspace.shop_id, experiment_id, judge_id)
    annotations = build_annotations(session)
    annotations.add_note(workspace.shop_id, experiment_id, "Atlas acted before it read.")
    annotations.set_tags(workspace.shop_id, experiment_id, ("read-check-gap",))

    derived = await build_derivations(session).replay(workspace.shop_id, experiment_id)

    evaluations = build_evaluation(session)
    unscored = evaluations.evaluate(workspace.shop_id, derived.record.experiment_id)
    owned = [
        result
        for arm in unscored.arms
        for result in arm.results
        if result.assessment is ObjectiveAssessment.JUDGE
    ]
    assert len(owned) == 1
    assert owned[0].judgement is None
    scored = evaluations.evaluate(workspace.shop_id, experiment_id)
    assert [
        result.judgement is not None
        for arm in scored.arms
        for result in arm.results
        if result.assessment is ObjectiveAssessment.JUDGE
    ] == [True]
    written = annotations.get(workspace.shop_id, derived.record.experiment_id)
    assert (written.notes, written.tags) == ((), ())
    kept = annotations.get(workspace.shop_id, experiment_id)
    assert [note.body for note in kept.notes] == ["Atlas acted before it read."]
    assert kept.tags == ("read-check-gap",)


# -- provenance ----------------------------------------------------------------


@pytest.mark.asyncio
async def test_a_derived_experiment_names_the_one_it_replays(
    session: Session, workspace: Workspace
) -> None:
    source = start(session, workspace, control_arm(session))
    await run_arm(session, source)

    derivations = build_derivations(session)
    derived = await derivations.replay(workspace.shop_id, source.record.experiment_id)

    assert derived.derived_from is not None
    assert derived.derived_from.experiment_id == source.record.experiment_id
    assert derived.derived_from.label == source.record.label
    assert derived.derived_from.kind is DerivationKind.REPLAY
    assert derived.record.label == "Wrong shipping address (replay)"


@pytest.mark.asyncio
async def test_a_replay_of_a_replay_names_the_run_it_was_derived_from(
    session: Session, workspace: Workspace
) -> None:
    """The chain is a chain of derivations, never a claim about the first one."""
    source = start(session, workspace, control_arm(session))
    await run_arm(session, source)
    first = await build_derivations(session).replay(workspace.shop_id, source.record.experiment_id)

    second = await build_derivations(session).replay(workspace.shop_id, first.record.experiment_id)

    assert second.derived_from is not None
    assert second.derived_from.experiment_id == first.record.experiment_id
    assert second.record.sandbox_fingerprint == source.record.sandbox_fingerprint


@pytest.mark.asyncio
async def test_replaying_one_run_twice_is_two_derived_experiments(
    session: Session, workspace: Workspace
) -> None:
    source = start(session, workspace, control_arm(session))
    await run_arm(session, source)
    replays = build_derivations(session)

    first = await replays.replay(workspace.shop_id, source.record.experiment_id)
    second = await replays.replay(workspace.shop_id, source.record.experiment_id)

    assert first.record.experiment_id != second.record.experiment_id
    assert first.record.resolution_fingerprint == second.record.resolution_fingerprint


@pytest.mark.asyncio
async def test_a_replay_is_in_the_shop_listing_the_source_is_in(
    session: Session, workspace: Workspace
) -> None:
    """A derived run nobody can find again is not a derived run (ADR 0034)."""
    source = start(session, workspace, control_arm(session))
    await run_arm(session, source)

    derivations = build_derivations(session)
    derived = await derivations.replay(workspace.shop_id, source.record.experiment_id)

    listed = build_experiments(session).list_experiments(workspace.shop_id)
    assert {record.experiment_id for record in listed} == {
        source.record.experiment_id,
        derived.record.experiment_id,
    }


@pytest.mark.asyncio
async def test_an_experiment_of_another_shop_cannot_be_replayed(
    session: Session, workspace: Workspace
) -> None:
    source = start(session, workspace, control_arm(session))

    with pytest.raises(ExperimentNotFoundError):
        await build_derivations(session).replay(uuid4(), source.record.experiment_id)


@pytest.mark.asyncio
async def test_a_replay_is_refused_when_this_build_no_longer_publishes_the_frozen_tool_set(
    session: Session, workspace: Workspace, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The one pair of fingerprints that could disagree, refused where only reuse can make it.

    A snapshot's fingerprint covers the tool contract set it was frozen against (ADR 0021),
    and reusing it does not re-fingerprint anything — while the experiment envelope beside it
    records what this build publishes and the runtime runs this build's handlers. So a lab
    upgraded past the recorded contract set has to refuse the reuse rather than write a run
    whose two fingerprints name two different tool sets."""
    source = start(session, workspace, control_arm(session))
    await run_arm(session, source)
    upgraded = {**SANDBOX_TOOL_CONTRACT_VERSIONS, ADDRESS_CHANGE_APPLY: "v2"}
    monkeypatch.setattr(experiments_module, "SANDBOX_TOOL_CONTRACT_VERSIONS", upgraded)

    with pytest.raises(ExperimentConfigurationError, match="no longer publishes"):
        await build_derivations(session).replay(workspace.shop_id, source.record.experiment_id)


def test_a_snapshot_of_another_recipe_cannot_be_the_starting_state_of_a_start(
    session: Session, workspace: Workspace
) -> None:
    """The guard behind the reuse: the columns an experiment carries have to describe it."""
    source = start(session, workspace, control_arm(session))
    other = build_snapshots(session).materialize(
        workspace.shop_id,
        source.record.scenario_id,
        source.record.scenario_version,
        seed=SEED + 1,
    )

    with pytest.raises(ExperimentConfigurationError, match="does not freeze scenario"):
        build_experiments(session).start(
            workspace.shop_id,
            StartExperiment(
                label="Mismatched",
                scenario_id=source.record.scenario_id,
                scenario_version=source.record.scenario_version,
                seed=SEED,
                arms=(control_arm(session),),
            ),
            starting_state=other.snapshot_id,
        )
