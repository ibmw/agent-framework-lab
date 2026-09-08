import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// The development server's port and the origin it proxies `/api` to are settings rather than
// constants so that a second, isolated stack can be brought up beside a running developer one.
// The defaults are the developer stack, so `make dev-web` needs neither variable.
const port = Number(process.env.AGENT_LAB_WEB_PORT ?? 5173);
const apiOrigin = process.env.AGENT_LAB_API_ORIGIN ?? "http://localhost:8000";

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
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: "./src/test/setup.ts",
  },
});
