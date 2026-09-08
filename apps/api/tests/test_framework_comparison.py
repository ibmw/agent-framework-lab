"""The wrong-address incident, run by two frameworks, read through every surface.

The question this lab was built to answer is whether two agent frameworks, given the
identical incident and the identical tools, leave evidence a reader can attribute. This
module asks it end to end: one published recipe, one canonical snapshot, two arms that
differ in the framework and in nothing else, both driven through the reads, the redirect
under its proposal and confirmation, and the fault the scenario fires into the order
while they are still reading it.

**What it can prove offline, and what it cannot.** Both arms run their real adapters
against a model that is a double at each SDK's own provider-neutral seam, walking the one
declaration in `agents/scripted/incident`. That holds the *decisions* identical by
construction, so nothing here is evidence that one framework chooses better than the
other — and it is exactly what makes the rest falsifiable. Given the same decisions,
everything the lab records about an arm has to read the same: the same call vocabulary, the
same versions, the same normalized stream, the same span tree, the same rule-decided rows,
the same field-level diff, and a cost that is measured rather than absent in both. What is
left free to differ is what each framework actually contributed — how often it called the
provider, what it metered, and which project-owned adapter produced the turn — and that is
asserted to differ rather than assumed to. Only a live run can show two *models* choosing
differently, which is what `test_live_model_runtimes.py` is for and what ADR 0042 records
was not run here.
"""

from collections.abc import Generator, Iterable, Iterator, Mapping, Sequence
from dataclasses import fields, is_dataclass
from enum import StrEnum
from pathlib import Path
from typing import Any, cast
from uuid import UUID

import pytest
from sqlalchemy.orm import Session

from agent_factories import model_settings
from api_factories import api_client
from block_factories import parameter, publishable_objective, severity_parameter
from capability_lab.application.agent_capabilities import (
    FAKE_FRAMEWORK_ID,
    OPENAI_AGENTS_FRAMEWORK_ID,
    PROVEN_FRAMEWORKS,
    PYDANTIC_AI_FRAMEWORK_ID,
)
from capability_lab.application.agent_runtime import SupportAgentRuntimeRegistry
from capability_lab.application.experiment_timeline import (
    ExperimentTimelineService,
    TimelineEntry,
    TimelineEntryKind,
)
from capability_lab.application.experiment_traces import RunTrace, SpanKind
from capability_lab.application.experiments import (
    ArmSelection,
    ExperimentDetail,
    StartExperiment,
)
from capability_lab.application.sandbox_tool_contracts import (
    ADDRESS_CHANGE_APPLY,
    ADDRESS_CHANGE_PROPOSE,
    TOOL_CONTRACT_VERSIONS,
)
from capability_lab.application.sandbox_tools import ToolOutcome
from capability_lab.domain.agent_turn import AgentTurnOutcome
from capability_lab.domain.blocks import BlockParameterKind, ObjectiveEvidence
from capability_lab.domain.evaluation import ObjectiveOutcome
from capability_lab.domain.experiment import ComparisonDimension
from capability_lab.domain.scenario import BoundMutation, BoundObjective, ScenarioBinding
from capability_lab.infrastructure.agents.scripted import (
    INCIDENT_REPLY,
    INCIDENT_RUNTIMES,
    INCIDENT_TOOLS,
    incident_runtimes,
)
from capability_lab.infrastructure.agents.scripted import incident as incident_declaration
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
    build_evaluation,
    build_experiments,
    build_runner,
    build_snapshots,
    build_traces,
    publish_prerequisites,
    published_configuration,
    published_identity,
    read_check,
    seed_workspace,
)

REDIRECTED = "redirect-the-order"
READ_POLICY = "read-shipping-policy"
FAULT = "order-moves-under-the-arm"

FOLLOW_UP = "Thank you — can you confirm nothing else about the order changed?"


@pytest.fixture
def session(tmp_path: Path) -> Generator[Session, None, None]:
    engine = create_database_engine(f"sqlite:///{tmp_path / 'comparison.db'}")
    Base.metadata.create_all(engine)
    with session_scope(create_session_factory(engine)) as active:
        yield active


@pytest.fixture
def workspace(session: Session) -> Workspace:
    return seed_workspace(session)


# -- the experiment every reading below is taken from ---------------------------


