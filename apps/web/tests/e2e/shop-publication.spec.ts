import type { Page } from "@playwright/test";
import { addDocument } from "./support/authoring";
import { expect, test } from "./support/e2e";
import { openSection } from "./support/navigate";

/**
 * Milestone 1 Slice 2 acceptance evidence: an author publishes a shop containing a product
 * with size/colour variants and retrieves the same immutable version.
 */

function card(page: Page, name: string) {
  return page.getByRole("region", { name });
}

/**
 * An 8×8 pine square as a PNG, built here rather than committed: the lab tells its type by
 * these first bytes, and the browser draws it, so the thumbnail is shown to load.
 */
const PINE_SQUARE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEUlEQVR4nGOQTXLEihiGlgQAuNYwAearz7oAAAAASUVORK5CYII=",
  "base64",
);

async function saveDraft(page: Page) {
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText("All changes saved")).toBeVisible();
}

test("an author publishes a shop with size and colour variants and reads the frozen version", async ({
  page,
}) => {
  const unique = Date.now().toString(36);

  await page.goto("/shops");
  await expect(page.getByRole("heading", { level: 1, name: "Shops" })).toBeVisible();

  // Creating a shop is a page now, not a side card on the index (PLAN-UX Slice 12).
  await page.getByRole("link", { name: "New shop" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "New shop" })).toBeVisible();
  await page.getByLabel("Name", { exact: true }).fill(`Northstar ${unique}`);
  await page.getByLabel("Slug", { exact: true }).fill(`northstar-${unique}`);
  // The page is what is being typed: the title reads back the name before anything exists.
  await expect(page.getByRole("heading", { level: 1, name: `Northstar ${unique}` })).toBeVisible();
  // A Swiss shop, which sells in two currencies from the first form it meets. The locale
  // answers the first — and reads back as the place it names — and the operator ticks the
  // second here rather than being sent to Shop details to add it after the fact.
  await page.getByLabel("Locale", { exact: true }).fill("de-CH");
  await expect(page.getByText("German (Switzerland)")).toBeVisible();
  const currencies = page.getByRole("group", { name: "Currencies" });
  await expect(currencies.getByRole("checkbox", { name: "CHF — Swiss franc" })).toBeChecked();
  await currencies.getByRole("checkbox", { name: "EUR — Euro" }).check();
  await page.getByRole("button", { name: "Create shop" }).click();

  await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
  await expect(page.getByText("Never published")).toBeVisible();
  // Publishing is two presses now (PLAN-UX Slice 15), and the first one is refused while the
  // gate is: a shop with no product has nothing to review.
  await expect(page.getByRole("button", { name: "Review 1 change & publish" })).toBeDisabled();

  // Support knowledge and commerce configuration a published shop must carry.
  await addDocument(page, {
    kind: "Policy",
    title: "Shipping policy",
    body:
      "A shipping address can change before dispatch.\n\n" +
      "Once a parcel is with the carrier the address is fixed.\n\n" +
      "Refused deliveries return to the warehouse within ten days.",
  });

  await openSection(page, "Shop details", "Shop details");
  const payments = card(page, "Payment methods");
  await payments.getByLabel("Name", { exact: true }).fill("Visa");
  await payments.getByRole("button", { name: "Add payment method" }).click();
  const fulfilment = card(page, "Fulfilment methods");
  await fulfilment.getByLabel("Name", { exact: true }).fill("Standard");
  await fulfilment.getByLabel("Carrier", { exact: true }).fill("Nordic Post");
  await fulfilment.getByRole("button", { name: "Add fulfilment method" }).click();
  await saveDraft(page);

  await openSection(page, "Tone of voice", "Tone of voice");
  const tone = card(page, "Guidelines");
  await tone.getByLabel("Name", { exact: true }).fill("Warm and precise");
  await tone.getByLabel("Guidance", { exact: true }).fill("Be concise, warm, and specific.");
  await tone.getByRole("button", { name: "Add tone of voice" }).click();
  await saveDraft(page);

  // Catalog: one product with colour and size options and two priced variants. *New product*
  // appends an empty product to the draft and opens its editor, so the title, the category
  // and the handle it derives are all authored there (PLAN-UX Slice 12).
  await openSection(page, "Products", "Products");
  await page.getByRole("button", { name: "New product" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Untitled product" })).toBeVisible();
  await card(page, "Details").getByLabel("Title", { exact: true }).fill("Alpine Shell Jacket");
  await card(page, "Details").getByLabel("Category", { exact: true }).fill("Jackets");
  await expect(card(page, "Details").getByLabel("Handle", { exact: true })).toHaveValue(
    "alpine-shell-jacket",
  );
  await expect(page.getByRole("heading", { level: 1, name: "Alpine Shell Jacket" })).toBeVisible();
  await card(page, "Details")
    .getByLabel("Description", { exact: true })
    .fill("Three-layer waterproof shell with taped seams.");

  const options = card(page, "Options");
  await options.getByLabel("Option name", { exact: true }).fill("Color");
  // One value at a time, each becoming a chip named after itself — and the second "Ocean
  // Blue" this shop will never carry is refused where it is typed rather than dropped.
  await options.getByLabel("New value", { exact: true }).fill("Ocean Blue");
  await options.getByRole("button", { name: "Add value" }).click();
  await options.getByLabel("New value", { exact: true }).fill("Ocean Blue");
  await expect(options.getByText("Ocean Blue is already a value of this option.")).toBeVisible();
  await options.getByRole("button", { name: "Add value" }).click();
  await expect(options.getByRole("button", { name: "Remove Ocean Blue" })).toHaveCount(1);
  await options.getByLabel("New value", { exact: true }).fill("Charcoal");
  await options.getByRole("button", { name: "Add value" }).click();
  await expect(options.getByLabel("Option key", { exact: true })).toHaveValue("color");
  await options.getByRole("button", { name: "Add option" }).click();
  await options.getByLabel("Option name", { exact: true }).fill("Size");
  await options.getByLabel("New value", { exact: true }).fill("M");
  await options.getByRole("button", { name: "Add value" }).click();
  await options.getByLabel("New value", { exact: true }).fill("L");
  await options.getByRole("button", { name: "Add value" }).click();
  await expect(options.getByLabel("Option key", { exact: true })).toHaveValue("size");
  await options.getByRole("button", { name: "Add option" }).click();

  const variants = card(page, "Variants");
  await variants.getByLabel("New variant SKU", { exact: true }).fill("NS-ASJ-OB-M");
  await variants.getByLabel("Price (optional)", { exact: true }).fill("249.00");
  // The shop's first currency is what a new variant is priced in, so this one takes the franc.
  await variants.getByRole("button", { name: "Add variant" }).click();

  await variants.getByLabel("New variant SKU", { exact: true }).fill("NS-ASJ-CH-L");
  await variants.getByLabel("Price (optional)", { exact: true }).fill("249.00");
  // And this one takes the euro, which the create form put on the shop. Both are prices the
  // publish gate accepts, which is what a second currency was ticked for.
  // By role: this select's label wraps it, so its text reads "CurrencyCHFEUR" to a label query.
  await variants.getByRole("combobox", { name: "Currency" }).selectOption("EUR");
  await variants.getByLabel("Color", { exact: true }).selectOption("Charcoal");
  await variants.getByLabel("Size", { exact: true }).selectOption("L");
  await variants.getByRole("button", { name: "Add variant" }).click();

  // Its image, browsed for with the system's picker and uploaded to the shop at once
  // (ADR 0076): the item is named by the file and leads with the image the lab serves.
  const media = card(page, "Media");
  await media.getByLabel("Browse…").setInputFiles({
    name: "ocean-blue-front.png",
    mimeType: "image/png",
    buffer: PINE_SQUARE_PNG,
  });
  await expect(media.getByRole("group", { name: "Image", exact: true })).toContainText(
    "ocean-blue-front.png",
  );
  await media.getByLabel("Alt text", { exact: true }).fill("Ocean Blue, front");
  await media.getByRole("button", { name: "Add media" }).click();
  await expect(media.getByRole("button", { name: "Edit ocean-blue-front.png" })).toBeVisible();
  const thumbnail = media.getByRole("img", { name: "Ocean Blue, front" });
  await expect(thumbnail).toBeVisible();
  await expect
    .poll(() => thumbnail.evaluate((image: HTMLImageElement) => image.naturalWidth))
    .toBe(8);
  await saveDraft(page);

  // Publish the whole shop, then read the frozen version back. The operator reads what
  // becomes v1 before anything is frozen, and only the Publish inside that review writes.
  await openSection(page, "Overview", "Overview");
  const review = page.getByRole("button", { name: "Review 1 change & publish" });
  await expect(review).toBeEnabled();
  await review.click();

  const versions = card(page, "Versions of this shop");
  const becoming = versions.getByRole("list", { name: "This change becomes v1" });
  await expect(becoming.getByRole("listitem")).toHaveCount(1);
  await expect(becoming.getByText("First published version of")).toBeVisible();
  await versions.getByRole("button", { name: "Publish v1" }).click();

  await expect(page.getByText(/v1 is published\./)).toBeVisible();
  await expect(page.getByText(/Draft matches v1/)).toBeVisible();
  // And the published state offers the next step the prototype offers.
  await expect(page.getByRole("link", { name: /Point a scenario at v1/ })).toBeVisible();

  await versions.getByRole("link", { name: "v1", exact: true }).click();
  await expect(page.getByText("published · read only")).toBeVisible();
  const frozen = page.getByRole("table");
  await expect(frozen.getByText("NS-ASJ-OB-M")).toBeVisible();
  await expect(frozen.getByText("Ocean Blue · M")).toBeVisible();
  await expect(frozen.getByText("Charcoal · L")).toBeVisible();
  await expect(frozen.getByText("249.00 CHF").first()).toBeVisible();
  await expect(frozen.getByText("249.00 EUR").first()).toBeVisible();
  // The version froze the image by its hash, the reference a draft write takes.
  await expect(page.getByText(/^asset:sha256:[0-9a-f]{64}$/)).toBeVisible();

  // PLAN-UX Slice 7, read on Slice 16's surface. One word of a three-paragraph policy is
  // wrong. The operator opens the policy from the Documents table — a page now, not a row —
  // fixes the word and presses Save, and the draft reports one updated entry against v1,
  // because the document was written back into its own list under the slug it already had.
  await openSection(page, "Policies & FAQ", "Policies & FAQ");
  const documents = page.getByRole("region", { name: "Documents" });
  // The slug the title derived, on the row and again on the page it opens.
  await expect(documents.getByText("shipping-policy")).toBeVisible();
  await documents.getByRole("link", { name: "Shipping policy" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Shipping policy" })).toBeVisible();
  await expect(page.getByText("shipping-policy")).toBeVisible();
  await page
    .getByLabel("Content", { exact: true })
    .fill(
      "A shipping address can change before despatch.\n\n" +
        "Once a parcel is with the carrier the address is fixed.\n\n" +
        "Refused deliveries return to the warehouse within ten days.",
    );
  await saveDraft(page);

  await openSection(page, "Overview", "Overview");
  // The timeline's own draft stop says what stands on it, and the review says what it is.
  const timeline = card(page, "Versions of this shop");
  await expect(timeline.getByText("1 change · no experiment can see it")).toBeVisible();
  await timeline.getByRole("button", { name: "Review 1 change & publish" }).click();
  const becomingV2 = timeline.getByRole("list", { name: "This change becomes v2" });
  await expect(becomingV2.getByRole("listitem")).toHaveCount(1);
  await expect(becomingV2.getByText("Updated policy Shipping policy")).toBeVisible();
  await expect(timeline.getByText("Scenarios stay on v1 until you repoint them.")).toBeVisible();
});
