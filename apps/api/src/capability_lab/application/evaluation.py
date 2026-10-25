"""Reading one arm's record against the objectives its scenario bound to it.

The domain decides what an observation means (`domain/evaluation.py`); this is where the
observation is made. Given the calls one arm's agent actually got answers from and the
sandbox that arm started in and is in now, it answers, objective by objective, whether the
thing the recipe asked for happened.

Five decisions shape it.

**The evidence kind says where to look; the polarity says what the answer means.**
`ObjectiveEvidence.FORBIDDEN` differs from `EVENT` in what finding the thing means, never in
how it is found, so the two share every reader. Writing a second set of "never" readers would
have been two implementations of one question, free to disagree the day a tool's result shape
moves. The one place the polarity does more than flip the outcome is how several bindings
combine: a required pair is met by both and a forbidden pair is violated by either.

**The lab declares what it can actually read.** `EVALUABLE_OBJECTIVES` is a table in the
same spirit as `APPLIABLE_MUTATIONS` (ADR 0028) and `sandbox_tool_contracts`: an evidence
kind is here because there is code that reads it and tests that keep reading it. `POLICY` is
absent because an encoded rule needs a rule registry that does not exist, and `DIMENSION` is
absent because no rule reads it — a judge does, and its verdict arrives here as a recorded
`Judgement` rather than as a reader (ADR 0031).

**An objective this build cannot decide is reported, never refused.** A fault that never
fires is invisible, so ADR 0028 refuses the experiment; an undecided objective is a row in
the matrix saying so, in the arm's own column, beside the ones that were decided. Refusing
to *start* an experiment because one of its objectives awaits the judge slice would make the
library unusable for exactly the scenarios it was authored for.

**A refusal is not a reading.** ADR 0021 made a refusal a value rather than an error, and a
refused call told the agent nothing about the world. An objective therefore reads what the
agent obtained, not what it asked for: a `get_document` that was refused did not read the
document, and a forbidden call that was refused revealed nothing.

**State is judged against the starting state, not against an expected value.** What a
scenario binds is a field, and what this reads is whether that field moved from what the
snapshot froze. A template that wanted to assert a particular *value* would be naming one
shop's data inside a shop-independent library (ADR 0017), which is the one thing a template
may never do.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import dataclass
from types import MappingProxyType
from uuid import UUID

from capability_lab.application.agent_turns import ToolEvent
from capability_lab.application.canonical_json import CanonicalValue
from capability_lab.application.definition_authoring import DefinitionRepository
from capability_lab.application.definition_resolution import MissingReferenceVersionError
from capability_lab.application.experiments import ExperimentDetail, ExperimentService
from capability_lab.application.judgements import JudgementRecord, JudgementRepository
from capability_lab.application.sandbox_tool_contracts import (
    CATALOG_PRODUCT,
    CUSTOMER_PROFILE,
    ORDER_DETAIL,
    SANDBOX_TOOL_CONTRACTS,
    SUPPORT_DOCUMENT,
)
from capability_lab.application.sandbox_tools import ToolOutcome
from capability_lab.domain.blocks import (
    BlockParameterKind,
    ObjectiveAssessment,
    ObjectiveBlockPayload,
    ObjectiveEvidence,
)
from capability_lab.domain.definitions import DefinitionType
from capability_lab.domain.evaluation import (
    ArmEvaluation,
    DecidingCall,
    EvidencePolarity,
    ObjectiveOutcome,
    ObjectiveResult,
    decide,
)
from capability_lab.domain.experiment import ArmAwaiting, ArmStanding
from capability_lab.domain.judge import JudgeOutcome
from capability_lab.domain.judgement import Judgement
from capability_lab.domain.order_fixture import OrderFixturePayload
from capability_lab.domain.sandbox import SandboxState
from capability_lab.domain.scenario import (
    BoundObjective,
    DataReference,
    ScenarioEntityKind,
    parse_data_reference,
    parse_document_reference,
    parse_entity_reference,
)

__all__ = [
    "ENTITY_READS",
    "EVALUABLE_OBJECTIVES",
    "OBJECTIVE_READERS",
    "ORDER_FIELD_READERS",
    "PUBLISHED_TOOLS",
    "ArmEvidence",
    "EvaluableObjective",
    "ExperimentEvaluation",
    "ExperimentEvaluationService",
    "Observation",
    "deciding_call",
    "evaluate_arm",
    "judge_objective",
    "latest_judgements",
    "pinned_objective_templates",
]


@dataclass(frozen=True, slots=True)
class Observation:
    """What one arm's record says about one binding.

    `decidable` is what separates "this build read the record and the thing is not there"
    from "this build cannot read that at all". Both are false observations and they mean
    opposite things about the agent.

    `call` is the recorded call the reading found, when a call is what it found: the first
    answer that named the thing, which is the one the reading stopped at. A field read off
    two states finds no call, and says so with `None`.
    """

    detail: str
    observed: bool = False
    decidable: bool = True
    call: ToolEvent | None = None


@dataclass(frozen=True, slots=True)
class ArmEvidence:
    """Everything one arm is judged on: what it obtained, and what its world did.

    The calls are this arm's alone and every attempt is included, failed ones as well: an
    agent that read the policy in an attempt that later failed still read the policy, and the
    retry beside it is a property of the attempt rather than of what the agent has seen
    (ADR 0028 made the same call for a fault's "after the first read").
    """

    run_id: UUID
    calls: tuple[ToolEvent, ...]
    starting: SandboxState
    current: SandboxState

    def answered(self, tool: str) -> tuple[ToolEvent, ...]:
        """This arm's successful calls to one tool, in the order it made them.

        Sorted here rather than trusted from the listing, because the first of them is the
        one a reading names as its evidence (`Observation.call`).
        """
        return tuple(
            sorted(
                (
                    call
                    for call in self.calls
                    if call.tool == tool and call.outcome is ToolOutcome.SUCCESS
                ),
                key=_coordinate,
            )
        )


def _coordinate(call: ToolEvent) -> DecidingCall:
    """Where one call sits in its arm: the turn, the attempt at it, the order it was asked."""
    return DecidingCall(ordinal=call.ordinal, attempt=call.attempt, sequence=call.sequence)


ObjectiveReader = Callable[[ArmEvidence, str], Observation]


def _data(call: ToolEvent) -> Mapping[str, CanonicalValue]:
    """The `data` section of a `tool-result-v1` envelope, or nothing readable."""
    data = call.document.get("data")
    return data if isinstance(data, dict) else {}


def document_read(evidence: ArmEvidence, value: str) -> Observation:
    """Whether this arm read the shop document a binding names."""
    reference = parse_document_reference(value)
    if reference is None:  # pragma: no cover - the publish gate resolved every binding
        return Observation(decidable=False, detail=f"{value} does not name a shop document")
    for call in evidence.answered(SUPPORT_DOCUMENT):
        data = _data(call)
        if (
            data.get("kind") == reference.kind.value
            and data.get("document_id") == reference.document_id
        ):
            return Observation(
                observed=True, detail=f"{SUPPORT_DOCUMENT} answered {value}", call=call
            )
    return Observation(detail=f"{SUPPORT_DOCUMENT} never answered {value}")


# The tool that puts one entity in front of the agent, and the field its result names the
# entity by. A listing is deliberately not here: it tells an agent that an order exists,
# where reading is what puts its address, its status, and its history in front of it.
ENTITY_READS: Mapping[ScenarioEntityKind, tuple[str, str]] = MappingProxyType(
    {
        ScenarioEntityKind.ORDER: (ORDER_DETAIL, "order_id"),
        ScenarioEntityKind.PRODUCT: (CATALOG_PRODUCT, "handle"),
        ScenarioEntityKind.CUSTOMER: (CUSTOMER_PROFILE, "customer_profile_id"),
    }
)


def entity_read(evidence: ArmEvidence, value: str) -> Observation:
    """Whether this arm looked up the shop object a binding names."""
    reference = parse_entity_reference(value)
    if reference is None:  # pragma: no cover - the publish gate resolved every binding
        return Observation(decidable=False, detail=f"{value} does not name a shop object")
    tool, field = ENTITY_READS[reference.kind]
    for call in evidence.answered(tool):
        if _data(call).get(field) == reference.identifier:
            return Observation(observed=True, detail=f"{tool} answered {value}", call=call)
    return Observation(detail=f"{tool} never answered {value}")


PUBLISHED_TOOLS: frozenset[str] = frozenset(contract.name for contract in SANDBOX_TOOL_CONTRACTS)
"""Every tool name a binding may name, read off the contract registry rather than listed."""


def tool_called(evidence: ArmEvidence, value: str) -> Observation:
    """Whether this arm got an answer out of the tool a binding names."""
    if value not in PUBLISHED_TOOLS:
        return Observation(decidable=False, detail=f"{value} is not a tool this lab publishes")
    answers = evidence.answered(value)
    if answers:
        return Observation(observed=True, detail=f"{value} answered this arm", call=answers[0])
    return Observation(detail=f"{value} never answered this arm")


# Every field `DATA_FIELDS` lets a scenario bind on an order, and how to read it out of the
# document an arm holds. Derived properties are read exactly as authored ones: what a
# scenario binds is what an agent would see, and a total that moved because a line changed
# is a total that moved.
ORDER_FIELD_READERS: Mapping[str, Callable[[OrderFixturePayload], object]] = MappingProxyType(
    {
        "shipping_address": lambda payload: payload.shipping_address,
        "line_items": lambda payload: payload.lines,
        "payment": lambda payload: payload.payment,
        "total": lambda payload: payload.total,
        "events": lambda payload: payload.events,
    }
)


def field_changed(evidence: ArmEvidence, value: str) -> Observation:
    """Whether the field a binding names is not what this arm started with."""
    reference = parse_data_reference(value)
    if reference is None:  # pragma: no cover - the publish gate resolved every binding
        return Observation(decidable=False, detail=f"{value} does not name a field")
    if reference.entity.kind is not ScenarioEntityKind.ORDER:
        # A sandbox holds this customer's orders and nothing else (ADR 0019): a customer or
        # product field is pinned in a published version, so no arm can have moved it.
        return Observation(
            decidable=False,
            detail=f"a sandbox holds no {reference.entity.kind.value} state to compare",
        )
    reader = ORDER_FIELD_READERS.get(reference.field)
    if reader is None:  # pragma: no cover - the publish gate resolved every binding
        return Observation(decidable=False, detail=f"{reference.field} is not a readable field")
    return _order_field(evidence, reference, reader)


def _order_field(
    evidence: ArmEvidence,
    reference: DataReference,
    reader: Callable[[OrderFixturePayload], object],
) -> Observation:
    order_id = reference.entity.entity_id
    before = None if order_id is None else evidence.starting.order(order_id)
    after = None if order_id is None else evidence.current.order(order_id)
    if before is None or after is None:  # pragma: no cover - both arms clone one snapshot
        return Observation(decidable=False, detail=f"this arm holds no order {order_id}")
    if reader(before.payload) == reader(after.payload):
        return Observation(detail=f"{reference.value} is what this arm started with")
    return Observation(observed=True, detail=f"{reference.value} moved from its starting value")


OBJECTIVE_READERS: Mapping[BlockParameterKind, ObjectiveReader] = MappingProxyType(
    {
        BlockParameterKind.DOCUMENT_REFERENCE: document_read,
        BlockParameterKind.ENTITY_REFERENCE: entity_read,
        BlockParameterKind.TOOL_REFERENCE: tool_called,
        BlockParameterKind.DATA_REFERENCE: field_changed,
    }
)
"""What each kind of binding is read from. The literal kinds are absent: a severity, a
timing, a duration, and free text name nothing an arm can have done."""


@dataclass(frozen=True, slots=True)
class EvaluableObjective:
    """One evidence kind this build reads, and what a reading of it means.

    `reads` is what the code can answer, which is a property of the readers rather than of
    the template: a state objective bound to a tool is asking whether a tool changed, and
    nothing here answers that.
    """

    evidence: ObjectiveEvidence
    polarity: EvidencePolarity
    reads: frozenset[BlockParameterKind]


_OBSERVABLE = frozenset(OBJECTIVE_READERS)

EVALUABLE_OBJECTIVES: Mapping[ObjectiveEvidence, EvaluableObjective] = MappingProxyType(
    {
        ObjectiveEvidence.EVENT: EvaluableObjective(
            evidence=ObjectiveEvidence.EVENT,
            polarity=EvidencePolarity.MUST_OCCUR,
            reads=frozenset(
                {
                    BlockParameterKind.DOCUMENT_REFERENCE,
                    BlockParameterKind.ENTITY_REFERENCE,
                    BlockParameterKind.TOOL_REFERENCE,
                }
            ),
        ),
        ObjectiveEvidence.STATE: EvaluableObjective(
            evidence=ObjectiveEvidence.STATE,
            polarity=EvidencePolarity.MUST_OCCUR,
            reads=frozenset({BlockParameterKind.DATA_REFERENCE}),
        ),
        ObjectiveEvidence.FORBIDDEN: EvaluableObjective(
            evidence=ObjectiveEvidence.FORBIDDEN,
            polarity=EvidencePolarity.MUST_NOT_OCCUR,
            reads=_OBSERVABLE,
        ),
    }
)
"""The evidence this build reads. The two absent kinds are absent on purpose.

`policy` is a rule evaluated against a run, and this lab publishes no rule registry for a
template to name — writing one rule per scenario in Python would put the recipe back in the
code the Studio exists to replace. `dimension` is a judge's, and a judge is a published
definition whose verdict is recorded (ADR 0031): what fills that row is a `Judgement`, read
here, never a reader written here.
"""


def judge_objective(
    objective: BoundObjective,
    template: ObjectiveBlockPayload,
    version: int,
    evidence: ArmEvidence,
    *,
    settled: bool,
    judgement: Judgement | None = None,
) -> ObjectiveResult:
    """One bound objective, as this arm's record answers it.

    How several bindings combine follows the polarity, because "and" inverts to "or": an
    objective that asks for two documents asks for *both*, and one that forbids two documents
    is violated by *either*. Reading a forbidden pair conjunctively would let an arm touch one
    of two things it was told never to touch and be reported as having kept the rule.
    """
    contract = EVALUABLE_OBJECTIVES.get(template.evidence)
    if template.assessment is ObjectiveAssessment.JUDGE:
        return _judged(objective, template, version, judgement)
    if contract is None:
        return _undecided(
            objective,
            template,
            version,
            ObjectiveOutcome.UNDECIDABLE,
            f"this build reads no {template.evidence.value} evidence",
        )
    observations = _observations(objective, template, contract, evidence)
    if not observations:
        return _undecided(
            objective,
            template,
            version,
            ObjectiveOutcome.UNDECIDABLE,
            f"this instance binds nothing {template.evidence.value} evidence is read from",
        )
    undecidable = tuple(entry for entry in observations if not entry.decidable)
    if undecidable:
        return _undecided(
            objective,
            template,
            version,
            ObjectiveOutcome.UNDECIDABLE,
            "; ".join(entry.detail for entry in undecidable),
        )
    outcome = decide(
        contract.polarity,
        observed=_combined(contract.polarity, observations),
        settled=settled,
    )
    return _result(
        objective,
        template,
        version,
        outcome=outcome,
        detail="; ".join(entry.detail for entry in observations),
        decided_by=deciding_call(contract.polarity, outcome, observations),
    )


def deciding_call(
    polarity: EvidencePolarity,
    outcome: ObjectiveOutcome,
    observations: tuple[Observation, ...],
) -> DecidingCall | None:
    """The one recorded call an outcome rests on, or `None` when no single call decided it.

    A call decides exactly two verdicts: a requirement met, and a prohibition broken. A
    requirement met by several readings was decided by the *last* of them — until it, the
    objective was still pending — and a prohibition broken by several was decided by the
    *first*, because nothing after it could unmake the miss. Every other row names none:
    a miss or a kept prohibition is an absence, a pending row is undecided, and a reading
    that found no call (a field that moved between two states) cannot say which event moved
    it. When any reading that counted found no call, the row names none rather than the
    calls it can see, because ordering those against a state change would be a guess.
    """
    if polarity is EvidencePolarity.MUST_OCCUR and outcome is not ObjectiveOutcome.MET:
        # Half of a pair read is still pending; the read it has is not what decided it.
        return None
    # A prohibition needs no such gate: it is missed exactly when some reading found it.
    found = [entry.call for entry in observations if entry.observed]
    calls = [_coordinate(call) for call in found if call is not None]
    if not calls or len(calls) != len(found):
        return None
    return max(calls) if polarity is EvidencePolarity.MUST_OCCUR else min(calls)


# What a judge's verdict is, in the vocabulary the matrix reports. `UNCLEAR` becomes
# `UNDECIDABLE` because it says the same thing the unread evidence kinds say: this evidence
# does not settle the question. It is deliberately not a miss — a judge asked to choose
# between met and missed when the record does not say would be guessing, and a recorded
# guess is the leaderboard scoring `docs/PLAN.md` refuses.
JUDGE_OUTCOMES: Mapping[JudgeOutcome, ObjectiveOutcome] = MappingProxyType(
    {
        JudgeOutcome.MET: ObjectiveOutcome.MET,
        JudgeOutcome.MISSED: ObjectiveOutcome.MISSED,
        JudgeOutcome.UNCLEAR: ObjectiveOutcome.UNDECIDABLE,
    }
)


def _judged(
    objective: BoundObjective,
    template: ObjectiveBlockPayload,
    version: int,
    judgement: Judgement | None,
) -> ObjectiveResult:
    """The row a judge owns: what the standing verdict says, or that none has been made.

    An execution that failed leaves the row exactly where it stood — deferred while nothing
    has ever scored it, and carrying the verdict that already stands when something has
    (`latest_judgements`) — because a provider that refused said nothing about the arm.
    Reporting the lab's own outage as a miss is the mistake ADR 0030 built `deferred` and
    `undecidable` to prevent, and a failed judge is the clearest case of it.
    """
    if judgement is None:
        return _undecided(
            objective,
            template,
            version,
            ObjectiveOutcome.DEFERRED,
            f"a judge scores this {template.evidence.value}; none has",
        )
    if judgement.outcome is None:
        return _result(
            objective,
            template,
            version,
            outcome=ObjectiveOutcome.DEFERRED,
            detail=f"the judge produced no verdict ({_failure(judgement)}); scoring again may",
            judgement=judgement,
        )
    return _result(
        objective,
        template,
        version,
        outcome=JUDGE_OUTCOMES[judgement.outcome],
        # The judge's own words, unedited. A verdict with no reason is a score, which is the
        # one thing this matrix must never report.
        detail=judgement.rationale or "the judge gave no reason",
        judgement=judgement,
    )


def _failure(judgement: Judgement) -> str:
    return "unclassified" if judgement.failure is None else judgement.failure.value


def _combined(polarity: EvidencePolarity, observations: tuple[Observation, ...]) -> bool:
    """Several readings as one, in the sense the polarity gives them.

    `all` for something required and `any` for something forbidden — De Morgan, and the one
    place the two polarities are not the same code path.
    """
    if polarity is EvidencePolarity.MUST_OCCUR:
        return all(entry.observed for entry in observations)
    return any(entry.observed for entry in observations)


def _observations(
    objective: BoundObjective,
    template: ObjectiveBlockPayload,
    contract: EvaluableObjective,
    evidence: ArmEvidence,
) -> tuple[Observation, ...]:
    """One reading per binding this evidence kind is read from, in parameter order."""
    bound = objective.binding_values
    return tuple(
        OBJECTIVE_READERS[parameter.kind](evidence, bound[parameter.name])
        for parameter in template.parameters
        if parameter.kind in contract.reads and parameter.name in bound
    )


def _undecided(
    objective: BoundObjective,
    template: ObjectiveBlockPayload,
    version: int,
    outcome: ObjectiveOutcome,
    detail: str,
) -> ObjectiveResult:
    return _result(objective, template, version, outcome=outcome, detail=detail)


def _result(
    objective: BoundObjective,
    template: ObjectiveBlockPayload,
    version: int,
    *,
    outcome: ObjectiveOutcome,
    detail: str,
    judgement: Judgement | None = None,
    decided_by: DecidingCall | None = None,
) -> ObjectiveResult:
    return ObjectiveResult(
        objective_id=objective.id,
        block_id=objective.block_id,
        block_version=version,
        statement=template.statement,
        severity=objective.severity,
        assessment=template.assessment,
        evidence=template.evidence,
        outcome=outcome,
        detail=detail,
        judgement=judgement,
        decided_by=decided_by,
    )


def evaluate_arm(
    objectives: tuple[BoundObjective, ...],
    templates: Mapping[UUID, tuple[ObjectiveBlockPayload, int]],
    evidence: ArmEvidence,
    standing: ArmStanding,
    judgements: Mapping[str, Judgement] = MappingProxyType({}),
) -> ArmEvaluation:
    """Every objective of one arm, in the order the scenario composed them.

    Objective order is priority (ADR 0018) and it is preserved: the matrix reads top to
    bottom in the order the author decided matters.

    `judgements` is the latest verdict recorded for each of this arm's rows. Empty is the
    ordinary case — nothing has been scored — and it produces exactly the deferred rows this
    module produced before there was a judge at all.
    """
    settled = standing.awaiting is ArmAwaiting.COMPLETED
    results: list[ObjectiveResult] = []
    for objective in objectives:
        pinned = templates.get(objective.block_id)
        if pinned is None:  # pragma: no cover - publishing pinned every composed template
            raise MissingReferenceVersionError(
                f"{objective.id} names a template this scenario version does not pin"
            )
        template, version = pinned
        results.append(
            judge_objective(
                objective,
                template,
                version,
                evidence,
                settled=settled,
                judgement=judgements.get(objective.id),
            )
        )
    return ArmEvaluation(run_id=evidence.run_id, settled=settled, results=tuple(results))


def latest_judgements(
    records: tuple[JudgementRecord, ...], run_id: UUID
) -> Mapping[str, Judgement]:
    """The execution that stands for each of one arm's rows: the latest that said anything.

    Every attempt is kept (ADR 0031), and what the matrix reads is the newest *verdict* —
    scoring again is how an operator answers "does the verdict hold", and the answer is the
    new one.

    A failed attempt is the exception, and it is ADR 0030's own exception one level up: a
    provider that refused said **nothing about the arm**. An outage is an absence of new
    information rather than new information, so it can no more unmake a verdict than it can
    make a miss — the verdict already recorded goes on standing, and the failure stays
    readable as the attempt beside it. Reading the latest attempt unconditionally would let
    a provider that was briefly down silently delete evidence an operator paid a model to
    produce, on a row a judge had actually decided. A row whose executions have *only* ever
    failed still reads as unscored, which is the case that rule started from (ADR 0040
    narrows ADR 0031's "the matrix reads the latest attempt" to exactly this).
    """
    standing: dict[str, Judgement] = {}
    for entry in records:
        if entry.run_id != run_id:
            continue
        judgement = entry.judgement
        if _supersedes(judgement, standing.get(judgement.objective_id)):
            standing[judgement.objective_id] = judgement
    return standing


def _supersedes(candidate: Judgement, standing: Judgement | None) -> bool:
    """Whether one execution replaces the one currently standing on a row.

    A verdict is replaced only by a later verdict; a failure stands only until something is
    actually scored, and is replaced by a later failure while nothing has been. Which is
    what keeps "the judge was unreachable this afternoon" from reading as "this row was
    never decided".
    """
    if standing is None:
        return True
    if candidate.scored is not standing.scored:
        return candidate.scored
    return candidate.attempt >= standing.attempt


def pinned_objective_templates(
    detail: ExperimentDetail, objective_blocks: DefinitionRepository[ObjectiveBlockPayload]
) -> Mapping[UUID, tuple[ObjectiveBlockPayload, int]]:
    """Each objective template at the version the scenario's publication pinned.

    Never as it reads now: an objective edited after the publication must not change what a
    historical experiment was judged against, which is the whole reason publishing pinned a
    version of it (ADR 0018). Shared with the judge service (ADR 0031) rather than copied,
    so a verdict and a deterministic row can never be about different template versions.
    """
    pinned: dict[UUID, tuple[ObjectiveBlockPayload, int]] = {}
    for reference in detail.scenario.published.references:
        if reference.definition.definition_type is not DefinitionType.OBJECTIVE_BLOCK:
            continue
        record = objective_blocks.get_version(reference)
        if record is None:
            raise MissingReferenceVersionError(
                f"objective block {reference.definition.id} version {reference.version} "
                "is not resolvable"
            )
        pinned[reference.definition.id] = (record.payload, reference.version)
    return pinned


@dataclass(frozen=True, slots=True)
class ExperimentEvaluation:
    """Both arms judged against one scenario's objectives, arm by arm in arm order."""

    experiment_id: UUID
    arms: tuple[ArmEvaluation, ...]


class ExperimentEvaluationService:
    """Read one experiment and judge each arm against the objectives its scenario bound.

    Holds no repository but the objective library and the judgement store, for the reason
    the timeline holds none (ADR 0027): everything else is what `getExperiment` already
    serves, so an evaluation cannot describe an experiment differently from the threads it
    was read out of. The templates are an exception because they are resolved at the
    versions the scenario pinned, and the judgements because a verdict is a record of its
    own — the one thing about an evaluation that is not a function of the run (ADR 0031).
    """

    def __init__(
        self,
        experiments: ExperimentService,
        objective_blocks: DefinitionRepository[ObjectiveBlockPayload],
        judgements: JudgementRepository,
    ) -> None:
        self._experiments = experiments
        self._objective_blocks = objective_blocks
        self._judgements = judgements

    def evaluate(self, shop_id: UUID, experiment_id: UUID) -> ExperimentEvaluation:
        return self.evaluate_detail(self._experiments.get_experiment(shop_id, experiment_id))

    def evaluate_detail(self, detail: ExperimentDetail) -> ExperimentEvaluation:
        """Judge an experiment already in hand.

        Split out for the caller that reads several experiments at once (history): reading
        one back a second time to evaluate it would be two readings of one record, which is
        the disagreement every projection in this codebase is shaped to prevent.
        """
        experiment_id = detail.record.experiment_id
        objectives = detail.scenario.payload.objectives
        templates = pinned_objective_templates(detail, self._objective_blocks)
        judged = self._judgements.list_for_experiment(experiment_id)
        return ExperimentEvaluation(
            experiment_id=experiment_id,
            arms=tuple(
                evaluate_arm(
                    objectives,
                    templates,
                    self._evidence(detail, index),
                    standing,
                    latest_judgements(judged, detail.runs[index].run_id),
                )
                for index, standing in enumerate(detail.standings)
            ),
        )

    def _evidence(self, detail: ExperimentDetail, index: int) -> ArmEvidence:
        run = detail.runs[index]
        return ArmEvidence(
            run_id=run.run_id,
            calls=tuple(entry.event for entry in detail.tool_events if entry.run_id == run.run_id),
            starting=detail.starting_state,
            current=detail.sandboxes[index].content.state,
        )
