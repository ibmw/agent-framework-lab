import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";

const databaseUrl = `sqlite:///${join(tmpdir(), `agent-framework-lab-playwright-${randomUUID()}.db`)}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: "html",
  use: {
    baseURL: "http://localhost:5173",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      name: "api",
      command:
        "uv run alembic -c apps/api/alembic.ini upgrade head && uv run uvicorn capability_lab.presentation.api:app --app-dir apps/api/src --host 127.0.0.1 --port 8000",
      cwd: "../..",
      env: {
        AGENT_LAB_DATABASE_URL: databaseUrl,
        AGENT_LAB_FRONTEND_ORIGIN: "http://localhost:5173",
      },
      url: "http://localhost:8000/api/v1/health",
      reuseExistingServer: !process.env.CI,
    },
    {
      name: "web",
      command: "pnpm dev --host 127.0.0.1",
      url: "http://localhost:5173",
      reuseExistingServer: !process.env.CI,
    },
  ],
});
