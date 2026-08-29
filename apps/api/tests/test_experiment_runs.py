"""Advancing one arm: what the agent answered, what it called, and what it moved (ADR 0026)."""

from collections.abc import Generator, Mapping
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


def start(session: Session, workspace: Workspace, *arms: ArmSelection) -> ExperimentDetail:
    publish_prerequisites(workspace)
    scenario_id = author(workspace)
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
) -> RunTurn:
    run = detail.runs[position]
    return await build_runner(session, runtimes).advance(run.shop_id, run.experiment_id, run.run_id)


def calls(produced: RunTurn) -> list[str]:
    return [event.event.tool for event in produced.tool_events]


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

    async def answer(self, request: AgentTurnRequest, tools: SandboxToolInvoker) -> str:
        self.requests.append(request)
        return "Noted."


class _CallingRuntime(_StubRuntime):
    """Calls one named tool a fixed number of times, whatever it was offered."""

    def __init__(self, tool: str, times: int = 1) -> None:
        self._tool = tool
        self._times = times

    async def answer(self, request: AgentTurnRequest, tools: SandboxToolInvoker) -> str:
        for _ in range(self._times):
            tools.invoke(self._tool, {})
        return "Done."


class _FailingRuntime(_StubRuntime):
    async def answer(self, request: AgentTurnRequest, tools: SandboxToolInvoker) -> str:
        raise SupportAgentProviderError("the provider rejected the request")


class _SilentRuntime(_StubRuntime):
    async def answer(self, request: AgentTurnRequest, tools: SandboxToolInvoker) -> str:
        return "   "


class _BrokenRuntime(_StubRuntime):
    async def answer(self, request: AgentTurnRequest, tools: SandboxToolInvoker) -> str:
        raise ZeroDivisionError("an adapter bug nobody classified")


class _LostArmRuntime(_StubRuntime):
    """Stands in for a world that stopped resolving while the agent was reading it."""

    async def answer(self, request: AgentTurnRequest, tools: SandboxToolInvoker) -> str:
        raise SandboxNotFoundError("this arm is not in this shop")
