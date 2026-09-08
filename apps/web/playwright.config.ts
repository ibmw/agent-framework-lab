import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";

// The E2E stack is a second stack, not the developer's. It listens on its own ports and never
// reuses a server it did not start, so a run cannot silently drive a developer API — and with it
// the developer's database — just because one happens to answer on the usual port.
const apiPort = 8001;
const webPort = 5174;
export const DATABASE_FILE_PREFIX = "agent-framework-lab-playwright-";
const apiOrigin = `http://localhost:${apiPort}`;
const webOrigin = `http://localhost:${webPort}`;
const databaseUrl = `sqlite:///${join(tmpdir(), `${DATABASE_FILE_PREFIX}${randomUUID()}.db`)}`;

export default defineConfig({
  testDir: "./tests/e2e",
  globalTeardown: "./playwright.teardown.ts",
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: "html",
  use: {
    baseURL: webOrigin,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      name: "api",
      command: `uv run alembic -c apps/api/alembic.ini upgrade head && uv run uvicorn capability_lab.presentation.api:app --app-dir apps/api/src --host 127.0.0.1 --port ${apiPort}`,
      cwd: "../..",
      env: {
        AGENT_LAB_ENVIRONMENT: "test",
        AGENT_LAB_DATABASE_URL: databaseUrl,
        AGENT_LAB_FRONTEND_ORIGIN: webOrigin,
        AGENT_LAB_TELEMETRY_HASH_SALT: "playwright-test-only-salt",
      },
      url: `${apiOrigin}/api/v1/health`,
      reuseExistingServer: false,
    },
    {
      name: "web",
      command: "pnpm dev --host 127.0.0.1",
      env: {
        AGENT_LAB_WEB_PORT: String(webPort),
        AGENT_LAB_API_ORIGIN: apiOrigin,
        // The command inherits this process's environment, and a `VITE_` variable exported in a
        // developer's shell reaches the client bundle. `VITE_API_BASE_URL` would send the browser
        // straight to whatever origin it names, past this stack's proxy; empty means same-origin.
        VITE_API_BASE_URL: "",
      },
      url: webOrigin,
      reuseExistingServer: false,
    },
  ],
});
