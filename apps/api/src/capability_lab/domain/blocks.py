"""Objective and mutation blocks: the shared, parameterized templates a scenario composes.

A block is a versioned definition (ADR 0012) that says *what* is asserted or injected
without saying *which objects* it applies to. The objects arrive later: a scenario binds the
template's parameters to its own shop's documents, orders, and customers, and pins the exact
template version it composed. That split is the whole point — one `read-required-document`
template serves every shop, and a shop can never leak into another through a template.

Two consequences shape everything below:

- **A template is shop-independent, so it may not name a shop object anywhere.** The closest
  a parameter comes is declaring the *kind* of shop object a binding must resolve to.
  `SHOP_BOUND_PARAMETER_KINDS` is that declaration, and it is what a scenario's publish gate
  will check its bindings against.
- **Timing separates the two block types.** Mutation order is the run timeline, so a
  published mutation block declares exactly one timing parameter. Objective order is
  priority only — scenarios stay goal-based and never imply a scripted conversation — so an
  objective block may not declare timing at all.

The two payloads live in one module because they are the same template with a different
type axis: an objective declares how it is assessed and what evidence it reads, a mutation
declares what it perturbs. Splitting them would duplicate the parameter model, which is the
part that actually has rules.
"""

from __future__ import annotations

import re
from collections.abc import Mapping
from dataclasses import dataclass
from enum import StrEnum
from functools import partial

from capability_lab.domain.content import (
    require_identifier,
    require_instance,
    require_slug,
    require_text,
    require_unique,
)
from capability_lab.domain.definitions import (
    DefinitionChange,
    DefinitionChangeKind,
    DefinitionIssue,
    DefinitionValidation,
    diff_keyed_collection,
    issue_error,
    issue_warning,
    validation_of,
)
from capability_lab.domain.entities import DomainError

MAX_BLOCK_PARAMETERS = 8


class BlockConfigurationError(DomainError):
    """Raised when block content violates a structural invariant."""


_error_type = BlockConfigurationError
_require_slug = partial(require_slug, error=_error_type)
_require_identifier = partial(require_identifier, error=_error_type)
_require_text = partial(require_text, error=_error_type)
_require_unique = partial(require_unique, error=_error_type)
_require_instance = partial(require_instance, error=_error_type)


class BlockParameterKind(StrEnum):
    """What a scenario must supply for one parameter.

    A closed enumeration, extended in code: the scenario editor offers a picker per kind and
    the runtime resolves a binding by kind, so a kind that does not exist here can never be
    bound to anything.
    """

    DOCUMENT_REFERENCE = "document_reference"
    """A shop document — a policy, support guideline, or FAQ entry."""

    ENTITY_REFERENCE = "entity_reference"
    """A shop-scoped commerce object — an order, customer, or product."""

    DATA_REFERENCE = "data_reference"
    """A named field of a shop object, such as the address an agent must not reveal."""

    TOOL_REFERENCE = "tool_reference"
    """A versioned tool the lab exposes. Lab-wide, so it is not a shop binding."""

    SEVERITY = "severity"
    """`required` (the objective fails when missed) or `expected` (it warns)."""

    TIMING = "timing"
    """When a mutation fires on the run timeline."""

    DURATION = "duration"
    """A span of sandbox time, as an ISO 8601 duration."""

    TEXT = "text"
    """Free authored text, for a template whose parameter names no object at all."""


# The kinds whose binding must resolve inside the scenario's own shop. A template names no
# shop object itself; this is how it states the rule a binding has to satisfy, and it is the
# single source the scenario publish gate reads. `TOOL_REFERENCE` is deliberately absent:
# tools belong to the lab, not to a shop.
SHOP_BOUND_PARAMETER_KINDS: frozenset[BlockParameterKind] = frozenset(
    {
        BlockParameterKind.DOCUMENT_REFERENCE,
        BlockParameterKind.ENTITY_REFERENCE,
        BlockParameterKind.DATA_REFERENCE,
    }
)

# Kinds whose value is a literal the template can carry a default for. The complement is
# exactly `SHOP_BOUND_PARAMETER_KINDS` plus tool references, which name things a template
# has no business choosing on a scenario's behalf.
LITERAL_PARAMETER_KINDS: frozenset[BlockParameterKind] = frozenset(
    {
        BlockParameterKind.SEVERITY,
        BlockParameterKind.TIMING,
        BlockParameterKind.DURATION,
        BlockParameterKind.TEXT,
    }
)


