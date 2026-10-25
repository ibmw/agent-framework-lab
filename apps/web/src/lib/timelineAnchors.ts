import type { DecidingCallSchema, TimelineEntrySchema } from "@agent-lab/contracts";

/**
 * The fragment that names one timeline event, for a URL hash to land on.
 *
 * Built from the coordinates the record already keys each event by (ADR 0027), never from its
 * position on the page: a lens hides rows, and an anchor that counted rows would point at a
 * different event under every lens. A tool call is its arm, turn, attempt and the order the
 * agent asked in — exactly the coordinate an evaluation names as the call that decided a
 * verdict (`decided_by`, ADR 0030 amended 2026-10-25) — so the results matrices and this page
 * agree on one event without matching on anything else.
 */
export function timelineAnchor(entry: TimelineEntrySchema): string {
  if (entry.kind === "trigger" || entry.kind === "customer_turn") {
    // One composition, however many arms it reached: its step is the coordinate they share.
    return `event-turn-${entry.step}`;
  }
  const [runId] = entry.run_ids;
  const attempt = `${runId}-${entry.ordinal ?? "x"}-${entry.attempt ?? "x"}`;
  if (entry.kind === "tool_call") {
    return callAnchor(runId, {
      ordinal: entry.ordinal ?? -1,
      attempt: entry.attempt ?? -1,
      sequence: entry.sequence ?? -1,
    });
  }
  if (entry.kind === "mutation") {
    return `event-${attempt}-fault-${entry.sequence ?? "x"}-${entry.mutation ?? "x"}`;
  }
  return `event-${attempt}-reply`;
}

/** Where one event of one experiment's execution timeline is, as a link from anywhere. */
export function timelineEventPath(shopId: string, experimentId: string, anchor: string): string {
  return `/lab/bench/${shopId}/${experimentId}/results/timeline#${anchor}`;
}

/** The fragment of one arm's tool call, as an evaluation's `decided_by` names it. */
export function callAnchor(runId: string, call: DecidingCallSchema): string {
  return `event-${runId}-${call.ordinal}-${call.attempt}-call-${call.sequence}`;
}
