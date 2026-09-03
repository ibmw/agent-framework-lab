"""Advancing one arm: what the agent answered, what it called, what it moved, where it
now stands, and what it cost (ADR 0026, ADR 0028, ADR 0029, ADR 0032)."""

from collections.abc import Generator, Mapping
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from pathlib import Path
from uuid import uuid4

import pytest
from sqlalchemy.orm import Session

from agent_factories import READ_TOOL_NAMES, model_settings
from capability_lab.application.agent_capabilities import (
    FAKE_FRAMEWORK_ID,
    PYDANTIC_AI_FRAMEWORK_ID,
)
from capability_lab.application.agent_runtime import (
    AgentAnswer,
    AgentTurnRequest,
    SandboxToolInvoker,
    SupportAgentProviderError,
    SupportAgentRuntime,
    SupportAgentRuntimeRegistry,
    SupportAgentUnavailableError,
)
from capability_lab.application.canonical_json import CanonicalValue
from capability_lab.application.experiment_runs import RunTurn
from capability_lab.application.experiments import (
    ArmSelection,
    ExperimentDetail,
    ExperimentNotFoundError,
    ExperimentRunNotFoundError,
    StartExperiment,
)
from capability_lab.application.model_cost import ModelUsage
from capability_lab.application.ports import Clock
from capability_lab.application.run_metrics import ArmMetrics
from capability_lab.application.sandbox_tool_contracts import (
    ADDRESS_CHANGE_APPLY,
    ADDRESS_CHANGE_PROPOSE,
    CUSTOMER_PROFILE,
    INTERACTION_CONTEXT,
    ORDER_DETAIL,
)
from capability_lab.application.sandbox_tools import ToolOutcome
from capability_lab.application.sandboxes import SandboxNotFoundError
from capability_lab.domain.agent_configuration import MemoryMode, ModelSettings
from capability_lab.domain.agent_turn import AgentTurnFailure, AgentTurnOutcome
from capability_lab.domain.blocks import MutationEffect
from capability_lab.domain.experiment import ArmAwaiting
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
    build_runner,
    build_sandboxes,
    publish_prerequisites,
    published_configuration,
    published_identity,
    seed_workspace,
)

WRITE_TOOL_NAMES = (ADDRESS_CHANGE_APPLY, ADDRESS_CHANGE_PROPOSE)


def mutation(
    workspace: Workspace,
    mutation_id: str = "order-moves-under-the-arm",
    timing: str = "after_first_read",
) -> BoundMutation:
    """The frame-4 fault, bound to this workspace's order at the moment a test needs."""
    return BoundMutation(
        id=mutation_id,
        block_id=workspace.mutation_block_id,
        bindings=(
            ScenarioBinding(parameter="entity_ref", value=f"order:{workspace.order_id}"),
            ScenarioBinding(parameter="timing", value=timing),
        ),
    )


@pytest.fixture
def session(tmp_path: Path) -> Generator[Session, None, None]:
    engine = create_database_engine(f"sqlite:///{tmp_path / 'runs.db'}")
    Base.metadata.create_all(engine)
    with session_scope(create_session_factory(engine)) as active:
        yield active


@pytest.fixture
def workspace(session: Session) -> Workspace:
    return seed_workspace(session)


def control_model(**overrides: object) -> ModelSettings:
    """The only provider and model the deterministic control arm is proven with."""
    return model_settings(provider="fake", model_id="deterministic", **overrides)


def control_arm(session: Session, **overrides: object) -> ArmSelection:
    """One published configuration the offline control runtime can actually run."""
    fields: dict[str, object] = {
        "framework_id": FAKE_FRAMEWORK_ID,
        "model": control_model(),
        "tools": (*READ_TOOL_NAMES, *WRITE_TOOL_NAMES),
    }
    fields.update(overrides)
    return published_configuration(session, published_identity(session), **fields)


def start(
    session: Session,
    workspace: Workspace,
    *arms: ArmSelection,
    mutations: tuple[BoundMutation, ...] = (),
) -> ExperimentDetail:
    publish_prerequisites(workspace)
    scenario_id = author(workspace, mutations=mutations)
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


async def advance(
    session: Session,
    detail: ExperimentDetail,
    position: int = 0,
    runtimes: SupportAgentRuntimeRegistry | None = None,
    clock: Clock | None = None,
) -> RunTurn:
    run = detail.runs[position]
    return await build_runner(session, runtimes, clock=clock).advance(
        run.shop_id, run.experiment_id, run.run_id
    )


def calls(produced: RunTurn) -> list[str]:
    return [event.event.tool for event in produced.tool_events]


def fired(produced: RunTurn) -> list[str]:
    return [event.event.mutation_id for event in produced.mutation_events]


def revision(session: Session, detail: ExperimentDetail, position: int = 0) -> int:
    run = detail.runs[position]
    return build_sandboxes(session).get_sandbox(run.shop_id, run.sandbox_id).revision


# -- the turn ------------------------------------------------------------------