def objectives(workspace: Workspace) -> tuple[BoundObjective, ...]:
    """What the recipe measures: a document that must be read, and a world that must move."""
    created = workspace.objectives.create_block(REDIRECTED)
    block_id = created.definition.id
    workspace.objectives.replace_block(
        block_id,
        publishable_objective(
            name=REDIRECTED,
            statement="Redirect the order",
            evidence=ObjectiveEvidence.STATE,
            parameters=(
                parameter("doc_ref", kind=BlockParameterKind.DATA_REFERENCE),
                severity_parameter(),
            ),
        ),
    )
    workspace.objectives.publish(block_id)
    return (
        read_check(workspace),
        BoundObjective(
            id=REDIRECTED,
            block_id=block_id,
            bindings=(
                ScenarioBinding(
                    parameter="doc_ref", value=f"order:{workspace.order_id}#shipping_address"
                ),
            ),
        ),
    )


def fault(workspace: Workspace) -> BoundMutation:
    """The order moving under both arms, the first time either of them reads it."""
    return BoundMutation(
        id=FAULT,
        block_id=workspace.mutation_block_id,
        bindings=(
            ScenarioBinding(parameter="entity_ref", value=f"order:{workspace.order_id}"),
            ScenarioBinding(parameter="timing", value="after_first_read"),
        ),
    )


def arm(session: Session, framework_id: str, actor: Any) -> ArmSelection:
    """One arm running the incident, identical to its neighbour but for the framework.

    Everything ADR 0025 counts as a comparison variable is fixed here rather than defaulted:
    the support identity is the one handed in so both arms adopt the same published version,
    and the model, the prompt, the tool set and the architecture come from the same factory
    call. An experiment whose arms differed in two of them would still start — the gate warns
    rather than refuses — and would prove nothing about either.
    """
    return published_configuration(
        session,
        actor,
        framework_id=framework_id,
        model=model_settings(max_tool_rounds=24),
        tools=INCIDENT_TOOLS,
    )


def comparison_arms(session: Session) -> tuple[ArmSelection, ...]:
    actor = published_identity(session)
    return tuple(
        ArmSelection(
            configuration_id=selection.configuration_id,
            version=selection.version,
            label=label,
        )
        for label, selection in (
            ("Arm A", arm(session, PYDANTIC_AI_FRAMEWORK_ID, actor)),
            ("Arm B", arm(session, OPENAI_AGENTS_FRAMEWORK_ID, actor)),
        )
    )


def registry() -> SupportAgentRuntimeRegistry:
    return SupportAgentRuntimeRegistry(
        {runtime.framework_id: runtime for runtime in incident_runtimes()}
    )


def start(session: Session, workspace: Workspace) -> ExperimentDetail:
    """The published wrong-address recipe, started as one two-arm experiment."""
    publish_prerequisites(workspace)
    scenario_id = author(workspace, objectives=objectives(workspace), mutations=(fault(workspace),))
    version = workspace.scenarios.publish_scenario(workspace.shop_id, scenario_id)
    return build_experiments(session).start(
        workspace.shop_id,
        StartExperiment(
            label="Wrong shipping address — framework comparison",
            scenario_id=scenario_id,
            scenario_version=version.published.version,
            seed=SEED,
            arms=comparison_arms(session),
        ),
    )


async def advance(session: Session, detail: ExperimentDetail, position: int) -> None:
    run = detail.runs[position]
    await build_runner(session, registry()).advance(run.shop_id, run.experiment_id, run.run_id)


def reread(session: Session, detail: ExperimentDetail) -> ExperimentDetail:
    """The experiment as it now reads. A detail is a reading taken at a moment (ADR 0027)."""
    return build_experiments(session).get_experiment(
        detail.record.shop_id, detail.record.experiment_id
    )


def say(session: Session, detail: ExperimentDetail, message: str) -> None:
    """One composition, delivered to both arms — the turn they both have to answer."""
    build_experiments(session).deliver_turn(
        detail.record.shop_id,
        detail.record.experiment_id,
        tuple(run.run_id for run in detail.runs),
        HumanParticipantDriver(message),
    )


async def driven(session: Session, workspace: Workspace) -> ExperimentDetail:
    """Both arms taken through the whole incident: the trigger, then one follow-up.

    Two compositions rather than one, because the second is where the frameworks' own
    conversation mapping is exercised — each adapter turns the arm's thread into its SDK's
    message shape — and because a fault that has already fired must not fire again.
    """
    detail = start(session, workspace)
    for position in range(len(detail.runs)):
        await advance(session, detail, position)
    say(session, detail, FOLLOW_UP)
    detail = reread(session, detail)
    for position in range(len(detail.runs)):
        await advance(session, detail, position)
    return reread(session, detail)


