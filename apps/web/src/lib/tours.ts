/**
 * Every tour this application can run, in one table.
 *
 * A tour is a short walk around one screen: the surface dims, one element at a time is lit, and
 * a popover beside it says what that element is. It replaces the derived next-step strip and the
 * six inline explainer bands (ADR 0045), and it inherits their copy — the notes' sentences were
 * reviewed twice for what this build actually does, and rewriting them from scratch would have
 * been a third chance to get them wrong.
 *
 * This table is the single place a tour is written down. The runtime reads it, the unit tests
 * read it, and `tests/e2e/tour-anchors.spec.ts` sweeps it: for every surface and every step, the
 * step's anchor is asserted to resolve to exactly one visible element on that surface. That sweep
 * is the answer to the one part of ADR 0044's refusal that was correct — a tour *does* go stale
 * when a control moves, and until now nothing in this repository would have noticed. A step
 * declared here joins the sweep the day it is declared, because the sweep's cases are these rows
 * rather than a list somebody keeps beside them (the shape ADR 0023 established for the tool
 * registry).
 *
 * Bodies are plain text carrying `[[term-id]]` references into `glossary.ts`, exactly as the
 * explainers were, so a term a popover sends a reader to look up can be read back out of the copy
 * and checked against the one module that defines it.
 */

export type TourId =
  | "shop-home"
  | "objective-blocks"
  | "mutation-blocks"
  | "scenario"
  | "snapshots"
  | "bench"
  | "results";

export interface TourStep {
  /**
   * The element this step lights, as a CSS selector that resolves to exactly one visible element
   * on the surface.
   *
   * Anchors prefer the name the page already carries — a landmark or a card's accessible name —
   * so that renaming one is a visible change that fails the sweep rather than a silent one. Where
   * the thing worth pointing at has no name of its own, the mount site carries an explicit
   * `data-tour` hook. Nothing here is a positional DOM path.
   */
  anchor: string;
  /** What this step is about, shown as the popover's heading. */
  title: string;
  /** One or more paragraphs, in `[[term-id]]` markup. */
  body: readonly string[];
}

export interface Tour {
  /** What the tour is of, used as the launch control's accessible name. */
  surface: string;
  steps: readonly TourStep[];
}

