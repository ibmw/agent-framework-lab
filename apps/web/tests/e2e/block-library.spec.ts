import type { Page } from "@playwright/test";
import { expect, test } from "./support/e2e";

/**
 * Milestone 2 block-library acceptance evidence: an author publishes the two templates the
 * wrong-address scenario will compose — an objective read-check and a concurrent-mutation
 * fault — and the frozen versions stay frozen while the drafts move on.
 *
 * The templates are shop-independent, so the journey only needs a shop to have a workspace to
 * stand in; nothing it authors names a single shop object.
 */

function card(page: Page, name: string) {
  return page.getByRole("region", { name });
}

async function saveDraft(page: Page) {
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText("All changes saved")).toBeVisible();
}

async function openWorkspace(page: Page, unique: string) {
  await page.goto("/shops");
  const createShop = card(page, "Create a shop");
  await createShop.getByLabel("Name", { exact: true }).fill(`Northstar ${unique}`);
  await createShop.getByLabel("Slug", { exact: true }).fill(`northstar-${unique}`);
  await createShop.getByRole("button", { name: "Create shop" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
}

test("an author publishes an objective block the whole lab can bind", async ({ page }) => {
  const unique = Date.now().toString(36);
  const name = `read-required-document-${unique}`;

  await openWorkspace(page, unique);

  await page.getByLabel("Shop workspace").getByRole("link", { name: "Objective blocks" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Objective blocks" })).toBeVisible();
  await expect(page.getByText("Shared across shops")).toBeVisible();

  const create = card(page, "New objective block");
  await create.getByLabel("Name", { exact: true }).fill(name);
  await create.getByRole("button", { name: "Create block" }).click();

  await page.getByRole("link", { name }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  await expect(page.getByText("Never published")).toBeVisible();

  // A brand-new template says nothing a scenario could bind without guessing.
  const gate = card(page, "Publish gate");
  await expect(gate.getByText(/renders each bound instance as this statement/)).toBeVisible();
  await expect(gate.getByText(/must say what it asserts/)).toBeVisible();

  const template = card(page, "Template");
  await template.getByLabel("Statement", { exact: true }).fill("Read document");
  await template
    .getByLabel("Description", { exact: true })
    .fill("Passes when the arm reads the bound document through its tool before the run ends.");

  const parameters = card(page, "Parameters");
  const addParameter = parameters.getByRole("form", { name: "Add a parameter" });
  await addParameter.getByLabel("Label", { exact: true }).fill("doc_ref");
  await addParameter.getByRole("button", { name: "Add parameter" }).click();

  // A document reference is bound by the scenario, so the template cannot default it.
  await expect(parameters.getByText("bound same-shop")).toBeVisible();
  await expect(parameters.getByLabel("Default of doc_ref")).toHaveCount(0);
  await parameters.getByLabel("Description of doc_ref").fill("The document the arm must read.");

  await addParameter.getByLabel("Label", { exact: true }).fill("severity");
  await addParameter.getByLabel("Kind", { exact: true }).selectOption("severity");
  await addParameter.getByRole("button", { name: "Add parameter" }).click();
  await parameters.getByLabel("Default of severity").selectOption("required");
  await parameters
    .getByLabel("Description of severity")
    .fill("Whether missing the read fails the objective or only warns.");

  await expect(
    parameters.getByText(/1 parameter\(s\) must be bound to objects in the scenario's own shop/),
  ).toBeVisible();

  await saveDraft(page);
  await expect(gate.getByText("No validation findings.")).toBeVisible();

  const publish = page.getByRole("button", { name: "Publish v1" });
  await expect(publish).toBeEnabled();
  await publish.click();
  await expect(page.getByText(/Published version 1/)).toBeVisible();
  await expect(page.getByText(/Draft matches v1/)).toBeVisible();

  // The draft moves on; the published version keeps the template it froze.
  await template.getByLabel("Statement", { exact: true }).fill("Read the bound document");
  await saveDraft(page);
  await expect(page.getByText(/Draft v2 in progress/)).toBeVisible();

  await page.getByLabel("Shop workspace").getByRole("link", { name: "Objective blocks" }).click();
  const row = page.getByRole("row").filter({ hasText: name });
  await expect(row.getByText("v1 · 1 version(s)")).toBeVisible();
  await expect(row.getByText("deterministic · event")).toBeVisible();
  await expect(row.getByText("1 bound same-shop")).toBeVisible();
});

test("a mutation block cannot be published until it says when it fires", async ({ page }) => {
  const unique = Date.now().toString(36);
  const name = `concurrent-entity-mutation-${unique}`;

  await openWorkspace(page, unique);

  await page.getByLabel("Shop workspace").getByRole("link", { name: "Mutation blocks" }).click();
  const create = card(page, "New mutation block");
  await create.getByLabel("Name", { exact: true }).fill(name);
  await create.getByRole("button", { name: "Create block" }).click();

  await page.getByRole("link", { name }).click();
  const template = card(page, "Template");
  await template.getByLabel("Statement", { exact: true }).fill("Concurrent mutation of");
  await template
    .getByLabel("Description", { exact: true })
    .fill("Mutates the bound entity out of band so the arm's next write hits a conflict.");

  const parameters = card(page, "Parameters");
  const addParameter = parameters.getByRole("form", { name: "Add a parameter" });
  await addParameter.getByLabel("Label", { exact: true }).fill("entity_ref");
  await addParameter.getByLabel("Kind", { exact: true }).selectOption("entity_reference");
  await addParameter.getByRole("button", { name: "Add parameter" }).click();
  await parameters.getByLabel("Description of entity_ref").fill("The order that moves.");
  await saveDraft(page);

  // Mutation order is the run timeline, so a mutation with no bound moment has no place on it.
  const gate = card(page, "Publish gate");
  await expect(gate.getByText(/must declare a timing parameter/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Publish v1" })).toBeDisabled();

  await addParameter.getByLabel("Label", { exact: true }).fill("timing");
  await addParameter.getByLabel("Kind", { exact: true }).selectOption("timing");
  await addParameter.getByRole("button", { name: "Add parameter" }).click();
  await parameters.getByLabel("Default of timing").fill("after_first_read");
  await parameters.getByLabel("Description of timing").fill("When the runtime injects it.");
  await saveDraft(page);

  await expect(gate.getByText("No validation findings.")).toBeVisible();
  await page.getByRole("button", { name: "Publish v1" }).click();
  await expect(page.getByText(/Published version 1/)).toBeVisible();
});
