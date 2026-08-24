import type { CustomerProfileContentSchema } from "@agent-lab/contracts";
import { describe, expect, it } from "vitest";
import { toProfilePayload } from "../api/customerProfiles";

const CONTENT: CustomerProfileContentSchema = {
  identity: {
    given_name: "Maya",
    family_name: "Laurent",
    email: "maya.laurent@example.org",
    locale: "fr-FR",
    phone: null,
  },
  account: {
    customer_since: "2024-03-14",
    status: "active",
    loyalty_tier: "silver",
    marketing_opt_in: true,
    notes: "",
  },
  persona: { summary: "Direct.", traits: ["direct"] },
  addresses: [
    {
      id: "home",
      label: "Home",
      recipient: "Maya Laurent",
      line1: "18 rue des Écoles",
      line2: null,
      postal_code: "69005",
      city: "Lyon",
      region: null,
      country: "FR",
      is_default: true,
    },
  ],
  background: [],
  hidden_facts: [],
  display_name: "Maya Laurent",
  default_address_id: "home",
};

describe("toProfilePayload", () => {
  it("strips the derived evidence a draft write must not echo back", () => {
    const payload = toProfilePayload(CONTENT);

    expect(payload).not.toHaveProperty("display_name");
    expect(payload).not.toHaveProperty("default_address_id");
  });

  it("keeps every authored section byte for byte", () => {
    const payload = toProfilePayload(CONTENT);

    expect(payload).toEqual({
      identity: CONTENT.identity,
      account: CONTENT.account,
      persona: CONTENT.persona,
      addresses: CONTENT.addresses,
      background: CONTENT.background,
      hidden_facts: CONTENT.hidden_facts,
    });
  });

  it("does not mutate the content it projects", () => {
    const before = structuredClone(CONTENT);

    toProfilePayload(CONTENT);

    expect(CONTENT).toEqual(before);
  });
});
