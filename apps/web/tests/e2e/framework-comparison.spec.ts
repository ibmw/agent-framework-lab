import { expect, test } from "@playwright/test";

test("runs two frameworks on one fingerprint and opens the comparison", async ({
  page,
}, testInfo) => {
  const seed = String(Math.floor(Math.random() * 4_294_967_296));
  testInfo.annotations.push({ type: "scenario-seed", description: seed });

  await page.goto("/");
  await page
    .getByRole("combobox", { name: "Scenario", exact: true })
    .selectOption("retail-profile@v1");
  await page.getByRole("textbox", { name: "Seed" }).fill(seed);
  await page.getByRole("button", { name: "Generate persona" }).click();

  await expect(page.getByRole("button", { name: "Select framework fake" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Select framework pydantic-ai" })).toBeVisible();

  const starts: string[] = [];
  page.on("response", async (response) => {
    if (
      response.request().method() === "POST" &&
      response.url().endsWith("/api/v1/conversations")
    ) {
      starts.push(((await response.json()) as { id: string }).id);
    }
  });

  await page.getByRole("button", { name: "Run both on this fingerprint" }).click();
  await expect(page.getByText("same scenario · same seed · same fingerprint")).toBeVisible();
  await expect(page.getByRole("button", { name: "Export comparison" })).toBeVisible();
  await expect(page.getByRole("heading", { name: /capabilities/ })).toBeVisible();
  await expect.poll(() => starts.length).toBe(2);
});
