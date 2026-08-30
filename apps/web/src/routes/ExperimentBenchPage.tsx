import type {
  AgentTurnSchema,
  ExperimentResponse,
  ExperimentRunSchema,
  ParticipantTurnSchema,
  ToolEventSchema,
} from "@agent-lab/contracts";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { describeApiError } from "../api/client";
import { advanceExperimentRun, deliverParticipantTurn, getExperiment } from "../api/experiments";
import { Card, Fingerprint, PageHeader } from "../components/WorkspaceChrome";
import {
  accentButtonClasses,
  fieldLabelClasses,
  formatTimestamp,
  outlineButtonClasses,
  subtleButtonClasses,
  textAreaClasses,
} from "../lib/ui";
import { useShopWorkspace } from "../shell/ShopWorkspace";

const UNAVAILABLE = "This experiment is unavailable.";

/** Why an attempt ended without a reply, in words an operator can act on. */
const FAILURES: Record<AgentTurnSchema["failure"] & string, string> = {
  model_provider: "the model provider rejected the request",
  model_transient: "the model provider was briefly unavailable",
  invalid_response: "the model answered in a shape the lab cannot record",
  framework: "the framework could not execute this turn",
  tool_round_limit: "the agent used every tool call this configuration allows",
};

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
 */
export function ExperimentBenchPage() {
  const { shopId } = useShopWorkspace();
  const { experimentId = "" } = useParams();
  const [experiment, setExperiment] = useState<ExperimentResponse | null>(null);
  const [message, setMessage] = useState("");
  const [targets, setTargets] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState<string | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      const record = await getExperiment(shopId, experimentId, signal);
      setExperiment(record);
      // Default to a linked turn: the arms are meant to hear the same customer until the
      // operator deliberately splits them.
      setTargets((current) => current ?? record.runs.map((run) => run.run_id));
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
            <Link className="font-semibold text-lab-ink" to={`/shops/${shopId}/bench`}>
              Back to the bench
            </Link>{" "}
            · scenario v{experiment.scenario_version} · seed {experiment.seed} · started{" "}
            {formatTimestamp(experiment.created_at)}
          </>
        }
        actions={
          <Link
            className={outlineButtonClasses}
            to={`/shops/${shopId}/bench/${experimentId}/timeline`}
          >
            Execution timeline
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
          <div className="grid gap-4 lg:grid-cols-2">
            {experiment.runs.map((run) => (
              <Card key={run.run_id} title={run.label}>
                <p className="text-xs text-admin-muted">
                  {run.framework_id} · {run.model_id}
                </p>
                <p className="text-xs text-admin-muted">
                  Configuration v{run.agent_configuration_version} · r{run.revision} ·{" "}
                  <Fingerprint value={run.state_fingerprint} />
                </p>
                <Thread experiment={experiment} run={run} divergent={divergent} />
                <AdvanceControl
                  experiment={experiment}
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
            <form className="grid gap-3" onSubmit={send}>
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
                  </label>
                ))}
              </fieldset>
              <button className={accentButtonClasses} type="submit" disabled={working !== null}>
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
                  {pin.definition_type.replace(/_/g, " ")} v{pin.version}
                </li>
              ))}
            </ul>
          </Card>

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
                    <li key={variable.dimension}>{variable.dimension.replace(/_/g, " ")}</li>
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
            />
          ))}
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
 */
function Attempt({ turn, events }: { turn: AgentTurnSchema; events: ToolEventSchema[] }) {
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
      {events.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {events.map((event) => (
            <li
              key={`${event.ordinal}:${event.attempt}:${event.sequence}`}
              className={`${subtleButtonClasses} min-h-0 px-1.5 py-0.5 text-[10px]`}
              title={`${event.tool} ${event.version} → ${event.outcome}`}
            >
              {event.tool} → {event.outcome}
              {event.revision_after > event.revision_before ? " · moved this arm" : ""}
            </li>
          ))}
        </ul>
      ) : null}
      {turn.outcome === "answered" ? (
        <p className="rounded-lg border border-admin-border px-3 py-2 text-[13px] leading-relaxed text-admin-ink">
          {turn.body}
        </p>
      ) : (
        <p className="rounded-lg border border-lab-error/40 px-3 py-2 text-[13px] text-lab-error">
          This attempt produced no reply: {FAILURES[turn.failure ?? "framework"]}.
        </p>
      )}
    </div>
  );
}

/** Run the agent, or run it again — offered only when there is a turn to answer. */
function AdvanceControl({
  experiment,
  run,
  working,
  onAdvance,
}: {
  experiment: ExperimentResponse;
  run: ExperimentRunSchema;
  working: boolean;
  onAdvance: () => void;
}) {
  const latest = latestOrdinal(experiment, run);
  if (latest === null) {
    return null;
  }
  const attempts = attemptsFor(experiment, run, latest);
  if (attempts.some((attempt) => attempt.outcome === "answered")) {
    return null;
  }
  return (
    <button
      className={outlineButtonClasses}
      type="button"
      disabled={working}
      onClick={onAdvance}
      aria-label={
        attempts.length === 0 ? `Run ${run.label}'s agent` : `Try ${run.label}'s agent again`
      }
    >
      {working ? "Running…" : attempts.length === 0 ? "Run the agent" : "Try again"}
    </button>
  );
}

/** What each arm's tools actually moved, which is where the two worlds came apart. */
function StateChanges({ experiment }: { experiment: ExperimentResponse }) {
  return (
    <Card title="State changes">
      <ul className="grid gap-2 text-[13px]">
        {experiment.runs.map((run) => {
          const moved = experiment.tool_events.filter(
            (event) => event.run_id === run.run_id && event.revision_after > event.revision_before,
          );
          return (
            <li key={run.run_id} className="grid gap-0.5">
              <span className="font-semibold text-lab-ink">{run.label}</span>
              {moved.length === 0 ? (
                <span className="text-xs text-admin-muted">nothing yet</span>
              ) : (
                moved.map((event) => (
                  <span
                    key={`${event.ordinal}:${event.attempt}:${event.sequence}`}
                    className="text-xs text-admin-muted"
                  >
                    {event.tool} · r{event.revision_before} → r{event.revision_after}
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

function latestOrdinal(experiment: ExperimentResponse, run: ExperimentRunSchema): number | null {
  const ordinals = experiment.turns
    .filter((turn) => turn.run_id === run.run_id)
    .map((turn) => turn.ordinal);
  return ordinals.length === 0 ? null : Math.max(...ordinals);
}
