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

import { matchPath } from "react-router-dom";
import { chainPlacement, fillRoute, type RouteIds, type SetupStepId } from "./setupPath";

export type TourId =
  | "shop-home"
  | "products"
  | "shop-details"
  | "policies-and-faq"
  | "tone-of-voice"
  | "customers"
  | "orders"
  | "tickets"
  | "objective-blocks"
  | "mutation-blocks"
  | "scenarios"
  | "scenario"
  | "snapshots"
  | "support-identities"
  | "agent-configurations"
  | "judges"
  | "bench-setup"
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
  /**
   * Where the surface is, as a route pattern over `shopId`, `scenarioId` and `experimentId`.
   *
   * Named here rather than in a list kept beside this table, so that a tour cannot come to
   * describe a screen at an address nothing reaches: the anchor sweep composes its own
   * navigation from this field, and the ten chain surfaces' routes are asserted against the
   * chain's own (ADR 0054, and ADR 0023's shape for a registry that is swept).
   */
  route: string;
  /**
   * Further addresses the same surface answers at, relative to `route`.
   *
   * The bar offers the tour of wherever the reader is standing, and it matches `route`
   * **exactly** rather than by prefix — a prefix rule would hand the catalog's walk to the
   * product editor beneath it, whose screen holds none of the catalog's anchors (ADR 0055). A
   * surface that genuinely answers at more than one address says so here, and one does: the
   * comparison is one layout behind three tabs, the same screen at a second URL, which is why
   * this is addressing and not a second tour.
   *
   * A parameter segment would be written as it is in a route pattern, `:likeThis`. Unlike a
   * literal it claims *every* child of the route, so it is only right while the route table
   * sends them all to the same component. None is declared today: the ticket editor under the
   * ticket index is a screen of its own and has no tour (ADR 0073).
   */
  alsoAt?: readonly string[];
  /**
   * Where this surface sits in the setup chain, for the ten surfaces that sit on it.
   *
   * The step's copy is not written here: `chainPlacement` composes it from the chain table and
   * that table's own gate sentences, so two surfaces cannot phrase one fact differently. What
   * is declared here is only the anchor, which keeps every element a tour lights in this table
   * and under the sweep.
   */
  chain?: { step: SetupStepId; anchor: string };
  /** The walk around the surface itself. Empty where the chain step is the whole tour. */
  steps: readonly TourStep[];
}

/** Every surface on the chain lights its own name, which is the element all ten have. */
const PAGE_NAME = '[data-tour="page-name"]';

/**
 * The chain step a tour opens with, composed rather than written.
 *
 * A reader who pressed *Show me around* on the sixth of ten screens is owed the same two facts
 * wherever they are standing: which link of the chain this is, and what stays refused until the
 * work here is done. Writing that once per surface would have been fourteen chances to phrase
 * the same fact differently and ten places for it to go stale.
 */
function chainStepFor(tour: Tour): TourStep | null {
  if (tour.chain === undefined) {
    return null;
  }
  const placement = chainPlacement(tour.chain.step);
  const neighbours = [
    placement.after === null ? null : `after ${placement.after}`,
    placement.before === null ? null : `before ${placement.before}`,
  ]
    .filter((part) => part !== null)
    .join(", ");
  return {
    anchor: tour.chain.anchor,
    title: `Step ${placement.position} of ${placement.total} · ${placement.label}`,
    body: [
      `This is one link of the chain from an empty lab to a two-arm comparison, ${neighbours}. ` +
        "Nearly every link refuses until the one before it is satisfied, which is why the order " +
        "is the guide.",
      placement.unlocks,
    ],
  };
}

/**
 * What a tour actually walks: its chain step, where it has one, and then its own steps.
 *
 * Every reader of the table goes through here — the launch control, the copy tests, and the
 * end-to-end anchor sweep — so a composed step is held to exactly what a written one is held to.
 */
export function tourSteps(id: TourId): readonly TourStep[] {
  const tour = TOURS[id];
  const chain = chainStepFor(tour);
  return chain === null ? tour.steps : [chain, ...tour.steps];
}

