import { describe, expect, it } from "vitest";
import { glossaryTerm, parseGlossaryProse, referencedTerms } from "./glossary";
import { chainPlacement, SETUP_CHAIN, SETUP_GUIDE_STEPS, stepHref } from "./setupPath";
import { TOUR_IDS, TOURS, tourAt, tourHref, tourSteps } from "./tours";

/**
 * The tour table, held to what it claims.
 *
 * These are the assertions the explainers carried, over the copy that replaced them: a term a
 * popover sends a reader to look up resolves to a definition, and no step restates one. What is
 * new is the shape of the anchors — a tour's whole risk is that it goes on pointing at something
 * that has moved, so an anchor's *form* is checked here and its *resolution* is swept on the
 * real surfaces by `tests/e2e/tour-anchors.spec.ts` (ADR 0045).
 */

const STEPS = TOUR_IDS.flatMap((id) => tourSteps(id).map((step) => [id, step] as const));

/**
 * Every piece of copy in this application written in `[[term-id]]` markup, in one list.
 *
 * The chain's own step copy is read here beside the tours because `GlossaryTermLink` renders a
 * bare word when a reference resolves to nothing: copy left out of this loop is copy where that
 * can happen unnoticed, whichever surface it is on. This list is what the explainers' own tests
 * held, carried onto the copy that replaced them.
 */
const MARKED_UP_COPY: [string, readonly string[]][] = [
  ...STEPS.map(
    ([id, step]) => [`tour ${id} · ${step.title}`, step.body] as [string, readonly string[]],
  ),
  ...Object.entries(SETUP_GUIDE_STEPS).map(
    ([id, step]) => [`guide step ${id}`, [...step.body, step.gate]] as [string, readonly string[]],
  ),
];

