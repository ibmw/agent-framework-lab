import type {
  ArmEvaluationSchema,
  ExperimentRunSchema,
  JudgeConfigurationSummarySchema,
  ObjectiveResultSchema,
} from "@agent-lab/contracts";
import { useId } from "react";
import { describeJudgement, OUTCOMES } from "../lib/evidence";
import { onlyChoiceNote } from "../lib/singleChoice";
import { fieldControlClasses, fieldLabelClasses, outlineButtonClasses } from "../lib/ui";
import { BusyButton } from "./PrimaryAction";

/** What a matrix is called when its caller does not say which half of the evidence it holds. */
const EVERY_OBJECTIVE =
  "Every objective this scenario composed, and where each arm stands against it";

/**
 * The bench's matrix: one row per objective, one column per arm, in a 320px column beside a
 * running thread, where a cell is its mark and the sentence behind it is heard and hovered. The
 * results draw the same reading as a sheet section of their own (`ObjectivesSection`), with
 * every cell's evidence a visible line.
 *
 * Cells are paired by the objective they judge rather than by position: every arm is judged
 * against one scenario's objectives, and matching on that fact keeps a verdict from ever
 * landing in the row above the objective it belongs to.
 */
export function ObjectiveMatrix({
  runs,
  arms,
  rows,
  caption = EVERY_OBJECTIVE,
}: {
  runs: ExperimentRunSchema[];
  arms: ArmEvaluationSchema[];
  rows: ObjectiveResultSchema[];
  /** The table's name: which half of the evidence it holds, where a page holds both. */
  caption?: string;
}) {
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

/** One arm's result for one objective, paired by the objective rather than by position. */
function resultFor(
  arm: ArmEvaluationSchema,
  row: ObjectiveResultSchema,
): ObjectiveResultSchema | undefined {
  return arm.objectives.find((entry) => entry.objective_id === row.objective_id);
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
