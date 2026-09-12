import { expect, type Page, test } from "@playwright/test";

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

const SECTIONS = [
  ["Home", "Home"],
  ["Customers", "Customers"],
  ["Policies & FAQ", "Policies & FAQ"],
  ["Support guidelines", "Support guidelines"],
  ["Tone of voice", "Tone of voice"],
  ["Shop details", "Shop details"],
  ["Orders", "Orders"],
  ["Products", "Products"],
] as const;

async function expectRailControlOnScreen(page: Page, section: string) {
  const toggle = page.getByRole("button", { name: /navigation$/ });
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

  await page.goto("/shops");
  const createShop = page.getByRole("region", { name: "Create a shop" });
  await createShop.getByLabel("Name", { exact: true }).fill(`Northstar ${unique}`);
  await createShop.getByLabel("Slug", { exact: true }).fill(`northstar-${unique}`);
  await createShop.getByRole("button", { name: "Create shop" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();

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
  await expect(page.getByRole("button", { name: "Saved" })).toBeDisabled();

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

  await page.goto("/shops");
  const createShop = page.getByRole("region", { name: "Create a shop" });
  await createShop.getByLabel("Name", { exact: true }).fill(`Northstar ${unique}`);
  await createShop.getByLabel("Slug", { exact: true }).fill(`northstar-${unique}`);
  await createShop.getByRole("button", { name: "Create shop" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();

  // Arriving anywhere — the helpdesk included — leaves the rail as the author left it.
  await page.getByLabel("Shop workspace").getByRole("link", { name: "Tickets" }).click();
  await expect(page.getByRole("button", { name: "Collapse navigation" })).toBeVisible();

  await page.getByRole("button", { name: "Collapse navigation" }).click();
  await page.getByLabel("Shop workspace").getByRole("link", { name: "Orders" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Orders" })).toBeVisible();

  // ...and the choice survives moving between sections.
  await expect(page.getByRole("button", { name: "Expand navigation" })).toBeVisible();
  await page.getByRole("button", { name: "Expand navigation" }).click();
  await expect(page.getByRole("button", { name: "Collapse navigation" })).toBeVisible();
});
