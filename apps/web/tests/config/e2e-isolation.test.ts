import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import config from "../../playwright.config";
import {
  apiOrigin,
  apiPort,
  DATABASE_FILE_PREFIX,
  stacks,
  WORKER_COUNT,
  webCacheDir,
  webPort,
  webReadyUrl,
} from "../e2e/support/stack";

// The suite once ran green while serving from a developer's API and writing to their database,
// because a config that reused whatever answered on the usual port cannot tell the two apart.
// It then ran red at random while six workers shared one API and one SQLite file, because a
// config that declares one stack for a parallel run cannot tell two journeys apart either.
// Nothing else reads these settings, so nothing else would notice them being reverted.
const DEVELOPER_PORTS = [8000, 5173];
// The block of ports `AGENTS.md`, `README.md` and `docs/development.md` reserve for Playwright.
// Written out here rather than derived, because the point is to catch the code and the rule
// drifting apart: the rule is a sentence a person has to re-edit, and nothing else would notice.
const RESERVED_LAST_API_PORT = 8004;
const RESERVED_LAST_WEB_PORT = 5177;
const E2E_DIRECTORY = join(__dirname, "..", "e2e");

const servers = Array.isArray(config.webServer)
  ? config.webServer
  : config.webServer
    ? [config.webServer]
    : [];

function portOf(url: string): number {
  return Number(new URL(url).port);
}

describe("the end-to-end configuration", () => {
  it("declares an API and a frontend for every worker it runs", () => {
    expect(config.workers).toBe(WORKER_COUNT);
    expect(servers.map((server) => server.name)).toEqual(
      stacks().flatMap((worker) => [`api-${worker}`, `web-${worker}`]),
    );
  });

  it.each(servers.map((server) => [server.name, server] as const))(
    "starts %s itself rather than adopting one that answers",
    (_name, server) => {
      expect(server.reuseExistingServer).toBe(false);
    },
  );

  it.each(servers.map((server) => [server.name, server] as const))(
    "keeps %s off every developer port",
    (_name, server) => {
      expect(DEVELOPER_PORTS).not.toContain(portOf(server.url ?? ""));
      for (const port of DEVELOPER_PORTS) {
        expect(JSON.stringify(server)).not.toContain(`:${port}`);
      }
    },
  );

  it.each(stacks())("puts worker %i on a stack of its own", (worker) => {
    const api = servers.find((server) => server.name === `api-${worker}`);
    const web = servers.find((server) => server.name === `web-${worker}`);
    expect(api?.url).toBe(`${apiOrigin(worker)}/api/v1/health`);
    // Ready means "has transformed the app", not "answers on the port": see `webReadyUrl`.
    expect(web?.url).toBe(webReadyUrl(worker));
    // The frontend proxies to its own worker's API, and to no other, and optimizes into a
    // dependency cache no other server writes.
    expect(web?.env?.AGENT_LAB_API_ORIGIN).toBe(apiOrigin(worker));
    expect(web?.env?.AGENT_LAB_WEB_CACHE_DIR).toBe(webCacheDir(worker));
  });

  it("gives every worker a database no other worker can reach", () => {
    const urls = stacks().map(
      (worker) =>
        servers.find((server) => server.name === `api-${worker}`)?.env?.AGENT_LAB_DATABASE_URL,
    );
    for (const url of urls) {
      expect(url).toContain(DATABASE_FILE_PREFIX);
      expect(url).not.toContain("var/agent-lab.db");
    }
    expect(new Set(urls).size).toBe(WORKER_COUNT);
  });

  it.each(
    servers.filter((server) => server.name?.startsWith("web-")).map((s) => [s.name, s] as const),
  )("gives %s's browser no API origin that would bypass that frontend", (_name, web) => {
    expect(web.env?.VITE_API_BASE_URL).toBe("");
  });

  it("names no single base URL, because one would be one worker's frontend", () => {
    expect(config.use?.baseURL).toBeUndefined();
  });

  it("stays inside the block of ports the repository reserves for it", () => {
    // `AGENTS.md`, `README.md` and `docs/development.md` name that block as a range a reader can
    // check a stray process against. Raising the worker count silently widens it, so the count
    // and those three sentences have to move together — this is what makes them.
    expect(apiPort(WORKER_COUNT - 1)).toBeLessThanOrEqual(RESERVED_LAST_API_PORT);
    expect(webPort(WORKER_COUNT - 1)).toBeLessThanOrEqual(RESERVED_LAST_WEB_PORT);
  });

  it("has every spec take its `test` from the suite's own fixture", () => {
    // The base URL that points a spec at its own worker's stack lives in that fixture. A spec
    // importing `test` from `@playwright/test` would have none — the failure is loud rather than
    // silent, but it is cheaper to fail here, by name, than on somebody's first navigation.
    const specs = readdirSync(E2E_DIRECTORY, { recursive: true, encoding: "utf8" }).filter(
      (entry) => entry.endsWith(".spec.ts"),
    );
    expect(specs.length).toBeGreaterThan(0);
    for (const spec of specs) {
      const source = readFileSync(join(E2E_DIRECTORY, spec), "utf8");
      // Both shapes: the named import the specs use, and the default import that would bind the
      // same `test` under any name at all.
      expect(source, `${spec} imports test from @playwright/test`).not.toMatch(
        /import\s*{[^}]*\btest\b[^}]*}\s*from\s*"@playwright\/test"/,
      );
      expect(source, `${spec} default-imports @playwright/test`).not.toMatch(
        /import\s+(?!type\b)[A-Za-z_$][\w$]*\s*(?:,|from)[^;]*"@playwright\/test"/,
      );
      expect(source, `${spec} does not import the suite's test`).toMatch(
        /from\s*"(?:\.{1,2}\/)+support\/e2e"/,
      );
    }
  });
});
