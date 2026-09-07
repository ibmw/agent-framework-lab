"""Replaying an experiment: a new run of an old one, in the world the old one started in.

An experiment is immutable and everything about it is in the record (ADR 0025, ADR 0029),
so replaying one cannot mean running it again. It means **deriving a new experiment** that
is honest about where it came from and that starts from exactly what the original pinned.

Four decisions shape it.

**The starting state is reused, never re-frozen.** Materializing a snapshot copies the
shop's order fixtures as they read *now* and re-runs the publish gate against them
(ADR 0019), so freezing the same recipe again after an order moved is genuinely different
starting state — and after an order was deleted it is no starting state at all. A snapshot
is immutable and identified by its fingerprint, so a replay clones the recorded one. That is
what makes "historical experiments remain reproducible after newer definition versions are
published" true rather than hoped for: both derived arms begin at the same
`sandbox_fingerprint` the original's did.

**The arms are reused by content, at the versions the original ran.** Not the newest
publication of the same configuration: choosing newer versions is what a *fork* is for, and
a replay that quietly ran one would answer a different question under the old one's name.

**The customer's turns are the script.** A derived run with nobody at the composer would
stall at the first customer turn, so what drives it is the compositions the original
recorded — the same words, to the same arms, at the same depths, with the arm's agent run as
many times as it was run then. The trigger is not part of that script: a start writes it
into every arm out of the ticket the snapshot pinned, so the derived run opens on the same
question by construction rather than by copying a turn.

**The derived experiment says a script drove it.** Its recorded participant driver is
`scripted`, because that is what produced its turns, and the recorded driver is part of what
explains a result (ADR 0025). One consequence is worth naming rather than hiding: the
derived experiment's `resolution_fingerprint` therefore differs from its source's, in
exactly that one input. Its `sandbox_fingerprint` does not, and that is the fingerprint the
reproducibility claim rests on.

**What is reproduced is the input, not the output.** Against the declared control runtime a
replay reproduces the original turn for turn; against a model-backed one it does not, and
cannot. That is a property of the runtime rather than a defect here — the lab's claim is
that the derived run was asked the same questions in the same world by the same
configurations, which is precisely what makes a difference in the answers worth reading.
"""

from __future__ import annotations

from uuid import UUID

from capability_lab.application.experiment_runs import ExperimentRunner
from capability_lab.application.experiments import (
    ArmSelection,
    ExperimentDetail,
    ExperimentReplay,
    ExperimentReplayRepository,
    ExperimentService,
    StartExperiment,
)
from capability_lab.application.participants import ScriptedDriverFactory
from capability_lab.application.ports import Clock
from capability_lab.domain.content import MAX_LABEL_LENGTH
from capability_lab.domain.experiment import (
    ParticipantDriverType,
    ReplayScript,
    replay_script,
)

__all__ = ["REPLAY_LABEL_SUFFIX", "ExperimentReplayService"]

# What a derived experiment is called when nobody names it. The source's name plus a marker,
# because a history row's first column is how a run is recognized and "replay" without the
# incident it replays would be recognizable only by its timestamp.
REPLAY_LABEL_SUFFIX = " (replay)"


