/**
 * What the screens whose vocabulary is not transferable from a commerce admin actually are.
 *
 * A person who has configured an online store knows what a product, an order and a customer
 * are, and this application means roughly the same things by them. It does not mean anything
 * familiar by a block, a recipe, a snapshot, an arm or a judge: those are the lab's own words,
 * they are load-bearing, and until now they appeared on screen with nothing behind them. ADR
 * 0044 names the five surfaces that carry them, and these are the notes those surfaces show
 * while guide mode is on.
 *
 * The copy is plain text with `[[term-id]]` references into `glossary.ts`, so a term has one
 * definition and every reference is checkable. Nothing here restates a definition — an
 * explainer says what *this screen* is and lets the word carry the rest.
 */

export type ExplainerId =
  | "objective-blocks"
  | "mutation-blocks"
  | "scenario"
  | "snapshots"
  | "bench"
  | "results";

export interface Explainer {
  /** What the note is about, shown as its label and used as its accessible name. */
  title: string;
  /** One or more paragraphs, in `[[term-id]]` markup. */
  body: readonly string[];
}

export const EXPLAINERS: Record<ExplainerId, Explainer> = {
  "objective-blocks": {
    title: "What an objective block is",
    body: [
      "An [[objective-block|objective block]] is a question an experiment asks, kept apart from any one incident so that several recipes can ask the same one and be compared on it.",
      "It asserts nothing on its own. A [[scenario]] binds it and gives the binding a severity, and where each [[run|arm]] stands on it is decided afterwards from that arm's own record, against the template version the recipe pinned. Editing a draft here never moves a recipe that has already been published.",
    ],
  },
  "mutation-blocks": {
    title: "What a mutation block is",
    body: [
      "A [[mutation-block|mutation block]] is a fault rather than a question: it moves the world in the middle of an incident instead of deciding anything about what the agent did. The one effect this build performs advances an order one step along its fulfilment graph, so an agent holding a proposal it computed a moment ago now holds a stale one.",
      "Authoring is free — a library may hold a template for an effect or a moment nothing yet performs — but an experiment whose recipe composed one is refused at setup rather than started and quietly never faulted. Like the objective library beside it, a [[scenario]] binds a template, chooses the moment, and pins the version it composed; a recipe with no fault bound is an incident where nothing interrupts, which is a legitimate recipe rather than an unfinished one.",
    ],
  },
  scenario: {
    title: "What this editor composes",
    body: [
      "A [[scenario]] is a recipe, not a conversation script. Nothing composed here tells the agent what to do or in what order — the order of the objectives is display priority — and the hidden facts stay with the operator rather than reaching the agent at all.",
      "What publishing does is freeze the whole composition and pin every version it reaches: the [[ticket]] it is built on, the shop behind that, and each [[objective-block|objective]] and [[mutation-block|mutation]] template it binds. An [[experiment]] runs a published version, so a recipe run next month runs what was composed today.",
    ],
  },
  snapshots: {
    title: "What a starting state is",
    body: [
      "This is where a recipe stops naming things and starts owning them. The orders it only named are copied as they stand the moment a [[sandbox-snapshot|snapshot]] is frozen, so an order edited afterwards changes the next snapshot rather than any that already exist.",
      "Starting a new [[experiment]] freezes one of these itself, from the version and seed it is given — a replay or a fork clones the one its source recorded; freezing one here is how to read what a run would begin from before starting it. The fingerprint on each row is that world's identity — two [[run|arms]] are comparable because they were cloned from the same one, and anything that made them differ afterwards is something one of them did.",
    ],
  },
  bench: {
    title: "What you are looking at, and what you are doing",
    body: [
      "Two [[run|arms]] of one [[experiment]], each running its own published [[agent-configuration|agent configuration]] against its own clone of one starting state. You are the [[participant-driver|participant driver]]: the customer's turns come from you, and the composer beside the threads says which arms a send reaches.",
      "Advancing an arm runs its framework for real and records what it answered, every tool call it made, the confirmation each write carried, and any attempt that failed. It is one request per arm, so an arm can be held back, or run again after a failure without re-sending the customer's words.",
    ],
  },
  results: {
    title: "How to read this comparison",
    body: [
      "Three kinds of evidence, deliberately kept apart. Deterministic rows are projected from each [[run|arm]]'s own record, so they report what happened rather than what was claimed. The rows no rule can decide are scored by the published [[judge-configuration|judge]], from an anonymized brief naming no framework, provider or model. The figures beside them are what the run measured.",
      "Nothing rolls the three up into one number. Turns, calls, retries and cost are observations rather than scores — the model, the prompt and the operator's own replies move them as much as the framework does — and a cheaper arm that missed what the recipe required is not the better one.",
    ],
  },
};
