import type { Page } from "@playwright/test";
import { expect, test } from "./support/e2e";

/**
 * Milestone 1 Slice 3 acceptance evidence: an author creates a synthetic customer inside a
 * shop, authors the address book and persona, publishes the profile, and the published
 * version stays frozen while the draft moves on.
 */

function card(page: Page, name: string) {
  return page.getByRole("region", { name });
}

async function saveDraft(page: Page) {
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText("All changes saved")).toBeVisible();
}

test("an author publishes a customer profile with an address book and persona", async ({
  page,
}) => {
  const unique = Date.now().toString(36);

  await page.goto("/shops");
  const createShop = card(page, "Create a shop");
  await createShop.getByLabel("Name", { exact: true }).fill(`Northstar ${unique}`);
  await createShop.getByLabel("Slug", { exact: true }).fill(`northstar-${unique}`);
  await createShop.getByRole("button", { name: "Create shop" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();

  await page.getByLabel("Shop workspace").getByRole("link", { name: "Customers" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Customers" })).toBeVisible();

  const newCustomer = card(page, "New customer");
  await newCustomer.getByLabel("Given name", { exact: true }).fill("Maya");
  await newCustomer.getByLabel("Family name", { exact: true }).fill("Laurent");
  await newCustomer.getByLabel("Email", { exact: true }).fill(`maya.${unique}@example.org`);
  await newCustomer.getByRole("button", { name: "Create and attach" }).click();

  await page.getByRole("link", { name: "Maya Laurent" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Maya Laurent" })).toBeVisible();
  await expect(page.getByText("Never published")).toBeVisible();

  // A brand-new profile cannot be published: no address, no persona summary.
  const gate = card(page, "Publish gate");
  await expect(gate.getByText(/must hold at least one address/)).toBeVisible();
  await expect(gate.getByText(/must describe how the customer behaves/)).toBeVisible();

  const addressBook = card(page, "Address book");
  const addAddress = addressBook.getByRole("group", { name: "Add an address" });
  await addAddress.getByLabel("Label", { exact: true }).fill("Home");
  await addAddress.getByLabel("Street", { exact: true }).fill("18 rue des Écoles");
  await addAddress.getByLabel("Postal code", { exact: true }).fill("69005");
  await addAddress.getByLabel("City", { exact: true }).fill("Lyon");
  // Typed as a country is typed, and read back as the country it names rather than left as
  // two letters the author has to trust they got right.
  const country = addAddress.getByLabel("Country", { exact: true });
  await country.fill("fr");
  await expect(country).toHaveValue("FR");
  await expect(addAddress.getByText("France", { exact: true })).toBeVisible();
  await addAddress.getByRole("button", { name: "Add address" }).click();
  await expect(addressBook.getByText("Default")).toBeVisible();

  const persona = card(page, "Behavioral persona");
  await persona
    .getByLabel("Summary", { exact: true })
    .fill("Direct, mildly anxious under uncertainty; wants quick, concrete answers.");
  await persona.getByLabel("New trait", { exact: true }).fill("direct");
  await persona.getByRole("button", { name: "Add trait" }).click();
  // The chip is named after what it removes, not after its glyph.
  await expect(persona.getByRole("button", { name: "Remove direct" })).toBeVisible();
  // And the same trait twice is refused where it was typed.
  await persona.getByLabel("New trait", { exact: true }).fill("direct");
  await expect(persona.getByText("direct is already a trait of this persona.")).toBeVisible();
  await persona.getByRole("button", { name: "Add trait" }).click();
  await expect(persona.getByRole("button", { name: "Remove direct" })).toHaveCount(1);
  await persona.getByLabel("New trait", { exact: true }).fill("");

  await saveDraft(page);

  const publish = page.getByRole("button", { name: "Publish v1" });
  await expect(publish).toBeEnabled();
  await publish.click();
  await expect(page.getByText(/Published version 1/)).toBeVisible();
  await expect(page.getByText(/Draft matches v1/)).toBeVisible();

  // The draft moves on; the published version keeps what it froze.
  await addAddress.getByLabel("Label", { exact: true }).fill("Office");
  await addAddress.getByLabel("Street", { exact: true }).fill("12 quai Perrache");
  await addAddress.getByLabel("Postal code", { exact: true }).fill("69002");
  await addAddress.getByLabel("City", { exact: true }).fill("Lyon");
  await addAddress.getByRole("button", { name: "Add address" }).click();
  await saveDraft(page);
  await expect(page.getByText(/Draft v2 in progress/)).toBeVisible();
  await expect(page.getByText(/Publishing draft v2 does not change/)).toBeVisible();
});
