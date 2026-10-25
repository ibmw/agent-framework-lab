import type { Locator, Page } from "@playwright/test";
import { test as base, expect } from "./support/e2e";
import { type BuiltLab, buildLab } from "./support/lab";
import { webOrigin } from "./support/stack";

/**
 * An editor's header stays at the top of the scrolling pane, and nothing it covers is lost.
 *
 * What only a browser can say: that the header is actually stuck — a `sticky` class under an
 * `overflow` ancestor, or under a parent no taller than itself, renders perfectly and scrolls
 * away — that Save is on screen and pressable at the foot of the longest editor, and that a
 * control a keyboard reader tabs up to is scrolled clear of the header rather than revealed
 * underneath it (WCAG 2.2, 2.4.11).
 */

/**
 * The name of the agent configuration whose header the third-of-the-pane tests measure.
 *
 * Fixed, because the header's steady height follows how its title wraps, and the chain's own
 * names carry a timestamp: at 390×844 one name in six wrapped the title and its chips 2px under
 * the pane's third, and the header pinned. This one is measured in the middle of a run of
 * lengths that wrap alike: 350px at 390×844, against a third of 262.67px, and 131px at 960×540,
 * against a third of 161.33px. Those figures were measured in Chromium on macOS, where the title
 * is set in Georgia; on CI's Ubuntu runner the title's Georgia and the fingerprint's monospace
 * fall back to other fonts, so the wrap there is the margins' to absorb.
 *
 * It is a deliberate exception to the per-spec suffix rule of `docs/testing-strategy.md`: the
 * configuration is opened only by its id, so a duplicate left by a restarted worker is harmless.
 */
const SIZED_NAME = "Frontline A, sized header";

/** How far a measured header must sit from the pane's third, so a drift fails by name. */
const MARGIN = 15;

/** How far the 960×540 header with its report must sit over the third (see that test). */
const REPORT_MARGIN = 10;

type Lab = BuiltLab & { judgeId: string; sizedConfigurationId: string };

const test = base.extend<object, { lab: Lab }>({
  lab: [
    async ({ playwright }, use, workerInfo) => {
      const api = await playwright.request.newContext({
        baseURL: webOrigin(workerInfo.parallelIndex),
      });
      const lab = await buildLab(api);
      // The one editor the chain does not write an object for: no arm is judged.
      const judge = await api.post("/api/v1/judge-configurations", {
        data: { name: `Sticky sweep ${Date.now().toString(36)}` },
      });
      expect(judge.ok(), await judge.text()).toBe(true);
      const { judge_id: judgeId } = (await judge.json()) as { judge_id: string };
      // An arm's configuration as the chain writes one — drafted, then published — under a name
      // of known width, so its header is the same height on every run.
      const created = await api.post("/api/v1/agent-configurations", {
        data: { name: SIZED_NAME, support_identity_id: lab.identityId },
      });
      expect(created.ok(), await created.text()).toBe(true);
      const sized = (await created.json()) as {
        configuration_id: string;
        content: Record<string, unknown>;
      };
      const drafted = await api.put(
        `/api/v1/agent-configurations/${sized.configuration_id}/draft`,
        {
          data: {
            payload: {
              ...sized.content,
              prompt:
                "You are {{support_identity.role}} for {{shop.name}}.\n\n" +
                "Write in the shop's tone of voice: {{shop.tone_of_voice}}.",
            },
          },
        },
      );
      expect(drafted.ok(), await drafted.text()).toBe(true);
      const published = await api.post(
        `/api/v1/agent-configurations/${sized.configuration_id}/versions`,
        { data: {} },
      );
      expect(published.ok(), await published.text()).toBe(true);
      await use({ ...lab, judgeId, sizedConfigurationId: sized.configuration_id });
      await api.dispose();
    },
    // The chain is some forty writes, on a stack that may still be warming up.
    { scope: "worker", timeout: 120_000 },
  ],
});

test.describe.configure({ mode: "default" });

/** The page's own header: the one that holds the name the tour lights. */
function pageHeader(page: Page): Locator {
  return page.locator("main header").filter({ has: page.locator('[data-tour="page-name"]') });
}

