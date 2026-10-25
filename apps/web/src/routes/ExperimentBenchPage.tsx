import type {
  ArmMetricsSchema,
  ArmStandingSchema,
  ExperimentEvaluationResponse,
  ExperimentResponse,
  ExperimentRunSchema,
  JudgeConfigurationSummarySchema,
} from "@agent-lab/contracts";
import { type FormEvent, useCallback, useEffect, useId, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { describeApiError } from "../api/client";
import {
  advanceExperimentRun,
  deliverParticipantTurn,
  getExperiment,
  getExperimentEvaluation,
  scoreExperiment,
} from "../api/experiments";
import { ActionStatus } from "../components/ActionStatus";
import { DifferenceList } from "../components/ArmComparison";
import { ButtonIcon } from "../components/ButtonIcon";
import { ArmThread } from "../components/ConversationThread";
import { JudgePicker, ObjectiveMatrix } from "../components/ObjectiveEvidence";
import { BusyButton, PrimaryAction, RefusalLine } from "../components/PrimaryAction";
import { RunProvenance } from "../components/RunProvenance";
import { ToggleChipGroup } from "../components/ToggleChipGroup";
import { Card, Fingerprint, PageHeader } from "../components/WorkspaceChrome";
import {
  ARM_PROGRESS,
  type BenchAction,
  benchReport,
  scoreReport,
  TAKES_A_MINUTE,
} from "../lib/actionStatus";
import {
  describeArmStanding,
  divergentTurnIds,
  formatCost,
  formatDuration,
  formatTokens,
  writeKey,
  writeLabel,
  writesOf,
} from "../lib/evidence";
import { TEXT_MAX_LENGTH } from "../lib/fieldRules";
import { pythonStrip } from "../lib/pythonText";
import { useRefusalTouch } from "../lib/refusalTouch";
import {
  fieldLabelClasses,
  formatTimestamp,
  outlineButtonClasses,
  textAreaClasses,
} from "../lib/ui";
import { usePublishedJudges } from "../lib/usePublishedJudges";

const UNAVAILABLE = "This experiment is unavailable.";

/**
 * The live bench (frame 8).
 *
 * Two threads side by side, each opening with the ticket's triggering message and continuing
 * with what the operator sends and what each arm's agent answers. The composer names the arms
 * one message reaches: sending to both is a linked turn, sending to one is a reply that arm
 * alone received — and the distinction is kept by the record rather than inferred from the
 * words, so two identical sentences sent by two separate decisions still read as divergence.
 *
 * Sending advances the arms it reached, one after another, because that is the operator's
 * loop. Advancing is still its own request per arm: an arm whose agent failed can be run
 * again without re-sending the customer's words, and an arm the operator wants to hold back
 * simply is not advanced.
 *
 * While that loop runs, the queue under the composer says which arm is running and which are
 * waiting, and each arm's card is read again the moment its arm ends — so the page shows an
 * arm's answer while the next one runs, rather than only a button that says "Running…" until
 * the last has finished (`form-decisions.md` 10.2, ADR 0065).
 *
 * Nothing about that loop lives in this page. An experiment is entirely in the record, so
 * reopening one is a plain read: every thread comes back, and each arm says what it is
 * waiting for because the backend computed it from the same rule the runner obeys
 * (ADR 0029). An operator who left mid-incident finds the arm that never answered, not a
 * bench that has forgotten it.
 */
/**
 * The live bench, mounted afresh for every experiment.
 *
 * A move from one bench to another is otherwise the same page with a new parameter, and what
 * the page holds for the run it was opened on — the queue of an action still in flight, the
 * record each arm reads back as it ends — would land on the next one: a turn still running on
 * bench A would read A's record into bench B and show A's queue there. Keyed by the
 * experiment, the old page unmounts and its late answers go nowhere, as `CustomerEditorRoute`
 * does for a profile.
 */
export function ExperimentBenchRoute() {
  const { shopId = "", experimentId = "" } = useParams();
  return <ExperimentBenchPage key={`${shopId}/${experimentId}`} />;
}

export function ExperimentBenchPage() {
  // Both identifiers come from the address: an experiment belongs to the shop it was started
  // in for good, and the API addresses it under that shop (ADR 0054).
  const { shopId = "", experimentId = "" } = useParams();
  const [experiment, setExperiment] = useState<ExperimentResponse | null>(null);
  const [evaluation, setEvaluation] = useState<ExperimentEvaluationResponse | null>(null);
  const { judges, judgeId, setJudgeId } = usePublishedJudges();
  const [scoring, setScoring] = useState(false);
  // What the last scoring pass answered, for the queue's settled rows; null before one.
  const [scored, setScored] = useState<ExperimentEvaluationResponse | null>(null);
  const [message, setMessage] = useState("");
  const [targets, setTargets] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The one bench action in flight, or the last one, settled; null before the first press.
  const [action, setAction] = useState<BenchAction | null>(null);
  const running = action !== null && !action.settled;
  const sendReasonId = useId();
  // Every arm having completed is nothing the operator can edit, so the composer's refusal is
  // a hint until they type a message, tick an arm or press Send (ADR 0078).
  const sendTouch = useRefusalTouch();
  const runNoteId = useId();
  const scoreNoteId = useId();

  const load = useCallback(
    async (signal?: AbortSignal) => {
      // Together, because an objective is met by a call an arm has just made: reading the
      // thread without the judgement beside it would show a write with no row that moved.
      const [record, judged] = await Promise.all([
        getExperiment(shopId, experimentId, signal),
        getExperimentEvaluation(shopId, experimentId, signal),
      ]);
      setExperiment(record);
      setEvaluation(judged);
      // Default to a linked turn: the arms are meant to hear the same customer until the
      // operator deliberately splits them. An arm that has reached its scenario's turn cap
      // drops out of the selection, because the backend would refuse the message.
      const open = record.runs.filter(driveable).map((run) => run.run_id);
      setTargets((current) => (current ?? open).filter((runId) => open.includes(runId)));
    },
    [shopId, experimentId],
  );

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal).catch((cause: unknown) => {
      if (!controller.signal.aborted) {
        setError(describeApiError(cause, UNAVAILABLE));
      }
    });
    return () => controller.abort();
  }, [load]);

  /**
   * Run each named arm, one after another, and report the first arm that could not run.
   *
   * One at a time, so the queue is a fact rather than a guess: the arm being advanced is the
   * one running, and the rest wait. Each arm's record is read again as soon as it ends, so its
   * card shows what it answered while the next arm runs and its row says where it now stands.
   * Every arm is attempted even when one fails: the arms run different configurations, so an
   * arm this lab cannot run says nothing about the arm beside it.
   */
  const runAgents = async (runIds: string[]) => {
    let failure: unknown = null;
    const done: string[] = [];
    const failed: string[] = [];
    for (const runId of runIds) {
      setAction({
        targets: runIds,
        delivering: false,
        current: runId,
        done: [...done],
        failed: [...failed],
        settled: false,
      });
      try {
        await advanceExperimentRun(shopId, experimentId, runId);
      } catch (cause: unknown) {
        failure = failure ?? cause;
        failed.push(runId);
      }
      await load().catch(() => setError(UNAVAILABLE));
      done.push(runId);
    }
    setAction({
      targets: runIds,
      delivering: false,
      current: null,
      done: [...done],
      failed: [...failed],
      settled: true,
    });
    if (failure !== null) {
      throw failure;
    }
  };

  const send = async (event: FormEvent) => {
    event.preventDefault();
    // One bench action at a time: the press is held while one runs, and so is its form.
    if (running) {
      return;
    }
    if (pythonStrip(message) === "") {
      setError("Write the customer's next message before sending it.");
      return;
    }
    if (!targets || targets.length === 0) {
      setError("Choose at least one arm to send this message to.");
      return;
    }
    // In the order the arms are drawn, whatever order they were ticked in.
    const reached = (experiment?.runs ?? [])
      .map((run) => run.run_id)
      .filter((runId) => targets.includes(runId));
    setAction({
      targets: reached,
      delivering: true,
      current: null,
      done: [],
      failed: [],
      settled: false,
    });
    setError(null);
    let delivered = false;
    try {
      await deliverParticipantTurn(shopId, experimentId, {
        run_ids: reached,
        message: pythonStrip(message),
      });
      delivered = true;
      setMessage("");
      sendTouch.reset();
      // The message is in both threads before either arm answers it.
      await load().catch(() => setError(UNAVAILABLE));
      await runAgents(reached);
    } catch (cause: unknown) {
      setError(describeApiError(cause, "This message could not be delivered."));
      if (!delivered) {
        // Nothing reached an arm, so there is nothing to report but the alert.
        setAction(null);
        await load().catch(() => setError(UNAVAILABLE));
      }
    }
  };

  const runJudge = async () => {
    if (judgeId === "") {
      return;
    }
    setScoring(true);
    setScored(null);
    setError(null);
    try {
      const judged = await scoreExperiment(shopId, experimentId, { judge_id: judgeId });
      setEvaluation(judged);
      setScored(judged);
    } catch (cause: unknown) {
      setError(describeApiError(cause, "This experiment could not be scored."));
    } finally {
      setScoring(false);
    }
  };

  /**
   * Where focus goes when a Run is pressed and its arm answers: the button is only offered
   * while the arm waits for an agent, so it leaves the page the moment the arm has answered,
   * taking focus with it. The reader is put on the arm's card instead — the answer they
   * pressed for — rather than on the page's body. A Run that fails comes back as *Try again*
   * and never lost focus: it is `aria-disabled` while it runs (ADR 0065).
   *
   * The card is made focusable for that hand-off only, and stops being so once focus leaves
   * it: a card that stayed `tabindex="-1"` would take focus from any click inside it.
   */
  const armCards = useRef(new Map<string, HTMLElement>());
  const returnFocusTo = useRef<string | null>(null);
  useEffect(() => {
    const runId = returnFocusTo.current;
    if (runId === null || running) {
      return;
    }
    returnFocusTo.current = null;
    const card = armCards.current.get(runId);
    if (
      card !== undefined &&
      (document.activeElement === null || document.activeElement === document.body)
    ) {
      card.tabIndex = -1;
      card.addEventListener("blur", () => card.removeAttribute("tabindex"), { once: true });
      card.focus();
    }
  }, [running]);

  const advance = async (runId: string) => {
    returnFocusTo.current = runId;
    setError(null);
    try {
      await runAgents([runId]);
    } catch (cause: unknown) {
      setError(describeApiError(cause, "This arm could not be run."));
    }
  };

  if (experiment === null) {
    return (
      <>
        <PageHeader title="Live bench" />
        {error ? (
          <p role="alert" className="text-[13px] text-lab-error">
            {error}
          </p>
        ) : (
          <p className="text-sm text-admin-muted">Loading experiment…</p>
        )}
      </>
    );
  }

  const divergent = divergentTurnIds(experiment);
  const queue = benchReport(experiment.runs, action);
  // An arm whose row is still to change is the card that is about to change.
  const busyArms = new Set(
    queue.rows.filter((row) => ARM_PROGRESS[row.progress].busy).map((row) => row.key),
  );

  return (
    <>
      <PageHeader
        title={experiment.label}
        description={
          <>
            <Link className="font-semibold text-lab-ink" to="/lab/bench">
              Back to the bench
            </Link>{" "}
            · scenario v{experiment.scenario_version} · seed {experiment.seed} · started{" "}
            {formatTimestamp(experiment.created_at)}
          </>
        }
        actions={
          <Link
            className={outlineButtonClasses}
            to={`/lab/bench/${shopId}/${experimentId}/results`}
          >
            <ButtonIcon verb="results" />
            Results
          </Link>
        }
      />

      {error ? (
        <p role="alert" className="mb-4 text-[13px] text-lab-error">
          {error}
        </p>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="grid min-w-0 content-start gap-4">
          {/* The pair of arms is what a tour points at, and the pair has no name of its own. */}
          <div data-tour="bench-arms" className="grid gap-4 lg:grid-cols-2">
            {experiment.runs.map((run) => (
              <Card
                key={run.run_id}
                title={run.label}
                busy={busyArms.has(run.run_id)}
                ref={(node) => {
                  if (node === null) {
                    armCards.current.delete(run.run_id);
                  } else {
                    armCards.current.set(run.run_id, node);
                  }
                }}
              >
                <p className="text-xs text-admin-muted">
                  {run.framework_id} · {run.model_id}
                </p>
                <p className="text-xs text-admin-muted">
                  Configuration v{run.agent_configuration_version} · r{run.revision} ·{" "}
                  <Fingerprint value={run.state_fingerprint} />
                </p>
                <Standing standing={run.standing} metrics={run.metrics} />
                <ArmThread experiment={experiment} run={run} divergent={divergent} />
                <RunCost metrics={run.metrics} />
                <AdvanceControl
                  run={run}
                  busy={running}
                  running={running && action?.current === run.run_id}
                  noteId={runNoteId}
                  onAdvance={() => void advance(run.run_id)}
                />
              </Card>
            ))}
          </div>

          <Card
            title="Customer composer"
            footer={
              <p className="text-xs text-admin-muted">
                One send is one composition however many arms it reaches. Sending the same words to
                each arm separately is two compositions, and the record keeps them apart.
              </p>
            }
          >
            {/* Above the composer, where the prototype draws the queue: the arms a send reached,
                or the one arm a Run pressed on its card, each saying where it stands. */}
            <ActionStatus
              label="Where each arm stands"
              report={queue}
              note={TAKES_A_MINUTE}
              noteId={runNoteId}
            />
            {experiment.participant_driver === "human" ? null : (
              // The recorded driver is what produced this run's turns, and a run half typed
              // by a person would carry one label for two things (ADR 0025). So the composer
              // says which driver this run records rather than offering a send the backend
              // would refuse — and only a *derived* run can say where its script came from,
              // because an experiment may also be started under a driver by hand.
              <p className="text-[13px] text-admin-ink-soft">
                This experiment records its customer turns as {experiment.participant_driver}, so
                there is nothing to compose here.
                {experiment.derived_from
                  ? ` Its thread was driven by the run it was derived from, ${experiment.derived_from.label}.`
                  : ""}
              </p>
            )}
            <form
              className="grid gap-3"
              hidden={experiment.participant_driver !== "human"}
              onSubmit={send}
              {...sendTouch.watch}
            >
              <label className={fieldLabelClasses}>
                Message
                <textarea
                  maxLength={TEXT_MAX_LENGTH}
                  className={`${textAreaClasses} w-full`}
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                />
              </label>
              {/* The arms are a small closed set of toggles, drawn as every such set is. A
                  completed arm cannot take a turn, so its chip is off and says why beneath. */}
              <ToggleChipGroup
                label="Deliver to"
                options={experiment.runs.map((run) => ({
                  value: run.run_id,
                  label: run.label,
                  disabledReason: driveable(run) ? undefined : `${run.label} has completed.`,
                }))}
                value={targets ?? []}
                onChange={setTargets}
              />
              <PrimaryAction
                variant="accent"
                type="submit"
                refusal={
                  experiment.runs.some(driveable)
                    ? null
                    : { id: sendReasonId, reason: EVERY_ARM_COMPLETED }
                }
                busy={running}
                aria-describedby={runNoteId}
              >
                {running ? "Running…" : "Send as the customer"}
              </PrimaryAction>
              {experiment.runs.some(driveable) ? null : (
                <RefusalLine id={sendReasonId} touched={sendTouch.touched}>
                  {EVERY_ARM_COMPLETED}
                </RefusalLine>
              )}
            </form>
          </Card>
        </div>

        <div className="grid content-start gap-4">
          <Card
            title="Provenance"
            footer={
              <p className="text-xs text-admin-muted">
                Both arms were cloned from one snapshot, so they began at the same fingerprint and
                moved apart only when something wrote.
              </p>
            }
          >
            {/* The results' rail reads the same body, so the two describe one run alike; a run
                in progress is not what a reviewer reads, so nothing here is a link (ADR 0068). */}
            <RunProvenance experiment={experiment} shopId={shopId} linked={false} />
          </Card>

          <Objectives
            experiment={experiment}
            evaluation={evaluation}
            judges={judges}
            judgeId={judgeId}
            scoring={scoring}
            scored={scored}
            noteId={scoreNoteId}
            onSelectJudge={setJudgeId}
            onScore={() => void runJudge()}
          />

          <StateChanges experiment={experiment} />

          <Card title="Comparison variables">
            <DifferenceList experiment={experiment} shopId={shopId} />
          </Card>

          <Card title="Arms">
            <ul className="grid gap-2 text-[13px]">
              {experiment.runs.map((run) => (
                <li key={run.run_id} className="grid gap-0.5">
                  <span className="font-semibold text-lab-ink">{run.label}</span>
                  <span className="text-xs text-admin-muted">
                    sandbox <Fingerprint value={run.state_fingerprint} />
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}

/**
 * What this arm is waiting for, in the words the operator's next move is in.
 *
 * The first thing on the card because it is the first thing someone reopening a bench needs:
 * two arms progress independently, so "which of these is mine to move" is not answerable by
 * reading two transcripts. It is the server's reading rather than this page's — the same one
 * the runner acts on, so the button below can never offer a run the backend would decline. The
 * sentence is `describeArmStanding`'s, the one the results' arm card reads, so the bench and the
 * results count a thread's turns the same way — from one.
 */
function Standing({
  standing,
  metrics,
}: {
  standing: ArmStandingSchema;
  metrics: ArmMetricsSchema;
}) {
  const waiting = describeArmStanding(standing, metrics);
  return (
    <p className="text-xs font-semibold text-admin-ink-soft">
      {waiting}
      {standing.unanswered.length > 0 ? (
        <span className="font-normal text-admin-muted">
          {" "}
          · {standing.unanswered.length} earlier{" "}
          {standing.unanswered.length === 1 ? "turn was" : "turns were"} never answered
        </span>
      ) : null}
    </p>
  );
}

/**
 * Run the agent, or run it again — offered exactly when the arm is waiting for one.
 *
 * The condition is the standing the backend served, not a rule this page keeps: an advance
 * on an answered turn returns the reply it already has (ADR 0026), so a button drawn from a
 * second reading of the same streams could invite a click that costs a request and changes
 * nothing.
 */
function AdvanceControl({
  run,
  busy,
  running,
  noteId,
  onAdvance,
}: {
  run: ExperimentRunSchema;
  /** A bench action is in flight, on this arm or another: no second one starts meanwhile. */
  busy: boolean;
  /** This arm is the one being advanced. */
  running: boolean;
  /** The queue's note, which says the run cannot be cancelled. */
  noteId: string;
  onAdvance: () => void;
}) {
  const { awaiting, attempts } = run.standing;
  if (awaiting !== "agent" && !running) {
    return null;
  }
  return (
    <BusyButton
      className={outlineButtonClasses}
      type="button"
      busy={busy}
      onClick={onAdvance}
      aria-label={attempts === 0 ? `Run ${run.label}'s agent` : `Try ${run.label}'s agent again`}
      aria-describedby={noteId}
    >
      <ButtonIcon verb={attempts === 0 ? "start" : "rerun"} />
      {running ? "Running…" : attempts === 0 ? "Run the agent" : "Try again"}
    </BusyButton>
  );
}

/**
 * What this arm has spent so far: the strip under each thread in frame 8.
 *
 * Every number is the server's reading of the arm's own record (ADR 0032), not a count taken
 * over the rows this page happens to be rendering — an arm's thread and its cost must not be
 * able to disagree about how many times it ran.
 *
 * An absent measurement is left out rather than drawn as a zero. A framework that does not
 * meter itself and one that spent nothing are different findings, and a strip that showed
 * "0 tok" for both would hide the one an operator has to act on. A total that covers only
 * some of the arm's attempts is marked as the floor it is, for the same reason: a failed
 * attempt reports nothing it spent, and a retried arm spent more than this says.
 */
function RunCost({ metrics }: { metrics: ArmMetricsSchema }) {
  if (metrics.attempts === 0) {
    return null;
  }
  // A total that covers fewer attempts than the arm made is a floor, not a figure. A failed
  // attempt reports nothing it spent, so a retried arm really did spend more than this.
  const floor = metrics.metered_attempts < metrics.attempts ? "≥" : "";
  const parts = [
    `${metrics.turns} ${metrics.turns === 1 ? "turn" : "turns"}`,
    metrics.usage
      ? `${floor}${formatTokens(metrics.usage.input_tokens + metrics.usage.output_tokens)} tok`
      : null,
    `${metrics.tool_calls} ${metrics.tool_calls === 1 ? "tool" : "tools"}`,
    metrics.duration_ms === null ? null : formatDuration(metrics.duration_ms),
    metrics.retries > 0
      ? `${metrics.retries} ${metrics.retries === 1 ? "retry" : "retries"}`
      : null,
    metrics.estimated_cost ? `${floor}${formatCost(metrics.estimated_cost)}` : null,
  ].filter((part): part is string => part !== null);
  return <p className="text-xs text-admin-muted">{parts.join(" · ")}</p>;
}

/**
 * Whether this arm can still be driven, which is the standing and never a count kept here.
 *
 * An arm at its scenario's turn cap is refused by the backend, so a composer that offered it
 * would invite a request that can only fail (ADR 0029, ADR 0030).
 */
/** Why the composer sends nothing: a completed arm takes no further customer turn. */
const EVERY_ARM_COMPLETED = "Every arm has completed, so there is no arm left to send a turn to.";

function driveable(run: ExperimentRunSchema): boolean {
  return run.standing.awaiting !== "completed";
}

/**
 * The objectives matrix (frame 8): one row per objective, one column per arm.
 *
 * Rows come from the first arm because both arms are judged against one scenario's
 * objectives, in the order the recipe composed them — which is the order the author decided
 * is priority (ADR 0018).
 *
 * "Pending" is a real state and not a soft failure: deterministic evidence is monotone, so
 * an arm that has not read the document yet may still read it. It becomes a miss when the
 * arm reaches its turn cap and nothing more can happen.
 *
 * The rows a judge owns are filled by scoring, from here. The judge is chosen at scoring
 * time rather than pinned by the experiment, because judging is separate from the run and
 * rerunnable — what explains a verdict is the version recorded on it, which is why each
 * scored cell carries the judge and the model that produced it.
 */
function Objectives({
  experiment,
  evaluation,
  judges,
  judgeId,
  scoring,
  scored,
  noteId,
  onSelectJudge,
  onScore,
}: {
  experiment: ExperimentResponse;
  evaluation: ExperimentEvaluationResponse | null;
  judges: JudgeConfigurationSummarySchema[];
  judgeId: string;
  scoring: boolean;
  /** What the last scoring pass on this page answered, or null before one. */
  scored: ExperimentEvaluationResponse | null;
  noteId: string;
  onSelectJudge: (judgeId: string) => void;
  onScore: () => void;
}) {
  const arms = evaluation?.arms ?? [];
  const rows = arms[0]?.objectives ?? [];
  const judgeRows = rows.filter((row) => row.assessment === "judge");
  return (
    <Card
      title="Objectives"
      footer={
        <p className="text-xs text-admin-muted">
          Evidence, not a score: a pending objective is one this arm can still meet, and a judge
          scores its own rows from its rubric, on an anonymized record of what each arm did.
        </p>
      }
    >
      {rows.length === 0 ? (
        <p className="text-[13px] text-admin-muted">This scenario composes no objectives.</p>
      ) : (
        // Busy while a judge scores it, and only the matrix: the card also holds the scoring
        // queue, which a busy card would keep from being announced (ADR 0065).
        <div aria-busy={scoring || undefined}>
          <ObjectiveMatrix runs={experiment.runs} arms={arms} rows={rows} compact />
        </div>
      )}

      {judgeRows.length > 0 ? (
        <div className="mt-3 grid gap-2 border-t border-admin-border pt-3">
          {judges.length === 0 ? (
            <p className="text-[13px] text-admin-muted">
              {judgeRows.length} objective(s) here are a judge's. Publish a judge to score them.
            </p>
          ) : (
            <>
              <JudgePicker
                judges={judges}
                judgeId={judgeId}
                action={`Score ${judgeRows.length} judged objective(s)`}
                scoring={scoring}
                noteId={noteId}
                onSelectJudge={onSelectJudge}
                onScore={onScore}
              />
              <ActionStatus
                label="Where each arm's scoring stands"
                report={scoreReport(experiment.runs, scoring, scored?.arms ?? null)}
                note={TAKES_A_MINUTE}
                noteId={noteId}
              />
              <p className="text-xs text-admin-muted">
                Each arm is scored on its own record, and the judge is told nothing about what ran
                it. Scoring again keeps the previous verdict and records a new attempt.
              </p>
            </>
          )}
        </div>
      ) : null}
    </Card>
  );
}

/**
 * Everything that actually moved each arm, which is where the two worlds came apart.
 *
 * Both writers appear: the agent's tools, and the scenario's own faults. An operator reading
 * two revisions apart has to be able to see which of the two moved them.
 */
function StateChanges({ experiment }: { experiment: ExperimentResponse }) {
  return (
    <Card
      title="State changes"
      footer={
        <p className="text-xs text-admin-muted">
          A scenario fault is the incident working as authored, not the arm misbehaving: it moves
          the world at the moment the scenario bound it to, and the agent is never told.
        </p>
      }
    >
      <ul className="grid gap-2 text-[13px]">
        {experiment.runs.map((run) => {
          const moved = writesOf(experiment, run);
          return (
            <li key={run.run_id} className="grid gap-0.5">
              <span className="font-semibold text-lab-ink">{run.label}</span>
              {moved.length === 0 ? (
                <span className="text-xs text-admin-muted">nothing yet</span>
              ) : (
                moved.map((event) => (
                  <span key={writeKey(event)} className="text-xs text-admin-muted">
                    {writeLabel(event)} · r{event.revision_before} → r{event.revision_after}
                  </span>
                ))
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
