"""The experiment: two arms of one incident, and the customer turns that drive them.

An experiment binds one published scenario version to one or two published agent
configurations (ADR 0011). Everything it *starts from* is already built — a snapshot is
canonical starting state (ADR 0019) and a clone is one arm's own copy of it (ADR 0020) —
so what this module adds is the record that ties them together and the turns that move
them forward.

Four rules live here rather than in the service that applies them.

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

**What an operator writes about a run is not part of what the run was.** A note and a tag
are a reviewer's, not the scenario's: they are recorded beside the experiment rather than
inside the document it is fingerprinted from, so annotating a run six months later cannot
change what it says it ran. What lives here is only the shape of them — a tag is folded to
one spelling because history narrows by it, and a note is bounded text because it is a
paragraph rather than a report.

**What a replay does is read out of the run it derives from.** An experiment is
immutable and everything about it is in the record, so replaying one cannot re-run it — it
can only produce a new experiment driven the same way. `replay_script` is that reading: the
compositions the original recorded, in an order that could have produced the ordinals they
carry, each carrying how many times the arm it reached was advanced on it. The trigger is
deliberately not in it — a replay is opened from the ticket the snapshot pinned, exactly as
a start is, so the opening question stays a property of the starting state.

**Where an arm stands is read, never stored.** An experiment an operator comes back to has
to say what it is waiting for, and the two streams already answer it: the last customer turn
the arm received, and whether any attempt at it produced a reply. `stand_arm` is that
reading, in one place, so the runner deciding what to do next and the bench drawing the
button agree by construction rather than by both remembering the same rule.
"""

from __future__ import annotations

import re
from collections import Counter
from collections.abc import Iterable
from dataclasses import dataclass
from enum import StrEnum
from functools import partial
from typing import cast
from uuid import UUID

from capability_lab.domain.agent_configuration import AgentConfigurationPayload
from capability_lab.domain.agent_turn import AgentTurn, AgentTurnOutcome
from capability_lab.domain.content import (
    require_instance,
    require_non_negative_int,
    require_slug,
    require_text,
)
from capability_lab.domain.entities import DomainError

__all__ = [
    "MAX_NOTE_LENGTH",
    "MAX_PARTICIPANT_TURN_LENGTH",
    "MAX_TAGS",
    "ArmAwaiting",
    "ArmStanding",
    "ComparisonDimension",
    "ComparisonVariable",
    "ExperimentConfigurationError",
    "ExperimentNote",
    "ParticipantDriverType",
    "ParticipantTurn",
    "ParticipantTurnSource",
    "ReplayComposition",
    "ReplayLine",
    "ReplayScript",
    "compare_configurations",
    "fold_tag",
    "fold_tags",
    "normalize_tag",
    "replay_script",
    "stand_arm",
]

# A customer turn is a chat message, not a document. The ticket thread's own bodies are
# bounded at the shared text length, and a turn typed into the bench is the same thing
# arriving later, so it is bounded the same way.
MAX_PARTICIPANT_TURN_LENGTH = 4000

# A note is a reviewer's paragraph about a run, not the write-up the run belongs in. Half
# the turn length, because a note longer than the message it is about has stopped being an
# annotation and become a document with nowhere to live.
MAX_NOTE_LENGTH = 2000

# Tags are a shelf, not a taxonomy: past a couple of dozen on one run nothing is being
# narrowed by them, and the cap is what stops a paste from becoming the filter list.
MAX_TAGS = 24

# The separators a typed tag may be spelled with, folded to the one it is stored as. A tag
# is an identity that history narrows by, so "read check gap" and "read_check_gap" have to
# arrive as the same shelf rather than as two that look alike in a dropdown.
#
# The hyphen is in the class as well as the output, so a run of them collapses: somebody who
# typed `read - check` or `read--check` spelled the shelf they meant, and refusing them would
# reject kebab-case for being kebab-case. A leading or trailing separator still folds to a
# leading or trailing hyphen and is still refused, because `-leading` is not a slug.
_TAG_SEPARATORS = re.compile(r"[\s_-]+")


class ExperimentConfigurationError(DomainError):
    """Raised when an experiment or one of its turns would be recorded incoherently."""


