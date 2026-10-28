import type { Page } from "@playwright/test";
import { createShop } from "./support/authoring";
import { expect, test } from "./support/e2e";
import { buildLab } from "./support/lab";
import {
  COLLAPSED_KEY,
  expectTopBarHoldsItsControls,
  PHONE,
  pastTheViewport,
} from "./support/viewport";

/**
 * The workspace shell owns the viewport: the rail and the content pane scroll independently,
 * so the rail's own controls stay on screen however long a section's content runs.
 *
 * This is a regression guard. When the page did the scrolling instead, a section taller than
 * the window stretched the rail down the document and parked its bottom control below the
 * fold — the collapse control read as missing on exactly the longest pages.
 */

/** Short enough that any real section overflows it. */
const VIEWPORT = { width: 1280, height: 620 };

/**
 * Rail label, then the heading it lands on. The rail and the page now say the same word:
 * ADR 0054 renamed the entry and PLAN-UX Slice 15 rebuilt the page as *Overview*. Support
 * guidelines is no longer on the rail at all — the prototype draws four setup entries, and
 * Slice 16 folds guidelines into the documents table.
 */
const SECTIONS = [
  ["Overview", "Overview"],
  ["Customers", "Customers"],
  ["Policies & FAQ", "Policies & FAQ"],
  ["Tone of voice", "Tone of voice"],
  ["Shop details", "Shop details"],
  ["Orders", "Orders"],
  ["Products", "Products"],
] as const;

async function expectRailControlOnScreen(page: Page, section: string) {
  const toggle = page.getByRole("button", { name: /^(Collapse|Expand) menu$/ });
  const box = await toggle.boundingBox();
  expect(box, `${section}: the rail control is not rendered`).not.toBeNull();
  expect(
    box !== null && box.y >= 0 && box.y + box.height <= VIEWPORT.height,
    `${section}: the rail control sits at y=${box?.y}, outside a ${VIEWPORT.height}px window`,
  ).toBe(true);
}

test("the rail keeps its controls on screen in every section", async ({ page }) => {
  const unique = Date.now().toString(36);
  await page.setViewportSize(VIEWPORT);

  await createShop(page, { name: `Northstar ${unique}`, slug: `northstar-${unique}` });

  // Enough authored content that shop details runs past a short window.
  await page.getByLabel("Shop workspace").getByRole("link", { name: "Shop details" }).click();
  const payments = page.getByRole("region", { name: "Payment methods" });
  await payments.getByLabel("ID", { exact: true }).fill("card");
  await payments.getByLabel("Name", { exact: true }).fill("Card synthetic");
  await payments.getByRole("button", { name: "Add payment method" }).click();
  const fulfilment = page.getByRole("region", { name: "Fulfillment methods" });
  await fulfilment.getByLabel("ID", { exact: true }).fill("standard");
  await fulfilment.getByLabel("Name", { exact: true }).fill("Standard 3-5 days");
  await fulfilment.getByLabel("Carrier", { exact: true }).fill("Nordic Post");
  await fulfilment.getByRole("button", { name: "Add fulfillment method" }).click();
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText("All changes saved")).toBeVisible();

  for (const [link, heading] of SECTIONS) {
    // Scoped to the rail: the guide strip on the shop home links to sections by name too.
    await page.getByLabel("Shop workspace").getByRole("link", { name: link }).click();
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    await expectRailControlOnScreen(page, heading);
  }
});

