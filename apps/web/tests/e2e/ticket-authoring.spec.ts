import type { Page } from "@playwright/test";
import { createShop } from "./support/authoring";
import { expect, test } from "./support/e2e";
import { openSection } from "./support/navigate";

/**
 * The page's publication notice. Every editor header now reports "All changes saved" as a
 * status line of its own (PLAN-UX Slice 8), so a query for "the page's status" says which.
 */
function publicationNotice(page: Page) {
  return page.getByRole("status").filter({ hasText: "Published version" });
}

/**
 * Milestone 2 ticket acceptance evidence: an author opens the wrong-address incident on one
 * shop's customer, authors the prior history and the triggering first message every arm will
 * receive, links the stale-address order, and publishes. The published version then stays
 * frozen while the draft moves on — which is exactly what a scenario built on it will pin.
 */

function card(page: Page, name: string) {
  return page.getByRole("region", { name });
}

async function saveDraft(page: Page) {
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText("All changes saved")).toBeVisible();
}

async function addMessage(page: Page, role: string, body: string, sentAt: string) {
  const thread = card(page, "Ticket thread");
  await thread.getByRole("button", { name: role }).click();
  await thread.getByLabel("Sent at", { exact: true }).fill(sentAt);
  await thread.getByLabel("Add a history message", { exact: true }).fill(body);
  await thread.getByRole("button", { name: "Add to thread" }).click();
}

