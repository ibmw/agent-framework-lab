import { expect, type Page } from "@playwright/test";
import { openSection } from "./navigate";

/**
 * The four creates every journey starts with, written once.
 *
 * Creating in this workspace is a page and not a side card on the index (PLAN-UX Slice 12):
 * every index carries a primary *New …* control in its header, the form fills a focused page,
 * and pressing Create lands the operator in the editor of what they made. Ten of the eleven
 * specs open by authoring a shop, and seven of them a product, so the shape of those pages
 * lives here rather than in each spec — a spec then reads as the journey it is about, and the
 * next slice that moves a create moves it in one place.
 *
 * Each helper ends where the application leaves the operator: in the editor.
 */

export async function saveDraft(page: Page) {
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText("All changes saved")).toBeVisible();
}

/**
 * A shop, from `/shops` through `/shops/new` into the new shop's overview.
 *
 * `sells` names the currency the shop trades in, which the form would otherwise take from
 * the locale: a journey asserting a price in euros says so rather than relying on a default.
 * Ticked before the pound it replaces is unticked, because the last ticked box is disabled —
 * a shop sells in at least one — so the other order would be a click on a dead control.
 */
export async function createShop(
  page: Page,
  shop: { name: string; slug: string; sells?: { code: string; insteadOf: string } },
) {
  await page.goto("/shops");
  await page.getByRole("link", { name: "New shop" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "New shop" })).toBeVisible();

  await page.getByLabel("Name", { exact: true }).fill(shop.name);
  await page.getByLabel("Slug", { exact: true }).fill(shop.slug);
  if (shop.sells !== undefined) {
    const group = page.getByRole("group", { name: "Currencies" });
    await group.getByRole("checkbox", { name: new RegExp(`^${shop.sells.code} —`) }).check();
    await group.getByRole("checkbox", { name: new RegExp(`^${shop.sells.insteadOf} —`) }).uncheck();
    await expect(
      group.getByRole("checkbox", { name: new RegExp(`^${shop.sells.code} —`) }),
    ).toBeChecked();
  }
  await page.getByRole("button", { name: "Create shop" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
}

/**
 * A product, from the catalog into its own editor.
 *
 * *New product* appends an empty product to the shop draft and opens its editor, as the
 * prototype does (`Workspace.dc.html`:6931): a product is a row of the draft rather than a
 * definition of its own, so there is nothing to answer before it exists. The title and the
 * category are therefore authored in the editor, and the handle follows the title there.
 */
export async function addProduct(page: Page, product: { title: string; category: string }) {
  await openSection(page, "Products", "Products");
  await page.getByRole("button", { name: "New product" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Untitled product" })).toBeVisible();

  const details = page.getByRole("region", { name: "Details" });
  await details.getByLabel("Title", { exact: true }).fill(product.title);
  await details.getByLabel("Category", { exact: true }).fill(product.category);
  await expect(page.getByRole("heading", { level: 1, name: product.title })).toBeVisible();
  await saveDraft(page);
}

/** A customer profile attached to this shop, from Customers into its own editor. */
export async function createCustomer(
  page: Page,
  profile: { givenName: string; familyName: string; email: string },
) {
  await openSection(page, "Customers", "Customers");
  await page.getByRole("link", { name: "New customer" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "New customer" })).toBeVisible();

  await page.getByLabel("Given name", { exact: true }).fill(profile.givenName);
  await page.getByLabel("Family name", { exact: true }).fill(profile.familyName);
  await page.getByLabel("Email", { exact: true }).fill(profile.email);
  await page.getByRole("button", { name: "Create profile" }).click();

  const displayName = `${profile.givenName} ${profile.familyName}`;
  await expect(page.getByRole("heading", { level: 1, name: displayName })).toBeVisible();
}

/**
 * An order fixture, from Orders into its own editor.
 *
 * The create page will not go without a line — `CreateOrderRequest` carries none, so the page
 * makes the order and then puts the line on it — and it chooses the shipping address from the
 * customer's own book rather than taking a typed one. Both were steps in the editor before
 * this slice and are steps on the way in now.
 */
export async function createOrder(
  page: Page,
  order: { reference: string; customer: string; variant: string; address?: string },
) {
  await openSection(page, "Orders", "Orders");
  await page.getByRole("link", { name: "New order" }).click();
  await expect(page.getByText(/creating an order fixture/)).toBeVisible();

  await page.getByLabel("Customer", { exact: true }).selectOption({ label: order.customer });
  // The reference the shop's own series suggests, before it is replaced by the one this
  // journey quotes: the prefill is the create page's, and it is what a fixture is named by
  // when an author takes it.
  await expect(page.getByLabel("Reference", { exact: true })).toHaveValue(/^[A-Z0-9]+-1$/);
  await page.getByLabel("Reference", { exact: true }).fill(order.reference);
  await page.getByLabel("Variant", { exact: true }).selectOption({ label: order.variant });
  if (order.address !== undefined) {
    await page.getByRole("radio", { name: new RegExp(order.address) }).check();
  }
  await page.getByRole("button", { name: "Create order" }).click();

  await expect(page.getByRole("heading", { level: 1, name: order.reference })).toBeVisible();
}

/**
 * A scenario, from Scenarios into its own editor.
 *
 * The recipe is built on one ticket, and the create page reads the customer and the shop
 * version off it rather than asking — `reads` is where a journey says so. Create is refused
 * without an objective, so the templates it composes are not optional: they are pressed as
 * chips, because a binding needs the scenario's own resources and there is no scenario yet
 * (PLAN-UX Slice 14). Every binding, the context documents and the completion statement are
 * the editor's, which is where this leaves the operator.
 */
export async function createScenario(
  page: Page,
  scenario: {
    name: string;
    /** The bare reference the option carries — "T-204", not the composed label. */
    ticket: string;
    composes: string[];
    reads?: { customer: string; shopVersion: string };
  },
) {
  await openSection(page, "Scenarios", "Scenarios");
  await page.getByRole("link", { name: "New scenario" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "New scenario" })).toBeVisible();

  await page.getByLabel("Name", { exact: true }).fill(scenario.name);
  await page.getByLabel("Ticket", { exact: true }).selectOption({ label: scenario.ticket });
  if (scenario.reads !== undefined) {
    await expect(page.getByLabel("Customer", { exact: true })).toHaveText(scenario.reads.customer);
    await expect(page.getByLabel("Shop version", { exact: true })).toHaveText(
      scenario.reads.shopVersion,
    );
  }
  for (const template of scenario.composes) {
    await page.getByRole("button", { name: template, exact: true }).click();
  }
  await page.getByRole("button", { name: "Create scenario" }).click();

  await expect(page.getByRole("heading", { level: 1, name: scenario.name })).toBeVisible();
}

/**
 * An agent configuration, from the library into its own editor.
 *
 * The create page asks for the name and the model the arm will run on, and the model follows
 * the framework — so naming a framework here is naming what the lab has proven (PLAN-UX
 * Slice 13). The prompt, the tools and the tone are the editor's.
 */
export async function createConfiguration(
  page: Page,
  configuration: { name: string; identity: string; framework?: string },
) {
  await openSection(page, "Agent configurations", "Agent configurations");
  await page.getByRole("link", { name: "New configuration" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "New agent configuration" }),
  ).toBeVisible();

  await page.getByLabel("Name", { exact: true }).fill(configuration.name);
  await page
    .getByLabel("Adopted identity", { exact: true })
    .selectOption({ label: `${configuration.identity} · Customer support representative` });
  if (configuration.framework !== undefined) {
    await page
      .getByLabel("Framework", { exact: true })
      .selectOption({ label: configuration.framework });
  }
  await page.getByRole("button", { name: "Create configuration" }).click();

  await expect(page.getByRole("heading", { level: 1, name: configuration.name })).toBeVisible();
}

