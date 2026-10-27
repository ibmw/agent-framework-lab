import type { ShopSummarySchema } from "@agent-lab/contracts";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, Outlet, RouterProvider } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { stubViewport } from "../test/viewport";
import { AppShell, type RailCounts } from "./AppShell";

/**
 * The navigation rail, measured.
 *
 * The rail's behaviour — which destinations it lists, that it collapses, that the choice is
 * remembered — is covered in the browser by `tests/e2e/workspace-shell.spec.ts`. What that
 * cannot see is the handoff's arithmetic, and the arithmetic is the part that regresses in
 * silence: a width, a row height and a glyph size are wrong for weeks before anyone says so.
 * So these assertions read the numbers from `tmp/design-frames/README.md`, *Navigation rail*,
 * and the copy from the prototype's own foot control.
 *
 * They deliberately also hold the names down. `nav[aria-label="Shop workspace"]` is a tour
 * anchor and the handle every Playwright journey clicks through. The foot control's name, its
 * visible copy and its tooltip are one string — "Collapse menu" / "Expand menu" — because
 * collapsed it has no visible text at all, and expanded a name that differed from the face of
 * it is exactly the mismatch a voice-control reader falls into.
 *
 * Both rails are held here, entry by entry and in order, because the two modes are the shape of
 * the whole workspace (ADR 0054) and a destination quietly dropped from either is a screen only
 * a bookmark reaches.
 */

const SHOP_ID = "3f4a3b2c-1d0e-4f5a-8b7c-6d5e4f3a2b1c";
const OTHER_SHOP_ID = "8a7b6c5d-4e3f-4a2b-9c8d-7e6f5a4b3c2d";

const SHOPS: ShopSummarySchema[] = [
  {
    shop_id: SHOP_ID,
    name: "Northstar Outfitters",
    slug: "northstar",
    updated_at: "2026-09-19T09:00:00+00:00",
    latest_published_version: null,
    published_version_count: 0,
    logo: null,
  },
  {
    shop_id: OTHER_SHOP_ID,
    name: "Alpenglow Supply",
    slug: "alpenglow",
    updated_at: "2026-09-18T09:00:00+00:00",
    latest_published_version: 3,
    published_version_count: 3,
    logo: null,
  },
];

/**
 * The shell in one of its three states: a shop, the lab, or — with no mode — a frameless
 * lab-level surface, where there is no rail at all.
 *
 * The router is real rather than a stub, because three of the bar's controls move: the
 * switcher navigates in shop mode, *All shops* navigates from either, and the Settings toggle
 * returns to a location the shell recorded. What each one did is read off `router.state`.
 */
function renderShell(
  mode?: "shop" | "lab",
  {
    at,
    onShopChange,
    shops = SHOPS,
    counts,
  }: {
    at?: string;
    onShopChange?: (shopId: string) => void;
    shops?: ShopSummarySchema[];
    counts?: RailCounts;
  } = {},
) {
  const router = createMemoryRouter(
    [
      {
        path: "*",
        element: (
          <AppShell
            shops={shops}
            currentShopId={mode === undefined ? undefined : SHOP_ID}
            mode={mode}
            onShopChange={onShopChange}
            counts={counts}
          >
            <h1>Home</h1>
          </AppShell>
        ),
      },
    ],
    { initialEntries: [at ?? (mode === "lab" ? "/lab/bench" : `/shops/${SHOP_ID}`)] },
  );
  return { router, ...render(<RouterProvider router={router} />) };
}

/**
 * The shop's shell as the application mounts it: a layout route around the pages, so the shell
 * stays mounted while the route under it changes, and each page is a route of its own.
 */
function renderRoutedShell(at: string) {
  const router = createMemoryRouter(
    [
      {
        path: "/shops/:shopId",
        element: (
          <AppShell shops={SHOPS} currentShopId={SHOP_ID} mode="shop">
            <Outlet />
          </AppShell>
        ),
        children: [
          { index: true, id: "overview", element: <h1>Overview</h1> },
          { path: "orders", id: "orders", element: <h1>Orders</h1> },
          { path: "products/:handle", id: "product", element: <h1>Product</h1> },
        ],
      },
    ],
    { initialEntries: [at] },
  );
  return { router, ...render(<RouterProvider router={router} />) };
}

/** The bar's switcher, which is a button and not a select (ADR 0055). */
function switcher() {
  return screen.getByRole("button", { name: /^Switch shop/ });
}

function rail(name = "Shop workspace") {
  return screen.getByRole("navigation", { name });
}

function toggle() {
  return screen.getByRole("button", { name: /^(Collapse|Expand) menu$/ });
}

afterEach(() => {
  window.localStorage.clear();
  // A case that stubs the viewport never leaks it into the next one, even when it fails.
  vi.unstubAllGlobals();
});

