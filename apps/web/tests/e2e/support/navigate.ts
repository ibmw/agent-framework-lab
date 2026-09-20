import { expect, type Page } from "@playwright/test";

/**
 * Opening a section of the workspace, from whichever rail holds it.
 *
 * Every journey in this suite moves by clicking the rail, and since ADR 0054 there are two of
 * them: the shop's, and the experiment lab's. A section is on exactly one — except *Support
 * identities*, which the prototype draws on both and which is one screen at one address.
 *
 * So this is where the suite knows about modes, once, rather than in each spec: it switches
 * mode from the tabs in the bar only when the rail it needs is not the one on screen, which is
 * also what an operator does. Scoped to the rail throughout, because an editor and the shop's
 * own overview link to the same sections by name.
 */
const LAB_SECTIONS = new Set([
  "Bench",
  "History",
  "Agent configurations",
  "Judges",
  "Support identities",
  "Objective blocks",
  "Mutation blocks",
]);

export async function openSection(page: Page, link: string, heading: string) {
  const lab = LAB_SECTIONS.has(link);
  const rail = page.getByLabel(lab ? "Experiment lab workspace" : "Shop workspace");
  if ((await rail.count()) === 0) {
    await page
      .getByRole("navigation", { name: "Workspace mode" })
      .getByRole("link", { name: lab ? "Experiment lab" : "Shop fixture" })
      .click();
    await expect(rail).toBeVisible();
  }
  await rail.getByRole("link", { name: link }).click();
  await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
}
