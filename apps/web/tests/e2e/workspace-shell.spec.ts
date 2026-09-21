import type { Page } from "@playwright/test";
import { createShop } from "./support/authoring";
import { expect, test } from "./support/e2e";

/**
 * The workspace shell owns the viewport: the rail and the content pane scroll independently,
 * so the rail's own controls stay on screen however long a section's content runs.
 *
 * This is a regression guard. When the page did the scrolling instead, a section taller than
 * the window stretched the rail down the document and parked its bottom control below the
 * fold — the collapse control read as missing on exactly the longest pages.
 */

/** Short enough that any real section overflows it. */
const VIEWPORT = { width: 1280, height: 620 };

/**
 * Rail label, then the heading it lands on. The rail and the page now say the same word:
 * ADR 0054 renamed the entry and PLAN-UX Slice 15 rebuilt the page as *Overview*. Support
 * guidelines is no longer on the rail at all — the prototype draws four setup entries, and
 * Slice 16 folds guidelines into the documents table.
 */
const SECTIONS = [
  ["Overview", "Overview"],
  ["Customers", "Customers"],
  ["Policies & FAQ", "Policies & FAQ"],
  ["Tone of voice", "Tone of voice"],
  ["Shop details", "Shop details"],
  ["Orders", "Orders"],
  ["Products", "Products"],
] as const;

async function expectRailControlOnScreen(page: Page, section: string) {
  const toggle = page.getByRole("button", { name: /^(Collapse|Expand) menu$/ });
  const box = await toggle.boundingBox();
  expect(box, `${section}: the rail control is not rendered`).not.toBeNull();
  expect(
    box !== null && box.y >= 0 && box.y + box.height <= VIEWPORT.height,
    `${section}: the rail control sits at y=${box?.y}, outside a ${VIEWPORT.height}px window`,
  ).toBe(true);
}

test("the rail keeps its controls on screen in every section", async ({ page }) => {
  const unique = Date.now().toString(36);
  await page.setViewportSize(VIEWPORT);

  await createShop(page, { name: `Northstar ${unique}`, slug: `northstar-${unique}` });

  // Enough authored content that shop details runs past a short window.
  await page.getByLabel("Shop workspace").getByRole("link", { name: "Shop details" }).click();
  const payments = page.getByRole("region", { name: "Payment methods" });
  await payments.getByLabel("ID", { exact: true }).fill("card");
  await payments.getByLabel("Name", { exact: true }).fill("Card synthetic");
  await payments.getByRole("button", { name: "Add payment method" }).click();
  const fulfilment = page.getByRole("region", { name: "Fulfilment methods" });
  await fulfilment.getByLabel("ID", { exact: true }).fill("standard");
  await fulfilment.getByLabel("Name", { exact: true }).fill("Standard 3-5 days");
  await fulfilment.getByLabel("Carrier", { exact: true }).fill("Nordic Post");
  await fulfilment.getByRole("button", { name: "Add fulfilment method" }).click();
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText("All changes saved")).toBeVisible();

  for (const [link, heading] of SECTIONS) {
    // Scoped to the rail: the guide strip on the shop home links to sections by name too.
    await page.getByLabel("Shop workspace").getByRole("link", { name: link }).click();
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    await expectRailControlOnScreen(page, heading);
  }
});