test("an author publishes the wrong-address ticket for one shop's customer", async ({ page }) => {
  const unique = Date.now().toString(36);

  await createShop(page, { name: `Northstar ${unique}`, slug: `northstar-${unique}` });

  // A ticket suggests the shop's own documents and pins the shop version it was authored
  // against, so the shop is completed and published first.
  await openSection(page, "Policies & FAQ", "Policies & FAQ");
  const policies = card(page, "Policies");
  await policies.getByLabel("Title", { exact: true }).fill("Address-change policy");
  await policies.getByLabel("ID", { exact: true }).fill("address-change");
  await policies
    .getByLabel("Body", { exact: true })
    .fill("A shipping address can change before dispatch.");
  await policies.getByRole("button", { name: "Add policy" }).click();
  await saveDraft(page);

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

  await openSection(page, "Tone of voice", "Tone of voice");
  const tone = card(page, "Guidelines");
  await tone.getByLabel("Name", { exact: true }).fill("Warm and precise");
  await tone.getByLabel("Guidance", { exact: true }).fill("Be concise, warm, and specific.");
  await tone.getByRole("button", { name: "Add tone of voice" }).click();
  await saveDraft(page);

  await openSection(page, "Products", "Products");
  // *New product* appends an empty product to the shop draft and opens its editor, where
  // the title, the category and the handle it derives are authored (PLAN-UX Slice 12).
  await page.getByRole("button", { name: "New product" }).click();
  const identity = card(page, "Details");
  await identity.getByLabel("Title", { exact: true }).fill("Alpine Shell Jacket");
  await identity.getByLabel("Category", { exact: true }).fill("Jackets");
  await expect(identity.getByLabel("Handle", { exact: true })).toHaveValue("alpine-shell-jacket");
  await saveDraft(page);
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

  await openSection(page, "Overview", "Home");
  await page.getByRole("button", { name: "Publish v1" }).click();
  await expect(page.getByText(/Published v1\. That version is immutable/)).toBeVisible();

  // The customer the incident is about; a published ticket pins an exact profile version.
  await openSection(page, "Customers", "Customers");
  // Creating a profile is a page that lands in its editor (PLAN-UX Slice 12), so the
  // journey no longer walks back to the index to open what it just made.
  await page.getByRole("link", { name: "New customer" }).click();
  await page.getByLabel("Given name", { exact: true }).fill("Maya");
  await page.getByLabel("Family name", { exact: true }).fill("Laurent");
  await page.getByLabel("Email", { exact: true }).fill(`maya.${unique}@example.org`);
  await page.getByRole("button", { name: "Create profile" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Maya Laurent" })).toBeVisible();

  const addAddress = card(page, "Address book").getByRole("group", { name: "Add an address" });
  await addAddress.getByLabel("Label", { exact: true }).fill("Bordeaux previous flat");
  await addAddress.getByLabel("Street", { exact: true }).fill("42 cours de la Marne");
  await addAddress.getByLabel("Postal code", { exact: true }).fill("33800");
  await addAddress.getByLabel("City", { exact: true }).fill("Bordeaux");
  await addAddress.getByLabel("Country", { exact: true }).fill("FR");
  await addAddress.getByRole("button", { name: "Add address" }).click();
  await card(page, "Behavioral persona")
    .getByLabel("Summary", { exact: true })
    .fill("Direct, mildly anxious under uncertainty; wants quick, concrete answers.");
  await saveDraft(page);
  await page.getByRole("button", { name: "Publish v1" }).click();
  await expect(page.getByText(/Published version 1/)).toBeVisible();

  // The order the incident is about, shipping to the stale address.
  await openSection(page, "Orders", "Orders");
  // The create page will not go without a line and takes the shipping address from the
  // customer's own book, so both are answered on the way in and the editor is left with the
  // fixture's state (PLAN-UX Slice 12).
  await page.getByRole("link", { name: "New order" }).click();
  await page.getByLabel("Customer", { exact: true }).selectOption({ label: "Maya Laurent" });
  await expect(page.getByLabel("Reference", { exact: true })).toHaveValue(/^[A-Z0-9]+-1$/);
  await page.getByLabel("Reference", { exact: true }).fill("NS-10482");
  await page.getByLabel("Variant", { exact: true }).selectOption("NS-ASJ-OB-M");
  await page.getByRole("radio", { name: /Bordeaux previous flat/ }).check();
  await page.getByRole("button", { name: "Create order" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "NS-10482" })).toBeVisible();
  const lines = card(page, "Line items & payment");
  await lines.getByLabel("Payment status", { exact: true }).selectOption("paid");
  await lines.getByLabel("Payment method", { exact: true }).selectOption("card");
  await lines.getByLabel("Paid at", { exact: true }).fill("2026-08-21T13:12");
  const shipping = card(page, "Fulfilment & shipping");
  await shipping.getByLabel("Fulfilment method", { exact: true }).selectOption("standard");
  // The frozen copy the create page already selected, read off the card rather than
  // re-chosen: the *Ship to* select offers the same label, so the street is what says
  // which entry this order actually froze.
  await expect(shipping.getByText(/42 cours de la Marne/)).toBeVisible();
  await page.getByRole("button", { name: "Save order" }).click();
  await expect(page.getByText("All changes saved")).toBeVisible();

  // The incident itself.
  await page.getByLabel("Shop workspace").getByRole("link", { name: "Tickets" }).click();
  const list = card(page, "Tickets");
  await expect(list.getByRole("heading", { name: "Tickets" })).toBeVisible();
  await expect(list.getByLabel("Reference", { exact: true })).toHaveValue("T-1");
  await list.getByLabel("Reference", { exact: true }).fill("T-204");
  await list.getByLabel("Subject", { exact: true }).fill("Wrong address concern");
  await list.getByLabel("Customer", { exact: true }).selectOption({ label: "Maya Laurent" });
  await list.getByRole("button", { name: "Open ticket" }).click();

  await expect(page.getByRole("heading", { name: /T-204 · Wrong address concern/ })).toBeVisible();
  const thread = card(page, "Ticket thread");
  await expect(thread.getByText(/No first message yet/)).toBeVisible();
  await expect(
    card(page, "Validation").getByText(/must carry the first message every arm receives/),
  ).toBeVisible();

  // Prior support history first, then the triggering first message.
  await addMessage(
    page,
    "as past support",
    "Your order is confirmed and paid.",
    "2026-08-21T09:16",
  );
  await addMessage(
    page,
    "as Maya Laurent",
    "I just noticed this is going to my old address. Can you change it before it ships?",
    "2026-08-21T13:40",
  );
  await expect(thread.getByText("first message")).toBeVisible();
  await expect(thread.getByText(/prior support history/i)).toBeVisible();

  // The incident points at the order the agent has to resolve, and at the document a
  // scenario built on this ticket would inherit as context.
  const details = card(page, "Ticket details");
  await details.getByLabel("Opened from", { exact: true }).selectOption("order_page");
  await details.getByLabel("Order", { exact: true }).selectOption({ label: "NS-10482" });
  await card(page, "Linked objects").getByLabel("NS-10482").check();
  await card(page, "Suggested documents")
    .getByLabel(/address-change/)
    .check();

  await saveDraft(page);
  await expect(card(page, "Validation").getByText("No validation findings.")).toBeVisible();
  await expect(
    card(page, "Linked objects").getByText(/ship-to: Bordeaux previous flat/),
  ).toBeVisible();

  await page.getByRole("button", { name: "Publish v1" }).click();
  await expect(publicationNotice(page)).toContainText(
    "A scenario built on this ticket freezes this exact version",
  );

  // The published version stays frozen while the draft moves on.
  await details.getByLabel("Subject", { exact: true }).fill("Something else entirely");
  await saveDraft(page);
  await expect(page.getByText("v1 published")).toBeVisible();
  await expect(page.getByText("Draft v2 in progress")).toBeVisible();
});
