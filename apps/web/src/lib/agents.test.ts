import { describe, expect, it } from "vitest";
import { describeArchitecture, describeProvider, MODEL_PROVIDER_LABELS } from "./agents";

/**
 * The workspace's one spelling of a model provider.
 *
 * The entries must agree with `PROVEN_JUDGES` in
 * `apps/api/src/capability_lab/application/judge_capabilities.py`, which is where the lab
 * writes these words itself. That agreement is not mechanically checked, and it could be —
 * `fieldRules.test.ts` reads the same module with `?raw` to pin the gate's sentences — but a
 * label is not the same kind of copy: the judge editor and the judges index read the served
 * `ProvenJudge.label` where the catalog has one, so this table is the *fallback* spelling
 * rather than a second authority, and a provider it has no words for is returned verbatim.
 * What it pins is that the fallback matches what the lab says today.
 */
describe("describeProvider", () => {
  it("spells the two providers the lab publishes as the lab spells them", () => {
    expect(describeProvider("openai")).toBe("OpenAI");
    expect(describeProvider("fake")).toBe("Deterministic control");
  });

  it("returns a provider it has no words for exactly as the record carries it", () => {
    // `describeValue`'s rule: the vocabulary is the backend's, and a guess here would sit
    // where the lab's own word belongs.
    expect(describeProvider("anthropic")).toBe("anthropic");
    expect(describeProvider("")).toBe("");
  });

  it("spells no two providers the same way", () => {
    const labels = Object.values(MODEL_PROVIDER_LABELS);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe("describeArchitecture", () => {
  it("is unchanged by the provider table beside it", () => {
    expect(describeArchitecture("single_agent")).toBe("Single agent");
    expect(describeArchitecture("multi_agent")).toBe("multi agent");
  });
});
