import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { MemoryRouter } from "react-router-dom";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { App } from "./App";
import { TourLaunch } from "./components/TourLaunch";
import { TOURS } from "./lib/tours";

/**
 * Guide mode, and the one thing it now decides: whether a surface offers to show you around.
 *
 * The mode itself is unchanged — derived on while the lab holds no completed comparison, off
 * once it holds one, with only a disagreement stored (ADR 0044). What it gates is the launch
 * control rather than a band that appears unbidden, and an operator who disagrees is asserted
 * to cost the application no request at all (ADR 0045).
 */

let completedExperiments = 0;

const server = setupServer(
  http.get("*/api/v1/experiments", ({ request }) =>
    HttpResponse.json({
      experiments: [],
      page: 1,
      page_size: 1,
      total:
        new URL(request.url).searchParams.get("status") === "completed" ? completedExperiments : 0,
      shops: [],
      scenarios: [],
      frameworks: [],
      tags: [],
    }),
  ),
  http.get("*/api/v1/shops", () => HttpResponse.json({ shops: [] })),
  // `/settings` is mounted below, and a page read in its error state would assert nothing about
  // the control it is mounted for.
  http.get("*/api/v1/lab-status", () =>
    HttpResponse.json({
      run_mode: "offline",
      model_id: "gpt-5-mini",
      trace_export_configured: false,
    }),
  ),
  http.get("*/api/v1/agent-configurations/resources", () =>
    HttpResponse.json({
      frameworks: [],
      tools: [],
      variables: [],
      support_identities: [],
      preview_shops: [],
    }),
  ),
);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.events.removeAllListeners();
  server.resetHandlers();
  window.localStorage.clear();
  completedExperiments = 0;
});
afterAll(() => server.close());

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

function launch(id: keyof typeof TOURS) {
  return render(
    <MemoryRouter>
      <TourLaunch id={id} />
    </MemoryRouter>,
  );
}

/** Resolved once the reading that decides guide mode has come back from the server. */
function guideModeAnswered(): Promise<void> {
  return new Promise((resolve) => {
    server.events.on("response:mocked", ({ request }) => {
      if (request.url.includes("status=completed")) {
        resolve();
      }
    });
  });
}

/**
 * Let every queued microtask run and React flush what they produced.
 *
 * The control starts hidden and is shown by a promise chain, so "there is no control" is true
 * of the first frame of every render. Without this the negative assertions below would hold
 * against an implementation that ignored the stored override or the record entirely.
 */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("the launch control", () => {
  it("is offered while guide mode is on, and names the surface it would walk", async () => {
    const answered = guideModeAnswered();
    launch("snapshots");
    await answered;

    const control = await screen.findByRole("button", {
      name: `Show me around ${TOURS.snapshots.surface}`,
    });
    expect(control).toBeVisible();
    // The visible words are the same on every surface; what differs is what it says it walks.
    expect(control).toHaveTextContent("Show me around");
  });

  it("is absent once an operator has turned the guide off, and reads nothing to find out", async () => {
    const requested: string[] = [];
    server.events.on("request:start", ({ request }) => requested.push(request.url));
    window.localStorage.setItem("agent-lab.guide-mode", "off");

    launch("bench");
    await settle();

    expect(screen.queryByRole("button", { name: /Show me around/ })).toBeNull();
    // A stored disagreement answers on its own. An implementation that read the record anyway
    // would fail here even though the control is correctly absent.
    expect(requested).toEqual([]);
  });

  it("is absent once the lab holds a completed comparison and nobody disagreed", async () => {
    completedExperiments = 1;
    const answered = guideModeAnswered();

    launch("results");
    await answered;
    await settle();
    expect(screen.queryByRole("button", { name: /Show me around/ })).toBeNull();

    // And the same component shows the control when the record reads the other way, so the
    // absence above is the reading rather than a control that never renders.
    completedExperiments = 0;
    const again = guideModeAnswered();
    launch("results");
    await again;
    expect(await screen.findByRole("button", { name: /Show me around/ })).toBeVisible();
  });

  it("performs nothing itself: the tour points at the page and the reader acts on it", async () => {
    const answered = guideModeAnswered();
    launch("shop-home");
    await answered;
    await settle();

    // One control, and it opens a tour. ADR 0043's refusal reaches here too: nothing the guide
    // offers populates, resets or reseeds a lab.
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(
      screen.queryByRole("button", { name: /seed|demo data|populate|load sample|reset|wipe/i }),
    ).toBeNull();
  });
});

describe("guide mode", () => {
  it("offers the same three choices on the settings page", async () => {
    renderAt("/settings");

    const workspace = await screen.findByRole("region", { name: "Workspace" });
    expect(within(workspace).getByRole("radio", { name: /Follow the lab/ })).toBeChecked();
    expect(within(workspace).getByRole("radio", { name: /Always on/ })).not.toBeChecked();
    expect(within(workspace).getByRole("radio", { name: /Always off/ })).not.toBeChecked();
    expect(within(workspace).getByText(/Nothing is stored/)).toBeVisible();
  });

  it("remembers a disagreement with the default in either direction", async () => {
    const off = renderAt("/settings");
    await userEvent.click(await screen.findByRole("radio", { name: /Always off/ }));
    off.unmount();

    // Stored, so the empty lab the control would otherwise appear in does not bring it back.
    const hidden = launch("scenario");
    await settle();
    expect(screen.queryByRole("button", { name: /Show me around/ })).toBeNull();
    hidden.unmount();

    // And the opposite disagreement wins over a lab that has completed a comparison.
    completedExperiments = 1;
    const on = renderAt("/settings");
    await userEvent.click(await screen.findByRole("radio", { name: /Always on/ }));
    on.unmount();

    launch("scenario");
    expect(await screen.findByRole("button", { name: /Show me around/ })).toBeVisible();
  });
});

describe("the glossary", () => {
  it("defines the words the application uses on screen", async () => {
    renderAt("/guides/glossary");

    expect(await screen.findByRole("heading", { name: "Glossary" })).toBeVisible();
    const terms = screen.getByRole("region", { name: "Vocabulary" });
    expect(within(terms).getByText("Objective block")).toBeVisible();
    expect(
      within(terms).getByText(/shop-independent objective template/, { exact: false }),
    ).toBeVisible();
    expect(within(terms).getByText("Sandbox snapshot")).toBeVisible();
  });

  it("is reachable from the guides page", async () => {
    renderAt("/guides");

    expect(await screen.findByRole("link", { name: "Open the glossary" })).toHaveAttribute(
      "href",
      "/guides/glossary",
    );
  });
});
