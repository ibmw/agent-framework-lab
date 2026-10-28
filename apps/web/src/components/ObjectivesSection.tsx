import type {
  ArmEvaluationSchema,
  ExperimentEvaluationResponse,
  ExperimentRunSchema,
  JudgeConfigurationSummarySchema,
  ObjectiveResultSchema,
} from "@agent-lab/contracts";
import { useId, useState } from "react";
import { Link } from "react-router-dom";
import { describeApiError } from "../api/client";
import { scoreExperiment } from "../api/experiments";
import { scoreReport, TAKES_A_MINUTE } from "../lib/actionStatus";
import { CONTROL_JUDGE_NOTE, CONTROL_JUDGE_PROVIDER } from "../lib/agents";
import { labelOf, OBJECTIVE_SEVERITY } from "../lib/enumLabels";
import { firstSentence, judgementProvenance, OUTCOMES } from "../lib/evidence";
import type { SheetArm } from "../lib/sheet";
import { callAnchor, timelineEventPath } from "../lib/timelineAnchors";
import {
  sheetCellDisclosureClasses,
  sheetCellLineClasses,
  sheetCellLinkClasses,
  sheetCellSummaryClasses,
  sheetCodeClasses,
  sheetFootClasses,
  sheetFootFormClasses,
  sheetFootLineClasses,
  sheetLabelDetailClasses,
  sheetLabelLinesClasses,
  sheetLabelTagClasses,
  sheetOutcomeLineClasses,
  sheetOutcomePillClasses,
} from "../lib/ui";
import { usePublishedJudges } from "../lib/usePublishedJudges";
import { ActionStatus } from "./ActionStatus";
import { SheetGroup, SheetRow, SheetSection } from "./ArmSheet";
import { JudgePicker } from "./ObjectiveEvidence";
import { Fingerprint } from "./WorkspaceChrome";

/** The experiment the section scores and whose timeline its links open. */
interface ExperimentOf {
  shopId: string;
  experimentId: string;
}

/**
 * *Objectives*, the results sheet's evidence (ADR 0080; sheet mockup :139–171): one row per
 * objective, each arm's cell in its column, in two labelled groups — "Decided by a rule" and
 * "Scored by a judge" — then the judge picker, *Score* and the scoring queue at the foot.
 *
 * No number here stands for an arm as a whole. A row is one objective, a cell one arm's outcome
 * against it with the evidence that decided it, and the rows are never added up: how a missed
 * process check weighs against a resolved incident is the operator's judgement (ADR 0030).
 *
 * Cells are paired by the objective they judge and by the arm's run, never by position: every
 * arm is judged against one scenario's objectives, and the evaluation's arms need not come in the
 * sheet's order.
 */
