import type { Page } from "@playwright/test";
import {
  addProduct,
  createCustomer,
  createOrder,
  createShop,
  editRow,
  saveDraft,
} from "./support/authoring";
import { expect, test } from "./support/e2e";
import { openSection } from "./support/navigate";

/**
 * Milestone 2 order-fixture acceptance evidence: an author builds the wrong-address
 * fixture — a paid, unfulfilled order shipping to the customer's stale address — and the
 * frozen copy survives an edit to the address-book entry it came from.
 */

function card(page: Page, name: string) {
  return page.getByRole("region", { name });
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

  // Said rather than defaulted into. The form ticks the locale's currency for you, so a
  // journey that asserts a price in euros ticks EUR itself and unticks the pound `en-GB`
  // suggested; the shop sells in euros because this test said so, and one currency left
  // means the variant form asks for none.
  await createShop(page, {
    name: `Northstar ${unique}`,
    slug: `northstar-${unique}`,
    sells: { code: "EUR", insteadOf: "GBP" },
  });

  // An order selects its payment and fulfilment method from the shop's configuration.
  await openSection(page, "Shop details", "Shop details");
  const payments = card(page, "Payment methods");
  await payments.getByLabel("Name", { exact: true }).fill("Card synthetic");
  await payments.getByLabel("ID", { exact: true }).fill("card");
  await payments.getByRole("button", { name: "Add payment method" }).click();
  const fulfilment = card(page, "Fulfilment methods");
  await fulfilment.getByLabel("Name", { exact: true }).fill("Standard 3-5 days");
  await fulfilment.getByLabel("ID", { exact: true }).fill("standard");
  await fulfilment.getByLabel("Carrier", { exact: true }).fill("Nordic Post");
  await fulfilment.getByRole("button", { name: "Add fulfilment method" }).click();
  await saveDraft(page);

  // ...and its line items from the catalog. *New product* appends an empty product and
  // opens its editor, where the title and the category are authored (PLAN-UX Slice 12).
  await addProduct(page, { title: "Alpine Shell Jacket", category: "Jackets" });

  const options = card(page, "Options");
  await options.getByLabel("Option name", { exact: true }).fill("Color");
  await options.getByLabel("New value", { exact: true }).fill("Ocean Blue");
  await options.getByRole("button", { name: "Add value" }).click();
  await options.getByRole("button", { name: "Add option" }).click();
  const variants = card(page, "Variants");
  await variants.getByLabel("New variant SKU", { exact: true }).fill("NS-ASJ-OB-M");
  await variants.getByLabel("Price (optional)", { exact: true }).fill("249.00");
  await variants.getByRole("button", { name: "Add variant" }).click();
  await saveDraft(page);

  // A customer whose default address moved to Lyon while an old order still ships to Bordeaux.
  await createCustomer(page, {
    givenName: "Maya",
    familyName: "Laurent",
    email: `maya.${unique}@example.org`,
  });
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

  // The order fixture itself. An order cannot be created without a line, so the line the
  // editor used to take is answered on the way in, and so is the stale address it ships to:
  // the create page chooses an entry from the customer's own book (PLAN-UX Slice 12).
  await createOrder(page, {
    reference: "NS-10482",
    customer: "Maya Laurent",
    variant: "Alpine Shell Jacket · NS-ASJ-OB-M",
    address: "Bordeaux previous flat",
  });

  const lines = card(page, "Line items & payment");
  await lines.getByLabel("Payment status", { exact: true }).selectOption("paid");
  await lines.getByLabel("Payment method", { exact: true }).selectOption("card");
  await lines.getByLabel("Paid at", { exact: true }).fill("2026-08-21T13:12");

  const shipping = card(page, "Fulfilment & shipping");
  await shipping.getByLabel("Fulfilment method", { exact: true }).selectOption("standard");
  // The frozen copy is already the Bordeaux one the create page selected.
  await expect(shipping.getByText(/42 cours de la Marne/)).toBeVisible();

  await page.getByRole("button", { name: "Save order" }).click();
  await expect(page.getByText("All changes saved")).toBeVisible();

  // Totals derive from the line item, and the address is a frozen, source-labeled copy.
  await expect(lines.getByText("249.00 EUR").first()).toBeVisible();
  await expect(shipping.getByText("Frozen copy")).toBeVisible();
  await expect(shipping.getByText(/42 cours de la Marne/)).toBeVisible();
  await expect(shipping.getByText(/Differs from the default “Home”/)).toBeVisible();
  await expect(shipping.getByText(/Address changes stay allowed/)).toBeVisible();

  // Editing the address-book entry never rewrites the order that froze a copy of it.
  await openSection(page, "Customers", "Customers");
  await page.getByRole("link", { name: "Maya Laurent" }).click();
  // A saved entry opens where it stands, and its Save writes the correction into the draft.
  const book = card(page, "Address book");
  await editRow(book, "Bordeaux previous flat", async (row) => {
    await row.getByLabel("Street", { exact: true }).fill("1 rue Inconnue");
  });
  await expect(book.getByText(/1 rue Inconnue/)).toBeVisible();
  await saveDraft(page);

  await openSection(page, "Orders", "Orders");
  await page.getByRole("link", { name: "NS-10482" }).click();
  await expect(card(page, "Fulfilment & shipping").getByText(/42 cours de la Marne/)).toBeVisible();
});
