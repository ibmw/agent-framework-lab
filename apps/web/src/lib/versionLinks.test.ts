import { matchRoutes } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { routeTree } from "../routeTree";
import { DEFINITION_TYPE } from "./enumLabels";
import { definitionPath, LINKED_DEFINITION_TYPES, versionPath } from "./versionLinks";

const SHOP = "3f4a3b2c-1d0e-4f5a-8b7c-6d5e4f3a2b1c";
const ID = "5c6d7e8f-9a0b-4c1d-8e2f-3a4b5c6d7e8f";

describe("where a pinned version links", () => {
  it("links every definition type the contract can pin", () => {
    expect([...LINKED_DEFINITION_TYPES].sort()).toEqual(Object.keys(DEFINITION_TYPE).sort());
  });

  it.each(LINKED_DEFINITION_TYPES)(
    "sends a %s to a page the app renders rather than to a redirect",
    (type) => {
      const matched = matchRoutes(routeTree, definitionPath(type, ID, 3, SHOP)) ?? [];
      const leaf = matched[matched.length - 1];
      // The catch-all sends an unknown address to the shops index, which would read as a
      // link that worked.
      expect(leaf?.route.path, type).toBeDefined();
      expect(leaf?.route.path).not.toBe("*");
    },
  );

  it("opens the editor of the draft a configuration version was published from", () => {
    expect(versionPath("agent_configuration", ID, 4, SHOP)).toBe(`/lab/agent-configurations/${ID}`);
  });

  it("opens the shop's own page for the version itself, the one definition that has one", () => {
    expect(versionPath("shop", SHOP, 3, SHOP)).toBe(`/shops/${SHOP}/versions/3`);
  });

  it("leaves a type it does not know unlinked rather than linking it nowhere", () => {
    expect(versionPath("warehouse", ID, 1, SHOP)).toBeNull();
    expect(versionPath("toString", ID, 1, SHOP)).toBeNull();
  });

  it("addresses a shop-scoped definition under the shop the run was made in", () => {
    expect(versionPath("ticket", ID, 1, SHOP)).toBe(`/shops/${SHOP}/tickets/${ID}`);
    expect(versionPath("customer_profile", ID, 2, SHOP)).toBe(`/shops/${SHOP}/customers/${ID}`);
    expect(versionPath("scenario", ID, 1, SHOP)).toBe(`/shops/${SHOP}/scenarios/${ID}`);
  });
});
