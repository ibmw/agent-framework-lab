"""The experiment: two arms of one incident, and the customer turns that drive them.

An experiment binds one published scenario version to one or two published agent
configurations (ADR 0011). Everything it *starts from* is already built — a snapshot is
canonical starting state (ADR 0019) and a clone is one arm's own copy of it (ADR 0020) —
so what this module adds is the record that ties them together and the turns that move
them forward.

Three rules live here rather than in the service that applies them.

**The trigger is the scenario's, not the participant's.** A published ticket carries the
first message every arm receives (ADR 0016), and a comparison is only a comparison because
both arms received it identically. So the opening turn is authored fixture content with a
source of its own, and the participant driver supplies every turn *after* it. A driver that
could write the opening turn could make two arms start from different questions.

**A turn belongs to one arm, and turns delivered together say so.** The operator composes
once and may send that composition to both arms or to one; the arms that received one
composition share its `turn_id`. Divergence is then readable off the stream rather than
inferred by comparing bodies — two arms that were sent the same words by two separate
decisions did diverge, and the record must not flatten that into agreement.

**A comparison variable is a difference between two configurations, counted.** An
experiment whose arms differ in more than one dimension can still be run, but what it
measures is no longer attributable, so the difference set is computed once here and
recorded on the experiment for every later reading of it.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from functools import partial
from uuid import UUID

from capability_lab.domain.agent_configuration import AgentConfigurationPayload
from capability_lab.domain.content import (
    require_instance,
    require_non_negative_int,
    require_text,
)
from capability_lab.domain.entities import DomainError

__all__ = [
    "MAX_PARTICIPANT_TURN_LENGTH",
    "ComparisonDimension",
    "ComparisonVariable",
    "ExperimentConfigurationError",
    "ParticipantDriverType",
    "ParticipantTurn",
    "ParticipantTurnSource",
    "compare_configurations",
]

# A customer turn is a chat message, not a document. The ticket thread's own bodies are
# bounded at the shared text length, and a turn typed into the bench is the same thing
# arriving later, so it is bounded the same way.
MAX_PARTICIPANT_TURN_LENGTH = 4000


class ExperimentConfigurationError(DomainError):
    """Raised when an experiment or one of its turns would be recorded incoherently."""


_require_instance = partial(require_instance, error=ExperimentConfigurationError)
_require_text = partial(require_text, error=ExperimentConfigurationError)
_require_non_negative_int = partial(require_non_negative_int, error=ExperimentConfigurationError)


class ParticipantDriverType(StrEnum):
    """Where a run's customer turns come from.

    Declared as a closed set from the start (ADR 0012) although only `HUMAN` has an
    implementation: the type is recorded on every experiment as part of what explains a
    result, and a run driven by a future simulator must be distinguishable from one a person
    typed — including in comparisons made before that simulator existed.
    """

    HUMAN = "human"
    LLM = "llm"
    SCRIPTED = "scripted"


class ParticipantTurnSource(StrEnum):
    """Who produced one customer turn.

    Two values rather than one because they answer to different authorities. The trigger is
    frozen in the ticket the snapshot pinned, so it is identical in every arm by
    construction and reproducible from the starting state alone. A participant turn is
    produced during the run by whatever driver the experiment named, and is therefore
    evidence rather than starting state.
    """

    TRIGGER = "trigger"
    PARTICIPANT = "participant"


@dataclass(frozen=True, slots=True)
class ParticipantTurn:
    """One customer turn as one arm received it.

    `turn_id` is the composition this turn belongs to, not this turn's own identity: a
    message sent to both arms produces two turns sharing one `turn_id`, and a message sent
    to one arm alone produces a `turn_id` no other arm holds. That is the divergence record
    the comparison reads, so it is part of the turn rather than derived from the bodies.

    `driver` is `None` exactly when the source is the trigger — nothing drove it; the
    scenario authored it.
    """

    turn_id: UUID
    ordinal: int
    source: ParticipantTurnSource
    driver: ParticipantDriverType | None
    body: str

    def __post_init__(self) -> None:
        _require_instance(self.turn_id, UUID, "a participant turn must name its composition")
        _require_non_negative_int(self.ordinal, "participant turn ordinal")
        _require_instance(
            self.source, ParticipantTurnSource, "a participant turn must declare its source"
        )
        _require_text(self.body, "participant turn body")
        if len(self.body) > MAX_PARTICIPANT_TURN_LENGTH:
            raise ExperimentConfigurationError(
                f"a participant turn must contain at most {MAX_PARTICIPANT_TURN_LENGTH} characters"
            )
        if self.source is ParticipantTurnSource.TRIGGER:
            if self.ordinal != 0:
                raise ExperimentConfigurationError(
                    "the triggering message opens the run and can only be its first turn"
                )
            if self.driver is not None:
                raise ExperimentConfigurationError(
                    "the triggering message is authored by the scenario, so no driver produced it"
                )
            return
        if self.ordinal == 0:
            raise ExperimentConfigurationError(
                "a run opens with the scenario's triggering message, not with a driven turn"
            )
        _require_instance(
            self.driver,
            ParticipantDriverType,
            "a driven turn must name the participant driver that produced it",
        )


class ComparisonDimension(StrEnum):
    """The axes along which two agent configurations can differ.

    Exactly the inputs an experiment is allowed to attribute a difference in behavior to.
    Anything an arm discovers at run time is deliberately absent: both arms work the same
    starting state, so the world is not a comparison variable (ADR 0019, ADR 0020).
    """

    FRAMEWORK = "framework"
    ARCHITECTURE = "architecture"
    MODEL = "model"
    PROMPT = "prompt"
    TOOLS = "tools"
    SUPPORT_IDENTITY = "support_identity"
    TONE_OF_VOICE = "tone_of_voice"


@dataclass(frozen=True, slots=True)
class ComparisonVariable:
    """What each arm holds along one dimension, and whether the two disagree.

    `values` carries one entry per arm in arm order, rendered as the short text an operator
    reads in the setup matrix. A single-arm experiment produces one value per dimension and
    never differs — there is nothing to compare it to, which is a true statement about the
    experiment rather than an absence to hide.
    """

    dimension: ComparisonDimension
    values: tuple[str, ...]
    differs: bool


def compare_configurations(
    configurations: tuple[AgentConfigurationPayload, ...],
) -> tuple[ComparisonVariable, ...]:
    """Read the arms' configurations dimension by dimension, in declaration order.

    Every dimension is reported, agreeing ones included: an operator setting an experiment
    up needs to see that the model is the same as much as that the framework is not, and a
    matrix that listed only the differences would make "same" and "not checked" look alike.
    """
    if not configurations:
        raise ExperimentConfigurationError("a comparison needs at least one configuration")
    return tuple(
        _variable(dimension, tuple(_value(dimension, payload) for payload in configurations))
        for dimension in ComparisonDimension
    )


def _variable(dimension: ComparisonDimension, values: tuple[str, ...]) -> ComparisonVariable:
    return ComparisonVariable(dimension=dimension, values=values, differs=len(set(values)) > 1)


def _value(dimension: ComparisonDimension, payload: AgentConfigurationPayload) -> str:
    """One arm's value along one dimension, as the text a difference is judged on.

    The prompt is compared by content rather than by a revision number: an agent
    configuration's prompt is a template inside a published version (ADR 0024), and two
    versions carrying the same prompt are not a comparison variable however far their
    version numbers have drifted apart.
    """
    match dimension:
        case ComparisonDimension.FRAMEWORK:
            return payload.framework_id
        case ComparisonDimension.ARCHITECTURE:
            return payload.architecture.value
        case ComparisonDimension.MODEL:
            # The runtime settings ride with the model rather than forming a dimension of
            # their own. Two arms on one model at two temperatures are not running the same
            # model in any sense a result can be attributed to, and a matrix that said
            # "same" on this row would be reporting the model's name instead of the model.
            settings = payload.model
            return (
                f"{settings.provider}/{settings.model_id} · "
                f"temp {settings.canonical_temperature} · "
                f"{settings.max_tool_rounds} tool rounds"
            )
        case ComparisonDimension.PROMPT:
            return payload.prompt
        case ComparisonDimension.TOOLS:
            # Already normalized to a sorted tuple by the payload, so two authors who ticked
            # the same boxes in a different order compare as the same tool set.
            return ", ".join(payload.tools)
        case ComparisonDimension.SUPPORT_IDENTITY:
            return str(payload.support_identity_id)
        case ComparisonDimension.TONE_OF_VOICE:
            selection = payload.tone_of_voice
            return selection.guideline_id or selection.source.value
