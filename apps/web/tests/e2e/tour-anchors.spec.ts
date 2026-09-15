import { SETUP_CHAIN, stepHref } from "../../src/lib/setupPath";
import { TOUR_IDS, TOURS, type TourId, tourSteps } from "../../src/lib/tours";
import { test as base, expect } from "./support/e2e";
import { type BuiltLab, buildLab } from "./support/lab";
import { webOrigin } from "./support/stack";

/**
 * The anchor sweep: one case per surface with a tour, driven off the tour table itself.
 *
 * This is the answer to the objection ADR 0044 raised against coach marks and ADR 0045 accepted
 * as correct — that a tour goes stale silently when a control moves, and that staleness in a tour
 * was invisible to every test this project ran. It is no longer invisible. A control that is
 * renamed, moved behind a tab, hidden, or rendered twice fails here, naming the surface and the
 * step; and a step declared in `src/lib/tours.ts` joins this sweep the day it is declared, because
 * the cases below are that table's rows rather than a list kept beside them (ADR 0023's shape).
 *
 * The route and the state each surface needs are deliberately *here* rather than in the product
 * module, keyed exhaustively by the tour identifier, so a tour added without a way to reach it
 * fails to compile instead of being silently swept over.
 */

const SURFACES: Record<TourId, (lab: BuiltLab) => string> = {
  "shop-home": (lab) => `/shops/${lab.shopId}`,
  products: (lab) => `/shops/${lab.shopId}/products`,
  "shop-details": (lab) => `/shops/${lab.shopId}/setup/identity`,
  "policies-and-faq": (lab) => `/shops/${lab.shopId}/setup/policies`,
  "support-guidelines": (lab) => `/shops/${lab.shopId}/setup/support`,
  "tone-of-voice": (lab) => `/shops/${lab.shopId}/setup/tone`,
  customers: (lab) => `/shops/${lab.shopId}/customers`,
  orders: (lab) => `/shops/${lab.shopId}/orders`,
  tickets: (lab) => `/shops/${lab.shopId}/tickets`,
  "objective-blocks": (lab) => `/shops/${lab.shopId}/objective-blocks`,
  "mutation-blocks": (lab) => `/shops/${lab.shopId}/mutation-blocks`,
  scenarios: (lab) => `/shops/${lab.shopId}/scenarios`,
  scenario: (lab) => `/shops/${lab.shopId}/scenarios/${lab.scenarioId}`,
  snapshots: (lab) => `/shops/${lab.shopId}/scenarios/${lab.scenarioId}/snapshots`,
  "support-identities": (lab) => `/shops/${lab.shopId}/support-identities`,
  "agent-configurations": (lab) => `/shops/${lab.shopId}/agent-configurations`,
  judges: (lab) => `/shops/${lab.shopId}/judges`,
  "bench-setup": (lab) => `/shops/${lab.shopId}/bench`,
  bench: (lab) => `/shops/${lab.shopId}/bench/${lab.experimentId}`,
  results: (lab) => `/shops/${lab.shopId}/bench/${lab.experimentId}/results`,
};

/**
 * The whole chain, built once and shared by every case in this worker.
 *
 * The bench and the results screen are the end of a ten-step dependency order, so reaching them
 * costs a shop, a customer, an order, a ticket, both libraries, a published recipe, an identity,
 * two published configurations and a started experiment. That is a great deal of writing, and it
 * is worth doing once rather than once per surface.
 */
const test = base.extend<object, { lab: BuiltLab }>({
  lab: [
    async ({ playwright }, use, workerInfo) => {
      // This worker's own frontend, and through its proxy this worker's own API: a worker-scoped
      // fixture cannot take the test-scoped `baseURL`, so it names the same stack directly.
      const api = await playwright.request.newContext({
        baseURL: webOrigin(workerInfo.parallelIndex),
      });
      await use(await buildLab(api));
      await api.dispose();
    },
    { scope: "worker" },
  ],
});

// One worker, in order, because "once per worker" is only once while the cases stay together.
// `default` rather than `serial`: a rename that loosens two surfaces should report both, so a
// failed case must not skip the ones after it.
test.describe.configure({ mode: "default" });

test("has a tour to sweep at all", () => {
  // A parameterized sweep that became empty would report as passing, which is the one way the
  // cases below could stop proving anything without anybody noticing (ADR 0023). A `for` loop
  // over an empty table declares no tests at all, so the guard cannot itself be a case.
  expect(TOUR_IDS.length).toBeGreaterThan(0);
  for (const id of TOUR_IDS) {
    expect(tourSteps(id).length, `${id} declares no steps`).toBeGreaterThan(0);
  }
});

test("mounts each chain step on the surface the chain sends a reader to", () => {
  // The defect this catches, having already happened once: the tenth step is `/bench`, and its
  // chain step sat on the live bench at `/bench/:experimentId` — a page reached only by starting
  // an experiment, so the reading arrived after the question had stopped being asked. Every
  // anchor still resolved and every case still passed, because "is it on the right screen" was
  // nowhere asserted.
  const SHOP = "11111111-1111-4111-8111-111111111111";
  for (const id of TOUR_IDS) {
    const chain = TOURS[id].chain;
    if (chain === undefined) {
      continue;
    }
    const step = SETUP_CHAIN.find((entry) => entry.id === chain.step);
    expect(step, `${id} claims a chain step the chain does not have`).toBeDefined();
    expect(
      SURFACES[id]({ shopId: SHOP } as BuiltLab),
      `${id} carries the ${chain.step} step but is not the surface the guide links to`,
    ).toBe(stepHref(step!, SHOP));
  }
});

for (const id of TOUR_IDS) {
  test(`every step of the ${id} tour points at exactly one visible thing on its surface`, async ({
    page,
    lab,
  }) => {
    const tour = TOURS[id];
    await page.goto(SURFACES[id](lab));

    // The surface offers the tour at all: a tour declared for a screen that never mounts its
    // control is as stale as one pointing at a control that moved.
    await expect(
      page.getByRole("button", { name: `Show me around ${tour.surface}` }),
      `${id} does not offer its tour`,
    ).toBeVisible();

    // The composed chain step is swept exactly as a written one is: it lights a real
    // element on a real surface, and `data-tour="page-name"` is as capable of coming loose as
    // any other hook.
    for (const step of tourSteps(id)) {
      const anchor = page.locator(step.anchor);
      const where = `${id} · ${step.title} · ${step.anchor}`;
      // Soft, so one surface reports every step that has come loose rather than only its first.
      await expect.soft(anchor, `${where} matches more or fewer than one element`).toHaveCount(1);
      await expect.soft(anchor, `${where} matches something nobody can see`).toBeVisible();
    }
  });
}