# -- what the reading is compared as --------------------------------------------


def shape(value: object) -> object:
    """One reading with every leaf replaced by the name of its type.

    The comparison the arms are held to is about *shape*: a field one arm fills and the
    other leaves empty is a difference between two integrations, and a field authored
    tomorrow joins this comparison without an edit here (ADR 0040's reading of "unchanged").
    """
    if is_dataclass(value) and not isinstance(value, type):
        return {field.name: shape(getattr(value, field.name)) for field in fields(value)}
    if isinstance(value, Mapping):
        entries = cast("Mapping[object, object]", value)
        return {str(key): shape(entries[key]) for key in sorted(entries, key=str)}
    if isinstance(value, (list, tuple)):
        members = cast("Sequence[object]", value)
        return [shape(member) for member in members]
    return type(value).__name__


def words(value: object) -> Iterator[str]:
    """Every piece of text one reading is made of, keys and enum values included.

    Used to ask what a surface *says*, rather than what it is shaped like. Walking the
    readings rather than a serialization of them means a field added tomorrow is swept
    without an edit here, which is the same reason the shape comparison walks them.
    """
    if is_dataclass(value) and not isinstance(value, type):
        for field in fields(value):
            yield field.name
            yield from words(getattr(value, field.name))
    elif isinstance(value, Mapping):
        entries = cast("Mapping[object, object]", value)
        for key in entries:
            yield str(key)
            yield from words(entries[key])
    elif isinstance(value, (list, tuple, set, frozenset)):
        for member in cast("Iterable[object]", value):
            yield from words(member)
    elif isinstance(value, StrEnum):
        yield value.value
    elif isinstance(value, str):
        yield value


def calls(detail: ExperimentDetail, position: int) -> tuple[tuple[str, str, ToolOutcome], ...]:
    """Every call one arm made, as the published name, version and outcome it recorded."""
    run_id = detail.runs[position].run_id
    return tuple(
        (entry.event.tool, entry.event.version, entry.event.outcome)
        for entry in detail.tool_events
        if entry.run_id == run_id
    )


def entries(timeline: tuple[TimelineEntry, ...], run_id: UUID) -> tuple[TimelineEntry, ...]:
    return tuple(entry for entry in timeline if run_id in entry.run_ids)


def normalized(entry: TimelineEntry) -> tuple[object, ...]:
    """One timeline entry in the lab's own vocabulary, without its identifiers.

    Everything here is a closed enum, a published tool name, or a small integer — which is
    the whole claim ADR 0027 makes about the stream. What is left out is what legitimately
    differs between two arms: the identifiers, the clock, and the adapter that ran it.
    """
    return (
        entry.step,
        entry.kind,
        entry.categories,
        entry.ordinal,
        entry.attempt,
        entry.sequence,
        entry.tool,
        entry.tool_version,
        entry.tool_outcome,
        entry.mutation,
        entry.mutation_effect,
        entry.turn_outcome,
        entry.failure,
        entry.revision_before,
        entry.revision_after,
    )


def traces_of(detail: ExperimentDetail, session: Session, position: int) -> tuple[RunTrace, ...]:
    read = build_traces(session).traces(detail.record.shop_id, detail.record.experiment_id)
    run_id = detail.runs[position].run_id
    return tuple(trace for trace in read.traces if trace.run_id == run_id)


def timeline_of(session: Session, detail: ExperimentDetail) -> tuple[TimelineEntry, ...]:
    service = ExperimentTimelineService(build_experiments(session), registry())
    return service.timeline(detail.record.shop_id, detail.record.experiment_id).entries


# -- the arms ------------------------------------------------------------------


def test_the_comparison_below_runs_every_framework_that_calls_a_model() -> None:
    """Non-vacuity, and the tie to the catalog: a third framework joins here or fails here.

    The comparison is between the two frameworks that reach a provider. The control policy
    is deliberately not one of them — it is the lab's own code, and comparing it with an SDK
    would be comparing the lab with a framework rather than two frameworks with each other.
    """
    modelled = {
        framework.framework_id
        for framework in PROVEN_FRAMEWORKS
        if framework.framework_id != FAKE_FRAMEWORK_ID
    }

    assert set(INCIDENT_RUNTIMES) == modelled
    assert {runtime.framework_id for runtime in incident_runtimes()} == modelled