describe("the navigation rail's metrics", () => {
  it("is a 216px column expanded and a 52px strip collapsed", async () => {
    renderShell("shop");

    expect(rail().className).toContain("w-[216px]");
    expect(rail().className).not.toContain("w-[52px]");

    await userEvent.click(toggle());

    expect(rail().className).toContain("w-[52px]");
    expect(rail().className).not.toContain("w-[216px]");
  });

  it("draws the glyph at 17px expanded and 19px collapsed, in a 36px row", async () => {
    renderShell("shop");

    const expanded = within(rail()).getByRole("link", { name: "Products" });
    expect(expanded.querySelector("svg")).toHaveAttribute("width", "17");
    expect(expanded.className).not.toContain("h-9");

    await userEvent.click(toggle());

    const collapsed = within(rail()).getByRole("link", { name: "Products" });
    expect(collapsed.querySelector("svg")).toHaveAttribute("width", "19");
    // 52px less the strip's two 8px gutters is 36px, which is also the row's height.
    expect(collapsed.className).toContain("h-9");
  });

  it("dims an expanded glyph that is not the row you are standing on", () => {
    renderShell("shop");

    const here = within(rail()).getByRole("link", { name: "Overview" });
    const elsewhere = within(rail()).getByRole("link", { name: "Products" });

    // `NavLink` marks the current row, and the dimming keys off that rather than off state.
    expect(here).toHaveAttribute("aria-current", "page");
    expect(elsewhere).not.toHaveAttribute("aria-current");
    expect(elsewhere.className).toContain("[&:not([aria-current])>svg]:opacity-75");
  });

  it("inks the row you are standing on in the selected-ink token, and no other row", () => {
    renderShell("shop");

    const here = within(rail()).getByRole("link", { name: "Overview" });
    const elsewhere = within(rail()).getByRole("link", { name: "Products" });

    expect(here.className.split(" ")).toContain("text-admin-selected-ink");
    expect(here.className).not.toContain("#14352e");
    expect(elsewhere.className.split(" ")).not.toContain("text-admin-selected-ink");
  });

  it("lifts an inactive row to admin-muted at 650 once it is a glyph on its own", async () => {
    renderShell("shop");

    const expanded = within(rail()).getByRole("link", { name: "Products" });
    expect(expanded.className).toContain("text-admin-ink-soft");

    await userEvent.click(toggle());

    const collapsed = within(rail()).getByRole("link", { name: "Products" });
    expect(collapsed.className).toContain("text-admin-muted");
    expect(collapsed.className).toContain("font-[650]");
    // The wash and the ink it hovers to are the same in both states.
    expect(collapsed.className).toContain("hover:bg-[#eceef0]");
    expect(collapsed.className).toContain("hover:text-admin-ink");
  });

  it("sets section headings in 0.07em and turns them into rules when collapsed", async () => {
    renderShell("shop");

    const heading = within(rail()).getByText("Shop setup");
    expect(heading.className).toContain("tracking-[0.07em]");
    expect(heading.className).toContain("text-[#8c9196]");

    await userEvent.click(toggle());

    expect(within(rail()).queryByText("Shop setup")).not.toBeInTheDocument();
    expect(rail().querySelectorAll("div.h-px")).toHaveLength(1);
  });
});

describe("the rail's collapse control", () => {
  it("says the same thing to a reader, to an eye and to a pointer", async () => {
    renderShell("shop");

    expect(toggle()).toHaveAccessibleName("Collapse menu");
    expect(toggle()).toHaveTextContent("Collapse menu");
    expect(toggle()).toHaveAttribute("title", "Collapse menu");
    expect(toggle()).toHaveAttribute("aria-expanded", "true");

    await userEvent.click(toggle());

    // Collapsed there is no visible text, and the name is the whole of what anyone has.
    expect(toggle()).toHaveAccessibleName("Expand menu");
    expect(toggle().textContent).toBe("");
    expect(toggle()).toHaveAttribute("title", "Expand menu");
    expect(toggle()).toHaveAttribute("aria-expanded", "false");
  });

  it("writes the choice to the browser preference and reads it back on the next visit", async () => {
    const first = renderShell("shop");

    expect(window.localStorage.getItem("agent-lab.navigation-collapsed")).toBeNull();

    await userEvent.click(toggle());
    expect(window.localStorage.getItem("agent-lab.navigation-collapsed")).toBe("true");

    first.unmount();
    renderShell("shop");

    // Arriving again finds the rail as it was left, without anything having navigated.
    expect(rail().className).toContain("w-[52px]");
    expect(toggle()).toHaveAccessibleName("Expand menu");
  });
});

/**
 * The width, and only the width, folds the rail (ADR 0079). Below the narrow breakpoint the rail
 * is the strip whatever this browser remembers, and nothing done at that width writes the
 * preference: a phone did not choose it, so a phone does not change it.
 */