@pytest.mark.asyncio
async def test_an_arm_answers_the_trigger_it_opened_on(
    session: Session, workspace: Workspace
) -> None:
    """The first advance answers turn zero: the question the ticket froze."""
    detail = start(session, workspace, control_arm(session))

    produced = await advance(session, detail)

    assert produced.turn.turn.ordinal == 0
    assert produced.turn.turn.attempt == 1
    assert produced.turn.turn.outcome is AgentTurnOutcome.ANSWERED
    assert "NS-10482" in produced.turn.turn.body


@pytest.mark.asyncio
async def test_every_tool_the_agent_called_is_recorded_in_the_order_it_asked(
    session: Session, workspace: Workspace
) -> None:
    detail = start(session, workspace, control_arm(session))

    produced = await advance(session, detail)

    assert calls(produced) == [
        INTERACTION_CONTEXT,
        ORDER_DETAIL,
        CUSTOMER_PROFILE,
        ADDRESS_CHANGE_PROPOSE,
        ADDRESS_CHANGE_APPLY,
    ]
    assert [event.event.sequence for event in produced.tool_events] == [0, 1, 2, 3, 4]
    assert {event.event.version for event in produced.tool_events} == {"v1"}
    assert {event.event.outcome for event in produced.tool_events} == {ToolOutcome.SUCCESS}


@pytest.mark.asyncio
async def test_the_write_moves_the_arm_and_the_event_says_so(
    session: Session, workspace: Workspace
) -> None:
    """A read leaves the revisions equal; the one write this milestone publishes moves it."""
    detail = start(session, workspace, control_arm(session))

    produced = await advance(session, detail)

    moved = [event for event in produced.tool_events if event.event.moved_the_arm]
    assert [event.event.tool for event in moved] == [ADDRESS_CHANGE_APPLY]
    applied = moved[0].event
    assert applied.revision_after == applied.revision_before + 1
    arm = build_sandboxes(session).get_sandbox(detail.runs[0].shop_id, detail.runs[0].sandbox_id)
    assert arm.state_fingerprint == applied.state_fingerprint


@pytest.mark.asyncio
async def test_the_confirmation_travels_inside_the_recorded_result(
    session: Session, workspace: Workspace
) -> None:
    """No separate confirmation record: the proposal named the change and the apply used it."""
    detail = start(session, workspace, control_arm(session))

    produced = await advance(session, detail)

    proposed, applied = (
        _document(produced, ADDRESS_CHANGE_PROPOSE),
        _document(produced, ADDRESS_CHANGE_APPLY),
    )
    assert proposed["applied"] is False
    assert applied["applied"] is True
    assert applied["confirmation"] == proposed["confirmation"]


@pytest.mark.asyncio
async def test_an_arm_moves_alone(session: Session, workspace: Workspace) -> None:
    """The acceptance criterion: an action in one arm cannot alter the other."""
    detail = start(session, workspace, control_arm(session), control_arm(session))

    await advance(session, detail, position=0)

    sandboxes = build_sandboxes(session)
    moved = sandboxes.get_sandbox(detail.runs[0].shop_id, detail.runs[0].sandbox_id)
    untouched = sandboxes.get_sandbox(detail.runs[1].shop_id, detail.runs[1].sandbox_id)

    assert moved.revision > untouched.revision
    assert moved.state_fingerprint != untouched.state_fingerprint
    # Where they started still agrees, and always will.
    assert moved.snapshot_fingerprint == untouched.snapshot_fingerprint


# -- what the configuration decides --------------------------------------------


@pytest.mark.asyncio
async def test_an_arm_is_offered_only_the_tools_its_configuration_enables(
    session: Session, workspace: Workspace
) -> None:
    """The tool dimension is a real comparison variable: fewer tools, different behavior."""
    reader = control_arm(session, tools=READ_TOOL_NAMES)
    detail = start(session, workspace, reader)

    produced = await advance(session, detail)

    assert ADDRESS_CHANGE_PROPOSE not in calls(produced)
    assert ADDRESS_CHANGE_APPLY not in calls(produced)
    arm = build_sandboxes(session).get_sandbox(detail.runs[0].shop_id, detail.runs[0].sandbox_id)
    assert arm.revision == 0


@pytest.mark.asyncio
async def test_a_tool_the_arm_was_never_offered_is_the_lab_s_mistake(
    session: Session, workspace: Workspace
) -> None:
    """Not a refusal: a runtime is handed the tools it may offer (ADR 0021)."""
    detail = start(session, workspace, control_arm(session, tools=READ_TOOL_NAMES))

    produced = await advance(
        session, detail, runtimes=_registry(_CallingRuntime(ADDRESS_CHANGE_APPLY))
    )

    assert produced.turn.turn.outcome is AgentTurnOutcome.FAILED
    assert produced.turn.turn.failure is AgentTurnFailure.FRAMEWORK
    assert produced.tool_events == ()


