import { expect, type Page, test } from "@playwright/test";

/**
 * Milestone 3 Slice 1 acceptance evidence: an author composes a shop-independent agent
 * configuration, reads every prompt variable resolved against a chosen shop and the identity
 * the configuration adopts, and publishes it — after the gate has refused the two things a
 * configuration must never be published with: a fact the agent is supposed to discover
 * through tools, and a write its support identity could never be authorized to make.
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

/** A published shop, so the prompt's `{{shop.*}}` variables have something to resolve to. */
async function publishShop(page: Page, unique: string) {
  await page.goto("/shops");
  const createShop = card(page, "Create a shop");
  await createShop.getByLabel("Name", { exact: true }).fill(`Northstar ${unique}`);
  await createShop.getByLabel("Slug", { exact: true }).fill(`northstar-${unique}`);
  await createShop.getByRole("button", { name: "Create shop" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();

  await openSection(page, "Tone of voice", "Tone of voice");
  const tone = card(page, "Guidelines");
  await tone.getByLabel("ID", { exact: true }).fill("warm-precise");
  await tone.getByLabel("Name", { exact: true }).fill("Warm and precise");
  await tone.getByLabel("Guidance", { exact: true }).fill("Be concise, warm, and specific.");
  await tone.getByRole("button", { name: "Add tone of voice" }).click();
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

  await openSection(page, "Policies & FAQ", "Policies & FAQ");
  const policies = card(page, "Policies");
  await policies.getByLabel("ID", { exact: true }).fill("address-change");
  await policies.getByLabel("Title", { exact: true }).fill("Address-change policy");
  await policies
    .getByLabel("Body", { exact: true })
    .fill("A shipping address can change before dispatch.");
  await policies.getByRole("button", { name: "Add policy" }).click();
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
  await options.getByLabel("New value", { exact: true }).fill("Ocean Blue");
  await options.getByRole("button", { name: "Add value" }).click();
  await options.getByRole("button", { name: "Add option" }).click();
  const variants = card(page, "Variants");
  await variants.getByLabel("New variant SKU", { exact: true }).fill("NS-ASJ-OB-M");
  await variants.getByLabel("Price (optional)", { exact: true }).fill("249.00");
  await variants.getByRole("button", { name: "Add variant" }).click();
  await saveDraft(page);

  await openSection(page, "Home", "Home");
  await page.getByRole("button", { name: "Publish v1" }).click();
  await expect(page.getByText(/Published v1\. That version is immutable/)).toBeVisible();
}

/** A read-only published identity: it may look an order up, and may not move it. */
async function publishReadOnlyIdentity(page: Page, name: string) {
  await openSection(page, "Support identities", "Support identities");
  const newIdentity = card(page, "New support identity");
  await newIdentity.getByLabel("Name", { exact: true }).fill(name);
  await newIdentity
    .getByLabel("Role title", { exact: true })
    .fill("Customer support representative");
  await newIdentity.getByRole("button", { name: "Create identity" }).click();
  await page.getByRole("link", { name }).click();

  const permissions = card(page, "Permissions");
  await permissions.getByLabel(/^Read orders —/).check();
  await permissions.getByLabel(/^Read policies —/).check();
  await saveDraft(page);
  await page.getByRole("button", { name: "Publish v1" }).click();
  await expect(page.getByText(/Published version 1/)).toBeVisible();
}

test("an author publishes an agent configuration the lab can actually run", async ({ page }) => {
  const unique = Date.now().toString(36);
  const identityName = `Northstar tier 1 ${unique}`;
  const configurationName = `Frontline single agent ${unique}`;

  await publishShop(page, unique);
  await publishReadOnlyIdentity(page, identityName);

  await openSection(page, "Agent configurations", "Agent configurations");
  const newConfiguration = card(page, "New agent configuration");
  await newConfiguration.getByLabel("Name", { exact: true }).fill(configurationName);
  await newConfiguration
    .getByLabel("Support identity", { exact: true })
    .selectOption({ label: `${identityName} · Customer support representative` });
  await newConfiguration.getByRole("button", { name: "Create configuration" }).click();
  await page.getByRole("link", { name: configurationName }).click();
  await expect(page.getByRole("heading", { level: 1, name: configurationName })).toBeVisible();

  // A new draft can read the arm through every read tool and move it through none.
  const bindings = page.getByRole("region", { name: /Tool bindings/ });
  await expect(bindings.getByLabel(/orders\.read_order/)).toBeChecked();
  await expect(bindings.getByLabel(/orders\.propose_address_change/)).not.toBeChecked();

  // An empty prompt blocks publication.
  const gate = card(page, "Publish gate");
  await expect(gate.getByText(/must carry a system prompt/)).toBeVisible();

  // A customer fact is refused: an agent discovers it through tools, and how it does that is
  // part of what an experiment compares.
  const prompt = page.getByLabel("Prompt template", { exact: true });
  await prompt.fill("You are {{support_identity.role}}. Greet {{customer.name}} by name.");
  await saveDraft(page);
  await expect(gate.getByText(/discovered through tools by design/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Publish v1" })).toBeDisabled();

  // A write the identity may never make is refused at publication, not at its first call.
  await bindings.getByLabel(/orders\.propose_address_change/).check();
  await saveDraft(page);
  // The publish gate's own sentence, written by the backend, which still names the permission
  // by its wire value. Slice 3 carries no backend change; the *editor's* own warning beside the
  // binding reads "needs Change shipping address" and is asserted in AgentConfigurations.test.tsx.
  await expect(gate.getByText(/needs change_shipping_address/)).toBeVisible();
  await bindings.getByLabel(/orders\.propose_address_change/).uncheck();

  // The prompt resolves against the chosen preview context, chip by chip.
  await prompt.fill("You are {{support_identity.role}} for {{shop.name}}.");
  await saveDraft(page);
  const resolved = page.getByRole("region", { name: "Resolved prompt" });
  await expect(
    resolved.getByText("support_identity.role: Customer support representative"),
  ).toBeVisible();
  await expect(resolved.getByText(`shop.name: Northstar ${unique}`)).toBeVisible();

  const publish = page.getByRole("button", { name: "Publish v1" });
  await expect(publish).toBeEnabled();
  await publish.click();
  await expect(page.getByText(/Published version 1/)).toBeVisible();
  await expect(page.getByText(/Draft matches v1/)).toBeVisible();

  // The draft moves on; the published version keeps what it froze.
  await prompt.fill("You are {{support_identity.role}} for {{shop.name}}. Be brief.");
  await saveDraft(page);
  await expect(page.getByText(/Draft v2 in progress/)).toBeVisible();

  // Slice 6's evidence, on the draft that has already proved the rest of this journey.
  //
  // Choosing a framework is choosing what the lab has proven it on. The provider is a select
  // over that framework's providers — an unproven one is a publish error — and the model is a
  // datalist over its models, because an unexercised model is only a warning and a dropdown
  // would refuse in the browser what the API would take.
  await page.getByLabel("Framework", { exact: true }).selectOption({ label: "OpenAI Agents SDK" });
  const runtime = card(page, "LLM and runtime");
  const provider = runtime.getByRole("combobox", { name: "Provider" });
  await expect(provider).toHaveValue("openai");
  // Under the workspace's one spelling of the value, as frame 5 draws the control.
  await expect(provider.getByRole("option")).toHaveText(["OpenAI"]);
  await expect(runtime.getByLabel("Model", { exact: true })).toHaveValue("gpt-5-mini");

  // A model off that list stands, and is told about in the field rather than one save later.
  await runtime.getByLabel("Model", { exact: true }).fill("gpt-5-nano");
  await expect(runtime.getByText(/gpt-5-nano is not a model the lab exercises/)).toBeVisible();
  await runtime.getByLabel("Model", { exact: true }).fill("gpt-5-mini");

  // Choosing a tone override is choosing from the shop's own list, and the name the run will
  // resolve is shown beside the ID.
  const tone = card(page, "Tone of voice");
  await tone.getByLabel("Tone of voice source", { exact: true }).selectOption("override");
  const guideline = tone.getByLabel("Guideline ID", { exact: true });
  await guideline.fill("warm-precise");
  await expect(tone.getByText(/Resolves to Warm and precise in Northstar/)).toBeVisible();
  await guideline.fill("not-a-guideline");
  await expect(tone.getByText(/publishes no guideline with this ID/)).toBeVisible();
});
