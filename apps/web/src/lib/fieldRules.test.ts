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
import fieldRulesSource from "./fieldRules?raw";

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

/**
 * Every rule in this module is shown somewhere.
 *
 * The module exists so that a create form and the editor row for the same field read one
 * sentence; an export nothing renders is that promise without its second half, and it is the
 * state five of this module's rules were in before UI-8 — written inline on a create
 * form, unreachable from the editor row beside it. This sweep is the `enumLabels.test.ts` pattern
 * applied to copy: it reads the sources rather than the values, because a rule's consumers
 * are a fact about the repository and not about any one render.
 *
 * It counts an **import**, not an occurrence. `PRODUCT_CATEGORY_RULE` is named in a comment
 * in `ProductEditorPage.tsx` explaining why that row does *not* show it, and a text search
 * would read the explanation as the consumer.
 *
 * What it proves is exactly that: imported by a shipping module. It does not prove the value
 * reaches a render, and an import nobody uses would satisfy it — that half is Biome's
 * `noUnusedImports`, which `make check` runs over the same files. The two together are the
 * claim; this file alone is not, and the name above says so.
 */
const sources = import.meta.glob("../**/*.{ts,tsx}", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/** Every `export const` / `export function` name this module publishes. */
function exportedNames(source: string): string[] {
  return [...source.matchAll(/^export (?:const|function) ([A-Za-z0-9_]+)/gm)].map(
    (match) => match[1],
  );
}

/**
 * What one module imports from `fieldRules` as a **value**, aliases resolved to the exported
 * name.
 *
 * A type-only import does not count, in either spelling: `import type { X }` is not matched
 * at all, and an inline `{ type X }` specifier is dropped. Nothing this module publishes is a
 * type, so neither form compiles today and the distinction is dead weight in practice — it is
 * here because the alternative is a rule that could be kept alive by an import that renders
 * nothing, which is the state the sweep exists to detect.
 */
function importedFromFieldRules(source: string): string[] {
  const clause = /import\s+(type\s+)?\{([^}]*)\}\s*from\s*"[^"]*\/fieldRules"/g;
  return [...source.matchAll(clause)]
    .filter((match) => match[1] === undefined)
    .flatMap((match) =>
      match[2]
        .split(",")
        .map((specifier) =>
          specifier
            .trim()
            .split(/\s+as\s+/)[0]
            .trim(),
        )
        .filter((name) => name.length > 0 && !/^type\s/.test(name)),
    );
}

describe("every rule this module publishes is imported by a module that ships", () => {
  const isConsumer = (path: string) => !path.includes("fieldRules") && !path.includes(".test.");
  const consumers = Object.entries(sources).filter(([path]) => isConsumer(path));

  it("found the workspace's modules to sweep", () => {
    // Asserted first: a glob that matched nothing would make every case below pass.
    expect(Object.keys(sources).length).toBeGreaterThan(50);
    expect(consumers.length).toBeGreaterThan(40);
    expect(consumers.some(([path]) => path.endsWith("routes/ProductEditorPage.tsx"))).toBe(true);
  });

  it("reads this module's own exports rather than a hand-kept list", () => {
    const names = exportedNames(fieldRulesSource);
    expect(names.length).toBeGreaterThan(30);
    expect(names).toContain("PRODUCT_CATEGORY_RULE");
    expect(names).toContain("ORDER_METHOD_RULE");
  });

  it("counts an import and not a mention in a comment", () => {
    const editor = sources["../routes/ProductEditorPage.tsx"];
    expect(editor).toBeDefined();
    // The row that deliberately shows no category rule still explains itself in prose.
    expect(editor).toContain("PRODUCT_CATEGORY_RULE");
    expect(importedFromFieldRules(editor)).not.toContain("PRODUCT_CATEGORY_RULE");
  });

  it("counts a value import and neither spelling of a type-only one", () => {
    // Synthetic, because nothing this module publishes is a type, so neither type form
    // compiles anywhere in the workspace and the rule could not otherwise be exercised.
    expect(
      importedFromFieldRules('import { A_RULE, B_RULE as C } from "../lib/fieldRules";'),
    ).toEqual(["A_RULE", "B_RULE"]);
    expect(importedFromFieldRules('import type { A_RULE } from "../lib/fieldRules";')).toEqual([]);
    expect(importedFromFieldRules('import { type A_RULE } from "../lib/fieldRules";')).toEqual([]);
    // A mention outside an import clause is not a consumer, whatever it is inside.
    expect(importedFromFieldRules("// A_RULE is deliberately not shown here.")).toEqual([]);
  });

  /**
   * The one rule this workspace publishes and shows nowhere, and the reason it is allowed to.
   *
   * `PRODUCT_CATEGORY_RULE` promises a pick list — "Pick one the draft already uses" — and
   * the only surface that rendered one was the products create card, which PLAN-UX Slice 12
   * removed when creation became a page. The product editor's category row is the last place
   * that asks for a category and it deliberately shows no hint, because a rule promising a
   * list the surface does not draw is worse than a rule withheld; that is a defect
   * `docs/decisions-and-next-step.md` records and PLAN-UX Slice 27 owns.
   *
   * Written as a named list of one rather than as a softer sweep, so it is a single visible
   * debt with an owner, and as an *equality* rather than an exclusion: the day Slice 27 adds
   * the datalist the rule stops being an orphan, the list stops matching, and this case
   * fails until the constant is deleted with it. The allowance cannot outlive the debt.
   */
  const AWAITING_ITS_SURFACE = ["PRODUCT_CATEGORY_RULE"];

  it("leaves no export unconsumed but the one a slice owes a surface", () => {
    const consumed = new Set(
      consumers.flatMap(([, source]) => importedFromFieldRules(source as string)),
    );
    const orphans = exportedNames(fieldRulesSource).filter((name) => !consumed.has(name));
    expect(orphans, "exported by lib/fieldRules.ts and imported by nothing").toEqual(
      AWAITING_ITS_SURFACE,
    );
  });
});
