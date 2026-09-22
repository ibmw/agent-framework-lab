"""Advancing one arm: the agent answers the customer, and what it did is the record.

ADR 0025 opened both threads and left them there — the trigger written into each arm, the
operator able to add turns, and nothing on the other side. This is the other side. Asked to
advance one arm, this module resolves what that arm runs, runs it against that arm's own
sandbox, and writes down what happened.

Five decisions shape it.

**Advancing is explicit and per arm.** Delivering a customer turn records a customer turn;
running an agent is a separate act, on one arm, because the arms progress independently
(one may be advanced twice while the other waits) and because a model call is slow and
costly enough that it must not be a side effect of typing. It is also what makes a retry
expressible at all.

**It is idempotent over an answer, not over an attempt.** Advancing an arm whose latest
customer turn is already answered returns that answer and calls no model. Advancing one
whose last attempt *failed* runs a new attempt, because a failure is evidence to keep and a
retry is a thing an operator does — so the record grows rather than being overwritten.

**Resolution comes from the pins, never from the latest.** The prompt is rendered against
the shop version the snapshot froze and the support-identity version the experiment froze,
not against whatever has been published since. An experiment is explained by the versions
it pinned; reading a newer one here would make a run unexplainable the moment an author
published again.

**The tools are the configuration's, and the actor is its identity's.** An arm is offered
exactly the tools its configuration enables, and every call runs under the support identity
that configuration adopts — so an unauthorized write is refused by the same table the
publish gate read (ADR 0022, ADR 0024), and the tool bindings become a comparison variable
with teeth rather than a label.

**Every call is recorded because of how it is made.** The runtime reaches the world through
an invoker this module constructs; there is no other path. A tool event is therefore
produced by the call rather than reported by an adapter, which is what keeps a framework's
own event objects out of the evidence entirely.

**What an attempt spent is measured here, and only here.** The runner holds the clock, so
it times the whole attempt — the model and every tool call inside it — and the invoker times
each call it makes. The one thing the runner cannot see is the provider's token meter, which
comes back with the answer because only the framework can read it (`model_cost`). Nothing is
derived: an unmeasured attempt records no duration and an unmetered one no usage, and the
estimate built on them says so rather than reading as free.

**An arm is pinned to the endpoint it reached, and refuses to be advanced against
another.** The connection a lab runs on is resolved per advance rather than at start-up
(ADR 0052), so it can move between two advances of one arm. The first advance that reaches a
provider writes the endpoint onto the run; a later one that would reach a different endpoint
is refused with both named and records no turn, because half an arm produced against one and
half against another is a record nobody can read. An arm that reaches no provider at all —
the deterministic control — stays unpinned, and that null is the honest record rather than a
gap.

**The scenario's faults ride on that same path.** A mutation's moment can arrive between two
of an agent's calls — that is the case ADR 0022 built the concurrency refusal for — so the
schedule is asked before the runtime is started and again after every call the invoker makes
(ADR 0028). It fires into this arm's sandbox alone, and the arm beside it stays exactly where
it was until its own advance reaches the same moment.
"""

from __future__ import annotations

import logging
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from capability_lab.application.agent_prompt import render_prompt
from capability_lab.application.agent_runtime import (
    AgentMessage,
    AgentRole,
    AgentToolBudgetExceededError,
    AgentTurnRequest,
    SandboxToolInvoker,
    SupportAgentFrameworkError,
    SupportAgentRuntime,
    SupportAgentRuntimeError,
    SupportAgentRuntimeRegistry,
)
from capability_lab.application.agent_turns import (
    AgentTurnRecord,
    AgentTurnRepository,
    ToolEvent,
    ToolEventRecord,
    ToolEventRepository,
)
from capability_lab.application.canonical_json import CanonicalValue
from capability_lab.application.definition_authoring import DefinitionRepository
from capability_lab.application.definition_resolution import (
    ArmResolution,
    DefinitionResolutionError,
    MissingReferenceVersionError,
)
from capability_lab.application.experiment_traces import (
    AttemptTraceDraft,
    RunSpanRecord,
    RunSpanRepository,
    RunTracer,
    SpanDraft,
    SpanKind,
)
from capability_lab.application.experiments import (
    ExperimentNotFoundError,
    ExperimentRecord,
    ExperimentRepository,
    ExperimentRunNotFoundError,
    ExperimentRunRepository,
    ParticipantTurnRepository,
    RunRecord,
)
from capability_lab.application.model_cost import ModelUsage
from capability_lab.application.mutation_events import MutationEventRecord
from capability_lab.application.ports import Clock
from capability_lab.application.sandbox_actions import ToolActor
from capability_lab.application.sandbox_materialization import (
    SandboxSnapshotRecord,
    SandboxSnapshotService,
)
from capability_lab.application.sandbox_tool_contracts import (
    SANDBOX_TOOL_CONTRACTS,
    ToolContract,
)
from capability_lab.application.sandbox_tools import (
    SandboxToolService,
    ToolCall,
    ToolOutcome,
)
from capability_lab.application.sandboxes import SandboxRepository
from capability_lab.application.scenario_mutations import (
    ArmMutations,
    ScenarioMutationRuntime,
    entities_read,
)
from capability_lab.domain.agent_configuration import AgentConfigurationPayload, MemoryMode
from capability_lab.domain.agent_turn import (
    MAX_AGENT_TURN_LENGTH,
    AgentTurn,
    AgentTurnFailure,
    AgentTurnOutcome,
)
from capability_lab.domain.definitions import DefinitionType, VersionRef
from capability_lab.domain.experiment import (
    ArmAwaiting,
    ArmStanding,
    ParticipantTurn,
    stand_arm,
)
from capability_lab.domain.scenario import ScenarioPayload
from capability_lab.domain.shop import ShopPayload
from capability_lab.domain.support_identity import SupportIdentityPayload