/**
 * A judge, from the library into its own editor.
 *
 * The rubric is answered on the way in: it is the whole of what a judge is, and Create is
 * refused without it (PLAN-UX Slice 13).
 */
export async function createJudge(
  page: Page,
  judge: { name: string; rubric: string; provider?: string },
) {
  await openSection(page, "Judges", "Judges");
  await page.getByRole("link", { name: "New judge" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "New judge" })).toBeVisible();

  await page.getByLabel("Name", { exact: true }).fill(judge.name);
  await page.getByLabel("Criteria", { exact: true }).fill(judge.rubric);
  if (judge.provider !== undefined) {
    await page.getByLabel("Provider", { exact: true }).selectOption(judge.provider);
  }
  await page.getByRole("button", { name: "Create judge" }).click();

  await expect(page.getByRole("heading", { level: 1, name: judge.name })).toBeVisible();
}

/**
 * A block template, from either library into its own editor.
 *
 * The name, the type axis and the parameters a scenario will bind are what the create page
 * asks for; the statement, the descriptions and the defaults are the editor's. The heading
 * is the slug the name was saved under, which is what the library and every binding use.
 */
export async function createBlock(
  page: Page,
  block: {
    library: "Objective blocks" | "Mutation blocks";
    name: string;
    /** "Assessed by" for an objective, "Perturbs" for a mutation. */
    axis?: { label: "Assessed by" | "Perturbs"; value: string };
    parameters?: { label: string; kind?: string }[];
  },
) {
  await openSection(page, block.library, block.library);
  const noun = block.library === "Objective blocks" ? "objective" : "mutation";
  await page.getByRole("link", { name: `New ${noun} block` }).click();
  await expect(page.getByRole("heading", { level: 1, name: `New ${noun} block` })).toBeVisible();

  await page.getByLabel("Name", { exact: true }).fill(block.name);
  if (block.axis !== undefined) {
    await page.getByLabel(block.axis.label, { exact: true }).selectOption(block.axis.value);
  }
  const addParameter = page.getByRole("form", { name: "Add a parameter" });
  for (const parameter of block.parameters ?? []) {
    await addParameter.getByLabel("Label", { exact: true }).fill(parameter.label);
    if (parameter.kind !== undefined) {
      await addParameter.getByLabel("Kind", { exact: true }).selectOption(parameter.kind);
    }
    await addParameter.getByRole("button", { name: "Add parameter" }).click();
  }
  await page.getByRole("button", { name: "Create block" }).click();

  await expect(page.getByRole("heading", { level: 1, name: block.name })).toBeVisible();
}