async function box(locator: Locator) {
  const found = await locator.boundingBox();
  if (found === null) {
    throw new Error("expected a rendered box");
  }
  return found;
}

test("an operator at the bottom of the product editor's reviews card presses Save without scrolling", async ({
  page,
  lab,
}) => {
  await page.goto(`/shops/${lab.shopId}/products/alpine-shell-jacket`);
  await expect(page.getByRole("heading", { level: 1, name: "Alpine Shell Jacket" })).toBeVisible();

  // The reviews card is the last of the editor's cards, so a review added there is an edit made
  // at the foot of the page.
  const reviews = page.getByRole("region", { name: "Ratings and reviews" });
  await reviews.getByLabel("Author", { exact: true }).fill("Ines");
  await reviews.getByLabel("Body", { exact: true }).fill("Kept me dry on the ridge.");
  await reviews.getByRole("button", { name: "Add review" }).click();
  await expect(reviews.getByText("“Kept me dry on the ridge.” — Ines")).toBeVisible();

  const main = page.locator("main");
  await main.evaluate((pane) => pane.scrollTo(0, pane.scrollHeight));
  const scrolled = await main.evaluate((pane) => pane.scrollTop);
  // The page really is longer than the screen, and the operator really is at its foot.
  expect(scrolled).toBeGreaterThan(500);
  await expect(reviews.getByRole("button", { name: "Add review" })).toBeInViewport();
  await expect(page.getByRole("heading", { level: 2, name: "Details" })).not.toBeInViewport();

  // The header is pinned to the top of the pane, not somewhere above it.
  expect((await box(pageHeader(page))).y).toBe((await box(main)).y);

  const save = page.getByRole("button", { name: "Save draft" });
  await expect(save).toBeInViewport({ ratio: 1 });
  // Nothing is drawn over it: the point at its centre is Save itself.
  const found = await box(save);
  const centre = { x: found.x + found.width / 2, y: found.y + found.height / 2 };
  const hit = await page.evaluate(
    ({ x, y }) => document.elementFromPoint(x, y)?.closest("button")?.textContent ?? null,
    centre,
  );
  expect(hit).toContain("Save draft");

  // Pressed where it is on screen, with the pointer, rather than through `click()`, which would
  // scroll it into view first and so prove nothing about where it already was.
  await page.mouse.click(centre.x, centre.y);
  await expect(page.getByRole("status").filter({ hasText: "All changes saved" })).toBeVisible();
});

test("a field tabbed up to from just under the header is scrolled clear of it", async ({
  page,
  lab,
}) => {
  await page.goto(`/shops/${lab.shopId}/products/alpine-shell-jacket`);
  await expect(page.getByRole("heading", { level: 1, name: "Alpine Shell Jacket" })).toBeVisible();

  const details = page.getByRole("region", { name: "Details" });
  const upper = details.getByRole("textbox", { name: "Title" });
  const lower = details.getByRole("textbox", { name: "Handle" });
  const main = page.locator("main");
  const header = pageHeader(page);

  // Put the lower field just below the header's rule, which leaves the one above it underneath
  // the header — revealed by the pane, hidden by the header.
  const headerBottom = async () => {
    const found = await box(header);
    return found.y + found.height;
  };
  const shift = (await box(lower)).y - (await headerBottom()) - 4;
  await main.evaluate((pane, by) => pane.scrollBy(0, by), shift);
  expect((await box(upper)).y + (await box(upper)).height).toBeLessThanOrEqual(
    await headerBottom(),
  );

  await lower.evaluate((field) => (field as HTMLElement).focus({ preventScroll: true }));
  await page.keyboard.press("Shift+Tab");

  await expect(upper).toBeFocused();
  expect((await box(upper)).y).toBeGreaterThanOrEqual(await headerBottom());
});

/** Whether the header is pinned, and the clearance the pane gives it. */
async function pinning(page: Page) {
  return {
    position: await pageHeader(page).evaluate((element) => getComputedStyle(element).position),
    clearance: await page.locator("main").evaluate((pane) => pane.style.scrollPaddingTop),
  };
}

