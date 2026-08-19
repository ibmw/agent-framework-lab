import { expect, test } from "@playwright/test";

test("proposes, confirms, and executes a cancellation, then resumes it from the URL", async ({
  page,
}, testInfo) => {
  const seed = String(Math.floor(Math.random() * 4_294_967_296));
  testInfo.annotations.push({ type: "scenario-seed", description: seed });

  await page.goto("/");
  await page
    .getByRole("combobox", { name: "Scenario", exact: true })
    .selectOption("retail-order-cancellation@v1");
  await page.getByRole("textbox", { name: "Seed" }).fill(seed);
  await page.getByRole("button", { name: "Generate persona" }).click();

  await expect(page.getByRole("heading", { name: "Conversations" })).toBeVisible();
  await page.getByRole("combobox", { name: "Agent framework" }).selectOption("fake");

  const startResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" && response.url().endsWith("/api/v1/conversations"),
  );
  await page.getByRole("button", { name: "Start new conversation" }).click();
  const started = (await (await startResponsePromise).json()) as { id: string };
  await expect(page.getByRole("heading", { name: "Support conversation" })).toBeVisible();

  await page.getByRole("button", { name: "Propose order cancellation" }).click();
  await expect(page.getByText("Proposal ready")).toBeVisible();
  await expect(page.getByText(/cancel_order@v1 · expected version 1/)).toBeVisible();

  await page.getByRole("button", { name: "Confirm exact action" }).click();
  await expect(page.getByText("Confirmed")).toBeVisible();

  const executionResponsePromise = page.waitForResponse(
    (response) => response.request().method() === "POST" && response.url().endsWith("/execution"),
  );
  await page.getByRole("button", { name: "Execute cancellation" }).click();
  expect((await executionResponsePromise).status()).toBe(200);
  await expect(page.getByText("Executed")).toBeVisible();
  await expect(page.getByText(/Order is cancelled at version 2/)).toBeVisible();

  // Reloading the conversation URL restores the executed action state.
  await page.reload();
  await expect(page.getByRole("heading", { name: "Support conversation" })).toBeVisible();
  await expect(page.getByText(started.id)).toBeVisible();
  await expect(page.getByText("Executed")).toBeVisible();
  await expect(page.getByText(/Order is cancelled at version 2/)).toBeVisible();
});
