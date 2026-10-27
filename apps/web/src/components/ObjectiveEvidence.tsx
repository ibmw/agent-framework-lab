import type {
  ArmEvaluationSchema,
  ExperimentRunSchema,
  JudgeConfigurationSummarySchema,
  ObjectiveResultSchema,
} from "@agent-lab/contracts";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useId, useState } from "react";
import { Link } from "react-router-dom";
import { CONTROL_JUDGE_NOTE, CONTROL_JUDGE_PROVIDER } from "../lib/agents";
import { labelOf, OBJECTIVE_SEVERITY } from "../lib/enumLabels";
import { describeJudgement, firstSentence, judgementProvenance, OUTCOMES } from "../lib/evidence";
import { onlyChoiceNote } from "../lib/singleChoice";
import { callAnchor, timelineEventPath } from "../lib/timelineAnchors";
import {
  fieldControlClasses,
  fieldLabelClasses,
  focusRingClasses,
  outlineButtonClasses,
  tableCellClasses,
  tableHeadClasses,
  tableScrollerClasses,
} from "../lib/ui";
import { BusyButton } from "./PrimaryAction";

/** What a matrix is called when its caller does not say which half of the evidence it holds. */
const EVERY_OBJECTIVE =
  "Every objective this scenario composed, and where each arm stands against it";

/**
 * One row per objective, one column per arm — the bench's matrix and the results screen's,
 * which are one reading rendered in two places.
 *
 * Cells are paired by the objective they judge rather than by position: every arm is judged
 * against one scenario's objectives, and matching on that fact keeps a verdict from ever
 * landing in the row above the objective it belongs to. That pairing, and the evidence
 * sentence each cell carries, is exactly what must not exist twice — a matrix that paired
 * differently on two screens would show one arm two different records.
 *
 * `compact` is the one thing the two callers genuinely disagree about: the bench renders this
 * in a 320px column beside a running thread, where a cell is its mark and the sentence behind
 * it is heard and hovered; the results screen renders it on a page with room to read, where
 * every cell's sentence is a visible line under its mark (`Workspace.dc.html`:2619, `aWhy`)
 * and an objective's slug and severity sit under its statement.
 */
