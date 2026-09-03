import type {
  ArmEvaluationSchema,
  ExperimentRunSchema,
  JudgeConfigurationSummarySchema,
  ObjectiveResultSchema,
} from "@agent-lab/contracts";
import { useEffect, useState } from "react";
import { listJudgeConfigurations } from "../api/judgeConfigurations";
import { describeJudgement, OUTCOMES } from "../lib/evidence";
import {
  fieldControlClasses,
  fieldLabelClasses,
  outlineButtonClasses,
  tableCellClasses,
  tableHeadClasses,
} from "../lib/ui";

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
 * in a 320px column beside a running thread, and the results screen renders it on a page
 * where an objective's severity has room to be read.
 */
export function ObjectiveMatrix({
  runs,
  arms,
  rows,
  compact = false,
}: {
  runs: ExperimentRunSchema[];
  arms: ArmEvaluationSchema[];
  rows: ObjectiveResultSchema[];
  compact?: boolean;
}) {
  const style = compact
    ? {
        headRow: "text-xs font-semibold text-admin-muted",
        head: "",
        armHead: "w-10 text-right",
        cell: "py-0.5 pr-2",
        armCell: "py-0.5 text-right",
      }
    : {
        headRow: "",
        head: tableHeadClasses,
        armHead: `${tableHeadClasses} w-16 text-right`,
        cell: `${tableCellClasses} pr-2`,
        armCell: `${tableCellClasses} text-right`,
      };
  return (
    <table className="w-full text-left text-[13px]">
      <caption className="sr-only">
        Every objective this scenario composed, and where each arm stands against it
      </caption>
      <thead>
        <tr className={style.headRow}>
          <th scope="col" className={style.head}>
            Objective
          </th>
          {runs.map((run) => (
            <th key={run.run_id} scope="col" className={style.armHead}>
              {run.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.objective_id}>
            <th scope="row" className={`${style.cell} font-normal text-admin-ink-soft`}>
              {row.statement}
              {compact ? null : (
                <span className="ml-2 text-xs text-admin-muted">
                  {row.severity}
                  {row.evidence === "forbidden" ? " · must never happen" : ""}
                </span>
              )}
            </th>
            {arms.map((arm) => {
              const result = arm.objectives.find(
                (entry) => entry.objective_id === row.objective_id,
              );
              const outcome = result ? OUTCOMES[result.outcome] : null;
              return (
                <td
                  key={arm.run_id}
                  className={style.armCell}
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

/**
 * The judges this lab could be asked to score with, and the one currently chosen.
 *
 * Only published judges are offered: a verdict names the frozen version that produced it, and
 * a draft has none. A lab with no judge service still reads its experiments — the failure is
 * swallowed on purpose, and the judge's rows simply go on saying that a judge owns them.
 */
export function usePublishedJudges(): {
  judges: JudgeConfigurationSummarySchema[];
  judgeId: string;
  setJudgeId: (judgeId: string) => void;
} {
  const [judges, setJudges] = useState<JudgeConfigurationSummarySchema[]>([]);
  const [judgeId, setJudgeId] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    listJudgeConfigurations(controller.signal)
      .then((listed) => {
        const published = listed.judges.filter((judge) => judge.latest_published_version !== null);
        setJudges(published);
        setJudgeId((current) => current || (published[0]?.judge_id ?? ""));
      })
      .catch(() => {
        // See above: an unreachable judge service is not an unreadable experiment.
      });
    return () => controller.abort();
  }, []);

  return { judges, judgeId, setJudgeId };
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
  onSelectJudge,
  onScore,
}: {
  judges: JudgeConfigurationSummarySchema[];
  judgeId: string;
  action: string;
  scoring: boolean;
  onSelectJudge: (judgeId: string) => void;
  onScore: () => void;
}) {
  return (
    <>
      <label className={fieldLabelClasses}>
        Judge
        <select
          aria-label="Judge"
          className={fieldControlClasses}
          value={judgeId}
          onChange={(event) => onSelectJudge(event.target.value)}
        >
          {judges.map((judge) => (
            <option key={judge.judge_id} value={judge.judge_id}>
              {judge.name} · v{judge.latest_published_version} · {judge.model_id}
            </option>
          ))}
        </select>
      </label>
      <button
        className={outlineButtonClasses}
        type="button"
        disabled={scoring || judgeId === ""}
        onClick={onScore}
      >
        {scoring ? "Scoring…" : action}
      </button>
    </>
  );
}
