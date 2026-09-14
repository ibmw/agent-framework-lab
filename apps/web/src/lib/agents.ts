import type { AgentArchitecture } from "@agent-lab/contracts";

/**
 * How the lab's agent vocabulary is spelled for a reader.
 *
 * One table rather than one per surface: the architecture picker and the settings page's
 * read-out name the same closed set, and two hand-written spellings of it would drift the
 * first time a second architecture is implemented.
 */
export const ARCHITECTURE_LABELS: Record<AgentArchitecture, string> = {
  single_agent: "Single agent",
};

export const ARCHITECTURES = Object.keys(ARCHITECTURE_LABELS) as AgentArchitecture[];

export function describeArchitecture(value: string): string {
  return ARCHITECTURE_LABELS[value as AgentArchitecture] ?? readableTerm(value);
}

/**
 * How a model provider is spelled, once for the whole workspace.
 *
 * Frame 5 draws the provider as a named control — "Anthropic ▾" beside "claude-sonnet-5 ▾" —
 * so the agent editor cannot render `openai`. Before this table the workspace held two
 * spellings of one string: the judge catalog serves `ProvenJudge.label` ("OpenAI",
 * "Deterministic control") while the framework catalog serves no provider label at all, so
 * the agent editor and the settings page had nothing to read and printed the wire's word.
 *
 * **Not `lib/enumLabels.ts`**, and the reason is that module's own rule: one table per closed
 * set *the contract publishes*, keyed `Record<Union, EnumLabel>` and swept against the
 * generated union. A provider is `Slug` — a free string in `ModelSettingsSchema` and a
 * `frozenset[str]` in `ProvenFramework` — so there is no union to key it to and
 * `enumLabels.test.ts` would refuse it: a `LabelMap`-shaped export it cannot register is a
 * named failure there. `lib/countries.ts` sits outside the registry for the same reason and
 * says so. This is the `ARCHITECTURE_LABELS` shape instead, in the module that already holds
 * the lab's model vocabulary.
 *
 * The entries must agree with `PROVEN_JUDGES` in `application/judge_capabilities.py`, which is
 * where the lab writes these words itself; every surface that shows a provider now reads this
 * table, so the workspace cannot disagree with itself about one value. A provider the table
 * does not know is returned exactly as the record carries it — `describeValue`'s rule, for
 * `describeValue`'s reason: the vocabulary is the backend's, and this application's guess does
 * not belong where the lab's own word would go.
 */
export const MODEL_PROVIDER_LABELS: Record<string, string> = {
  openai: "OpenAI",
  fake: "Deterministic control",
};

export function describeProvider(value: string): string {
  return MODEL_PROVIDER_LABELS[value] ?? value;
}

/** A payload's own term, spelled for a reader rather than for the wire. */
export function readableTerm(value: string): string {
  return value.replaceAll("_", " ");
}
