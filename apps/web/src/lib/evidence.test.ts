import type { JudgementSchema } from "@agent-lab/contracts";
import { describe, expect, it } from "vitest";
import { firstSentence, judgementProvenance } from "./evidence";

/** What a judged cell shows before it is opened: one sentence of the judge's rationale. */
describe("firstSentence", () => {
  it("ends at the first full stop, question or exclamation mark followed by a space", () => {
    expect(firstSentence("The arm named the order. It said what changed.")).toBe(
      "The arm named the order.",
    );
    expect(firstSentence("Did it read the policy? It did not.")).toBe("Did it read the policy?");
    expect(firstSentence("It refused! Then it apologised.")).toBe("It refused!");
  });

  it("does not cut inside a token like a version number", () => {
    expect(firstSentence("It cited policy v1.2 before writing. Then it wrote.")).toBe(
      "It cited policy v1.2 before writing.",
    );
  });

  it("cuts after a reference that ends a clause with a full stop", () => {
    expect(firstSentence("It moved order NS-10482. Then it confirmed.")).toBe(
      "It moved order NS-10482.",
    );
  });

  it("returns a rationale with no sentence ending whole", () => {
    expect(firstSentence("the arm answered every turn it received (2 of them)")).toBe(
      "the arm answered every turn it received (2 of them)",
    );
  });
});

const JUDGEMENT: JudgementSchema = {
  judge_id: "7c8d9e0f-1a2b-4c3d-8e4f-5a6b7c8d9e0f",
  judge_version: 2,
  provider: "openai",
  model_id: "gpt-5-mini",
  brief_fingerprint: "e".repeat(64),
  attempt: 1,
  outcome: "met",
  failure: null,
};

/** Who scored a cell, by the name the judge was published under. */
describe("judgementProvenance", () => {
  it("names the judge as published, and the model that read its rubric", () => {
    expect(judgementProvenance(JUDGEMENT, "Resolution quality")).toBe(
      "Judged by Resolution quality, version 2, on gpt-5-mini — attempt 1.",
    );
  });

  it("names a judge the listing has not given by the start of its identifier", () => {
    expect(judgementProvenance(JUDGEMENT, undefined)).toBe(
      "Judged by judge 7c8d9e0f, version 2, on gpt-5-mini — attempt 1.",
    );
  });

  it("calls the control the deterministic control rather than its model", () => {
    expect(
      judgementProvenance({ ...JUDGEMENT, provider: "fake", model_id: "deterministic" }, "Control"),
    ).toBe("Judged by Control, version 2, on the deterministic control — attempt 1.");
  });

  it("calls an execution that produced no verdict an attempt, with why", () => {
    expect(
      judgementProvenance(
        { ...JUDGEMENT, outcome: null, failure: "transient" },
        "Resolution quality",
      ),
    ).toBe(
      "Attempted by Resolution quality, version 2, on gpt-5-mini — attempt 1; no verdict: the provider was briefly unavailable.",
    );
  });
});