/** The header's height without its report row, which is what decides whether it holds. */
async function steadyHeight(page: Page): Promise<number> {
  return pageHeader(page).evaluate((header: HTMLElement) => {
    const report = header.querySelector<HTMLElement>(":scope > [data-sticky-report]");
    const gap = Number.parseFloat(getComputedStyle(header).rowGap) || 0;
    return (
      header.offsetHeight - (report && report.offsetHeight > 0 ? report.offsetHeight + gap : 0)
    );
  });
}

function hrefOf(lab: Lab, name: string): string {
  const found = surfaces(lab).find(([surface]) => surface === name);
  if (found === undefined) throw new Error(`no surface called ${name}`);
  return found[1];
}

test("at 390×844 a header taller than a third of the pane scrolls away, and a short one still holds", async ({
  page,
  lab,
}) => {
  // A phone: the lab's own editors wrap to nearly half the pane; the product editor does not.
  await page.setViewportSize({ width: 390, height: 844 });
  const main = page.locator("main");

  await page.goto(`/lab/agent-configurations/${lab.sizedConfigurationId}`);
  await expect(pageHeader(page)).toBeVisible();
  await expect.poll(() => pinning(page)).toEqual({ position: "static", clearance: "" });
  // Measured more than a third, and unpinning does not change the measurement: it stays
  // unpinned through a scroll and a few frames rather than flickering back.
  await main.evaluate((pane) => pane.scrollBy(0, 300));
  await page.evaluate(
    () => new Promise((settled) => requestAnimationFrame(() => requestAnimationFrame(settled))),
  );
  expect(await pinning(page)).toEqual({ position: "static", clearance: "" });
  const third = (await box(main)).height / 3;
  expect(
    await steadyHeight(page),
    `the header of "${SIZED_NAME}" is no longer ${MARGIN}px over the pane's third of ${third.toFixed(2)}px`,
  ).toBeGreaterThanOrEqual(third + MARGIN);

  await page.goto(hrefOf(lab, "product editor"));
  await expect(pageHeader(page)).toBeVisible();
  await expect.poll(async () => (await pinning(page)).position).toBe("sticky");
  const held = (await box(pageHeader(page))).height;
  expect(held).toBeLessThanOrEqual((await box(main)).height / 3);
  // The header's height plus the focus ring's clearance, to the whole pixel `offsetHeight` reads.
  expect(Number.parseFloat((await pinning(page)).clearance)).toBeCloseTo(held + 8, -0.5);
});

test("at 960×540 a header is held on its name and actions, and its report rides along", async ({
  page,
  lab,
}) => {
  // A 1080p screen at 200% zoom. The agent configuration editor's header is 176 of 484px with
  // the lines under Publish, and within a third without them: it holds, and the pane clears
  // the whole of it, lines included.
  await page.setViewportSize({ width: 960, height: 540 });
  const main = page.locator("main");
  await page.goto(`/lab/agent-configurations/${lab.sizedConfigurationId}`);
  await expect(pageHeader(page)).toBeVisible();
  await expect.poll(async () => (await pinning(page)).position).toBe("sticky");
  // The report as the gate settles it, rather than the shorter "Checking the draft…" before it.
  await expect(pageHeader(page).getByText(/identical to v1/)).toBeVisible();

  const third = (await box(main)).height / 3;
  const whole = (await box(pageHeader(page))).height;
  expect(
    await steadyHeight(page),
    `the header of "${SIZED_NAME}" is no longer ${MARGIN}px under the pane's third of ${third.toFixed(2)}px`,
  ).toBeLessThanOrEqual(third - MARGIN);
  // The report row adds at most ~15px over the third, so this asserts less.
  expect(
    whole,
    `the header of "${SIZED_NAME}" with its report is no longer ${REPORT_MARGIN}px over the pane's third of ${third.toFixed(2)}px`,
  ).toBeGreaterThanOrEqual(third + REPORT_MARGIN);
  expect(Number.parseFloat((await pinning(page)).clearance)).toBeCloseTo(whole + 8, -0.5);
});

