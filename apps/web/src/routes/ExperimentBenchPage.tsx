import type { ExperimentResponse, ParticipantTurnSchema } from "@agent-lab/contracts";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { describeApiError } from "../api/client";
import { deliverParticipantTurn, getExperiment } from "../api/experiments";
import { Card, Fingerprint, PageHeader } from "../components/WorkspaceChrome";
import {
  accentButtonClasses,
  fieldLabelClasses,
  formatTimestamp,
  outlineButtonClasses,
  textAreaClasses,
} from "../lib/ui";
import { useShopWorkspace } from "../shell/ShopWorkspace";

const UNAVAILABLE = "This experiment is unavailable.";

/**
 * The live bench, participant half (frame 8).
 *
 * Two threads side by side, each opening with the ticket's triggering message and continuing
 * with what the operator sends. The composer names the arms one message reaches: sending to
 * both is a linked turn, sending to one is a reply that arm alone received — and the
 * distinction is kept by the record rather than inferred from the words, so two identical
 * sentences sent by two separate decisions still read as divergence.
 *
 * The agent's side of each thread arrives with the runner that produces it; what is here is
 * the customer's, which is what a participant driver is for.
 */
export function ExperimentBenchPage() {
  const { shopId } = useShopWorkspace();
  const { experimentId = "" } = useParams();
  const [experiment, setExperiment] = useState<ExperimentResponse | null>(null);
  const [message, setMessage] = useState("");
  const [targets, setTargets] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

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
    setWorking(true);
    setError(null);
    try {
      await deliverParticipantTurn(shopId, experimentId, {
        run_ids: targets,
        message: message.trim(),
      });
      setMessage("");
      await load();
    } catch (cause: unknown) {
      setError(describeApiError(cause, "This message could not be delivered."));
    } finally {
      setWorking(false);
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
                  Configuration v{run.agent_configuration_version} · r{run.revision} ·{" "}
                  <Fingerprint value={run.state_fingerprint} />
                </p>
                <Thread
                  turns={experiment.turns.filter((turn) => turn.run_id === run.run_id)}
                  divergent={divergentTurnIds(experiment)}
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
              <button className={accentButtonClasses} type="submit" disabled={working}>
                {working ? "Sending…" : "Send as the customer"}
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

function Thread({ turns, divergent }: { turns: ParticipantTurnSchema[]; divergent: Set<string> }) {
  return (
    <ol className="grid gap-3">
      {[...turns]
        .sort((left, right) => left.ordinal - right.ordinal)
        .map((turn) => (
          <li key={`${turn.run_id}:${turn.ordinal}`} className="grid gap-1">
            <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-admin-muted">
              {turn.source === "trigger" ? "Trigger" : "Customer"}
              {divergent.has(turn.turn_id) ? (
                <span className={`${outlineButtonClasses} min-h-0 px-1.5 py-0.5 text-[10px]`}>
                  this arm only
                </span>
              ) : null}
            </p>
            <p className="rounded-lg bg-admin-canvas px-3 py-2 text-[13px] leading-relaxed text-admin-ink">
              {turn.body}
            </p>
          </li>
        ))}
    </ol>
  );
}
