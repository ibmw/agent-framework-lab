import type {
  AgentTurnSchema,
  ArmMetricsSchema,
  ArmStandingSchema,
  ExperimentEvaluationResponse,
  ExperimentResponse,
  ExperimentRunSchema,
  JudgeConfigurationSummarySchema,
  MutationEventSchema,
  ParticipantTurnSchema,
  ToolEventSchema,
} from "@agent-lab/contracts";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { describeApiError } from "../api/client";
import {
  advanceExperimentRun,
  deliverParticipantTurn,
  getExperiment,
  getExperimentEvaluation,
  scoreExperiment,
} from "../api/experiments";
import { ButtonIcon } from "../components/ButtonIcon";
import { JudgePicker, ObjectiveMatrix, usePublishedJudges } from "../components/ObjectiveEvidence";
import { TourLaunch } from "../components/TourLaunch";
import { Card, Fingerprint, PageHeader } from "../components/WorkspaceChrome";
import {
  COMPARISON_DIMENSION,
  DEFINITION_TYPE,
  describeValue,
  labelOf,
  TOOL_OUTCOME,
} from "../lib/enumLabels";
import {
  describeFailure,
  formatCost,
  formatDuration,
  formatTokens,
  writeKey,
  writeLabel,
  writesOf,
} from "../lib/evidence";
import {
  accentButtonClasses,
  fieldLabelClasses,
  formatTimestamp,
  outlineButtonClasses,
  subtleButtonClasses,
  textAreaClasses,
} from "../lib/ui";

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
 * Nothing about that loop lives in this page. An experiment is entirely in the record, so
 * reopening one is a plain read: every thread comes back, and each arm says what it is
 * waiting for because the backend computed it from the same rule the runner obeys
 * (ADR 0029). An operator who left mid-incident finds the arm that never answered, not a
 * bench that has forgotten it.
 */