describe("the tour table", () => {
  it("declares a surface's tour as something a reader can actually be walked through", () => {
    // A parameterized suite over a table that became empty reports as passing, which is the one
    // way everything below could stop proving anything without anybody noticing (ADR 0023).
    expect(TOUR_IDS.length).toBeGreaterThan(0);
    expect(STEPS.length).toBeGreaterThan(TOUR_IDS.length);

    for (const id of TOUR_IDS) {
      const tour = TOURS[id];
      expect(tour.surface, `${id} does not say what it is a tour of`).not.toBe("");
      expect(tourSteps(id).length, `${id} has no steps`).toBeGreaterThan(0);
      for (const step of tourSteps(id)) {
        expect(step.title, `a step of ${id} has no title`).not.toBe("");
        expect(step.body.length, `${step.title} has no body`).toBeGreaterThan(0);
        for (const paragraph of step.body) {
          expect(paragraph.trim(), `${step.title} has an empty paragraph`).not.toBe("");
        }
      }
    }
  });

  it("anchors on a name the page carries or a hook it was given, never on a position", () => {
    // Either the element's own accessible name — renaming which is a visible change that fails
    // the sweep on purpose — or an explicit `data-tour` hook where the page names nothing.
    const named = /^[a-z]*\[(aria-label|data-tour)="[^"]+"\]$/;
    for (const [id, step] of STEPS) {
      expect(step.anchor, `${id}: ${step.anchor} is not a stable anchor`).toMatch(named);
    }
  });

  it("names the route each surface is at, filled from the identifiers a route can carry", () => {
    // The sweep in `tests/e2e/tour-anchors.spec.ts` navigates by this field, so a tour whose
    // route is wrong is a tour swept on the wrong screen (ADR 0054).
    const ids = { shopId: "s1", scenarioId: "r1", experimentId: "x1" };
    for (const id of TOUR_IDS) {
      expect(TOURS[id].route, `${id} does not say where it is`).toMatch(/^\/(shops|lab)\//);
      expect(tourHref(id, ids), `${id} leaves a parameter unfilled`).not.toContain(":");
    }
    expect(tourHref("bench-setup", ids)).toBe("/lab/bench");
    expect(tourHref("bench", ids)).toBe("/lab/bench/s1/x1");
    expect(tourHref("snapshots", ids)).toBe("/shops/s1/scenarios/r1/snapshots");
  });

  it("puts each chain surface exactly where the chain sends a reader", () => {
    // The defect this catches: a route moved on one of the two tables and not the other, so
    // the guide links one way and the tour is swept on the other.
    for (const id of TOUR_IDS) {
      const chain = TOURS[id].chain;
      if (chain === undefined) {
        continue;
      }
      const step = SETUP_CHAIN.find((entry) => entry.id === chain.step);
      expect(step, `${id} claims a chain step the chain does not have`).toBeDefined();
      expect(tourHref(id, { shopId: "s1" }), `${id} is not the surface the chain links to`).toBe(
        stepHref(step as (typeof SETUP_CHAIN)[number], "s1"),
      );
    }
  });

  it("points each step of a tour at a different element", () => {
    // A tour that lit the same box twice would be a tour with a step it did not need, and the
    // sweep below cannot tell the two occurrences apart.
    for (const id of TOUR_IDS) {
      const anchors = tourSteps(id).map((step) => step.anchor);
      expect(new Set(anchors).size, `${id} lights the same element twice`).toBe(anchors.length);
    }
  });

  it("names only vocabulary the glossary defines, here and in the chain's own copy", () => {
    const referenced = MARKED_UP_COPY.flatMap(([where, paragraphs]) =>
      paragraphs.flatMap((paragraph) =>
        referencedTerms(paragraph).map((term) => [where, term] as const),
      ),
    );

    expect(referenced.length).toBeGreaterThan(20);
    for (const [where, term] of referenced) {
      expect(glossaryTerm(term), `${where} names ${term}, which has no definition`).toBeDefined();
    }
  });

  it("points at the definitions rather than restating them", () => {
    // `glossary.ts` exists so a term has one definition. Copy that repeated one would be the
    // second copy that module was written to prevent.
    for (const [where, paragraphs] of MARKED_UP_COPY) {
      for (const paragraph of paragraphs) {
        for (const term of referencedTerms(paragraph)) {
          const sentence = (glossaryTerm(term)?.definition ?? "").split(". ")[0];
          expect(paragraph, `${where} restates ${term}`).not.toContain(sentence);
        }
      }
    }
  });

  it("speaks the vocabulary the chain's own steps speak", () => {
    // The tours and the chain table are two readings of one lab, so a word that appears in a
    // popover and in no step of the chain — or the other way round — is a sign they have
    // drifted apart.
    const inTours = new Set<string>(
      STEPS.flatMap(([, step]) => step.body.flatMap(referencedTerms)),
    );
    const inChain = new Set<string>(SETUP_CHAIN.flatMap((step) => step.terms));

    for (const term of ["objective-block", "mutation-block", "scenario", "sandbox-snapshot"]) {
      expect(inTours.has(term), `${term} is missing from the tours`).toBe(true);
      expect(inChain.has(term), `${term} is missing from the chain`).toBe(true);
    }
  });
});

describe("guide copy", () => {
  it("splits a reference out of the prose around it", () => {
    expect(parseGlossaryProse("A [[scenario]] is a recipe.")).toEqual([
      "A ",
      { id: "scenario", label: "scenario" },
      " is a recipe.",
    ]);
  });

  it("uses the word as the sentence writes it when the sentence says so", () => {
    expect(parseGlossaryProse("Two [[run|arms]]")).toEqual(["Two ", { id: "run", label: "arms" }]);
  });

  it("leaves prose with no references alone", () => {
    expect(parseGlossaryProse("Nothing is defined here.")).toEqual(["Nothing is defined here."]);
    expect(referencedTerms("Nothing is defined here.")).toEqual([]);
  });
});

describe("the chain a tour opens with", () => {
  it("reaches every one of the chain's ten steps, each from exactly one surface", () => {
    // The point of the whole arrangement: an operator standing anywhere on the path from an
    // empty lab to a comparison can ask where they are. A step nothing claims is a screen that
    // cannot answer, and a step two tours claim is two answers to one question.
    const claimed = TOUR_IDS.flatMap((id) => {
      const chain = TOURS[id].chain;
      return chain === undefined ? [] : [chain.step];
    });

    expect([...claimed].sort()).toEqual(SETUP_CHAIN.map((step) => step.id).sort());
  });

  it("opens the tour, because where you are comes before what is on the screen", () => {
    for (const id of TOUR_IDS) {
      const chain = TOURS[id].chain;
      if (chain === undefined) {
        continue;
      }
      const [first] = tourSteps(id);
      const placement = chainPlacement(chain.step);

      expect(first.title, `${id} does not open on its place in the chain`).toBe(
        `Step ${placement.position} of ${placement.total} · ${placement.label}`,
      );
      // The gate is the chain table's own sentence, so two popovers cannot come to disagree
      // about what stays refused until this step is done.
      expect(first.body).toContain(SETUP_GUIDE_STEPS[chain.step].gate);
    }
  });

  it("names the neighbours the chain puts either side, and invents none at the ends", () => {
    const first = chainPlacement(SETUP_CHAIN[0].id);
    const last = chainPlacement(SETUP_CHAIN[SETUP_CHAIN.length - 1].id);

    expect(first.after).toBeNull();
    expect(first.before).toBe(SETUP_CHAIN[1].label);
    expect(last.before).toBeNull();
    expect(last.after).toBe(SETUP_CHAIN[SETUP_CHAIN.length - 2].label);
    expect(tourSteps("shop-home")[0].body[0]).not.toContain("after");
  });

  it("is the whole tour on a surface with nothing of its own to walk", () => {
    // Seven of the ten had no tour at all. They are not owed invented copy about their own
    // controls to justify the control appearing: one honest step is what they have to say.
    expect(TOURS.customers.steps).toHaveLength(0);
    expect(tourSteps("customers")).toHaveLength(1);
  });
});

/**
 * What the top bar reads to know which tour it is offering (ADR 0055).
 *
 * The bar has one launch control and no identifier: it resolves the surface from the location
 * against this table. So the table's `route` has stopped being only the sweep's navigation and
 * become the declaration — which makes "every surface answers at its own address, and no
 * address answers for two surfaces" a property worth holding here rather than discovering in a
 * browser.
 */
describe("the tour a location is on", () => {
  const IDS = { shopId: "shop-1", scenarioId: "recipe-1", experimentId: "run-1" };

  it("resolves every surface at its own address, and only its own", () => {
    for (const id of TOUR_IDS) {
      expect(tourAt(tourHref(id, IDS)), id).toBe(id);
    }
  });

  it("gives the comparison's tabs the comparison's tour", () => {
    const results = tourHref("results", IDS);
    expect(TOURS.results.alsoAt).toEqual(["timeline", "traces"]);
    for (const tab of TOURS.results.alsoAt ?? []) {
      expect(tourAt(`${results}/${tab}`)).toBe("results");
    }
  });

  it("keeps the helpdesk's tour at the ticket it opens for itself", () => {
    // Tickets replaces its own address with its newest ticket as soon as the list answers, so
    // the bare index is an address almost no reader is standing on. Both are the one screen.
    expect(tourAt("/shops/shop-1/tickets")).toBe("tickets");
    expect(tourAt("/shops/shop-1/tickets/t-204")).toBe("tickets");
  });

  it("declares every second address as one segment under its route, never a path of its own", () => {
    // A second address is addressing, not a second tour: it must be the declared route plus
    // one segment, so it cannot drift away from the surface it belongs to. What it may *not*
    // check is that a parameter segment names one screen — that is the route table's to say,
    // and `alsoAt`'s docblock is where the dependency is written down.
    for (const id of TOUR_IDS) {
      for (const rest of TOURS[id].alsoAt ?? []) {
        expect(rest, `${id} declares an absolute second address`).not.toContain("/");
        expect(rest, `${id} declares an empty second address`).not.toBe("");
      }
    }
  });

  it("answers nothing for a route that is a different surface underneath one with a tour", () => {
    // Matching by prefix would hand the catalog's walk to the product editor, and the recipe's
    // to the starting states, whose own tour would then never be reached.
    expect(tourAt("/shops/shop-1/products/alpine-shell")).toBeNull();
    expect(tourAt("/shops/shop-1/customers/someone")).toBeNull();
    expect(tourAt("/lab/judges/judge-1")).toBeNull();
    expect(tourAt("/lab/history")).toBeNull();
    expect(tourAt("/settings")).toBeNull();
    expect(tourAt("/shops")).toBeNull();
  });

  it("keeps the recipe and its starting states apart, which share a prefix", () => {
    expect(tourAt(tourHref("scenario", IDS))).toBe("scenario");
    expect(tourAt(tourHref("snapshots", IDS))).toBe("snapshots");
  });
});