@pytest.mark.asyncio
async def test_the_tool_budget_is_the_configuration_s_and_ends_the_attempt(
    session: Session, workspace: Workspace
) -> None:
    detail = start(
        session,
        workspace,
        control_arm(session, model=control_model(max_tool_rounds=2)),
    )

    produced = await advance(
        session, detail, runtimes=_registry(_CallingRuntime(INTERACTION_CONTEXT, times=5))
    )

    assert produced.turn.turn.failure is AgentTurnFailure.TOOL_ROUND_LIMIT
    # What it spent before the limit is kept: the calls are the informative half of a failure.
    assert len(produced.tool_events) == 2


@pytest.mark.asyncio
async def test_the_prompt_is_rendered_against_the_versions_the_experiment_pinned(
    session: Session, workspace: Workspace
) -> None:
    """A run is explained by what it froze, so a later publication cannot change it."""
    detail = start(session, workspace, control_arm(session))
    recording = _RecordingRuntime()

    await advance(session, detail, runtimes=_registry(recording))

    instructions = recording.seen.instructions
    assert "{{" not in instructions
    assert "Northstar" in instructions
    assert "Customer support representative" in instructions


@pytest.mark.asyncio
async def test_a_configuration_without_memory_shows_the_agent_no_thread(
    session: Session, workspace: Workspace
) -> None:
    """Memory is a comparison variable, so two arms differing in it must actually differ."""
    detail = start(session, workspace, control_arm(session, memory=MemoryMode.NONE))
    await advance(session, detail)
    _say(session, detail, "Yes, the Lyon address please.")
    recording = _RecordingRuntime()

    await advance(session, detail, runtimes=_registry(recording))

    assert recording.seen.history == ()
    assert recording.seen.message == "Yes, the Lyon address please."


@pytest.mark.asyncio
async def test_a_remembering_configuration_shows_the_agent_what_was_said(
    session: Session, workspace: Workspace
) -> None:
    detail = start(session, workspace, control_arm(session))
    first = await advance(session, detail)
    _say(session, detail, "Yes, the Lyon address please.")
    recording = _RecordingRuntime()

    await advance(session, detail, runtimes=_registry(recording))

    assert [message.role.value for message in recording.seen.history] == ["customer", "agent"]
    assert recording.seen.history[1].body == first.turn.turn.body


# -- attempts ------------------------------------------------------------------


@pytest.mark.asyncio
async def test_advancing_an_answered_arm_returns_its_answer_and_calls_nothing(
    session: Session, workspace: Workspace
) -> None:
    detail = start(session, workspace, control_arm(session))
    first = await advance(session, detail)

    again = await advance(session, detail, runtimes=_registry(_FailingRuntime()))

    assert again.turn.turn.body == first.turn.turn.body
    assert again.turn.turn.attempt == 1
    assert calls(again) == calls(first)


@pytest.mark.asyncio
async def test_a_failed_attempt_is_kept_and_the_retry_sits_beside_it(
    session: Session, workspace: Workspace
) -> None:
    """A failure is evidence, so retrying grows the record instead of overwriting it."""
    detail = start(session, workspace, control_arm(session))

    failed = await advance(session, detail, runtimes=_registry(_FailingRuntime()))
    retried = await advance(session, detail)

    assert failed.turn.turn.outcome is AgentTurnOutcome.FAILED
    assert failed.turn.turn.failure is AgentTurnFailure.MODEL_PROVIDER
    assert failed.turn.turn.attempt == 1
    assert retried.turn.turn.outcome is AgentTurnOutcome.ANSWERED
    assert retried.turn.turn.attempt == 2

    recorded = build_experiments(session).get_experiment(
        detail.record.shop_id, detail.record.experiment_id
    )
    assert [turn.turn.attempt for turn in recorded.agent_turns] == [1, 2]


@pytest.mark.asyncio
async def test_a_model_that_says_nothing_is_an_unrecordable_answer(
    session: Session, workspace: Workspace
) -> None:
    detail = start(session, workspace, control_arm(session))

    produced = await advance(session, detail, runtimes=_registry(_SilentRuntime()))

    assert produced.turn.turn.failure is AgentTurnFailure.INVALID_RESPONSE


@pytest.mark.asyncio
async def test_an_unclassified_framework_error_is_the_lab_s_own(
    session: Session, workspace: Workspace
) -> None:
    detail = start(session, workspace, control_arm(session))

    produced = await advance(session, detail, runtimes=_registry(_BrokenRuntime()))

    assert produced.turn.turn.failure is AgentTurnFailure.FRAMEWORK


@pytest.mark.asyncio
async def test_a_broken_arm_is_an_error_rather_than_a_failed_turn(
    session: Session, workspace: Workspace
) -> None:
    """A world that no longer resolves is the lab breaking, never this framework's behavior."""
    detail = start(session, workspace, control_arm(session))

    with pytest.raises(SandboxNotFoundError):
        await advance(session, detail, runtimes=_registry(_LostArmRuntime()))

    recorded = build_experiments(session).get_experiment(
        detail.record.shop_id, detail.record.experiment_id
    )
    assert recorded.agent_turns == ()