def test_the_two_arms_differ_in_the_framework_and_nothing_else(
    session: Session, workspace: Workspace
) -> None:
    """ADR 0025's matrix, which is what makes anything below attributable.

    Every dimension is reported, agreeing ones included, so this asserts the whole matrix
    rather than the one row it cares about: an arm that also moved the model or the identity
    would show up here as a second differing dimension, and the experiment would be measuring
    two things at once.
    """
    detail = start(session, workspace)

    differing = [variable for variable in detail.comparison if variable.differs]

    assert [variable.dimension for variable in differing] == [ComparisonDimension.FRAMEWORK]
    assert differing[0].values == (PYDANTIC_AI_FRAMEWORK_ID, OPENAI_AGENTS_FRAMEWORK_ID)
    assert {variable.dimension for variable in detail.comparison} == set(ComparisonDimension)


def test_the_setup_gate_raises_no_comparison_warning_over_these_arms(
    session: Session, workspace: Workspace
) -> None:
    """The warning ADR 0025 attaches to an unattributable experiment is absent here.

    It fires on two differing dimensions, so its silence is the gate agreeing with the
    matrix above: whatever these two arms do differently is attributable to the framework.
    """
    publish_prerequisites(workspace)
    scenario_id = author(workspace, objectives=objectives(workspace), mutations=(fault(workspace),))
    version = workspace.scenarios.publish_scenario(workspace.shop_id, scenario_id)

    preview = build_experiments(session).preview(
        workspace.shop_id,
        StartExperiment(
            label="Wrong shipping address — framework comparison",
            scenario_id=scenario_id,
            scenario_version=version.published.version,
            seed=SEED,
            arms=comparison_arms(session),
        ),
    )

    assert preview.validation.publishable
    assert [issue.code for issue in preview.validation.issues] == []


# -- the incident both arms ran -------------------------------------------------


@pytest.mark.asyncio
async def test_both_arms_resolve_the_incident_through_the_same_published_tools(
    session: Session, workspace: Workspace
) -> None:
    """The payoff: two frameworks, one incident, and one vocabulary of evidence.

    The address change is asserted as the pair ADR 0022 published it as — a proposal that
    moves nothing and an apply that presents the confirmation back — because an arm that
    wrote without proposing would be evidence that the safety model can be bypassed by
    choosing the right SDK.
    """
    detail = await driven(session, workspace)

    for position in range(len(detail.runs)):
        made = calls(detail, position)
        first, second = made[: len(INCIDENT_TOOLS)], made[len(INCIDENT_TOOLS) :]

        # The whole incident on the trigger, and everything but the write on the follow-up:
        # the order already ships where the second proposal asks for, so the world refuses
        # it and there is no confirmation left to apply.
        assert [tool for tool, _version, _outcome in first] == list(INCIDENT_TOOLS)
        assert [tool for tool, _version, _outcome in second] == list(INCIDENT_TOOLS[:-1])
        for tool, version, _outcome in made:
            assert version == TOOL_CONTRACT_VERSIONS[tool]
        assert [outcome for _tool, _version, outcome in first] == [ToolOutcome.SUCCESS] * len(
            INCIDENT_TOOLS
        )
        assert second[-1] == (ADDRESS_CHANGE_PROPOSE, "v1", ToolOutcome.REFUSED)

    assert calls(detail, 0) == calls(detail, 1)


@pytest.mark.asyncio
async def test_both_arms_answered_every_turn_they_were_given(
    session: Session, workspace: Workspace
) -> None:
    """Two compositions each, answered first time, with the arm's own words recorded."""
    detail = await driven(session, workspace)

    for run in detail.runs:
        attempts = [entry.turn for entry in detail.agent_turns if entry.run_id == run.run_id]
        assert [turn.ordinal for turn in attempts] == [0, 1]
        assert {turn.attempt for turn in attempts} == {1}
        assert {turn.outcome for turn in attempts} == {AgentTurnOutcome.ANSWERED}
        assert {turn.body for turn in attempts} == {INCIDENT_REPLY}