describe("the rail at a phone's width", () => {
  const KEY = "agent-lab.navigation-collapsed";

  function expectStrip() {
    expect(rail().className).toContain("w-[52px]");
    expect(rail().className).not.toContain("w-[216px]");
    expect(toggle()).toHaveAccessibleName("Expand menu");
    expect(toggle()).toHaveAttribute("aria-expanded", "false");
  }

  function expectColumn() {
    expect(rail().className).toContain("w-[216px]");
    expect(rail().className).not.toContain("w-[52px]");
    expect(toggle()).toHaveAccessibleName("Collapse menu");
    expect(toggle()).toHaveAttribute("aria-expanded", "true");
  }

  it.each([
    ["nothing remembered", null],
    ["expanded remembered", "false"],
    ["collapsed remembered", "true"],
  ])("draws the strip with %s, and leaves the preference as it was", (_case, stored) => {
    if (stored !== null) {
      window.localStorage.setItem(KEY, stored);
    }
    stubViewport("narrow");
    renderShell("shop");

    expectStrip();
    expect(window.localStorage.getItem(KEY)).toBe(stored);
  });

  it("folds the lab's rail too, since it is one preference for both", () => {
    window.localStorage.setItem(KEY, "false");
    stubViewport("narrow");
    renderShell("lab");

    expect(rail("Experiment lab workspace").className).toContain("w-[52px]");
  });

  it.each([
    ["nothing remembered", null],
    ["expanded remembered", "false"],
    ["collapsed remembered", "true"],
  ])("opens the column when expanded, with %s, and writes nothing", async (_case, stored) => {
    if (stored !== null) {
      window.localStorage.setItem(KEY, stored);
    }
    stubViewport("narrow");
    renderShell("shop");

    await userEvent.click(toggle());
    expectColumn();
    expect(window.localStorage.getItem(KEY)).toBe(stored);

    await userEvent.click(toggle());
    expectStrip();
    expect(window.localStorage.getItem(KEY)).toBe(stored);
  });

  it.each([
    ["nothing remembered", null],
    ["expanded remembered", "false"],
    ["collapsed remembered", "true"],
  ])(
    "folds an opening once the operator has gone somewhere, with %s, and writes nothing",
    async (_case, stored) => {
      if (stored !== null) {
        window.localStorage.setItem(KEY, stored);
      }
      stubViewport("narrow");
      const { router } = renderShell("shop");
      await userEvent.click(toggle());
      expectColumn();

      await act(() => router.navigate(`/shops/${SHOP_ID}/orders`));

      expectStrip();
      expect(window.localStorage.getItem(KEY)).toBe(stored);
    },
  );

  it("folds an opening on a step back through history to another page", async () => {
    stubViewport("narrow");
    const { router } = renderShell("shop");
    await act(() => router.navigate(`/shops/${SHOP_ID}/orders`));
    await userEvent.click(toggle());
    expectColumn();

    await act(() => router.navigate(-1));

    expect(router.state.location.pathname).toBe(`/shops/${SHOP_ID}`);
    expectStrip();
  });

  it("keeps an opening on the same page: a query, a fragment, or the page moving its own address", async () => {
    stubViewport("narrow");
    const { router } = renderShell("shop", { at: `/shops/${SHOP_ID}/products/alpine` });
    await userEvent.click(toggle());
    expectColumn();

    await act(() => router.navigate(`/shops/${SHOP_ID}/products/alpine?attempt=2`));
    expectColumn();
    await act(() => router.navigate(`/shops/${SHOP_ID}/products/alpine?attempt=2#event-3`));
    expectColumn();
    // A replace is the page re-addressing itself — a product's handle following its title.
    await act(() => router.navigate(`/shops/${SHOP_ID}/products/alpine-shell`, { replace: true }));
    expectColumn();
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it("folds an opening on a replace that lands on another page, as a removal landing on its index does", async () => {
    stubViewport("narrow");
    const { router } = renderRoutedShell(`/shops/${SHOP_ID}/products/alpine`);
    await userEvent.click(toggle());
    expectColumn();

    await act(() => router.navigate(`/shops/${SHOP_ID}/orders`, { replace: true }));

    expect(screen.getByRole("heading", { name: "Orders" })).toBeVisible();
    expectStrip();
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it("keeps an opening on a replace that stays on its page, as a product's handle following its title does", async () => {
    stubViewport("narrow");
    const { router } = renderRoutedShell(`/shops/${SHOP_ID}/products/alpine`);
    await userEvent.click(toggle());
    expectColumn();

    await act(() => router.navigate(`/shops/${SHOP_ID}/products/alpine-shell`, { replace: true }));

    expect(router.state.location.pathname).toBe(`/shops/${SHOP_ID}/products/alpine-shell`);
    expectColumn();
  });

  it("leaves a wide rail as the author left it across a navigation", async () => {
    window.localStorage.setItem(KEY, "false");
    stubViewport("wide");
    const { router } = renderShell("shop");

    await act(() => router.navigate(`/shops/${SHOP_ID}/orders`));

    expectColumn();
  });

  it("gives back the remembered column when the viewport widens", () => {
    window.localStorage.setItem(KEY, "false");
    const viewport = stubViewport("narrow");
    renderShell("shop");
    expectStrip();

    viewport.resize("wide");

    expectColumn();
    expect(window.localStorage.getItem(KEY)).toBe("false");
  });

  it("gives back the remembered strip when the viewport widens, whatever was opened narrow", async () => {
    window.localStorage.setItem(KEY, "true");
    const viewport = stubViewport("narrow");
    renderShell("shop");
    await userEvent.click(toggle());
    expectColumn();

    viewport.resize("wide");

    expectStrip();
    expect(window.localStorage.getItem(KEY)).toBe("true");
  });

  it("forgets what was opened narrow once the viewport has been wide", async () => {
    const viewport = stubViewport("narrow");
    renderShell("shop");
    await userEvent.click(toggle());
    expectColumn();

    viewport.resize("wide");
    viewport.resize("narrow");

    expectStrip();
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it("folds a remembered column when a wide viewport narrows, and still writes nothing", () => {
    window.localStorage.setItem(KEY, "false");
    const viewport = stubViewport("wide");
    renderShell("shop");
    expectColumn();

    viewport.resize("narrow");

    expectStrip();
    expect(window.localStorage.getItem(KEY)).toBe("false");
  });

  it("is still the author's control on a wide viewport, which writes the choice", async () => {
    stubViewport("wide");
    renderShell("shop");

    await userEvent.click(toggle());

    expectStrip();
    expect(window.localStorage.getItem(KEY)).toBe("true");
  });
});

/**
 * Below the narrow breakpoint the bar's three groups wrap onto rows of their own rather than run
 * off the edge, where a phone has nothing to scroll them back with (ADR 0079). jsdom draws no
 * rows, so the classes that make them are read, and the reach is read as the keyboard's: every
 * control the bar draws is still in it, in order.
 */
describe("the top bar at a phone's width", () => {
  function bar() {
    return screen.getByRole("navigation", { name: "Workspace mode" }).closest("header");
  }

  it("wraps its groups below the breakpoint and keeps its 56px above it", () => {
    renderShell("shop");
    const header = bar();

    expect(header).not.toBeNull();
    const classes = header?.className.split(" ") ?? [];
    // The wide bar is the README's 56px on one line, unchanged.
    expect(classes).toContain("h-14");
    expect(classes).not.toContain("flex-wrap");
    // Narrow, it grows to what its rows hold and wraps them.
    expect(classes).toEqual(
      expect.arrayContaining(["narrow:h-auto", "narrow:min-h-14", "narrow:flex-wrap"]),
    );
    // A wrapped tab row and a wrapped control row each keep a press-sized height.
    expect(screen.getByRole("navigation", { name: "Workspace mode" }).className).toContain(
      "narrow:min-h-11",
    );
    const controls = screen.getByRole("link", { name: "Settings" }).parentElement;
    expect(controls?.className).toContain("narrow:min-h-11");
    // The switcher's divider separates it from the tabs beside it; on a row of its own it would
    // stand mid-row with nothing after it, so it is dropped below the breakpoint.
    const identity = switcher().parentElement;
    expect(identity?.className.split(" ")).toEqual(
      expect.arrayContaining(["border-r", "narrow:border-r-0"]),
    );
  });

  it("cuts a shop name too long for the bar's row with an ellipsis, and still names it in full", () => {
    const long = "Northstar Outfitters of the Far Northern Fjords and the Islands Beyond";
    renderShell("shop", { shops: [{ ...SHOPS[0], name: long }, SHOPS[1]] });

    expect(switcher()).toHaveAccessibleName(`Switch shop, current: ${long}`);
    const name = within(switcher()).getByText(long);
    // The whole name for a pointer, too, where the row cut it.
    expect(name).toHaveAttribute("title", long);
    expect(name).toHaveClass("truncate", "min-w-0");
    // A flex item does not shrink below its content unless every box down to the name lets it:
    // the switcher's group in the bar, and the button inside it.
    expect(switcher()).toHaveClass("min-w-0");
    expect(switcher().parentElement).toHaveClass("min-w-0");
  });

  it("keeps every control in the keyboard's reach, in order, at a phone's width", async () => {
    stubViewport("narrow");
    renderShell("shop");

    const reached: string[] = [];
    for (let press = 0; press < 5; press += 1) {
      await userEvent.tab();
      reached.push(document.activeElement?.textContent?.trim() ?? "");
    }

    expect(reached).toEqual([
      expect.stringContaining("Northstar Outfitters"),
      "Shop fixture",
      "Experiment lab",
      "Show me around",
      "Settings",
    ]);
  });
});

describe("the collapsed strip", () => {
  it("still names every destination it draws", async () => {
    renderShell("shop");

    const expanded = within(rail())
      .getAllByRole("link")
      .map((link) => link.textContent);

    await userEvent.click(toggle());

    const collapsed = within(rail()).getAllByRole("link");
    expect(collapsed.map((link) => link.textContent)).toEqual(expanded);
    for (const link of collapsed) {
      expect(link).toHaveAccessibleName();
      expect(link.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    }
  });

  it("still names every destination the lab draws, too", async () => {
    renderShell("lab");

    const expanded = within(rail("Experiment lab workspace"))
      .getAllByRole("link")
      .map((link) => link.textContent);

    await userEvent.click(toggle());

    const collapsed = within(rail("Experiment lab workspace")).getAllByRole("link");
    expect(collapsed.map((link) => link.textContent)).toEqual(expanded);
    for (const link of collapsed) {
      expect(link).toHaveAccessibleName();
    }
  });

  it("is not drawn at all outside a mode", () => {
    renderShell();

    expect(screen.queryByRole("navigation", { name: "Shop workspace" })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("navigation", { name: "Experiment lab workspace" }),
    ).not.toBeInTheDocument();
  });
});

describe("the two rails", () => {
  /** The prototype's own order, `Workspace.dc.html` :4753 and :4822. */
  const SHOP_RAIL = [
    "Overview",
    "Products",
    "Orders",
    "Customers",
    "Tickets",
    "Scenarios",
    "Policies & FAQ",
    "Support identities",
    "Tone of voice",
    "Shop details",
  ];

  const LAB_RAIL = [
    "Bench",
    "History",
    "Agent configs",
    "Judges",
    "Support identities",
    "Objective blocks",
    "Mutation blocks",
  ];

  it("draws the shop's ten entries, in the prototype's order, under one heading", () => {
    renderShell("shop");

    const entries = within(rail()).getAllByRole("link");
    expect(entries.map((entry) => entry.textContent)).toEqual(SHOP_RAIL);
    expect(within(rail()).getByText("Shop setup")).toBeInTheDocument();
    // The cross-shop section is the lab's rail now, and nothing announces itself as being in
    // the wrong rail any more.
    expect(within(rail()).queryByText(/cross-shop/i)).not.toBeInTheDocument();
  });

  it("sends the shop's Support identities to the one library there is", () => {
    renderShell("shop");

    expect(within(rail()).getByRole("link", { name: "Support identities" })).toHaveAttribute(
      "href",
      "/lab/support-identities",
    );
  });

  it("draws the lab's seven entries under Library, and none of them carries a shop", () => {
    renderShell("lab");

    const lab = rail("Experiment lab workspace");
    const entries = within(lab).getAllByRole("link");
    expect(entries.map((entry) => entry.textContent)).toEqual(LAB_RAIL);
    expect(within(lab).getByText("Library")).toBeInTheDocument();
    for (const entry of entries) {
      expect(entry.getAttribute("href")).toMatch(/^\/lab\//);
    }
    // One rail at a time: the mode is the branch of the tree, not a second thing to be in.
    expect(screen.queryByRole("navigation", { name: "Shop workspace" })).not.toBeInTheDocument();
  });

  it("keeps the bench lit on its own screen and not on a run started from it", () => {
    renderShell("lab", { at: `/lab/bench/${SHOP_ID}/e1` });

    const lab = rail("Experiment lab workspace");
    expect(within(lab).getByRole("link", { name: "Bench" })).not.toHaveAttribute("aria-current");
  });
});

describe("the counts on a rail entry", () => {
  /**
   * The figure beside each label (`Workspace.dc.html` :110, :113; the README's *Navigation
   * rail*), under the rule the chip row already observes: the count is of the whole list, a
   * listing in flight or failed shows none, zero is real and is drawn, and a figure the
   * payload lacks is never faked (`docs/design-direction.md`, *Lists and counts*).
   *
   * How it reaches a reader is ADR 0056: the row is *named* by its label alone — the handle
   * eleven Playwright specs and every tour anchor use — and the figure is its **description**,
   * spelled out with what it counts. So the digits are the eye's and the phrase is the ear's,
   * and neither is the name.
   */
  function entry(label: string, railName?: string) {
    return within(rail(railName)).getByRole("link", { name: label });
  }

  it("draws each listing's figure beside its label, right-aligned and muted", () => {
    renderShell("shop", { counts: { orders: 12, tickets: 4 } });

    const orders = entry("Orders");
    const figure = within(orders).getByText("12");
    expect(figure).toBeVisible();
    // The digits are the eye's alone; the phrase a reader hears is the row's description,
    // outside the link, so the figure is never spoken twice.
    expect(figure).toHaveAttribute("aria-hidden", "true");
    expect(figure.className).toContain("ml-auto");
    expect(figure.className).toContain("text-[12px]");
    // Muted on a row you are not standing on; on the active row the count takes the row's
    // own ink, which is the prototype's two colours.
    expect(figure.className).toContain("text-admin-muted");
    expect(within(entry("Tickets")).getByText("4")).toBeVisible();
  });

  it("takes the active row's ink on the row you are standing on", () => {
    renderShell("shop", { at: `/shops/${SHOP_ID}/orders`, counts: { orders: 12 } });

    const figure = within(entry("Orders")).getByText("12");
    expect(entry("Orders")).toHaveAttribute("aria-current", "page");
    expect(figure.className).not.toContain("text-admin-muted");
  });

  it("draws a zero, because zero is a count", () => {
    renderShell("shop", { counts: { scenarios: 0 } });

    expect(within(entry("Scenarios")).getByText("0")).toBeVisible();
    expect(entry("Scenarios")).toHaveAccessibleDescription("0 scenarios");
  });

  it("draws nothing at all while the listing is in flight or has failed", () => {
    renderShell("shop", { counts: { orders: null, customers: undefined } });

    for (const label of ["Orders", "Customers"]) {
      const row = entry(label);
      expect(row).toHaveTextContent(new RegExp(`^${label}$`));
      expect(row).not.toHaveAccessibleDescription();
    }
  });

  it("carries no figure on the shop entries that list nothing", () => {
    renderShell("shop", { counts: { orders: 12 } });

    expect(entry("Overview")).toHaveTextContent(/^Overview$/);
    expect(entry("Shop details")).toHaveTextContent(/^Shop details$/);
  });

  it("carries none on the bench either", () => {
    // The prototype draws "1 live" there. It is a tally of running arms in one shop rather
    // than the length of anything this shell reads, and a figure the payload lacks is not
    // faked (`docs/design-direction.md`).
    renderShell("lab", { counts: { history: 7 } });

    expect(entry("Bench", "Experiment lab workspace")).toHaveTextContent(/^Bench$/);
  });

  it("keeps the accessible name the label alone, and says the figure as a description", () => {
    renderShell("shop", { counts: { orders: 12, tickets: 1, supportIdentities: 3 } });

    expect(entry("Orders")).toHaveAccessibleName("Orders");
    expect(entry("Orders")).toHaveAccessibleDescription("12 orders");
    // One of a thing is one of a thing.
    expect(entry("Tickets")).toHaveAccessibleDescription("1 ticket");
    expect(entry("Support identities")).toHaveAccessibleDescription("3 support identities");
  });

  it("says the figure once: the digits are drawn, the phrase is the description", () => {
    // A screen reader in browse mode reads a link's own contents as well as its description.
    // The phrase therefore lives outside the link, so nobody hears "Orders, 12 orders, 12
    // orders" (ADR 0056).
    renderShell("shop", { counts: { orders: 12 } });

    const row = entry("Orders");
    expect(row).toHaveTextContent(/^Orders12$/);
    expect(row.textContent).not.toContain("12 orders");
    expect(row).toHaveAccessibleDescription("12 orders");
  });

  it("counts every listing the lab's rail points at", () => {
    renderShell("lab", {
      counts: {
        history: 7,
        agentConfigurations: 6,
        judges: 3,
        supportIdentities: 2,
        objectiveBlocks: 5,
        mutationBlocks: 4,
      },
    });

    const lab = "Experiment lab workspace";
    for (const [label, figure, described] of [
      ["History", "7", "7 experiments"],
      ["Agent configs", "6", "6 configurations"],
      ["Judges", "3", "3 judges"],
      ["Support identities", "2", "2 support identities"],
      ["Objective blocks", "5", "5 blocks"],
      ["Mutation blocks", "4", "4 blocks"],
    ] as const) {
      const row = entry(label, lab);
      expect(within(row).getByText(figure)).toBeVisible();
      expect(row).toHaveAccessibleName(label);
      expect(row).toHaveAccessibleDescription(described);
    }
  });

  it("draws no figure in the collapsed strip and still says it", async () => {
    // The strip has room for a centred glyph and nothing else, and the prototype draws no
    // count in it. Collapsing is a statement about room on screen, and a description takes
    // none — so a reader hears the same figure either way (ADR 0056).
    renderShell("shop", { counts: { orders: 12 } });

    await userEvent.click(toggle());

    const orders = entry("Orders");
    expect(within(orders).queryByText("12")).toBeNull();
    expect(orders).toHaveAccessibleName("Orders");
    expect(orders).toHaveAccessibleDescription("12 orders");
  });
});

describe("the mode tabs", () => {
  function tabs() {
    return screen.getByRole("navigation", { name: "Workspace mode" });
  }

  it("offer both modes in either one, and mark the one you are in", () => {
    renderShell("shop");

    expect(within(tabs()).getByRole("link", { name: "Shop fixture" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    const lab = within(tabs()).getByRole("link", { name: "Experiment lab" });
    expect(lab).not.toHaveAttribute("aria-current");
    expect(lab).toHaveAttribute("href", "/lab/bench");
  });

  it("returns to the current shop from the lab", () => {
    renderShell("lab");

    expect(within(tabs()).getByRole("link", { name: "Experiment lab" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(within(tabs()).getByRole("link", { name: "Shop fixture" })).toHaveAttribute(
      "href",
      `/shops/${SHOP_ID}`,
    );
  });

  it("underlines the tab you are on in 2px and dims the other to #a8c1b8", () => {
    // The README gives the underline 2px and the prototype draws 3px: one value against one
    // value in one role, which the Authority's rule 3 settles for the README (ADR 0055).
    renderShell("shop");

    const here = within(tabs()).getByRole("link", { name: "Shop fixture" });
    const elsewhere = within(tabs()).getByRole("link", { name: "Experiment lab" });

    expect(here.className).toContain("border-b-2");
    expect(here.className).toContain("border-lab-paper");
    expect(here.className).toContain("text-white");
    expect(elsewhere.className).toContain("border-transparent");
    expect(elsewhere.className).toContain("text-[#a8c1b8]");
    // Each tab carries its glyph, at the size the prototype draws it, named by the word beside
    // it rather than by itself.
    for (const tab of [here, elsewhere]) {
      const glyph = tab.querySelector("svg");
      expect(glyph).toHaveAttribute("width", "17");
      expect(glyph).toHaveAttribute("aria-hidden", "true");
    }
  });

  it("are absent where there is no mode to be in", () => {
    renderShell();

    expect(screen.queryByRole("navigation", { name: "Workspace mode" })).not.toBeInTheDocument();
  });
});

describe("the bar's focus ring", () => {
  /**
   * The prototype rings the bar's own controls in the same pine it rings everything else, and
   * on the bar's `#16332d` that measures 1.86:1 — under WCAG 2.2's 3:1 for a focus indicator.
   * `docs/design-direction.md`'s *Principles* outrank any measurement below them, so the bar
   * takes the paper ring instead, at 13.37:1 (ADR 0055). Asserted on every control the bar
   * draws, because a ring is the one thing a keyboard reader has and the one thing nobody
   * using a pointer would notice missing.
   */
  it("rings every control it draws in the bar's paper, not in the pine that vanishes on it", () => {
    renderShell("shop");

    const tabs = screen.getByRole("navigation", { name: "Workspace mode" });
    const controls = [
      switcher(),
      within(tabs).getByRole("link", { name: "Shop fixture" }),
      within(tabs).getByRole("link", { name: "Experiment lab" }),
      screen.getByRole("button", { name: /^Show me around/ }),
      screen.getByRole("link", { name: "Settings" }),
    ];

    for (const control of controls) {
      expect(control.className, control.textContent ?? "").toContain(
        "focus-visible:outline-lab-paper",
      );
      expect(control.className).toContain("focus-visible:outline-2");
      expect(control.className).not.toContain("focus-visible:outline-lab-primary");
    }
  });

  it("draws the ring inside the controls that are the bar's whole height", () => {
    // A tab is `self-stretch` in a 56px bar, so an outward offset puts its top band above the
    // bar — clipped — and its bottom band on the pane below, where the paper reads 1.06:1 on
    // `admin-canvas`. Inset, all four edges are on the forest. The three controls that sit
    // *within* the bar's height keep the outward offset, which is the ring the handoff draws.
    renderShell("shop");

    const tabs = screen.getByRole("navigation", { name: "Workspace mode" });
    for (const name of ["Shop fixture", "Experiment lab"]) {
      const tab = within(tabs).getByRole("link", { name });
      expect(tab.className, name).toContain("focus-visible:-outline-offset-2");
    }
    for (const control of [
      switcher(),
      screen.getByRole("button", { name: /^Show me around/ }),
      screen.getByRole("link", { name: "Settings" }),
    ]) {
      expect(control.className, control.textContent ?? "").toContain(
        "focus-visible:outline-offset-2",
      );
      expect(control.className).not.toContain("focus-visible:-outline-offset-2");
    }
  });

  it("keeps the pine ring on the panel's rows, which are on white", async () => {
    renderShell("shop");
    await userEvent.click(switcher());

    for (const row of screen.getAllByRole("menuitem")) {
      expect(row.className).toContain("focus-visible:outline-lab-primary");
    }
  });

  it("rings the app title too, inside it, where the bar draws it instead of the switcher", () => {
    renderShell();

    // The title is full height under the header's `items-stretch`, so it takes the inset ring
    // for the same reason a tab does.
    const title = screen.getByRole("link", { name: "Agent Framework Lab" });
    expect(title.className).toContain("focus-visible:outline-lab-paper");
    expect(title.className).toContain("focus-visible:-outline-offset-2");
  });
});

describe("the shop switcher", () => {
  it("names the verb it performs and the shop it is showing", () => {
    renderShell("shop");

    expect(switcher()).toHaveAccessibleName("Switch shop, current: Northstar Outfitters");
    expect(switcher()).toHaveAttribute("aria-haspopup", "menu");
    expect(switcher()).toHaveAttribute("aria-expanded", "false");
    // A shop without a logo is its initials, and the badge says nothing a reader has to hear:
    // the name is beside it.
    expect(within(switcher()).getByText("NO")).toHaveAttribute("aria-hidden", "true");
  });

  it("draws a logo in the bar and the panel, and names neither mark nor colour", async () => {
    renderShell("shop", {
      shops: [
        { ...SHOPS[0], logo: { mark: "compass", background: "clay", mark_colour: "white" } },
        { ...SHOPS[1], logo: { mark: null, background: "stone", mark_colour: "ink" } },
      ] as ShopSummarySchema[],
    });

    // The badge adds nothing to the button's name: the mark is not "compass" to a reader.
    expect(switcher()).toHaveAccessibleName("Switch shop, current: Northstar Outfitters");
    const bar = switcher().querySelector("[data-shop-badge]") as HTMLElement;
    expect(bar).toHaveAttribute("aria-hidden", "true");
    expect(bar.className).toContain("h-[30px]");
    expect(bar).toHaveStyle({ backgroundColor: "#c2532d", color: "#ffffff" });
    expect(bar.querySelector("svg")).toHaveAttribute("data-mark", "compass");
    expect(bar).not.toHaveTextContent("NO");

    await userEvent.click(switcher());

    const other = screen.getByRole("menuitem", { name: "Alpenglow Supplyv3" });
    const badge = other.querySelector("[data-shop-badge]") as HTMLElement;
    expect(badge).toHaveAttribute("aria-hidden", "true");
    expect(badge.className).toContain("h-[26px]");
    // A monogram logo: the initials, on the background and in the colour chosen.
    expect(badge).toHaveStyle({ backgroundColor: "#eceef0", color: "#16332d" });
    expect(badge.querySelector("svg")).toBeNull();
    expect(badge).toHaveTextContent(/^AS$/);
  });

  it("opens a menu holding the current shop, the others with their version, and All shops", async () => {
    renderShell("shop");

    await userEvent.click(switcher());

    const menu = screen.getByRole("menu", { name: "Shops" });
    expect(switcher()).toHaveAttribute("aria-expanded", "true");
    const rows = within(menu).getAllByRole("menuitem");
    expect(rows.map((row) => row.textContent)).toEqual([
      "NONorthstar Outfitters, current shop",
      "ASAlpenglow Supplyv3",
      "All shops",
    ]);
    expect(rows[0]).toHaveAttribute("aria-current", "true");
    // Opening it puts the reader on the shop they are in rather than at the top of a list.
    expect(rows[0]).toHaveFocus();
  });

  it("says Never published where a shop has published nothing", async () => {
    // A version is what a reader chooses between, so a shop with none says so rather than
    // showing an empty column.
    renderShell("lab", {
      shops: [
        ...SHOPS,
        {
          shop_id: "5c4b3a29-1817-4655-9443-322110ffeedd",
          name: "Harbour Goods",
          slug: "harbour",
          updated_at: "2026-09-17T09:00:00+00:00",
          latest_published_version: null,
          published_version_count: 0,
          logo: null,
        },
      ],
    });

    await userEvent.click(switcher());

    expect(screen.getByRole("menuitem", { name: /Harbour Goods/ })).toHaveTextContent(
      "Never published",
    );
  });

  it("navigates in shop mode and sets the lab's shop in lab mode", async () => {
    const shopMode = renderShell("shop");
    await userEvent.click(switcher());
    await userEvent.click(screen.getByRole("menuitem", { name: /Alpenglow Supply/ }));

    expect(shopMode.router.state.location.pathname).toBe(`/shops/${OTHER_SHOP_ID}`);
    shopMode.unmount();

    const chosen: string[] = [];
    const labMode = renderShell("lab", { onShopChange: (shopId) => chosen.push(shopId) });
    await userEvent.click(switcher());
    await userEvent.click(screen.getByRole("menuitem", { name: /Alpenglow Supply/ }));

    expect(chosen).toEqual([OTHER_SHOP_ID]);
    // Nowhere in the lab to navigate a shop to, so the lab stays where it is (ADR 0054).
    expect(labMode.router.state.location.pathname).toBe("/lab/bench");
  });

  it("goes to the index from its own row, and closes on the way", async () => {
    const { router } = renderShell("shop");

    await userEvent.click(switcher());
    await userEvent.click(screen.getByRole("menuitem", { name: "All shops" }));

    expect(router.state.location.pathname).toBe("/shops");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("moves focus with the arrows and wraps at both ends", async () => {
    renderShell("shop");
    await userEvent.click(switcher());

    const rows = () => screen.getAllByRole("menuitem");
    expect(rows()[0]).toHaveFocus();

    await userEvent.keyboard("{ArrowDown}");
    expect(rows()[1]).toHaveFocus();
    await userEvent.keyboard("{End}");
    expect(rows()[2]).toHaveFocus();
    await userEvent.keyboard("{ArrowDown}");
    expect(rows()[0]).toHaveFocus();
    await userEvent.keyboard("{ArrowUp}");
    expect(rows()[2]).toHaveFocus();
    await userEvent.keyboard("{Home}");
    expect(rows()[0]).toHaveFocus();

    // Exactly one row is in the tab order, which is what roving focus means.
    expect(rows().filter((row) => row.getAttribute("tabindex") === "0")).toHaveLength(1);
  });

  it("closes on Escape, giving the keyboard back to the control it came from", async () => {
    renderShell("shop");
    await userEvent.click(switcher());

    await userEvent.keyboard("{Escape}");

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(switcher()).toHaveFocus();
  });

  it("hands the keyboard back to its button when a reader tabs out of it", async () => {
    // The panel is rendered right after the button, so the element a plain Tab would move to
    // is a row this press unmounts. It closes and returns instead, as Escape does.
    renderShell("shop");
    await userEvent.click(switcher());
    expect(screen.getAllByRole("menuitem")[0]).toHaveFocus();

    await userEvent.tab();

    // Closed, and the keyboard is on the button rather than wherever a browser would have put
    // it after the row this press unmounted.
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(switcher()).toHaveFocus();
  });

  it("closes on a press outside it, without moving anybody's focus", async () => {
    renderShell("shop");
    await userEvent.click(switcher());

    await userEvent.click(screen.getByRole("heading", { level: 1, name: "Home" }));

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(switcher()).not.toHaveFocus();
  });

  it("closes when the workspace navigates underneath it", async () => {
    const { router } = renderShell("shop");
    await userEvent.click(switcher());
    expect(screen.getByRole("menu")).toBeInTheDocument();

    await act(async () => {
      await router.navigate(`/shops/${SHOP_ID}/orders`);
    });

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});

describe("the bar's identity", () => {
  it("is the switcher where there is a shop to name", () => {
    renderShell("shop");

    expect(switcher()).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Agent Framework Lab" })).toBeNull();
  });

  it("is the app title outside a mode, and it returns to the index", () => {
    renderShell();

    expect(screen.queryByRole("button", { name: /^Switch shop/ })).toBeNull();
    expect(screen.getByRole("link", { name: "Agent Framework Lab" })).toHaveAttribute(
      "href",
      "/shops",
    );
  });

  it("is the app title in a lab that holds no shops at all", () => {
    // The one composition the prototype has not got: there is no shop to name, and a bar with
    // an empty left half is not a control worth inventing.
    renderShell("lab", { shops: [] });

    expect(screen.getByRole("link", { name: "Agent Framework Lab" })).toBeInTheDocument();
  });
});

describe("the tour control", () => {
  it("offers the tour of the surface the route names", () => {
    renderShell("shop");

    expect(screen.getByRole("button", { name: /^Show me around/ })).toBeVisible();
  });

  it("is absent where the route names no tour", () => {
    renderShell("lab", { at: "/lab/history" });

    expect(screen.queryByRole("button", { name: /^Show me around/ })).toBeNull();
  });
});

describe("the Settings toggle", () => {
  it("is a link to Settings anywhere else, and records what it would return to", async () => {
    renderShell("shop", { at: `/shops/${SHOP_ID}/products?view=draft` });

    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/settings");
    await waitFor(() =>
      expect(window.localStorage.getItem("agent-lab.settings-return")).toBe(
        `/shops/${SHOP_ID}/products?view=draft`,
      ),
    );
  });

  it("is lit on its own page and returns to what was underneath", async () => {
    window.localStorage.setItem("agent-lab.settings-return", `/shops/${SHOP_ID}/orders`);
    const { router } = renderShell(undefined, { at: "/settings" });

    const toggle = screen.getByRole("button", { name: "Settings, back to workspace" });
    expect(toggle).toHaveAttribute("title", "Back to workspace");
    expect(screen.queryByRole("link", { name: "Settings" })).toBeNull();

    await userEvent.click(toggle);

    expect(router.state.location.pathname).toBe(`/shops/${SHOP_ID}/orders`);
  });

  it("does not overwrite what it returns to while Settings is open", async () => {
    window.localStorage.setItem("agent-lab.settings-return", `/shops/${SHOP_ID}/orders`);
    renderShell(undefined, { at: "/settings" });

    // The reader who reloads a settings page is the reader `history.back()` strands; the
    // preference is untouched by being on the page it answers for (ADR 0055).
    await waitFor(() =>
      expect(window.localStorage.getItem("agent-lab.settings-return")).toBe(
        `/shops/${SHOP_ID}/orders`,
      ),
    );
  });

  it("returns to the shops index when this browser remembers nowhere", async () => {
    const { router } = renderShell(undefined, { at: "/settings" });

    await userEvent.click(screen.getByRole("button", { name: "Settings, back to workspace" }));

    expect(router.state.location.pathname).toBe("/shops");
  });
});
