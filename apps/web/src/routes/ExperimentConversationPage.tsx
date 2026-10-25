import type {
  ExperimentResponse,
  ExperimentTimelineResponse,
  ParticipantTurnSchema,
} from "@agent-lab/contracts";
import { useEffect, useState } from "react";
import { describeApiError } from "../api/client";
import { getExperimentTimeline } from "../api/experiments";
import { ArmTurn } from "../components/ConversationThread";
import { Card } from "../components/WorkspaceChrome";
import { divergentTurnIds, turnNumber } from "../lib/evidence";
import { useExperimentResults } from "./useExperimentResults";

const UNAVAILABLE = "This experiment's conversation is unavailable.";

/**
 * The conversation tab: what each arm was told and what it answered, message beside message.
 *
 * The results said whether an arm met what the scenario required; this is where a reader checks
 * the reply that verdict was about. The live bench draws the same thread arm by arm, in two
 * cards whose turns drift apart, so here each row is one **composition** — one thing the
 * customer said, however many arms it reached — with a column per arm, and a customer message
 * sits level with every answer to it.
 *
 * A row is a composition and never an ordinal, because an ordinal counts one arm's turns: after
 * a reply sent to one arm alone, the same later message is turn 3 in one arm and turn 2 in the
 * other (ADR 0027). So each cell names its own arm's turn number, the one that arm's card counts
 * in, and a composition an arm never received says so in that arm's cell.
 *
 * The rows are in the timeline's order, read from the timeline rather than re-derived: the
 * timeline numbers the compositions by merging each arm's own sequence (its `step`), and a
 * second numbering here would be free to disagree with the stream one tab over. The words come
 * from the experiment the results layout already holds — the timeline carries none.
 *
 * It is read-only: no composer, no Run, no scoring. A run that is still running is driven from
 * the live bench, which the header links back to.
 */
export function ExperimentConversationPage() {
  const { shopId, experimentId, experiment } = useExperimentResults();
  const [timeline, setTimeline] = useState<ExperimentTimelineResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    getExperimentTimeline(shopId, experimentId, controller.signal)
      .then(setTimeline)
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setError(describeApiError(cause, UNAVAILABLE));
        }
      });
    return () => controller.abort();
  }, [shopId, experimentId]);

  return (
    <Card
      title="Conversation"
      footer={
        <p className="text-xs text-admin-muted">
          The thread as each arm recorded it, read-only: what the customer wrote, the calls each arm
          made, and what it answered. Each row is one message, however many arms it reached; each
          arm counts its own turns. A run still in progress is driven from the live bench.
        </p>
      }
    >
      {timeline === null ? (
        error ? (
          <p role="alert" className="text-[13px] text-lab-error">
            {error}
          </p>
        ) : (
          <p className="text-sm text-admin-muted">Loading conversation…</p>
        )
      ) : (
        <Compositions experiment={experiment} timeline={timeline} />
      )}
    </Card>
  );
}

function Compositions({
  experiment,
  timeline,
}: {
  experiment: ExperimentResponse;
  timeline: ExperimentTimelineResponse;
}) {
  const rows = compositions(experiment, timeline);
  if (rows.length === 0) {
    return <p className="text-[13px] text-admin-muted">No turn has been recorded yet.</p>;
  }
  const divergent = divergentTurnIds(experiment);
  const columns = experiment.runs.length > 1 ? "lg:grid-cols-2" : "";
  return (
    <ol className="grid gap-4">
      {rows.map((copies, index) => {
        const turnId = copies[0].turn_id;
        // The trigger is the ticket's own message rather than one the customer sent during the
        // run, so it is named as every cell beneath it names it, and the customer's messages
        // are counted from one after it.
        const trigger = copies[0].source === "trigger";
        const sent = rows.slice(0, index + 1).filter((row) => row[0].source !== "trigger").length;
        return (
          <li
            key={turnId}
            className="grid gap-2 border-b border-admin-border/60 pb-4 last:border-b-0 last:pb-0"
          >
            <h3 className="text-xs font-semibold text-lab-ink">
              {trigger ? "Trigger" : `Message ${sent}`}
            </h3>
            <div className={`grid gap-4 ${columns}`}>
              {experiment.runs.map((run) => {
                const turn = copies.find((copy) => copy.run_id === run.run_id);
                const headingId = `conversation-${turnId}-${run.run_id}`;
                return (
                  <article
                    key={run.run_id}
                    aria-labelledby={headingId}
                    className="grid min-w-0 content-start gap-3"
                  >
                    <h4 id={headingId} className="text-xs font-semibold text-admin-ink-soft">
                      {turn === undefined
                        ? run.label
                        : `${run.label} · turn ${turnNumber(turn.ordinal)}`}
                    </h4>
                    {turn === undefined ? (
                      <p className="text-[13px] text-admin-muted">
                        {run.label} did not receive this message.
                      </p>
                    ) : (
                      <ArmTurn
                        experiment={experiment}
                        run={run}
                        turn={turn}
                        divergent={divergent}
                      />
                    )}
                  </article>
                );
              })}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Each composition's copies, one per arm it reached, in the order the timeline numbers them.
 *
 * A composition the timeline does not name — it is a projection of the same record, so none
 * should be missing — keeps its place after the named ones rather than disappearing.
 */
function compositions(
  experiment: ExperimentResponse,
  timeline: ExperimentTimelineResponse,
): ParticipantTurnSchema[][] {
  const steps = new Map<string, number>();
  for (const entry of timeline.entries) {
    if (entry.composition_id !== null && !steps.has(entry.composition_id)) {
      steps.set(entry.composition_id, entry.step);
    }
  }
  const grouped = new Map<string, ParticipantTurnSchema[]>();
  for (const turn of experiment.turns) {
    grouped.set(turn.turn_id, [...(grouped.get(turn.turn_id) ?? []), turn]);
  }
  return [...grouped.values()]
    .map((copies, position) => ({ copies, position }))
    .sort(
      (left, right) =>
        (steps.get(left.copies[0].turn_id) ?? Number.POSITIVE_INFINITY) -
          (steps.get(right.copies[0].turn_id) ?? Number.POSITIVE_INFINITY) ||
        left.position - right.position,
    )
    .map(({ copies }) => copies);
}
