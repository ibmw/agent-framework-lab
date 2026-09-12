import { describe, expect, it } from "vitest";
import { GLOSSARY_TERMS, glossaryTerm } from "./glossary";

/**
 * The glossary claims to define the vocabulary this application uses on screen. These are the
 * assertions that make the claim checkable rather than aspirational (ADR 0044).
 */
describe("the glossary", () => {
  it("defines every term it lists, once", () => {
    const ids = GLOSSARY_TERMS.map((entry) => entry.id);

    expect(new Set(ids).size).toBe(ids.length);
    for (const entry of GLOSSARY_TERMS) {
      expect(entry.term.length).toBeGreaterThan(0);
      expect(entry.definition.length).toBeGreaterThan(0);
    }
  });

  it("covers the stable vocabulary the roadmap keeps", () => {
    // `docs/PLAN.md`'s "Stable target vocabulary" is what this module carries. A word added
    // there and not here leaves a reader of the application with nowhere to look it up.
    for (const id of [
      "definition",
      "shop",
      "customer-profile",
      "support-identity",
      "ticket",
      "scenario",
      "objective-block",
      "mutation-block",
      "agent-configuration",
      "sandbox-snapshot",
      "experiment",
      "run",
      "participant-driver",
      "judge-configuration",
      "evaluation",
    ]) {
      expect(glossaryTerm(id), `${id} has no definition`).toBeDefined();
    }
  });

  it("resolves nothing for a word it does not define", () => {
    expect(glossaryTerm("leaderboard")).toBeUndefined();
  });
});