@pytest.mark.asyncio
async def test_a_framework_this_lab_cannot_run_records_nothing(
    session: Session, workspace: Workspace
) -> None:
    """A missing provider key is a fact about the machine, never a turn the agent took."""
    detail = start(session, workspace, published_configuration(session))

    with pytest.raises(SupportAgentUnavailableError, match=PYDANTIC_AI_FRAMEWORK_ID):
        await advance(session, detail)

    recorded = build_experiments(session).get_experiment(
        detail.record.shop_id, detail.record.experiment_id
    )
    assert recorded.agent_turns == ()


# -- the thread ----------------------------------------------------------------


@pytest.mark.asyncio
async def test_the_next_advance_answers_the_next_customer_turn(
    session: Session, workspace: Workspace
) -> None:
    detail = start(session, workspace, control_arm(session))
    await advance(session, detail)
    _say(session, detail, "Yes, the Lyon address please.")

    produced = await advance(session, detail)

    assert produced.turn.turn.ordinal == 1
    assert produced.turn.turn.attempt == 1


@pytest.mark.asyncio
async def test_an_arm_answers_the_conversation_as_it_now_stands(
    session: Session, workspace: Workspace
) -> None:
    """Two customer turns and no reply between them: the arm answers the later one.

    A reply to the older question would be a reply the customer has already moved on from.
    The earlier turn stays in the history, unanswered, which is what happened.
    """
    detail = start(session, workspace, control_arm(session))
    _say(session, detail, "Yes, the Lyon address please.")
    recording = _RecordingRuntime()

    produced = await advance(session, detail, runtimes=_registry(recording))

    assert produced.turn.turn.ordinal == 1
    assert [message.role.value for message in recording.seen.history] == ["customer"]
    recorded = build_experiments(session).get_experiment(
        detail.record.shop_id, detail.record.experiment_id
    )
    assert [turn.turn.ordinal for turn in recorded.agent_turns] == [1]


@pytest.mark.asyncio
async def test_the_experiment_reads_back_both_sides_of_both_threads(
    session: Session, workspace: Workspace
) -> None:
    detail = start(session, workspace, control_arm(session), control_arm(session))
    await advance(session, detail, position=0)
    await advance(session, detail, position=1)

    recorded = build_experiments(session).get_experiment(
        detail.record.shop_id, detail.record.experiment_id
    )

    assert len(recorded.turns) == 2
    assert len(recorded.agent_turns) == 2
    assert {turn.run_id for turn in recorded.agent_turns} == {run.run_id for run in recorded.runs}
    assert len(recorded.tool_events) == 10


@pytest.mark.asyncio
async def test_an_arm_of_another_experiment_is_not_this_one_s(
    session: Session, workspace: Workspace
) -> None:
    detail = start(session, workspace, control_arm(session))
    run = detail.runs[0]

    with pytest.raises(ExperimentRunNotFoundError):
        await build_runner(session).advance(run.shop_id, run.experiment_id, uuid4())


@pytest.mark.asyncio
async def test_an_experiment_of_another_shop_is_not_advanced(
    session: Session, workspace: Workspace
) -> None:
    detail = start(session, workspace, control_arm(session))
    run = detail.runs[0]

    with pytest.raises(ExperimentNotFoundError):
        await build_runner(session).advance(uuid4(), run.experiment_id, run.run_id)


# -- resume --------------------------------------------------------------------


@contextmanager
def reopened(tmp_path: Path) -> Generator[Session, None, None]:
    """A second session on the same database, as a process that was restarted sees it.

    Resume has no mechanism of its own: an experiment is entirely in the record, so picking
    one up is an ordinary read. What this proves is that claim — nothing an arm needs in
    order to keep going was held by the session that ran it.
    """
    engine = create_database_engine(f"sqlite:///{tmp_path / 'runs.db'}")
    with session_scope(create_session_factory(engine)) as fresh:
        yield fresh


def standings(
    detail: ExperimentDetail,
) -> dict[str, tuple[ArmAwaiting, int, int, tuple[int, ...]]]:
    return {
        run.label: (
            standing.awaiting,
            standing.ordinal,
            standing.attempts,
            standing.unanswered,
        )
        for run, standing in zip(detail.runs, detail.standings, strict=True)
    }


@pytest.mark.asyncio
async def test_an_opened_arm_waits_for_its_agent_and_an_answered_one_for_the_customer(
    session: Session, workspace: Workspace
) -> None:
    detail = start(session, workspace, control_arm(session), control_arm(session))
    assert standings(detail) == {
        "Arm A": (ArmAwaiting.AGENT, 0, 0, ()),
        "Arm B": (ArmAwaiting.AGENT, 0, 0, ()),
    }

    await advance(session, detail, position=0)

    assert standings(
        build_experiments(session).get_experiment(
            detail.record.shop_id, detail.record.experiment_id
        )
    ) == {
        "Arm A": (ArmAwaiting.CUSTOMER, 0, 1, ()),
        "Arm B": (ArmAwaiting.AGENT, 0, 0, ()),
    }


