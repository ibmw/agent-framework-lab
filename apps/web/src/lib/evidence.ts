import type {
  AgentTurnSchema,
  ArmMetricsSchema,
  ArmStandingSchema,
  EstimatedCostSchema,
  ExperimentResponse,
  ExperimentRunSchema,
  JudgeFailure,
  MutationEventSchema,
  ObjectiveResultSchema,
  ToolEventSchema,
  ToolOutcome,
} from "@agent-lab/contracts";
import { CONTROL_JUDGE_PROVIDER } from "./agents";

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

/**
 * Each tool outcome's glyph, beside its word, so a refusal is never the chip's text alone: the
 * thread's call chips and the trace waterfall's tool rows draw the same three.
 */
export const TOOL_MARK: Readonly<Record<ToolOutcome, string>> = {
  success: "✓",
  refused: "✗",
  failed: "!",
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

/**
 * The provenance a judged cell discloses on the results screen, the judge named as published.
 *
 * The judge is named by the name it was published under rather than by its model: two judges
 * on one model are two rubrics, and the model is what read the rubric, not who wrote it. The
 * model, the version and the attempt stay, because they are what makes a verdict traceable
 * (ADR 0031); the control has no model, so it is called what it is. The name is the one the
 * judges listing gives today, not one frozen with the version; while that listing has not
 * answered — or could not — the judge is named by the start of its identifier, which is true
 * either way.
 *
 * An execution that produced no verdict is said to be an attempt, never a judgement: the
 * outage is the lab's, and the arm was not judged (ADR 0031).
 */
export function judgementProvenance(
  judgement: NonNullable<ObjectiveResultSchema["judgement"]>,
  judgeName: string | undefined,
): string {
  const judge = judgeName ?? `judge ${judgement.judge_id.slice(0, 8)}`;
  const model =
    judgement.provider === CONTROL_JUDGE_PROVIDER
      ? "the deterministic control"
      : judgement.model_id;
  const by = `${judge}, version ${judgement.judge_version}, on ${model} — attempt ${judgement.attempt}`;
  if (judgement.outcome === null || judgement.failure !== null) {
    const why = judgement.failure === null ? "" : `: ${describeJudgeFailure(judgement.failure)}`;
    return `Attempted by ${by}; no verdict${why}.`;
  }
  return `Judged by ${by}.`;
}

/**
 * The first sentence of a judge's rationale: what a judged cell shows before it is opened.
 *
 * A sentence ends at the first full stop, question or exclamation mark followed by a space or
 * the end of the text — so "v1.2" does not cut it short, but a reference that ends a clause
 * with a full stop ("…order NS-10482. Then…") does, as a sentence would. A rationale with no
 * such ending is one sentence, and is returned whole.
 */
export function firstSentence(text: string): string {
  const match = /^.*?[.!?](?=\s|$)/s.exec(text);
  return match ? match[0] : text;
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

/** One figure on an arm's results card: its words, and whether it is the one the frame reds. */
export interface ArmFigure {
  key: "turns" | "tokens" | "tools" | "time" | "retries" | "cost";
  text: string;
  warn?: boolean;
}

/**
 * The frame's figures for one arm, read off the metrics the Quantitative table reads.
 *
 * Four are always there to be drawn — turns, tokens, tool calls and time — and two only when
 * they say something: the retries an arm needed, and its cost where the lab could price it.
 * A figure the lab did not measure is left off rather than written as zero, because a null
 * here means nobody took the measurement (*Lists and counts*: a figure the payload lacks is
 * not faked); the table below the tabs still says "not reported" in its row. A total over
 * fewer attempts than the arm made is a floor, and says so with "≥", as the table does.
 */
export function armFigures(metrics: ArmMetricsSchema): ArmFigure[] {
  const floor = metrics.metered_attempts < metrics.attempts ? "≥" : "";
  const figures: ArmFigure[] = [
    { key: "turns", text: `${metrics.turns} ${metrics.turns === 1 ? "turn" : "turns"}` },
  ];
  if (metrics.usage !== null) {
    const tokens = metrics.usage.input_tokens + metrics.usage.output_tokens;
    figures.push({ key: "tokens", text: `${floor}${formatTokens(tokens)} tokens` });
  }
  figures.push({
    key: "tools",
    text: `${metrics.tool_calls} ${metrics.tool_calls === 1 ? "tool call" : "tool calls"}`,
  });
  if (metrics.duration_ms !== null) {
    const partial = metrics.measured_attempts < metrics.attempts ? "≥" : "";
    figures.push({ key: "time", text: `${partial}${formatDuration(metrics.duration_ms)}` });
  }
  if (metrics.retries > 0) {
    figures.push({
      key: "retries",
      text: `${metrics.retries} ${metrics.retries === 1 ? "retry" : "retries"}`,
      warn: true,
    });
  }
  if (metrics.estimated_cost !== null) {
    figures.push({ key: "cost", text: `${floor}${formatCost(metrics.estimated_cost)}` });
  }
  return figures;
}

/**
 * A customer turn as an operator counts it: from one, the trigger first.
 *
 * The record counts from zero — the trigger is turn zero (ADR 0028) — and every surface that
 * names a turn names it through here, so no two of them can number one thread differently.
 */
export function turnNumber(ordinal: number): number {
  return ordinal + 1;
}

/**
 * Where one arm stands, in the words an operator counts turns in.
 *
 * One sentence for the bench's arm and the results' arm card, so the two surfaces cannot
 * count the same thread differently. `standing.ordinal` is the customer turn the arm is on,
 * counted from zero; it is named through `turnNumber`, from one.
 *
 * A finished arm says how many of the turns it received it answered, out of the metrics the
 * card already reads: completion means it answered the last turn its scenario's cap allows,
 * so what it received is the whole of the run. A running arm is not given an "of N" for the
 * run — the cap is the scenario's and no response these pages hold carries it — so it says
 * what it has answered *so far*, or which turn it owes.
 */
export function describeArmStanding(
  standing: ArmStandingSchema,
  metrics: ArmMetricsSchema,
): string {
  const turn = turnNumber(standing.ordinal);
  const answered = `answered ${metrics.answered_turns} of ${metrics.turns} ${
    metrics.turns === 1 ? "turn" : "turns"
  }`;
  if (standing.awaiting === "completed") {
    return `Completed — ${answered}`;
  }
  if (standing.awaiting === "customer") {
    return `Waiting for the customer — ${answered} so far`;
  }
  return standing.attempts === 0
    ? `Waiting for the agent at turn ${turn}`
    : `Attempt ${standing.attempts} produced no reply — waiting for a retry at turn ${turn}`;
}

/**
 * What an arm that missed a required objective says beside its count, wherever it is drawn:
 * the words History's row reads it in, and the matrices' missed mark beside them, so the
 * reason is never the error colour alone.
 */
export const MISSED_REQUIREMENT = { mark: OUTCOMES.missed.mark, label: "missed a requirement" };

/**
 * The configuration an arm ran, as its chip names it: the configuration and its version.
 *
 * An arm is often labelled after the configuration it runs — the seeded arms are — and a
 * chip that repeated the arm's name beside the arm's name says nothing; it is then the
 * configuration's version, said as one.
 */
export function configurationChip(armLabel: string, name: string, version: number): string {
  return name === armLabel ? `configuration v${version}` : `${name} v${version}`;
}

/**
 * The compositions only one arm received.
 *
 * Divergence is a property of the delivery, not of the words: a composition held by fewer
 * arms than the experiment has is one the operator deliberately split.
 */
export function divergentTurnIds(experiment: ExperimentResponse): Set<string> {
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