test("a failed Save pressed at the foot of the page says so where it was pressed", async ({
  page,
  lab,
}) => {
  await page.goto(`/shops/${lab.shopId}/products/alpine-shell-jacket`);
  await expect(page.getByRole("heading", { level: 1, name: "Alpine Shell Jacket" })).toBeVisible();
  const reviews = page.getByRole("region", { name: "Ratings and reviews" });
  await reviews.getByLabel("Author", { exact: true }).fill("Noor");
  await reviews.getByLabel("Body", { exact: true }).fill("Seams let the rain in.");
  await reviews.getByRole("button", { name: "Add review" }).click();

  // Every write the lab is asked for fails from here on.
  await page.route("**/api/**", (route) =>
    route.request().method() === "GET"
      ? route.continue()
      : route.fulfill({ status: 500, contentType: "application/json", body: "{}" }),
  );
  await page.locator("main").evaluate((pane) => pane.scrollTo(0, pane.scrollHeight));
  const save = page.getByRole("button", { name: "Save draft" });
  const found = await box(save);
  await page.mouse.click(found.x + found.width / 2, found.y + found.height / 2);

  const alert = page.getByRole("alert");
  await expect(alert).toBeVisible();
  await expect(alert).toBeInViewport({ ratio: 1 });
  await expect(reviews.getByRole("button", { name: "Add review" })).toBeInViewport();
});

test("a Publish pressed at the foot of the page reports its failure and its version where it was pressed", async ({
  page,
  lab,
}) => {
  await page.goto(`/lab/agent-configurations/${lab.configurationId}`);
  const name = page.getByRole("textbox", { name: "Name", exact: true });
  await name.fill(`${await name.inputValue()} (edited)`);
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByRole("status").filter({ hasText: "All changes saved" })).toBeVisible();
  const publish = page.getByRole("button", { name: /^Publish v\d+$/ });
  await expect(publish).not.toHaveAttribute("aria-disabled", "true");
  await expect(publish).toBeEnabled();

  const main = page.locator("main");
  const pressAtTheFoot = async () => {
    await main.evaluate((pane) => pane.scrollTo(0, pane.scrollHeight));
    expect(await main.evaluate((pane) => pane.scrollTop)).toBeGreaterThan(300);
    const found = await box(publish);
    await page.mouse.click(found.x + found.width / 2, found.y + found.height / 2);
  };

  await page.route("**/versions", (route) =>
    route.request().method() === "POST"
      ? route.fulfill({ status: 500, contentType: "application/json", body: "{}" })
      : route.continue(),
  );
  await pressAtTheFoot();
  const alert = page.getByRole("alert");
  await expect(alert).toBeVisible();
  await expect(alert).toBeInViewport({ ratio: 1 });

  await page.unroute("**/versions");
  await pressAtTheFoot();
  const published = page.getByRole("status").filter({ hasText: /^Published version/ });
  await expect(published).toBeVisible();
  await expect(published).toBeInViewport({ ratio: 1 });
});

test("the tour brings a step clear of the pinned header rather than lighting it underneath", async ({
  page,
  lab,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`/shops/${lab.shopId}/scenarios/${lab.scenarioId}`);
  const builtOn = page.locator('[aria-label="Built on"]');
  await expect(builtOn).toBeVisible();
  const header = pageHeader(page);
  const headerBottom = async () => {
    const found = await box(header);
    return found.y + found.height;
  };

  // The Built on card's top 40px under the header: inside the window, hidden all the same.
  const shift = (await box(builtOn)).y - ((await headerBottom()) - 40);
  await page.locator("main").evaluate((pane, by) => pane.scrollBy(0, by), shift);
  expect((await box(builtOn)).y).toBeLessThan(await headerBottom());

  await page.getByRole("button", { name: "Show me around the scenario editor" }).click();
  await expect(page.locator(".driver-popover")).toBeVisible();
  await expect(page.locator(".driver-popover-title")).toHaveText("Composed, not scripted");
  expect((await box(builtOn)).y).toBeGreaterThanOrEqual(await headerBottom());
  await page.keyboard.press("Escape");
});