export const TOURS: Record<TourId, Tour> = {
  "shop-home": {
    surface: "the overview",
    route: "/shops/:shopId",
    chain: { step: "shop", anchor: PAGE_NAME },
    steps: [
      {
        anchor: 'nav[aria-label="Shop workspace"]',
        title: "Everything is authored inside a shop",
        body: [
          "This rail is one [[shop]]'s workspace: its catalog and its policies, the customers and orders a sandbox is built from, the [[ticket|tickets]] an incident arrives on, and the scenarios composed on them. Everything shared by every shop in this lab is the other mode in the bar above — the [[support-identity|support identities]], the [[agent-configuration|agent configurations]], the [[judge-configuration|judges]], the two block libraries, the bench and the history — which is why Experiment lab is a tab there rather than a section down here.",
        ],
      },
      {
        // The Publish card is gone: the overview's spine is the version timeline, and the
        // two-step publish is that card's own footer (PLAN-UX Slice 15).
        anchor: '[aria-label="Versions of this shop"]',
        title: "Publishing freezes a version",
        body: [
          "Every [[definition]] in this lab is a draft you keep editing with immutable published versions stacked beside it. Publishing freezes the draft exactly as it stands, and an [[experiment]] pins a version rather than a draft — so editing this draft afterwards never moves what something has already pinned.",
        ],
      },
      {
        anchor: '[aria-label="Findings on the draft"]',
        title: "What the gate is still refusing",
        body: [
          "Whatever stands between this draft and a published version is listed here in the gate's own words, and the publish control refuses while an error is left. Nearly every step from an empty database to a two-arm comparison refuses the same way until the one before it is satisfied, which is why the setup guide is written in that order.",
        ],
      },
    ],
  },

  "objective-blocks": {
    surface: "the objective-block library",
    route: "/lab/objective-blocks",
    chain: { step: "blocks", anchor: PAGE_NAME },
    steps: [
      {
        anchor: '[aria-label="New objective block"]',
        title: "What you author here",
        body: [
          "An [[objective-block|objective block]] is a question an experiment asks, kept apart from any one incident so that several scenarios can ask the same one and be compared on it.",
        ],
      },
      {
        anchor: '[data-tour="block-index"]',
        title: "What the library holds, and what decides it",
        body: [
          "It asserts nothing on its own. A [[scenario]] binds it and gives the binding a severity, and where each [[run|arm]] stands on it is decided afterwards from that arm's own record, against the template version the scenario pinned. Editing a draft here never moves a scenario that has already been published.",
        ],
      },
    ],
  },

  "mutation-blocks": {
    surface: "the mutation-block library",
    route: "/lab/mutation-blocks",
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
          "Authoring is free — a library may hold a template for an effect or a moment nothing yet performs — but an experiment whose scenario composed one is refused at setup rather than started and quietly never faulted. Like the objective library beside it, a [[scenario]] binds a template, chooses the moment, and pins the version it composed; a scenario with no fault bound is an incident where nothing interrupts, which is a legitimate scenario rather than an unfinished one.",
        ],
      },
    ],
  },

  scenario: {
    surface: "the scenario editor",
    route: "/shops/:shopId/scenarios/:scenarioId",
    steps: [
      {
        anchor: '[aria-label="Built on"]',
        title: "Composed, not scripted",
        body: [
          "A [[scenario]] is built on one ticket, and it is not a conversation script. Nothing composed here tells the agent what to do or in what order — the order of the objectives is display priority.",
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
        anchor: '[aria-label="What publishing freezes"]',
        title: "What publishing freezes",
        body: [
          "What publishing does is freeze the whole composition and pin every version it reaches: the [[ticket]] it is built on and the shop it runs in, each at its newest published version, and each [[objective-block|objective]] and [[mutation-block|mutation]] template it binds. An [[experiment]] runs a published version, so a scenario run next month runs what was composed today.",
        ],
      },
    ],
  },

  snapshots: {
    surface: "the starting states",
    route: "/shops/:shopId/scenarios/:scenarioId/snapshots",
    steps: [
      {
        anchor: '[aria-label="Freeze a published version"]',
        title: "What a starting state is",
        body: [
          "This is where a scenario stops naming things and starts owning them. The orders it only named are copied as they stand the moment a [[sandbox-snapshot|snapshot]] is frozen, so an order edited afterwards changes the next snapshot rather than any that already exist.",
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
    route: "/lab/bench/:shopId/:experimentId",
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
    surface: "the results",
    route: "/lab/bench/:shopId/:experimentId/results",
    // The three tabs are one surface: the header, the arm cards and the provenance row this
    // tour lights are the layout's, and all three are on screen whichever tab is open.
    alsoAt: ["timeline", "traces"],
    steps: [
      {
        anchor: '[data-tour="results-arms"]',
        title: "How to read the results",
        body: [
          "Three kinds of evidence, deliberately kept apart. Deterministic rows are projected from each [[run|arm]]'s own record, so they report what happened rather than what was claimed. The rows no rule can decide are scored by the published [[judge-configuration|judge]], from an anonymized brief naming no framework, provider or model. The figures beside them are what the run measured.",
        ],
      },
      {
        anchor: '[data-tour="results-provenance"]',
        title: "What this run pinned",
        body: [
          "Every chip here is something this run froze before it started — the scenario version, the starting state, and the published inputs behind them — followed by the dimensions its two arms actually differ along. Behaviour can be attributed to a dimension only while that last list holds exactly one: two differences and nothing here can say which of them moved the result.",
        ],
      },
      {
        anchor: 'nav[aria-label="Results views"]',
        title: "No aggregate, and nothing hidden",
        body: [
          "Nothing rolls the three up into one number. Turns, calls, retries and cost are observations rather than scores — the model, the prompt and the operator's own replies move them as much as the framework does — and a cheaper arm that missed what the scenario required is not the better one.",
          "Each tab reads the same run at a different depth: the [[evaluation|evidence]] overview here, the normalized execution timeline both arms produced, and the sanitized traces underneath it.",
        ],
      },
    ],
  },

  customers: {
    surface: "customers",
    route: "/shops/:shopId/customers",
    chain: { step: "customer", anchor: PAGE_NAME },
    steps: [],
  },

  orders: {
    surface: "orders",
    route: "/shops/:shopId/orders",
    chain: { step: "order", anchor: PAGE_NAME },
    steps: [],
  },

  tickets: {
    surface: "tickets",
    route: "/shops/:shopId/tickets",
    // The index's alone: the ticket editor and the create page are surfaces of their own and
    // carry no tour, as every other editor and create page (ADR 0073).
    chain: { step: "ticket", anchor: PAGE_NAME },
    steps: [],
  },

  scenarios: {
    surface: "scenarios",
    route: "/shops/:shopId/scenarios",
    chain: { step: "scenario", anchor: PAGE_NAME },
    steps: [],
  },

  "support-identities": {
    surface: "support identities",
    route: "/lab/support-identities",
    chain: { step: "support-identity", anchor: PAGE_NAME },
    steps: [],
  },

  "agent-configurations": {
    surface: "agent configs",
    route: "/lab/agent-configurations",
    chain: { step: "agent-configurations", anchor: PAGE_NAME },
    steps: [],
  },

  judges: {
    surface: "judges",
    route: "/lab/judges",
    chain: { step: "judge", anchor: PAGE_NAME },
    steps: [],
  },

  "bench-setup": {
    surface: "the bench",
    route: "/lab/bench",
    // The chain's tenth step is `/bench`, which is this page. The live bench is where an
    // experiment is *watched*, and a reader only reaches it by starting one — so a chain step
    // there would be an answer offered after the question had stopped being asked.
    chain: { step: "experiment", anchor: PAGE_NAME },
    steps: [],
  },

  products: {
    surface: "the catalog",
    route: "/shops/:shopId/products",
    steps: [
      {
        anchor: '[data-tour="product-index"]',
        title: "The catalog is part of the shop draft",
        body: [
          "Products have no version and no publish control of their own: they are edited into the [[shop]] draft, and publishing the shop freezes the catalog with everything else on it. The last column is what each product's gate is still refusing, and a shop that sells nothing is itself one of the things the gate refuses.",
          "An [[order]] names variants from here and an [[experiment]] pins the version they were frozen in, so a catalog edited afterwards never moves what a run already read.",
        ],
      },
      {
        anchor: '[data-tour="new-product"]',
        title: "New product opens the editor",
        body: [
          "A product has nothing to answer for before it exists: pressing this appends an empty one to the draft and opens its editor, where the title, variants, prices, options, media and attributes are authored. A variant priced in a currency the shop does not sell is refused at the gate, so the currencies on the shop's details are what bound this catalog rather than the other way round.",
        ],
      },
    ],
  },

  "shop-details": {
    surface: "shop details",
    route: "/shops/:shopId/setup/identity",
    steps: [
      {
        anchor: '[aria-label="Commerce"]',
        title: "The locale and the money",
        body: [
          "Commerce is what the rest of the [[shop]] is bounded by. Its currencies are the ones a variant may be priced in, and its locale is the language the incident is conducted in — the create form answers that pair together, and this is where either is changed afterwards.",
        ],
      },
      {
        anchor: '[aria-label="Payment methods"]',
        title: "What an order could have been paid with",
        body: [
          "Payment and fulfilment methods are the vocabulary an [[order]] draws on: an order fixture names one of each, and naming one this shop does not offer is refused when the order is saved rather than when it is run.",
        ],
      },
      {
        anchor: '[aria-label="Setup checklist"]',
        title: "Everything here is one draft",
        body: [
          "These pages edit different parts of a single [[definition]], and the gate reads all of it at once. An error raised by the tone-of-voice page shows here too, which is why *Save draft* on any of them saves the same draft rather than that page's share of it.",
        ],
      },
    ],
  },

  "policies-and-faq": {
    surface: "policies and FAQ",
    route: "/shops/:shopId/setup/policies",
    steps: [
      {
        anchor: '[aria-label="Documents"]',
        title: "What the agent is allowed to tell a customer",
        body: [
          "A document is something the support agent reaches through a tool rather than prose for a person to read. A [[scenario]] names the ones that matter for its incident, and what the agent did with a document it was given is part of what an [[evaluation]] decides afterwards.",
        ],
      },
      {
        // The three collections in one place, which is what replaced the two cards this
        // tour used to light and the separate guidelines page it used to sit beside
        // (PLAN-UX Slice 16). The chip row carries the hook because a chip's own name
        // carries its count, and a count moves as a shop is authored.
        anchor: '[data-tour="document-kinds"]',
        title: "Three collections, three tools",
        body: [
          "Policies are what the business commits to and FAQ entries what it is usually asked; each is fetched by a tool of its own, which is why they stay apart rather than becoming one list.",
          "Guidelines are the third, and they are instruction rather than reference: what to escalate, what to refuse, what to confirm first. A [[support-identity]] carries what the agent *is* across every shop, and these are what this one shop asks of it — so the same identity answers differently here than it would elsewhere.",
        ],
      },
    ],
  },

  "tone-of-voice": {
    surface: "tone of voice",
    route: "/shops/:shopId/setup/tone",
    steps: [
      {
        anchor: '[aria-label="Guidelines"]',
        title: "The voice, and which one is the default",
        body: [
          "A shop may keep several voices and marks one as its default, which is the one an [[agent-configuration]] adopts unless its own prompt names another. Tone is the shop's to set rather than the identity's, so two shops can share an agent and still not sound alike.",
        ],
      },
    ],
  },
};

/** Every surface with a tour. The sweep and the table tests both walk this rather than a list. */
export const TOUR_IDS = Object.keys(TOURS) as TourId[];

/**
 * Where a surface is, for a reader that has to go there.
 *
 * The one composition of a tour's route, so the sweep navigates to the address this table
 * declares rather than to one somebody kept in step with it by hand.
 */
export function tourHref(id: TourId, ids: RouteIds): string {
  return fillRoute(TOURS[id].route, ids);
}

/**
 * Every address a surface answers at, which is its route plus whatever tabs it declares.
 *
 * One composition, so the resolution below and the tests over it read the same list.
 */
function addressesOf(tour: Tour): string[] {
  return [tour.route, ...(tour.alsoAt ?? []).map((rest) => `${tour.route}/${rest}`)];
}

/**
 * The create pages, which are surfaces of their own and have no tour (PLAN-UX Slice 12).
 *
 * One of them has to be named rather than inferred: `/shops/new` is matched by the shop
 * overview's `/shops/:shopId`, because `tourAt` resolves against the tour table's patterns
 * and not against the route table, so without this it would be offered the overview's walk
 * and light anchors that are not on it.
 *
 * Written as the addresses rather than as "anything ending in `/new`", which has two edges:
 * a trailing slash slips past it, and a product an operator names `new` would lose whatever
 * tour its editor is one day given. Slice 13 added the lab's four, Slice 14 the
 * scenario's and ADR 0073 the ticket's.
 *
 * Only `/shops/new` currently *needs* excluding: `tourAt` matches a tour's addresses
 * exactly, so an index whose route is the segment above a create page does not claim it.
 * The rest are listed because this is the statement — a create page is a surface of its own
 * and has no tour — and an exclusion that held only the addresses which happen to collide
 * today would stop being that statement the moment an index declared a parameter segment as a
 * second address. `App.test.tsx` sweeps the route tree against this list, so a
 * create route added without a line here fails rather than being noticed later.
 */
export const CREATE_ROUTES = [
  "/shops/new",
  "/shops/:shopId/orders/new",
  "/shops/:shopId/setup/documents/new",
  "/shops/:shopId/customers/new",
  "/shops/:shopId/tickets/new",
  "/shops/:shopId/scenarios/new",
  "/lab/support-identities/new",
  "/lab/agent-configurations/new",
  "/lab/judges/new",
  "/lab/objective-blocks/new",
  "/lab/mutation-blocks/new",
];

/**
 * The tour of the surface a location is on, or none (ADR 0055).
 *
 * This is how the bar's one launch control knows what it would walk: the table already names
 * every surface's route, so the tour, its address and its control are one row and no route file
 * names a tour a second time. The match is exact — a route's children are other surfaces, and
 * offering a screen the walk of the screen above it would light anchors that are not on it.
 */
export function tourAt(pathname: string): TourId | null {
  if (CREATE_ROUTES.some((route) => matchPath(route, pathname) !== null)) {
    return null;
  }
  for (const id of TOUR_IDS) {
    for (const address of addressesOf(TOURS[id])) {
      if (matchPath(address, pathname) !== null) {
        return id;
      }
    }
  }
  return null;
}
