"""Deriving one experiment from another, in the world the first one started in.

One module for two operations, because they differ in exactly one thing. A **replay** runs
the versions its source pinned again; a **fork** moves those versions on purpose and holds
everything else still, so that the thing it changed is the only thing that changed
(ADR 0038, ADR 0039). Everything below the first heading is what both of them hold constant.

An experiment is immutable and everything about it is in the record (ADR 0025, ADR 0029),
so replaying one cannot mean running it again. It means **deriving a new experiment** that
is honest about where it came from and that starts from exactly what the original pinned.

Six decisions shape it.

**The starting state is reused, never re-frozen.** Materializing a snapshot copies the
shop's order fixtures as they read *now* and re-runs the publish gate against them
(ADR 0019), so freezing the same recipe again after an order moved is genuinely different
starting state — and after an order was deleted it is no starting state at all. A snapshot
is immutable and identified by its fingerprint, so a replay clones the recorded one. That is
what makes "historical experiments remain reproducible after newer definition versions are
published" true rather than hoped for: both derived arms begin at the same
`sandbox_fingerprint` the original's did.

**The arms are pinned by content, and they are the only thing a derivation may vary.** A
replay names the exact `(configuration_id, version)` each source arm ran: not the newest
publication of the same configuration, because a replay that quietly ran one would answer a
different question under the old one's name. A fork names a different pair for at least one
arm — a newer version of the same configuration, or a different configuration entirely — and
that is the whole of what it is allowed to change. The scenario version, the seed, the
starting state, the arm count, the arm labels, and the customer's own script are held
constant, because a derivation that varied one of those would not be a comparison with its
source at all: it would be a new experiment, which the setup screen already starts
(ADR 0039).

**A fork that changes nothing is refused.** The provenance says what happened, and a fork
whose every arm names the version its source ran did not fork anything — it replayed, under
a word that would tell every later reader something untrue. The refusal is on the pins rather
than on the payloads: asking for a different published version is a real choice even where
the two versions compare equal along every dimension this lab reads.

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

from dataclasses import dataclass
from uuid import UUID

from capability_lab.application.experiment_runs import ExperimentRunner
from capability_lab.application.experiments import (
    ArmSelection,
    ExperimentDerivation,
    ExperimentDerivationRepository,
    ExperimentDetail,
    ExperimentService,
    StartExperiment,
)
from capability_lab.application.participants import ScriptedDriverFactory
from capability_lab.application.ports import Clock
from capability_lab.domain.content import MAX_LABEL_LENGTH
from capability_lab.domain.experiment import (
    DerivationKind,
    ExperimentConfigurationError,
    ParticipantDriverType,
    ReplayScript,
    replay_script,
)

__all__ = [
    "DERIVATION_LABEL_SUFFIXES",
    "ExperimentDerivationService",
    "ForkArm",
]

# What a derived experiment is called when nobody names it. The source's name plus a marker,
# because a history row's first column is how a run is recognized and "replay" without the
# incident it replays would be recognizable only by its timestamp. Neither operation takes a
# name: what a run is *about* is the incident, and what an operator wants to say about the
# one they derived is a note (ADR 0036).
DERIVATION_LABEL_SUFFIXES = {
    DerivationKind.REPLAY: " (replay)",
    DerivationKind.FORK: " (fork)",
}


@dataclass(frozen=True, slots=True)
class ForkArm:
    """One arm of a fork: the published configuration version it will run instead.

    No label. The arm keeps the name its source arm had, because a comparison refers to arms
    by position ("arm A read the policy, arm B did not") and a fork that renamed one would
    make the two records harder to read side by side for no gain — the version each arm runs
    is on the row beside the name.
    """

    configuration_id: UUID
    version: int


class ExperimentDerivationService:
    """Derive one experiment from another and drive it through what that one recorded."""

    def __init__(
        self,
        experiments: ExperimentService,
        runner: ExperimentRunner,
        derivations: ExperimentDerivationRepository,
        driver: ScriptedDriverFactory,
        clock: Clock,
    ) -> None:
        self._experiments = experiments
        self._runner = runner
        self._derivations = derivations
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
        return await self._derive(
            shop_id,
            source,
            DerivationKind.REPLAY,
            tuple(
                ArmSelection(
                    configuration_id=run.agent_configuration_id,
                    version=run.agent_configuration_version,
                    label=run.label,
                )
                for run in source.runs
            ),
        )

    async def fork(
        self, shop_id: UUID, experiment_id: UUID, arms: tuple[ForkArm, ...]
    ) -> ExperimentDetail:
        """Derive a new experiment that runs the arms an operator chose instead.

        Everything a replay holds constant, a fork holds constant too: the same snapshot
        cloned again, the same recipe version at the same seed, the same arm positions and
        names, and the same recorded compositions delivered to the same arms at the same
        depths. That is what makes the derived run a comparison with its source rather than
        a second experiment that happens to look like it — the arms are the one variable, so
        a difference in the answers is about the arms.

        Not idempotent, for the reason a replay is not: forking the same run twice with the
        same arms is two derived experiments, and against a model-backed runtime they are two
        pieces of evidence rather than one repeated.
        """
        source = self._experiments.get_experiment(shop_id, experiment_id)
        if len(arms) != len(source.runs):
            # The script is written in arm positions, which is the only coordinate the two
            # experiments share: a fork with a different number of arms would have no script
            # for the arm it added, and nowhere to deliver the turns of the one it dropped.
            raise ExperimentConfigurationError(
                f"this experiment has {len(source.runs)} arm(s), so a fork of it names "
                f"{len(source.runs)}, not {len(arms)}"
            )
        if all(
            (arm.configuration_id, arm.version)
            == (run.agent_configuration_id, run.agent_configuration_version)
            for arm, run in zip(arms, source.runs, strict=True)
        ):
            raise ExperimentConfigurationError(
                "a fork changes at least one arm's published configuration version; a "
                "derivation that changes nothing is a replay"
            )
        return await self._derive(
            shop_id,
            source,
            DerivationKind.FORK,
            tuple(
                ArmSelection(
                    configuration_id=arm.configuration_id, version=arm.version, label=run.label
                )
                for arm, run in zip(arms, source.runs, strict=True)
            ),
        )

    async def _derive(
        self,
        shop_id: UUID,
        source: ExperimentDetail,
        kind: DerivationKind,
        arms: tuple[ArmSelection, ...],
    ) -> ExperimentDetail:
        """Start the derived experiment and drive it through what the source recorded.

        One body for both operations rather than two that have to be kept in agreement. Every
        rule here belongs to *deriving* — the recorded snapshot reused by identity, the setup
        gate re-run, the recorded compositions replayed, the provenance written — and the only
        thing either caller decides is which arms run and what the row is called.
        """
        script = _script_of(source)
        source_id = source.record.experiment_id
        derived = self._experiments.start(
            shop_id,
            StartExperiment(
                label=_derived_label(source.record.label, kind),
                scenario_id=source.record.scenario_id,
                scenario_version=source.record.scenario_version,
                seed=source.record.seed,
                arms=arms,
                participant_driver=ParticipantDriverType.SCRIPTED,
            ),
            # By identity, never frozen again — and identically for a fork, because a fork
            # that re-materialized would have moved the world as well as the arms, which is
            # the second variable it exists to avoid (ADR 0019, ADR 0039). Reusing it is also
            # what keeps the tool-contract refusal in one place: `start` is the only door.
            starting_state=source.record.snapshot_id,
        )
        derived_id = derived.record.experiment_id
        # Written before the script runs rather than after it, so every read of the derived
        # experiment while it is being driven already says what it is.
        self._derivations.save(
            ExperimentDerivation(
                experiment_id=derived_id,
                source_experiment_id=source_id,
                kind=kind,
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


def _derived_label(label: str, kind: DerivationKind) -> str:
    """The derived experiment's name: the source's, marked as what was derived from it.

    Trimmed from the left of the suffix rather than refused, because an experiment label is
    bounded (`require_label`) and a source already at the bound is a run somebody named
    carefully rather than a mistake — refusing to derive from it would be refusing over a
    string. A chain trims the same way, so a fork of a replay is recognizable by its row's
    provenance line rather than by however much of the suffix stack survived.
    """
    suffix = DERIVATION_LABEL_SUFFIXES[kind]
    room = MAX_LABEL_LENGTH - len(suffix)
    return f"{label[:room].strip()}{suffix}"
