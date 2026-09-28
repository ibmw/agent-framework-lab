import type { Page } from "@playwright/test";
import { addDocument, createBlock, createScenario, createShop } from "./support/authoring";
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
 * Milestone 2 scenario acceptance evidence: an author composes the wrong-address recipe on a
 * published ticket — the context document the incident turns on, a read-check bound to that
 * document, a fault bound to the stale-address order — publishes it, and freezes that version
 * into canonical starting state. The frozen version pins the shop, ticket, and template
 * versions it composed and keeps them while every draft around it moves on; the snapshot then
 * records those pins and copies the order fixture nothing pinned.
 *
 * The journey builds the whole chain because a scenario is the first definition that composes
 * all of them: nothing here can be stubbed without stubbing the thing under test.
 */

function card(page: Page, name: string) {
  return page.getByRole("region", { name });
}

async function saveDraft(page: Page) {
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText("All changes saved")).toBeVisible();
}

/** The shop, customer, order, and ticket a scenario is built on, all published. */
async function buildIncident(page: Page, unique: string) {
  await createShop(page, { name: `Northstar ${unique}`, slug: `northstar-${unique}` });

  await addDocument(page, {
    kind: "Policy",
    title: "Address-change policy",
    slug: "address-change",
    body: "A shipping address can change before dispatch.",
  });

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

  await openSection(page, "Tone of voice", "Tone of voice");
  const tone = card(page, "Guidelines");
  await tone.getByLabel("ID", { exact: true }).fill("warm-precise");
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
  await options.getByLabel("Option key", { exact: true }).fill("color");
  await options.getByLabel("Option name", { exact: true }).fill("Color");
  await options.getByLabel("New value", { exact: true }).fill("Ocean Blue");
  await options.getByRole("button", { name: "Add value" }).click();
  await options.getByRole("button", { name: "Add option" }).click();
  const variants = card(page, "Variants");
  await variants.getByLabel("New variant SKU", { exact: true }).fill("NS-ASJ-OB-M");
  await variants.getByLabel("Price (optional)", { exact: true }).fill("249.00");
  await variants.getByRole("button", { name: "Add variant" }).click();
  await saveDraft(page);

  await openSection(page, "Overview", "Overview");
  // Publishing the shop takes two presses now: the review of what becomes v1, and the
  // Publish inside it (PLAN-UX Slice 15).
  await page.getByRole("button", { name: /^Review .+ & publish$/ }).click();
  await page.getByRole("button", { name: "Publish v1" }).click();
  await expect(page.getByText(/v1 is published\./)).toBeVisible();

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
  // Where Maya actually lives now. The incident needs both: without somewhere correct to
  // move to, there is no change for an agent to propose.
  await addAddress.getByLabel("Label", { exact: true }).fill("Home");
  await addAddress.getByLabel("Street", { exact: true }).fill("18 rue des Ecoles");
  await addAddress.getByLabel("Postal code", { exact: true }).fill("69005");
  await addAddress.getByLabel("City", { exact: true }).fill("Lyon");
  await addAddress.getByLabel("Country", { exact: true }).fill("FR");
  await addAddress.getByRole("button", { name: "Add address" }).click();
  await card(page, "Behavioral persona")
    .getByLabel("Summary", { exact: true })
    .fill("Direct, mildly anxious under uncertainty; wants quick, concrete answers.");
  await saveDraft(page);
  await page.getByRole("button", { name: "Publish v1" }).click();
  await expect(page.getByText(/Published version 1/)).toBeVisible();

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

  // Opening a ticket is a page that lands in its editor (ADR 0073).
  await page.getByLabel("Shop workspace").getByRole("link", { name: "Tickets" }).click();
  await page.getByRole("link", { name: "New ticket" }).click();
  await expect(page.getByLabel("Reference", { exact: true })).not.toHaveValue("");
  await page.getByLabel("Reference", { exact: true }).fill("T-204");
  await page.getByLabel("Subject", { exact: true }).fill("Wrong address concern");
  await page.getByLabel("Customer", { exact: true }).selectOption({ label: "Maya Laurent" });
  await page.getByRole("button", { name: "Create ticket" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Wrong address concern" }),
  ).toBeVisible();

  const thread = card(page, "Conversation");
  await thread.getByRole("button", { name: "as Maya Laurent" }).click();
  await thread.getByLabel("Sent at", { exact: true }).fill("2026-08-21T13:40");
  await thread
    .getByLabel("Add a history message", { exact: true })
    .fill("I just noticed this is going to my old address. Can you change it before it ships?");
  await thread.getByRole("button", { name: "Add to thread" }).click();

  const incident = card(page, "Incident");
  await incident.getByLabel("Opened from", { exact: true }).selectOption("order_page");
  await incident.getByLabel("Order", { exact: true }).selectOption({ label: "NS-10482" });
  await card(page, "Linked orders").getByLabel("NS-10482").check();
  // The suggestion is what pre-fills the scenario's context documents.
  await card(page, "Suggested documents")
    .getByLabel(/^Address-change policy/)
    .check();
  await saveDraft(page);
  await page.getByRole("button", { name: "Publish v1" }).click();
  await expect(publicationNotice(page)).toContainText(
    "A scenario built on this ticket freezes this exact version",
  );
}

/** The published identity a write runs under: it may read orders, and change where one ships. */
async function publishSupportIdentity(page: Page, name: string) {
  await openSection(page, "Support identities", "Support identities");
  // The library's create page is the lab's, and it lands in the identity's editor
  // (PLAN-UX Slice 12, ADR 0054).
  await page.getByRole("link", { name: "New identity" }).click();
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByLabel("Role title", { exact: true }).fill("Customer support representative");
  await page.getByRole("button", { name: "Create identity" }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();

  const permissions = card(page, "Permissions");
  // `change shipping address` acts on an order, so publishing refuses it without
  // `read orders`: a mutation the identity cannot first read would be unauditable.
  await permissions.getByLabel(/^Read orders —/).check();
  await permissions.getByLabel(/^Read policies —/).check();
  await permissions.getByLabel(/^Change shipping address —/).check();
  await saveDraft(page);
  await page.getByRole("button", { name: "Publish v1" }).click();
  await expect(page.getByText(/Published version 1/)).toBeVisible();
}

/** The two templates the recipe composes, both published so a scenario can pin them. */
async function publishTemplates(page: Page, objective: string, mutation: string) {
  // Creating is a page, and the parameters a scenario will bind are answered on it
  // (PLAN-UX Slice 13); what each one means is the editor's.
  await createBlock(page, {
    library: "Objective blocks",
    name: objective,
    parameters: [{ label: "doc_ref", kind: "document_reference" }],
  });
  const objectiveTemplate = card(page, "Template");
  await objectiveTemplate.getByLabel("Statement", { exact: true }).fill("Read document");
  await objectiveTemplate
    .getByLabel("Description", { exact: true })
    .fill("Passes when the arm reads the bound document through its tool before the run ends.");
  const objectiveParameters = card(page, "Parameters");
  await objectiveParameters
    .getByLabel("Description of doc_ref", { exact: true })
    .fill("The shop document the arm has to read.");
  await saveDraft(page);
  await page.getByRole("button", { name: "Publish v1" }).click();
  await expect(publicationNotice(page)).toContainText("Published version 1");

  await createBlock(page, {
    library: "Mutation blocks",
    name: mutation,
    parameters: [
      { label: "entity_ref", kind: "entity_reference" },
      { label: "timing", kind: "timing" },
    ],
  });
  const mutationTemplate = card(page, "Template");
  await mutationTemplate.getByLabel("Statement", { exact: true }).fill("Concurrent mutation of");
  await mutationTemplate
    .getByLabel("Description", { exact: true })
    .fill("Mutates the bound entity out of band, bumping the version the arm holds.");
  const mutationParameters = card(page, "Parameters");
  await mutationParameters
    .getByLabel("Description of entity_ref", { exact: true })
    .fill("The order that moves under the arm.");
  await mutationParameters
    .getByLabel("Description of timing", { exact: true })
    .fill("When the runtime injects the mutation.");
  await mutationParameters
    .getByLabel("Default of timing", { exact: true })
    .fill("after_first_read");
  await saveDraft(page);
  await page.getByRole("button", { name: "Publish v1" }).click();
  await expect(publicationNotice(page)).toContainText("Published version 1");
}

test("an author composes and publishes the wrong-address scenario", async ({ page }) => {
  // The longest journey in the suite by design: it builds the shop, the customer, the order,
  // the ticket, the identity, and both templates before the scenario it is about exists at
  // all, then carries that scenario through to a change applied inside one arm. Nothing here
  // can be stubbed without stubbing the thing under test, so it is given the room instead.
  test.slow();
  const unique = Date.now().toString(36);
  // The block libraries are cross-shop and the suite runs fully parallel, so the template
  // names carry this journey's own prefix: two specs starting in the same millisecond would
  // otherwise race for one name and each end up editing the other's block.
  const objective = `scenario-read-required-document-${unique}`;
  const mutation = `scenario-concurrent-entity-mutation-${unique}`;
  const identity = `scenario-tier-1-${unique}`;

  await buildIncident(page, unique);
  await publishSupportIdentity(page, identity);
  await publishTemplates(page, objective, mutation);

  // The recipe itself, built on the ticket and never moving off it. Creating it is a page
  // that composes the objective and lands in the editor of what it made (PLAN-UX Slice 14):
  // the customer and the shop version are read off the ticket and the shop rather than typed.
  await createScenario(page, {
    name: "Wrong shipping address",
    ticket: "T-204",
    composes: [objective],
    reads: { customer: "Maya Laurent", shopVersion: "v1" },
  });

  // The objective the create page composed is here, and the gate names the binding it owes
  // rather than saying the recipe asserts nothing.
  const gate = card(page, "Publish gate");
  await expect(
    gate.getByText(/doc_ref is required and the template carries no default/),
  ).toBeVisible();
  await expect(gate.getByText(/must say what a resolved incident looks like/)).toBeVisible();
  // The ticket's suggestion pre-filled the context, so the incident already names its document.
  const documents = card(page, "Context documents");
  await expect(documents.getByLabel("Address-change policy")).toBeChecked();

  const objectives = card(page, "Objectives");
  await objectives
    .getByLabel(`doc_ref of ${objective}`, { exact: true })
    .selectOption("policy:address-change");
  // The read-check now shows against the document it reads.
  await expect(documents.getByText("read-check → objective 1")).toBeVisible();

  const mutations = card(page, "Mutations");
  await mutations
    .getByLabel("Add mutation block", { exact: true })
    .selectOption({ label: `${mutation} — v1` });
  await mutations.getByRole("button", { name: "Add" }).click();
  const entityPicker = mutations.getByLabel(`entity_ref of ${mutation}`, { exact: true });
  await entityPicker.selectOption({ label: "Order NS-10482 — paid, unfulfilled" });
  await expect(mutations.getByLabel(`timing of ${mutation}`, { exact: true })).toHaveValue(
    "after_first_read",
  );

  await card(page, "Hidden facts — operator only")
    .getByLabel("Hidden facts", { exact: true })
    .fill("Maya confirms the Lyon address if asked and never volunteers it.");
  const completion = card(page, "Completion");
  await completion
    .getByLabel("A resolved incident looks like", { exact: true })
    .fill("The order ships to the confirmed address and the customer acknowledges it.");

  await saveDraft(page);
  await expect(gate.getByText("No validation findings.")).toBeVisible();

  // The resolved state names every version publishing would pin.
  const resolved = card(page, "Resolved-state preview");
  await expect(resolved.getByText("T-204")).toBeVisible();
  await expect(resolved.getByText(/Address-change policy/)).toBeVisible();
  await expect(resolved.getByText("NS-10482")).toBeVisible();
  await expect(resolved.getByText(objective)).toBeVisible();

  await page.getByRole("button", { name: "Publish v1" }).click();
  await expect(publicationNotice(page)).toContainText("Published version 1");

  // A published version is a recipe, not starting state: freezing it settles the orders it
  // only names, and the snapshot separates what it pinned from what it had to copy.
  await page.getByRole("link", { name: "Freeze it into starting state" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Starting states" })).toBeVisible();
  await expect(page.getByLabel("Scenario version")).toHaveValue("1");
  await page.getByRole("button", { name: "Freeze snapshot" }).click();

  const pins = card(page, "Pinned versions");
  await expect(pins.getByText("shop")).toBeVisible();
  await expect(pins.getByText("ticket")).toBeVisible();
  await expect(pins.getByText("scenario")).toBeVisible();
  const copied = card(page, "Copied orders");
  await expect(copied.getByText("NS-10482")).toBeVisible();
  await expect(copied.getByText(/Bordeaux/)).toBeVisible();

  // Freezing the same version, seed, and orders is the same starting state, not a second one.
  await page.getByRole("button", { name: "Freeze snapshot" }).click();
  await expect(card(page, "Snapshots").getByRole("row")).toHaveCount(2);

  // A snapshot is shared starting state; an arm works in its own clone of it. Two arms of one
  // snapshot therefore begin at the same current-state fingerprint.
  const armsCard = card(page, "Sandbox arms");
  await armsCard.getByLabel("Arm label", { exact: true }).fill("Arm A");
  await armsCard.getByRole("button", { name: "Clone sandbox" }).click();
  await expect(armsCard.getByText("Arm A")).toBeVisible();
  await armsCard.getByLabel("Arm label", { exact: true }).fill("Arm B");
  await armsCard.getByRole("button", { name: "Clone sandbox" }).click();
  await expect(armsCard.getByText("Arm B")).toBeVisible();

  const armFingerprints = await armsCard.locator("tbody code").allTextContents();
  expect(armFingerprints).toHaveLength(2);
  expect(armFingerprints[0]).toBe(armFingerprints[1]);

  // The one commerce mutation an arm may make, taken the way the agent will take it: read
  // the order, propose the change under an identity permitted to make it, then apply the
  // confirmation that proposal answered with.
  await armsCard.getByRole("button", { name: "Arm A" }).click();
  const tools = card(page, "Tools · Arm A");
  await tools.getByLabel("Tool", { exact: true }).selectOption("orders.read_order");
  await tools.getByLabel("Order reference", { exact: true }).fill("NS-10482");
  await tools.getByRole("button", { name: "Run tool" }).click();
  await expect(tools.getByRole("region", { name: "orders.read_order result" })).toContainText(
    "Bordeaux",
  );

  await tools.getByLabel("Tool", { exact: true }).selectOption("orders.propose_address_change");
  await tools.getByLabel("Acting support identity", { exact: true }).selectOption({
    label: `${identity} · v1`,
  });
  await tools.getByLabel("Order reference", { exact: true }).fill("NS-10482");
  await tools.getByLabel("Address ID (required)", { exact: true }).fill("home");
  await tools.getByRole("button", { name: "Run tool" }).click();
  const proposal = tools.getByRole("region", { name: "orders.propose_address_change result" });
  await expect(proposal).toContainText("Bordeaux");
  await expect(proposal).toContainText("Lyon");
  // Proposing moved nothing: both arms are still where they were cloned.
  await expect(armsCard.getByText("r0")).toHaveCount(2);

  await tools.getByRole("button", { name: "Apply this change" }).click();
  await expect(
    tools.getByRole("region", { name: "orders.apply_address_change result" }),
  ).toContainText("Lyon");

  // One arm moved, and only that arm. The revisions and the fingerprints both say so.
  await expect(armsCard.getByText("r1")).toHaveCount(1);
  await expect(armsCard.getByText("r0")).toHaveCount(1);
  const afterWrite = await armsCard.locator("tbody code").allTextContents();
  expect(afterWrite[0]).not.toBe(afterWrite[1]);

  // And the arm beside it still reads the address the incident is about.
  await armsCard.getByRole("button", { name: "Arm B" }).click();
  const otherArm = card(page, "Tools · Arm B");
  await otherArm.getByLabel("Tool", { exact: true }).selectOption("orders.read_order");
  await otherArm.getByLabel("Order reference", { exact: true }).fill("NS-10482");
  await otherArm.getByRole("button", { name: "Run tool" }).click();
  await expect(otherArm.getByRole("region", { name: "orders.read_order result" })).toContainText(
    "Bordeaux",
  );

  // The frozen version keeps what it froze while the draft moves on.
  await page.getByRole("link", { name: "Back to Wrong shipping address" }).click();
  const turnCap = card(page, "Completion").getByLabel("Turn cap", { exact: true });
  await turnCap.fill("20");
  await saveDraft(page);
  await expect(page.getByText("v1 published")).toBeVisible();
  await expect(page.getByText("Draft v2 in progress")).toBeVisible();
});
