import type { Page } from "@playwright/test";
import {
  createBlock,
  createConfiguration,
  createJudge,
  createScenario,
  createShop,
} from "./support/authoring";
import { expect as baseExpect, test } from "./support/e2e";
import { openSection } from "./support/navigate";

/**
 * The page's publication notice. Every editor header now reports "All changes saved" as a
 * status line of its own (PLAN-UX Slice 8), so a query for "the page's status" says which.
 */
function publicationNotice(page: Page) {
  return page.getByRole("status").filter({ hasText: "Published version" });
}

/**
 * This journey's assertions wait longer than the suite's default, and only this journey's.
 *
 * It is the heaviest writer in a suite that runs every journey at once against one API process
 * and one SQLite file — it publishes nine definitions, starts an experiment, drives both arms and
 * scores a judge — and since the tour sweep joined the suite and began building a chain of its
 * own, a write this journey is waiting on can queue behind one of those. Nothing below is
 * relaxed, removed or narrowed; the wait is the stack's and is scoped to the file that needs it
 * rather than lengthening every assertion in every spec.
 *
 * It is not a fix for a write that queues past SQLite's own five-second busy timeout: that
 * surfaces as a refused request and a wrong page, which no wait repairs. `docs/PLAN.md` carries
 * that as a deferred trigger.
 */
const expect = baseExpect.configure({ timeout: 15_000 });

/**
 * The paired-experiment acceptance journey (ADR 0025, ADR 0026, ADR 0029): an operator starts
 * one experiment on a published scenario version with two published agent configurations,
 * reads the comparison matrix before anything is frozen, and finds both arms opening on the
 * ticket's triggering message from one shared starting state — then runs each arm's agent,
 * watches one of them follow the incident to the order and redirect it while the arm beside
 * it stays where it was, leaves the bench and comes back to find it exactly where it stood,
 * and sends one message to both arms and one to a single arm, which the record keeps apart.
 *
 * The journey builds the whole chain because an experiment is what composes all of it: the
 * scenario, the arms, and the participant are the three things it binds, and none of them
 * can be stubbed without stubbing the thing under test.
 *
 * Both arms run the deterministic control framework, which is what makes this an assertion
 * rather than an observation: its behavior is a declared policy, so the reply, the tool
 * calls, and the revision it moves the arm to are all things this test can name. A
 * model-backed arm is exercised by the offline adapter tests and the opt-in live smoke test.
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

  await openSection(page, "Policies & FAQ", "Policies & FAQ");
  const policies = card(page, "Policies");
  await policies.getByLabel("ID", { exact: true }).fill("address-change");
  await policies.getByLabel("Title", { exact: true }).fill("Address-change policy");
  await policies
    .getByLabel("Body", { exact: true })
    .fill("A shipping address can change before dispatch.");
  await policies.getByRole("button", { name: "Add policy" }).click();
  await saveDraft(page);

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

  await openSection(page, "Overview", "Home");
  await page.getByRole("button", { name: "Publish v1" }).click();
  await expect(page.getByText(/Published v1\. That version is immutable/)).toBeVisible();

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
  // Where she lives *now* is the default: the first entry authored becomes it, and the
  // incident is exactly that the order still ships to the other one.
  await card(page, "Address book")
    .getByRole("button", { name: "Make Home the default address" })
    .click();
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

  await page.getByLabel("Shop workspace").getByRole("link", { name: "Tickets" }).click();
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
async function publishTemplates(page: Page, objective: string, judged: string, mutation: string) {
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

  // The other kind of objective: one no rule can decide, which a judge scores (ADR 0031).
  // How it is assessed is asked for on the create page, because it is what the template is.
  await createBlock(page, {
    library: "Objective blocks",
    name: judged,
    axis: { label: "Assessed by", value: "judge" },
  });
  const judgedTemplate = card(page, "Template");
  await judgedTemplate.getByLabel("Statement", { exact: true }).fill("Resolve the incident");
  await judgedTemplate
    .getByLabel("Description", { exact: true })
    .fill("Passes when the arm identified the order and said plainly what it changed.");
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

/**
 * One published agent configuration on the deterministic control framework, ready to be
 * pinned as an arm.
 *
 * The write tools are enabled because the incident is a wrong address: an arm that could
 * only read would have nothing to do about it, and the identity this adopts is already
 * permitted to change one.
 */
