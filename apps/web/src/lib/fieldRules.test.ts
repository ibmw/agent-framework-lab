import { describe, expect, it } from "vitest";
// The gate's own source, as text. `enumLabels.test.ts` reads the generated contract the same
// way and for the same reason: what these tests are about only exists in the file that
// declares it, so the file is what they have to read.
import agentCapabilities from "../../../../apps/api/src/capability_lab/application/agent_capabilities.py?raw";
import judgeCapabilities from "../../../../apps/api/src/capability_lab/application/judge_capabilities.py?raw";
import {
  unexercisedModelRule,
  unprovenAgentProviderRule,
  unprovenJudgeProviderRule,
} from "./fieldRules";

/**
 * The Studio's copy of three publish-gate sentences, pinned to the gate that writes them.
 *
 * These are not rules this application decides. `capability_issues` in
 * `agent_capabilities.py` and `judge_capability_issues` in `judge_capabilities.py` emit them,
 * and the fields repeat them as an author types, because `GET /draft/preview` previews the
 * *saved* draft and takes no payload — a refetch after a keystroke would answer for the value
 * that was last saved, and filtering `preview.issues` by `path` would lag the same way. Only
 * the wording is copied; the gate's logic is evaluated here from `resources`.
 *
 * So the copy is pinned mechanically rather than by a docstring anyone has to follow: the
 * f-string template is read out of the Python, rendered with known values, and compared to
 * what the TypeScript produces from the same values. A reword on either side fails this file.
 * `test_agent_capabilities.py` and `test_judge_configurations.py` assert the rendered messages
 * from the other direction, which is what catches a change to the *values* the template
 * interpolates.
 */

/**
 * One `issue_*` call's message template, with Python's implicit concatenation undone.
 *
 * Three of the four are written as adjacent literals across two lines, which is Python
 * joining them at parse time — `f"…exercises; "` followed by `f"{framework.label} is proven…"`
 * is one string. The join here is that same rule and nothing more: a literal's closing quote,
 * whitespace, and the next literal's `f"` opening collapse to nothing.
 */
function messageTemplate(source: string, code: string): string {
  const joined = source.replaceAll(/"\s*\n\s*f"/g, "");
  const match = new RegExp(`"${code}",\\s*f"([^"]*)"`).exec(joined);
  if (match === null) {
    throw new Error(`no issue message found for ${code}`);
  }
  return match[1];
}

/**
 * A template with each `{expression}` replaced by what this test says it resolves to.
 *
 * Every placeholder must be supplied. A template that grew one — a gate that started naming
 * the architecture too, say — fails here rather than rendering a brace into the comparison
 * and being reported as a wording change somewhere else.
 */
function render(template: string, values: Record<string, string>): string {
  return template.replaceAll(/\{([^{}]*)\}/g, (_whole, expression: string) => {
    const value = values[expression];
    if (value === undefined) {
      throw new Error(`the template interpolates ${expression}, which this test does not supply`);
    }
    return value;
  });
}

describe("reading the gate's message templates out of the gate", () => {
  it("finds a template for each of the three codes the Studio repeats", () => {
    // Asserted before anything is compared against it: a regex that silently matched nothing
    // useful would make every assertion below vacuous.
    for (const [source, code] of [
      [agentCapabilities, "provider_not_proven"],
      [agentCapabilities, "model_not_exercised"],
      [judgeCapabilities, "judge_provider_not_proven"],
      [judgeCapabilities, "judge_model_not_exercised"],
    ] as const) {
      const template = messageTemplate(source, code);
      expect(template.length, `${code} read an empty template`).toBeGreaterThan(20);
      expect(template, `${code} read a template with no interpolation`).toMatch(/\{[^{}]+\}/);
      expect(template, `${code} read a template that is still split`).not.toContain('"');
    }
  });

  it("refuses to read a code the gate does not raise", () => {
    expect(() => messageTemplate(agentCapabilities, "no_such_code")).toThrow(/no issue message/);
  });

  it("refuses a template whose placeholders it cannot all resolve", () => {
    expect(() => render("{a} and {b}", { a: "one" })).toThrow(/does not supply/);
  });
});

describe("the publish gate's sentences, as the Studio repeats them", () => {
  it("spells an unproven agent provider exactly as `capability_issues` writes it", () => {
    const rendered = render(messageTemplate(agentCapabilities, "provider_not_proven"), {
      "framework.label": "Pydantic AI",
      "payload.model.provider": "anthropic",
    });

    expect(unprovenAgentProviderRule("anthropic", "Pydantic AI")).toBe(rendered);
  });

  it("spells an unexercised agent model exactly as `capability_issues` writes it", () => {
    const rendered = render(messageTemplate(agentCapabilities, "model_not_exercised"), {
      "payload.model.model_id": "gpt-4.1",
      "framework.label": "Pydantic AI",
      "', '.join(framework.models)": "gpt-5-mini, gpt-5",
    });

    expect(unexercisedModelRule("gpt-4.1", "Pydantic AI", ["gpt-5-mini", "gpt-5"])).toBe(rendered);
  });

  it("spells an unproven judge provider in the judge gate's own different words", () => {
    // Not the agent's sentence: a judge names no framework, so one shared wording would put a
    // subject in it that does not exist. Read from the other file to prove they differ.
    const rendered = render(messageTemplate(judgeCapabilities, "judge_provider_not_proven"), {
      "payload.model.provider": "acme",
    });

    expect(unprovenJudgeProviderRule("acme")).toBe(rendered);
    expect(rendered).not.toBe(unprovenAgentProviderRule("acme", "Pydantic AI"));
  });

  it("spells an unexercised judge model with the same words as the agent's", () => {
    const rendered = render(messageTemplate(judgeCapabilities, "judge_model_not_exercised"), {
      "payload.model.model_id": "something-else",
      "judge.label": "Deterministic control",
      "', '.join(judge.models)": "deterministic",
    });

    // One TypeScript function serves both, so the two templates have to agree.
    expect(unexercisedModelRule("something-else", "Deterministic control", ["deterministic"])).toBe(
      rendered,
    );
  });

  it("ends none of them with punctuation the gate does not carry", () => {
    const sentences = [
      unexercisedModelRule("m", "P", ["a"]),
      unprovenAgentProviderRule("p", "F"),
      unprovenJudgeProviderRule("p"),
    ];
    for (const sentence of sentences) {
      expect(sentence.endsWith(".")).toBe(false);
    }
  });
});
