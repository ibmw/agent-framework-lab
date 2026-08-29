import { expect, type Page, test } from "@playwright/test";

/**
 * Milestone 3 Slice 2 acceptance evidence: an operator starts one experiment on a published
 * scenario version with two published agent configurations, reads the comparison matrix
 * before anything is frozen, and finds both arms opening on the ticket's triggering message
 * from one shared starting state — then sends one message to both arms and one to a single
 * arm, and the record keeps them apart.
 *
 * The journey builds the whole chain because an experiment is what composes all of it: the
 * scenario, the arms, and the participant are the three things it binds, and none of them
 * can be stubbed without stubbing the thing under test.
 */

function card(page: Page, name: string) {
  return page.getByRole("region", { name });
}

async function saveDraft(page: Page) {
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByRole("button", { name: "Saved" })).toBeDisabled();
}

async function openSection(page: Page, link: string, heading: string) {
  // Scoped to the sidebar: an editor may link to the same section in its own body, and this
  // journey crosses more sections than any other in the suite.
  await page.getByLabel("Shop workspace").getByRole("link", { name: link }).click();
  await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
}

/** The shop, customer, order, and ticket a scenario is built on, all published. */
async function buildIncident(page: Page, unique: string) {
  await page.goto("/shops");
  const createShop = card(page, "Create a shop");
  await createShop.getByLabel("Name", { exact: true }).fill(`Northstar ${unique}`);
  await createShop.getByLabel("Slug", { exact: true }).fill(`northstar-${unique}`);
  await createShop.getByRole("button", { name: "Create shop" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();

  await openSection(page, "Policies & FAQ", "Policies & FAQ");
  const policies = card(page, "Policies");
  await policies.getByLabel("ID", { exact: true }).fill("address-change");
  await policies.getByLabel("Title", { exact: true }).fill("Address-change policy");
  await policies
    .getByLabel("Body", { exact: true })
    .fill("A shipping address can change before dispatch.");
  await policies.getByRole("button", { name: "Add policy" }).click();
  await saveDraft(page);

  await openSection(page, "Settings", "Settings");
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

  await openSection(page, "Home", "Home");
  await page.getByRole("button", { name: "Publish v1" }).click();
  await expect(page.getByText(/Published v1\. That version is immutable/)).toBeVisible();

  await openSection(page, "Customers", "Customers");
  const newCustomer = card(page, "New customer");
  await newCustomer.getByLabel("Given name", { exact: true }).fill("Maya");
  await newCustomer.getByLabel("Family name", { exact: true }).fill("Laurent");
  await newCustomer.getByLabel("Email", { exact: true }).fill(`maya.${unique}@example.org`);
  await newCustomer.getByRole("button", { name: "Create and attach" }).click();
  await page.getByRole("link", { name: "Maya Laurent" }).click();
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
  const createOrder = card(page, "Create order");
  await createOrder.getByLabel("Customer", { exact: true }).selectOption({ label: "Maya Laurent" });
  await createOrder.getByLabel("Reference", { exact: true }).fill("NS-10482");
  await createOrder.getByRole("button", { name: "Create order" }).click();
  await page.getByRole("link", { name: "NS-10482" }).click();
  const lines = card(page, "Line items & payment");
  await lines.getByLabel("Add product", { exact: true }).selectOption("NS-ASJ-OB-M");
  await lines.getByRole("button", { name: "Add line" }).click();
  await lines.getByLabel("Payment status", { exact: true }).selectOption("paid");
  await lines.getByLabel("Payment method", { exact: true }).selectOption("card");
  await lines.getByLabel("Paid at", { exact: true }).fill("2026-08-21T13:12");
  const shipping = card(page, "Fulfilment & shipping");
  await shipping.getByLabel("Fulfilment method", { exact: true }).selectOption("standard");
  await shipping.getByLabel("Ship to", { exact: true }).selectOption("bordeaux-previous-flat");
  await page.getByRole("button", { name: "Save order" }).click();
  await expect(page.getByRole("button", { name: "Saved" })).toBeDisabled();

  await page.getByRole("link", { name: "Tickets" }).click();
  const list = card(page, "Tickets");
  await list.getByLabel("Reference", { exact: true }).fill("T-204");
  await list.getByLabel("Subject", { exact: true }).fill("Wrong address concern");
  await list.getByLabel("Customer", { exact: true }).selectOption({ label: "Maya Laurent" });
  await list.getByRole("button", { name: "Open ticket" }).click();
  await expect(page.getByRole("heading", { name: /T-204 · Wrong address concern/ })).toBeVisible();

  const thread = card(page, "Ticket thread");
  await thread.getByRole("button", { name: "as Maya Laurent" }).click();
  await thread.getByLabel("Sent at", { exact: true }).fill("2026-08-21T13:40");
  await thread
    .getByLabel("Add a history message", { exact: true })
    .fill("I just noticed this is going to my old address. Can you change it before it ships?");
  await thread.getByRole("button", { name: "Add to thread" }).click();

  const details = card(page, "Ticket details");
  await details.getByLabel("Opened from", { exact: true }).selectOption("order_page");
  await details.getByLabel("Order", { exact: true }).selectOption({ label: "NS-10482" });
  await card(page, "Linked objects").getByLabel("NS-10482").check();
  // The suggestion is what pre-fills the scenario's context documents.
  await card(page, "Suggested documents")
    .getByLabel(/address-change/)
    .check();
  await saveDraft(page);
  await page.getByRole("button", { name: "Publish v1" }).click();
  await expect(page.getByRole("status")).toContainText(
    "A scenario built on this ticket freezes this exact version",
  );
}

/** The published identity a write runs under: it may read orders, and change where one ships. */
async function publishSupportIdentity(page: Page, name: string) {
  await openSection(page, "Support identities", "Support identities");
  const newIdentity = card(page, "New support identity");
  await newIdentity.getByLabel("Name", { exact: true }).fill(name);
  await newIdentity
    .getByLabel("Role title", { exact: true })
    .fill("Customer support representative");
  await newIdentity.getByRole("button", { name: "Create identity" }).click();
  await page.getByRole("link", { name }).click();

  const permissions = card(page, "Permissions");
  // `change shipping address` acts on an order, so publishing refuses it without
  // `read orders`: a mutation the identity cannot first read would be unauditable.
  await permissions.getByLabel("read orders", { exact: true }).check();
  await permissions.getByLabel("read policies", { exact: true }).check();
  await permissions.getByLabel("change shipping address", { exact: true }).check();
  await saveDraft(page);
  await page.getByRole("button", { name: "Publish v1" }).click();
  await expect(page.getByText(/Published version 1/)).toBeVisible();
}

/** The two templates the recipe composes, both published so a scenario can pin them. */
async function publishTemplates(page: Page, objective: string, mutation: string) {
  await openSection(page, "Objective blocks", "Objective blocks");
  const newObjective = card(page, "New objective block");
  await newObjective.getByLabel("Name", { exact: true }).fill(objective);
  await newObjective.getByRole("button", { name: "Create block" }).click();
  await page.getByRole("link", { name: objective }).click();
  const objectiveTemplate = card(page, "Template");
  await objectiveTemplate.getByLabel("Statement", { exact: true }).fill("Read document");
  await objectiveTemplate
    .getByLabel("Description", { exact: true })
    .fill("Passes when the arm reads the bound document through its tool before the run ends.");
  const objectiveParameters = card(page, "Parameters");
  const addObjectiveParameter = objectiveParameters.getByRole("form", {
    name: "Add a parameter",
  });
  await addObjectiveParameter.getByLabel("Parameter name", { exact: true }).fill("doc_ref");
  await addObjectiveParameter
    .getByLabel("Kind", { exact: true })
    .selectOption("document_reference");
  await addObjectiveParameter.getByRole("button", { name: "Add parameter" }).click();
  await objectiveParameters
    .getByLabel("Description of doc_ref", { exact: true })
    .fill("The shop document the arm has to read.");
  await saveDraft(page);
  await page.getByRole("button", { name: "Publish v1" }).click();
  await expect(page.getByRole("status")).toContainText("Published version 1");

  await openSection(page, "Mutation blocks", "Mutation blocks");
  const newMutation = card(page, "New mutation block");
  await newMutation.getByLabel("Name", { exact: true }).fill(mutation);
  await newMutation.getByRole("button", { name: "Create block" }).click();
  await page.getByRole("link", { name: mutation }).click();
  const mutationTemplate = card(page, "Template");
  await mutationTemplate.getByLabel("Statement", { exact: true }).fill("Concurrent mutation of");
  await mutationTemplate
    .getByLabel("Description", { exact: true })
    .fill("Mutates the bound entity out of band, bumping the version the arm holds.");
  const mutationParameters = card(page, "Parameters");
  const addMutationParameter = mutationParameters.getByRole("form", { name: "Add a parameter" });
  await addMutationParameter.getByLabel("Parameter name", { exact: true }).fill("entity_ref");
  await addMutationParameter.getByLabel("Kind", { exact: true }).selectOption("entity_reference");
  await addMutationParameter.getByRole("button", { name: "Add parameter" }).click();
  await addMutationParameter.getByLabel("Parameter name", { exact: true }).fill("timing");
  await addMutationParameter.getByLabel("Kind", { exact: true }).selectOption("timing");
  await addMutationParameter.getByRole("button", { name: "Add parameter" }).click();
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
  await expect(page.getByRole("status")).toContainText("Published version 1");
}

/** One published agent configuration, ready to be pinned as an arm. */
async function publishConfiguration(page: Page, name: string, identity: string, prompt: string) {
  await openSection(page, "Agent configurations", "Agent configurations");
  const create = card(page, "New agent configuration");
  await create.getByLabel("Name", { exact: true }).fill(name);
  await create
    .getByLabel("Support identity", { exact: true })
    .selectOption({ label: `${identity} · Customer support representative` });
  await create.getByRole("button", { name: "Create configuration" }).click();
  await page.getByRole("link", { name }).click();
  await page.getByLabel("Prompt template", { exact: true }).fill(prompt);
  await saveDraft(page);
  await page.getByRole("button", { name: "Publish v1" }).click();
  await expect(page.getByText(/Published version 1/)).toBeVisible();
}

/** The published recipe both arms will run, built on the incident above. */
async function publishScenario(page: Page, objective: string, mutation: string) {
  await openSection(page, "All scenarios", "Scenarios");
  const create = card(page, "New scenario");
  await create.getByLabel("Name", { exact: true }).fill("Wrong shipping address");
  await create
    .getByLabel("Built on ticket", { exact: true })
    .selectOption({ label: "T-204 — Wrong address concern" });
  await create.getByRole("button", { name: "Create scenario" }).click();
  await page.getByRole("link", { name: "Wrong shipping address" }).click();

  const objectives = card(page, "Objectives");
  await objectives
    .getByLabel("Add objective block", { exact: true })
    .selectOption({ label: `${objective} — v1` });
  await objectives.getByRole("button", { name: "Add" }).click();
  await objectives
    .getByLabel(`doc_ref of ${objective}`, { exact: true })
    .selectOption("policy:address-change");

  const mutations = card(page, "Mutations");
  await mutations
    .getByLabel("Add mutation block", { exact: true })
    .selectOption({ label: `${mutation} — v1` });
  await mutations.getByRole("button", { name: "Add" }).click();
  await mutations
    .getByLabel(`entity_ref of ${mutation}`, { exact: true })
    .selectOption({ label: "Order NS-10482 — paid, unfulfilled" });

  await card(page, "Completion")
    .getByLabel("A resolved incident looks like", { exact: true })
    .fill("The order ships to the confirmed address and the customer acknowledges it.");
  await saveDraft(page);
  await page.getByRole("button", { name: "Publish v1" }).click();
  await expect(page.getByRole("status")).toContainText("Published version 1");
}

async function chooseArm(page: Page, position: number, configuration: string) {
  const arm = page.getByRole("group", { name: `Arm ${String.fromCharCode(65 + position)}` });
  // Addressed by role and accessible name: every picker on this page is a select inside a
  // wrapping label, and "Published version" names one per arm plus the scenario's.
  await arm
    .getByRole("combobox", { name: "Agent configuration" })
    .selectOption({ label: configuration });
  await arm.getByRole("combobox", { name: "Published version" }).selectOption("1");
}

test("an operator starts a paired experiment and drives both arms", async ({ page }) => {
  // The same shape as the scenario journey and for the same reason: an experiment binds the
  // whole chain, so the chain has to exist before the thing under test does.
  test.slow();
  const unique = Date.now().toString(36);
  const objective = `experiment-read-required-document-${unique}`;
  const mutation = `experiment-concurrent-entity-mutation-${unique}`;
  const identity = `experiment-tier-1-${unique}`;
  const atlas = `cfg-atlas-${unique}`;
  const beacon = `cfg-beacon-${unique}`;

  await buildIncident(page, unique);
  await publishSupportIdentity(page, identity);
  await publishTemplates(page, objective, mutation);
  await publishScenario(page, objective, mutation);
  await publishConfiguration(
    page,
    atlas,
    identity,
    "You are {{support_identity.role}} for {{shop.name}}. Use the tools for every fact.",
  );
  await publishConfiguration(
    page,
    beacon,
    identity,
    "You are {{support_identity.role}} for {{shop.name}}. Answer briefly and use the tools.",
  );

  await openSection(page, "Bench", "New experiment");
  const scenarioCard = card(page, "Scenario");
  await scenarioCard
    .getByRole("combobox", { name: "Recipe" })
    .selectOption({ label: "Wrong shipping address" });
  await expect(scenarioCard.getByRole("combobox", { name: "Published version" })).toHaveValue("1");
  await chooseArm(page, 0, atlas);

  // One arm has nothing to differ from, so every dimension reads the same. Addressed as
  // cells: `getByText` is a case-insensitive substring match, and the card's own footer
  // explains what a difference means.
  const matrix = card(page, "Comparison variables");
  const differences = matrix.getByRole("cell", { name: "Difference", exact: true });
  await expect(differences).toHaveCount(0);

  // A second arm that differs only in its prompt: exactly one comparison variable, which is
  // what makes the result attributable.
  await page.getByRole("button", { name: "Add a second arm" }).click();
  await chooseArm(page, 1, beacon);
  const promptRow = matrix.getByRole("row", { name: /prompt/ });
  await expect(promptRow.getByRole("cell", { name: "Difference", exact: true })).toBeVisible();
  await expect(
    matrix.getByRole("row", { name: /framework/ }).getByRole("cell", { name: "Same", exact: true }),
  ).toBeVisible();
  await expect(differences).toHaveCount(1);

  await page.getByRole("textbox", { name: "Experiment name" }).fill(`Prompt comparison ${unique}`);
  await page.getByRole("button", { name: "Start experiment" }).click();

  // Both arms open on the ticket's triggering message, from one frozen starting state.
  await expect(
    page.getByRole("heading", { level: 1, name: `Prompt comparison ${unique}` }),
  ).toBeVisible();
  const armA = card(page, "Arm A");
  const armB = card(page, "Arm B");
  const trigger = /this is going to my old address/;
  await expect(armA.getByText(trigger)).toBeVisible();
  await expect(armB.getByText(trigger)).toBeVisible();

  const armFingerprints = await page
    .getByRole("region", { name: "Arms" })
    .locator("code")
    .allTextContents();
  expect(armFingerprints).toHaveLength(2);
  expect(armFingerprints[0]).toBe(armFingerprints[1]);

  // One composition, both arms: the customer says the same thing to each.
  const composer = card(page, "Customer composer");
  await composer.getByRole("textbox", { name: "Message" }).fill("Any update on the address?");
  await composer.getByRole("button", { name: "Send as the customer" }).click();
  await expect(armA.getByText("Any update on the address?")).toBeVisible();
  await expect(armB.getByText("Any update on the address?")).toBeVisible();
  await expect(page.getByText("this arm only")).toHaveCount(0);

  // One composition, one arm: divergence, and the record says which arm heard it.
  await composer.getByRole("checkbox", { name: "Arm B" }).uncheck();
  await composer.getByRole("textbox", { name: "Message" }).fill("Only arm A hears this.");
  await composer.getByRole("button", { name: "Send as the customer" }).click();
  await expect(armA.getByText("Only arm A hears this.")).toBeVisible();
  await expect(armB.getByText("Only arm A hears this.")).toHaveCount(0);
  await expect(armA.getByText("this arm only")).toBeVisible();

  // An empty composition is a run that has not been driven, not a customer who said nothing.
  await composer.getByRole("button", { name: "Send as the customer" }).click();
  await expect(page.getByRole("alert")).toContainText("Write the customer's next message");
});
