import type {
  ExperimentSummarySchema,
  ScenarioSummarySchema,
  TicketSummarySchema,
} from "@agent-lab/contracts";

/** One thing that happened in this shop, as the overview's activity card reads it. */
export interface ActivityEntry {
  key: string;
  /** The kind of thing, leading the line the way the prototype writes it. */
  kind: "Experiment" | "Scenario" | "Ticket";
  /** What it is called, and the link that opens it. */
  name: string;
  to: string;
  /** What happened to it, in the past tense the listing's own timestamp supports. */
  said: string;
  /** The instant the sentence is about, ISO-8601. */
  at: string;
}

/**
 * How many rows the card draws. The prototype draws three, one of each kind; three is what
 * this keeps, but ordered rather than allotted — three tickets authored this afternoon are
 * what recently happened in that shop, and a card that held one of each would be reporting a
 * shape instead of an order.
 */
export const RECENT_ACTIVITY_LIMIT = 3;

/**
 * The three most recent things to have happened in one shop, from three listings.
 *
 * **Every sentence is the timestamp's own.** An experiment carries `created_at`, which is when
 * it was started, so it reads "started"; a scenario and a ticket carry `updated_at`, which is
 * when they were last written, so both read "updated". The prototype writes "Scenario … v1
 * published" and "Ticket T-204 opened by Maya Laurent", and neither payload carries the
 * instant that would make those true — a scenario's listing row has no published-at, and a
 * ticket's `opened_at` is a fact about the fiction rather than about this workspace. A
 * sentence is not put on a clock that does not mean it (`docs/design-direction.md`, *Lists and
 * counts*).
 *
 * Nothing is stored: this is a projection over listings that are read anyway, in the shape
 * ADR 0044 established for the reading it kept — "a step is complete when the thing it asks
 * for exists, read through the listings the product already serves".
 */
export function recentActivity({
  shopId,
  experiments,
  scenarios,
  tickets,
  limit = RECENT_ACTIVITY_LIMIT,
}: {
  shopId: string;
  experiments: readonly ExperimentSummarySchema[];
  scenarios: readonly ScenarioSummarySchema[];
  tickets: readonly TicketSummarySchema[];
  limit?: number;
}): ActivityEntry[] {
  const entries: ActivityEntry[] = [
    ...experiments.map((experiment) => ({
      key: `experiment:${experiment.experiment_id}`,
      kind: "Experiment" as const,
      name: experiment.label,
      to: `/lab/bench/${shopId}/${experiment.experiment_id}`,
      said: "started",
      at: experiment.created_at,
    })),
    ...scenarios.map((scenario) => ({
      key: `scenario:${scenario.scenario_id}`,
      kind: "Scenario" as const,
      name: scenario.name,
      to: `/shops/${shopId}/scenarios/${scenario.scenario_id}`,
      said: "updated",
      at: scenario.updated_at,
    })),
    ...tickets.map((ticket) => ({
      key: `ticket:${ticket.ticket_id}`,
      kind: "Ticket" as const,
      name: ticket.reference,
      to: `/shops/${shopId}/tickets/${ticket.ticket_id}`,
      said: `from ${ticket.customer_display_name}, updated`,
      at: ticket.updated_at,
    })),
  ];
  // Newest first, and ties broken by the key so two rows written in the same second keep one
  // order across renders rather than swapping places under the reader.
  entries.sort(
    (left, right) => right.at.localeCompare(left.at) || left.key.localeCompare(right.key),
  );
  return entries.slice(0, limit);
}