test("the document itself never scrolls, so nothing scrolled into view slides the shell away", async ({
  page,
  lab,
}) => {
  await page.goto(`/shops/${lab.shopId}/products/alpine-shell-jacket`);
  await expect(page.getByRole("heading", { level: 1, name: "Alpine Shell Jacket" })).toBeVisible();

  const root = () =>
    page.evaluate(() => {
      const scrolling = document.scrollingElement as HTMLElement;
      return {
        taller: scrolling.scrollHeight > window.innerHeight,
        top: scrolling.scrollTop,
      };
    });
  expect(await root()).toEqual({ taller: false, top: 0 });

  // The last thing on the page, brought into view the way the tour and the browser do it.
  await page.locator("main").evaluate((pane) => {
    const elements = pane.querySelectorAll("*");
    elements[elements.length - 1]?.scrollIntoView({ block: "center" });
  });
  expect(await root()).toEqual({ taller: false, top: 0 });
  await expect(page.getByRole("navigation", { name: "Workspace mode" })).toBeInViewport();
});

test("a field tabbed up to on a create page is scrolled clear of its header", async ({
  page,
  lab,
}) => {
  // Short enough that the form scrolls, tall enough that the header is still pinned.
  await page.setViewportSize({ width: 1280, height: 480 });
  await page.goto(`/shops/${lab.shopId}/customers/new`);
  const upper = page.getByRole("textbox", { name: "Given name" });
  const lower = page.getByRole("textbox", { name: "Family name" });
  await expect(upper).toBeVisible();
  await expect.poll(async () => (await pinning(page)).position).toBe("sticky");

  const header = pageHeader(page);
  const headerBottom = async () => {
    const found = await box(header);
    return found.y + found.height;
  };
  const shift = (await box(lower)).y - (await headerBottom()) - 4;
  await page.locator("main").evaluate((pane, by) => pane.scrollBy(0, by), shift);
  expect((await box(upper)).y + (await box(upper)).height).toBeLessThanOrEqual(
    await headerBottom(),
  );

  await lower.evaluate((field) => (field as HTMLElement).focus({ preventScroll: true }));
  await page.keyboard.press("Shift+Tab");

  await expect(upper).toBeFocused();
  expect((await box(upper)).y).toBeGreaterThanOrEqual(await headerBottom());
});

/** Every write the lab is asked for fails, with the lab's own sentence where one is given. */
async function failEveryWrite(page: Page, message?: string) {
  await page.route("**/api/**", (route) =>
    route.request().method() === "GET"
      ? route.continue()
      : route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify(message === undefined ? {} : { message }),
        }),
  );
}

/** Press a control where it is on screen, with the pointer, without scrolling it into view. */
async function pressWhereItIs(page: Page, control: Locator) {
  const found = await box(control);
  await page.mouse.click(found.x + found.width / 2, found.y + found.height / 2);
}

/** Make an edit to the draft through the editor's first field, so its Save is offered. */
async function editTheDraft(page: Page, field?: Locator) {
  const target =
    field ??
    page.locator('main :is(input:not([type]), input[type="text"], textarea):visible').first();
  await target.fill(`${await target.inputValue()} (edited)`);
}

for (const [label, size, href, message] of [
  [
    "a one-line failure on the objective block editor at 1366×620",
    { width: 1366, height: 620 },
    (lab: BuiltLab) => `/lab/objective-blocks/${lab.objectiveId}`,
    undefined,
  ],
  [
    "a two-line failure on the agent configuration editor at 1280×720",
    { width: 1280, height: 720 },
    (lab: BuiltLab) => `/lab/agent-configurations/${lab.configurationId}`,
    "The lab could not write this draft: the database refused the transaction while another " +
      "write to the same configuration was still open, so nothing was saved and the draft on " +
      "screen is still yours to save again.",
  ],
] as const) {
  test(`${label} leaves the header pinned, with the failure and Save on screen`, async ({
    page,
    lab,
  }) => {
    await page.setViewportSize(size);
    await page.goto(href(lab));
    const header = pageHeader(page);
    await expect(header).toBeVisible();
    await editTheDraft(page);
    const save = header.getByRole("button", { name: "Save draft" });
    await expect(save).toBeVisible();
    await expect(header).toHaveAttribute("data-pinned", "true");

    await failEveryWrite(page, message);
    await page.locator("main").evaluate((pane) => pane.scrollTo(0, pane.scrollHeight));
    await pressWhereItIs(page, save);

    const alert = page.getByRole("alert");
    await expect(alert).toBeVisible();
    // The header grew by the failure and did not let go because of it.
    await expect(header).toHaveAttribute("data-pinned", "true");
    await expect(alert).toBeInViewport({ ratio: 1 });
    await expect(save).toBeInViewport({ ratio: 1 });
  });
}

