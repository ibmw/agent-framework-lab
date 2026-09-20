import type { ShopSummarySchema } from "@agent-lab/contracts";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { AppShell } from "./AppShell";

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

const SHOPS: ShopSummarySchema[] = [
  {
    shop_id: SHOP_ID,
    name: "Northstar Outfitters",
    slug: "northstar",
    updated_at: "2026-09-19T09:00:00+00:00",
    latest_published_version: null,
    published_version_count: 0,
  },
];

/**
 * The shell in one of its three states: a shop, the lab, or — with no mode — a frameless
 * lab-level surface, where there is no rail at all.
 */
function renderShell(
  mode?: "shop" | "lab",
  { at, onShopChange }: { at?: string; onShopChange?: (shopId: string) => void } = {},
) {
  const router = createMemoryRouter(
    [
      {
        path: "*",
        element: (
          <AppShell
            shops={SHOPS}
            currentShopId={mode === undefined ? undefined : SHOP_ID}
            mode={mode}
            onShopChange={onShopChange}
          >
            <h1>Home</h1>
          </AppShell>
        ),
      },
    ],
    { initialEntries: [at ?? (mode === "lab" ? "/lab/bench" : `/shops/${SHOP_ID}`)] },
  );
  return render(<RouterProvider router={router} />);
}

function rail(name = "Shop workspace") {
  return screen.getByRole("navigation", { name });
}

function toggle() {
  return screen.getByRole("button", { name: /^(Collapse|Expand) menu$/ });
}

afterEach(() => {
  window.localStorage.clear();
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
    "Agent configurations",
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

describe("the mode tabs", () => {
  it("offer both modes in either one, and mark the one you are in", () => {
    renderShell("shop");

    const tabs = screen.getByRole("navigation", { name: "Workspace mode" });
    expect(within(tabs).getByRole("link", { name: "Shop fixture" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    const lab = within(tabs).getByRole("link", { name: "Experiment lab" });
    expect(lab).not.toHaveAttribute("aria-current");
    expect(lab).toHaveAttribute("href", "/lab/bench");
  });

  it("returns to the current shop from the lab", () => {
    renderShell("lab");

    const tabs = screen.getByRole("navigation", { name: "Workspace mode" });
    expect(within(tabs).getByRole("link", { name: "Experiment lab" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(within(tabs).getByRole("link", { name: "Shop fixture" })).toHaveAttribute(
      "href",
      `/shops/${SHOP_ID}`,
    );
  });

  it("are absent where there is no mode to be in", () => {
    renderShell();

    expect(screen.queryByRole("navigation", { name: "Workspace mode" })).not.toBeInTheDocument();
  });
});

describe("the shop switcher", () => {
  it("navigates in shop mode and sets the lab's shop in lab mode", async () => {
    const chosen: string[] = [];
    const shopMode = renderShell("shop");
    // No handler in shop mode: the switcher navigates, which is the shell's own default and
    // is covered by the journey specs. What is asserted here is that the lab's handler is
    // what runs instead when one is given.
    expect(screen.getByRole("combobox", { name: "Shop" })).toHaveValue(SHOP_ID);
    shopMode.unmount();

    renderShell("lab", { onShopChange: (shopId) => chosen.push(shopId) });
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Shop" }), SHOP_ID);

    expect(chosen).toEqual([SHOP_ID]);
  });
});