test("the rail collapses only when the author asks, in every section", async ({ page }) => {
  const unique = Date.now().toString(36);
  await page.setViewportSize(VIEWPORT);

  await createShop(page, { name: `Northstar ${unique}`, slug: `northstar-${unique}` });

  // Arriving anywhere — the helpdesk included — leaves the rail as the author left it.
  await page.getByLabel("Shop workspace").getByRole("link", { name: "Tickets" }).click();
  await expect(page.getByRole("button", { name: "Collapse menu" })).toBeVisible();

  await page.getByRole("button", { name: "Collapse menu" }).click();
  await page.getByLabel("Shop workspace").getByRole("link", { name: "Orders" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Orders" })).toBeVisible();

  // ...and the choice survives moving between sections.
  await expect(page.getByRole("button", { name: "Expand menu" })).toBeVisible();
  await page.getByRole("button", { name: "Expand menu" }).click();
  await expect(page.getByRole("button", { name: "Collapse menu" })).toBeVisible();
});

async function railWidth(page: Page, name = "Shop workspace") {
  const box = await page.getByRole("navigation", { name }).boundingBox();
  return box?.width ?? null;
}

test("at a phone's width the rail is the strip, nothing passes the viewport, and the preference stays", async ({
  page,
}) => {
  const unique = Date.now().toString(36);
  await page.setViewportSize({ width: 1280, height: 844 });
  await createShop(page, { name: `Northstar ${unique}`, slug: `northstar-${unique}` });

  // First paint at a phone's width, with nothing remembered: the strip from the first frame,
  // and still nothing written once the page has settled.
  const overview = page.url();
  await page.evaluate((key) => window.localStorage.removeItem(key), COLLAPSED_KEY);
  await page.setViewportSize(PHONE);
  await page.goto(overview);
  await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Expand menu" })).toBeVisible();
  expect(await railWidth(page)).toBe(52);
  expect(await pastTheViewport(page)).toEqual([]);
  await expectTopBarHoldsItsControls(page);
  expect(await page.evaluate((key) => window.localStorage.getItem(key), COLLAPSED_KEY)).toBeNull();

  for (const stored of ["false", "true"]) {
    await page.setViewportSize({ width: 1280, height: 844 });
    await page.evaluate(
      ([key, value]) => window.localStorage.setItem(key, value),
      [COLLAPSED_KEY, stored],
    );
    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
    expect(await railWidth(page)).toBe(stored === "true" ? 52 : 216);

    await page.setViewportSize(PHONE);
    await expect(page.getByRole("button", { name: "Expand menu" })).toBeVisible();
    expect(await railWidth(page)).toBe(52);
    expect(await pastTheViewport(page), `remembered ${stored}`).toEqual([]);
    // The bar wraps rather than running Settings off the edge, and grows to hold what it wraps.
    await expectTopBarHoldsItsControls(page);

    // Opened to pick a destination: the column, and nothing written. Once there, the page has
    // its width back and the rail is the strip again.
    await page.getByRole("button", { name: "Expand menu" }).click();
    expect(await railWidth(page)).toBe(216);
    await page.getByLabel("Shop workspace").getByRole("link", { name: "Orders" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Orders" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Expand menu" })).toBeVisible();
    expect(await railWidth(page)).toBe(52);
    expect(await pastTheViewport(page), `remembered ${stored}, on Orders`).toEqual([]);
    // Opened again, so the widening below starts from an opening it has to drop.
    await page.getByRole("button", { name: "Expand menu" }).click();
    expect(await railWidth(page)).toBe(216);
    expect(await page.evaluate((key) => window.localStorage.getItem(key), COLLAPSED_KEY)).toBe(
      stored,
    );

    // Wide again, the remembered choice is back, whatever was opened narrow.
    await page.setViewportSize({ width: 1280, height: 844 });
    await expect(
      page.getByRole("button", { name: stored === "true" ? "Expand menu" : "Collapse menu" }),
    ).toBeVisible();
    expect(await railWidth(page)).toBe(stored === "true" ? 52 : 216);
    await page.getByLabel("Shop workspace").getByRole("link", { name: "Overview" }).click();
  }

  // The lab's rail, on the bench, folds at the same width.
  await page.goto("/lab/bench");
  await page.setViewportSize(PHONE);
  await expect(page.getByRole("heading", { level: 1, name: "New experiment" })).toBeVisible();
  expect(await railWidth(page, "Experiment lab workspace")).toBe(52);
  expect(await pastTheViewport(page)).toEqual([]);
  expect(await page.evaluate((key) => window.localStorage.getItem(key), COLLAPSED_KEY)).toBe(
    "true",
  );
});

/**
 * The surfaces ADR 0079 left open, at a phone's width: every index on the template draws its
 * table in a scroller of its own, so the pane never scrolls sideways — History's included, whose
 * rows carry `sr-only` reasons that a scroller not `relative` lets out against the pane — and a
 * shop name longer than the bar's row is cut with an ellipsis, still named in full.
 */
test("at a phone's width the indexes scroll their tables and a long shop name is cut, not spilled", async ({
  page,
  request,
}) => {
  const lab = await buildLab(request);
  // The one index the chain writes no row for: no arm is judged.
  const judge = await request.post("/api/v1/judge-configurations", {
    data: { name: `Narrow sweep ${Date.now().toString(36)}` },
  });
  expect(judge.ok(), await judge.text()).toBe(true);
  const shop = (path: string) => `/shops/${lab.shopId}${path}`;
  await page.setViewportSize(PHONE);

  // Each index, the heading it lands on, and its card's title: the card holds a table there, so
  // the check is of a drawn table and not of an empty state.
  const INDEXES = [
    ["/shops", "Shops", "In this lab"],
    [shop("/products"), "Products", "Catalog"],
    [shop("/orders"), "Orders", "Order fixtures"],
    [shop("/customers"), "Customers", "Attached to this shop"],
    [shop("/tickets"), "Tickets", "Raised in this shop"],
    [shop("/scenarios"), "Scenarios", "Built on this shop"],
    [shop("/setup/policies"), "Policies & FAQ", "What the agent can consult"],
    ["/lab/support-identities", "Support identities", "Shared by every shop"],
    ["/lab/agent-configurations", "Agent configs", "Agents under test"],
    ["/lab/judges", "Judges", "What a scenario leaves to a judge"],
    ["/lab/objective-blocks", "Objective blocks", "What a scenario can assert"],
    ["/lab/mutation-blocks", "Mutation blocks", "Faults a scenario can inject"],
    ["/lab/history", "Experiment history", "Recorded across every shop"],
  ] as const;
  for (const [path, heading, card] of INDEXES) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    const index = page.locator("section").filter({
      has: page.getByRole("heading", { level: 2, name: card }),
    });
    await expect(index.getByRole("table")).toBeVisible();
    expect.soft(await pastTheViewport(page), path).toEqual([]);
  }

  // History's rows carry their `sr-only` reasons, so the case above is the one the `relative`
  // scroller answers and not a table with nothing absolutely placed in it.
  await page.goto("/lab/history");
  // One row with the button is the case; earlier specs in the run may have left several.
  await expect(
    page.getByRole("button", { name: "Fork with newer versions" }).first(),
  ).toBeVisible();
  expect(await page.locator("table .sr-only").count()).toBeGreaterThan(0);

  // A shop whose name is longer than the bar's row: cut, on the bar's first row, and still the
  // name the switcher is known by.
  const long = `Northstar Outfitters of the Far Northern Fjords ${Date.now().toString(36)}`;
  const created = await request.post("/api/v1/shops", {
    data: {
      identity: {
        name: long,
        slug: `fjords-${Date.now().toString(36)}`,
        locale: "en-GB",
        currencies: ["EUR"],
        channels: ["chat"],
      },
    },
  });
  expect(created.ok(), await created.text()).toBe(true);
  const { shop_id: longId } = (await created.json()) as { shop_id: string };
  await page.goto(`/shops/${longId}`);
  await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
  const switcher = page.getByRole("button", { name: /^Switch shop/ });
  await expect(switcher).toHaveAccessibleName(`Switch shop, current: ${long}`);
  const name = switcher.getByTitle(long, { exact: true });
  await expect(name).toHaveText(long);
  expect(
    await name.evaluate((element) => element.scrollWidth > element.clientWidth),
    "the name is cut rather than drawn whole",
  ).toBe(true);
  expect(await name.evaluate((element) => getComputedStyle(element).textOverflow)).toBe("ellipsis");
  expect(await pastTheViewport(page)).toEqual([]);
  await expectTopBarHoldsItsControls(page);
});