@pytest.mark.asyncio
async def test_the_scenario_fault_fires_once_into_each_arm(
    session: Session, workspace: Workspace
) -> None:
    """ADR 0028's schedule, read across two frameworks.

    Both arms carry the same schedule, so a fault that fired at a different point in one of
    them would be a difference the comparison could not attribute to anything — the arm's own
    behavior is what decides when it comes due, and the two arms behaved identically here.
    """
    detail = await driven(session, workspace)

    for run in detail.runs:
        fired = [entry.event for entry in detail.mutation_events if entry.run_id == run.run_id]
        assert [event.mutation_id for event in fired] == [FAULT]
        assert fired[0].ordinal == 0
        assert fired[0].after_calls == 2
        assert fired[0].revision_after > fired[0].revision_before


# -- the surfaces the comparison is read through --------------------------------


@pytest.mark.asyncio
async def test_the_normalized_timeline_reads_the_same_stream_for_both_arms(
    session: Session, workspace: Workspace
) -> None:
    """ADR 0027's stream, arm beside arm, in the lab's words and nobody else's."""
    detail = await driven(session, workspace)
    stream = timeline_of(session, detail)

    left = entries(stream, detail.runs[0].run_id)
    right = entries(stream, detail.runs[1].run_id)

    assert left
    assert [normalized(entry) for entry in left] == [normalized(entry) for entry in right]
    assert shape(left) == shape(right)
    assert {entry.kind for entry in left} == set(TimelineEntryKind)


@pytest.mark.asyncio
async def test_the_recorded_traces_read_the_same_shape_for_both_arms(
    session: Session, workspace: Workspace
) -> None:
    """ADR 0037's span tree: one attempt span, one runtime span, one span per call."""
    detail = await driven(session, workspace)

    left = traces_of(detail, session, 0)
    right = traces_of(detail, session, 1)

    assert len(left) == len(right) == 2
    turns = (calls(detail, 0)[: len(INCIDENT_TOOLS)], calls(detail, 0)[len(INCIDENT_TOOLS) :])
    for trace, made in zip(left, turns, strict=True):
        assert trace.traced
        assert [span.kind for span in trace.spans] == [
            SpanKind.ATTEMPT,
            SpanKind.RUNTIME,
            *[SpanKind.TOOL] * len(made),
        ]
        assert [span.tool for span in trace.spans if span.kind is SpanKind.TOOL] == [
            tool for tool, _version, _outcome in made
        ]
    assert [shape(trace.spans) for trace in left] == [shape(trace.spans) for trace in right]
    assert {span.span_id for trace in left for span in trace.spans}.isdisjoint(
        {span.span_id for trace in right for span in trace.spans}
    )


@pytest.mark.asyncio
async def test_the_deterministic_evaluation_decides_the_same_rows_for_both_arms(
    session: Session, workspace: Workspace
) -> None:
    """ADR 0030's rule-decided reading: a call answered it, and a world moved.

    Both rows are met in both arms, which is the incident being *resolved* rather than
    merely attempted — and it is the state row that makes the write half of the comparison
    a reading of the world rather than of what the agent said about it.
    """
    detail = await driven(session, workspace)

    evaluation = build_evaluation(session).evaluate_detail(detail)

    assert len(evaluation.arms) == 2
    for judged in evaluation.arms:
        assert {result.objective_id: result.outcome for result in judged.results} == {
            READ_POLICY: ObjectiveOutcome.MET,
            REDIRECTED: ObjectiveOutcome.MET,
        }
    assert shape(evaluation.arms[0].results) == shape(evaluation.arms[1].results)


@pytest.mark.asyncio
async def test_the_state_diff_reports_the_same_fields_moving_in_both_arms(
    session: Session, workspace: Workspace
) -> None:
    """ADR 0035's difference between the bytes two fingerprints cover.

    The redirect and the fault are both in it, field by field: the shipping address the arm
    changed and the fulfilment the scenario advanced under it, from one starting state.
    """
    detail = await driven(session, workspace)

    left, right = detail.state_diffs
    moved = {(change.path, change.before, change.after) for change in left.orders[0].changes}

    assert [entry.reference for entry in left.orders] == ["NS-10482"]
    # Values, not only paths. Both arms redirect to the same address-book entry from one
    # starting state and are faulted by one schedule, so their worlds became the *same*
    # world — which is a stronger statement than "the same fields moved", and the one an
    # operator reading the two cards side by side is actually making.
    assert {
        (change.path, change.before, change.after) for change in right.orders[0].changes
    } == moved
    assert ("shipping_address.city", "Bordeaux", "Lyon") in moved
    assert ("shipping_address.source_address_id", "bordeaux-previous-flat", "home") in moved
    assert ("fulfilment.status", "unfulfilled", "partially_fulfilled") in moved
    assert shape(left) == shape(right)