export function ExperimentBenchPage() {
  // Both identifiers come from the address: an experiment belongs to the shop it was started
  // in for good, and the API addresses it under that shop (ADR 0054).
  const { shopId = "", experimentId = "" } = useParams();
  const [experiment, setExperiment] = useState<ExperimentResponse | null>(null);
  const [evaluation, setEvaluation] = useState<ExperimentEvaluationResponse | null>(null);
  const { judges, judgeId, setJudgeId } = usePublishedJudges();
  const [scoring, setScoring] = useState(false);
  const [message, setMessage] = useState("");
  const [targets, setTargets] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState<string | null>(null);

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
   * One at a time because two arms writing into their own sandboxes cannot collide but a
   * reply arriving while the operator reads the other thread would move the page under them.
   * Every arm is attempted even when one fails: the arms run different configurations, so an
   * arm this lab cannot run says nothing about the arm beside it.
   */
  const runAgents = async (runIds: string[]) => {
    let failure: unknown = null;
    for (const runId of runIds) {
      setWorking(runId);
      try {
        await advanceExperimentRun(shopId, experimentId, runId);
      } catch (cause: unknown) {
        failure = failure ?? cause;
      }
    }
    if (failure !== null) {
      throw failure;
    }
  };

  const send = async (event: FormEvent) => {
    event.preventDefault();
    if (message.trim() === "") {
      setError("Write the customer's next message before sending it.");
      return;
    }
    if (!targets || targets.length === 0) {
      setError("Choose at least one arm to send this message to.");
      return;
    }
    setWorking(targets[0]);
    setError(null);
    try {
      await deliverParticipantTurn(shopId, experimentId, {
        run_ids: targets,
        message: message.trim(),
      });
      setMessage("");
      await runAgents(targets);
    } catch (cause: unknown) {
      setError(describeApiError(cause, "This message could not be delivered."));
    } finally {
      setWorking(null);
      await load().catch(() => setError(UNAVAILABLE));
    }
  };

  const runJudge = async () => {
    if (judgeId === "") {
      return;
    }
    setScoring(true);
    setError(null);
    try {
      setEvaluation(await scoreExperiment(shopId, experimentId, { judge_id: judgeId }));
    } catch (cause: unknown) {
      setError(describeApiError(cause, "This experiment could not be scored."));
    } finally {
      setScoring(false);
    }
  };

  const advance = async (runId: string) => {
    setWorking(runId);
    setError(null);
    try {
      await runAgents([runId]);
    } catch (cause: unknown) {
      setError(describeApiError(cause, "This arm could not be run."));
    } finally {
      setWorking(null);
      await load().catch(() => setError(UNAVAILABLE));
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

  const differences = experiment.comparison.filter((variable) => variable.differs);
  const divergent = divergentTurnIds(experiment);

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
          <>
            <TourLaunch id="bench" />
            <Link
              className={outlineButtonClasses}
              to={`/lab/bench/${shopId}/${experimentId}/results`}
            >
              <ButtonIcon verb="results" />
              Results
            </Link>
          </>
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
              <Card key={run.run_id} title={run.label}>
                <p className="text-xs text-admin-muted">
                  {run.framework_id} · {run.model_id}
                </p>
                <p className="text-xs text-admin-muted">
                  Configuration v{run.agent_configuration_version} · r{run.revision} ·{" "}
                  <Fingerprint value={run.state_fingerprint} />
                </p>
                <Standing standing={run.standing} />
                <Thread experiment={experiment} run={run} divergent={divergent} />
                <RunCost metrics={run.metrics} />
                <AdvanceControl
                  run={run}
                  working={working === run.run_id}
                  onAdvance={() => advance(run.run_id)}
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
            >
              <label className={fieldLabelClasses}>
                Message
                <textarea
                  className={textAreaClasses}
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                />
              </label>
              <fieldset className="flex flex-wrap items-center gap-3">
                <legend className="text-xs font-semibold text-admin-muted">Deliver to</legend>
                {experiment.runs.map((run) => (
                  <label key={run.run_id} className="flex items-center gap-2 text-[13px]">
                    <input
                      type="checkbox"
                      checked={targets?.includes(run.run_id) ?? false}
                      disabled={!driveable(run)}
                      onChange={(event) =>
                        setTargets((current) => {
                          const selected = current ?? [];
                          return event.target.checked
                            ? [...selected, run.run_id]
                            : selected.filter((identifier) => identifier !== run.run_id);
                        })
                      }
                    />
                    {run.label}
                    {driveable(run) ? null : (
                      <span className="text-xs text-admin-muted">— completed</span>
                    )}
                  </label>
                ))}
              </fieldset>
              <button
                className={accentButtonClasses}
                type="submit"
                disabled={working !== null || !experiment.runs.some(driveable)}
              >
                {working !== null ? "Running…" : "Send as the customer"}
              </button>
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
            <p className="text-[13px] text-admin-ink-soft">
              Starting state <Fingerprint value={experiment.sandbox_fingerprint} />
            </p>
            <p className="text-[13px] text-admin-ink-soft">
              Inputs <Fingerprint value={experiment.resolution_fingerprint} />
            </p>
            <p className="text-[13px] text-admin-ink-soft">
              Participant: {experiment.participant_driver} operator
            </p>
            <ul className="grid gap-1 text-xs text-admin-muted">
              {experiment.sandbox_inputs.map((pin) => (
                <li key={`${pin.definition_type}:${pin.definition_id}`}>
                  {describeValue(DEFINITION_TYPE, pin.definition_type)} v{pin.version}
                </li>
              ))}
            </ul>
          </Card>

          <Objectives
            experiment={experiment}
            evaluation={evaluation}
            judges={judges}
            judgeId={judgeId}
            scoring={scoring}
            onSelectJudge={setJudgeId}
            onScore={() => void runJudge()}
          />

          <StateChanges experiment={experiment} />

          <Card title="Comparison variables">
            {differences.length === 0 ? (
              <p className="text-[13px] text-admin-muted">
                These arms are identical along every recorded dimension.
              </p>
            ) : (
              <>
                <ul className="grid gap-1 text-[13px] text-admin-ink-soft">
                  {differences.map((variable) => (
                    <li key={variable.dimension}>
                      {labelOf(COMPARISON_DIMENSION, variable.dimension)}
                    </li>
                  ))}
                </ul>
                {differences.length > 1 ? (
                  <p className="text-xs text-admin-draft-ink">
                    {differences.length} differences — a change in behavior cannot be attributed to
                    any one of them.
                  </p>
                ) : null}
              </>
            )}
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
 * The compositions only one arm received.
 *
 * Divergence is a property of the delivery, not of the words: a composition held by fewer
 * arms than the experiment has is one the operator deliberately split.
 */
function divergentTurnIds(experiment: ExperimentResponse): Set<string> {
  const reach = new Map<string, number>();
  for (const turn of experiment.turns) {
    reach.set(turn.turn_id, (reach.get(turn.turn_id) ?? 0) + 1);
  }
  return new Set(
    [...reach.entries()]
      .filter(([, arms]) => arms < experiment.runs.length)
      .map(([turnId]) => turnId),
  );
}

/**
 * What this arm is waiting for, in the words the operator's next move is in.
 *
 * The first thing on the card because it is the first thing someone reopening a bench needs:
 * two arms progress independently, so "which of these is mine to move" is not answerable by
 * reading two transcripts. It is the server's reading rather than this page's — the same one
 * the runner acts on, so the button below can never offer a run the backend would decline.
 */
function Standing({ standing }: { standing: ArmStandingSchema }) {
  const waiting =
    standing.awaiting === "completed"
      ? "Completed — this arm has answered every turn the scenario allows"
      : standing.awaiting === "customer"
        ? "Waiting for the customer"
        : standing.attempts === 0
          ? "Waiting for the agent"
          : `Attempt ${standing.attempts} produced no reply — waiting for a retry`;
  return (
    <p className="text-xs font-semibold text-admin-ink-soft">
      {waiting} · turn {standing.ordinal}
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

/** One arm's thread: each customer turn followed by the attempts that answered it. */
function Thread({
  experiment,
  run,
  divergent,
}: {
  experiment: ExperimentResponse;
  run: ExperimentRunSchema;
  divergent: Set<string>;
}) {
  const turns = experiment.turns
    .filter((turn) => turn.run_id === run.run_id)
    .sort((left, right) => left.ordinal - right.ordinal);
  return (
    <ol className="grid gap-3">
      {turns.map((turn) => (
        <li key={`${turn.run_id}:${turn.ordinal}`} className="grid gap-3">
          <CustomerTurn turn={turn} divergent={divergent.has(turn.turn_id)} />
          {attemptsFor(experiment, run, turn.ordinal).map((attempt) => (
            <Attempt
              key={attempt.attempt}
              turn={attempt}
              events={eventsFor(experiment, run, attempt)}
              faults={faultsFor(experiment, run, attempt)}
            />
          ))}
          {passedOver(run, turn) ? (
            <p className="text-[11px] font-semibold uppercase tracking-wide text-admin-muted">
              No reply — the customer wrote again before this arm was run
            </p>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

function CustomerTurn({ turn, divergent }: { turn: ParticipantTurnSchema; divergent: boolean }) {
  return (
    <div className="grid gap-1">
      <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-admin-muted">
        {turn.source === "trigger" ? "Trigger" : "Customer"}
        {divergent ? (
          <span className={`${outlineButtonClasses} min-h-0 px-1.5 py-0.5 text-[10px]`}>
            this arm only
          </span>
        ) : null}
      </p>
      <p className="rounded-lg bg-admin-canvas px-3 py-2 text-[13px] leading-relaxed text-admin-ink">
        {turn.body}
      </p>
    </div>
  );
}

/**
 * One attempt: the calls it made, then what it answered — or why it did not.
 *
 * The tool strip comes first because that is the order it happened in, and because a failed
 * attempt's calls are the informative half of the failure.
 *
 * A scenario fault sits in that strip where it fired — after the call it followed — because
 * the agent did not ask for it and cannot see it, and a refusal further along the strip with
 * no visible cause is the one thing a fault must never look like.
 */
function Attempt({
  turn,
  events,
  faults,
}: {
  turn: AgentTurnSchema;
  events: ToolEventSchema[];
  faults: MutationEventSchema[];
}) {
  return (
    <div className="grid gap-1">
      <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-admin-muted">
        Agent
        {turn.attempt > 1 ? (
          <span className={`${outlineButtonClasses} min-h-0 px-1.5 py-0.5 text-[10px]`}>
            attempt {turn.attempt}
          </span>
        ) : null}
      </p>
      {events.length > 0 || faults.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {interleave(events, faults).map((entry) =>
            "tool" in entry ? (
              <li
                key={`call:${entry.ordinal}:${entry.attempt}:${entry.sequence}`}
                className={`${subtleButtonClasses} min-h-0 px-1.5 py-0.5 text-[10px]`}
                title={`${entry.tool} ${entry.version} → ${labelOf(TOOL_OUTCOME, entry.outcome)}`}
              >
                {entry.tool} → {labelOf(TOOL_OUTCOME, entry.outcome)}
                {entry.revision_after > entry.revision_before ? " · moved this arm" : ""}
              </li>
            ) : (
              <li
                key={`fault:${entry.mutation_id}`}
                className={`${outlineButtonClasses} min-h-0 px-1.5 py-0.5 text-[10px]`}
                title={`${entry.mutation_id} · ${entry.timing} · ${entry.target}`}
              >
                scenario fault · moved this arm
              </li>
            ),
          )}
        </ul>
      ) : null}
      {turn.outcome === "answered" ? (
        <p className="rounded-lg border border-admin-border px-3 py-2 text-[13px] leading-relaxed text-admin-ink">
          {turn.body}
        </p>
      ) : (
        <p className="rounded-lg border border-lab-error/40 px-3 py-2 text-[13px] text-lab-error">
          This attempt produced no reply: {describeFailure(turn.failure)}.
        </p>
      )}
    </div>
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
  working,
  onAdvance,
}: {
  run: ExperimentRunSchema;
  working: boolean;
  onAdvance: () => void;
}) {
  const { awaiting, attempts } = run.standing;
  if (awaiting !== "agent") {
    return null;
  }
  return (
    <button
      className={outlineButtonClasses}
      type="button"
      disabled={working}
      onClick={onAdvance}
      aria-label={attempts === 0 ? `Run ${run.label}'s agent` : `Try ${run.label}'s agent again`}
    >
      <ButtonIcon verb={attempts === 0 ? "start" : "rerun"} />
      {working ? "Running…" : attempts === 0 ? "Run the agent" : "Try again"}
    </button>
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
  onSelectJudge,
  onScore,
}: {
  experiment: ExperimentResponse;
  evaluation: ExperimentEvaluationResponse | null;
  judges: JudgeConfigurationSummarySchema[];
  judgeId: string;
  scoring: boolean;
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
        <ObjectiveMatrix runs={experiment.runs} arms={arms} rows={rows} compact />
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
                onSelectJudge={onSelectJudge}
                onScore={onScore}
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
          the world at the moment the recipe bound it to, and the agent is never told.
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

function attemptsFor(
  experiment: ExperimentResponse,
  run: ExperimentRunSchema,
  ordinal: number,
): AgentTurnSchema[] {
  return experiment.agent_turns
    .filter((turn) => turn.run_id === run.run_id && turn.ordinal === ordinal)
    .sort((left, right) => left.attempt - right.attempt);
}

function eventsFor(
  experiment: ExperimentResponse,
  run: ExperimentRunSchema,
  turn: AgentTurnSchema,
): ToolEventSchema[] {
  return experiment.tool_events
    .filter(
      (event) =>
        event.run_id === run.run_id &&
        event.ordinal === turn.ordinal &&
        event.attempt === turn.attempt,
    )
    .sort((left, right) => left.sequence - right.sequence);
}

function faultsFor(
  experiment: ExperimentResponse,
  run: ExperimentRunSchema,
  turn: AgentTurnSchema,
): MutationEventSchema[] {
  return experiment.mutation_events
    .filter(
      (event) =>
        event.run_id === run.run_id &&
        event.ordinal === turn.ordinal &&
        event.attempt === turn.attempt,
    )
    .sort((left, right) => left.after_calls - right.after_calls);
}

/**
 * The calls and the faults in the order the arm met them.
 *
 * A fault records how many calls had already been made when it fired, so it sits before the
 * call of that sequence: the world moved, and then the agent asked its next question against
 * what the fault left behind.
 */
function interleave(
  events: ToolEventSchema[],
  faults: MutationEventSchema[],
): (ToolEventSchema | MutationEventSchema)[] {
  const ordered: (ToolEventSchema | MutationEventSchema)[] = [];
  for (const event of events) {
    ordered.push(...faults.filter((fault) => fault.after_calls === event.sequence));
    ordered.push(event);
  }
  return [...ordered, ...faults.filter((fault) => fault.after_calls >= events.length)];
}

/**
 * Whether this arm moved past a customer turn without ever answering it.
 *
 * A membership test against the ordinals the standing names, not a rule this page keeps: an
 * operator may send a second message before running the agent on the first, and the arm then
 * answers the conversation as it stands rather than the question the customer moved on from
 * (ADR 0026). Which turns those were is the backend's reading — deriving it here again would
 * be the second reading the standing exists to remove, and would be free to disagree with the
 * sentence printed above the same thread.
 */
function passedOver(run: ExperimentRunSchema, turn: ParticipantTurnSchema): boolean {
  return run.standing.unanswered.includes(turn.ordinal);
}