test("at 960×420 the first keystroke does not let go of a header that was pinned", async ({
  page,
  lab,
}) => {
  // Clean, the customer editor's actions row fits and its header is within a third of the pane.
  // Dirty, "All changes saved" becomes Discard and Save and the row wraps: were the decision
  // made again on that, the header would let go at the moment Save appeared. The header's one
  // line is the "Index · kind" line above the title, as the prototype draws it — a second line
  // under the title is what once made the clean header more than a third of this pane.
  await page.setViewportSize({ width: 960, height: 420 });
  await page.goto(`/shops/${lab.shopId}/customers/${lab.profileId}`);
  const header = pageHeader(page);
  await expect(header).toBeVisible();
  await page.waitForLoadState("networkidle");
  await expect(header).toHaveAttribute("data-pinned", "true");
  const clean = await steadyHeight(page);
  expect(clean).toBeLessThanOrEqual((await box(page.locator("main"))).height / 3);

  await editTheDraft(page);
  const save = header.getByRole("button", { name: "Save draft" });
  await expect(save).toBeVisible();
  // The premise: the header grew past a third of the pane when the draft went dirty.
  await expect.poll(async () => (await steadyHeight(page)) > clean).toBe(true);
  expect(await steadyHeight(page)).toBeGreaterThan((await box(page.locator("main"))).height / 3);

  await expect(header).toHaveAttribute("data-pinned", "true");
  await page.locator("main").evaluate((pane) => pane.scrollTo(0, pane.scrollHeight));
  await expect(save).toBeInViewport({ ratio: 1 });
  // And the clearance follows the header as it now is.
  const now = (await box(header)).height;
  expect(
    Number.parseFloat(await page.locator("main").evaluate((pane) => pane.style.scrollPaddingTop)),
  ).toBeCloseTo(now + 8, -0.5);
});

test("the ticket editor's Save is in reach at the foot of the page", async ({ page, lab }) => {
  // The ticket editor is its own page now (ADR 0073), so its header is the pane's like every
  // other editor's: held down the whole page, at the short laptop pane where it used to scroll
  // away with the thread's column (ADR 0066, the case left as a follow-up).
  await page.setViewportSize({ width: 1366, height: 620 });
  await page.goto(`/shops/${lab.shopId}/tickets/${lab.ticketId}`);
  await page.getByLabel("Add a history message").fill("Still waiting on a reply.");
  await page.getByRole("button", { name: "Add to thread" }).click();
  const save = page.getByRole("button", { name: "Save draft" });
  await expect(save).toBeVisible();

  const main = page.locator("main");
  await main.evaluate((pane) => pane.scrollTo(0, pane.scrollHeight));
  expect(await main.evaluate((pane) => pane.scrollTop)).toBeGreaterThan(300);
  await expect(save).toBeInViewport({ ratio: 1 });
});

