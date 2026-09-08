import { describe, expect, it } from "vitest";
import config, { DATABASE_FILE_PREFIX } from "../../playwright.config";

// The suite once ran green while serving from a developer's API and writing to their database,
// because a config that reused whatever answered on the usual port cannot tell the two apart.
// Nothing else reads these settings, so nothing else would notice them being reverted.
const DEVELOPER_PORTS = [8000, 5173];

const servers = Array.isArray(config.webServer)
  ? config.webServer
  : config.webServer
    ? [config.webServer]
    : [];

function portOf(url: string): number {
  return Number(new URL(url).port);
}

describe("the end-to-end configuration", () => {
  it("declares an API and a frontend to start", () => {
    expect(servers.map((server) => server.name)).toEqual(["api", "web"]);
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

  it("drives the browser through its own frontend", () => {
    const web = servers.find((server) => server.name === "web");
    expect(config.use?.baseURL).toBe(web?.url);
  });

  it("gives the browser no API origin that would bypass that frontend", () => {
    const web = servers.find((server) => server.name === "web");
    expect(web?.env?.VITE_API_BASE_URL).toBe("");
  });

  it("migrates a database of its own rather than the developer's", () => {
    const api = servers.find((server) => server.name === "api");
    expect(api?.env?.AGENT_LAB_DATABASE_URL).toContain(DATABASE_FILE_PREFIX);
    expect(api?.env?.AGENT_LAB_DATABASE_URL).not.toContain("var/agent-lab.db");
  });
});
