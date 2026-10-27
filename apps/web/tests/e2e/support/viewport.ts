import { expect, type Page } from "@playwright/test";

/** A phone (ADR 0079). Below the narrow breakpoint the width, not the operator, folds the rail. */
export const PHONE = { width: 390, height: 844 };

export const COLLAPSED_KEY = "agent-lab.navigation-collapsed";

/**
 * Everything drawn past the viewport's edges, other than what scrolls inside a box of its own
 * that is itself on screen — a results matrix in its card, say — and the pane's own sideways
 * overflow, which a phone has no way to scroll back. Empty is the claim.
 */
export async function pastTheViewport(page: Page) {
  return page.evaluate(() => {
    const width = window.innerWidth;
    const main = document.querySelector("main");
    const found: string[] = [];
    if (document.scrollingElement && document.scrollingElement.scrollWidth > width) {
      found.push(`the document is ${document.scrollingElement.scrollWidth}px wide`);
    }
    if (main && main.scrollWidth > main.clientWidth) {
      found.push(`the pane scrolls sideways to ${main.scrollWidth}px of ${main.clientWidth}px`);
    }
    for (const element of document.body.querySelectorAll("*")) {
      const box = element.getBoundingClientRect();
      if (box.width <= 1 || box.height <= 1 || (box.right <= width + 0.5 && box.left >= -0.5)) {
        continue;
      }
      let scroller = element.parentElement;
      let scrolled = false;
      while (scroller && scroller !== main && scroller !== document.body) {
        const overflow = getComputedStyle(scroller).overflowX;
        if (
          (overflow === "auto" || overflow === "scroll") &&
          scroller.getBoundingClientRect().right <= width + 0.5
        ) {
          scrolled = true;
          break;
        }
        scroller = scroller.parentElement;
      }
      if (!scrolled) {
        found.push(`${element.tagName} "${(element.textContent ?? "").trim().slice(0, 30)}"`);
      }
    }
    return found;
  });
}

/**
 * The top bar holds every control it draws at a phone's width: each one inside the bar's own box
 * and inside the viewport. A bar that wrapped without growing would spill its rows over the pane
 * below it, and one that did not wrap would run Settings off the edge (ADR 0079).
 */
export async function expectTopBarHoldsItsControls(page: Page) {
  const bar = await page.locator("body header").first().boundingBox();
  expect(bar, "the top bar is not rendered").not.toBeNull();
  if (bar === null) return;
  expect(bar.height, "the top bar did not grow to hold its wrapped rows").toBeGreaterThan(56);
  const width = page.viewportSize()?.width ?? 0;
  const tour = page.getByRole("button", { name: /^Show me around/ });
  for (const control of [
    page.getByRole("navigation", { name: "Workspace mode" }),
    // Absent where the route names no tour; held to the bar wherever it is drawn.
    ...((await tour.count()) > 0 ? [tour] : []),
    page.getByRole("link", { name: "Settings" }),
  ]) {
    const box = await control.boundingBox();
    expect(box, "a top bar control is not rendered").not.toBeNull();
    if (box === null) continue;
    expect(
      box.y >= bar.y - 0.5 &&
        box.y + box.height <= bar.y + bar.height + 0.5 &&
        box.x >= -0.5 &&
        box.x + box.width <= width + 0.5,
      `a control at ${JSON.stringify(box)} is outside the bar ${JSON.stringify(bar)}`,
    ).toBe(true);
  }
}
