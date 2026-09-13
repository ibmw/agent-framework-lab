/**
 * The words this application uses on screen, defined once.
 *
 * `docs/PLAN.md` carries the lab's stable target vocabulary — objective block, mutation block,
 * canonical snapshot, arm, participant driver — and nothing a reader of the application could
 * reach defined any of them. This module is that vocabulary, in one place, so a term has one
 * definition: the glossary page renders it, the chain table's steps reference it, and a tour
 * popover hovers it. A second copy of any of these sentences would be a second thing to keep
 * in agreement with `docs/PLAN.md` (ADR 0044).
 */

export interface GlossaryTerm {
  /** Stable identifier a guide step or a tour step references. */
  readonly id: string;
  readonly term: string;
  readonly definition: string;
}

export const GLOSSARY_TERMS = [
  {
    id: "definition",
    term: "Definition",
    definition:
      "An authorable resource with a mutable draft and immutable published versions. Publishing freezes the draft exactly as it stands; later edits to the draft never change a version something already pinned.",
  },
  {
    id: "shop",
    term: "Shop",
    definition:
      "Versioned synthetic commerce configuration and support knowledge — catalog, policies, FAQ, payment and fulfilment methods, and named tone-of-voice guidelines with one shop default.",
  },
  {
    id: "customer-profile",
    term: "Customer profile",
    definition:
      "A versioned fictional identity and behavior used to create sandbox customer state, including a named address book with one default. An order selects an address and stores a frozen, source-labeled copy, so editing the address book never rewrites an order.",
  },
  {
    id: "order",
    term: "Order fixture",
    definition:
      "Shop-scoped authored commerce state with no version of its own: line items, payment and fulfilment status, authored events, and a shipping address chosen from the customer's address book. A scenario names it without freezing it — the copy is taken later, when a snapshot is materialized for an experiment, so an order edited after the recipe is published changes the starting state of the next run.",
  },
  {
    id: "support-identity",
    term: "Support identity",
    definition:
      "The versioned role, permissions, and operating guidance the support agent adopts. Tone of voice is not part of it — that comes from the shop's guidelines.",
  },
  {
    id: "ticket",
    term: "Ticket",
    definition:
      "The versioned support-incident record scoped to one shop and one customer: channel, origin references, prior message history, and the triggering first message every arm of an experiment opens on.",
  },
  {
    id: "scenario",
    term: "Scenario",
    definition:
      "The versioned experiment recipe built on one ticket and its linked shop-scoped objects, adding hidden facts, context documents, bound objective and mutation blocks, and completion conditions. Publishing it pins every version it was authored against.",
  },
  {
    id: "objective-block",
    term: "Objective block",
    definition:
      "A versioned, parameterized, shop-independent objective template. A scenario binds its parameters to same-shop objects and gives the binding a severity; what an arm met is decided against the template version the publication pinned.",
  },
  {
    id: "mutation-block",
    term: "Mutation block",
    definition:
      "A versioned, parameterized, shop-independent fault template the scenario runtime applies at a bound trigger time — between two of the agent's calls — and never shows to the support agent.",
  },
  {
    id: "agent-configuration",
    term: "Agent configuration",
    definition:
      "The versioned framework, architecture, model, prompt template, tool bindings, memory, runtime settings, and support identity that describe one agent under test. An experiment arm runs a published version of one.",
  },
  {
    id: "sandbox-snapshot",
    term: "Sandbox snapshot",
    definition:
      "The canonical immutable starting state resolved for an experiment. It pins every input that is already a published version and copies what none of them pinned — the shop's order fixtures, read as they stand at that moment; its identity is the starting-state fingerprint.",
  },
  {
    id: "experiment",
    term: "Experiment",
    definition:
      "An immutable record binding one published scenario version to one or two published agent configurations. Nothing updates it: reading one again, replaying it, or forking it are all separate acts.",
  },
  {
    id: "run",
    term: "Run (arm)",
    definition:
      "One independently mutable experiment arm and its evidence: its own clone of the snapshot, its conversation, tool events, state changes, spans, and evaluation. A write in one arm never reaches the other.",
  },
  {
    id: "participant-driver",
    term: "Participant driver",
    definition:
      "Where an arm's customer turns come from: a human operator today, a future simulator, or the scripted driver a replay uses. It is deliberately separate from the framework the support agent runs on.",
  },
  {
    id: "judge-configuration",
    term: "Judge configuration",
    definition:
      "A versioned rubric, the model that reads it, and the declared list of what it is shown. It scores the objectives a scenario leaves to a judge, from an anonymized record of one arm that names no framework, provider, or model.",
  },
  {
    id: "evaluation",
    term: "Evaluation",
    definition:
      "Deterministic, judge, or quantitative evidence read back against one run. Deterministic rows are projected from the record; only a judge's verdict is stored, because a model's reading cannot be re-derived.",
  },
] as const satisfies readonly GlossaryTerm[];

/** The identifier of a term this module actually defines. */
export type GlossaryTermId = (typeof GLOSSARY_TERMS)[number]["id"];

/**
 * Resolve a referenced term, or `undefined` when nothing defines it.
 *
 * Referencing surfaces are tested against this: a term named by a guide step that resolves to
 * nothing fails there rather than rendering as a bare word nobody defined.
 */
export function glossaryTerm(id: string): GlossaryTerm | undefined {
  return GLOSSARY_TERMS.find((entry) => entry.id === id);
}

/**
 * A reference to a defined word inside guide copy, written `[[objective-block]]` — or
 * `[[run|arms]]` where the sentence needs the word in another form.
 *
 * Guide copy is plain text so that the words an explainer uses can be read back by a test:
 * every reference in it is parsed out and checked against this module, which is what keeps a
 * term added to an explainer from rendering as a bare word nobody defined (ADR 0044).
 */
const REFERENCE = /\[\[([a-z-]+)(?:\|([^\]]+))?\]\]/g;

export interface GlossaryReference {
  id: string;
  /** The word as the sentence writes it, which is the term's own name unless one was given. */
  label: string;
}

/** Guide copy split into the prose between references and the references themselves. */
export function parseGlossaryProse(text: string): (string | GlossaryReference)[] {
  const segments: (string | GlossaryReference)[] = [];
  let cursor = 0;
  for (const match of text.matchAll(REFERENCE)) {
    const [marker, id, label] = match;
    if (match.index > cursor) {
      segments.push(text.slice(cursor, match.index));
    }
    segments.push({ id, label: label ?? glossaryTerm(id)?.term.toLowerCase() ?? id });
    cursor = match.index + marker.length;
  }
  if (cursor < text.length) {
    segments.push(text.slice(cursor));
  }
  return segments;
}

/** Every word a piece of guide copy sends a reader to the glossary for. */
export function referencedTerms(text: string): string[] {
  return [...text.matchAll(REFERENCE)].map((match) => match[1]);
}