class ObjectiveSeverity(StrEnum):
    """What a missed objective does to the run.

    A read-check is the motivating case: reading the right document is a means, not the end,
    so a scenario decides per binding whether missing it fails the objective or only warns.
    The read/no-read event is recorded evidence either way.
    """

    REQUIRED = "required"
    EXPECTED = "expected"


class ObjectiveAssessment(StrEnum):
    """Who decides whether the objective was met."""

    DETERMINISTIC = "deterministic"
    JUDGE = "judge"


class ObjectiveEvidence(StrEnum):
    """What the assessment reads."""

    EVENT = "event"
    """A recorded tool event — that a read or call happened, with which arguments."""

    POLICY = "policy"
    """An encoded rule evaluated against the run's state and events."""

    STATE = "state"
    """The sandbox state the run ended in, compared against what it started from."""

    FORBIDDEN = "forbidden"
    """Something that must never occur; the objective fails when it does."""

    DIMENSION = "dimension"
    """A rubric dimension an LLM judge scores. Never deterministic."""


# A judge scores a rubric dimension and nothing else; deterministic evidence is recorded
# fact, which a dimension is not. Keeping the pairing here rather than in the validator lets
# the contract and the editor offer only the combinations that exist.
JUDGE_EVIDENCE: frozenset[ObjectiveEvidence] = frozenset({ObjectiveEvidence.DIMENSION})
DETERMINISTIC_EVIDENCE: frozenset[ObjectiveEvidence] = frozenset(
    {
        ObjectiveEvidence.EVENT,
        ObjectiveEvidence.POLICY,
        ObjectiveEvidence.STATE,
        ObjectiveEvidence.FORBIDDEN,
    }
)


class MutationEffect(StrEnum):
    """What a mutation perturbs when the runtime injects it.

    Mutations are applied to the sandbox, never exposed as agent tools: an arm observes the
    consequence and never the cause. The effect says which part of the sandbox moves.
    """

    ENTITY_MUTATION = "entity_mutation"
    """An out-of-band write to a sandbox entity, bumping the version an arm holds."""

    TOOL_FAULT = "tool_fault"
    """A tool that fails, times out, or returns an error for a bound span."""

    CLOCK_SHIFT = "clock_shift"
    """Sandbox time jumps forward, ageing deadlines and windows."""

    SERVICE_OUTAGE = "service_outage"
    """A simulated dependency is unavailable for a bound window."""


# An ISO 8601 duration restricted to whole days, hours, minutes, and seconds: the sandbox has
# no calendar arithmetic, so months and years — whose length depends on when they start —
# would not have one answer.
_DURATION_PATTERN = re.compile(r"P(?:(\d+)D)?(?:T(?=\d)(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?")
_AT_TURN_PREFIX = "at_turn:"
_AT_TURN_PATTERN = re.compile(r"at_turn:([1-9]\d*)")
_AT_OFFSET_PREFIX = "at_offset:"
AFTER_FIRST_READ = "after_first_read"


def is_duration(value: str) -> bool:
    """Whether a bound value is a duration the sandbox can advance by."""
    match = _DURATION_PATTERN.fullmatch(value)
    return match is not None and any(group is not None for group in match.groups())


class MutationTimingKind(StrEnum):
    """The three forms a bound moment takes, matching what a runtime can observe.

    A closed set for the same reason `BlockParameterKind` is one: a scenario runtime decides
    whether a mutation is due by branching on the kind, so a form that is not here can never
    come due.
    """

    AFTER_FIRST_READ = "after_first_read"
    """The first time this arm reads the entity the mutation is bound to."""

    AT_TURN = "at_turn"
    """A turn ordinal, counting the customer turns this arm has received.

    The scenario's triggering message is turn zero and the grammar starts at one, so
    `at_turn:1` is the first turn a participant drove rather than the message the ticket
    froze. A fault bound to the opening would be part of the starting state, which is the
    snapshot's job (ADR 0019) rather than a fault's.
    """

    AT_OFFSET = "at_offset"
    """A span of sandbox time after the run started."""


@dataclass(frozen=True, slots=True)
class MutationTiming:
    """One bound moment, read out of the literal a scenario wrote.

    Parsed rather than matched again wherever it is needed. The grammar is authored text on
    one side and a runtime decision on the other, and a second reading of the same string
    somewhere else is how the two come apart.
    """

    kind: MutationTimingKind
    turn: int | None = None
    offset: str | None = None

    def __post_init__(self) -> None:
        _require_instance(self.kind, MutationTimingKind, "a timing must name its form")
        if (self.kind is MutationTimingKind.AT_TURN) != (self.turn is not None):
            raise BlockConfigurationError("only a turn timing names a turn")
        if (self.kind is MutationTimingKind.AT_OFFSET) != (self.offset is not None):
            raise BlockConfigurationError("only an offset timing names a duration")

    @property
    def value(self) -> str:
        """The literal a scenario binds, so a parse round-trips to what was authored."""
        if self.kind is MutationTimingKind.AT_TURN:
            return f"{_AT_TURN_PREFIX}{self.turn}"
        if self.kind is MutationTimingKind.AT_OFFSET:
            return f"{_AT_OFFSET_PREFIX}{self.offset}"
        return AFTER_FIRST_READ


