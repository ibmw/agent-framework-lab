import { expect, test } from "@playwright/test";

test("shows the foundation scope", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Agent Framework Capability Lab" })).toBeVisible();
  await expect(page.getByText("Chat assistant-ui")).toBeVisible();
});
