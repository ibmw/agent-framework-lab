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

/** The shell at a shop, or — with no argument — at a lab surface, where there is no rail. */
function renderShell(currentShopId?: string) {
  const router = createMemoryRouter(
    [
      {
        path: "*",
        element: (
          <AppShell shops={SHOPS} currentShopId={currentShopId}>
            <h1>Home</h1>
          </AppShell>
        ),
      },
    ],
    { initialEntries: [`/shops/${SHOP_ID}`] },
  );
  return render(<RouterProvider router={router} />);
}

function rail() {
  return screen.getByRole("navigation", { name: "Shop workspace" });
}

function toggle() {
  return screen.getByRole("button", { name: /^(Collapse|Expand) menu$/ });
}

afterEach(() => {
  window.localStorage.clear();
});

describe("the navigation rail's metrics", () => {
  it("is a 216px column expanded and a 52px strip collapsed", async () => {
    renderShell(SHOP_ID);

    expect(rail().className).toContain("w-[216px]");
    expect(rail().className).not.toContain("w-[52px]");

    await userEvent.click(toggle());

    expect(rail().className).toContain("w-[52px]");
    expect(rail().className).not.toContain("w-[216px]");
  });

  it("draws the glyph at 17px expanded and 19px collapsed, in a 36px row", async () => {
    renderShell(SHOP_ID);

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
    renderShell(SHOP_ID);

    const here = within(rail()).getByRole("link", { name: "Home" });
    const elsewhere = within(rail()).getByRole("link", { name: "Products" });

    // `NavLink` marks the current row, and the dimming keys off that rather than off state.
    expect(here).toHaveAttribute("aria-current", "page");
    expect(elsewhere).not.toHaveAttribute("aria-current");
    expect(elsewhere.className).toContain("[&:not([aria-current])>svg]:opacity-75");
  });

  it("lifts an inactive row to admin-muted at 650 once it is a glyph on its own", async () => {
    renderShell(SHOP_ID);

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
    renderShell(SHOP_ID);

    const heading = within(rail()).getByText("Shop setup");
    expect(heading.className).toContain("tracking-[0.07em]");
    expect(heading.className).toContain("text-[#8c9196]");

    await userEvent.click(toggle());

    expect(within(rail()).queryByText("Shop setup")).not.toBeInTheDocument();
    expect(rail().querySelectorAll("div.h-px")).toHaveLength(2);
  });
});

describe("the rail's collapse control", () => {
  it("says the same thing to a reader, to an eye and to a pointer", async () => {
    renderShell(SHOP_ID);

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
    const first = renderShell(SHOP_ID);

    expect(window.localStorage.getItem("agent-lab.navigation-collapsed")).toBeNull();

    await userEvent.click(toggle());
    expect(window.localStorage.getItem("agent-lab.navigation-collapsed")).toBe("true");

    first.unmount();
    renderShell(SHOP_ID);

    // Arriving again finds the rail as it was left, without anything having navigated.
    expect(rail().className).toContain("w-[52px]");
    expect(toggle()).toHaveAccessibleName("Expand menu");
  });
});

describe("the collapsed strip", () => {
  it("still names every destination it draws", async () => {
    renderShell(SHOP_ID);

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

  it("is not drawn at all outside a shop", () => {
    renderShell();

    expect(screen.queryByRole("navigation", { name: "Shop workspace" })).not.toBeInTheDocument();
  });
});