def parse_timing(value: str) -> MutationTiming | None:
    """Read a bound timing literal, or `None` when the value is not one.

    The single reading of the grammar: `is_timing` is this function answering whether it
    understood, so a publish gate cannot accept a form the runtime then fails to resolve.
    """
    if value == AFTER_FIRST_READ:
        return MutationTiming(kind=MutationTimingKind.AFTER_FIRST_READ)
    turn = _AT_TURN_PATTERN.fullmatch(value)
    if turn is not None:
        return MutationTiming(kind=MutationTimingKind.AT_TURN, turn=int(turn.group(1)))
    if value.startswith(_AT_OFFSET_PREFIX):
        offset = value.removeprefix(_AT_OFFSET_PREFIX)
        if is_duration(offset):
            return MutationTiming(kind=MutationTimingKind.AT_OFFSET, offset=offset)
    return None


def is_timing(value: str) -> bool:
    """Whether a bound value names a moment on the run timeline."""
    return parse_timing(value) is not None


def is_severity(value: str) -> bool:
    return value in {severity.value for severity in ObjectiveSeverity}


def literal_value_is_valid(kind: BlockParameterKind, value: str) -> bool:
    """Whether a literal value fits its parameter's kind.

    Reference kinds are absent on purpose: nothing here can tell whether a shop object
    exists, so a reference's *shape* is all a template could judge and shape is not the
    interesting failure. The scenario's publish gate resolves them against a real shop.
    """
    if kind is BlockParameterKind.SEVERITY:
        return is_severity(value)
    if kind is BlockParameterKind.TIMING:
        return is_timing(value)
    if kind is BlockParameterKind.DURATION:
        return is_duration(value)
    return bool(value)


@dataclass(frozen=True, slots=True)
class BlockParameter:
    """One value a scenario supplies when it binds this template."""

    name: str
    kind: BlockParameterKind
    description: str = ""
    required: bool = True
    default: str | None = None

    def __post_init__(self) -> None:
        _require_identifier(self.name, "block parameter name")
        _require_instance(
            self.kind, BlockParameterKind, "a block parameter must declare a supported kind"
        )
        _require_text(self.description, "block parameter description", allow_empty=True)
        _require_instance(self.required, bool, "block parameter requiredness must be a boolean")
        if self.default is not None:
            _require_text(self.default, "block parameter default")

    @property
    def binds_shop_object(self) -> bool:
        """Whether a scenario must resolve this parameter inside its own shop."""
        return self.kind in SHOP_BOUND_PARAMETER_KINDS


def shop_bound_parameters(parameters: tuple[BlockParameter, ...]) -> tuple[str, ...]:
    """The parameter names a scenario must bind to objects in its own shop."""
    return tuple(parameter.name for parameter in parameters if parameter.binds_shop_object)


def check_bindings(
    parameters: tuple[BlockParameter, ...], bindings: Mapping[str, str]
) -> DefinitionValidation:
    """Judge one scenario's bindings against this template, as far as a template can.

    Everything here is decidable from the template alone: that each parameter is known, that
    the required ones are supplied, and that a literal fits its kind. Whether a reference
    resolves to a real same-shop object is the scenario's question, because only a scenario
    knows its shop — `shop_bound_parameters` names exactly the bindings it must answer for.
    """
    issues: list[DefinitionIssue] = []
    declared = {parameter.name: parameter for parameter in parameters}

    for name in sorted(set(bindings) - set(declared)):
        issues.append(
            issue_error(
                "binding_parameter_unknown",
                f"this template declares no parameter named {name}",
                f"bindings.{name}",
            )
        )

    for name, parameter in sorted(declared.items()):
        if name not in bindings:
            if parameter.required and parameter.default is None:
                issues.append(
                    issue_error(
                        "binding_missing",
                        f"{name} is required and the template carries no default",
                        f"bindings.{name}",
                    )
                )
            continue
        value = bindings[name]
        if not value:
            issues.append(
                issue_error("binding_empty", f"{name} is bound to nothing", f"bindings.{name}")
            )
        elif parameter.kind in LITERAL_PARAMETER_KINDS and not literal_value_is_valid(
            parameter.kind, value
        ):
            issues.append(
                issue_error(
                    "binding_value_invalid",
                    f"{value} is not a valid {parameter.kind.value}",
                    f"bindings.{name}",
                )
            )

    return validation_of(issues)


