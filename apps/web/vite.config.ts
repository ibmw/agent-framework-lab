import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// The development server's port and the origin it proxies `/api` to are settings rather than
// constants so that a second, isolated stack can be brought up beside a running developer one.
// The defaults are the developer stack, so `make dev-web` needs neither variable.
const port = readPort(process.env.AGENT_LAB_WEB_PORT);
const apiOrigin = process.env.AGENT_LAB_API_ORIGIN ?? "http://localhost:8000";
// Vite's dependency optimizer caches into the project, and the E2E suite runs one dev server per
// Playwright worker against this one project. Four servers re-optimizing into one directory
// invalidate each other's cache mid-run, which is a stall in somebody's first page load. A server
// that is given a directory of its own optimizes once and keeps it. Unset is the default and the
// developer stack.
const cacheDir = process.env.AGENT_LAB_WEB_CACHE_DIR;

function readPort(value: string | undefined): number {
  if (value === undefined) {
    return 5173;
  }
  // A value Vite cannot bind is worth saying out loud: coercing it would hand `strictPort` a 0 or
  // a NaN, Vite would take an arbitrary free port, and whoever is waiting on the declared one
  // would only learn of it as a timeout.
  if (!/^[0-9]+$/.test(value) || Number(value) < 1 || Number(value) > 65535) {
    throw new Error(`AGENT_LAB_WEB_PORT must be a port number, not ${JSON.stringify(value)}`);
  }
  return Number.parseInt(value, 10);
}

export default defineConfig({
  cacheDir,
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    port,
    strictPort: true,
    proxy: { "/api": apiOrigin },
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}", "tests/config/**/*.test.ts"],
    setupFiles: "./src/test/setup.ts",
  },
});
