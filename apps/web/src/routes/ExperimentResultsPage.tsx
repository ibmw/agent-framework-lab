import type {
  ArmEvaluationSchema,
  ArmMetricsSchema,
  ExperimentAnnotationsResponse,
  ExperimentResponse,
  ExperimentRunSchema,
  JudgementSchema,
  ObjectiveResultSchema,
  ParticipantTurnSchema,
} from "@agent-lab/contracts";
import { type FormEvent, useState } from "react";
import { describeApiError } from "../api/client";
import { addExperimentNote, scoreExperiment, setExperimentTags } from "../api/experiments";
import { ButtonIcon } from "../components/ButtonIcon";
import { JudgePicker, ObjectiveMatrix, usePublishedJudges } from "../components/ObjectiveEvidence";
import { Card, Fingerprint } from "../components/WorkspaceChrome";
import {
  changeValue,
  describeFailure,
  describeJudgeFailure,
  formatCost,
  formatDuration,
  formatTokens,
  writeKey,
  writeLabel,
  writesOf,
} from "../lib/evidence";
import {
  fieldControlClasses,
  formatTimestamp,
  outlineButtonClasses,
  subtleButtonClasses,
  tableCellClasses,
  tableHeadClasses,
  textAreaClasses,
} from "../lib/ui";
import { useExperimentResults } from "./ExperimentResultsLayout";

/**
 * The measures the quantitative table reads, in the order it reads them.
 *
 * A union rather than loose strings, so a row this table names and a value `quantities`
 * produces cannot drift apart into an empty cell nobody notices.
 */
const MEASURES = [
  "Turns",
  "Answered turns",
  "Attempts",
  "Retries",
  "Failures",
  "Tool calls",
  "Writes",
  "Model requests",
  "Input tokens",
  "Output tokens",
  "Time in attempts",
  "Time in tools",
  "Estimated cost",
] as const;

type Measure = (typeof MEASURES)[number];

/**
 * The evidence overview (frame 9, General tab).
 *
 * One row per objective, one column per arm, and no number anywhere that stands for an arm
 * as a whole. That is the product direction's rule rather than a layout preference: a single
 * score would decide, on the operator's behalf, how a missed process check weighs against a
 * resolved incident — which is exactly the judgement this lab exists to hand to a person.
 *
 * Everything here is read from projections the backend already serves: the evaluation
 * (ADR 0030) with the judge's verdicts on it (ADR 0031), the metrics (ADR 0032), and the
 * arms' own recorded writes (ADR 0026, ADR 0028). This page counts nothing of its own, so it
 * can never describe a run differently from the bench it was driven on.
 */