@pytest.mark.asyncio
async def test_an_arm_whose_attempt_failed_still_owes_an_answer_and_counts_the_attempt(
    session: Session, workspace: Workspace
) -> None:
    """The retry the bench offers is this standing, not a second reading of the same rows."""
    detail = start(session, workspace, control_arm(session))

    await advance(session, detail, runtimes=_registry(_FailingRuntime()))

    recorded = build_experiments(session).get_experiment(
        detail.record.shop_id, detail.record.experiment_id
    )
    assert standings(recorded) == {"Arm A": (ArmAwaiting.AGENT, 0, 1, ())}


@pytest.mark.asyncio
async def test_a_turn_the_arm_passed_over_is_reported_where_an_operator_reads_it(
    session: Session, workspace: Workspace
) -> None:
    """A skipped question is deliberate (ADR 0026), so the standing says it happened."""
    detail = start(session, workspace, control_arm(session))
    _say(session, detail, "Yes, the Lyon address please.")

    await advance(session, detail)

    recorded = build_experiments(session).get_experiment(
        detail.record.shop_id, detail.record.experiment_id
    )
    assert standings(recorded) == {"Arm A": (ArmAwaiting.CUSTOMER, 1, 1, (0,))}


@pytest.mark.asyncio
async def test_an_experiment_left_mid_incident_is_picked_up_from_the_record_alone(
    session: Session, workspace: Workspace, tmp_path: Path
) -> None:
    """One arm answered, one never run, then the process goes away.

    What comes back is both threads as they stood and one arm still owing an answer — and
    advancing it in the new process answers the turn it was left on rather than starting over.
    """
    detail = start(session, workspace, control_arm(session), control_arm(session))
    await advance(session, detail, position=0)
    session.commit()

    with reopened(tmp_path) as fresh:
        resumed = build_experiments(fresh).get_experiment(
            detail.record.shop_id, detail.record.experiment_id
        )
        assert standings(resumed) == {
            "Arm A": (ArmAwaiting.CUSTOMER, 0, 1, ()),
            "Arm B": (ArmAwaiting.AGENT, 0, 0, ()),
        }
        assert [turn.turn.ordinal for turn in resumed.turns] == [0, 0]
        assert len(resumed.tool_events) == 5

        produced = await advance(fresh, resumed, position=1)

        assert produced.turn.turn.ordinal == 0
        assert produced.turn.turn.attempt == 1
        assert produced.turn.turn.outcome is AgentTurnOutcome.ANSWERED


@pytest.mark.asyncio
async def test_a_failed_attempt_is_retried_rather_than_repeated_after_a_restart(
    session: Session, workspace: Workspace, tmp_path: Path
) -> None:
    """The attempt counter is in the record, so the retry keeps the failure beside it."""
    detail = start(session, workspace, control_arm(session))
    await advance(session, detail, runtimes=_registry(_FailingRuntime()))
    session.commit()

    with reopened(tmp_path) as fresh:
        resumed = build_experiments(fresh).get_experiment(
            detail.record.shop_id, detail.record.experiment_id
        )
        assert standings(resumed) == {"Arm A": (ArmAwaiting.AGENT, 0, 1, ())}

        produced = await advance(fresh, resumed)

        assert produced.turn.turn.attempt == 2
        assert produced.turn.turn.outcome is AgentTurnOutcome.ANSWERED


# -- the scenario's faults -----------------------------------------------------


@pytest.mark.asyncio
async def test_a_read_bound_fault_fires_between_the_calls_that_made_it_due(
    session: Session, workspace: Workspace
) -> None:
    """The moment arrives inside the attempt, which is the whole point of firing on the path."""
    detail = start(session, workspace, control_arm(session), mutations=(mutation(workspace),))

    produced = await advance(session, detail)

    assert fired(produced) == ["order-moves-under-the-arm"]
    event = produced.mutation_events[0].event
    assert event.effect is MutationEffect.ENTITY_MUTATION
    assert event.timing == "after_first_read"
    assert event.target == f"order:{workspace.order_id}"
    assert event.ordinal == 0
    assert event.attempt == 1
    # Two calls had been made: the interaction context, then the read of the bound order.
    assert event.after_calls == 2
    assert calls(produced)[event.after_calls - 1] == ORDER_DETAIL
    assert event.revision_after == event.revision_before + 1
    assert event.moved_the_arm


@pytest.mark.asyncio
async def test_a_fault_moves_the_arm_it_fired_into_and_no_other(
    session: Session, workspace: Workspace
) -> None:
    """The isolation an experiment rests on holds for the scenario's own writes too."""
    detail = start(
        session,
        workspace,
        control_arm(session),
        control_arm(session),
        mutations=(mutation(workspace),),
    )

    await advance(session, detail)

    recorded = build_experiments(session).get_experiment(
        detail.record.shop_id, detail.record.experiment_id
    )
    assert [event.run_id for event in recorded.mutation_events] == [detail.runs[0].run_id]
    assert revision(session, detail, 1) == 0