export function ObjectivesSection({
  of,
  runs,
  arms,
  evaluation,
  onEvaluated,
}: {
  of: ExperimentOf;
  /** The arms' runs in the sheet's order, one per column. */
  runs: ExperimentRunSchema[];
  arms: SheetArm[];
  evaluation: ExperimentEvaluationResponse;
  onEvaluated: (evaluation: ExperimentEvaluationResponse) => void;
}) {
  const { judges, judgeId, setJudgeId } = usePublishedJudges();
  const [scoring, setScoring] = useState(false);
  // What the last scoring pass on this page answered, for the queue's settled rows.
  const [scored, setScored] = useState<ArmEvaluationSchema[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const scoreNoteId = useId();

  const score = async () => {
    setScoring(true);
    setScored(null);
    setError(null);
    try {
      const judged = await scoreExperiment(of.shopId, of.experimentId, { judge_id: judgeId });
      onEvaluated(judged);
      setScored(judged.arms);
    } catch (cause: unknown) {
      setError(describeApiError(cause, "This experiment could not be scored."));
    } finally {
      setScoring(false);
    }
  };

  const rows = evaluation.arms[0]?.objectives ?? [];
  const deterministic = rows.filter((row) => row.assessment === "deterministic");
  const judged = rows.filter((row) => row.assessment === "judge");
  const columns = runs.map((run) => ({
    run,
    evaluated: evaluation.arms.find((arm) => arm.run_id === run.run_id),
  }));
  const objectiveRow = (row: ObjectiveResultSchema) => (
    <SheetRow
      key={row.objective_id}
      label={<ObjectiveLabel row={row} />}
      cells={columns.map(({ run, evaluated }) => (
        <OutcomeCell
          key={run.run_id}
          row={row}
          result={evaluated?.objectives.find((entry) => entry.objective_id === row.objective_id)}
          run={run}
          judges={judges}
          of={of}
        />
      ))}
    />
  );

  return (
    <SheetSection
      id="objectives"
      title="Objectives"
      note="A rule decides what the record can, and a judge scores what no rule can."
      arms={arms}
      labelHeader="Objective"
      tour="results-objectives"
      grouped
      after={
        judged.length === 0 ? null : (
          <div className={sheetFootClasses}>
            {error ? (
              <p role="alert" className={sheetFootLineClasses.error}>
                {error}
              </p>
            ) : null}
            {judges.length === 0 ? (
              <p className={sheetFootLineClasses.muted}>
                Publish a judge to score {judged.length} row(s) no rule decides.
              </p>
            ) : (
              <>
                <div className={sheetFootFormClasses}>
                  <JudgePicker
                    judges={judges}
                    judgeId={judgeId}
                    // Once a verdict stands, scoring again is what ADR 0031 made it: a new
                    // attempt beside the last, never over it.
                    action={
                      judged.some((row) => Boolean(row.judgement))
                        ? "Score again"
                        : `Score ${judged.length} judged objective(s)`
                    }
                    scoring={scoring}
                    noteId={scoreNoteId}
                    onSelectJudge={setJudgeId}
                    onScore={() => void score()}
                  />
                </div>
                <ActionStatus
                  label="Where each arm's scoring stands"
                  report={scoreReport(runs, scoring, scored)}
                  note={TAKES_A_MINUTE}
                  noteId={scoreNoteId}
                />
              </>
            )}
          </div>
        )
      }
    >
      <SheetGroup
        heading="Decided by a rule"
        note="Decided from each arm's own recorded calls and the state it started in and is in now."
        empty={
          deterministic.length === 0 ? "This scenario composes no objective a rule decides." : null
        }
      >
        {deterministic.map(objectiveRow)}
      </SheetGroup>
      {/* Busy while a judge scores its rows, and only this group: the section's foot holds the
          scoring queue, which a busy ancestor would keep from being announced (ADR 0065). */}
      <SheetGroup
        heading="Scored by a judge"
        note="Each arm is judged on an anonymized record of its own run, and the judge is told nothing about what ran it."
        empty={judged.length === 0 ? "This scenario leaves no objective to a judge." : null}
        busy={scoring}
      >
        {judged.map(objectiveRow)}
      </SheetGroup>
    </SheetSection>
  );
}

/**
 * An objective as its row names it: its statement, its slug — the name the record, the timeline
 * and a judge's verdicts give it — its severity as a tag, and "must never happen" when it is
 * forbidden. Its kind is the group it sits in.
 */
function ObjectiveLabel({ row }: { row: ObjectiveResultSchema }) {
  return (
    <div className={sheetLabelLinesClasses}>
      <div>{row.statement}</div>
      <div className={`${sheetLabelDetailClasses} ${sheetCodeClasses}`}>{row.objective_id}</div>
      <span className={sheetLabelTagClasses}>{labelOf(OBJECTIVE_SEVERITY, row.severity)}</span>
      {row.evidence === "forbidden" ? (
        <div className={sheetLabelDetailClasses}>must never happen</div>
      ) : null}
    </div>
  );
}

/**
 * One arm's outcome on one objective, and why: the outcome as a pill, its glyph beside its word;
 * then the evidence.
 *
 * A rule's sentence is short and is the whole of the evidence, so it is drawn whole, and where
 * one recorded call decided the verdict (`decided_by`) the cell links to exactly that event of
 * this arm's in the timeline. A row no single call decided — a miss, a pending row, a field
 * that moved — carries no link rather than a guessed one.
 *
 * A judge's rationale is prose: its first sentence is the line, and *Verdict details* holds the
 * whole of it with the judge by its published name, its version and model, the attempt and the
 * brief it read (ADR 0031). An execution that produced no verdict says so there, as an attempt
 * and never a judgement. A verdict by the offline control says, in words, what that judge does
 * not read.
 */
function OutcomeCell({
  row,
  result,
  run,
  judges,
  of,
}: {
  row: ObjectiveResultSchema;
  result: ObjectiveResultSchema | undefined;
  run: ExperimentRunSchema;
  judges: JudgeConfigurationSummarySchema[];
  of: ExperimentOf;
}) {
  if (!result) {
    return <OutcomeMark outcome={null} />;
  }
  const pill = <OutcomeMark outcome={result.outcome} />;
  const judgement = result.judgement;
  if (!judgement) {
    const decided = result.decided_by ?? null;
    return (
      <>
        {pill}
        <span className={sheetCellLineClasses}>{result.detail}</span>
        {decided ? (
          <Link
            to={timelineEventPath(of.shopId, of.experimentId, callAnchor(run.run_id, decided))}
            // Named with its objective and its arm: every decided cell draws the same words, and
            // a list of links read out of context would otherwise be a column of twins.
            aria-label={`Open the deciding event for ${row.statement}, ${run.label}`}
            className={sheetCellLinkClasses}
          >
            Open the deciding event <span aria-hidden="true">→</span>
          </Link>
        ) : null}
      </>
    );
  }
  const judgeName = judges.find((judge) => judge.judge_id === judgement.judge_id)?.name;
  return (
    <>
      {pill}
      <span className={sheetCellLineClasses}>{firstSentence(result.detail)}</span>
      {judgement.provider === CONTROL_JUDGE_PROVIDER ? (
        <span className={sheetCellLineClasses}>{CONTROL_JUDGE_NOTE}</span>
      ) : null}
      <details className={sheetCellDisclosureClasses}>
        <summary className={sheetCellSummaryClasses}>Verdict details</summary>
        <div className={`${sheetLabelLinesClasses} pt-1`}>
          {/* The whole rationale, where it is more than the line above already says. */}
          {firstSentence(result.detail) === result.detail ? null : (
            <span className="text-admin-ink">{result.detail}</span>
          )}
          <span>{judgementProvenance(judgement, judgeName)}</span>
          <span>
            Brief <Fingerprint value={judgement.brief_fingerprint} />
          </span>
        </div>
      </details>
    </>
  );
}

/**
 * An outcome as the cell's first line: a pill for the one-word outcomes — met, missed, pending —
 * and the cell's own line for those that are sentences, a judge's to score, undecidable, or a row
 * this arm has no result for at all, so no sentence is wrapped inside a pill (`lib/ui.ts`).
 */
function OutcomeMark({ outcome }: { outcome: ObjectiveResultSchema["outcome"] | null }) {
  const { mark, label } = outcome === null ? { mark: "—", label: "not judged" } : OUTCOMES[outcome];
  // A mark that is a word ("judge") says what its label says at more length, so the label
  // stands alone; a glyph is drawn beside its word, never instead of it.
  const glyph = /\p{L}/u.test(mark) ? null : mark;
  const className =
    outcome === "met" || outcome === "missed" || outcome === "pending"
      ? sheetOutcomePillClasses[outcome]
      : sheetOutcomeLineClasses;
  return (
    <span className={className}>
      {glyph ? <span aria-hidden="true">{glyph}</span> : null}
      {label}
    </span>
  );
}
