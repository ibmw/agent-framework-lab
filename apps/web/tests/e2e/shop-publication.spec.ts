import { expect, type Page, test } from "@playwright/test";

/**
 * Milestone 1 Slice 2 acceptance evidence: an author publishes a shop containing a product
 * with size/colour variants and retrieves the same immutable version.
 */

function card(page: Page, name: string) {
  return page.getByRole("region", { name });
}

async function saveDraft(page: Page) {
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByRole("button", { name: "Saved" })).toBeDisabled();
}

async function openSection(page: Page, link: string, heading: string) {
  // Scoped to the rail: the guide strip on the shop home links to the same sections by name.
  await page.getByLabel("Shop workspace").getByRole("link", { name: link }).click();
  await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
}

test("an author publishes a shop with size and colour variants and reads the frozen version", async ({
  page,
}) => {
  const unique = Date.now().toString(36);

  await page.goto("/shops");
  await expect(page.getByRole("heading", { level: 1, name: "Shops" })).toBeVisible();

  const createShop = card(page, "Create a shop");
  await createShop.getByLabel("Name", { exact: true }).fill(`Northstar ${unique}`);
  await createShop.getByLabel("Slug", { exact: true }).fill(`northstar-${unique}`);
  // A Swiss shop, which sells in two currencies from the first form it meets. The locale
  // answers the first — and reads back as the place it names — and the operator ticks the
  // second here rather than being sent to Shop details to add it after the fact.
  await createShop.getByLabel("Locale", { exact: true }).fill("de-CH");
  await expect(createShop.getByText("German (Switzerland)")).toBeVisible();
  const currencies = createShop.getByRole("group", { name: "Currencies" });
  await expect(currencies.getByRole("checkbox", { name: "CHF — Swiss franc" })).toBeChecked();
  await currencies.getByRole("checkbox", { name: "EUR — Euro" }).check();
  await createShop.getByRole("button", { name: "Create shop" }).click();

  await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
  await expect(page.getByText("Never published")).toBeVisible();
  await expect(page.getByRole("button", { name: "Publish v1" })).toBeDisabled();

  // Support knowledge and commerce configuration a published shop must carry.
  await openSection(page, "Policies & FAQ", "Policies & FAQ");
  const policies = card(page, "Policies");
  await policies.getByLabel("Title", { exact: true }).fill("Shipping policy");
  await policies
    .getByLabel("Body", { exact: true })
    .fill("A shipping address can change before dispatch.");
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

  // Catalog: one product with colour and size options and two priced variants.
  await openSection(page, "Products", "Products");
  const newProduct = card(page, "Add a product");
  await newProduct.getByLabel("Title", { exact: true }).fill("Alpine Shell Jacket");
  await newProduct.getByLabel("Category", { exact: true }).fill("Jackets");
  await expect(newProduct.getByLabel("Handle", { exact: true })).toHaveValue("alpine-shell-jacket");
  await newProduct.getByRole("button", { name: "Add to draft" }).click();
  await saveDraft(page);

  await page.getByRole("link", { name: "Alpine Shell Jacket" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Alpine Shell Jacket" })).toBeVisible();
  await card(page, "Details")
    .getByLabel("Description", { exact: true })
    .fill("Three-layer waterproof shell with taped seams.");

  const options = card(page, "Options");
  await options.getByLabel("Option name", { exact: true }).fill("Color");
  await options
    .getByLabel("Values (comma separated)", { exact: true })
    .fill("Ocean Blue, Charcoal");
  await expect(options.getByLabel("Option key", { exact: true })).toHaveValue("color");
  await options.getByRole("button", { name: "Add option" }).click();
  await options.getByLabel("Option name", { exact: true }).fill("Size");
  await options.getByLabel("Values (comma separated)", { exact: true }).fill("M, L");
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

  // Publish the whole shop, then read the frozen version back.
  await openSection(page, "Home", "Home");
  const publish = page.getByRole("button", { name: "Publish v1" });
  await expect(publish).toBeEnabled();
  await publish.click();

  await expect(page.getByText(/Published v1\. That version is immutable/)).toBeVisible();
  await expect(page.getByText(/Draft matches v1/)).toBeVisible();

  await page.getByRole("link", { name: "v1", exact: true }).click();
  await expect(page.getByText("published · read only")).toBeVisible();
  const frozen = page.getByRole("table");
  await expect(frozen.getByText("NS-ASJ-OB-M")).toBeVisible();
  await expect(frozen.getByText("Ocean Blue · M")).toBeVisible();
  await expect(frozen.getByText("Charcoal · L")).toBeVisible();
  await expect(frozen.getByText("249.00 CHF").first()).toBeVisible();
  await expect(frozen.getByText("249.00 EUR").first()).toBeVisible();
});
