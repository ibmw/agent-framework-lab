import { expect, test } from "@playwright/test";

test("starts, modifies safely, and resumes a support conversation", async ({ page }, testInfo) => {
  const seed = String(Date.now() % 4_294_967_296);
  testInfo.annotations.push({ type: "scenario-seed", description: seed });
  await page.goto("/");
  await page
    .getByRole("combobox", { name: "Scenario" })
    .selectOption("retail-order-cancellation@v1");
  await page.getByRole("textbox", { name: "Seed" }).fill(seed);
  await page.getByRole("button", { name: "Generate persona" }).click();
  await expect(page.getByRole("button", { name: "Start support conversation" })).toBeVisible();

  const startResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" && response.url().endsWith("/api/v1/conversations"),
  );
  await page.getByRole("button", { name: "Start support conversation" }).click();
  const startResponse = await startResponsePromise;
  const started = (await startResponse.json()) as { id: string };

  expect(startResponse.status()).toBe(201);
  await expect(page.getByRole("heading", { name: "Support conversation" })).toBeVisible();
  const composer = page.getByRole("textbox", { name: "Support message" });
  const suggestion = page.getByRole("button", { name: "Use suggested customer message" });
  await expect(suggestion).toHaveAccessibleDescription(
    "“Hi, I'd like to cancel my paid order. Can you help me?”",
  );
  await suggestion.click();
  await expect(composer).toHaveValue("Hi, I'd like to cancel my paid order. Can you help me?");
  await composer.fill("What orders and products are on my account?");

  const messageResponsePromise = page.waitForResponse(
    (response) => response.request().method() === "POST" && response.url().endsWith("/messages"),
  );
  await page.getByRole("button", { name: "Send message" }).click();
  const messageResponse = await messageResponsePromise;

  expect(messageResponse.status()).toBe(200);
  await expect(
    page.getByText("What orders and products are on my account?", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("read_customer@v1 · success")).toBeVisible();

  await page.getByRole("button", { name: "Propose order cancellation" }).click();
  await expect(page.getByText("Proposal ready")).toBeVisible();
  await expect(page.getByText(/cancel_order@v1 · expected version 1/)).toBeVisible();
  await page.getByRole("button", { name: "Confirm exact action" }).click();
  await expect(page.getByText("Confirmed")).toBeVisible();
  const executionResponsePromise = page.waitForResponse(
    (response) => response.request().method() === "POST" && response.url().endsWith("/execution"),
  );
  await page.getByRole("button", { name: "Execute cancellation" }).click();
  const executionResponse = await executionResponsePromise;
  expect(executionResponse.status()).toBe(200);
  await expect(page.getByText("Executed")).toBeVisible();
  await expect(page.getByText(/Order is cancelled at version 2/)).toBeVisible();

  await page.reload();

  await expect(page.getByRole("heading", { name: "Support conversation" })).toBeVisible();
  await expect(page.getByText(started.id)).toBeVisible();
  await expect(
    page.getByText("What orders and products are on my account?", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("read_customer@v1 · success")).toBeVisible();
  await expect(page.getByText("Executed")).toBeVisible();
  await expect(page.getByText(/Order is cancelled at version 2/)).toBeVisible();
});
