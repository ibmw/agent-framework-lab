import { act, render, screen } from "@testing-library/react";
import { setupServer } from "msw/node";
import { MemoryRouter } from "react-router-dom";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { TourLaunch } from "./components/TourLaunch";
import { TOUR_IDS, TOURS } from "./lib/tours";

/**
 * The control that offers a tour of the screen you are standing on.
 *
 * It is unconditional, which is the whole of ADR 0046: it was gated by guide mode until a lab
 * filled by `make seed` derived that mode off and hid the offer from the reader who had not
 * found it yet. A control that does nothing until it is pressed has nothing to opt out of, so
 * there is no mode, no stored preference and — asserted below — no reading either.
 */

// Deliberately without handlers. Every request this suite could make is therefore unhandled,
// and unhandled is an error, so a control that started reading something again fails here
// rather than passing quietly against a handler somebody added to keep it green.
const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.events.removeAllListeners();
  server.resetHandlers();
  window.localStorage.clear();
});
afterAll(() => server.close());

function launch(id: keyof typeof TOURS) {
  return render(
    <MemoryRouter>
      <TourLaunch id={id} />
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
  it("is offered on every surface that declares a tour, and names the one it would walk", async () => {
    for (const id of TOUR_IDS) {
      const mounted = launch(id);
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

  it("reads nothing at all to decide whether to appear", async () => {
    const requested: string[] = [];
    server.events.on("request:start", ({ request }) => requested.push(request.url));

    launch("bench");
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

    launch("scenario");
    await settle();

    expect(screen.getByRole("button", { name: /Show me around/ })).toBeVisible();
  });

  it("performs nothing itself: the tour points at the page and the reader acts on it", async () => {
    launch("shop-home");
    await settle();

    // One control, and it opens a tour. ADR 0043's refusal reaches here too: nothing the guide
    // offers populates, resets or reseeds a lab.
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(
      screen.queryByRole("button", { name: /seed|demo data|populate|load sample|reset|wipe/i }),
    ).toBeNull();
  });
});