async function publishConfiguration(page: Page, name: string, identity: string, prompt: string) {
  // The framework is chosen on the create page, because choosing one is choosing the model
  // the arm runs on and that is what the page asks for (PLAN-UX Slice 13).
  await createConfiguration(page, { name, identity, framework: "Deterministic fake" });
  await page.getByLabel("Prompt template", { exact: true }).fill(prompt);

  // What the create page wrote is what the editor now holds: the provider follows the
  // framework, and the model follows the provider it belongs to.
  const runtime = card(page, "LLM and runtime");
  await expect(runtime.getByLabel("Provider", { exact: true })).toHaveValue("fake");
  await expect(runtime.getByLabel("Model", { exact: true })).toHaveValue("deterministic");

  // Not an exact label match: a binding's label is the tool name followed by its effect
  // chip, which is what an author reads.
  const tools = page.getByRole("region", { name: /Tool bindings/ });
  await tools.getByLabel("orders.propose_address_change").check();
  await tools.getByLabel("orders.apply_address_change").check();

  await saveDraft(page);
  await page.getByRole("button", { name: "Publish v1" }).click();
  await expect(page.getByText(/Published version 1/)).toBeVisible();
}

/** The published recipe both arms will run, built on the incident above. */
/** The judge that will score the row no rule decides, published so a verdict can name it. */
async function publishJudge(page: Page, name: string) {
  // The rubric is the whole of what a judge is, so the create page will not go without it
  // (PLAN-UX Slice 13). The offline judge, so this journey needs no provider: its rule is
  // declared, which is what lets the assertion below name the verdict.
  await createJudge(page, {
    name,
    rubric: "Score whether the arm identified the order and said plainly what it changed.",
    provider: "fake",
  });

  // What the create page wrote is what the editor holds, model and all: a provider change
  // takes the model with it, and `gpt-5-mini` is not something this runs. Nothing is left to
  // save, which is the point of a create that lands in the editor of what it made.
  await expect(card(page, "Model").getByLabel("Model", { exact: true })).toHaveValue(
    "deterministic",
  );
  await expect(page.getByText("All changes saved")).toBeVisible();
  await page.getByRole("button", { name: "Publish v1" }).click();
  await expect(publicationNotice(page)).toContainText("Published version 1");
}

