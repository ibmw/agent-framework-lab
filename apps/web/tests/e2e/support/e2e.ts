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
export const test = base.extend({
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
