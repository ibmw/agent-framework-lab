import { act, render, screen } from "@testing-library/react";
import { setupServer } from "msw/node";
import { MemoryRouter } from "react-router-dom";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { TourLaunch } from "./components/TourLaunch";
import { TOUR_IDS, TOURS, type TourId, tourHref } from "./lib/tours";

/**
 * The control that offers a tour of the screen you are standing on.
 *
 * It is unconditional, which is the whole of ADR 0046: it was gated by guide mode until a lab
 * filled by `make seed` derived that mode off and hid the offer from the reader who had not
 * found it yet. A control that does nothing until it is pressed has nothing to opt out of, so
 * there is no mode, no stored preference and — asserted below — no reading either.
 *
 * Its mount moved into the top bar with ADR 0055, and with it the question this suite asks. It
 * used to be handed a tour identifier by the page that mounted it; it is now handed a location
 * and resolves the identifier itself, so what is under test is the resolution as much as the
 * control: every surface's own route offers its own tour, the comparison's three tabs are one
 * surface, and a route with no tour draws nothing at all.
 */

// Deliberately without handlers. Every request this suite could make is therefore unhandled,
// and unhandled is an error, so a control that started reading something again fails here
// rather than passing quietly against a handler somebody added to keep it green.
const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  // A case that stubs a global (the walk's `matchMedia`) never leaks it, even when it fails.
  vi.unstubAllGlobals();
  server.events.removeAllListeners();
  server.resetHandlers();
  window.localStorage.clear();
});
afterAll(() => server.close());

const SHOP_ID = "11111111-1111-4111-8111-111111111111";
const SCENARIO_ID = "returns-window";
const EXPERIMENT_ID = "22222222-2222-4222-8222-222222222222";

/** Where a surface is, composed from the table rather than restated beside it. */
function surfaceHref(id: TourId): string {
  return tourHref(id, {
    shopId: SHOP_ID,
    scenarioId: SCENARIO_ID,
    experimentId: EXPERIMENT_ID,
  });
}

/** The bar's one mount, standing at a location. */
function launch(at: string) {
  return render(
    <MemoryRouter initialEntries={[at]}>
      <TourLaunch />
    </MemoryRouter>,
  );
}

/**
 * Let every queued microtask run and React flush what they produced.
 *
 * The assertions below are about what the control does *not* do after its first frame — no
 * request, no second render that takes it away — so they have to be made after the frame where
 * an effect would have had its chance.
 */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("the launch control", () => {
  it("offers each surface's own tour at that surface's own address", async () => {
    for (const id of TOUR_IDS) {
      const mounted = launch(surfaceHref(id));
      const control = await screen.findByRole("button", {
        name: `Show me around ${TOURS[id].surface}`,
      });
      expect(control, id).toBeVisible();
      // The visible words are the same on every surface; what differs is what it says it walks.
      expect(control).toHaveTextContent("Show me around");
      // And it is still there after the frame where an effect would have had its chance to take
      // it away, which is how the gated build behaved: present, then gone once a read came back.
      await settle();
      expect(screen.getByRole("button", { name: /Show me around/ }), id).toBeVisible();
      mounted.unmount();
    }
  });

  it("treats the comparison's three tabs as the one surface they are", () => {
    // The tabs are one layout, on screen whichever tab is open — so all three addresses offer
    // the one walk, each walking the steps in scope there (the case below).
    const results = surfaceHref("results");
    for (const at of [results, `${results}/timeline`, `${results}/traces`]) {
      const mounted = launch(at);
      expect(
        screen.getByRole("button", { name: `Show me around ${TOURS.results.surface}` }),
        at,
      ).toBeVisible();
      mounted.unmount();
    }
  });

  it("walks a tab of the comparison only the steps on that tab", async () => {
    // The provenance card, the evidence and the notes are the General tab's; on the timeline
    // the walk is the layout's two steps, never a popover lighting nothing (ADR 0055, amended).
    // The tour reads `prefers-reduced-motion` when it starts, which jsdom does not answer.
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const results = surfaceHref("results");
    for (const [at, total] of [
      [`${results}/timeline`, 2],
      [results, 6],
    ] as const) {
      const mounted = launch(at);
      await act(async () => {
        screen.getByRole("button", { name: `Show me around ${TOURS.results.surface}` }).click();
      });
      expect(document.querySelector(".driver-popover-progress-text"), at).toHaveTextContent(
        `1 of ${total}`,
      );
      await act(async () => {
        mounted.unmount();
      });
    }
  });

  it("offers the ticket index its tour", () => {
    // The index is where its reader stands: it opens no ticket on their behalf (ADR 0073).
    launch(`/shops/${SHOP_ID}/tickets`);
    expect(
      screen.getByRole("button", { name: `Show me around ${TOURS.tickets.surface}` }),
    ).toBeVisible();
  });

  it("draws nothing where the route names no tour", async () => {
    // The product editor is a child of the catalog's route and a different screen. A rule that
    // matched by prefix would offer the catalog's walk here, whose anchors are not on it.
    for (const at of [
      `/shops/${SHOP_ID}/products/alpine-shell`,
      `/shops/${SHOP_ID}/customers/someone`,
      // A ticket is an editor, and its create page is a surface of its own (ADR 0073).
      `/shops/${SHOP_ID}/tickets/T-204`,
      `/shops/${SHOP_ID}/tickets/new`,
      "/lab/agent-configurations/config-1",
      "/lab/history",
      "/settings",
      "/shops",
    ]) {
      const mounted = launch(at);
      await settle();
      expect(screen.queryByRole("button", { name: /Show me around/ }), at).toBeNull();
      mounted.unmount();
    }
  });

  it("reads nothing at all to decide whether to appear", async () => {
    const requested: string[] = [];
    server.events.on("request:start", ({ request }) => requested.push(request.url));

    launch(surfaceHref("bench"));
    await settle();

    // The control is there on the first frame and stays, because nothing is consulted. A build
    // that spent a request to decide whether to draw a button fails here.
    expect(screen.getByRole("button", { name: /Show me around/ })).toBeVisible();
    expect(requested).toEqual([]);
  });

  it("is there whatever a browser has left in storage from an older build", async () => {
    // Browsers that used the gated build still hold this key. Nothing reads it any more, and
    // the control must not be reachable through it in either direction (ADR 0046).
    window.localStorage.setItem("agent-lab.guide-mode", "off");

    launch(surfaceHref("scenario"));
    await settle();

    expect(screen.getByRole("button", { name: /Show me around/ })).toBeVisible();
  });

  it("performs nothing itself: the tour points at the page and the reader acts on it", async () => {
    launch(surfaceHref("shop-home"));
    await settle();

    // One control, and it opens a tour. ADR 0043's refusal reaches here too: nothing the guide
    // offers populates, resets or reseeds a lab.
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(
      screen.queryByRole("button", { name: /seed|demo data|populate|load sample|reset|wipe/i }),
    ).toBeNull();
  });
});