async function publishScenario(page: Page, objective: string, judged: string, mutation: string) {
  // Both objectives are composed on the create page, which will not go without one, and the
  // page lands in the editor where their bindings are made (PLAN-UX Slice 14).
  await createScenario(page, {
    name: "Wrong shipping address",
    ticket: "T-204",
    composes: [objective, judged],
  });

  const objectives = card(page, "Objectives");
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

  const completion = card(page, "Completion");
  await completion
    .getByLabel("A resolved incident looks like", { exact: true })
    .fill("The order ships to the confirmed address and the customer acknowledges it.");
  // Two driven turns, so this journey can reach the cap that settles an objective. A recipe
  // an operator authors is longer; what is being proved is that the cap ends the arm.
  await completion.getByLabel("Turn cap", { exact: true }).fill("2");
  await saveDraft(page);
  await page.getByRole("button", { name: "Publish v1" }).click();
  await expect(publicationNotice(page)).toContainText("Published version 1");
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

test("an operator starts a paired experiment, drives both arms, and comes back to it", async ({
  page,
}) => {
  // The same shape as the scenario journey and for the same reason: an experiment binds the
  // whole chain, so the chain has to exist before the thing under test does.
  test.slow();
  const unique = Date.now().toString(36);
  const objective = `experiment-read-required-document-${unique}`;
  const judged = `experiment-resolve-the-incident-${unique}`;
  const mutation = `experiment-concurrent-entity-mutation-${unique}`;
  const identity = `experiment-tier-1-${unique}`;
  const atlas = `cfg-atlas-${unique}`;
  const beacon = `cfg-beacon-${unique}`;

  await buildIncident(page, unique);
  await publishSupportIdentity(page, identity);
  await publishTemplates(page, objective, judged, mutation);
  await publishScenario(page, objective, judged, mutation);
  await publishJudge(page, `experiment-resolution-quality-${unique}`);
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

  // Arm A answers the trigger: it follows the interaction to the order, reads the customer,
  // and redirects the order to the address on file — every step a recorded tool call.
  await armA.getByRole("button", { name: "Run Arm A's agent" }).click();
  await expect(armA.getByText(/I found order NS-10482/)).toBeVisible();
  await expect(armA.getByText(/redirected it to 18 rue des Ecoles/)).toBeVisible();
  await expect(armA.getByText(/interaction\.read_context → Success/)).toBeVisible();
  await expect(
    armA.getByText(/orders\.apply_address_change → Success · moved this arm/),
  ).toBeVisible();

  // And the scenario's own fault fired in the middle of it: the recipe binds the order to
  // move once this arm has read it, so the world changed while the agent was working and
  // the agent was never told.
  await expect(armA.getByText("scenario fault · moved this arm")).toBeVisible();

  // The arm beside it is exactly where it was — the fault included: an action in one arm
  // cannot alter the other, which is the whole claim a paired experiment rests on.
  const changes = card(page, "State changes");
  await expect(changes.getByText(/scenario fault · r0 → r1/)).toBeVisible();
  await expect(changes.getByText(/orders\.apply_address_change · r1 → r2/)).toBeVisible();
  await expect(changes.getByText("nothing yet")).toBeVisible();
  await expect(armB.getByText(/I found order NS-10482/)).toHaveCount(0);

  // Each arm says what it is waiting for, which is the only difference an operator can act
  // on: arm A has answered and owes nothing, arm B has never been run.
  await expect(armA.getByText("Waiting for the customer · turn 0")).toBeVisible();
  await expect(armB.getByText("Waiting for the agent · turn 0")).toBeVisible();

  // And what that turn cost: the control arm calls no provider, so it reports zero tokens
  // and a cost of nothing rather than an empty column. The arm that has not run shows no
  // strip at all — a row of zeros would read as a measurement nobody took.
  await expect(armA.getByText(/1 turn · 0 tok · \d+ tools? · [\dms. ]+ · 0\.00 USD/)).toBeVisible();
  await expect(armB.getByText(/ tools? · /)).toHaveCount(0);

  // Resume. An experiment is entirely in the record, so coming back to one is an ordinary
  // read — the operator reloads the browser, leaves for the bench index, and returns through
  // the shop's experiment list to find both threads exactly where they stood.
  await page.reload();
  await page.getByRole("link", { name: "Back to the bench" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "New experiment" })).toBeVisible();
  await card(page, "Recent experiments")
    .getByRole("button", { name: `Prompt comparison ${unique}` })
    .click();

  await expect(
    page.getByRole("heading", { level: 1, name: `Prompt comparison ${unique}` }),
  ).toBeVisible();
  await expect(armA.getByText(/I found order NS-10482/)).toBeVisible();
  await expect(armA.getByText("scenario fault · moved this arm")).toBeVisible();
  await expect(armA.getByText("Waiting for the customer · turn 0")).toBeVisible();
  // And the arm that was left owing a reply is still the one the bench offers to run.
  await expect(armB.getByRole("button", { name: "Run Arm B's agent" })).toBeVisible();

  // The objectives matrix reads the same record: the control policy resolves the incident
  // through the order and never opens a document, so the read-check is pending — a state the
  // arm can still leave — and the judge's own row waits for a judge.
  const objectivesMatrix = card(page, "Objectives");
  await expect(objectivesMatrix.getByText("Read document")).toBeVisible();
  await expect(objectivesMatrix.getByText(/ pending — /)).toHaveCount(2);
  await expect(objectivesMatrix.getByText(/a judge scores this dimension; none has/)).toHaveCount(
    2,
  );

  // One composition, both arms: the customer says the same thing to each.
  const composer = card(page, "Customer composer");
  await composer.getByRole("textbox", { name: "Message" }).fill("Any update on the address?");
  await composer.getByRole("button", { name: "Send as the customer" }).click();
  await expect(armA.getByText("Any update on the address?")).toBeVisible();
  await expect(armB.getByText("Any update on the address?")).toBeVisible();
  await expect(page.getByText("this arm only")).toHaveCount(0);
  // Sending advances the arms it reached, so arm B — which was never run on the trigger —
  // answers the conversation as it now stands, with the trigger behind it.
  await expect(armB.getByText(/I found order NS-10482/)).toBeVisible();

  // One composition, one arm: divergence, and the record says which arm heard it.
  await composer.getByRole("checkbox", { name: "Arm B" }).uncheck();
  await composer.getByRole("textbox", { name: "Message" }).fill("Only arm A hears this.");
  await composer.getByRole("button", { name: "Send as the customer" }).click();
  await expect(armA.getByText("Only arm A hears this.")).toBeVisible();
  await expect(armB.getByText("Only arm A hears this.")).toHaveCount(0);
  await expect(armA.getByText("this arm only")).toBeVisible();

  // Turn 2 was the last this scenario allows, and arm A answered it: the arm is completed,
  // nothing offers to run or message it again, and what it never did is now a miss rather
  // than something it might still do.
  await expect(armA.getByText(/Completed — this arm has answered every turn/)).toBeVisible();
  await expect(
    objectivesMatrix.getByText(/ missed — support\.read_document never answered/),
  ).toHaveCount(1);
  await expect(objectivesMatrix.getByText(/ pending — /)).toHaveCount(1);
  await expect(armA.getByRole("button", { name: /Arm A's agent/ })).toHaveCount(0);
  await expect(composer.getByRole("checkbox", { name: /Arm A/ })).toBeDisabled();

  // And the row no rule can decide is filled by the judge the operator chose — on each arm's
  // own record, with the version and model that produced the verdict recorded on the cell.
  await objectivesMatrix
    .getByRole("combobox", { name: "Judge" })
    .selectOption({ label: `experiment-resolution-quality-${unique} · v1 · deterministic` });
  await objectivesMatrix.getByRole("button", { name: /Score 1 judged objective/ }).click();
  await expect(objectivesMatrix.getByText(/a judge scores this dimension; none has/)).toHaveCount(
    0,
  );
  await expect(
    objectivesMatrix.getByText(/judged by deterministic under judge version 1, attempt 1/),
  ).toHaveCount(2);
  // Arm A answered every turn it received; arm B is still holding one, and the judge says so
  // rather than counting an unfinished incident against it.
  await expect(
    objectivesMatrix.getByText(/ met — the arm answered every turn it received/),
  ).toHaveCount(1);

  // An empty composition is a run that has not been driven, not a customer who said nothing.
  await composer.getByRole("button", { name: "Send as the customer" }).click();
  await expect(page.getByRole("alert")).toContainText("Write the customer's next message");

  // The results screen reads the same record objective by objective, arm beside arm — and
  // refuses to add the two columns into a number that would decide, for the operator, how a
  // missed process check weighs against a resolved incident.
  await page.getByRole("link", { name: "Results" }).click();
  await expect(page.getByText(/There is no aggregate score/)).toBeVisible();
  await expect(card(page, "Arm A summary").getByText(/\d+\/\d+ decided/)).toBeVisible();
  await expect(card(page, "Arm B summary").getByText(/\d+\/\d+ decided/)).toBeVisible();

  const deterministic = card(page, "Deterministic evidence");
  await expect(
    deterministic.getByText(/ missed — support\.read_document never answered/),
  ).toHaveCount(1);
  await expect(deterministic.getByText(/ pending — /)).toHaveCount(1);
  // The judge's row is on its own card with the version and model that produced it, never
  // mixed in with the evidence a rule decided.
  await expect(deterministic.getByText("Read document")).toBeVisible();
  await expect(deterministic.getByText("Resolve the incident")).toHaveCount(0);
  const judgeCard = card(page, "LLM judge evidence");
  await expect(judgeCard.getByText("Resolve the incident")).toBeVisible();
  await expect(judgeCard.getByText(/judge v1 · deterministic · attempt 1/)).toHaveCount(2);

  // What actually moved each arm, read off its revisions rather than off what it answered.
  const businessState = card(page, "Business state — verified, not claimed");
  await expect(businessState.getByText(/orders\.apply_address_change · r1 → r2/)).toHaveCount(2);
  // And what those revisions moved the world *to*: a revision counter is true of a redirected
  // order and of a corrected typo alike, so the value on both sides is the evidence.
  await expect(businessState.getByText("shipping_address.city: Bordeaux → Lyon")).toHaveCount(2);
  await expect(businessState.getByText("NS-10482", { exact: true })).toHaveCount(2);
  // The scenario's own fault moved the same world, so its field is in the same difference.
  await expect(businessState.getByText(/fulfilment\.status: unfulfilled → /)).toHaveCount(2);
  // The claim the card makes, checked against the whole document rather than assumed.
  await expect(businessState.getByText(/no other state changed/)).toHaveCount(2);

  // And what the operator concluded, written beside the evidence rather than into it: the
  // shelf this run is filed on and the sentence explaining why.
  const written = card(page, "Notes & tags");
  await written.getByLabel("Add a tag").fill("Read check gap");
  await written.getByRole("button", { name: "Add tag" }).click();
  // Folded to one spelling, because it is what history narrows by.
  await expect(written.getByRole("button", { name: "Remove tag read-check-gap" })).toBeVisible();
  await written.getByLabel("Add a note").fill(`Beacon never opened the policy ${unique}.`);
  await written.getByRole("button", { name: "Add note" }).click();
  await expect(written.getByText(`Beacon never opened the policy ${unique}.`)).toBeVisible();

  // And the turn only one arm heard is what makes everything after it two conversations.
  const divergence = card(page, "Input divergence");
  await expect(divergence.getByText("Turn 2")).toBeVisible();
  await expect(divergence.getByText(/never received this turn/)).toBeVisible();

  // The same incident read as one normalized stream: the arms interleaved on the messages
  // they share, every call in the order it was asked, and the project's own code behind it.
  await page.getByRole("link", { name: "Execution timeline" }).click();
  const stream = card(page, "Execution timeline");
  await expect(stream.getByText(/triggering message opened every arm/)).toBeVisible();
  await expect(stream.getByText("this arm only")).toBeVisible();

  // Narrowed to what moved a world: per arm, the scenario's fault and the agent's write,
  // each in its own arm and nothing else.
  await stream.getByRole("button", { name: "State" }).click();
  await expect(stream.getByRole("listitem")).toHaveCount(4);
  await expect(
    stream.getByText(/orders\.apply_address_change v1 → Success · moved this arm r1 → r2/),
  ).toHaveCount(2);
  await expect(
    stream.getByText(
      /fired: it moved the order it is bound to, out of band · moved this arm r0 → r1/,
    ),
  ).toHaveCount(2);
  await stream.getByRole("button", { name: "All events" }).click();

  // And every event points at the lab's own code — resolved from the record, never a map.
  const paths = card(page, "Executed project code");
  const applied = paths.getByRole("listitem").filter({ hasText: "SandboxActionService._apply" });
  await expect(applied).toHaveText(
    /capability_lab\/application\/sandbox_actions\.py:\d+ · 2 calls/,
  );
  const faulted = paths.getByRole("listitem").filter({ hasText: "advance_fulfilment" });
  await expect(faulted).toHaveText(/capability_lab\/domain\/mutation\.py:\d+ · 2 calls/);

  // And the same attempt read as the span tree the lab recorded while it ran: what the
  // timeline cannot say, which is where inside the attempt each call actually happened.
  await page.getByRole("link", { name: "Traces" }).click();
  const traces = card(page, "Traces");
  const waterfall = traces.getByRole("list", { name: "Span waterfall" });
  await expect(waterfall.getByRole("button").first()).toContainText("experiment.attempt");
  await expect(
    waterfall.getByRole("button").filter({ hasText: "orders.apply_address_change" }),
  ).toHaveCount(1);

  // A span holds identifiers and milliseconds; which tool it timed and what that tool
  // answered are joined from the record beside it.
  await waterfall.getByRole("button").filter({ hasText: "orders.apply_address_change" }).click();
  const span = card(page, "Span");
  await expect(span.getByText("orders.apply_address_change · v1")).toBeVisible();
  await expect(span.getByText("Success", { exact: true })).toBeVisible();
  await expect(span.getByText(/^[0-9a-f]{32}$/)).toBeVisible();

  // And the incident is found again from history — experiment-first, across every shop,
  // with each arm's own count beside what it ran and no total anywhere.
  await openSection(page, "History", "Experiment history");
  const listed = card(page, "Experiment history");
  const row = listed.getByRole("row").filter({ hasText: `Prompt comparison ${unique}` });
  await expect(row).toHaveCount(1);
  await expect(row.getByText(`cfg-atlas-${unique} v1`)).toBeVisible();
  await expect(row.getByText(`cfg-beacon-${unique} v1`)).toBeVisible();
  // Each arm against what was decided *for it*: the arm driven to the cap has two decided
  // rows, and the arm still holding a turn has none — a denominator, not a defeat.
  await expect(row.getByText("Arm A 1/2 decided")).toBeVisible();
  await expect(row.getByText("Arm B 0/0 decided")).toBeVisible();

  // Narrowing is the backend's answer, so the assertion waits for the answer rather than
  // for the select to have changed.
  const narrowed = page.waitForResponse(
    (response) =>
      response.url().includes("/api/v1/experiments?") &&
      response.url().includes("framework_id=fake"),
  );
  // Exact, like every other filter here: the Tag select's label carries its option text, so
  // a seeded `framework-comparison` tag substring-matches "Framework" and the locator
  // resolves to two elements.
  await page.getByLabel("Framework", { exact: true }).selectOption({ label: "Deterministic fake" });
  await narrowed;
  await expect(row).toHaveCount(1);
  await page.getByLabel("Search").fill("a name nothing was given");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(listed.getByText(/No experiment matches these filters/)).toBeVisible();
  await page.getByLabel("Search").fill(`Prompt comparison ${unique}`);
  await page.getByRole("button", { name: "Search" }).click();
  await expect(row).toHaveCount(1);

  // The shelf the operator filed it on is on the row, is a way to narrow the lab, and the
  // sentence they wrote finds the run even though the listing never shows it.
  await expect(row.getByText("read-check-gap")).toBeVisible();
  await expect(row.getByText("1 note")).toBeVisible();
  await page.getByLabel("Search").fill(`Beacon never opened the policy ${unique}.`);
  await page.getByRole("button", { name: "Search" }).click();
  await expect(row).toHaveCount(1);
  const filtered = page.waitForResponse(
    (response) =>
      response.url().includes("/api/v1/experiments?") &&
      response.url().includes("tag=read-check-gap"),
  );
  await page.getByLabel("Tag").selectOption("read-check-gap");
  await filtered;
  await expect(row).toHaveCount(1);

  // And the row opens the evidence it summarizes.
  await row.getByRole("link", { name: "View evidence" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: `Prompt comparison ${unique}` }),
  ).toBeVisible();
  await expect(page.getByText(/There is no aggregate score/)).toBeVisible();

  // Replaying it derives a *new* experiment rather than re-running this one: the same
  // snapshot cloned again, the same configuration versions, and the compositions this run
  // recorded delivered into it — so the derived arms end where these did.
  await page.getByRole("button", { name: "Replay" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: `Prompt comparison ${unique} (replay)` }),
  ).toBeVisible();
  // The derived arms were driven by the script rather than by anyone at the composer, and
  // they reached the same place: the arm driven to the recipe's cap, the arm beside it still
  // holding the turn only it received, and the read-check the first arm missed again.
  await expect(card(page, "Arm A summary").getByText("Completed at turn 2")).toBeVisible();
  await expect(
    card(page, "Arm B summary").getByText(/waiting for the customer at turn 1/),
  ).toBeVisible();
  await expect(
    card(page, "Deterministic evidence").getByText(/ missed — support\.read_document never/),
  ).toHaveCount(1);
  // What is *not* carried over: a verdict is a record about the arm it was scored on
  // (ADR 0031), so the derived arms are unjudged until somebody scores them.
  await expect(card(page, "LLM judge evidence").getByText(/judge v1 · /)).toHaveCount(0);

  // It says where it came from, and the link leads back to the run it reproduces.
  await page.getByRole("link", { name: `Prompt comparison ${unique}` }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: `Prompt comparison ${unique}` }),
  ).toBeVisible();

  // Forking is the derivation that changes something on purpose. The operator suspects the
  // prompt, so they run this same incident, in the same world, driven by the same recorded
  // turns — with arm B moved onto the configuration arm A ran.
  await page.getByRole("button", { name: "Fork…" }).click();
  const forkPanel = page.getByRole("region", { name: "Fork this experiment" });
  // Nothing has moved yet, and a derivation that changes nothing is a replay.
  await expect(forkPanel.getByRole("button", { name: "Fork this run" })).toBeDisabled();
  await forkPanel
    .getByRole("group", { name: new RegExp(`^Arm B · ran ${beacon}`) })
    .getByRole("combobox", { name: "Agent configuration" })
    .selectOption({ label: atlas });
  await forkPanel.getByRole("button", { name: "Fork this run" }).click();

  await expect(
    page.getByRole("heading", { level: 1, name: `Prompt comparison ${unique} (fork)` }),
  ).toBeVisible();
  // The panel belonged to the run it was opened on: left open it would sit over a different
  // experiment holding a draft written against the previous one.
  await expect(forkPanel).toHaveCount(0);
  // The provenance names the run it came from and the one dimension it moved, which is what
  // makes "the thing it changed is the only thing that changed" a claim anyone can check.
  await expect(page.getByText("· changed prompt")).toBeVisible();
  // And it holds everything else still: the same starting state, and the same script, so the
  // arms end where the source's did rather than where a different conversation would.
  await expect(card(page, "Arm A summary").getByText("Completed at turn 2")).toBeVisible();
  await expect(
    card(page, "Arm B summary").getByText(/waiting for the customer at turn 1/),
  ).toBeVisible();

  // The run it forked is untouched, and the listing shows the three as one family.
  await page.getByRole("link", { name: `Prompt comparison ${unique}` }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: `Prompt comparison ${unique}` }),
  ).toBeVisible();
});
