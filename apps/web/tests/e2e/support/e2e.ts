import { test as base, expect } from "@playwright/test";
import { WORKER_COUNT, webOrigin, workerIndex } from "./stack";

/**
 * The suite's `test`. Every spec takes it from here rather than from `@playwright/test`.
 *
 * A worker owns a whole stack of its own — its frontend, its API, its database (`stack.ts`) —
 * and the only thing that points a spec at the right one is the base URL its worker was given.
 * A single `baseURL` in the Playwright config could only name one worker's frontend, so it is
 * deliberately absent there: a spec that imports `test` from `@playwright/test` has no base URL
 * at all and fails on its first navigation, rather than quietly driving worker 0's stack and
 * putting its rows in another worker's database.
 */
export const test = base.extend<{ unsavedChangesPromptNotLeftOpen: null }>({
  /**
   * PLAN-UX Slice 8's evidence, held as a check rather than as an observation.
   *
   * The unsaved-changes guard blocks a navigation that would strand an edit, and a blocked
   * navigation simply does not happen: the spec that asked for it then waits out its timeout on
   * a page it never reached, which reads as "the thing I created is not there" and says nothing
   * about the guard. So every test asserts on its way out that the prompt is not still on
   * screen — a journey that meant to meet it answers it, as `workspace-shell` does. A test that
   * has already failed is annotated rather than failed again, so this can only ever add a reason
   * and never replace one.
   */
  unsavedChangesPromptNotLeftOpen: [
    async (
      { page }: { page: import("@playwright/test").Page },
      use: (value: null) => Promise<void>,
      testInfo: import("@playwright/test").TestInfo,
    ) => {
      await use(null);
      let open = false;
      try {
        // `isVisible` asks once and does not wait, which is what a teardown wants — but a spec
        // whose last action was the blocked click could end before the prompt had painted, so
        // one frame is given first. Every spec today asserts a destination after its last
        // click, so nothing depends on this; it is here so that a spec that does not still
        // reports the guard rather than a silence.
        await page.evaluate(() => new Promise((paint) => requestAnimationFrame(paint)));
        open = await page.getByRole("dialog", { name: "Unsaved changes" }).isVisible();
      } catch {
        // The page went with its context; there is nothing left to read.
      }
      if (!open) {
        return;
      }
      const reason =
        "The unsaved-changes prompt was still open when this test ended: a navigation this " +
        "journey did not intend was blocked by the guard (PLAN-UX Slice 8, ADR 0051).";
      testInfo.annotations.push({ type: "unsaved-changes-prompt", description: reason });
      if (testInfo.status === "passed") {
        throw new Error(reason);
      }
    },
    { auto: true },
  ],
  // Playwright reads a fixture's dependencies out of this destructuring pattern, so an empty one
  // is how a fixture says it needs nothing — it is required here, not an oversight.
  // biome-ignore lint/correctness/noEmptyPattern: Playwright requires the destructuring pattern.
  baseURL: async ({}, use) => {
    const worker = workerIndex();
    if (worker >= WORKER_COUNT) {
      // `--workers` on the command line overrides the count in the config, but it cannot conjure
      // the servers that count declares: this worker has no stack, and every navigation it made
      // would be refused by an unused port. Said here, once, by name.
      throw new Error(
        `Playwright worker ${worker} has no stack: the suite starts ${WORKER_COUNT} of them ` +
          "(apps/web/tests/e2e/support/stack.ts). Change WORKER_COUNT rather than passing --workers.",
      );
    }
    await use(webOrigin(worker));
  },
});

export { expect };