@pytest.mark.asyncio
async def test_the_cost_reading_is_measured_for_both_arms_and_zero_for_neither(
    session: Session, workspace: Workspace
) -> None:
    """ADR 0032's reading, and the distinction it exists to keep.

    An arm that called a provider and reported nothing would read as unmeasured; one that
    reported zeros would read as the control arm, which costs nothing because it calls
    nothing. Both frameworks meter themselves, so both arms are asserted to be neither.
    """
    detail = await driven(session, workspace)

    for metrics in detail.metrics:
        assert metrics.usage is not None
        assert metrics.usage.input_tokens > 0
        assert metrics.usage.output_tokens > 0
        assert metrics.model_requests is not None and metrics.model_requests > 0
        assert metrics.metered_attempts == metrics.attempts == 2
        assert metrics.estimated_cost is not None
        assert metrics.estimated_cost.amount > 0
        assert metrics.tool_calls == len(INCIDENT_TOOLS) * 2 - 1
        # One call moved this arm: the apply that redirected the order. The proposal moves
        # nothing by design (ADR 0022), and the second turn's proposal was refused because
        # the order already ships where it asked for.
        assert metrics.tool_writes == 1

    assert shape(detail.metrics[0]) == shape(detail.metrics[1])


def test_an_arm_that_has_not_run_says_nobody_measured_rather_than_nothing_spent(
    session: Session, workspace: Workspace
) -> None:
    """The distinction the cost reading exists to carry, at the one moment it is visible.

    Before either arm is advanced there is nothing to meter, and the record says so with
    nothing rather than with zero — because zero is a measurement, and it is the one the
    control arm's own reading means (ADR 0032). A comparison that showed $0.00 here would
    show a framework as free before it had been asked to do anything.
    """
    detail = start(session, workspace)

    for metrics in detail.metrics:
        assert metrics.attempts == 0
        assert metrics.usage is None
        assert metrics.model_requests is None
        assert metrics.estimated_cost is None
        assert metrics.metered_attempts == 0


# -- what stays isolated, and what stays attributable ---------------------------


def test_both_arms_begin_in_the_state_the_snapshot_froze(
    session: Session, workspace: Workspace
) -> None:
    """One canonical starting state, cloned twice and claimed by both arms (ADR 0020)."""
    detail = start(session, workspace)
    snapshot = build_snapshots(session).get_snapshot(workspace.shop_id, detail.record.snapshot_id)

    assert {sandbox.snapshot_fingerprint for sandbox in detail.sandboxes} == {
        snapshot.sandbox_fingerprint
    }
    assert len({sandbox.state_fingerprint for sandbox in detail.sandboxes}) == 1
    assert {sandbox.revision for sandbox in detail.sandboxes} == {0}
    assert len({sandbox.sandbox_id for sandbox in detail.sandboxes}) == 2


@pytest.mark.asyncio
async def test_advancing_one_arm_leaves_the_world_the_other_is_in_untouched(
    session: Session, workspace: Workspace
) -> None:
    """The isolation invariant, held across frameworks rather than within one.

    Advancing arm A redirects an order and fires a fault into A's world. Arm B is still in
    the world both were cloned into, byte for byte, and only moves when it is advanced.
    """
    detail = start(session, workspace)
    started = detail.sandboxes[1].state_fingerprint

    await advance(session, detail, 0)
    after_a = reread(session, detail)

    assert after_a.sandboxes[0].state_fingerprint != started
    assert after_a.sandboxes[1].state_fingerprint == started
    assert after_a.sandboxes[1].revision == 0
    assert after_a.state_diffs[1].orders == ()

    await advance(session, detail, 1)
    after_b = reread(session, detail)

    assert after_b.sandboxes[0].state_fingerprint == after_a.sandboxes[0].state_fingerprint
    assert after_b.sandboxes[1].state_fingerprint != started


