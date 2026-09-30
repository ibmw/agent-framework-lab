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
  noArmVersion,
  proposedExperimentName,
  SEED_OUT_OF_RANGE,
  type StartState,
  setupOf,
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

/** An arm left empty, being read, half-chosen with nothing being read, and whole. */
const EMPTY = { configurationId: "", version: "", versionPending: false };
const READING = { configurationId: "c", version: "", versionPending: true };
const HALF = { configurationId: "c", version: "", versionPending: false };
const WHOLE = { configurationId: "c", version: "1", versionPending: false };

/**
 * Arm A and arm B, every pair of those four states, each with the reasons written out rather
 * than computed: a half-chosen arm is refused by its letter, never dropped from the request.
 */
const ARM_AXIS: Axis = [
  [{ arms: [EMPTY, EMPTY] }, [NO_ARM]],
  [{ arms: [EMPTY, READING] }, []],
  [{ arms: [EMPTY, HALF] }, [noArmVersion(1)]],
  [{ arms: [EMPTY, WHOLE] }, []],
  [{ arms: [READING, EMPTY] }, []],
  [{ arms: [READING, READING] }, []],
  [{ arms: [READING, HALF] }, [noArmVersion(1)]],
  [{ arms: [READING, WHOLE] }, []],
  [{ arms: [HALF, EMPTY] }, [noArmVersion(0)]],
  [{ arms: [HALF, READING] }, [noArmVersion(0)]],
  [{ arms: [HALF, HALF] }, [noArmVersion(0), noArmVersion(1)]],
  [{ arms: [HALF, WHOLE] }, [noArmVersion(0)]],
  [{ arms: [WHOLE, EMPTY] }, []],
  [{ arms: [WHOLE, READING] }, []],
  [{ arms: [WHOLE, HALF] }, [noArmVersion(1)]],
  [{ arms: [WHOLE, WHOLE] }, []],
];

const AXES: readonly Axis[] = [
  [
    [{ scenarioId: "", scenarioVersion: "", scenarioVersionPending: false }, [NO_SCENARIO]],
    // Its versions are being read: not chosen *yet*, which is a wait and refuses nothing.
    [{ scenarioId: "s", scenarioVersion: "", scenarioVersionPending: true }, []],
    [
      { scenarioId: "s", scenarioVersion: "", scenarioVersionPending: false },
      [NO_SCENARIO_VERSION],
    ],
    [{ scenarioId: "s", scenarioVersion: "1", scenarioVersionPending: false }, []],
  ],
  // The form's order (ADR 0064): scenario, arm A, arm B, name, seed.
  ARM_AXIS,
  [
    [{ label: "  " }, [NO_NAME]],
    // Empty to Python's `str.strip()`, which `require_label` reads, and not to `trim()`.
    [{ label: "\x85\x1c\u2028" }, [NO_NAME]],
    // Kept by `str.strip()`, so the lab stores it, though `trim()` would empty it.
    [{ label: "\ufeff" }, []],
    [{ label: "Prompt comparison" }, []],
  ],
  [
    [{ seed: "" }, [NO_SEED]],
    [{ seed: "-1" }, [SEED_OUT_OF_RANGE]],
    [{ seed: "42" }, []],
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
    // 4 · 16 · 4 · 3 · 3 · 2 · 2: a sweep that silently shrank would pass on nothing.
    expect(swept).toBe(9216);
  });

  it("waits for nothing once each cause is answered", () => {
    expect(
      startRefusals({
        scenarioId: "s",
        scenarioVersion: "1",
        scenarioVersionPending: false,
        seed: "0",
        label: "x",
        arms: [WHOLE, EMPTY],
        gateIssues: [GATE_WARNING],
        previewRefusal: null,
        unreachable: "",
      }),
    ).toEqual([]);
  });
});

