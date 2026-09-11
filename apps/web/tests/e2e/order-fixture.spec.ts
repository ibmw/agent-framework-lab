import { expect, type Page, test } from "@playwright/test";

/**
 * Milestone 2 order-fixture acceptance evidence: an author builds the wrong-address
 * fixture — a paid, unfulfilled order shipping to the customer's stale address — and the
 * frozen copy survives an edit to the address-book entry it came from.
 */

function card(page: Page, name: string) {
  return page.getByRole("region", { name });
}

async function saveDraft(page: Page) {
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByRole("button", { name: "Saved" })).toBeDisabled();
}

async function openSection(page: Page, link: string, heading: string) {
  await page.getByRole("link", { name: link }).click();
  await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
}

async function addAddress(
  page: Page,
  entry: { label: string; street: string; postalCode: string; city: string },
) {
  const form = card(page, "Address book").getByRole("group", { name: "Add an address" });
  await form.getByLabel("Label", { exact: true }).fill(entry.label);
  await form.getByLabel("Street", { exact: true }).fill(entry.street);
  await form.getByLabel("Postal code", { exact: true }).fill(entry.postalCode);
  await form.getByLabel("City", { exact: true }).fill(entry.city);
  await form.getByLabel("Country", { exact: true }).fill("FR");
  await form.getByRole("button", { name: "Add address" }).click();
}

test("an author builds a paid order shipping to the customer's stale address", async ({ page }) => {
  const unique = Date.now().toString(36);

  await page.goto("/shops");
  const createShop = card(page, "Create a shop");
  await createShop.getByLabel("Name", { exact: true }).fill(`Northstar ${unique}`);
  await createShop.getByLabel("Slug", { exact: true }).fill(`northstar-${unique}`);
  await createShop.getByRole("button", { name: "Create shop" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();

  // An order selects its payment and fulfilment method from the shop's configuration.
  await openSection(page, "Shop details", "Shop details");
  const payments = card(page, "Payment methods");
  await payments.getByLabel("ID", { exact: true }).fill("card");
  await payments.getByLabel("Name", { exact: true }).fill("Card synthetic");
  await payments.getByRole("button", { name: "Add payment method" }).click();
  const fulfilment = card(page, "Fulfilment methods");
  await fulfilment.getByLabel("ID", { exact: true }).fill("standard");
  await fulfilment.getByLabel("Name", { exact: true }).fill("Standard 3-5 days");
  await fulfilment.getByLabel("Carrier", { exact: true }).fill("Nordic Post");
  await fulfilment.getByRole("button", { name: "Add fulfilment method" }).click();
  await saveDraft(page);

  // ...and its line items from the catalog.
  await openSection(page, "Products", "Products");
  const newProduct = card(page, "Add a product");
  await newProduct.getByLabel("Handle", { exact: true }).fill("alpine-shell-jacket");
  await newProduct.getByLabel("Title", { exact: true }).fill("Alpine Shell Jacket");
  await newProduct.getByLabel("Category", { exact: true }).fill("Jackets");
  await newProduct.getByRole("button", { name: "Add to draft" }).click();
  await saveDraft(page);

  await page.getByRole("link", { name: "Alpine Shell Jacket" }).click();
  const options = card(page, "Options");
  await options.getByLabel("Option key", { exact: true }).fill("color");
  await options.getByLabel("Option name", { exact: true }).fill("Color");
  await options.getByLabel("Values (comma separated)", { exact: true }).fill("Ocean Blue");
  await options.getByRole("button", { name: "Add option" }).click();
  const variants = card(page, "Variants");
  await variants.getByLabel("New variant SKU", { exact: true }).fill("NS-ASJ-OB-M");
  await variants.getByLabel("Price (optional)", { exact: true }).fill("249.00");
  await variants.getByRole("button", { name: "Add variant" }).click();
  await saveDraft(page);

  // A customer whose default address moved to Lyon while an old order still ships to Bordeaux.
  await openSection(page, "Customers", "Customers");
  const newCustomer = card(page, "New customer");
  await newCustomer.getByLabel("Given name", { exact: true }).fill("Maya");
  await newCustomer.getByLabel("Family name", { exact: true }).fill("Laurent");
  await newCustomer.getByLabel("Email", { exact: true }).fill(`maya.${unique}@example.org`);
  await newCustomer.getByRole("button", { name: "Create and attach" }).click();

  await page.getByRole("link", { name: "Maya Laurent" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Maya Laurent" })).toBeVisible();
  await addAddress(page, {
    label: "Home",
    street: "18 rue des Écoles",
    postalCode: "69005",
    city: "Lyon",
  });
  await addAddress(page, {
    label: "Bordeaux previous flat",
    street: "42 cours de la Marne",
    postalCode: "33800",
    city: "Bordeaux",
  });
  await saveDraft(page);

  // The order fixture itself.
  await openSection(page, "Orders", "Orders");
  const createOrder = card(page, "Create order");
  await createOrder.getByLabel("Customer", { exact: true }).selectOption({ label: "Maya Laurent" });
  await createOrder.getByLabel("Reference", { exact: true }).fill("NS-10482");
  await createOrder.getByRole("button", { name: "Create order" }).click();

  await page.getByRole("link", { name: "NS-10482" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "NS-10482" })).toBeVisible();
  await expect(card(page, "Findings").getByText(/must carry at least one line item/)).toBeVisible();

  const lines = card(page, "Line items & payment");
  await lines.getByLabel("Add product", { exact: true }).selectOption("NS-ASJ-OB-M");
  await lines.getByRole("button", { name: "Add line" }).click();
  await lines.getByLabel("Payment status", { exact: true }).selectOption("paid");
  await lines.getByLabel("Payment method", { exact: true }).selectOption("card");
  await lines.getByLabel("Paid at", { exact: true }).fill("2026-08-21T13:12");

  const shipping = card(page, "Fulfilment & shipping");
  await shipping.getByLabel("Fulfilment method", { exact: true }).selectOption("standard");
  await shipping.getByLabel("Ship to", { exact: true }).selectOption({
    label: "Bordeaux previous flat",
  });
  await expect(shipping.getByText(/Saving freezes a new copy/)).toBeVisible();

  await page.getByRole("button", { name: "Save order" }).click();
  await expect(page.getByRole("button", { name: "Saved" })).toBeDisabled();

  // Totals derive from the line item, and the address is a frozen, source-labeled copy.
  await expect(lines.getByText("249.00 EUR").first()).toBeVisible();
  await expect(shipping.getByText("Frozen copy")).toBeVisible();
  await expect(shipping.getByText(/42 cours de la Marne/)).toBeVisible();
  await expect(shipping.getByText(/Differs from the default “Home”/)).toBeVisible();
  await expect(shipping.getByText(/Address changes stay allowed/)).toBeVisible();

  // Editing the address-book entry never rewrites the order that froze a copy of it.
  await openSection(page, "Customers", "Customers");
  await page.getByRole("link", { name: "Maya Laurent" }).click();
  const bordeaux = card(page, "Address book")
    .getByRole("listitem")
    .filter({ has: page.getByLabel("Label for bordeaux-previous-flat") });
  await bordeaux.getByLabel("Street", { exact: true }).fill("1 rue Inconnue");
  await saveDraft(page);

  await openSection(page, "Orders", "Orders");
  await page.getByRole("link", { name: "NS-10482" }).click();
  await expect(card(page, "Fulfilment & shipping").getByText(/42 cours de la Marne/)).toBeVisible();
});