export const TOURS: Record<TourId, Tour> = {
  "shop-home": {
    surface: "this shop",
    steps: [
      {
        anchor: 'nav[aria-label="Shop workspace"]',
        title: "Everything is authored inside a shop",
        body: [
          "This rail is one [[shop]]'s workspace: its catalog and its policies, the customers and orders a sandbox is built from, the [[ticket|tickets]] an incident arrives on, and — under Scenarios — the recipes composed on them beside the two block libraries those recipes bind. The experiment lab at the foot of the rail is marked cross-shop, and what it holds is shared by every shop in this lab: the support identities, the agent configurations, the judges, the bench and the history.",
        ],
      },
      {
        anchor: '[aria-label="Publish"]',
        title: "Publishing freezes a version",
        body: [
          "Every [[definition]] in this lab is a draft you keep editing with immutable published versions stacked beside it. Publishing freezes the draft exactly as it stands, and an [[experiment]] pins a version rather than a draft — so editing this draft afterwards never moves what something has already pinned.",
        ],
      },
      {
        anchor: '[aria-label="Draft validation"]',
        title: "What the gate is still refusing",
        body: [
          "Whatever stands between this draft and a published version is listed here in the gate's own words, and the publish control refuses while an error is left. Nearly every step from an empty database to a two-arm comparison refuses the same way until the one before it is satisfied, which is why the setup guide is written in that order.",
        ],
      },
    ],
  },

  "objective-blocks": {
    surface: "the objective-block library",
    steps: [
      {
        anchor: '[aria-label="New objective block"]',
        title: "What you author here",
        body: [
          "An [[objective-block|objective block]] is a question an experiment asks, kept apart from any one incident so that several recipes can ask the same one and be compared on it.",
        ],
      },
      {
        anchor: '[data-tour="block-index"]',
        title: "What the library holds, and what decides it",
        body: [
          "It asserts nothing on its own. A [[scenario]] binds it and gives the binding a severity, and where each [[run|arm]] stands on it is decided afterwards from that arm's own record, against the template version the recipe pinned. Editing a draft here never moves a recipe that has already been published.",
        ],
      },
    ],
  },

  "mutation-blocks": {
    surface: "the mutation-block library",
    steps: [
      {
        anchor: '[data-tour="block-index"]',
        title: "What a mutation block is",
        body: [
          "A [[mutation-block|mutation block]] is a fault rather than a question: it moves the world in the middle of an incident instead of deciding anything about what the agent did. The one effect this build performs advances an order one step along its fulfilment graph, so an agent holding a proposal it computed a moment ago now holds a stale one.",
        ],
      },
      {
        anchor: '[aria-label="New mutation block"]',
        title: "Authoring is free; running is gated",
        body: [
          "Authoring is free — a library may hold a template for an effect or a moment nothing yet performs — but an experiment whose recipe composed one is refused at setup rather than started and quietly never faulted. Like the objective library beside it, a [[scenario]] binds a template, chooses the moment, and pins the version it composed; a recipe with no fault bound is an incident where nothing interrupts, which is a legitimate recipe rather than an unfinished one.",
        ],
      },
    ],
  },

  scenario: {
    surface: "the scenario editor",
    steps: [
      {
        anchor: '[aria-label="Recipe"]',
        title: "A recipe, not a script",
        body: [
          "A [[scenario]] is a recipe, not a conversation script. Nothing composed here tells the agent what to do or in what order — the order of the objectives is display priority.",
        ],
      },
      {
        anchor: '[aria-label="Hidden facts — operator only"]',
        title: "What the agent never sees",
        body: [
          "The hidden facts stay with the operator rather than reaching the agent at all. They are what you answer from while you drive the customer's side of a run: no [[run|arm]] is given them, no tool serves them, and nothing an agent reads can reach them.",
        ],
      },
      {
        anchor: '[aria-label="Publish gate"]',
        title: "What publishing freezes",
        body: [
          "What publishing does is freeze the whole composition and pin every version it reaches: the [[ticket]] it is built on, the shop behind that, and each [[objective-block|objective]] and [[mutation-block|mutation]] template it binds. An [[experiment]] runs a published version, so a recipe run next month runs what was composed today.",
        ],
      },
    ],
  },

  snapshots: {
    surface: "the starting states",
    steps: [
      {
        anchor: '[aria-label="Freeze a published version"]',
        title: "What a starting state is",
        body: [
          "This is where a recipe stops naming things and starts owning them. The orders it only named are copied as they stand the moment a [[sandbox-snapshot|snapshot]] is frozen, so an order edited afterwards changes the next snapshot rather than any that already exist.",
        ],
      },
      {
        anchor: '[aria-label="Snapshots"]',
        title: "Where a run begins",
        body: [
          "Starting a new [[experiment]] freezes one of these itself, from the version and seed it is given — a replay or a fork clones the one its source recorded; freezing one here is how to read what a run would begin from before starting it. The fingerprint on each row is that world's identity — two [[run|arms]] are comparable because they were cloned from the same one, and anything that made them differ afterwards is something one of them did.",
        ],
      },
    ],
  },

  bench: {
    surface: "the live bench",
    steps: [
      {
        anchor: '[data-tour="bench-arms"]',
        title: "What you are looking at",
        body: [
          "Two [[run|arms]] of one [[experiment]], each running its own published [[agent-configuration|agent configuration]] against its own clone of one starting state.",
          "Advancing an arm runs its framework for real and records what it answered, every tool call it made, the confirmation each write carried, and any attempt that failed. It is one request per arm, so an arm can be held back, or run again after a failure without re-sending the customer's words.",
        ],
      },
      {
        anchor: '[aria-label="Customer composer"]',
        title: "What you are doing",
        body: [
          "You are the [[participant-driver|participant driver]]: the customer's turns come from you, and the composer beside the threads says which arms a send reaches.",
        ],
      },
    ],
  },

  results: {
    surface: "this comparison",
    steps: [
      {
        anchor: '[data-tour="results-arms"]',
        title: "How to read this comparison",
        body: [
          "Three kinds of evidence, deliberately kept apart. Deterministic rows are projected from each [[run|arm]]'s own record, so they report what happened rather than what was claimed. The rows no rule can decide are scored by the published [[judge-configuration|judge]], from an anonymized brief naming no framework, provider or model. The figures beside them are what the run measured.",
        ],
      },
      {
        anchor: '[data-tour="results-provenance"]',
        title: "What this comparison pinned",
        body: [
          "Every chip here is something this run froze before it started — the recipe version, the starting state, and the published inputs behind them — followed by the dimensions its two arms actually differ along. Behaviour can be attributed to a dimension only while that last list holds exactly one: two differences and nothing here can say which of them moved the result.",
        ],
      },
      {
        anchor: 'nav[aria-label="Results views"]',
        title: "No aggregate, and nothing hidden",
        body: [
          "Nothing rolls the three up into one number. Turns, calls, retries and cost are observations rather than scores — the model, the prompt and the operator's own replies move them as much as the framework does — and a cheaper arm that missed what the recipe required is not the better one.",
          "Each tab reads the same run at a different depth: the [[evaluation|evidence]] overview here, the normalized execution timeline both arms produced, and the sanitized traces underneath it.",
        ],
      },
    ],
  },
};

/** Every surface with a tour. The sweep and the table tests both walk this rather than a list. */
export const TOUR_IDS = Object.keys(TOURS) as TourId[];