_require_instance = partial(require_instance, error=ExperimentConfigurationError)
_require_text = partial(require_text, error=ExperimentConfigurationError)
_require_non_negative_int = partial(require_non_negative_int, error=ExperimentConfigurationError)
_require_slug = partial(require_slug, error=ExperimentConfigurationError)


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


class ArmAwaiting(StrEnum):
    """What one arm is waiting for, which is the only thing an operator can act on.

    Two of these are the moves the bench offers — run the agent, or write the customer's next
    message — and the third is the absence of both. ADR 0029 left it out because a completion
    claim needed an evaluation to make it; it is here now, and it is still not a status
    anyone sets: an arm is completed when it has answered the last turn its scenario's cap
    allows, which is read off the same two streams as the other two values (ADR 0030).

    The cap is the half of the scenario's completion conditions this build decides. Whether
    the incident was actually *resolved* is the completion statement's, and that is prose a
    judge reads rather than a number a runtime counts.
    """

    AGENT = "agent"
    """The arm's latest customer turn has no reply. Advancing it is what happens next."""

    CUSTOMER = "customer"
    """The latest customer turn is answered. Nothing moves until the customer writes."""

    COMPLETED = "completed"
    """The scenario's turn cap is answered. Nothing moves this arm again."""


@dataclass(frozen=True, slots=True)
class ArmStanding:
    """Where one arm stands, read off its two streams.

    `ordinal` is the customer turn the arm is on and `attempts` is how many times its agent
    has tried to answer *that* turn, the successful one included. Read while the arm awaits
    its agent — the only state anything acts on it in — that means zero for a turn nobody has
    run and one per failure otherwise, which is the difference between "run the agent" and
    "try again". Read while it awaits the customer it counts the attempt that answered, which
    is a true statement about the turn rather than a number anyone needs.

    `unanswered` names the earlier turns this arm never answered. An operator may send a
    second message before running the agent on the first, and the arm then answers the
    conversation as it now stands rather than the question the customer moved on from
    (ADR 0026) — so the skipped turn is a real part of the record, and one an operator coming
    back to a bench would otherwise have to spot by reading the thread for a gap.

    The ordinals rather than how many of them there are, because a client has to label the
    turns themselves. Handed a count, it would work out *which* turns those were by reading
    the two streams again — the second derivation this type exists to remove. How many there
    are is the length of it.
    """

    awaiting: ArmAwaiting
    ordinal: int
    attempts: int
    unanswered: tuple[int, ...]


def stand_arm(
    turns: tuple[ParticipantTurn, ...], attempts: tuple[AgentTurn, ...], *, max_turns: int
) -> ArmStanding:
    """Read one arm's standing from the customer turns it received and the replies it tried.

    Both streams as this arm holds them — a caller that passed another arm's turns would be
    describing a thread that never existed, which is why neither is filtered here.

    An arm with no turns has no standing rather than a neutral one: starting an experiment
    writes the trigger into every arm (ADR 0025), so an empty thread is an arm that was never
    opened, and reporting it as "waiting for the customer" would hide that.

    `max_turns` is the scenario's own cap and is required rather than defaulted: a default
    would let a caller that never resolved the scenario report an arm as still running past
    the point its recipe ends, and the runner and the bench would then disagree about whether
    there is anything left to do. The trigger is turn zero (ADR 0028), so the cap counts the
    turns a participant drove.
    """
    if not turns:
        raise ExperimentConfigurationError(
            "an arm that has received no customer turn has no standing"
        )
    # `bool` is an `int`, so the count check is the one that actually holds a caller to a cap.
    _require_non_negative_int(max_turns, "arm standing turn cap")
    answered = frozenset(
        attempt.ordinal for attempt in attempts if attempt.outcome is AgentTurnOutcome.ANSWERED
    )
    latest = max(turn.ordinal for turn in turns)
    return ArmStanding(
        awaiting=_awaiting(latest, answered=latest in answered, max_turns=max_turns),
        ordinal=latest,
        attempts=sum(1 for attempt in attempts if attempt.ordinal == latest),
        unanswered=tuple(
            sorted(
                turn.ordinal
                for turn in turns
                if turn.ordinal < latest and turn.ordinal not in answered
            )
        ),
    )


