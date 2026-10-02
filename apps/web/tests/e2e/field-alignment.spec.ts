import type { Locator } from "@playwright/test";
import { createShop } from "./support/authoring";
import { expect, test } from "./support/e2e";
import { openSection } from "./support/navigate";

/**
 * Two fields side by side, and a field with its button, stand level and at one height.
 *
 * What only a browser can say: jsdom lays nothing out, so the component tests can hold the
 * classes that make this true and not the geometry the operator sees. Both were reported from
 * a screenshot — the variant form's *Price* drawn lower and taller than its *New variant SKU*
 * because the grid cell stretched it, and a chip list's *Add value* shorter than its input and
 * aligned with the hint under it.
 */

async function box(locator: Locator) {
  const found = await locator.boundingBox();
  if (found === null) {
    throw new Error("expected a rendered box");
  }
  return found;
}

async function expectLevel(first: Locator, second: Locator) {
  const [a, b] = [await box(first), await box(second)];
  expect(Math.abs(a.y - b.y), "the two tops").toBeLessThan(0.5);
  expect(Math.abs(a.height - b.height), "the two heights").toBeLessThan(0.5);
}

test("the product editor's fields beside each other stand level and at one height", async ({
  page,
}) => {
  const unique = Date.now().toString(36);
  await page.setViewportSize({ width: 1400, height: 1000 });
  await createShop(page, { name: `Level ${unique}`, slug: `level-${unique}` });
  await openSection(page, "Products", "Products");
  await page.getByRole("button", { name: "New product" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Untitled product" })).toBeVisible();

  // The SKU has two lines of hint and a "Saved as" under it; the price has fewer.
  const variants = page.getByRole("region", { name: "Variants" });
  await expectLevel(
    variants.getByLabel("Price (optional)", { exact: true }),
    variants.getByLabel("New variant SKU", { exact: true }),
  );

  const options = page.getByRole("region", { name: "Options" });
  await expectLevel(
    options.getByLabel("New value", { exact: true }),
    options.getByRole("button", { name: "Add value" }),
  );
});
