import type { GeneratedScenarioResponse } from "@agent-lab/contracts";
import { expect, test } from "@playwright/test";

test("generates and retrieves the same persona from recorded inputs", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Your generated persona will appear here." }),
  ).toBeVisible();

  await page.getByRole("combobox", { name: "Scenario" }).selectOption("retail-profile@v1");
  await page.getByRole("textbox", { name: "Seed" }).fill("20260816");

  const generationResponsePromise = page.waitForResponse(
    (response) => response.request().method() === "POST" && response.url().endsWith("/generations"),
  );
  await page.getByRole("button", { name: "Generate persona" }).click();
  const generationResponse = await generationResponsePromise;
  const generated = (await generationResponse.json()) as GeneratedScenarioResponse;

  expect(generationResponse.status()).toBe(201);
  expect(new URL(generationResponse.url()).origin).toBe("http://localhost:5173");
  expect(generationResponse.request().postDataJSON()).toEqual({ seed: 20_260_816 });
  expect(generationResponse.request().headers()["idempotency-key"]).toBe(
    "persona:retail-profile:v1:20260816",
  );
  await expect(
    page.getByRole("heading", { name: generated.initial_state.persona.display_name }),
  ).toBeVisible();
  await expect(page.getByText("Persona generated")).toBeVisible();
  await expect(page.getByText(generated.initial_state_hash)).toBeVisible();

  const retrievalResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "GET" && response.url().endsWith("/generations/20260816"),
  );
  await page.getByRole("button", { name: "Retrieve recorded persona" }).click();
  const retrievalResponse = await retrievalResponsePromise;
  const retrieved = (await retrievalResponse.json()) as GeneratedScenarioResponse;

  expect(retrievalResponse.status()).toBe(200);
  expect(new URL(retrievalResponse.url()).origin).toBe("http://localhost:5173");
  expect(retrieved).toEqual(generated);
  await expect(page.getByText("Retrieved from recorded inputs")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: retrieved.initial_state.persona.display_name }),
  ).toBeVisible();
  await expect(page.getByText(retrieved.initial_state_hash)).toBeVisible();
});