def _awaiting(latest: int, *, answered: bool, max_turns: int) -> ArmAwaiting:
    """The three states in the order they exclude one another.

    An unanswered turn always awaits the agent, cap or no cap: the last turn a scenario
    allows still has to be answered, so an arm cannot complete by running out of turns while
    it owes a reply.
    """
    if not answered:
        return ArmAwaiting.AGENT
    return ArmAwaiting.COMPLETED if latest >= max_turns else ArmAwaiting.CUSTOMER


@dataclass(frozen=True, slots=True)
class ReplayLine:
    """One arm's share of one recorded delivery.

    `body` is what *this* arm received rather than what the composition was: a driver
    answers one arm at a time (ADR 0025), so the words are read back per arm and a replay
    reproduces exactly what each thread held.

    `attempts` is how many times the original ran this arm's agent on this turn — zero for a
    turn the operator moved on from without advancing, and more than one where an attempt
    failed and was retried. It rides on the line rather than being counted again later
    because it is the same reading: what happened to this arm at this depth.
    """

    position: int
    body: str
    attempts: int


@dataclass(frozen=True, slots=True)
class ReplayComposition:
    """One recorded delivery, to be replayed as one delivery.

    Kept whole rather than flattened into a turn per arm, because a composition *is* the
    divergence record (ADR 0025): a message that reached both arms must be redelivered as
    one composition, or the derived run would claim two decisions where the original made
    one, and no comparison of the bodies could tell them apart afterwards.
    """

    lines: tuple[ReplayLine, ...]


@dataclass(frozen=True, slots=True)
class ReplayScript:
    """What driving a derived experiment consists of, read off the run it derives from.

    `opening` is how many times each arm was advanced on the scenario's triggering message,
    by position. The trigger itself is deliberately absent: it is authored fixture content
    that a start writes into every arm out of the ticket the snapshot pinned, so a replay
    that carried a copy of it could open a derived run on words the starting state does not
    contain.
    """

    opening: tuple[int, ...]
    compositions: tuple[ReplayComposition, ...]


