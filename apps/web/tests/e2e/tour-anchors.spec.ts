import { SETUP_CHAIN, stepHref } from "../../src/lib/setupPath";
import { TOUR_IDS, TOURS, type TourId, tourAt, tourHref, tourSteps } from "../../src/lib/tours";
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
 * The state each surface needs is built once below; the route each one is at comes from the tour
 * table itself, so a tour declared without a way to reach it fails to compile instead of being
 * silently swept over (ADR 0054).
 */

/**
 * Where each surface is, composed from the tour table's own `route` rather than restated.
 *
 * The addresses used to live here, keyed exhaustively by tour identifier, so that a tour added
 * without a way to reach it failed to compile. `lib/tours.ts` names the route now (ADR 0054),
 * which is the same guarantee one step earlier: a tour cannot be declared without one, and the
 * chain assertion below holds the ten chain surfaces to the chain's own answer.
 */
function surfaceHref(id: TourId, lab: BuiltLab): string {
  return tourHref(id, {
    shopId: lab.shopId,
    scenarioId: lab.scenarioId,
    experimentId: lab.experimentId,
  });
}

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
    if (step === undefined) {
      // Naming a step the chain does not hold is the failure itself, and throwing it here also
      // narrows the step away from `undefined` for the comparison below.
      throw new Error(`${id} claims a chain step the chain does not have`);
    }
    expect(
      tourHref(id, { shopId: SHOP }),
      `${id} carries the ${chain.step} step but is not the surface the guide links to`,
    ).toBe(stepHref(step, SHOP));
  }
});

test("offers the Documents table's tour at the retired guidelines address", async ({
  page,
  lab,
}) => {
  // The other half of what this sweep is for. A surface that retires takes its tour with it,
  // and the address it left behind has to land somewhere that has one — the defect Slice 10
  // shipped was a tour still naming a screen nobody could reach. `/setup/support` redirects
  // to the Documents table filtered to Guidelines (ADR 0054, ADR 0057), so the reader arrives
  // on a surface the table declares and is offered that surface's walk.
  await page.goto(`/shops/${lab.shopId}/setup/support`);
  await page.waitForLoadState("networkidle");

  const landed = new URL(page.url());
  expect(landed.pathname).toBe(`/shops/${lab.shopId}/setup/policies`);
  expect(landed.searchParams.get("kind")).toBe("guidelines");
  expect(tourAt(landed.pathname)).toBe("policies-and-faq");
  await expect(page.getByRole("button", { name: "Guidelines 1" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(
    page.getByRole("button", {
      name: `Show me around ${TOURS["policies-and-faq"].surface}`,
    }),
  ).toBeVisible();
});

for (const id of TOUR_IDS) {
  test(`every step of the ${id} tour points at exactly one visible thing on its surface`, async ({
    page,
    lab,
  }) => {
    const tour = TOURS[id];
    await page.goto(surfaceHref(id, lab));

    // Wait for the surface to have finished arriving before asking what the bar offers.
    //
    // The control is drawn from the route (ADR 0055), and a surface may replace its own
    // address on load — Tickets opens its newest ticket as soon as the list answers. Asked on
    // the frame after `goto`, this guard would go on passing while the control vanished a
    // moment later, which is exactly how a tour goes stale silently and exactly what this
    // sweep exists to prevent. It is asked twice, of two different things: the address the
    // surface settles at has to be one the table names, and the control has to be on screen
    // there.
    await page.waitForLoadState("networkidle");
    expect(
      tourAt(new URL(page.url()).pathname),
      `${id} settles at ${page.url()}, which its tour does not name`,
    ).toBe(id);

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