describe("the request a start makes", () => {
  const base = { scenarioId: "s", scenarioVersion: "3", label: " Named ", seed: "42" };
  const arm = (configurationId: string, version: string) => ({ configurationId, version });

  it("carries every whole arm, in order, and leaves an empty arm B out", () => {
    expect(setupOf({ ...base, arms: [arm("a", "2"), arm("", "")] })).toEqual({
      label: "Named",
      scenario_id: "s",
      scenario_version: 3,
      seed: 42,
      arms: [{ configuration_id: "a", version: 2, label: "" }],
      participant_driver: "human",
    });
    expect(setupOf({ ...base, arms: [arm("a", "2"), arm("b", "1")] })?.arms).toEqual([
      { configuration_id: "a", version: 2, label: "" },
      { configuration_id: "b", version: 1, label: "" },
    ]);
  });

  it("sends the name as Python's `str.strip()` leaves it, which is what `require_label` keeps", () => {
    const label = "\x85 Named \x1f";
    expect(setupOf({ ...base, label, arms: [arm("a", "2")] })?.label).toBe("Named");
  });

  it.each([
    ["arm A half-chosen", [arm("a", ""), arm("b", "1")]],
    ["arm B half-chosen", [arm("a", "2"), arm("b", "")]],
    ["both half-chosen", [arm("a", ""), arm("b", "")]],
    ["no arm", [arm("", ""), arm("", "")]],
  ])("makes no request with %s, rather than one without it", (_, arms) => {
    expect(setupOf({ ...base, arms })).toBeNull();
  });

  it.each([
    ["no scenario", { scenarioId: "" }],
    ["no scenario version", { scenarioVersion: "" }],
  ])("makes no request with %s", (_, change) => {
    expect(setupOf({ ...base, ...change, arms: [arm("a", "2"), arm("", "")] })).toBeNull();
  });
});

describe("the name an experiment is proposed under", () => {
  const atlas = { configuration: "cfg-atlas", version: "4" };
  const beacon = { configuration: "cfg-beacon", version: "2" };
  const unversioned = { configuration: "cfg-beacon", version: "" };
  const none = { configuration: "", version: "" };

  it.each([
    [
      "Wrong shipping address",
      [atlas, beacon],
      "Wrong shipping address — cfg-atlas v4 vs cfg-beacon v2",
    ],
    ["Wrong shipping address", [atlas, none], "Wrong shipping address — cfg-atlas v4"],
    ["Wrong shipping address", [none, beacon], "Wrong shipping address — cfg-beacon v2"],
    ["Wrong shipping address", [atlas, unversioned], "Wrong shipping address — cfg-atlas v4"],
    ["Wrong shipping address", [none, none], "Wrong shipping address"],
    ["", [atlas, beacon], "cfg-atlas v4 vs cfg-beacon v2"],
    ["", [none, none], ""],
  ])("from %j and %j is %j", (scenario, arms, expected) => {
    expect(proposedExperimentName(scenario, arms)).toBe(expected);
  });

  it("never splits a character where it is cut", () => {
    // Units 199 and 200 are the emoji's two halves: it goes whole, or not at all.
    const cut = proposedExperimentName(`${"x".repeat(199)}😀`, [atlas, beacon]);
    expect(cut).toBe("x".repeat(199));
    expect(cut.length).toBeLessThanOrEqual(EXPERIMENT_LABEL_MAX_LENGTH);
    expect(proposedExperimentName(`${"x".repeat(198)}😀`, [atlas, beacon])).toBe(
      `${"x".repeat(198)}😀`,
    );
  });

  it("never ends on a separator where it is cut", () => {
    // The cut lands just after "—".
    expect(proposedExperimentName("x".repeat(197), [atlas, beacon])).toBe("x".repeat(197));
    // And just after "vs".
    const scenario = "x".repeat(200 - " — cfg-atlas v4 vs".length);
    expect(proposedExperimentName(scenario, [atlas, beacon])).toBe(`${scenario} — cfg-atlas v4`);
  });

  it("is never longer than the lab stores", () => {
    const long = proposedExperimentName("x".repeat(190), [atlas, beacon]);
    expect(long).toHaveLength(EXPERIMENT_LABEL_MAX_LENGTH);
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