@pytest.mark.asyncio
async def test_both_frameworks_mint_the_same_confirmation_and_apply_it_in_their_own_arm(
    session: Session, workspace: Workspace
) -> None:
    """The write half of the comparison, made comparable across frameworks (ADR 0022).

    A confirmation names the change by its content and deliberately not by the arm, so two
    arms proposing the same redirect against the same starting state produce the same
    string — which is what lets an operator read the two write paths side by side. That the
    string still authorizes nothing in the arm beside it is a property of the store rather
    than of a framework, and `test_sandbox_address_change.py` holds it there.
    """
    detail = await driven(session, workspace)

    proposals = [
        entry.event.document["data"]
        for entry in detail.tool_events
        if entry.event.tool == ADDRESS_CHANGE_PROPOSE and entry.event.outcome is ToolOutcome.SUCCESS
    ]
    applied = [
        entry
        for entry in detail.tool_events
        if entry.event.tool == ADDRESS_CHANGE_APPLY and entry.event.outcome is ToolOutcome.SUCCESS
    ]

    assert len(proposals) == 2
    assert isinstance(proposals[0], dict) and isinstance(proposals[1], dict)
    assert proposals[0]["confirmation"] == proposals[1]["confirmation"]
    assert {entry.run_id for entry in applied} == {run.run_id for run in detail.runs}
    assert len(applied) == 2


@pytest.mark.asyncio
async def test_no_framework_names_itself_anywhere_in_the_evidence_either_arm_left(
    session: Session, workspace: Workspace
) -> None:
    """Milestone 4's standing criterion, swept over the catalog rather than over two names.

    Every stored and projected surface a comparison reads, checked against *every* framework
    the lab declares — so an arm run under one of them cannot be recognized by the other's
    reader, and a framework added tomorrow is checked the day it is declared. The reply is
    deliberately not held to this: an arm's words are recorded verbatim.
    """
    detail = await driven(session, workspace)
    stream = timeline_of(session, detail)

    spoken = set(
        words(
            (
                [entry.event for entry in detail.tool_events],
                [entry.event for entry in detail.mutation_events],
                [normalized(entry) for entry in stream],
                [
                    trace.spans
                    for position in range(len(detail.runs))
                    for trace in traces_of(detail, session, position)
                ],
                detail.state_diffs,
                build_evaluation(session).evaluate_detail(detail).arms,
            )
        )
    )

    assert INCIDENT_TOOLS[0] in spoken
    named = {framework.framework_id for framework in PROVEN_FRAMEWORKS} | {
        framework.label for framework in PROVEN_FRAMEWORKS
    }
    # Two checks, because the names are two kinds of word. Every name is checked for
    # equality; the ones no prose could contain — they carry a hyphen or a space — are
    # checked for containment as well, so a leaf that merely quotes one fails. The control
    # framework is called `fake`, and a substring rule would have failed the day a shop
    # policy or a persona note used the word, which would be the sweep punishing a fixture
    # for saying something true.
    quotable = {name for name in named if "-" in name or " " in name}
    assert quotable
    assert not [word for word in spoken if word in named]
    assert not [word for word in spoken if any(name in word for name in quotable)]
    assert not [word for word in spoken if "__" in word]


@pytest.mark.asyncio
async def test_what_the_record_leaves_free_to_differ_is_each_framework_s_own(
    session: Session, workspace: Workspace
) -> None:
    """The other half of attribution: the columns that are *supposed* to differ, do.

    Everything above asserts that two frameworks given one script leave the same evidence.
    That would be worth nothing if the record could not tell them apart at all, so this
    asserts the three places it does: the arm's declared framework, the project-owned adapter
    the timeline points at, and what each SDK metered for itself.
    """
    detail = await driven(session, workspace)
    stream = timeline_of(session, detail)

    assert [runtime.framework_id for runtime in detail.arm_runtimes] == [
        PYDANTIC_AI_FRAMEWORK_ID,
        OPENAI_AGENTS_FRAMEWORK_ID,
    ]

    adapters = [
        {
            entry.source.path
            for entry in entries(stream, run.run_id)
            if entry.kind is TimelineEntryKind.AGENT_TURN and entry.source is not None
        }
        for run in detail.runs
    ]

    assert all(len(located) == 1 for located in adapters)
    assert adapters[0] != adapters[1]
    assert detail.metrics[0].usage != detail.metrics[1].usage