export function ObjectiveMatrix({
  runs,
  arms,
  rows,
  compact = false,
  caption = EVERY_OBJECTIVE,
  judges = [],
  timeline,
}: {
  runs: ExperimentRunSchema[];
  arms: ArmEvaluationSchema[];
  rows: ObjectiveResultSchema[];
  compact?: boolean;
  /** The table's name: which half of the evidence it holds, where a page holds both. */
  caption?: string;
  /** The published judges, by which a judged cell names the judge that scored it. */
  judges?: JudgeConfigurationSummarySchema[];
  /** The experiment whose timeline a decided line links into; no link is drawn without it. */
  timeline?: TimelineOf;
}) {
  if (!compact) {
    return (
      <EvidenceMatrix
        runs={runs}
        arms={arms}
        rows={rows}
        caption={caption}
        judges={judges}
        timeline={timeline}
      />
    );
  }
  return (
    <table className="w-full text-left text-[13px]">
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr className="text-xs font-semibold text-admin-muted">
          <th scope="col">Objective</th>
          {runs.map((run) => (
            <th key={run.run_id} scope="col" className="w-10 text-right">
              {run.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.objective_id}>
            <th scope="row" className="py-0.5 pr-2 font-normal text-admin-ink-soft">
              {row.statement}
            </th>
            {arms.map((arm) => {
              const result = resultFor(arm, row);
              const outcome = result ? OUTCOMES[result.outcome] : null;
              return (
                <td
                  key={arm.run_id}
                  className="py-0.5 text-right"
                  // The provenance is on the hover too, not only in the accessible name:
                  // "which judge, at which version, on which model" is what makes a verdict
                  // readable, and a sighted operator needs it as much (ADR 0031).
                  title={result ? `${result.detail}${describeJudgement(result)}` : undefined}
                >
                  <span aria-hidden="true">{outcome?.mark ?? "—"}</span>
                  {/* The evidence sentence, not only the symbol: "missed" beside the call
                      that was never made is a finding, and a tooltip is mouse-only. */}
                  <span className="sr-only">
                    {`${row.objective_id} ${outcome?.label ?? "not judged"}${
                      result ? ` — ${result.detail}` : ""
                    }${describeJudgement(result)}`}
                  </span>
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** The experiment a matrix belongs to, by which its lines address that experiment's timeline. */
interface TimelineOf {
  shopId: string;
  experimentId: string;
}

/** One arm's result for one objective, paired by the objective rather than by position. */
function resultFor(
  arm: ArmEvaluationSchema,
  row: ObjectiveResultSchema,
): ObjectiveResultSchema | undefined {
  return arm.objectives.find((entry) => entry.objective_id === row.objective_id);
}

/**
 * The results screen's matrix: every cell's mark with the sentence that decided it.
 *
 * Nothing is left to a hover or to a screen reader alone — the line under a mark is the
 * evidence, read the same way by everyone, so the cell carries no `title` and no hidden copy.
 */
function EvidenceMatrix({
  runs,
  arms,
  rows,
  caption,
  judges,
  timeline,
}: {
  runs: ExperimentRunSchema[];
  arms: ArmEvaluationSchema[];
  rows: ObjectiveResultSchema[];
  caption: string;
  judges: JudgeConfigurationSummarySchema[];
  timeline: TimelineOf | undefined;
}) {
  return (
    // A phone's width is narrower than two arms' sentences; the table scrolls inside its card
    // rather than pushing the page sideways. `relative`, so the `sr-only` lines a cell carries
    // are laid out in this scroller and not against the pane, which they would otherwise
    // widen past the viewport by however far the table runs (ADR 0079).
    <div className={tableScrollerClasses}>
      <table className="w-full text-left text-[13px]">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {/* The objective keeps a reading width of its own at a phone's width; the arms'
                columns are fixed, and the scroller takes what is left over. */}
            <th scope="col" className={`${tableHeadClasses} min-w-[10rem]`}>
              Objective
            </th>
            {runs.map((run) => (
              <th key={run.run_id} scope="col" className={`${tableHeadClasses} w-[220px]`}>
                {run.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.objective_id}>
              <th scope="row" className={`${tableCellClasses} pr-2 font-normal`}>
                <span className="block font-semibold text-admin-ink">{row.statement}</span>
                <span className="mt-0.5 block text-xs text-admin-muted">
                  {row.objective_id} · {labelOf(OBJECTIVE_SEVERITY, row.severity)}
                  {row.evidence === "forbidden" ? " · must never happen" : ""}
                </span>
              </th>
              {arms.map((arm) => (
                <td key={arm.run_id} className={`${tableCellClasses} min-w-[12rem]`}>
                  <EvidenceCell
                    result={resultFor(arm, row)}
                    runId={arm.run_id}
                    judges={judges}
                    timeline={timeline}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * One arm's mark on one objective, and why.
 *
 * A rule's sentence is short and is the whole of the evidence, so it is drawn whole. A judge's
 * rationale is prose: its first sentence is the line, held to one line, and the whole of it
 * opens beneath with the judge that wrote it, by its published name. A verdict by the offline
 * control says, in words, what that judge does not read.
 *
 * A rule's line is a link when one recorded call decided the verdict (`decided_by`): it opens
 * the execution timeline on exactly that event of this arm. A row no single call decided — a
 * miss, a pending row, a field that moved, a judge's — carries no link rather than a guessed
 * one.
 */
function EvidenceCell({
  result,
  runId,
  judges,
  timeline,
}: {
  result: ObjectiveResultSchema | undefined;
  runId: string;
  judges: JudgeConfigurationSummarySchema[];
  timeline: TimelineOf | undefined;
}) {
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  if (!result) {
    return (
      <span className="font-semibold text-admin-ink-soft">
        <span aria-hidden="true">— </span>not judged
      </span>
    );
  }
  const outcome = OUTCOMES[result.outcome];
  const judgement = result.judgement;
  // A mark that is a word ("judge") says what its label says at more length, so the label
  // stands alone; a glyph is drawn beside its word, never instead of it.
  const glyph = /\p{L}/u.test(outcome.mark) ? null : outcome.mark;
  const mark = (
    <span className="block font-semibold text-admin-ink-soft">
      {glyph ? <span aria-hidden="true">{glyph} </span> : null}
      {outcome.label}
    </span>
  );
  if (!judgement) {
    const decided = result.decided_by ?? null;
    return (
      <>
        {mark}
        {decided && timeline ? (
          <Link
            to={timelineEventPath(
              timeline.shopId,
              timeline.experimentId,
              callAnchor(runId, decided),
            )}
            className={`mt-0.5 block rounded text-xs leading-normal text-admin-ink-soft underline decoration-admin-muted underline-offset-2 hover:text-admin-ink hover:decoration-admin-ink ${focusRingClasses}`}
          >
            {result.detail}
            <span className="sr-only"> — open the event that decided it in the timeline</span>
          </Link>
        ) : (
          <span className="mt-0.5 block text-xs leading-normal text-admin-ink-soft">
            {result.detail}
          </span>
        )}
      </>
    );
  }
  const judgeName = judges.find((judge) => judge.judge_id === judgement.judge_id)?.name;
  return (
    <>
      {mark}
      {judgement.provider === CONTROL_JUDGE_PROVIDER ? (
        <span className="mt-0.5 block text-xs leading-normal text-admin-muted">
          {CONTROL_JUDGE_NOTE}
        </span>
      ) : null}
      <button
        type="button"
        aria-expanded={open}
        aria-controls={open ? bodyId : undefined}
        onClick={() => setOpen(!open)}
        className={`mt-0.5 flex w-full min-w-0 max-w-[220px] items-center gap-1 rounded text-left text-xs leading-normal text-admin-ink-soft hover:text-admin-ink ${focusRingClasses}`}
      >
        {open ? (
          <ChevronDown size={12} aria-hidden="true" focusable="false" className="flex-none" />
        ) : (
          <ChevronRight size={12} aria-hidden="true" focusable="false" className="flex-none" />
        )}
        <span className="min-w-0 truncate">{firstSentence(result.detail)}</span>
      </button>
      {open ? (
        <span id={bodyId} className="mt-1 grid gap-1 text-xs leading-normal">
          <span className="text-admin-ink-soft">{result.detail}</span>
          <span className="text-admin-muted">{judgementProvenance(judgement, judgeName)}</span>
        </span>
      ) : null}
    </>
  );
}

/**
 * Which published judge scores the rows no rule decides, and the control that runs it.
 *
 * Only published judges are offered: a verdict names the frozen version that produced it, and
 * a draft has none. The caller owns what to say when nothing is published, because the two
 * surfaces are answering different questions there — a bench is mid-run, and a results screen
 * is where an unscored row is the thing most likely to be missing.
 */
export function JudgePicker({
  judges,
  judgeId,
  action,
  scoring,
  noteId: scoreNoteId,
  onSelectJudge,
  onScore,
}: {
  judges: JudgeConfigurationSummarySchema[];
  judgeId: string;
  action: string;
  scoring: boolean;
  /** The scoring queue's note, which says the pass cannot be cancelled. */
  noteId: string;
  onSelectJudge: (judgeId: string) => void;
  onScore: () => void;
}) {
  const noteId = useId();
  // One published judge is not a choice (ADR 0064): it is already the one chosen.
  const onlyJudge = judges.length === 1 && judgeId === judges[0].judge_id;
  return (
    <>
      <label className={fieldLabelClasses}>
        Judge
        <select
          aria-label="Judge"
          aria-describedby={onlyJudge ? noteId : undefined}
          className={`${fieldControlClasses} w-full`}
          value={judgeId}
          onChange={(event) => onSelectJudge(event.target.value)}
        >
          {judges.map((judge) => (
            <option key={judge.judge_id} value={judge.judge_id}>
              {judge.name} · v{judge.latest_published_version} · {judge.model_id}
            </option>
          ))}
        </select>
        {onlyJudge ? (
          <span id={noteId} className="text-xs font-normal text-admin-muted">
            {onlyChoiceNote("published judge in the lab")}
          </span>
        ) : null}
      </label>
      <BusyButton
        className={outlineButtonClasses}
        type="button"
        busy={scoring}
        disabled={judgeId === ""}
        aria-describedby={scoreNoteId}
        onClick={onScore}
      >
        {scoring ? "Scoring…" : action}
      </BusyButton>
    </>
  );
}