/**
 * PLAN-UX Slice 8's own evidence, in a browser: an edit that the rail would carry somewhere it
 * cannot be saved is asked about once, and the three answers do what they say.
 */
test("asks before the rail carries an unsaved product edit out of reach", async ({ page }) => {
  const unique = Date.now().toString(36);

  await createShop(page, { name: `Northstar ${unique}`, slug: `northstar-${unique}` });

  await page.getByLabel("Shop workspace").getByRole("link", { name: "Products" }).click();
  await page.getByRole("button", { name: "New product" }).click();
  const details = page.getByRole("region", { name: "Details" });
  await details.getByLabel("Title", { exact: true }).fill("Alpine Shell Jacket");
  await details.getByLabel("Category", { exact: true }).fill("Jackets");
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText("All changes saved")).toBeVisible();

  // Already standing in the editor: *New product* lands here (PLAN-UX Slice 12), so the
  // journey no longer walks back to the catalog to open what it just made.
  await details
    .getByLabel("Description", { exact: true })
    .fill("Three-layer waterproof shell with taped seams.");

  // The product editor and the catalog save the same draft, so moving between them asks nothing.
  await page.getByLabel("Shop workspace").getByRole("link", { name: "Products" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Products" })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // Orders cannot save it, so it is asked about — once, with three answers.
  await page.getByLabel("Shop workspace").getByRole("link", { name: "Orders" }).click();
  const prompt = page.getByRole("dialog", { name: "Unsaved changes" });
  await expect(prompt).toContainText("The shop draft has unsaved changes.");
  await prompt.getByRole("button", { name: "Stay on this page" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Products" })).toBeVisible();

  await page.getByLabel("Shop workspace").getByRole("link", { name: "Orders" }).click();
  await prompt.getByRole("button", { name: "Discard and leave" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Orders" })).toBeVisible();

  // Discard read the draft back, so the description the lab holds is the one it was saved with.
  await page.getByLabel("Shop workspace").getByRole("link", { name: "Products" }).click();
  await page.getByRole("link", { name: "Alpine Shell Jacket" }).click();
  await expect(
    page.getByRole("region", { name: "Details" }).getByLabel("Description", { exact: true }),
  ).toHaveValue("");
});

/**
 * PLAN-UX Slice 10's own evidence, in a browser (ADR 0055): the bar switches shop without
 * leaving the mode, offers the tour of whatever screen the operator is on, and closes Settings
 * back onto what was underneath it.
 */
test("the top bar switches shop, offers the tour, and closes Settings onto the page beneath", async ({
  page,
}) => {
  const unique = Date.now().toString(36);

  await createShop(page, { name: `Alpenglow ${unique}`, slug: `alpenglow-${unique}` });
  await createShop(page, { name: `Northstar ${unique}`, slug: `northstar-${unique}` });

  await page.getByLabel("Shop workspace").getByRole("link", { name: "Products" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Products" })).toBeVisible();

  // The switcher is a menu, and picking a shop by its name is what an operator does with it.
  const switcher = page.getByRole("button", { name: /^Switch shop/ });
  await expect(switcher).toHaveAccessibleName(`Switch shop, current: Northstar ${unique}`);
  await switcher.click();
  await page.getByRole("menuitem", { name: `Alpenglow ${unique}` }).click();

  await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
  await expect(switcher).toHaveAccessibleName(`Switch shop, current: Alpenglow ${unique}`);
  // Still in shop mode: the switcher moves the shop, never the mode.
  await expect(
    page.getByLabel("Workspace mode").getByRole("link", { name: "Shop fixture" }),
  ).toHaveAttribute("aria-current", "page");
  // And the panel is gone, dismissed by the navigation it caused.
  await expect(page.getByRole("menu", { name: "Shops" })).toHaveCount(0);

  // The tour of the screen the operator is standing on, from the same bar.
  await page.getByRole("button", { name: "Show me around the overview" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // Settings, from the product the slice's evidence says an operator comes back to: the editor
  // of one product, which is a deeper address than the catalog and the one a reader would
  // notice losing.
  await page.getByLabel("Shop workspace").getByRole("link", { name: "Products" }).click();
  await page.getByRole("button", { name: "New product" }).click();
  const details = page.getByRole("region", { name: "Details" });
  await details.getByLabel("Title", { exact: true }).fill("Alpine Shell Jacket");
  await details.getByLabel("Category", { exact: true }).fill("Jackets");
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText("All changes saved")).toBeVisible();
  // *New product* lands in the editor, which is the deeper address this case is about.
  await expect(page.getByRole("heading", { level: 1, name: "Alpine Shell Jacket" })).toBeVisible();
  const editorUrl = page.url();

  await page.getByRole("link", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Lab settings" })).toBeVisible();

  // The page's own "← Back to workspace" reads the same remembered location the bar's toggle
  // does (PLAN-UX Slice 18), so the chrome and the page cannot disagree about what is under it.
  await expect(page.getByRole("link", { name: "Back to workspace" })).toHaveAttribute(
    "href",
    new URL(editorUrl).pathname,
  );

  // Lit, with a close glyph, and the second press returns to what was underneath — after a
  // reload, which is the case `history.back()` cannot answer.
  await page.reload();
  const close = page.getByRole("button", { name: "Settings, back to workspace" });
  await expect(close).toBeVisible();
  await close.click();

  await expect(page.getByRole("heading", { level: 1, name: "Alpine Shell Jacket" })).toBeVisible();
  expect(page.url()).toBe(editorUrl);
});

/**
 * ADR 0052's own check, in a browser: `workspace-shell` "covers saving a connection and
 * reading the page back".
 *
 * The connection is saved with **no key**, and that is the case rather than a shortcut around
 * one. A saved connection carrying no key at all is in force and credentialed, because a local
 * endpoint needs none and that is the case ADR 0052 exists for — and this stack runs with no
 * `AGENT_LAB_CREDENTIAL_KEY`, so a key typed here would be refused with 422 by design.
 *
 * What it reads back is the whole chain: the endpoint the lab *stored*, which is normalized
 * and so need not be the spelling that was typed; the chip that endpoint belongs to; and the
 * run mode underneath, which is a per-request answer now and moves without a restart.
 *
 * **It leaves the connection saved**, in a database every later test on this worker shares,
 * and that is deliberate rather than an oversight: the resource has no route that removes a
 * connection (ADR 0052 gives it list, read, save and test), and a save cannot put back *no
 * connection*, so there is nothing to restore with. The coupling is safe for what the rest of
 * the suite does, and each reason is checkable:
 *
 * - No other spec asserts on run mode, the connection source or the lab status — this is the
 *   only one that opens *Runtime configuration*. The agent and judge editors and experiment
 *   setup do read the lab status, and no spec asserts on the note they show from it.
 * - Every other spec that advances a run or scores one does it on the deterministic control
 *   framework and the deterministic judge. Both are registered whatever the connection is, and
 *   both reach no endpoint, so neither pins one: a run they advance records no
 *   `model_base_url` and the pin refusal cannot fire on it.
 * - What a keyless loopback connection *adds* is the two model-backed frameworks and the
 *   model-backed judge, pointed at a port where nothing listens. No other spec runs either:
 *   `agent-configuration` authors a draft on the OpenAI Agents SDK and never advances it, and
 *   what that editor offers is decided by `PROVEN_FRAMEWORKS`, not by the connection.
 *
 * What the coupling does cost is a retry of this test on the same worker, whose database
 * already holds the connection. The precondition below is asserted so that such a run fails
 * on the fact that is actually wrong — the lab was not fresh — rather than passing vacuously
 * or failing three steps later on a Save that was never offered.
 */
test("a connection saved in Settings is in force, and the page reads it back", async ({ page }) => {
  const unique = Date.now().toString(36);

  await createShop(page, { name: `Northstar ${unique}`, slug: `northstar-${unique}` });
  await page.getByRole("link", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Lab settings" })).toBeVisible();

  const zone = page.getByRole("region", { name: "Model provider" });
  // The precondition: nothing is saved yet. It is the zone's own sentence rather than *Offline*,
  // because a stack started from a shell that exports AGENT_LAB_OPENAI_API_KEY is credentialed
  // on the environment, and what this test proves is that a *saved* connection takes over.
  await expect(
    zone.getByText(/^Nothing is saved here yet/),
    "this worker's lab already holds a saved connection, so the test cannot show one taking over",
  ).toBeVisible();
  // Nothing to save until something is changed, so the pair is absent on arrival.
  await expect(zone.getByRole("button", { name: "Save connection" })).toHaveCount(0);

  // The label is what a reader presses; the radio underneath carries the name.
  await zone.getByText("Ollama", { exact: true }).click();
  await expect(zone.getByLabel("Base URL")).toHaveValue("http://localhost:11434/v1");
  // A paste's trailing slash: one endpoint has one spelling, because a run is pinned to it.
  await zone.getByLabel("Base URL").fill("http://localhost:11434/v1/");
  await zone.getByRole("button", { name: "Save connection" }).click();

  await expect(zone.getByRole("button", { name: "Save connection" })).toHaveCount(0);
  await expect(zone.getByLabel("Base URL")).toHaveValue("http://localhost:11434/v1");

  // Read back after a reload, which is what "the lab holds it" means rather than "the form
  // still shows it".
  await page.reload();
  await expect(zone.getByRole("radio", { name: "Ollama" })).toBeChecked();
  await expect(zone.getByLabel("Base URL")).toHaveValue("http://localhost:11434/v1");

  // And the read-only zone says which of the chain's four answers is in force. Nothing was
  // saved a moment ago, as asserted above, and nothing restarted.
  await page.getByRole("button", { name: /^Runtime configuration/ }).click();
  const runMode = page.getByRole("region", { name: "Run mode" });
  await expect(runMode.getByText("Credentialed")).toBeVisible();
  await expect(
    runMode.getByText(/The connection saved in Model provider above is in force/),
  ).toBeVisible();
  await expect(zone.getByText(/^Nothing is saved here yet/)).toHaveCount(0);
});

/**
 * PLAN-UX Slice 18's own evidence, in a browser: a preference is saved the moment it changes,
 * and it reaches a listing the settings page does not draw (ADR 0058).
 */
test("a timestamp preference set in Settings reaches a listing Settings never draws", async ({
  page,
}) => {
  const unique = Date.now().toString(36);

  await createShop(page, { name: `Northstar ${unique}`, slug: `northstar-${unique}` });

  await page.getByRole("link", { name: "Settings" }).click();
  const stamps = page.getByRole("group", { name: "Timestamps" });
  await expect(stamps.getByRole("radio", { name: "Relative" })).toBeChecked();
  // The label is what a reader presses; the radio underneath it carries the name and the
  // keyboard behaviour.
  await stamps.getByText("Absolute").click();
  await expect(stamps.getByRole("radio", { name: "Absolute" })).toBeChecked();

  // Nothing was submitted, and leaving is what carries the preference out.
  await page.getByRole("link", { name: "Back to workspace" }).click();
  await page.getByRole("button", { name: /^Switch shop/ }).click();
  await page.getByRole("menuitem", { name: "All shops" }).click();

  const row = page.getByRole("row", { name: new RegExp(`Northstar ${unique}`) });
  await expect(row.getByText(/^\d{1,2} \w{3,4} \d{4}, \d{2}:\d{2}$/)).toBeVisible();
  await expect(row.getByText(/ago$/)).toHaveCount(0);
});

/**
 * The lab rail's entries, in rail order, and whether each draws a count beside its label. The
 * test below reads the rail and fails if it holds anything else, so an entry added to it is
 * measured from the day it lands.
 */
const LAB_ENTRIES = [
  ["Bench", false],
  ["History", true],
  ["Agent configs", true],
  ["Judges", true],
  ["Support identities", true],
  ["Objective blocks", true],
  ["Mutation blocks", true],
] as const;

/** Waits for the workspace's faces to settle, so nothing is measured in the swap's fallback. */
async function fontsSettled(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
}

/**
 * "Agent configurations" wrapped onto two lines beside its count in the lab's 216px rail, which
 * is why the index is named *Agent configs* (design-direction, *Names*). Each entry is measured
 * while it is the active one, bold by its computed weight, which is its widest state: its label's
 * text makes one line. The check once covered *Agent configs* alone, because the stack named an
 * Inter nothing loaded and a width measured here held only for this machine's fallback. Now the
 * workspace ships its own Inter, which the next test holds, every entry is measured.
 */
test("every lab rail entry, active and bold, sits on one line beside its count", async ({
  page,
}) => {
  await page.setViewportSize(VIEWPORT);

  await page.goto("/lab/bench");
  const rail = page.getByLabel("Experiment lab workspace");
  await expect(rail.getByRole("link", { name: "Bench" })).toBeVisible();
  expect(
    await rail.getByRole("link").evaluateAll((links) =>
      links.map((link) => {
        const label = document.getElementById(link.getAttribute("aria-labelledby") ?? "");
        return label?.textContent ?? link.textContent;
      }),
    ),
  ).toEqual(LAB_ENTRIES.map(([label]) => label));

  for (const [name, counted] of LAB_ENTRIES) {
    const entry = rail.getByRole("link", { name, exact: true });
    await entry.click();
    await expect(entry).toHaveAttribute("aria-current", "page");
    if (counted) {
      // The figure is drawn once the listing is read; the measure is of the row as it settles.
      const figure = entry.locator('span[aria-hidden="true"]').filter({ hasText: /^\d+$/ });
      await expect(figure).toBeVisible();
    }
    await fontsSettled(page);

    const measure = await entry.evaluate((element) => {
      const label = document.getElementById(element.getAttribute("aria-labelledby") ?? "");
      if (label === null) {
        throw new Error("the entry has no label to measure");
      }
      const range = document.createRange();
      range.selectNodeContents(label);
      const lines = new Set([...range.getClientRects()].map((rect) => Math.round(rect.top)));
      return { weight: Number(getComputedStyle(label).fontWeight), lines: lines.size };
    });

    expect(measure.weight, `${name}: the active entry is measured in bold`).toBeGreaterThanOrEqual(
      700,
    );
    expect(measure.lines, `${name} wraps onto ${measure.lines} lines`).toBe(1);
  }
});

/**
 * The workspace draws in its own Inter rather than in whatever the machine has (design-direction,
 * *Tokens, type and glyphs*). The stylesheet named Inter long before anything loaded it, and a
 * name the browser cannot find is passed over without a word, so this is asked of the page that
 * was drawn: a rail label's computed family leads with Inter, the stylesheet's Inter face is
 * loaded, and the glyphs Chromium actually laid out for that
 * label came from a web font named Inter — not from a local font that happens to share the name.
 * `document.fonts.check("600 13px Inter")` is not asked: it answers true when no Inter face is
 * declared at all, which the mutation that removed the `@font-face` showed.
 */
test("the rail is drawn in the workspace's own Inter", async ({ page }) => {
  await page.setViewportSize(VIEWPORT);

  await page.goto("/lab/bench");
  const entry = page.getByLabel("Experiment lab workspace").getByRole("link", { name: "Bench" });
  await expect(entry).toBeVisible();
  await fontsSettled(page);

  const drawn = await entry.evaluate((element) => {
    const label = document.getElementById(element.getAttribute("aria-labelledby") ?? "");
    if (label === null) {
      throw new Error("the entry has no label to inspect");
    }
    const faces = [...document.fonts].filter((face) => face.family.replaceAll('"', "") === "Inter");
    return {
      id: label.id,
      family: getComputedStyle(label).fontFamily,
      size: getComputedStyle(label).fontSize,
      faces: faces.map((face) => `${face.style} ${face.weight} ${face.status}`),
    };
  });

  expect(drawn.family, "the label's stack").toMatch(/^Inter,/);
  expect(drawn.size, "the rail's size").toBe("13px");
  expect(drawn.faces, "the stylesheet's Inter faces").toContain("normal 100 900 loaded");

  const cdp = await page.context().newCDPSession(page);
  await cdp.send("DOM.enable");
  await cdp.send("CSS.enable");
  const { root } = await cdp.send("DOM.getDocument", { depth: 0 });
  const { nodeId } = await cdp.send("DOM.querySelector", {
    nodeId: root.nodeId,
    selector: `[id="${drawn.id}"]`,
  });
  const { fonts } = await cdp.send("CSS.getPlatformFontsForNode", { nodeId });
  expect(
    fonts.map((font) => `${font.familyName}${font.isCustomFont ? " (web font)" : ""}`),
    "the fonts Chromium laid the label out in",
  ).toEqual([expect.stringMatching(/^Inter.* \(web font\)$/)]);
});