@pytest.mark.asyncio
async def test_both_arms_meet_the_same_fault_in_their_own_world(
    session: Session, workspace: Workspace
) -> None:
    """One schedule, two arms: the fault is not a comparison variable, meeting it is."""
    detail = start(
        session,
        workspace,
        control_arm(session),
        control_arm(session),
        mutations=(mutation(workspace),),
    )

    await advance(session, detail, position=0)
    await advance(session, detail, position=1)

    recorded = build_experiments(session).get_experiment(
        detail.record.shop_id, detail.record.experiment_id
    )
    assert [event.event.mutation_id for event in recorded.mutation_events] == [
        "order-moves-under-the-arm",
        "order-moves-under-the-arm",
    ]
    assert {event.run_id for event in recorded.mutation_events} == {
        run.run_id for run in detail.runs
    }
    assert {event.event.revision_before for event in recorded.mutation_events} == {0}


@pytest.mark.asyncio
async def test_a_fault_happens_to_an_arm_once_however_often_it_advances(
    session: Session, workspace: Workspace
) -> None:
    """A world a fault has already happened to is a different world."""
    detail = start(session, workspace, control_arm(session), mutations=(mutation(workspace),))
    await advance(session, detail)

    _say(session, detail, "Any news on the address?")
    again = await advance(session, detail)

    assert fired(again) == []
    assert len(build_runner(session).list_mutation_events(detail.record.experiment_id)) == 1


@pytest.mark.asyncio
async def test_a_turn_bound_fault_fires_before_the_agent_asks_anything(
    session: Session, workspace: Workspace
) -> None:
    """The agent opens its eyes on the world the fault left, not one call later."""
    detail = start(
        session,
        workspace,
        control_arm(session),
        mutations=(mutation(workspace, timing="at_turn:1"),),
    )
    first = await advance(session, detail)
    assert fired(first) == []

    _say(session, detail, "Has it shipped yet?")
    answered = await advance(session, detail)

    assert fired(answered) == ["order-moves-under-the-arm"]
    event = answered.mutation_events[0].event
    assert event.ordinal == 1
    assert event.after_calls == 0


@pytest.mark.asyncio
async def test_a_fault_that_fired_into_a_failed_attempt_stays_fired(
    session: Session, workspace: Workspace
) -> None:
    """The world moved; that the attempt then broke is a fact about the agent, not the world."""
    detail = start(
        session,
        workspace,
        control_arm(session),
        mutations=(mutation(workspace, timing="at_turn:1"),),
    )
    await advance(session, detail)
    _say(session, detail, "Has it shipped yet?")

    failed = await advance(session, detail, runtimes=_registry(_FailingRuntime()))
    retried = await advance(session, detail)

    assert failed.turn.turn.outcome is AgentTurnOutcome.FAILED
    assert fired(failed) == ["order-moves-under-the-arm"]
    assert failed.mutation_events[0].event.attempt == 1
    assert fired(retried) == []


@pytest.mark.asyncio
async def test_a_fault_whose_world_has_moved_past_it_records_nothing(
    session: Session, workspace: Workspace
) -> None:
    """Three faults on one order: two steps exhaust the graph, and the third is not a firing."""
    detail = start(
        session,
        workspace,
        control_arm(session),
        mutations=(
            mutation(workspace, mutation_id="first-fault"),
            mutation(workspace, mutation_id="second-fault"),
            mutation(workspace, mutation_id="third-fault"),
        ),
    )

    produced = await advance(session, detail)

    assert fired(produced) == ["first-fault", "second-fault"]
    assert revision(session, detail) == 2
    # And the redirect the agent computed is now genuinely too late, which is the escalation
    # the graph carries rather than anything the fault decided.
    refused = [
        event.event.tool
        for event in produced.tool_events
        if event.event.outcome is ToolOutcome.REFUSED
    ]
    assert ADDRESS_CHANGE_PROPOSE in refused


@pytest.mark.asyncio
async def test_a_recipe_with_no_fault_fires_none(session: Session, workspace: Workspace) -> None:
    detail = start(session, workspace, control_arm(session))

    produced = await advance(session, detail)

    assert fired(produced) == []
    assert revision(session, detail) == 1


@pytest.mark.asyncio
async def test_a_fault_is_the_scenario_s_time_and_never_charged_to_the_call_before_it(
    session: Session, workspace: Workspace
) -> None:
    """A tool call stops being measured before the schedule is asked (ADR 0028, ADR 0032).

    The clock ticks once per read, so a call measured over exactly two reads is 1000ms — and
    a firing reads the clock itself. Every call reading the same duration is therefore the
    proof that the fault's work happened outside the measurement, rather than making the arm
    it interfered with look slower.
    """
    detail = start(session, workspace, control_arm(session), mutations=(mutation(workspace),))

    produced = await advance(session, detail)

    assert fired(produced) == ["order-moves-under-the-arm"]
    assert {event.event.duration_ms for event in produced.tool_events} == {1000}