test("the rail collapses only when the author asks, in every section", async ({ page }) => {
  const unique = Date.now().toString(36);
  await page.setViewportSize(VIEWPORT);

  await createShop(page, { name: `Northstar ${unique}`, slug: `northstar-${unique}` });

  // Arriving anywhere — the helpdesk included — leaves the rail as the author left it.
  await page.getByLabel("Shop workspace").getByRole("link", { name: "Tickets" }).click();
  await expect(page.getByRole("button", { name: "Collapse menu" })).toBeVisible();

  await page.getByRole("button", { name: "Collapse menu" }).click();
  await page.getByLabel("Shop workspace").getByRole("link", { name: "Orders" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Orders" })).toBeVisible();

  // ...and the choice survives moving between sections.
  await expect(page.getByRole("button", { name: "Expand menu" })).toBeVisible();
  await page.getByRole("button", { name: "Expand menu" }).click();
  await expect(page.getByRole("button", { name: "Collapse menu" })).toBeVisible();
});

/**
 * PLAN-UX Slice 8's own evidence, in a browser: an edit that the rail would carry somewhere it
 * cannot be saved is asked about once, and the three answers do what they say.
 */
test("asks before the rail carries an unsaved product edit out of reach", async ({ page }) => {
  const unique = Date.now().toString(36);

  await createShop(page, { name: `Northstar ${unique}`, slug: `northstar-${unique}` });

  await page.getByLabel("Shop workspace").getByRole("link", { name: "Products" }).click();
  await page.getByRole("button", { name: "New product" }).click();
  const details = page.getByRole("region", { name: "Details" });
  await details.getByLabel("Title", { exact: true }).fill("Alpine Shell Jacket");
  await details.getByLabel("Category", { exact: true }).fill("Jackets");
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText("All changes saved")).toBeVisible();

  // Already standing in the editor: *New product* lands here (PLAN-UX Slice 12), so the
  // journey no longer walks back to the catalog to open what it just made.
  await details
    .getByLabel("Description", { exact: true })
    .fill("Three-layer waterproof shell with taped seams.");

  // The product editor and the catalog save the same draft, so moving between them asks nothing.
  await page.getByLabel("Shop workspace").getByRole("link", { name: "Products" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Products" })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // Orders cannot save it, so it is asked about — once, with three answers.
  await page.getByLabel("Shop workspace").getByRole("link", { name: "Orders" }).click();
  const prompt = page.getByRole("dialog", { name: "Unsaved changes" });
  await expect(prompt).toContainText("The shop draft has unsaved changes.");
  await prompt.getByRole("button", { name: "Stay on this page" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Products" })).toBeVisible();

  await page.getByLabel("Shop workspace").getByRole("link", { name: "Orders" }).click();
  await prompt.getByRole("button", { name: "Discard and leave" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Orders" })).toBeVisible();

  // Discard read the draft back, so the description the lab holds is the one it was saved with.
  await page.getByLabel("Shop workspace").getByRole("link", { name: "Products" }).click();
  await page.getByRole("link", { name: "Alpine Shell Jacket" }).click();
  await expect(
    page.getByRole("region", { name: "Details" }).getByLabel("Description", { exact: true }),
  ).toHaveValue("");
});

/**
 * PLAN-UX Slice 10's own evidence, in a browser (ADR 0055): the bar switches shop without
 * leaving the mode, offers the tour of whatever screen the operator is on, and closes Settings
 * back onto what was underneath it.
 */
test("the top bar switches shop, offers the tour, and closes Settings onto the page beneath", async ({
  page,
}) => {
  const unique = Date.now().toString(36);

  await createShop(page, { name: `Alpenglow ${unique}`, slug: `alpenglow-${unique}` });
  await createShop(page, { name: `Northstar ${unique}`, slug: `northstar-${unique}` });

  await page.getByLabel("Shop workspace").getByRole("link", { name: "Products" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Products" })).toBeVisible();

  // The switcher is a menu, and picking a shop by its name is what an operator does with it.
  const switcher = page.getByRole("button", { name: /^Switch shop/ });
  await expect(switcher).toHaveAccessibleName(`Switch shop, current: Northstar ${unique}`);
  await switcher.click();
  await page.getByRole("menuitem", { name: `Alpenglow ${unique}` }).click();

  await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
  await expect(switcher).toHaveAccessibleName(`Switch shop, current: Alpenglow ${unique}`);
  // Still in shop mode: the switcher moves the shop, never the mode.
  await expect(
    page.getByLabel("Workspace mode").getByRole("link", { name: "Shop fixture" }),
  ).toHaveAttribute("aria-current", "page");
  // And the panel is gone, dismissed by the navigation it caused.
  await expect(page.getByRole("menu", { name: "Shops" })).toHaveCount(0);

  // The tour of the screen the operator is standing on, from the same bar.
  await page.getByRole("button", { name: "Show me around this shop" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // Settings, from the product the slice's evidence says an operator comes back to: the editor
  // of one product, which is a deeper address than the catalog and the one a reader would
  // notice losing.
  await page.getByLabel("Shop workspace").getByRole("link", { name: "Products" }).click();
  await page.getByRole("button", { name: "New product" }).click();
  const details = page.getByRole("region", { name: "Details" });
  await details.getByLabel("Title", { exact: true }).fill("Alpine Shell Jacket");
  await details.getByLabel("Category", { exact: true }).fill("Jackets");
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText("All changes saved")).toBeVisible();
  // *New product* lands in the editor, which is the deeper address this case is about.
  await expect(page.getByRole("heading", { level: 1, name: "Alpine Shell Jacket" })).toBeVisible();
  const editorUrl = page.url();

  await page.getByRole("link", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Lab settings" })).toBeVisible();

  // Lit, with a close glyph, and the second press returns to what was underneath — after a
  // reload, which is the case `history.back()` cannot answer.
  await page.reload();
  const close = page.getByRole("button", { name: "Settings, back to workspace" });
  await expect(close).toBeVisible();
  await close.click();

  await expect(page.getByRole("heading", { level: 1, name: "Alpine Shell Jacket" })).toBeVisible();
  expect(page.url()).toBe(editorUrl);
});
