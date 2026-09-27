import type { DefinitionIssueSchema } from "@agent-lab/contracts";
import { describe, expect, it } from "vitest";
import contentDomain from "../../../api/src/capability_lab/domain/content.py?raw";
import entitiesDomain from "../../../api/src/capability_lab/domain/entities.py?raw";
import {
  EXPERIMENT_LABEL_MAX_LENGTH,
  isSeed,
  NO_ARM,
  NO_NAME,
  NO_SCENARIO,
  NO_SCENARIO_VERSION,
  NO_SEED,
  SEED_OUT_OF_RANGE,
  type StartState,
  startRefusals,
} from "./experimentStart";
import { MAX_SEED } from "./fieldRules";

const GATE_ERROR: DefinitionIssueSchema = {
  severity: "error",
  code: "tone_override_unknown_in_shop",
  message: "cfg writes in tone-of-voice guideline 'x', which this scenario's shop does not publish",
  path: "arms[0].tone_of_voice",
};

const GATE_WARNING: DefinitionIssueSchema = {
  severity: "warning",
  code: "multiple_comparison_variables",
  message: "these arms differ in 2 dimensions (framework, model)",
  path: "arms",
};

const REFUSED = "scenario 1 version 2 is not published in shop 3";
const UNREACHABLE = "Published configurations naming OpenAI cannot be advanced here.";

/** One axis of the setup: each of its states, and the reason that state gives, if any. */
type Axis = readonly (readonly [Partial<StartState>, string[]])[];

const AXES: readonly Axis[] = [
  [
    [{ scenarioId: "", scenarioVersion: "" }, [NO_SCENARIO]],
    [{ scenarioId: "s", scenarioVersion: "" }, [NO_SCENARIO_VERSION]],
    [{ scenarioId: "s", scenarioVersion: "1" }, []],
  ],
  [
    [{ seed: "" }, [NO_SEED]],
    [{ seed: "-1" }, [SEED_OUT_OF_RANGE]],
    [{ seed: "42" }, []],
  ],
  [
    [{ label: "  " }, [NO_NAME]],
    [{ label: "Prompt comparison" }, []],
  ],
  [
    [{ chosenArms: 0 }, [NO_ARM]],
    [{ chosenArms: 1 }, []],
    [{ chosenArms: 2 }, []],
  ],
  [
    [{ gateIssues: [] }, []],
    [{ gateIssues: [GATE_WARNING] }, []],
    [{ gateIssues: [GATE_ERROR, GATE_WARNING] }, [GATE_ERROR.message]],
  ],
  [
    [{ previewRefusal: null }, []],
    [{ previewRefusal: REFUSED }, [REFUSED]],
  ],
  [
    [{ unreachable: "" }, []],
    [{ unreachable: UNREACHABLE }, [UNREACHABLE]],
  ],
];

function* combinations(axes: readonly Axis[]): Generator<[Partial<StartState>, string[]]> {
  if (axes.length === 0) {
    yield [{}, []];
    return;
  }
  const [first, ...rest] = axes;
  for (const [state, reasons] of first) {
    for (const [restState, restReasons] of combinations(rest)) {
      yield [{ ...state, ...restState }, [...reasons, ...restReasons]];
    }
  }
}

describe("what Start waits for", () => {
  it("names every cause at once, in the form's order, in every combination of them", () => {
    let swept = 0;
    for (const [state, reasons] of combinations(AXES)) {
      expect(startRefusals(state as StartState), JSON.stringify(state)).toEqual(reasons);
      swept += 1;
    }
    // 3 · 3 · 2 · 3 · 3 · 2 · 2: a sweep that silently shrank would pass on nothing.
    expect(swept).toBe(648);
  });

  it("waits for nothing once each cause is answered", () => {
    expect(
      startRefusals({
        scenarioId: "s",
        scenarioVersion: "1",
        seed: "0",
        label: "x",
        chosenArms: 1,
        gateIssues: [GATE_WARNING],
        previewRefusal: null,
        unreachable: "",
      }),
    ).toEqual([]);
  });
});

describe("the seed the contract carries", () => {
  it("is the range `domain/entities.py` declares", () => {
    expect(entitiesDomain).toMatch(/^MIN_SCENARIO_SEED = 0$/m);
    expect(entitiesDomain).toMatch(/^MAX_SCENARIO_SEED = 2\*\*32 - 1$/m);
    expect(MAX_SEED).toBe(2 ** 32 - 1);
  });

  it.each([
    ["", false],
    [" ", false],
    ["0", true],
    ["-0", true],
    ["42", true],
    [" 42 ", true],
    ["4294967295", true],
    ["4294967296", false],
    ["-1", false],
    ["1.5", false],
    ["1.0", true],
    ["1e3", true],
    ["1e10", false],
    ["abc", false],
    ["NaN", false],
    ["Infinity", false],
  ])("reads %j as a seed: %s", (seed, expected) => {
    expect(isSeed(seed)).toBe(expected);
  });
});

describe("the name's length", () => {
  it("is `MAX_LABEL_LENGTH` in `domain/content.py`, which `require_label` enforces", () => {
    expect(contentDomain).toMatch(
      new RegExp(`^MAX_LABEL_LENGTH = ${EXPERIMENT_LABEL_MAX_LENGTH}$`, "m"),
    );
    expect(contentDomain).toMatch(/if len\(value\) > MAX_LABEL_LENGTH:/);
  });
});