# -- what the run cost ---------------------------------------------------------


def metrics(session: Session, detail: ExperimentDetail, position: int = 0) -> ArmMetrics:
    """One arm's reading of its own record, taken through the experiment the bench reads."""
    read = build_experiments(session).get_experiment(
        detail.record.shop_id, detail.record.experiment_id
    )
    return read.metrics[position]


@pytest.mark.asyncio
async def test_an_attempt_records_how_long_it_took(session: Session, workspace: Workspace) -> None:
    """The whole attempt, model and tool calls together: what the operator waited for."""
    detail = start(session, workspace, control_arm(session))

    produced = await advance(session, detail)

    assert produced.turn.duration_ms is not None
    assert produced.turn.duration_ms > 0


@pytest.mark.asyncio
async def test_a_clock_that_steps_backwards_costs_the_measurement_not_the_total(
    session: Session, workspace: Workspace
) -> None:
    """An operational clock can be stepped back under a running process (ADR 0032).

    A negative duration would subtract from a total a comparison reads, so an elapsed
    reading is clamped at zero: the measurement is lost, and nothing else is.
    """
    detail = start(session, workspace, control_arm(session))

    produced = await advance(session, detail, clock=_RetreatingClock())

    assert produced.turn.duration_ms == 0
    assert all(event.event.duration_ms == 0 for event in produced.tool_events)


@pytest.mark.asyncio
async def test_every_tool_call_carries_its_own_duration(
    session: Session, workspace: Workspace
) -> None:
    """On the call rather than only on the attempt, so time at the world is separable."""
    detail = start(session, workspace, control_arm(session))

    produced = await advance(session, detail)

    assert produced.tool_events
    assert all(event.event.duration_ms is not None for event in produced.tool_events)


@pytest.mark.asyncio
async def test_the_control_arm_reports_calling_no_model_rather_than_nothing(
    session: Session, workspace: Workspace
) -> None:
    """Zeros are a measurement: this arm calls no provider, and that is knowable."""
    detail = start(session, workspace, control_arm(session))

    produced = await advance(session, detail)

    assert produced.turn.usage == ModelUsage.none()
    assert metrics(session, detail).estimated_cost is not None


@pytest.mark.asyncio
async def test_a_framework_that_does_not_meter_itself_records_no_usage(
    session: Session, workspace: Workspace
) -> None:
    """`None` and zeros are different answers, and neither is invented for the other."""
    detail = start(session, workspace, control_arm(session))

    produced = await advance(session, detail, runtimes=_registry(_RecordingRuntime()))

    assert produced.turn.usage is None
    reading = metrics(session, detail)
    assert reading.usage is None
    assert reading.model_requests is None
    assert reading.estimated_cost is None


@pytest.mark.asyncio
async def test_a_failed_attempt_is_timed_and_reports_nothing_it_spent(
    session: Session, workspace: Workspace
) -> None:
    """The tokens a broken attempt burned reach the lab only through an answer it never gave."""
    detail = start(session, workspace, control_arm(session))

    produced = await advance(session, detail, runtimes=_registry(_FailingRuntime()))

    assert produced.turn.duration_ms is not None
    assert produced.turn.usage is None


@pytest.mark.asyncio
async def test_a_metered_arm_reports_what_the_declared_rate_says_it_spent(
    session: Session, workspace: Workspace
) -> None:
    """The usage the framework reported, priced against the model the arm actually pinned."""
    detail = start(session, workspace, published_configuration(session))
    runtime = _MeteredRuntime(ModelUsage(input_tokens=1_000, output_tokens=200, model_requests=2))

    await advance(session, detail, runtimes=_registry(runtime))

    reading = metrics(session, detail)
    assert reading.usage == ModelUsage(input_tokens=1_000, output_tokens=200, model_requests=2)
    assert reading.model_requests == 2
    assert reading.estimated_cost is not None
    assert reading.estimated_cost.amount == Decimal("0.000650")


@pytest.mark.asyncio
async def test_an_arm_s_metrics_count_the_calls_it_made_and_the_writes_that_landed(
    session: Session, workspace: Workspace
) -> None:
    detail = start(session, workspace, control_arm(session))

    produced = await advance(session, detail)

    reading = metrics(session, detail)
    assert reading.turns == 1
    assert reading.answered_turns == 1
    assert reading.attempts == 1
    assert reading.retries == 0
    assert reading.failures == {}
    assert reading.tool_calls == len(produced.tool_events)
    assert reading.tool_writes == 1


