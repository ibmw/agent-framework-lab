import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// The development server's port and the origin it proxies `/api` to are settings rather than
// constants so that a second, isolated stack can be brought up beside a running developer one.
// The defaults are the developer stack, so `make dev-web` needs neither variable.
const port = readPort(process.env.AGENT_LAB_WEB_PORT);
const apiOrigin = process.env.AGENT_LAB_API_ORIGIN ?? "http://localhost:8000";

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
