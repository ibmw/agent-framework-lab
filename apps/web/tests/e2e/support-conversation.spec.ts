import { expect, test } from "@playwright/test";

const isStartConversation = (method: string, url: string) =>
  method === "POST" && url.endsWith("/api/v1/conversations");

test("runs several conversations on one persona and resumes the right one", async ({
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

  // The persona page lists conversations and lets us start a new one against a framework.
  await expect(page.getByRole("heading", { name: "Conversations" })).toBeVisible();
  await page.getByRole("combobox", { name: "Agent framework" }).selectOption("fake");

  // Conversation A, with one message.
  const startAPromise = page.waitForResponse((response) =>
    isStartConversation(response.request().method(), response.url()),
  );
  await page.getByRole("button", { name: "Start new conversation" }).click();
  const idA = ((await (await startAPromise).json()) as { id: string }).id;
  await expect(page.getByRole("heading", { name: "Support conversation" })).toBeVisible();
  await expect(page.getByText(idA)).toBeVisible();

  const composer = page.getByRole("textbox", { name: "Support message" });
  await composer.fill("What orders are on my account?");
  const messagePromise = page.waitForResponse(
    (response) => response.request().method() === "POST" && response.url().endsWith("/messages"),
  );
  await page.getByRole("button", { name: "Send message" }).click();
  await messagePromise;
  await expect(page.getByText("What orders are on my account?", { exact: true })).toBeVisible();

  // Return to the persona and start a second, distinct conversation.
  await page.getByRole("link", { name: "Back to persona" }).click();
  await expect(page.getByRole("heading", { name: "Conversations" })).toBeVisible();
  await page.getByRole("combobox", { name: "Agent framework" }).selectOption("fake");
  const startBPromise = page.waitForResponse((response) =>
    isStartConversation(response.request().method(), response.url()),
  );
  await page.getByRole("button", { name: "Start new conversation" }).click();
  const idB = ((await (await startBPromise).json()) as { id: string }).id;
  expect(idB).not.toBe(idA);
  await expect(page.getByText(idB)).toBeVisible();

  // Both conversations are now listed on the persona.
  await page.getByRole("link", { name: "Back to persona" }).click();
  await expect(page.locator(`a[href*="${idA}"]`)).toBeVisible();
  await expect(page.locator(`a[href*="${idB}"]`)).toBeVisible();

  // Deleting the second conversation removes only it from the history.
  const secondRow = page.locator("li", { has: page.locator(`a[href*="${idB}"]`) });
  await secondRow.getByRole("button", { name: "Delete conversation" }).click();
  // The row swaps to a confirm state, so click the (single) confirm button on the page.
  await page.getByRole("button", { name: "Confirm delete" }).click();
  await expect(page.locator(`a[href*="${idB}"]`)).toHaveCount(0);
  await expect(page.locator(`a[href*="${idA}"]`)).toBeVisible();

  // Resuming the first conversation restores only its own turns.
  await page.locator(`a[href*="${idA}"]`).click();
  await expect(page.getByRole("heading", { name: "Support conversation" })).toBeVisible();
  await expect(page.getByText(idA)).toBeVisible();
  await expect(page.getByText("What orders are on my account?", { exact: true })).toBeVisible();

  // Deleting the persona removes its remaining conversation and clears the local resume fallback.
  const conversationUrl = page.url();
  await page.getByRole("link", { name: "Back to persona" }).click();
  await page.getByRole("link", { name: "Back to library" }).click();
  await page.getByRole("combobox", { name: "Active within" }).selectOption("1h");
  await page.getByRole("combobox", { name: "Per page" }).selectOption("100");
  const personaEntry = page.getByRole("button", {
    name: new RegExp(`retail-profile@v1 · seed ${seed}\\b`),
  });
  const personaRow = page.locator("li", { has: personaEntry });
  await personaRow.getByRole("button", { name: /^Delete persona/ }).click();
  await page.getByRole("button", { name: "Confirm persona delete" }).click();
  await expect(personaEntry).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Resume your last conversation" })).toHaveCount(0);

  await page.goto(conversationUrl);
  await expect(page.getByRole("alert")).toContainText("This conversation could not be loaded");
});
