import type { Page } from "@playwright/test";
import { expect, test } from "./support/e2e";
import { openSection } from "./support/navigate";

/**
 * Milestone 1 Slice 2 acceptance evidence: an author publishes a shop containing a product
 * with size/colour variants and retrieves the same immutable version.
 */

function card(page: Page, name: string) {
  return page.getByRole("region", { name });
}

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
  await openSection(page, "Policies & FAQ", "Policies & FAQ");
  const policies = card(page, "Policies");
  await policies.getByLabel("Title", { exact: true }).fill("Shipping policy");
  await policies
    .getByLabel("Body", { exact: true })
    .fill(
      "A shipping address can change before dispatch.\n\n" +
        "Once a parcel is with the carrier the address is fixed.\n\n" +
        "Refused deliveries return to the warehouse within ten days.",
    );
  await policies.getByRole("button", { name: "Add policy" }).click();
  await saveDraft(page);

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

  // PLAN-UX Slice 7. One word of a three-paragraph policy is wrong. The operator opens the
  // saved row, fixes the word and presses Save — no removing and retyping the policy — and
  // the draft reports one updated entry against v1, because the row was written back under
  // the id it already had.
  await openSection(page, "Policies & FAQ", "Policies & FAQ");
  const saved = card(page, "Policies");
  await saved.getByRole("button", { name: "Edit Shipping policy" }).click();
  const openRow = saved.getByRole("form", { name: "Edit Shipping policy" });
  // The identifier stays on the header line, displayed and never asked for.
  await expect(saved.getByText("shipping-policy")).toBeVisible();
  // By role rather than by label: a wrapping `<label>`'s rendered text includes the value of
  // the control it wraps, so a prefilled textarea has no exact label text to match on. The
  // accessible name is still "Body".
  await openRow
    .getByRole("textbox", { name: "Body", exact: true })
    .fill(
      "A shipping address can change before despatch.\n\n" +
        "Once a parcel is with the carrier the address is fixed.\n\n" +
        "Refused deliveries return to the warehouse within ten days.",
    );
  await openRow.getByRole("button", { name: "Save Shipping policy" }).click();
  await expect(saved.getByText("despatch").first()).toBeVisible();
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