@dataclass(frozen=True, slots=True)
class ObjectiveBlockPayload:
    """The complete authored content of one objective-block draft or version."""

    name: str
    statement: str
    description: str
    assessment: ObjectiveAssessment
    evidence: ObjectiveEvidence
    parameters: tuple[BlockParameter, ...] = ()

    def __post_init__(self) -> None:
        _require_slug(self.name, "objective block name")
        _require_text(self.statement, "objective block statement", allow_empty=True)
        _require_text(self.description, "objective block description", allow_empty=True)
        _require_instance(
            self.assessment,
            ObjectiveAssessment,
            "an objective block must declare how it is assessed",
        )
        _require_instance(
            self.evidence, ObjectiveEvidence, "an objective block must declare its evidence"
        )
        _require_parameters(self.parameters)


@dataclass(frozen=True, slots=True)
class MutationBlockPayload:
    """The complete authored content of one mutation-block draft or version."""

    name: str
    statement: str
    description: str
    effect: MutationEffect
    parameters: tuple[BlockParameter, ...] = ()

    def __post_init__(self) -> None:
        _require_slug(self.name, "mutation block name")
        _require_text(self.statement, "mutation block statement", allow_empty=True)
        _require_text(self.description, "mutation block description", allow_empty=True)
        _require_instance(
            self.effect, MutationEffect, "a mutation block must declare what it perturbs"
        )
        _require_parameters(self.parameters)


BlockPayload = ObjectiveBlockPayload | MutationBlockPayload


def _require_parameters(parameters: tuple[BlockParameter, ...]) -> None:
    for parameter in parameters:
        _require_instance(
            parameter, BlockParameter, "block parameters must be block parameter entries"
        )
    _require_unique(tuple(parameter.name for parameter in parameters), "block parameter names")
    if len(parameters) > MAX_BLOCK_PARAMETERS:
        raise BlockConfigurationError(f"a block declares at most {MAX_BLOCK_PARAMETERS} parameters")


def new_objective_block(name: str) -> ObjectiveBlockPayload:
    """A deliberately incomplete first draft: named, and nothing else decided.

    The default pairing is the commonest one and the only one that is always legal, so an
    author who publishes without touching the type axis publishes something coherent.
    """
    return ObjectiveBlockPayload(
        name=name,
        statement="",
        description="",
        assessment=ObjectiveAssessment.DETERMINISTIC,
        evidence=ObjectiveEvidence.EVENT,
    )


def new_mutation_block(name: str) -> MutationBlockPayload:
    """A deliberately incomplete first draft; the timing parameter is the author's to add."""
    return MutationBlockPayload(
        name=name,
        statement="",
        description="",
        effect=MutationEffect.ENTITY_MUTATION,
    )


def _prose_issues(payload: BlockPayload) -> list[DefinitionIssue]:
    """A published template has to explain itself to whoever binds it."""
    issues: list[DefinitionIssue] = []
    if not payload.statement:
        issues.append(
            issue_error(
                "block_without_statement",
                "a scenario renders each bound instance as this statement, so it cannot be empty",
                "statement",
            )
        )
    if not payload.description:
        issues.append(
            issue_error(
                "block_without_description",
                "a published block must say what it asserts and when it holds",
                "description",
            )
        )
    return issues


def _parameter_issues(parameters: tuple[BlockParameter, ...]) -> list[DefinitionIssue]:
    issues: list[DefinitionIssue] = []
    for parameter in parameters:
        path = f"parameters.{parameter.name}"
        if parameter.default is not None and parameter.kind not in LITERAL_PARAMETER_KINDS:
            # A template is shop-independent. A default reference would name one shop's
            # object and hand it to every other shop that binds the template.
            issues.append(
                issue_error(
                    "reference_parameter_with_default",
                    f"{parameter.name} names an object a scenario binds, so a template "
                    "cannot default it",
                    path,
                )
            )
        elif parameter.default is not None and not literal_value_is_valid(
            parameter.kind, parameter.default
        ):
            issues.append(
                issue_error(
                    "parameter_default_invalid",
                    f"{parameter.default} is not a valid {parameter.kind.value}",
                    path,
                )
            )
        if not parameter.required and parameter.default is None:
            # The remedy is not the same for both halves of the kind table: a reference
            # parameter may never carry a default, so requiring it is the only way out.
            remedy = (
                "give it a default"
                if parameter.kind in LITERAL_PARAMETER_KINDS
                else "make it required, since a template cannot default an object reference"
            )
            issues.append(
                issue_error(
                    "optional_parameter_without_default",
                    f"{parameter.name} is optional but has nothing to fall back on, so a "
                    f"scenario that omits it leaves the runtime with no value; {remedy}",
                    path,
                )
            )
        if not parameter.description:
            issues.append(
                issue_warning(
                    "parameter_without_description",
                    f"{parameter.name} gives an author no guidance on what to bind",
                    path,
                )
            )
    return issues