def replay_script(
    threads: tuple[tuple[ParticipantTurn, ...], ...],
    attempts: tuple[tuple[AgentTurn, ...], ...],
) -> ReplayScript:
    """Read what a replay would do out of the two streams one experiment recorded.

    Both arguments are indexed by arm position, which is the only coordinate a derived
    experiment shares with the one it comes from: its runs are new rows over new sandboxes,
    so a script written in run identifiers would name arms that do not exist yet.

    The compositions are put back in **an** order that could have produced the ordinals they
    carry, not in the order a clock says they were written. A turn's ordinal is its depth in
    one arm (ADR 0025), so a composition is deliverable exactly when every arm it reaches
    stands at the depth it recorded; the order between two compositions that reached
    different arms is not in the record at all, and it does not need to be — arms are
    isolated, and each arm's own sequence is what this reconstructs.

    A record that admits no such order is refused rather than replayed in some order: it
    would be a gap in one arm's turns, which is a corrupted stream rather than something a
    derived run should paper over.
    """
    if not threads:
        raise ExperimentConfigurationError("an experiment with no arm has nothing to replay")
    if len(attempts) != len(threads):
        raise ExperimentConfigurationError(
            "a replay reads one attempt stream per arm, in the arms' own order"
        )
    for turns in threads:
        if not turns:
            raise ExperimentConfigurationError(
                "an arm that has received no customer turn has no script"
            )
    tried = tuple(Counter(attempt.ordinal for attempt in arm) for arm in attempts)

    # The compositions this experiment recorded, each as the arms it reached. Insertion
    # order is a tie-break and nothing more; which of two compositions is ready is decided
    # below, by the depths they claim.
    recorded: dict[UUID, dict[int, ParticipantTurn]] = {}
    for position, turns in enumerate(threads):
        for turn in sorted(turns, key=lambda entry: entry.ordinal):
            if turn.source is ParticipantTurnSource.TRIGGER:
                continue
            recorded.setdefault(turn.turn_id, {})[position] = turn

    depth = dict.fromkeys(range(len(threads)), 1)
    pending = sorted(
        recorded,
        key=lambda turn_id: min(turn.ordinal for turn in recorded[turn_id].values()),
    )
    compositions: list[ReplayComposition] = []
    while pending:
        ready = next(
            (
                turn_id
                for turn_id in pending
                if all(
                    turn.ordinal == depth[position] for position, turn in recorded[turn_id].items()
                )
            ),
            None,
        )
        if ready is None:
            raise ExperimentConfigurationError(
                "these turns cannot be replayed in any order that would have produced them"
            )
        pending.remove(ready)
        reached = recorded[ready]
        compositions.append(
            ReplayComposition(
                lines=tuple(
                    ReplayLine(
                        position=position,
                        body=reached[position].body,
                        attempts=tried[position][reached[position].ordinal],
                    )
                    for position in sorted(reached)
                )
            )
        )
        for position in reached:
            depth[position] += 1
    return ReplayScript(
        opening=tuple(counted[0] for counted in tried),
        compositions=tuple(compositions),
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


@dataclass(frozen=True, slots=True)
class ExperimentNote:
    """One thing an operator wrote about a run, and nothing about the run itself.

    Written once and never edited, for the reason a judge execution is never overwritten
    (ADR 0031): a note is what a reviewer thought at the moment they read the evidence, and
    a note quietly rewritten afterwards is no longer that.

    The body may quote what a synthetic customer said, so it is stored exactly as the
    participant turns beside it are — and, like them, never logged or traced.
    """

    note_id: UUID
    body: str

    def __post_init__(self) -> None:
        _require_instance(self.note_id, UUID, "a note must have an identity")
        _require_text(self.body, "note body")
        if len(self.body) > MAX_NOTE_LENGTH:
            raise ExperimentConfigurationError(
                f"a note must contain at most {MAX_NOTE_LENGTH} characters"
            )


def normalize_tag(value: str) -> str:
    """The lenient half of the fold: trimmed, lowercased, separated by single hyphens.

    Separated from `fold_tag` because the two callers want different halves of one rule. A
    *write* has to end in a shelf that can be stored, so it refuses what it cannot fold. A
    *filter* must never refuse: a link shared after the last run under a shelf was refiled
    should narrow to nothing rather than become an error page, and a query is not authoring.

    Both go through this step, which is what makes the filter agree with the write. Matching
    on the raw string instead would narrow correctly only for the spellings the dropdown
    happens to emit, and a hand-typed `tag=Read check gap` would find nothing while the
    identical tag sat on a row.
    """
    return _TAG_SEPARATORS.sub("-", value.strip().lower())


def fold_tag(value: object) -> str:
    """One tag as it is stored: normalized, and then required to be a slug.

    A tag is an identity a listing narrows by rather than prose, so the spellings a person
    reaches for — `Read check gap`, `read_check_gap`, `READ-CHECK-GAP` — have to arrive as
    one shelf. The fold is total over what it accepts and idempotent, which is what lets the
    stored form be compared directly and a filter option be offered exactly once.

    What it deliberately does not do is invent a tag out of anything: the normalized value
    must still be a slug, so an accented or punctuated string is refused rather than mangled
    into a key nobody would guess. The words go in a note; a tag is what the note is filed
    under.
    """
    if not isinstance(value, str):
        raise ExperimentConfigurationError("a tag must be text")
    return _require_slug(normalize_tag(value), "tag")


def fold_tags(values: object) -> tuple[str, ...]:
    """A run's whole tag set as it is stored: folded, deduplicated, and in one order.

    Sorted rather than kept as typed, because this is a set: two operators who tagged the
    same run with the same shelves in different orders have done the same thing, and a
    stored order would make that read as two different classifications.
    """
    if isinstance(values, str) or not isinstance(values, Iterable):
        raise ExperimentConfigurationError("tags must be a list of text values")
    folded = frozenset(fold_tag(value) for value in cast("Iterable[object]", values))
    if len(folded) > MAX_TAGS:
        raise ExperimentConfigurationError(f"a run may carry at most {MAX_TAGS} tags")
    return tuple(sorted(folded))
