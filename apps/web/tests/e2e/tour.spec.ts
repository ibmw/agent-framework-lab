import { TOURS, tourSteps } from "../../src/lib/tours";
import { expect, test } from "./support/e2e";

/**
 * One tour, run the way an operator runs it (ADR 0045).
 *
 * The shop home is the cheapest surface with a tour — it needs a shop and nothing else — and
 * what is under test is the tour rather than the screen: that it starts only when asked, lights
 * the element the table names, steps forward and back, carries the glossary into its popover,
 * and ends on Escape with nothing left over the page. `driver.js` promises most of that, and a
 * promise a dependency makes is worth asserting rather than assuming.
 */

// What the tour actually walks, chain step first, rather than the rows as declared.
const STEPS = tourSteps("shop-home");

test("a tour walks the screen it was launched from, and leaves when it is told to", async ({
  page,
}) => {
  const unique = Date.now().toString(36);

  await page.goto("/shops");
  const createShop = page.getByRole("region", { name: "Create a shop" });
  await createShop.getByLabel("Name", { exact: true }).fill(`Northstar ${unique}`);
  await createShop.getByLabel("Slug", { exact: true }).fill(`northstar-${unique}`);
  await createShop.getByRole("button", { name: "Create shop" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();

  // Nothing has appeared unbidden: the tour is an offer, not a first run.
  const popover = page.getByRole("dialog");
  await expect(popover).toHaveCount(0);

  const launch = page.getByRole("button", { name: `Show me around ${TOURS["shop-home"].surface}` });
  await expect(launch).toBeVisible();
  await launch.click();

  // The first step, and the element the table names is the one that is lit.
  await expect(popover).toBeVisible();
  await expect(popover).toContainText(STEPS[0].title);
  await expect(popover).toContainText(`1 of ${STEPS.length}`);
  await expect(page.locator(STEPS[0].anchor)).toHaveClass(/driver-active-element/);

  // Focus is inside the dialog, so a reader with a keyboard is where the tour is.
  await expect(popover.locator(":focus")).toHaveCount(1);

  // Forward, then back, and the tour is where it started.
  await popover.getByRole("button", { name: "Next" }).click();
  await expect(popover).toContainText(STEPS[1].title);
  await expect(popover).toContainText(`2 of ${STEPS.length}`);
  await expect(page.locator(STEPS[1].anchor)).toHaveClass(/driver-active-element/);

  // The glossary reaches inside the popover: the word is a link to its entry, and the hover
  // definition is the link's own accessible description (ADR 0044's decision, unchanged).
  // Asserted on this step rather than the first, which is the composed chain step and states a
  // position rather than naming any of the lab's vocabulary.
  const term = popover.getByRole("link", { name: "shop", exact: true });
  await expect(term).toHaveAttribute("href", "/glossary#shop");
  await expect(term).toHaveAttribute("title", /Shop — /);

  await popover.getByRole("button", { name: "Back" }).click();
  await expect(popover).toContainText(STEPS[0].title);
  await expect(popover).toContainText(`1 of ${STEPS.length}`);

  // Escape ends it, and takes the overlay with it — nothing is left dimming the page.
  await page.keyboard.press("Escape");
  await expect(popover).toHaveCount(0);
  await expect(page.locator(".driver-overlay")).toHaveCount(0);
  await expect(page.locator(".driver-active-element")).toHaveCount(0);

  // And focus comes back to the control it left from, rather than to the top of the document.
  // Asserted after *stepping*, which is the case that fails without help: the library restores
  // whatever it bookmarked last, and stepping leaves that bookmark on a button it has removed.
  // And focus comes back to the control it left from, rather than to the top of the document.
  // Asserted after *stepping*, which is the case that fails without help: the library restores
  // whatever it bookmarked last, and stepping leaves that bookmark on a button it has removed.
  await expect(launch).toBeFocused();

  // The page underneath is the page it was, and the tour can be asked for again.
  await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
  await launch.click();
  await expect(popover).toBeVisible();
  await popover.getByRole("button", { name: "Close" }).click();
  await expect(popover).toHaveCount(0);

  // Motion is a preference, and the library tweens its cut-out from JavaScript where no CSS rule
  // in `styles.css` can reach it, so the preference has to be read rather than declared.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await launch.click();
  await expect(page.locator("body")).toHaveClass(/driver-simple/);
  await expect(page.locator("body")).not.toHaveClass(/driver-fade/);
  await page.keyboard.press("Escape");
  await page.emulateMedia({ reducedMotion: null });

  // And a tour walks one screen: leaving the surface is the end of it, not a step of it.
  await launch.click();
  await expect(popover).toBeVisible();
  // Onto the step that lights the rail. Everything the overlay dims is genuinely unclickable —
  // that is the overlay working — so the way out has to be through the step's own cut-out, and
  // the opening step lights the page's name rather than the way out of it.
  await popover.getByRole("button", { name: "Next" }).click();
  await expect(page.locator(STEPS[1].anchor)).toHaveClass(/driver-active-element/);
  await page.getByLabel("Shop workspace").getByRole("link", { name: "Orders" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Orders" })).toBeVisible();
  await expect(popover).toHaveCount(0);
});