test("a tour step taller than the room under the header is lit with its top clear of it", async ({
  page,
  lab,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  // The premise is the Guidelines card's height. Its guideline is a compact item since the list
  // is edited in the form below it (ADR 0074), so the card's height is now mostly that form, and
  // at the default 1280×720 it outgrows the room by some 80px. A shorter pane makes the premise
  // the test's own rather than a margin the form's next field could take away.
  await page.setViewportSize({ width: 1280, height: 560 });
  await page.goto(`/shops/${lab.shopId}/setup/tone`);
  const guidelines = page.locator('[aria-label="Guidelines"]');
  await expect(guidelines).toBeVisible();
  const header = pageHeader(page);
  await expect(header).toHaveAttribute("data-pinned", "true");
  const room = await page.locator("main").evaluate((pane) => pane.clientHeight);
  const headerHeight = (await box(header)).height;
  // The premise: the step does not fit under the header, so the library centres it.
  expect((await box(guidelines)).height).toBeGreaterThan(room - headerHeight);

  await page.getByRole("button", { name: /^Show me around/ }).click();
  await expect(page.locator(".driver-popover-title")).toHaveText(
    "The voice, and which one is the default",
  );
  const headerBox = await box(header);
  expect((await box(guidelines)).y).toBeGreaterThanOrEqual(headerBox.y + headerBox.height);
  // Lit where it now is: the stage the library draws is around the step, not where it was.
  const stage = await box(page.locator(".driver-active-element"));
  expect(stage.y).toBe((await box(guidelines)).y);
  await page.keyboard.press("Escape");
});

/**
 * Every editor of one object, and the field its draft is edited through where the first one on
 * the page is not the draft's (an add form's, which only writes when its own button is pressed).
 */
function editors(lab: BuiltLab): [string, string, ((page: Page) => Promise<void>) | null][] {
  const shop = `/shops/${lab.shopId}`;
  return [
    ["product editor", `${shop}/products/alpine-shell-jacket`, null],
    ["order editor", `${shop}/orders/${lab.orderId}`, null],
    ["customer editor", `${shop}/customers/${lab.profileId}`, null],
    ["document editor", `${shop}/setup/documents/policies/address-change`, null],
    ["scenario editor", `${shop}/scenarios/${lab.scenarioId}`, null],
    ["agent configuration editor", `/lab/agent-configurations/${lab.configurationId}`, null],
    ["judge editor", `/lab/judges/JUDGE`, null],
    ["objective block editor", `/lab/objective-blocks/${lab.objectiveId}`, null],
    ["mutation block editor", `/lab/mutation-blocks/${lab.mutationId}`, null],
    ["support identity editor", `/lab/support-identities/${lab.identityId}`, null],
    ["shop details", `${shop}/setup/identity`, null],
    [
      "tone of voice",
      `${shop}/setup/tone`,
      async (page) => {
        // Its only fields belong to the add form, which writes to the draft when pressed.
        const guidelines = page.getByRole("region", { name: "Guidelines" });
        await guidelines.getByLabel("Name", { exact: true }).fill("Brisk");
        await guidelines.getByLabel("Guidance", { exact: true }).fill("Short sentences.");
        await guidelines.getByRole("button", { name: /^Add/ }).click();
      },
    ],
    [
      "ticket editor",
      `${shop}/tickets/${lab.ticketId}`,
      async (page) => {
        // The thread is the draft, and a message added to it is an edit to it.
        await page.getByLabel("Add a history message").fill("Any news on my parcel?");
        await page.getByRole("button", { name: "Add to thread" }).click();
      },
    ],
  ];
}

for (const [name] of editors({} as BuiltLab)) {
  test(`the ${name} reports a failed Save inside its pinned header`, async ({ page, lab }) => {
    const [, template, field] = editors(lab).find(([editor]) => editor === name) ?? [];
    if (template === undefined) throw new Error(`no editor called ${name}`);
    await page.goto(template.replace("JUDGE", lab.judgeId));
    const save = page.locator("main header").getByRole("button", { name: /^Save/ });
    await expect(page.locator("main header").first()).toBeVisible();
    await page.waitForLoadState("networkidle");
    await (field === null || field === undefined ? editTheDraft(page) : field(page));
    await expect(save).toBeVisible();

    await failEveryWrite(page);
    await save.click();

    // The header that holds Save holds the failure, and it is the one that is pinned.
    const header = page
      .locator("main header")
      .filter({ has: page.getByRole("button", { name: /^Save/ }) });
    await expect(header.getByRole("alert")).toBeVisible();
    await expect(header).toHaveAttribute("data-pinned", "true");
    expect(await header.evaluate((element) => getComputedStyle(element).position)).toBe("sticky");
  });
}

const HELD = ["an editor", "a create page"] as const;
type Held = (typeof HELD)[number];

/**
 * Every surface that renders a page header, and whether it holds it.
 *
 * Written out rather than derived, because the claim is about each of them: an editor pins its
 * header — the shop's setup pages among them — a create page pins its own, and everything else —
 * the indexes, the overview, the bench, the results, the settings — scrolls it away.
 */
function surfaces(lab: Lab): [string, string, Held | null][] {
  const shop = `/shops/${lab.shopId}`;
  return [
    ["product editor", `${shop}/products/alpine-shell-jacket`, "an editor"],
    ["order editor", `${shop}/orders/${lab.orderId}`, "an editor"],
    ["customer editor", `${shop}/customers/${lab.profileId}`, "an editor"],
    ["document editor", `${shop}/setup/documents/policies/address-change`, "an editor"],
    ["scenario editor", `${shop}/scenarios/${lab.scenarioId}`, "an editor"],
    ["agent configuration editor", `/lab/agent-configurations/${lab.configurationId}`, "an editor"],
    ["judge editor", `/lab/judges/${lab.judgeId}`, "an editor"],
    ["objective block editor", `/lab/objective-blocks/${lab.objectiveId}`, "an editor"],
    ["mutation block editor", `/lab/mutation-blocks/${lab.mutationId}`, "an editor"],
    ["support identity editor", `/lab/support-identities/${lab.identityId}`, "an editor"],
    ["shop details", `${shop}/setup/identity`, "an editor"],
    ["tone of voice", `${shop}/setup/tone`, "an editor"],
    ["ticket editor", `${shop}/tickets/${lab.ticketId}`, "an editor"],

    ["new shop", "/shops/new", "a create page"],
    ["new order", `${shop}/orders/new`, "a create page"],
    ["new customer", `${shop}/customers/new`, "a create page"],
    ["new ticket", `${shop}/tickets/new`, "a create page"],
    ["new document", `${shop}/setup/documents/new`, "a create page"],
    ["new scenario", `${shop}/scenarios/new`, "a create page"],
    ["new agent configuration", "/lab/agent-configurations/new", "a create page"],
    ["new judge", "/lab/judges/new", "a create page"],
    ["new objective block", "/lab/objective-blocks/new", "a create page"],
    ["new mutation block", "/lab/mutation-blocks/new", "a create page"],
    ["new support identity", "/lab/support-identities/new", "a create page"],

    ["shops", "/shops", null],
    ["overview", shop, null],
    ["products", `${shop}/products`, null],
    ["orders", `${shop}/orders`, null],
    ["customers", `${shop}/customers`, null],
    ["tickets", `${shop}/tickets`, null],
    ["scenarios", `${shop}/scenarios`, null],
    ["snapshots", `${shop}/scenarios/${lab.scenarioId}/snapshots`, null],
    ["documents", `${shop}/setup/policies`, null],
    ["shop version", `${shop}/versions/1`, null],
    ["bench setup", "/lab/bench", null],
    ["live bench", `/lab/bench/${lab.shopId}/${lab.experimentId}`, null],
    ["results", `/lab/bench/${lab.shopId}/${lab.experimentId}/results`, null],
    [
      "results conversation",
      `/lab/bench/${lab.shopId}/${lab.experimentId}/results/conversation`,
      null,
    ],
    ["history", "/lab/history", null],
    ["agent configs", "/lab/agent-configurations", null],
    ["judges", "/lab/judges", null],
    ["support identities", "/lab/support-identities", null],
    ["objective blocks", "/lab/objective-blocks", null],
    ["mutation blocks", "/lab/mutation-blocks", null],
    ["settings", "/settings", null],
    ["glossary", "/glossary", null],
  ];
}

test("every surface with a page header pins it exactly where ADR 0066 says", async ({
  page,
  lab,
}) => {
  test.setTimeout(180_000);
  for (const [name, href, held] of surfaces(lab)) {
    await page.goto(href);
    const header = pageHeader(page);
    await expect(header, `${name} draws no page header`).toBeVisible();
    const style = await header.evaluate((element) => {
      const computed = getComputedStyle(element);
      return {
        position: computed.position,
        top: computed.top,
        background: computed.backgroundColor,
        rule: `${computed.borderBottomWidth} ${computed.borderBottomStyle} ${computed.borderBottomColor}`,
      };
    });
    if (held === null) {
      expect.soft(style.position, `${name} pins its header`).toBe("static");
    } else {
      // The prototype's own values (`Workspace.dc.html`:207): the canvas under a 1px rule.
      expect.soft(style, `${name} is ${held} and does not pin its header`).toEqual({
        position: "sticky",
        // Held at the pane's edge rather than inside its 20px padding.
        top: "-20px",
        background: "rgb(246, 246, 247)",
        rule: "1px solid rgb(225, 227, 229)",
      });
    }
  }
});