__all__ = [
    "ExperimentRunner",
    "ModelEndpointMismatchError",
    "RunTurn",
    "RunUnansweredError",
]

_logger = logging.getLogger(__name__)


class RunUnansweredError(ExperimentRunNotFoundError):
    """Raised when an arm is asked to advance and has received no customer turn at all.

    Unreachable while starting an experiment writes the trigger into every arm (ADR 0025),
    which is why it names the arm rather than the experiment: an arm with an empty thread is
    an arm that was never opened.
    """


class ModelEndpointMismatchError(RuntimeError):
    """This arm was produced against one endpoint and would now reach another.

    Deliberately **not** a `SupportAgentRuntimeError`, for the reason
    `SupportAgentUnavailableError` is not one: it can never be recorded as a turn. Where the
    lab is pointed is a fact about the installation, and half an arm produced against one
    endpoint and half against another is a record nobody can read (ADR 0052).

    Both endpoints are named in the message, because the operator's next move depends on
    knowing which one they repointed away from. Their path is the one the lab already has —
    fork the experiment (ADR 0039) or start a new one — and the fork's derivation record then
    says why there are two.
    """


@dataclass(frozen=True, slots=True)
class RunTurn:
    """What one advance produced: the attempt, the calls it made, and the faults it fired.

    The mutations are here rather than left to a later read of the experiment because an
    operator advancing an arm has to be able to see that the world moved under it. A refusal
    with no visible cause is the one thing a fault must never look like.

    "Produced" is exact: these are the faults that fired *in this attempt*, so a retry after
    a failed attempt reports none — the fault fired during the advance that failed, and that
    advance answered with it. The whole listing an arm has met is `getExperiment`'s, which is
    what the bench reads after every advance.
    """

    turn: AgentTurnRecord
    tool_events: tuple[ToolEventRecord, ...]
    mutation_events: tuple[MutationEventRecord, ...] = ()


def _elapsed_ms(started: datetime, ended: datetime) -> int:
    """How long something took, on the same wall clock the record is timestamped by.

    Clamped at zero. An operational clock can be stepped backwards under a running process,
    and a negative duration in an evidence record would be worse than a lost measurement: it
    would subtract from a total a comparison reads. Rounded rather than truncated so a call
    that took under a millisecond is not recorded as instantaneous.
    """
    return max(0, round((ended - started).total_seconds() * 1000))


def _pin(snapshot: SandboxSnapshotRecord, kind: DefinitionType) -> VersionRef:
    """The version one snapshot froze of one kind of definition.

    One scan rather than one per caller: the shop a prompt renders against and the scenario a
    cap is read from are the same question asked twice, and two copies of it would be two
    chances to resolve an arm against something the snapshot did not pin.
    """
    pin = next(
        (entry for entry in snapshot.content.pins if entry.definition.definition_type is kind),
        None,
    )
    if pin is None:  # pragma: no cover - a snapshot is materialized from a shop's scenario
        raise MissingReferenceVersionError(f"this snapshot pins no {kind.value}")
    return pin.ref


