import { randomUUID } from "node:crypto";
import { defineConfig, devices, type PlaywrightTestConfig } from "@playwright/test";
import {
  apiOrigin,
  apiPort,
  databaseUrl,
  stacks,
  WORKER_COUNT,
  webCacheDir,
  webOrigin,
  webPort,
  webReadyUrl,
} from "./tests/e2e/support/stack";

// The E2E stack is a second stack, not the developer's. It listens on its own ports and never
// reuses a server it did not start, so a run cannot silently drive a developer API — and with it
// the developer's database — just because one happens to answer on the usual port.
//
// And it is one stack *per worker* rather than one for the run: `tests/e2e/support/stack.ts`
// says why. The count below is the same number in both places, which is the whole arrangement —
// a worker with no stack of its own would have no frontend to drive.
const runId = randomUUID();

type Server = Extract<PlaywrightTestConfig["webServer"], readonly unknown[]>[number];

const stack = (worker: number): Server[] => [
  {
    name: `api-${worker}`,
    command: `uv run alembic -c apps/api/alembic.ini upgrade head && uv run uvicorn capability_lab.presentation.api:app --app-dir apps/api/src --host 127.0.0.1 --port ${apiPort(worker)}`,
    cwd: "../..",
    env: {
      AGENT_LAB_ENVIRONMENT: "test",
      AGENT_LAB_DATABASE_URL: databaseUrl(runId, worker),
      AGENT_LAB_FRONTEND_ORIGIN: webOrigin(worker),
      AGENT_LAB_TELEMETRY_HASH_SALT: "playwright-test-only-salt",
    },
    url: `${apiOrigin(worker)}/api/v1/health`,
    reuseExistingServer: false,
  },
  {
    name: `web-${worker}`,
    command: "pnpm dev --host 127.0.0.1",
    env: {
      AGENT_LAB_WEB_PORT: String(webPort(worker)),
      AGENT_LAB_API_ORIGIN: apiOrigin(worker),
      AGENT_LAB_WEB_CACHE_DIR: webCacheDir(worker),
      // The command inherits this process's environment, and a `VITE_` variable exported in a
      // developer's shell reaches the client bundle. `VITE_API_BASE_URL` would send the browser
      // straight to whatever origin it names, past this stack's proxy; empty means same-origin.
      VITE_API_BASE_URL: "",
    },
    url: webReadyUrl(worker),
    reuseExistingServer: false,
  },
];

export default defineConfig({
  testDir: "./tests/e2e",
  globalTeardown: "./playwright.teardown.ts",
  fullyParallel: true,
  workers: WORKER_COUNT,
  retries: process.env.CI ? 2 : 0,
  reporter: "html",
  use: {
    // Deliberately no `baseURL`: one origin here would be one worker's frontend, and every other
    // worker would drive it — the sharing this arrangement exists to end. The suite's own `test`
    // (`tests/e2e/support/e2e.ts`) gives each worker the origin of its own stack, and a spec that
    // took `test` from `@playwright/test` instead fails on its first navigation rather than
    // quietly joining someone else's database.
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: stacks().flatMap(stack),
});
