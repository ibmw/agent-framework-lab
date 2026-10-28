import type {
  ExperimentResponse,
  ExperimentRunSchema,
  ExperimentTimelineResponse,
  ParticipantTurnSchema,
} from "@agent-lab/contracts";
import { useEffect, useState } from "react";
import { describeApiError } from "../api/client";
import { getExperimentTimeline } from "../api/experiments";
import {
  ArmStrip,
  SheetBody,
  SheetRow,
  SheetSection,
  SheetSpanningRow,
  SheetTable,
} from "../components/ArmSheet";
import { ArmAttempts } from "../components/ConversationThread";
import { armsInOrder } from "../lib/comparison";
import { turnNumber } from "../lib/evidence";
import { sheetArmsOf } from "../lib/sheet";
import {
  chipClasses,
  sheetCellEmptyClasses,
  sheetCellHeadingClasses,
  sheetGroupEmptyClasses,
  sheetLabelLinesClasses,
  sheetMessageClasses,
  sheetReachLineClasses,
  sheetRowFromClasses,
} from "../lib/ui";
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
  const runs = armsInOrder(experiment);
  const arms = sheetArmsOf(runs);

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
    // The strip is the column's first child, so it holds over the arms' columns for as long as
    // the conversation is on screen (ADR 0080).
    <div className="grid min-w-0 gap-6">
      <ArmStrip label="Conversation" arms={arms} />
      <SheetSection
        id="conversation"
        title="Conversation"
        note="The thread as each arm recorded it, read-only: what the customer wrote, the calls each arm made, and what it answered. Each row is one message, however many arms it reached; each arm counts its own turns. A run still in progress is driven from the live bench."
        arms={arms}
        labelHeader="Message"
        grouped
      >
        {timeline === null ? (
          error ? (
            <p role="alert" className={`${sheetGroupEmptyClasses} text-lab-error`}>
              {error}
            </p>
          ) : (
            <p className={sheetGroupEmptyClasses}>Loading conversation…</p>
          )
        ) : (
          <Compositions experiment={experiment} runs={runs} timeline={timeline} />
        )}
      </SheetSection>
    </div>
  );
}

/**
 * The compositions on the sheet's columns (sheet mockup :246–264): each a group of two rows. The
 * first spans the arms and draws the message once, labelled *Trigger* or *Message N*, with which
 * arms it reached under it; the second, *What each arm did*, holds each arm's attempts in its
 * column, under that arm's own turn number — or says the arm never received the message.
 */
function Compositions({
  experiment,
  runs,
  timeline,
}: {
  experiment: ExperimentResponse;
  runs: ExperimentRunSchema[];
  timeline: ExperimentTimelineResponse;
}) {
  const rows = compositions(experiment, timeline);
  if (rows.length === 0) {
    return <p className={sheetGroupEmptyClasses}>No turn has been recorded yet.</p>;
  }
  return (
    <SheetTable label="Conversation">
      {rows.map((copies, index) => {
        const turnId = copies[0].turn_id;
        // The trigger is the ticket's own message rather than one the customer sent during the
        // run, so it is named as such, and the customer's messages are counted from one after it.
        const trigger = copies[0].source === "trigger";
        const sent = rows.slice(0, index + 1).filter((row) => row[0].source !== "trigger").length;
        const name = trigger ? "Trigger" : `Message ${sent}`;
        const reached = runs.filter((run) => copies.some((copy) => copy.run_id === run.run_id));
        return (
          <SheetBody key={turnId} label={name}>
            <SheetSpanningRow
              ground
              label={
                // The trigger's name already says where it came from; a message says the customer.
                trigger ? (
                  name
                ) : (
                  <span className={sheetLabelLinesClasses}>
                    <span>{name}</span>
                    <span className={sheetRowFromClasses}>Customer</span>
                  </span>
                )
              }
            >
              <p className={sheetMessageClasses}>{copies[0].body}</p>
              <Reach runs={runs} reached={reached} />
            </SheetSpanningRow>
            <SheetRow
              label={runs.length === 1 ? "What the arm did" : "What each arm did"}
              cells={runs.map((run) => {
                const turn = copies.find((copy) => copy.run_id === run.run_id);
                return turn === undefined ? (
                  <p key={run.run_id} className={sheetCellEmptyClasses}>
                    {run.label} did not receive this message.
                  </p>
                ) : (
                  <article
                    key={run.run_id}
                    aria-label={`${run.label} · turn ${turnNumber(turn.ordinal)}`}
                    className="grid min-w-0 content-start gap-3.5"
                  >
                    <h3 className={sheetCellHeadingClasses}>Turn {turnNumber(turn.ordinal)}</h3>
                    <ArmAttempts experiment={experiment} run={run} turn={turn} calls="lines" />
                  </article>
                );
              })}
            />
          </SheetBody>
        );
      })}
    </SheetTable>
  );
}

/**
 * Which arms a message reached, under it. A message every arm heard is one composition — the
 * mockup's sentence; one that reached only some is marked "this arm only", as the bench marks
 * it, and names the arms it reached, since the mark no longer sits in one arm's column. One arm
 * reaches nothing beside itself, so it says nothing.
 */
function Reach({ runs, reached }: { runs: ExperimentRunSchema[]; reached: ExperimentRunSchema[] }) {
  if (runs.length < 2) {
    return null;
  }
  if (reached.length === runs.length) {
    return (
      <p className={sheetReachLineClasses}>
        Reached {runs.length === 2 ? "both arms" : `all ${runs.length} arms`} as one composition.
      </p>
    );
  }
  return (
    <p className={sheetReachLineClasses}>
      <span className={chipClasses.mark}>this arm only</span>
      <span>Reached {reached.map((run) => run.label).join(" and ")} alone.</span>
    </p>
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