class ExperimentRunner:
    """Run one arm's configured agent against that arm's sandbox, once."""

    def __init__(
        self,
        experiments: ExperimentRepository,
        runs: ExperimentRunRepository,
        participant_turns: ParticipantTurnRepository,
        agent_turns: AgentTurnRepository,
        tool_events: ToolEventRepository,
        spans: RunSpanRepository,
        snapshots: SandboxSnapshotService,
        sandboxes: SandboxRepository,
        scenarios: DefinitionRepository[ScenarioPayload],
        shops: DefinitionRepository[ShopPayload],
        support_identities: DefinitionRepository[SupportIdentityPayload],
        configurations: DefinitionRepository[AgentConfigurationPayload],
        tools: SandboxToolService,
        mutations: ScenarioMutationRuntime,
        runtimes: SupportAgentRuntimeRegistry,
        tracer: RunTracer,
        clock: Clock,
    ) -> None:
        self._experiments = experiments
        self._runs = runs
        self._participant_turns = participant_turns
        self._agent_turns = agent_turns
        self._tool_events = tool_events
        self._spans = spans
        self._snapshots = snapshots
        self._sandboxes = sandboxes
        self._scenarios = scenarios
        self._shops = shops
        self._support_identities = support_identities
        self._configurations = configurations
        self._tools = tools
        self._mutations = mutations
        self._runtimes = runtimes
        self._tracer = tracer
        self._clock = clock

    async def advance(self, shop_id: UUID, experiment_id: UUID, run_id: UUID) -> RunTurn:
        """Answer this arm's latest customer turn, or return the answer it already has."""
        record = self._experiments.get(shop_id, experiment_id)
        if record is None:
            raise ExperimentNotFoundError(f"experiment {experiment_id} is not in shop {shop_id}")
        run = next(
            (
                candidate
                for candidate in self._runs.list_for_experiment(experiment_id)
                if candidate.run_id == run_id
            ),
            None,
        )
        if run is None:
            raise ExperimentRunNotFoundError(
                f"run {run_id} is not an arm of experiment {experiment_id}"
            )

        standing = self.standing(record, run)
        if standing.awaiting is not ArmAwaiting.AGENT:
            # Already answered: return it and call nothing. Advancing twice must not cost a
            # second model call, and an arm must never hold two replies to one question. The
            # faults that fired during it come back too, because they are part of what that
            # answer was produced against.
            answered = next(
                entry
                for entry in self._attempts(run, standing.ordinal)
                if entry.turn.outcome is AgentTurnOutcome.ANSWERED
            )
            return RunTurn(
                turn=answered,
                tool_events=self._recorded(answered),
                mutation_events=self._recorded_mutations(answered),
            )
        return await self._attempt(
            record, run, ordinal=standing.ordinal, attempt=standing.attempts + 1
        )

    # -- reading ---------------------------------------------------------------

    def standing(self, record: ExperimentRecord, run: RunRecord) -> ArmStanding:
        """Where this arm stands: the turn it is on, and whether anything answered it.

        The one reading, shared with what a client is shown (ADR 0029), so an arm the bench
        offers a "run the agent" button for is exactly an arm this method will run. The
        alternative — the runner deciding for itself what to answer next — is two rules that
        agree until the day one of them is edited.

        An arm that answers the *last* turn it received rather than the first it never
        answered is ADR 0026's decision, applied here through `stand_arm`: a reply to a
        question the customer has already moved on from would be answering the wrong thread.
        """
        turns = tuple(
            entry.turn
            for entry in self._participant_turns.list_for_experiment(run.experiment_id)
            if entry.run_id == run.run_id
        )
        if not turns:  # pragma: no cover - starting an experiment opens every arm
            raise RunUnansweredError(f"arm {run.label} has received no customer turn to answer")
        return stand_arm(
            turns,
            tuple(entry.turn for entry in self._attempts_of(run)),
            max_turns=self._cap(record, run.shop_id),
        )

    def _cap(self, record: ExperimentRecord, shop_id: UUID) -> int:
        """The turn cap the scenario version this experiment pinned declares.

        Resolved through the snapshot like every other pin the runner reads, so an arm is
        bounded by the recipe its experiment was started under rather than by the scenario as
        it reads now.
        """
        snapshot = self._snapshots.get_snapshot(shop_id, record.snapshot_id)
        ref = _pin(snapshot, DefinitionType.SCENARIO)
        return self._version(self._scenarios, ref, DefinitionType.SCENARIO).completion.max_turns

    def list_agent_turns(self, experiment_id: UUID) -> tuple[AgentTurnRecord, ...]:
        return self._agent_turns.list_for_experiment(experiment_id)

    def list_tool_events(self, experiment_id: UUID) -> tuple[ToolEventRecord, ...]:
        return self._tool_events.list_for_experiment(experiment_id)

    def list_mutation_events(self, experiment_id: UUID) -> tuple[MutationEventRecord, ...]:
        return self._mutations.list_events(experiment_id)

    def _attempts_of(self, run: RunRecord) -> tuple[AgentTurnRecord, ...]:
        return tuple(
            entry
            for entry in self._agent_turns.list_for_experiment(run.experiment_id)
            if entry.run_id == run.run_id
        )

    def _attempts(self, run: RunRecord, ordinal: int) -> tuple[AgentTurnRecord, ...]:
        return tuple(entry for entry in self._attempts_of(run) if entry.turn.ordinal == ordinal)

    # -- one attempt -----------------------------------------------------------

    async def _attempt(
        self, record: ExperimentRecord, run: RunRecord, *, ordinal: int, attempt: int
    ) -> RunTurn:
        # The moment the advance began, which is earlier than the moment the attempt is
        # *measured* from. The difference between the two is the lab's own resolution of
        # what this arm runs and the faults due before it starts — project-owned glue code,
        # and the one part of a run a framework comparison should not charge to a framework.
        # It is the origin every span offset below is relative to, and it deliberately does
        # not touch `duration_ms`, which stays exactly the measurement ADR 0032 published.
        opened = self._clock.now()
        resolved = self._resolve(record, run)
        runtime = self._runtimes.get(resolved.configuration.framework_id)
        # Before anything is written, and before the model is called: an advance that would
        # reach an endpoint this arm was not produced against is refused whole, and a
        # refusal that had already recorded a turn would be the split it exists to prevent.
        self._pin_endpoint(run, runtime)
        thread = tuple(
            entry.turn
            for entry in self._participant_turns.list_for_experiment(record.experiment_id)
            if entry.run_id == run.run_id
        )
        mutations = self._scheduled(record, run, ordinal=ordinal, attempt=attempt)
        # Before the runtime is started, so a fault bound to this turn is already in the
        # world the agent opens its eyes on rather than arriving one call late.
        mutations.fire_due()
        invoker = _RecordingInvoker(
            tools=self._tools,
            sandboxes=self._sandboxes,
            clock=self._clock,
            opened=opened,
            shop_id=run.shop_id,
            sandbox_id=run.sandbox_id,
            actor=resolved.actor,
            contracts=resolved.tools,
            budget=resolved.configuration.model.max_tool_rounds,
            mutations=mutations,
        )
        request = AgentTurnRequest(
            run_id=run.run_id,
            arm_label=run.label,
            instructions=resolved.instructions,
            model=resolved.configuration.model,
            tools=resolved.tools,
            history=self._history(resolved.configuration, run, thread, ordinal),
            message=next(turn.body for turn in thread if turn.ordinal == ordinal),
        )

        # The clock the record is timestamped by, read once on each side of the run. A
        # second time source would be a second thing to trust and to fake, and the moment an
        # attempt ended is already needed for `created_at`.
        started = self._clock.now()
        turn, usage = await self._answer(
            runtime, request, invoker, ordinal=ordinal, attempt=attempt
        )
        now = self._clock.now()
        written = self._agent_turns.append(
            AgentTurnRecord(
                run_id=run.run_id,
                experiment_id=record.experiment_id,
                turn=turn,
                created_at=now,
                duration_ms=_elapsed_ms(started, now),
                usage=usage,
            )
        )
        # After the attempt, so a call can never reference a turn that is not there — and
        # after a *failed* one too, because what the agent did before it broke is the most
        # informative part of a failure.
        events = self._tool_events.append_all(
            tuple(
                ToolEventRecord(
                    run_id=run.run_id,
                    experiment_id=record.experiment_id,
                    event=event,
                    created_at=now,
                )
                for event in invoker.events(ordinal=ordinal, attempt=attempt)
            )
        )
        # The same moment as the attempt and its calls: a fault fired inside this attempt,
        # and `after_calls` is what orders it among them. A clock read again here would
        # order the record by how long the writing took.
        fired = self._mutations.append_all(
            tuple(
                MutationEventRecord(
                    run_id=run.run_id,
                    experiment_id=record.experiment_id,
                    event=event,
                    created_at=now,
                )
                for event in mutations.events
            )
        )
        # Last, and from the measurements already taken rather than from a second reading of
        # anything. A trace is the one thing about an attempt the record cannot answer for
        # afterwards, so it is stored — and it is stored with the same numbers the rows above
        # carry, because two durations for one call is worse than none.
        self._trace(
            record,
            run,
            runtime,
            invoker,
            ordinal=ordinal,
            attempt=attempt,
            opened=opened,
            started=started,
            ended=now,
        )
        return RunTurn(turn=written, tool_events=events, mutation_events=fired)

    def _pin_endpoint(self, run: RunRecord, runtime: SupportAgentRuntime) -> None:
        """Pin the endpoint this advance reaches, or refuse to run against another.

        Three cases, enumerated rather than reasoned about, because the null means two
        different things and only one of them is a mismatch:

        - the runtime reaches no provider — the control arm, and an SDK double — so nothing
          is pinned and the arm's endpoint stays null, which is the truthful record that it
          reached none;
        - the run carries no endpoint yet, so this advance writes the one it reached, whether
          or not the attempt about to run succeeds: what the arm was produced against is true
          of a failed attempt too, and a failure is the part of the record most worth being
          able to attribute to an endpoint;
        - the run carries one already, and this advance would reach a different one, which is
          refused with both named and no turn recorded.

        The write and the comparison are one repository call for a reason: the endpoint in
        force has to be read *after* the attempt to claim it, or two advances racing on a
        fresh arm could each believe they pinned it.
        """
        reached = runtime.model_base_url
        if reached is None:
            return
        pinned = self._runs.pin_endpoint(run.run_id, reached)
        if pinned == reached:
            return
        raise ModelEndpointMismatchError(
            f"arm {run.label} was produced against {pinned} and this lab now reaches "
            f"{reached}; fork the experiment or start a new one to run against it"
        )

    def _trace(
        self,
        record: ExperimentRecord,
        run: RunRecord,
        runtime: SupportAgentRuntime,
        invoker: _RecordingInvoker,
        *,
        ordinal: int,
        attempt: int,
        opened: datetime,
        started: datetime,
        ended: datetime,
    ) -> None:
        """Record where inside this attempt each part of it ran.

        Three kinds, because three are what this process can honestly see: the advance, the
        framework's turn inside it, and each call back into the world. What sits *between*
        two tool spans is the framework thinking, and it is deliberately not a span of its
        own — the lab did not open it, does not know what happened in it, and a gap a reader
        can measure is more honest than a bar the lab invented a name for.
        """
        spans = (
            SpanDraft(
                kind=SpanKind.ATTEMPT,
                started_offset_ms=0,
                duration_ms=_elapsed_ms(opened, ended),
            ),
            SpanDraft(
                kind=SpanKind.RUNTIME,
                started_offset_ms=_elapsed_ms(opened, started),
                duration_ms=_elapsed_ms(started, ended),
            ),
            *invoker.spans(),
        )
        trace = self._tracer.record(
            AttemptTraceDraft(
                run_id=run.run_id,
                experiment_id=record.experiment_id,
                arm_position=run.position,
                framework_id=runtime.framework_id,
                ordinal=ordinal,
                attempt=attempt,
                started_at=opened,
                spans=spans,
            )
        )
        self._spans.append_all(
            tuple(
                RunSpanRecord(
                    run_id=run.run_id,
                    experiment_id=record.experiment_id,
                    trace_id=trace.trace_id,
                    span=span,
                    created_at=ended,
                )
                for span in trace.spans
            )
        )

    async def _answer(
        self,
        runtime: SupportAgentRuntime,
        request: AgentTurnRequest,
        invoker: _RecordingInvoker,
        *,
        ordinal: int,
        attempt: int,
    ) -> tuple[AgentTurn, ModelUsage | None]:
        """Run the framework and turn whatever came back into one recordable attempt.

        A failed attempt reports no usage. The tokens it spent before it broke are real, but
        they reach the lab only through an answer the framework never produced — and a
        number invented for a failure would be the one part of a cost comparison nobody
        could check.
        """
        try:
            answer = await runtime.answer(request, invoker)
        except SupportAgentRuntimeError as error:
            return self._failed(error.failure, ordinal=ordinal, attempt=attempt), None
        except DefinitionResolutionError:
            # An arm whose snapshot or pins no longer resolve is a broken lab, not something
            # the agent did, and ADR 0021 already refuses to answer that as a tool result.
            # Recording it as a failed turn would put it in a comparison as this framework's
            # behavior.
            raise
        except Exception as error:
            # An adapter that raised something it never classified is the lab's integration
            # breaking, not the model misbehaving. Logged by type alone, for the reason a
            # failed tool result carries no message: nothing can promise an arbitrary
            # exception's text is free of synthetic customer content (`AGENTS.md`).
            _logger.error(
                "agent runtime %s failed with %s", runtime.framework_id, type(error).__name__
            )
            return self._failed(AgentTurnFailure.FRAMEWORK, ordinal=ordinal, attempt=attempt), None

        reply = answer.body.strip()
        if not reply or len(reply) > MAX_AGENT_TURN_LENGTH:
            # A model that said nothing, and one that said more than the thread can hold,
            # are the same kind of finding: an answer the lab cannot record as the arm's
            # reply. Truncating would put words in the agent's mouth that it can then be
            # compared on.
            return (
                self._failed(AgentTurnFailure.INVALID_RESPONSE, ordinal=ordinal, attempt=attempt),
                None,
            )
        return (
            AgentTurn(
                ordinal=ordinal, attempt=attempt, outcome=AgentTurnOutcome.ANSWERED, body=reply
            ),
            answer.usage,
        )

    @staticmethod
    def _failed(failure: AgentTurnFailure, *, ordinal: int, attempt: int) -> AgentTurn:
        return AgentTurn(
            ordinal=ordinal, attempt=attempt, outcome=AgentTurnOutcome.FAILED, failure=failure
        )

    # -- the scenario's faults -------------------------------------------------

    def _scheduled(
        self, record: ExperimentRecord, run: RunRecord, *, ordinal: int, attempt: int
    ) -> ArmMutations:
        """This arm's fault schedule, with everything it has already met left out.

        Read from the scenario version the experiment pinned, so both arms carry the same
        schedule however far apart they have drifted (ADR 0028). What differs between them is
        only what each has already done: which faults have fired into this arm, and whether
        this arm has read the entity a fault is waiting on.
        """
        fired = frozenset(
            entry.event.mutation_id
            for entry in self._mutations.list_events(record.experiment_id)
            if entry.run_id == run.run_id
        )
        read: set[UUID] = set()
        for entry in self._tool_events.list_for_experiment(record.experiment_id):
            if entry.run_id == run.run_id:
                read.update(entities_read(entry.event.tool, entry.event.document))
        return self._mutations.open(
            schedule=self._mutations.schedule(record.scenario_id, record.scenario_version),
            shop_id=run.shop_id,
            sandbox_id=run.sandbox_id,
            ordinal=ordinal,
            attempt=attempt,
            fired=fired,
            read_entities=frozenset(read),
        )

    # -- resolution ------------------------------------------------------------

    def _resolve(self, record: ExperimentRecord, run: RunRecord) -> _ResolvedArm:
        """What this arm runs, read from the versions the experiment pinned.

        Deliberately not from the latest published anything. The snapshot holds the shop the
        scenario froze and the experiment document holds the identity version each arm
        froze; resolving either one afresh would make a historical run unexplainable as soon
        as an author publishes again.
        """
        snapshot = self._snapshots.get_snapshot(run.shop_id, record.snapshot_id)
        arm = self._arm_resolution(record, snapshot, run)
        configuration = self._version(
            self._configurations, arm.agent_configuration.ref, DefinitionType.AGENT_CONFIGURATION
        )
        identity_ref = self._identity_ref(arm, configuration)
        identity = self._version(
            self._support_identities, identity_ref, DefinitionType.SUPPORT_IDENTITY
        )
        shop = self._pinned_shop(snapshot)
        return _ResolvedArm(
            configuration=configuration,
            instructions=render_prompt(configuration, shop, identity),
            tools=tuple(
                contract
                for contract in SANDBOX_TOOL_CONTRACTS
                if contract.name in configuration.enabled_tools
            ),
            actor=ToolActor(
                support_identity_id=identity_ref.definition.id, version=identity_ref.version
            ),
        )

    @staticmethod
    def _arm_resolution(
        record: ExperimentRecord, snapshot: SandboxSnapshotRecord, run: RunRecord
    ) -> ArmResolution:
        arms = record.content(snapshot.content.pins).resolution.arms
        if run.position >= len(arms):  # pragma: no cover - one arm row per recorded arm
            raise MissingReferenceVersionError(
                f"experiment {record.experiment_id} records no inputs for arm {run.position}"
            )
        return arms[run.position]

    @staticmethod
    def _identity_ref(arm: ArmResolution, configuration: AgentConfigurationPayload) -> VersionRef:
        """The pinned version of the identity this configuration adopts.

        Matched by identity rather than taken as the closure's only entry: the arm's pins are
        a closure, and a closure is allowed to grow another support identity the day a
        configuration references two.
        """
        ref = next(
            (
                entry.ref
                for entry in arm.support_identities
                if entry.definition.id == configuration.support_identity_id
            ),
            None,
        )
        if ref is None:  # pragma: no cover - the setup gate resolved this closure
            raise MissingReferenceVersionError(
                f"this experiment pinned no version of support identity "
                f"{configuration.support_identity_id}"
            )
        return ref

    def _pinned_shop(self, snapshot: SandboxSnapshotRecord) -> ShopPayload:
        return self._version(self._shops, _pin(snapshot, DefinitionType.SHOP), DefinitionType.SHOP)

    @staticmethod
    def _version[PayloadT](
        repository: DefinitionRepository[PayloadT], ref: VersionRef, kind: DefinitionType
    ) -> PayloadT:
        version = repository.get_version(ref)
        if version is None:
            raise MissingReferenceVersionError(
                f"{kind.value} {ref.definition.id} version {ref.version} is not resolvable"
            )
        return version.payload

    # -- the thread ------------------------------------------------------------

    def _history(
        self,
        configuration: AgentConfigurationPayload,
        run: RunRecord,
        thread: tuple[ParticipantTurn, ...],
        ordinal: int,
    ) -> tuple[AgentMessage, ...]:
        """This arm's thread before the turn being answered, as the configuration allows.

        An empty history when the configuration keeps no conversation memory, which is a
        comparison variable rather than a runtime detail — two arms differing only in memory
        must actually differ. Failed attempts are absent: the agent never said them, and a
        history that carried them would ask the model to continue from words it did not
        write.
        """
        if configuration.memory is MemoryMode.NONE:
            return ()
        replies = {
            entry.turn.ordinal: entry.turn.body
            for entry in self._agent_turns.list_for_experiment(run.experiment_id)
            if entry.run_id == run.run_id and entry.turn.outcome is AgentTurnOutcome.ANSWERED
        }
        messages: list[AgentMessage] = []
        for turn in sorted(thread, key=lambda entry: entry.ordinal):
            if turn.ordinal >= ordinal:
                break
            messages.append(AgentMessage(role=AgentRole.CUSTOMER, body=turn.body))
            reply = replies.get(turn.ordinal)
            if reply is not None:
                messages.append(AgentMessage(role=AgentRole.AGENT, body=reply))
        return tuple(messages)

    def _recorded_mutations(self, turn: AgentTurnRecord) -> tuple[MutationEventRecord, ...]:
        return tuple(
            entry
            for entry in self._mutations.list_events(turn.experiment_id)
            if entry.run_id == turn.run_id
            and entry.event.ordinal == turn.turn.ordinal
            and entry.event.attempt == turn.turn.attempt
        )

    def _recorded(self, turn: AgentTurnRecord) -> tuple[ToolEventRecord, ...]:
        return tuple(
            entry
            for entry in self._tool_events.list_for_experiment(turn.experiment_id)
            if entry.run_id == turn.run_id
            and entry.event.ordinal == turn.turn.ordinal
            and entry.event.attempt == turn.turn.attempt
        )


