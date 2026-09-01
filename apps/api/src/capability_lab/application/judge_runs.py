"""Scoring one experiment's judge rows: what is asked, of whom, and what is kept.

ADR 0030 left a `deferred` row for every objective a scenario marked `judge`. This runs the
judge that fills them, and it is built to make a verdict explainable rather than merely
available.

Five decisions shape it.

**One pass scores every deferred row of every arm.** A judge is chosen by the operator at
scoring time, not pinned by the experiment, because judging is rerunnable and separate from
the run (`docs/PLAN.md`): a result is explained by the judge version recorded *on the
verdict*, so pinning one at start would have frozen an evaluator before anybody knew what
the run produced. What the pass does freeze is the judge's latest published version, once,
so both arms of one pass are scored by identical rubrics.

**Each row is one execution.** The judge is asked about one objective at a time, with a
brief built for that objective. A single call scoring five objectives at once would let the
model's reading of one row move another, and would leave one fingerprint for five different
questions.

**The arms are scored the same way, and never against each other.** Every brief is built
from one arm's record alone (`judge_brief`), so a judge cannot prefer an arm by comparing
them — the comparison is the operator's, made from two independently produced verdicts.

**A failure is a recorded row, not an exception.** A provider that refused writes a
judgement with no verdict, which leaves the objective exactly where it stood: deferred. A
provider this process cannot reach at all is a 422 and writes nothing, for the reason
ADR 0026 gave — a missing API key is a fact about the machine, not about the arm.

**Nothing is overwritten.** Attempts count from one within `(run, objective)`, so scoring
again after editing the rubric — or simply to see whether the verdict holds — writes a new
row beside the old one and the evaluation reads the latest.
"""

from __future__ import annotations

import logging
from collections.abc import Mapping
from dataclasses import dataclass
from uuid import UUID

from capability_lab.application.canonical_json import CanonicalValue
from capability_lab.application.definition_authoring import DefinitionRepository
from capability_lab.application.definition_resolution import MissingReferenceVersionError
from capability_lab.application.evaluation import (
    ExperimentEvaluation,
    ExperimentEvaluationService,
    pinned_objective_templates,
)
from capability_lab.application.experiments import ExperimentDetail, ExperimentService
from capability_lab.application.judge_brief import ArmRecord, judge_brief, judge_brief_fingerprint
from capability_lab.application.judge_configurations import (
    JudgeConfigurationNotFoundError,
    JudgeConfigurationVersionNotFoundError,
    judge_configuration_definition_id,
)
from capability_lab.application.judge_runtime import (
    JudgeRequest,
    JudgeRuntime,
    JudgeRuntimeError,
    JudgeRuntimeRegistry,
)
from capability_lab.application.judgements import JudgementRecord, JudgementRepository
from capability_lab.application.ports import Clock
from capability_lab.domain.blocks import ObjectiveAssessment, ObjectiveBlockPayload
from capability_lab.domain.definitions import VersionRef
from capability_lab.domain.judge import JudgeConfigurationPayload, JudgeOutcome
from capability_lab.domain.judgement import MIN_JUDGE_ATTEMPT, JudgeFailure, Judgement
from capability_lab.domain.scenario import BoundObjective

__all__ = ["ExperimentJudgeService", "JudgeUnpublishedError"]

_logger = logging.getLogger(__name__)


class JudgeUnpublishedError(JudgeConfigurationVersionNotFoundError):
    """Raised when a judge is asked to score before it has ever been published.

    A draft judge is an evaluator nobody froze: rerunning its verdict a month later would
    read a rubric that has moved, which is the whole reason a judge is a definition.
    """


@dataclass(frozen=True, slots=True)
class _PublishedJudge:
    """The judge version one scoring pass runs, resolved once for every arm in it."""

    judge_id: UUID
    version: int
    payload: JudgeConfigurationPayload


