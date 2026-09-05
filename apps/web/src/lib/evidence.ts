import type {
  AgentTurnSchema,
  EstimatedCostSchema,
  ExperimentResponse,
  ExperimentRunSchema,
  JudgeFailure,
  MutationEventSchema,
  ObjectiveResultSchema,
  ToolEventSchema,
} from "@agent-lab/contracts";

/**
 * The words the lab reads its own evidence in.
 *
 * One module rather than a copy per surface: the bench, the results page, and the timeline
 * all render the same closed vocabularies the backend publishes, and three copies of a
 * failure table are three chances for one screen to call an outage what another calls a
 * refusal. Nothing here decides anything — every value is a label for a value the record
 * already carries.
 */

/** What each objective outcome looks like, and what its symbol means (frames 8 and 9). */
export const OUTCOMES: Record<ObjectiveResultSchema["outcome"], { mark: string; label: string }> = {
  met: { mark: "✓", label: "met" },
  missed: { mark: "✗", label: "missed" },
  pending: { mark: "·", label: "pending" },
  deferred: { mark: "judge", label: "a judge scores this after the run" },
  undecidable: { mark: "—", label: "no evidence this lab reads decides this" },
};

/** Why an attempt ended without a reply, in words an operator can act on. */
export const FAILURES: Record<NonNullable<AgentTurnSchema["failure"]>, string> = {
  model_provider: "the model provider rejected the request",
  model_transient: "the model provider was briefly unavailable",
  invalid_response: "the model answered in a shape the lab cannot record",
  framework: "the framework could not execute this turn",
  tool_round_limit: "the agent used every tool call this configuration allows",
};

/**
 * Why one judge execution produced no verdict.
 *
 * Kept apart from `FAILURES` the way the backend keeps the two enums apart: these are
 * failures of the *evaluator*, and a surface that described them in the agent's words would
 * put the lab's own outage in the arm's column.
 */
export const JUDGE_FAILURES: Record<JudgeFailure, string> = {
  provider: "the provider rejected the request",
  transient: "the provider was briefly unavailable",
  invalid_response: "the judge answered outside the verdict vocabulary",
};

/**
 * One failure code in words, falling back rather than rendering a bare code at an operator.
 *
 * The two fallbacks are different on purpose. A code this table does not know is rendered as
 * itself: the vocabulary is the backend's and may gain a member before this table does, and
 * inventing a reason for it would be worse than showing the one the record carries. No code
 * at all can only be a row written outside the closed set, and the framework sentence is the
 * one that still reads as a sentence where it is used.
 */
export function describeFailure(failure: string | null): string {
  if (failure === null) {
    return FAILURES.framework;
  }
  return FAILURES[failure as NonNullable<AgentTurnSchema["failure"]>] ?? failure;
}

/** Why one judge execution produced no verdict, in words, with the same fallback rule. */
export function describeJudgeFailure(failure: JudgeFailure): string {
  return JUDGE_FAILURES[failure] ?? failure;
}

/**
 * The provenance a screen reader hears after a scored cell's evidence sentence.
 *
 * On every surface that renders a judged cell, because it is what separates a verdict from a
 * number: the version of the rubric, the model that read it, and the attempt it came from
 * (ADR 0031).
 */
export function describeJudgement(result: ObjectiveResultSchema | undefined): string {
  const judgement = result?.judgement;
  if (!judgement) {
    return "";
  }
  return ` — judged by ${judgement.model_id} under judge version ${judgement.judge_version}, attempt ${judgement.attempt}`;
}

/** A magnitude rather than an audited figure: `3.4k`, then `1.2M` once a thread is long. */
export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(1)}M`;
  }
  return tokens < 1000 ? `${tokens}` : `${(tokens / 1000).toFixed(1)}k`;
}

/**
 * Seconds to one decimal under a minute, then whole minutes and seconds.
 *
 * Rounded once, before the branch is chosen. Rounding inside each branch renders 59,950 ms as
 * "60.0s" and 119,600 ms as "1m 60s" — two readings of a clock nobody owns.
 */
export function formatDuration(milliseconds: number): string {
  const whole = Math.round(milliseconds / 1000);
  if (whole < 60) {
    return `${(milliseconds / 1000).toFixed(1)}s`;
  }
  return `${Math.floor(whole / 60)}m ${whole % 60}s`;
}

/**
 * The estimate exactly as the lab computed it, never re-derived.
 *
 * The amount arrives as a decimal string precisely because a binary float cannot hold it, so
 * it is trimmed rather than parsed: `Number("0.015000").toFixed(2)` is "0.01", which is a
 * different number from the one the lab priced. Trailing zeros go, two digits stay, and the
 * value shown is always the value sent.
 */
export function formatCost(cost: Pick<EstimatedCostSchema, "amount" | "currency">): string {
  const [whole, fraction = ""] = cost.amount.split(".");
  const trimmed = fraction.replace(/0+$/, "");
  return `${whole}.${trimmed.padEnd(2, "0")} ${cost.currency}`;
}

/**
 * Every recorded write into one arm, in the order the arm's revisions moved.
 *
 * Both writers appear: the agent's tools, and the scenario's own faults. An operator reading
 * two revisions apart has to be able to see which of the two moved them, and a surface that
 * listed only the tools would report a fault as an unexplained gap in the numbering.
 */
export function writesOf(
  experiment: ExperimentResponse,
  run: ExperimentRunSchema,
): (ToolEventSchema | MutationEventSchema)[] {
  const wrote = [
    ...experiment.tool_events.filter((event) => event.run_id === run.run_id),
    ...experiment.mutation_events.filter((event) => event.run_id === run.run_id),
  ].filter((event) => event.revision_after > event.revision_before);
  return wrote.sort((left, right) => left.revision_before - right.revision_before);
}

export function writeKey(event: ToolEventSchema | MutationEventSchema): string {
  return "tool" in event
    ? `call:${event.ordinal}:${event.attempt}:${event.sequence}`
    : `fault:${event.mutation_id}`;
}

/** What moved an arm, named as the thing that asked for it rather than as an event kind. */
export function writeLabel(event: ToolEventSchema | MutationEventSchema): string {
  return "tool" in event ? event.tool : `${event.mutation_id} · scenario fault`;
}

/**
 * One side of a field change, as an operator reads it.
 *
 * `null` means the field was not there rather than empty, and saying so is the point: an
 * order that had no shipping address and now has one is a different fact from one whose city
 * was blanked, and a blank cell would read as the same thing for both.
 */
export function changeValue(value: string | null): string {
  return value ?? "not set";
}