@dataclass(frozen=True, slots=True)
class _ResolvedArm:
    """One arm's runtime inputs, resolved from what the experiment pinned."""

    configuration: AgentConfigurationPayload
    instructions: str
    tools: tuple[ToolContract, ...]
    actor: ToolActor


class _RecordingInvoker(SandboxToolInvoker):
    """The only path from a runtime to the world, and the thing that writes it down.

    Bound to one arm, one actor, and one tool set at construction, so a runtime cannot widen
    any of the three. It spends a budget rather than trusting a framework's own limit: the
    tool-round setting is a published input of the configuration (ADR 0024), and an SDK's
    usage limit would enforce it only for the SDKs that have one.

    The limit is spent per **call**. A round that made three calls spent three — the
    stricter reading, and the only one an evidence record can count, since a round is a
    framework's idea of a model request and this records what the arm was asked.

    It is also where the scenario's faults meet the run. Every call is followed by asking the
    schedule whether the world should move now, which is what lets a fault land between a
    proposal and the write that would have applied it (ADR 0028). The runtime cannot see the
    difference: it asked a tool, and the next thing it asks answers about a world that moved.
    """

    def __init__(
        self,
        *,
        tools: SandboxToolService,
        sandboxes: SandboxRepository,
        clock: Clock,
        opened: datetime,
        shop_id: UUID,
        sandbox_id: UUID,
        actor: ToolActor,
        contracts: tuple[ToolContract, ...],
        budget: int,
        mutations: ArmMutations,
    ) -> None:
        self._tools = tools
        self._sandboxes = sandboxes
        self._clock = clock
        self._opened = opened
        self._shop_id = shop_id
        self._sandbox_id = sandbox_id
        self._actor = actor
        self._contracts = contracts
        self._budget = budget
        self._mutations = mutations
        self._spent = 0
        self._calls: list[_Call] = []

    def invoke(self, tool: str, arguments: Mapping[str, str]) -> dict[str, CanonicalValue]:
        contract = next(
            (candidate for candidate in self._contracts if candidate.name == tool), None
        )
        if contract is None:
            # Not a refusal. A runtime is handed the tools it may offer, so a name that
            # reaches here is an adapter offering something the configuration never enabled
            # — the lab's mistake to see, exactly as an unknown tool name is (ADR 0021).
            raise SupportAgentFrameworkError(f"this arm was never offered a tool named {tool!r}")
        if self._spent >= self._budget:
            raise AgentToolBudgetExceededError(
                f"this configuration allows {self._budget} tool call(s) per turn"
            )
        self._spent += 1

        started = self._clock.now()
        execution = self._tools.execute(
            self._shop_id,
            self._sandbox_id,
            # The version is the lab's, not the agent's: the tool contract set is a pinned
            # input of the experiment, so an arm cannot ask for a different one. The actor
            # travels on every call, read or write, because it is the arm's identity rather
            # than a per-call choice; only a write consults it (ADR 0021).
            ToolCall(
                tool=contract.name,
                version=contract.version,
                arguments=dict(arguments),
                actor=self._actor,
            ),
        )
        after = self._sandboxes.get(self._shop_id, self._sandbox_id)
        if after is None:  # pragma: no cover - the call just read this arm
            raise SupportAgentFrameworkError("this arm disappeared while it was being run")
        # Measured over the call and the read that says where it left the arm, and stopped
        # before the fault check below: what a fault costs is the scenario's time, not the
        # tool's, and charging it to the call would make an arm look slower for having been
        # interfered with.
        duration_ms = _elapsed_ms(started, self._clock.now())
        self._calls.append(
            _Call(
                started_offset_ms=_elapsed_ms(self._opened, started),
                contract=contract,
                outcome=execution.result.outcome,
                document=execution.result.document,
                revision_before=execution.revision,
                revision_after=after.revision,
                state_fingerprint=after.state_fingerprint,
                duration_ms=duration_ms,
            )
        )
        # After the call is recorded, so a fault that fires now is recorded as having
        # happened after it — and after the answer is computed, so what this call reports is
        # the world the agent asked about rather than the one the fault left behind.
        self._mutations.after_call(contract.name, execution.result.document)
        return execution.result.document

    def spans(self) -> tuple[SpanDraft, ...]:
        """Where inside the attempt each call ran, from the same measurement its event has.

        The same `_Call` produces both, so a span's extent and its tool event's `duration_ms`
        are one number written twice rather than two answers to one question.
        """
        return tuple(
            SpanDraft(
                kind=SpanKind.TOOL,
                started_offset_ms=call.started_offset_ms,
                duration_ms=call.duration_ms,
                sequence=sequence,
                tool=call.contract.name,
                tool_version=call.contract.version,
            )
            for sequence, call in enumerate(self._calls)
        )

    def events(self, *, ordinal: int, attempt: int) -> tuple[ToolEvent, ...]:
        """The calls this attempt made, numbered in the order the agent asked."""
        return tuple(
            ToolEvent(
                ordinal=ordinal,
                attempt=attempt,
                sequence=sequence,
                tool=call.contract.name,
                version=call.contract.version,
                outcome=call.outcome,
                document=call.document,
                revision_before=call.revision_before,
                revision_after=call.revision_after,
                state_fingerprint=call.state_fingerprint,
                duration_ms=call.duration_ms,
            )
            for sequence, call in enumerate(self._calls)
        )


@dataclass(frozen=True, slots=True)
class _Call:
    """One executed call, held until the attempt it belongs to has a row to hang it on."""

    started_offset_ms: int
    contract: ToolContract
    outcome: ToolOutcome
    document: dict[str, CanonicalValue]
    revision_before: int
    revision_after: int
    state_fingerprint: str
    duration_ms: int