@pytest.mark.asyncio
async def test_a_retry_is_counted_apart_from_the_failure_that_caused_it(
    session: Session, workspace: Workspace
) -> None:
    """One question, two attempts: one failure and one retry, never one number for both."""
    detail = start(session, workspace, control_arm(session))

    await advance(session, detail, runtimes=_registry(_FailingRuntime()))
    await advance(session, detail)

    reading = metrics(session, detail)
    assert reading.attempts == 2
    assert reading.retries == 1
    assert reading.failures == {AgentTurnFailure.MODEL_PROVIDER: 1}
    assert reading.answered_turns == 1
    assert reading.measured_attempts == 2
    # A failed attempt reports nothing it spent, so the tokens and the cost cover one of the
    # two attempts — and say so, rather than reading as the whole arm's.
    assert reading.metered_attempts == 1


@pytest.mark.asyncio
async def test_each_arm_is_counted_on_its_own_record(
    session: Session, workspace: Workspace
) -> None:
    """The isolation the arms already have, read in the column that reports their cost."""
    detail = start(session, workspace, control_arm(session), control_arm(session))

    await advance(session, detail)

    assert metrics(session, detail, 0).attempts == 1
    assert metrics(session, detail, 1).attempts == 0
    assert metrics(session, detail, 1).tool_calls == 0
    assert metrics(session, detail, 1).duration_ms is None


# -- helpers -------------------------------------------------------------------


def _document(produced: RunTurn, tool: str) -> Mapping[str, CanonicalValue]:
    event = next(entry.event for entry in produced.tool_events if entry.event.tool == tool)
    data = event.document["data"]
    assert isinstance(data, dict)
    return data


def _say(session: Session, detail: ExperimentDetail, message: str) -> None:
    build_experiments(session).deliver_turn(
        detail.record.shop_id,
        detail.record.experiment_id,
        tuple(run.run_id for run in detail.runs),
        HumanParticipantDriver(message),
    )


def _registry(runtime: SupportAgentRuntime) -> SupportAgentRuntimeRegistry:
    return SupportAgentRuntimeRegistry({runtime.framework_id: runtime})


class _StubRuntime(SupportAgentRuntime):
    """A runtime standing in for the control arm, so the runner is what is under test."""

    usage: ModelUsage | None = None
    """What this stub claims the provider metered; `None` is a framework that cannot say."""

    @property
    def framework_id(self) -> str:
        return FAKE_FRAMEWORK_ID


class _RecordingRuntime(_StubRuntime):
    """Keeps the request it was given, which is what the runner resolved."""

    def __init__(self) -> None:
        self.requests: list[AgentTurnRequest] = []

    @property
    def seen(self) -> AgentTurnRequest:
        return self.requests[-1]

    async def answer(self, request: AgentTurnRequest, tools: SandboxToolInvoker) -> AgentAnswer:
        self.requests.append(request)
        return AgentAnswer(body="Noted.", usage=self.usage)


class _CallingRuntime(_StubRuntime):
    """Calls one named tool a fixed number of times, whatever it was offered."""

    def __init__(self, tool: str, times: int = 1) -> None:
        self._tool = tool
        self._times = times

    async def answer(self, request: AgentTurnRequest, tools: SandboxToolInvoker) -> AgentAnswer:
        for _ in range(self._times):
            tools.invoke(self._tool, {})
        return AgentAnswer(body="Done.", usage=self.usage)


class _FailingRuntime(_StubRuntime):
    async def answer(self, request: AgentTurnRequest, tools: SandboxToolInvoker) -> AgentAnswer:
        raise SupportAgentProviderError("the provider rejected the request")


class _SilentRuntime(_StubRuntime):
    async def answer(self, request: AgentTurnRequest, tools: SandboxToolInvoker) -> AgentAnswer:
        return AgentAnswer(body="   ")


class _BrokenRuntime(_StubRuntime):
    async def answer(self, request: AgentTurnRequest, tools: SandboxToolInvoker) -> AgentAnswer:
        raise ZeroDivisionError("an adapter bug nobody classified")


class _LostArmRuntime(_StubRuntime):
    """Stands in for a world that stopped resolving while the agent was reading it."""

    async def answer(self, request: AgentTurnRequest, tools: SandboxToolInvoker) -> AgentAnswer:
        raise SandboxNotFoundError("this arm is not in this shop")


class _RetreatingClock:
    """A wall clock stepped backwards between reads, which NTP can genuinely do."""

    def __init__(self) -> None:
        self._value = datetime(2026, 9, 1, 12, 0, tzinfo=UTC)

    def now(self) -> datetime:
        self._value -= timedelta(seconds=1)
        return self._value


class _MeteredRuntime(_StubRuntime):
    """A framework that reports what the provider metered, standing in for a real one.

    Names itself `pydantic-ai` because a priced model belongs to a proven provider, and the
    fake framework is only proven with the free control model — an arm cannot be published
    with a framework and a provider the catalog never paired (ADR 0024).
    """

    def __init__(self, usage: ModelUsage) -> None:
        self.usage = usage

    @property
    def framework_id(self) -> str:
        return PYDANTIC_AI_FRAMEWORK_ID

    async def answer(self, request: AgentTurnRequest, tools: SandboxToolInvoker) -> AgentAnswer:
        return AgentAnswer(body="Noted.", usage=self.usage)
