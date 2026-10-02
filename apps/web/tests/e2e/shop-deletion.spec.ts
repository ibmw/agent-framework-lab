import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { addProduct, createShop, saveDraft } from "./support/authoring";
import { expect, test } from "./support/e2e";
import { mediaRoot, workerIndex } from "./support/stack";

/**
 * PLAN-UX Milestone 11 Slice 42's evidence (ADR 0077): a shop that never published is deleted
 * from the shops index through its confirm, which counts what it holds; the row goes, the
 * switcher no longer offers it, and its media directory is gone.
 */

/** An 8×8 pine square as a PNG: the lab tells its type by these first bytes. */
const PINE_SQUARE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEUlEQVR4nGOQTXLEihiGlgQAuNYwAearz7oAAAAASUVORK5CYII=",
  "base64",
);

/**
 * Where this shop's images are on disk: under the media root of this worker's own stack, named
 * by the run the config shares with its workers through the environment.
 */
function shopDirectory(shopId: string): string {
  const runId = process.env.AGENT_LAB_E2E_RUN_ID;
  if (runId === undefined) {
    throw new Error(
      "AGENT_LAB_E2E_RUN_ID is not set: the Playwright config sets it for its workers",
    );
  }
  return join(mediaRoot(runId, workerIndex()), "shops", shopId);
}

function shopIdOf(page: Page): string {
  const match = /\/shops\/([0-9a-f-]{36})/.exec(page.url());
  if (match === null) {
    throw new Error(`no shop in ${page.url()}`);
  }
  return match[1];
}

test("a shop that never published is deleted from the index with everything it holds", async ({
  page,
  request,
}) => {
  const unique = Date.now().toString(36);
  const name = `Harbour ${unique}`;

  await createShop(page, { name, slug: `harbour-${unique}` });
  const shopId = shopIdOf(page);

  // An image, uploaded through the product's Media card (ADR 0076).
  await addProduct(page, { title: "Dry Bag", category: "Bags" });
  const media = page.getByRole("region", { name: "Media" });
  await media.getByLabel("Browse…").setInputFiles({
    name: "dry-bag-sand.png",
    mimeType: "image/png",
    buffer: PINE_SQUARE_PNG,
  });
  await expect(media.getByRole("group", { name: "Image", exact: true })).toContainText(
    "dry-bag-sand.png",
  );
  await media.getByLabel("Alt text", { exact: true }).fill("Sand dry bag");
  await media.getByRole("button", { name: "Add media" }).click();
  await expect(media.getByRole("button", { name: "Edit dry-bag-sand.png" })).toBeVisible();
  await saveDraft(page);
  expect(existsSync(shopDirectory(shopId))).toBe(true);

  // An order, and a second shop for the switcher to go on offering: scaffolding at the HTTP
  // boundary, since neither is what this journey is about.
  const profile = await request.post("/api/v1/customer-profiles", {
    data: {
      identity: {
        given_name: "Maya",
        family_name: "Laurent",
        email: `maya.${unique}@example.org`,
        locale: "fr-FR",
        phone: null,
      },
      customer_since: "2024-03-14",
      shop_id: shopId,
    },
  });
  expect(profile.ok(), await profile.text()).toBe(true);
  const order = await request.post(`/api/v1/shops/${shopId}/orders`, {
    data: {
      reference: `H-${unique.toUpperCase()}`,
      customer_profile_id: (await profile.json()).profile_id,
      placed_at: "2026-10-02T09:00:00Z",
    },
  });
  expect(order.ok(), await order.text()).toBe(true);
  const other = await request.post("/api/v1/shops", {
    data: {
      identity: {
        name: `Fjord ${unique}`,
        slug: `fjord-${unique}`,
        locale: "en-GB",
        currencies: ["EUR"],
        channels: ["chat"],
      },
    },
  });
  expect(other.ok(), await other.text()).toBe(true);

  await page.goto("/shops");
  await page.getByRole("button", { name: `Delete ${name}` }).click();
  const confirm = page.getByRole("group", { name: `Delete ${name} and everything it holds?` });
  await expect(confirm).toBeFocused();
  await expect(
    confirm.getByText(
      "It holds 1 product, 1 order, no ticket, no scenario and 1 image, and all of it goes with the shop.",
    ),
  ).toBeVisible();
  await expect(
    confirm.getByText(/Customers, identities and blocks it used are kept\./),
  ).toBeVisible();
  await confirm.getByRole("button", { name: "Delete it" }).click();

  await expect(page.getByText(`Deleted ${name} and everything it held.`)).toBeFocused();
  await expect(page.getByRole("link", { name, exact: true })).toHaveCount(0);
  expect(existsSync(shopDirectory(shopId))).toBe(false);
  expect((await request.get(`/api/v1/shops/${shopId}/draft`)).status()).toBe(404);
  // The customer it used is kept.
  expect(
    (
      await request.get(`/api/v1/customer-profiles/${(await profile.json()).profile_id}/draft`)
    ).ok(),
  ).toBe(true);

  // The switcher the next workspace draws reads the shops that remain.
  await page.goto("/lab/judges");
  await page.getByRole("button", { name: /^Switch shop/ }).click();
  const menu = page.getByRole("menu", { name: "Shops" });
  await expect(menu.getByRole("menuitem", { name: new RegExp(`Fjord ${unique}`) })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: new RegExp(name) })).toHaveCount(0);
});