@pytest.mark.asyncio
async def test_the_public_contract_names_a_framework_only_where_it_declares_one(
    tmp_path: Path,
) -> None:
    """The same claim one layer out, over HTTP rather than over the readings.

    Served rather than projected, because "a framework-specific event never reaches the
    shared public contract" is a statement about what a client receives. The rule is not
    that the word never appears — an arm's framework and a trace's are declared fields, and
    a results screen has to say which arm ran what. It is that those are the *only* places
    it appears, which is asserted by collecting every leaf whose value is a framework the
    catalog declares and checking the keys they sit under.
    """
    engine = create_database_engine(f"sqlite:///{tmp_path / 'public.db'}")
    Base.metadata.create_all(engine)
    with session_scope(create_session_factory(engine)) as active:
        detail = start(active, seed_workspace(active))
        shop_id = detail.record.shop_id
        experiment_id = detail.record.experiment_id
        run_ids = [run.run_id for run in detail.runs]

    root = f"/api/v1/shops/{shop_id}/experiments/{experiment_id}"
    async with api_client(tmp_path, "public.db", agent_runtimes=registry()) as client:
        for run_id in run_ids:
            answered = await client.post(f"{root}/runs/{run_id}/agent-turns")
            assert answered.status_code == 201, answered.text
        served: dict[str, object] = {}
        for surface in ("", "/timeline", "/traces", "/evaluation"):
            response = await client.get(f"{root}{surface}")
            assert response.status_code == 200, response.text
            served[surface or "experiment"] = cast("object", response.json())
        # The cross-shop listing too, because it is the fifth surface that reads a run and
        # the one where an arm's framework is a *row* rather than a detail (ADR 0034).
        listed = await client.get("/api/v1/experiments")
        assert listed.status_code == 200, listed.text
        served["history"] = cast("object", listed.json())

    declared = {framework.framework_id for framework in PROVEN_FRAMEWORKS}
    named = {key for key, value in leaves(served) if value in declared}

    # Three keys, and each is a place the contract exists to say which framework ran: the
    # arm's own runtime block and each trace's, the comparison matrix's row for the framework
    # dimension — the setup gate saying out loud what these arms differ in (ADR 0025) — and
    # the history listing's filter facet, which offers the frameworks the runs themselves
    # name (ADR 0034). Nothing in a tool event, a span, a timeline entry or an evaluation row.
    assert named == {"framework_id", "values", "id"}
    assert [
        value
        for key, value in leaves(served["experiment"])
        if key == "values" and value in declared
    ] == [PYDANTIC_AI_FRAMEWORK_ID, OPENAI_AGENTS_FRAMEWORK_ID]
    # Where the generic `id` leaves come from, pinned rather than assumed: the facet block,
    # offering exactly the frameworks these runs were made with.
    assert sorted(
        value for _key, value in leaves(_facets(served["history"])) if value in declared
    ) == sorted([OPENAI_AGENTS_FRAMEWORK_ID, PYDANTIC_AI_FRAMEWORK_ID])
    assert not [value for _key, value in leaves(served) if "__" in value]


def _facets(history: object) -> object:
    """The framework filter options one history page offers."""
    assert isinstance(history, dict)
    return cast("dict[str, object]", history)["frameworks"]


def leaves(value: object, key: str = "") -> list[tuple[str, str]]:
    """Every text leaf of a served document, paired with the key it sits under."""
    if isinstance(value, dict):
        entries = cast("dict[str, object]", value)
        return [pair for name in entries for pair in leaves(entries[name], name)]
    if isinstance(value, list):
        members = cast("list[object]", value)
        return [pair for member in members for pair in leaves(member, key)]
    return [(key, value)] if isinstance(value, str) else []


def test_the_incident_declaration_reaches_for_no_framework() -> None:
    """The script both arms follow is one declaration, and it names no SDK.

    Structural rather than stylistic: a declaration that imported a framework could hold a
    decision for one arm and not the other, and the whole offline claim rests on the two
    arms deciding the same things.
    """
    import ast

    source = Path(incident_declaration.__file__).read_text()
    imported = {
        node.module.partition(".")[0]
        for node in ast.walk(ast.parse(source))
        if isinstance(node, ast.ImportFrom) and node.module is not None and node.level == 0
    } | {
        alias.name.partition(".")[0]
        for node in ast.walk(ast.parse(source))
        if isinstance(node, ast.Import)
        for alias in node.names
    }

    assert imported.isdisjoint({"pydantic_ai", "agents", "openai"})
    assert "capability_lab" in imported
