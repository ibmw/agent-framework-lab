import type { GeneratedScenarioResponse } from "@agent-lab/contracts";
import { expect, test } from "@playwright/test";

test("generates a persona, lists it in the library, and replays deterministically", async ({
  page,
}, testInfo) => {
  const seed = String(Math.floor(Math.random() * 4_294_967_296));
  testInfo.annotations.push({ type: "scenario-seed", description: seed });

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Generate a persona" })).toBeVisible();

  await page
    .getByRole("combobox", { name: "Scenario", exact: true })
    .selectOption("retail-profile@v1");
  await page.getByRole("textbox", { name: "Seed" }).fill(seed);

  const generationResponsePromise = page.waitForResponse(
    (response) => response.request().method() === "POST" && response.url().endsWith("/generations"),
  );
  await page.getByRole("button", { name: "Generate persona" }).click();
  const generationResponse = await generationResponsePromise;
  const generated = (await generationResponse.json()) as GeneratedScenarioResponse;
  const displayName = generated.initial_state.persona.display_name;

  expect(generationResponse.status()).toBe(201);
  expect(generationResponse.request().headers()["idempotency-key"]).toBe(
    `persona:retail-profile:v1:${seed}`,
  );

  // Generating navigates to the persona page, which retrieves the recorded state.
  await expect(page.getByRole("heading", { name: displayName })).toBeVisible();
  await expect(page.getByText(generated.initial_state_hash)).toBeVisible();

  // The persona is now reachable from the library. Narrow the shared listing with the
  // filters so this run's persona (identified by its unique seed) is deterministically present.
  await page.getByRole("link", { name: "Back to library" }).click();
  await page.getByRole("combobox", { name: "Active within" }).selectOption("1h");
  await page.getByRole("combobox", { name: "Per page" }).selectOption("100");
  const libraryEntry = page.getByRole("link", {
    name: new RegExp(`retail-profile@v1 · seed ${seed}\\b`),
  });
  await expect(libraryEntry).toBeVisible();
  await expect(libraryEntry).toContainText(displayName);

  // Revisiting replays the same deterministic fingerprint.
  await libraryEntry.click();
  await expect(page.getByRole("heading", { name: displayName })).toBeVisible();
  await expect(page.getByText(generated.initial_state_hash)).toBeVisible();
});