export function ExperimentResultsPage() {
  const { shopId, experimentId, experiment, evaluation, annotations, onEvaluated, onAnnotated } =
    useExperimentResults();
  const { judges, judgeId, setJudgeId } = usePublishedJudges();
  const [scoring, setScoring] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const score = async () => {
    setScoring(true);
    setError(null);
    try {
      onEvaluated(await scoreExperiment(shopId, experimentId, { judge_id: judgeId }));
    } catch (cause: unknown) {
      setError(describeApiError(cause, "This experiment could not be scored."));
    } finally {
      setScoring(false);
    }
  };

  const arms = evaluation.arms;
  const rows = arms[0]?.objectives ?? [];
  const deterministic = rows.filter((row) => row.assessment === "deterministic");
  const judged = rows.filter((row) => row.assessment === "judge");

  return (
    <>
      <p className="mb-4 text-[13px] text-admin-muted">
        Objective by objective, arm by arm. There is no aggregate score: each arm's count is of the
        rows something actually decided for it, and the columns are never added into a winner.
      </p>

      {error ? (
        <p role="alert" className="mb-4 text-[13px] text-lab-error">
          {error}
        </p>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="grid min-w-0 content-start gap-4">
          <Card
            title="Deterministic evidence"
            footer={
              <p className="text-xs text-admin-muted">
                Decided from each arm's own recorded calls and the state it started in and is in
                now. A pending row is one the arm can still meet, and an undecidable one is a limit
                of this build rather than a fault of the agent — neither is a miss.
              </p>
            }
          >
            {deterministic.length === 0 ? (
              <p className="text-[13px] text-admin-muted">
                This scenario composes no objective a rule decides.
              </p>
            ) : (
              <ObjectiveMatrix runs={experiment.runs} arms={arms} rows={deterministic} />
            )}
          </Card>

          <Card
            title="Business state — verified, not claimed"
            footer={
              <p className="text-xs text-admin-muted">
                Read from each arm's own state rather than from what its agent said it did. A
                scenario fault appears beside the tools because it moved the same world, and the
                fields below are the whole difference between the world an arm was cloned into and
                the one it is in now — so nothing can have moved without appearing here.
              </p>
            }
          >
            <ul className="grid gap-3 text-[13px]">
              {experiment.runs.map((run) => (
                <BusinessState key={run.run_id} experiment={experiment} run={run} />
              ))}
            </ul>
          </Card>

          <Card
            title="LLM judge evidence"
            footer={
              <p className="text-xs text-admin-muted">
                Each arm is judged on an anonymized record of its own run, and the judge is told
                nothing about what ran it. Scoring again records a new attempt beside the last, and
                never overwrites a deterministic row.
              </p>
            }
          >
            {judged.length === 0 ? (
              <p className="text-[13px] text-admin-muted">
                This scenario leaves no objective to a judge.
              </p>
            ) : (
              <>
                <ObjectiveMatrix runs={experiment.runs} arms={arms} rows={judged} />
                <Verdicts runs={experiment.runs} arms={arms} rows={judged} />
                {judges.length === 0 ? (
                  <p className="text-[13px] text-admin-muted">
                    Publish a judge to score {judged.length} row(s) no rule decides.
                  </p>
                ) : (
                  <div className="grid gap-2 border-t border-admin-border pt-3">
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
                      onSelectJudge={setJudgeId}
                      onScore={() => void score()}
                    />
                  </div>
                )}
              </>
            )}
          </Card>
        </div>

        <div className="grid content-start gap-4">
          <Card
            title="Quantitative"
            footer={
              <p className="text-xs text-admin-muted">
                Observations, not scores — the model, the prompt, and the operator's own replies all
                contribute. Efficiency is readable only beside the outcome above it.
              </p>
            }
          >
            <Quantitative runs={experiment.runs} />
          </Card>

          {experiment.runs.length > 1 ? (
            <Card
              title="Input divergence"
              footer={
                <p className="text-xs text-admin-muted">
                  One send is one composition however many arms it reaches. Two compositions at the
                  same turn are two questions even when the words match, and from there the arms are
                  answering different conversations.
                </p>
              }
            >
              <Divergence experiment={experiment} />
            </Card>
          ) : null}
        </div>
      </div>

      <div className="mt-4">
        <NotesAndTags
          shopId={shopId}
          experimentId={experimentId}
          annotations={annotations}
          onAnnotated={onAnnotated}
        />
      </div>
    </>
  );
}

/**
 * Frame 9's notes-and-tags strip: what an operator concluded, beside what the run did.
 *
 * The only thing on this screen that is written rather than read, and the only thing that is
 * not evidence. A note is appended and never edited, because it is what a reviewer thought
 * when they read this run; the tags are replaced as a set, because how a run is filed is a
 * current classification rather than a record of what happened to it (ADR 0036).
 *
 * Both writes answer with everything written on the run, so this component never merges a
 * response into a list of its own — the backend's answer replaces what is on screen.
 */
function NotesAndTags({
  shopId,
  experimentId,
  annotations,
  onAnnotated,
}: {
  shopId: string;
  experimentId: string;
  annotations: ExperimentAnnotationsResponse;
  onAnnotated: (annotations: ExperimentAnnotationsResponse) => void;
}) {
  const [note, setNote] = useState("");
  const [tag, setTag] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // One writer for both operations: whichever one ran, the answer is the whole annotation,
  // and a failure leaves what the operator typed in the box rather than swallowing it.
  const write = async (
    change: () => Promise<ExperimentAnnotationsResponse>,
    unavailable: string,
    clear: () => void,
  ) => {
    setBusy(true);
    setError(null);
    try {
      onAnnotated(await change());
      clear();
    } catch (cause: unknown) {
      setError(describeApiError(cause, unavailable));
    } finally {
      setBusy(false);
    }
  };

  const submitNote = (event: FormEvent) => {
    event.preventDefault();
    void write(
      () => addExperimentNote(shopId, experimentId, { body: note.trim() }),
      "This note could not be saved.",
      () => setNote(""),
    );
  };

  // `clear` is the caller's, because only the caller knows whether the box it would empty is
  // the one this write came from: adding consumes what was typed, and removing a chip must
  // leave a half-typed tag beside it alone.
  const file = (tags: string[], clear: () => void) =>
    write(
      () => setExperimentTags(shopId, experimentId, { tags }),
      "These tags could not be saved.",
      clear,
    );

  const submitTag = (event: FormEvent) => {
    event.preventDefault();
    // The whole set every time, because that is what the contract takes: the backend folds
    // what was typed, so a tag already on the run comes back as the one chip it always was.
    void file([...annotations.tags, tag.trim()], () => setTag(""));
  };

  return (
    <Card
      title="Notes & tags"
      footer={
        <p className="text-xs text-admin-muted">
          What a reviewer concluded, stored beside the record rather than in it — annotating a run
          never moves the versions or the starting state it pinned. A note is kept as written; the
          tags are how this run is filed now, and history narrows by them.
        </p>
      }
    >
      {error ? (
        <p role="alert" className="text-[13px] text-lab-error">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {annotations.tags.length === 0 ? (
          <p className="text-[13px] text-admin-muted">Not filed under any tag yet.</p>
        ) : (
          annotations.tags.map((entry) => (
            <span
              key={entry}
              className="inline-flex items-center gap-1.5 rounded-full border border-admin-border px-2.5 py-0.5 text-[11.5px] font-semibold text-admin-ink"
            >
              {entry}
              <button
                type="button"
                aria-label={`Remove tag ${entry}`}
                disabled={busy}
                className="text-admin-muted hover:text-lab-error"
                onClick={() =>
                  void file(
                    annotations.tags.filter((kept) => kept !== entry),
                    () => {},
                  )
                }
              >
                ×
              </button>
            </span>
          ))
        )}
        <form className="flex items-center gap-2" onSubmit={submitTag}>
          <label className="sr-only" htmlFor="experiment-tag">
            Add a tag
          </label>
          <input
            id="experiment-tag"
            className={`${fieldControlClasses} h-8 w-48`}
            placeholder="read-check-gap"
            value={tag}
            onChange={(event) => setTag(event.target.value)}
          />
          <button
            className={subtleButtonClasses}
            type="submit"
            disabled={busy || tag.trim() === ""}
          >
            <ButtonIcon verb="create" />
            Add tag
          </button>
        </form>
      </div>

      {annotations.notes.length > 0 ? (
        <ul className="grid gap-2 border-t border-admin-border pt-3">
          {annotations.notes.map((entry) => (
            <li key={entry.note_id} className="grid gap-0.5">
              <p className="text-[13px] text-admin-ink">{entry.body}</p>
              <p className="text-xs text-admin-muted">{formatTimestamp(entry.created_at)}</p>
            </li>
          ))}
        </ul>
      ) : null}

      <form className="grid gap-2 border-t border-admin-border pt-3" onSubmit={submitNote}>
        <label className="sr-only" htmlFor="experiment-note">
          Add a note
        </label>
        <textarea
          id="experiment-note"
          className={textAreaClasses}
          placeholder="What this run showed, in your own words…"
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
        <div>
          <button
            className={outlineButtonClasses}
            type="submit"
            disabled={busy || note.trim() === ""}
          >
            <ButtonIcon verb="create" />
            Add note
          </button>
        </div>
      </form>
    </Card>
  );
}

/**
 * What produced each judged verdict: the version, the model, the attempt, and the input.
 *
 * On the page rather than only in a tooltip, because it is what separates a verdict from a
 * number. A row a judge could not reach says so here too — the lab's own outage is a fact
 * about the lab, and leaving it invisible would read as an arm that was simply not judged.
 */
function Verdicts({
  runs,
  arms,
  rows,
}: {
  runs: ExperimentRunSchema[];
  arms: ArmEvaluationSchema[];
  rows: ObjectiveResultSchema[];
}) {
  const scored = arms.flatMap((arm) =>
    arm.objectives.flatMap((entry) => {
      // Bound before the test so the verdict below is a value rather than a lookup the
      // renderer has to defend against: a row a judge has not touched simply is not here.
      const judgement = entry.judgement;
      return judgement && rows.some((row) => row.objective_id === entry.objective_id)
        ? [{ arm, entry, judgement }]
        : [];
    }),
  );
  if (scored.length === 0) {
    return null;
  }
  return (
    <ul className="grid gap-1 text-xs text-admin-muted">
      {scored.map(({ arm, entry, judgement }) => (
        <li key={`${arm.run_id}:${entry.objective_id}`}>
          {runs.find((run) => run.run_id === arm.run_id)?.label ?? "Unknown arm"} ·{" "}
          {entry.objective_id} · {describeVerdict(judgement)} · judge v{judgement.judge_version} ·{" "}
          {judgement.model_id} · attempt {judgement.attempt} · brief{" "}
          <Fingerprint value={judgement.brief_fingerprint} />
        </li>
      ))}
    </ul>
  );
}

/**
 * One judge execution's answer: its verdict, or why it produced none.
 *
 * A failed execution is reported rather than left blank. The lab's own outage is a fact about
 * the lab, and an empty cell where a judge could not be reached would read as an arm nobody
 * thought worth judging (ADR 0031).
 */
function describeVerdict(judgement: JudgementSchema): string {
  if (judgement.failure !== null) {
    return `no verdict — ${describeJudgeFailure(judgement.failure)}`;
  }
  return judgement.outcome ?? "no verdict";
}

/**
 * Everything that moved one arm, what it moved it to, and where that arm's world stands now.
 *
 * The writes say who moved it and the diff says what about it moved — a revision counter is
 * true of a redirected order and of a corrected typo alike, and the frame this card
 * implements shows the value on both sides (ADR 0035).
 */
function BusinessState({
  experiment,
  run,
}: {
  experiment: ExperimentResponse;
  run: ExperimentRunSchema;
}) {
  const writes = writesOf(experiment, run);
  const { orders, other } = run.state_diff;
  return (
    <li className="grid gap-0.5">
      <span className="font-semibold text-lab-ink">{run.label}</span>
      {writes.length === 0 ? (
        <span className="text-xs text-admin-muted">
          Nothing wrote — this arm's world is the one it started in.
        </span>
      ) : (
        writes.map((event) => (
          <span key={writeKey(event)} className="text-xs text-admin-muted">
            {writeLabel(event)} · r{event.revision_before} → r{event.revision_after}
          </span>
        ))
      )}
      {orders.map((order) => (
        <dl key={order.order_id} className="mt-1 grid gap-0.5">
          <dt className="text-xs font-semibold text-lab-ink">{order.reference}</dt>
          {order.changes.map((change) => (
            <dd key={change.path} className="text-xs text-admin-muted">
              {change.path}: {changeValue(change.before)} →{" "}
              <span className="text-lab-ink">{changeValue(change.after)}</span>
            </dd>
          ))}
        </dl>
      ))}
      {other.length > 0 ? (
        <span role="alert" className="text-xs text-lab-error">
          Changed outside every order:{" "}
          {other
            .map(
              (change) =>
                `${change.path}: ${changeValue(change.before)} → ${changeValue(change.after)}`,
            )
            .join(", ")}
        </span>
      ) : null}
      <span className="text-xs text-admin-muted">
        Now at r{run.revision} · <Fingerprint value={run.state_fingerprint} /> · started from{" "}
        <Fingerprint value={run.snapshot_fingerprint} />
        {other.length === 0 && orders.length > 0 ? " · no other state changed" : null}
      </span>
    </li>
  );
}

/**
 * What each arm spent, measure by measure.
 *
 * An unreported measurement says so rather than showing a zero. A framework that does not
 * meter itself and an arm that called no model are different findings, and a column of
 * zeros for both would hide the one an operator has to act on.
 */
function Quantitative({ runs }: { runs: ExperimentRunSchema[] }) {
  const columns = runs.map((run) => ({ run, values: quantities(run.metrics) }));
  return (
    <table className="w-full text-left text-[13px]">
      <caption className="sr-only">What each arm has spent so far</caption>
      <thead>
        <tr>
          <th scope="col" className={tableHeadClasses}>
            Measure
          </th>
          {runs.map((run) => (
            <th key={run.run_id} scope="col" className={`${tableHeadClasses} text-right`}>
              {run.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {MEASURES.map((measure) => (
          <tr key={measure}>
            <th scope="row" className={`${tableCellClasses} font-normal text-admin-ink-soft`}>
              {measure}
            </th>
            {columns.map(({ run, values }) => (
              <td key={run.run_id} className={`${tableCellClasses} text-right`}>
                {values[measure]}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * One arm's metrics as the strings the table renders.
 *
 * "not reported" is a value here, deliberately. It is what the backend means by a null: a
 * measurement nobody took, which is a different reading from a measurement of zero.
 */
function quantities(metrics: ArmMetricsSchema): Record<Measure, string> {
  // A total covering fewer attempts than the arm made is a floor, not a figure: a failed
  // attempt reports nothing it spent, so a retried arm really did spend more than this.
  const floor = metrics.metered_attempts < metrics.attempts ? "≥" : "";
  const failures = Object.entries(metrics.failures);
  return {
    Turns: `${metrics.turns}`,
    "Answered turns": `${metrics.answered_turns}`,
    Attempts: `${metrics.attempts}`,
    Retries: `${metrics.retries}`,
    Failures:
      failures.length === 0
        ? "none"
        : failures.map(([code, count]) => `${count} × ${describeFailure(code)}`).join("; "),
    "Tool calls": `${metrics.tool_calls}`,
    Writes: `${metrics.tool_writes}`,
    "Model requests":
      metrics.model_requests === null ? "not reported" : `${metrics.model_requests}`,
    "Input tokens":
      metrics.usage === null
        ? "not reported"
        : `${floor}${formatTokens(metrics.usage.input_tokens)}`,
    "Output tokens":
      metrics.usage === null
        ? "not reported"
        : `${floor}${formatTokens(metrics.usage.output_tokens)}`,
    "Time in attempts":
      metrics.duration_ms === null
        ? "not reported"
        : `${formatDuration(metrics.duration_ms)}${
            metrics.measured_attempts < metrics.attempts
              ? ` (${metrics.measured_attempts} of ${metrics.attempts})`
              : ""
          }`,
    "Time in tools":
      metrics.tool_duration_ms === null ? "not reported" : formatDuration(metrics.tool_duration_ms),
    "Estimated cost":
      metrics.estimated_cost === null
        ? "not priced"
        : `${floor}${formatCost(metrics.estimated_cost)}`,
  };
}

/**
 * The turns the arms did not hear alike.
 *
 * Read from the composition each turn belongs to rather than from the words in it: the same
 * sentence sent to each arm by two separate decisions is two compositions, and it is those
 * two decisions — not the text — that make everything after them an uncontrolled comparison.
 */
function Divergence({ experiment }: { experiment: ExperimentResponse }) {
  const ordinals = [...new Set(experiment.turns.map((turn) => turn.ordinal))].sort(
    (left, right) => left - right,
  );
  const divergent = ordinals.filter((ordinal) => {
    const delivered = experiment.turns.filter((turn) => turn.ordinal === ordinal);
    const compositions = new Set(delivered.map((turn) => turn.turn_id));
    return compositions.size > 1 || delivered.length < experiment.runs.length;
  });
  if (divergent.length === 0) {
    return (
      <p className="text-[13px] text-admin-muted">
        Every turn reached both arms as one composition — the comparison is controlled.
      </p>
    );
  }
  return (
    <ul className="grid gap-2 text-[13px]">
      {divergent.map((ordinal) => (
        <li key={ordinal} className="grid gap-0.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-admin-muted">
            Turn {ordinal}
          </span>
          {experiment.runs.map((run) => {
            const heard = experiment.turns.find(
              (turn: ParticipantTurnSchema) =>
                turn.run_id === run.run_id && turn.ordinal === ordinal,
            );
            return (
              <span key={run.run_id} className="text-xs text-admin-ink-soft">
                <span className="font-semibold">{run.label}:</span>{" "}
                {heard ? `“${heard.body}”` : "never received this turn"}
              </span>
            );
          })}
        </li>
      ))}
    </ul>
  );
}