class ExperimentJudgeService:
    """Score every judge-assessed objective of one experiment with one published judge.

    Holds `ExperimentService` rather than the repositories, exactly as the timeline and the
    evaluation do (ADR 0027, ADR 0030): what it judges is what `getExperiment` already
    serves, so a verdict can never be about a thread the operator is not looking at.

    It also holds the evaluation and answers with it, rather than with what the pass
    produced. A scoring pass writes some of an arm's rows and none of the others, and a
    caller handed only the new verdicts would have to stitch them into a matrix it read
    separately — two readings of one experiment, which is exactly what ADR 0030 refused.
    """

    def __init__(
        self,
        experiments: ExperimentService,
        evaluation: ExperimentEvaluationService,
        objective_blocks: DefinitionRepository[ObjectiveBlockPayload],
        judges: DefinitionRepository[JudgeConfigurationPayload],
        judgements: JudgementRepository,
        runtimes: JudgeRuntimeRegistry,
        clock: Clock,
    ) -> None:
        self._experiments = experiments
        self._evaluation = evaluation
        self._objective_blocks = objective_blocks
        self._judges = judges
        self._judgements = judgements
        self._runtimes = runtimes
        self._clock = clock

    async def score(
        self, shop_id: UUID, experiment_id: UUID, judge_id: UUID
    ) -> ExperimentEvaluation:
        """Run one published judge over every objective its scenario left to a judge."""
        detail = self._experiments.get_experiment(shop_id, experiment_id)
        judge = self._published_judge(judge_id)
        runtime = self._runtimes.get(judge.payload.model.provider)
        templates = pinned_objective_templates(detail, self._objective_blocks)
        attempts = self._attempts(experiment_id)

        written: list[JudgementRecord] = []
        for index, run in enumerate(detail.runs):
            record = self._record(detail, index)
            for objective in detail.scenario.payload.objectives:
                pinned = templates.get(objective.block_id)
                if pinned is None:  # pragma: no cover - publishing pinned every template
                    raise MissingReferenceVersionError(
                        f"{objective.id} names a template this scenario version does not pin"
                    )
                template, _ = pinned
                if template.assessment is not ObjectiveAssessment.JUDGE:
                    continue
                written.append(
                    JudgementRecord(
                        run_id=run.run_id,
                        experiment_id=experiment_id,
                        judgement=await self._judge(
                            judge,
                            runtime,
                            objective,
                            template,
                            record,
                            attempts.get((run.run_id, objective.id), 0) + 1,
                        ),
                        created_at=self._clock.now(),
                    )
                )
        self._judgements.append_all(tuple(written))
        return self._evaluation.evaluate(shop_id, experiment_id)

    async def _judge(
        self,
        judge: _PublishedJudge,
        runtime: JudgeRuntime,
        objective: BoundObjective,
        template: ObjectiveBlockPayload,
        record: ArmRecord,
        attempt: int,
    ) -> Judgement:
        """One objective, one arm, one execution — kept whatever the provider answered."""
        brief = judge_brief(objective, template, judge.payload, record)
        try:
            verdict = await runtime.score(
                JudgeRequest(rubric=judge.payload.rubric, model=judge.payload.model, brief=brief)
            )
        except JudgeRuntimeError as error:
            return self._executed(judge, objective, brief, attempt, failure=error.failure)
        except Exception as error:
            # An adapter that raised something it never classified is the lab's integration
            # breaking. Logged by type alone, for the reason a failed agent turn carries no
            # message: nothing can promise an arbitrary exception's text is free of the
            # synthetic customer content the brief carries (`AGENTS.md`).
            _logger.error("judge runtime failed with %s", type(error).__name__)
            return self._executed(
                judge, objective, brief, attempt, failure=JudgeFailure.INVALID_RESPONSE
            )
        return self._executed(
            judge,
            objective,
            brief,
            attempt,
            outcome=verdict.outcome,
            rationale=verdict.rationale,
        )

    @staticmethod
    def _executed(
        judge: _PublishedJudge,
        objective: BoundObjective,
        brief: Mapping[str, CanonicalValue],
        attempt: int,
        *,
        outcome: JudgeOutcome | None = None,
        rationale: str = "",
        failure: JudgeFailure | None = None,
    ) -> Judgement:
        """One execution, addressed to its row and tied to the exact input it read."""
        return Judgement(
            objective_id=objective.id,
            judge_id=judge.judge_id,
            judge_version=judge.version,
            provider=judge.payload.model.provider,
            model_id=judge.payload.model.model_id,
            brief_fingerprint=judge_brief_fingerprint(brief),
            attempt=max(attempt, MIN_JUDGE_ATTEMPT),
            outcome=outcome,
            rationale=rationale,
            failure=failure,
        )

    def _record(self, detail: ExperimentDetail, index: int) -> ArmRecord:
        """One arm's whole record, narrowed to that arm before a brief is built from it."""
        run_id = detail.runs[index].run_id
        return ArmRecord(
            turns=tuple(entry.turn for entry in detail.turns if entry.run_id == run_id),
            replies=tuple(entry.turn for entry in detail.agent_turns if entry.run_id == run_id),
            calls=tuple(entry.event for entry in detail.tool_events if entry.run_id == run_id),
        )

    def _attempts(self, experiment_id: UUID) -> Mapping[tuple[UUID, str], int]:
        """How many times each row has already been scored, so a rerun counts on."""
        counted: dict[tuple[UUID, str], int] = {}
        for entry in self._judgements.list_for_experiment(experiment_id):
            key = (entry.run_id, entry.judgement.objective_id)
            counted[key] = max(counted.get(key, 0), entry.judgement.attempt)
        return counted

    def _published_judge(self, judge_id: UUID) -> _PublishedJudge:
        """The judge's latest published version, resolved once for the whole pass."""
        definition = judge_configuration_definition_id(judge_id)
        if self._judges.get_draft(definition) is None:
            raise JudgeConfigurationNotFoundError(f"judge configuration {judge_id} does not exist")
        version = self._judges.latest_published_version(definition)
        if version is None:
            raise JudgeUnpublishedError(
                f"judge configuration {judge_id} has no published version to score with"
            )
        record = self._judges.get_version(VersionRef(definition=definition, version=version))
        if record is None:  # pragma: no cover - a latest version resolves
            raise JudgeUnpublishedError(
                f"judge configuration {judge_id} version {version} is not resolvable"
            )
        return _PublishedJudge(judge_id=judge_id, version=version, payload=record.payload)
