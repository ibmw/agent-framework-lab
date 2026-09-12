import { expect, test } from "@playwright/test";

/**
 * The first run (ADR 0044): somebody opens the lab, is told the one thing to do next, does part
 * of it, and is told what the gate now finds — with nothing stored to remember where they were.
 *
 * The band's reading is asserted against the surface under it rather than against an assumed
 * database, because this suite shares one lab with every other journey. What has to hold is
 * that the band and the publish gate beside it never say two different things.
 */

test("the setup path leads a new operator from no shop to the gate's own next finding", async ({
  page,
  request,
}) => {
  const unique = Date.now().toString(36);

  // Guide mode is derived from the whole lab, and this suite shares one database. Stated as a
  // precondition so that a journey which one day drives both arms to the turn cap fails here,
  // saying why, rather than failing as an invisible band three lines below.
  const completed = await request.get("/api/v1/experiments?status=completed&page_size=1");
  expect(
    (await completed.json()).total,
    "guide mode is off by derivation because some journey in this run left a completed experiment",
  ).toBe(0);

  await page.goto("/shops");
  const strip = page.getByRole("region", { name: "Setup path" });
  // Guide mode is on before anybody turned it on: this browser has stored nothing.
  await expect(strip).toBeVisible();
  await expect(strip.getByText("Setup path · next step")).toBeVisible();

  // Outside a shop the band reads one thing — whether this lab holds a shop — and names the
  // step accordingly. Which of the two readings holds here is not this suite's to fix: it
  // shares one lab with every other journey, and other journeys create shops while it runs.
  // The two readings are pinned to their listings in `src/lib/setupPath.test.ts`.
  await expect(strip.getByText(/Create a shop|Open a shop to continue/)).toBeVisible();

  // ADR 0043's refusal, in the browser: the band offers no control that populates the lab.
  await expect(strip.getByRole("button", { name: /seed|demo|populate|sample/i })).toHaveCount(0);

  const createShop = page.getByRole("region", { name: "Create a shop" });
  await createShop.getByLabel("Name", { exact: true }).fill(`Northstar ${unique}`);
  await createShop.getByLabel("Slug", { exact: true }).fill(`northstar-${unique}`);
  await createShop.getByRole("button", { name: "Create shop" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();

  // The band advanced with the record: a shop exists, and publishing it is what is blocked now.
  await expect(strip.getByText(new RegExp(`Publish Northstar ${unique}`))).toBeVisible();

  // The gate's own findings, in the gate's own words, in the order the gate puts them in —
  // errors before warnings, then by path. The authoring surface renders the same list.
  const validation = page.getByRole("region", { name: "Draft validation" });
  const fulfilment = "a published shop must offer at least one fulfilment method";
  await expect(strip.getByText(fulfilment)).toBeVisible();
  await expect(validation.getByText(fulfilment)).toBeVisible();
  await expect(strip.getByText("Resolve 5 error(s) to publish.")).toBeVisible();

  // Its action opens the surface the first finding names, and never authors anything itself.
  await strip.getByRole("link", { name: "Open shop details" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Shop details" })).toBeVisible();
  const payments = page.getByRole("region", { name: "Payment methods" });
  await payments.getByLabel("ID", { exact: true }).fill("card");
  await payments.getByLabel("Name", { exact: true }).fill("Card synthetic");
  await payments.getByRole("button", { name: "Add payment method" }).click();
  const shipping = page.getByRole("region", { name: "Fulfilment methods" });
  await shipping.getByLabel("ID", { exact: true }).fill("standard");
  await shipping.getByLabel("Name", { exact: true }).fill("Standard 3-5 days");
  await shipping.getByLabel("Carrier", { exact: true }).fill("Nordic Post");
  await shipping.getByRole("button", { name: "Add fulfilment method" }).click();
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByRole("button", { name: "Saved" })).toBeDisabled();

  await page.getByLabel("Shop workspace").getByRole("link", { name: "Home" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();

  // Nothing was written when those two findings were resolved, and the band reads the gate
  // again rather than a progress record of its own.
  const policies = "a published shop must publish at least one policy for support tools to read";
  await expect(strip.getByText(fulfilment)).toHaveCount(0);
  await expect(strip.getByText(policies)).toBeVisible();
  await expect(validation.getByText(policies)).toBeVisible();
  await expect(strip.getByText("Resolve 3 error(s) to publish.")).toBeVisible();
  await expect(strip.getByRole("link", { name: "Open policies & FAQ" })).toBeVisible();
  // No score and no step counter: the chain says which steps the record satisfies, and the
  // shop is still the one it stands on.
  await expect(strip.getByText(/\d+\s*%|\d+ of 10/)).toHaveCount(0);

  // The band carries no per-step dismissal. What can be put away is the band itself, which is
  // a preference and is remembered in this browser.
  await strip.locator("summary").click();
  // Clicked rather than checked: choosing this takes the band off the page, so there is no
  // control left to read a checked state back from.
  await strip.getByRole("radio", { name: /Always off/ }).click();
  await expect(strip).toHaveCount(0);

  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
  await expect(strip).toHaveCount(0);
});