def _timing_parameters(parameters: tuple[BlockParameter, ...]) -> tuple[BlockParameter, ...]:
    return tuple(
        parameter for parameter in parameters if parameter.kind is BlockParameterKind.TIMING
    )


def validate_objective_block(payload: ObjectiveBlockPayload) -> DefinitionValidation:
    """Report every publish-gate finding for an objective-block draft."""
    issues = _prose_issues(payload) + _parameter_issues(payload.parameters)

    allowed = (
        JUDGE_EVIDENCE
        if payload.assessment is ObjectiveAssessment.JUDGE
        else DETERMINISTIC_EVIDENCE
    )
    if payload.evidence not in allowed:
        issues.append(
            issue_error(
                "objective_assessment_evidence_mismatch",
                f"a {payload.assessment.value} objective cannot be assessed on "
                f"{payload.evidence.value} evidence",
                "evidence",
            )
        )

    for parameter in _timing_parameters(payload.parameters):
        # Objective order is priority, not a script: a scenario that could schedule an
        # objective would be describing a scripted conversation rather than a goal.
        issues.append(
            issue_error(
                "objective_parameter_schedules",
                f"{parameter.name} would schedule the objective; objectives are goals, "
                "and only mutations sit on the run timeline",
                f"parameters.{parameter.name}",
            )
        )

    return validation_of(issues)


def validate_mutation_block(payload: MutationBlockPayload) -> DefinitionValidation:
    """Report every publish-gate finding for a mutation-block draft."""
    issues = _prose_issues(payload) + _parameter_issues(payload.parameters)

    timing = _timing_parameters(payload.parameters)
    if not timing:
        # Mutation order *is* the run timeline. A mutation with no bound moment has no
        # place on it, and both arms have to receive the identical schedule.
        issues.append(
            issue_error(
                "mutation_without_timing",
                "a mutation is injected at a bound moment, so it must declare a timing parameter",
                "parameters",
            )
        )
    elif len(timing) > 1:
        issues.append(
            issue_error(
                "mutation_with_several_timings",
                "a mutation fires once, so exactly one parameter may say when",
                "parameters",
            )
        )

    return validation_of(issues)


def _describe_parameter(parameter: BlockParameter) -> str:
    return f"{parameter.name} ({parameter.kind.value})"


def _block_changes(
    previous: BlockPayload | None,
    current: BlockPayload,
    axis: tuple[tuple[str, object, object], ...],
) -> tuple[DefinitionChange, ...]:
    """The change summary both block types share, plus their own type axis."""
    if previous is None:
        return (
            DefinitionChange(
                kind=DefinitionChangeKind.ADDED,
                path="",
                description=f"First published version of {current.name}",
            ),
        )

    changes = [
        DefinitionChange(
            kind=DefinitionChangeKind.UPDATED, path=name, description=f"Updated {name}"
        )
        for name, before, after in (
            ("name", previous.name, current.name),
            ("statement", previous.statement, current.statement),
            ("description", previous.description, current.description),
            *axis,
        )
        if before != after
    ]
    changes.extend(
        diff_keyed_collection(
            previous.parameters,
            current.parameters,
            key=lambda parameter: parameter.name,
            label=_describe_parameter,
            path="parameters",
            noun="parameter",
        )
    )
    return tuple(changes)


def summarize_objective_block_changes(
    previous: ObjectiveBlockPayload | None, current: ObjectiveBlockPayload
) -> tuple[DefinitionChange, ...]:
    """Describe what publishing this draft would freeze, against the latest version."""
    axis = (
        ()
        if previous is None
        else (
            ("assessment", previous.assessment, current.assessment),
            ("evidence", previous.evidence, current.evidence),
        )
    )
    return _block_changes(previous, current, axis)


def summarize_mutation_block_changes(
    previous: MutationBlockPayload | None, current: MutationBlockPayload
) -> tuple[DefinitionChange, ...]:
    """Describe what publishing this draft would freeze, against the latest version."""
    axis = () if previous is None else (("effect", previous.effect, current.effect),)
    return _block_changes(previous, current, axis)