class ExperimentReplayService:
    """Derive one experiment from another and drive it through what that one recorded."""

    def __init__(
        self,
        experiments: ExperimentService,
        runner: ExperimentRunner,
        replays: ExperimentReplayRepository,
        driver: ScriptedDriverFactory,
        clock: Clock,
    ) -> None:
        self._experiments = experiments
        self._runner = runner
        self._replays = replays
        self._driver = driver
        self._clock = clock

    async def replay(self, shop_id: UUID, experiment_id: UUID) -> ExperimentDetail:
        """Start a new experiment on the source's starting state and run its script.

        Deliberately not idempotent, for the reason starting is not (ADR 0020, ADR 0025):
        replaying one run twice is two derived experiments, and collapsing them would delete
        the second reading rather than reuse the first. It is the honest shape here too — a
        model-backed arm answers differently every time, and two replays of one run are two
        pieces of evidence about that.

        A source still being driven is replayable: the script is what its record holds now.
        Nothing about the source is read a second time afterwards, so a replay is a reading
        of one moment rather than a subscription to a run that may still grow.
        """
        source = self._experiments.get_experiment(shop_id, experiment_id)
        script = _script_of(source)
        derived = self._experiments.start(
            shop_id,
            StartExperiment(
                label=_derived_label(source.record.label),
                scenario_id=source.record.scenario_id,
                scenario_version=source.record.scenario_version,
                seed=source.record.seed,
                arms=tuple(
                    ArmSelection(
                        configuration_id=run.agent_configuration_id,
                        version=run.agent_configuration_version,
                        label=run.label,
                    )
                    for run in source.runs
                ),
                participant_driver=ParticipantDriverType.SCRIPTED,
            ),
            starting_state=source.record.snapshot_id,
        )
        derived_id = derived.record.experiment_id
        # Written before the script runs rather than after it, so every read of the derived
        # experiment while it is being driven already says what it is.
        self._replays.save(
            ExperimentReplay(
                experiment_id=derived_id,
                source_experiment_id=experiment_id,
                created_at=self._clock.now(),
            )
        )
        await self._drive(shop_id, derived, script)
        return self._experiments.get_experiment(shop_id, derived_id)

    async def _drive(self, shop_id: UUID, derived: ExperimentDetail, script: ReplayScript) -> None:
        """Deliver the recorded compositions and run each arm where the original ran it.

        The arms are addressed by position, which is the only coordinate the two experiments
        share: the derived runs are new rows over new clones, so nothing recorded in run
        identifiers could have been replayed at all.

        Every advance goes through the same runner the bench calls. There is deliberately no
        second execution path here — a replay that ran arms its own way would be a second
        thing to keep in agreement with what an operator does by hand, and the evidence it
        produced would be about the replay rather than about the configuration.
        """
        experiment_id = derived.record.experiment_id
        runs = derived.runs
        for position, attempts in enumerate(script.opening):
            await self._advance(shop_id, experiment_id, runs[position].run_id, attempts)
        for composition in script.compositions:
            lines = {runs[line.position].run_id: line.body for line in composition.lines}
            # One call, however many arms it reaches — which is what makes the derived run's
            # divergence record the same shape as the source's (ADR 0025).
            self._experiments.deliver_turn(
                shop_id, experiment_id, tuple(lines), self._driver(lines)
            )
            for line in composition.lines:
                await self._advance(
                    shop_id, experiment_id, runs[line.position].run_id, line.attempts
                )

    async def _advance(
        self, shop_id: UUID, experiment_id: UUID, run_id: UUID, attempts: int
    ) -> None:
        """Run one arm's agent as many times as the original ran it on this turn.

        Advancing is idempotent over an *answer* and not over an attempt (ADR 0026), so this
        is self-limiting rather than a claim about how the derived run will go: where the
        original needed three attempts and this one answers on the first, the other two
        return that answer and call no model. Where this one fails, the next advance is a
        real retry — the same thing an operator would do, for the same reason.
        """
        for _ in range(attempts):
            await self._runner.advance(shop_id, experiment_id, run_id)


def _script_of(source: ExperimentDetail) -> ReplayScript:
    """What the source recorded, cut into the two streams the reading is made of.

    Narrowed here rather than re-queried per arm, exactly as the standing and the metrics
    are (ADR 0029, ADR 0032): the listings are already in hand, and reading them again would
    be two chances to answer from two different moments.
    """
    return replay_script(
        tuple(
            tuple(entry.turn for entry in source.turns if entry.run_id == run.run_id)
            for run in source.runs
        ),
        tuple(
            tuple(entry.turn for entry in source.agent_turns if entry.run_id == run.run_id)
            for run in source.runs
        ),
    )


def _derived_label(label: str) -> str:
    """The derived experiment's name: the source's, marked as a replay of it.

    Trimmed from the left of the suffix rather than refused, because an experiment label is
    bounded (`require_label`) and a source already at the bound is a run somebody named
    carefully rather than a mistake — refusing to replay it would be refusing over a string.
    """
    room = MAX_LABEL_LENGTH - len(REPLAY_LABEL_SUFFIX)
    return f"{label[:room].strip()}{REPLAY_LABEL_SUFFIX}"
