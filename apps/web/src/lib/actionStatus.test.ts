import type {
  ArmAwaiting,
  ArmEvaluationSchema,
  ExperimentRunSchema,
  JudgementSchema,
  ObjectiveResultSchema,
} from "@agent-lab/contracts";
import { describe, expect, it } from "vitest";
import {
  ARM_PROGRESS,
  type ArmProgress,
  type BenchAction,
  benchReport,
  derivationReport,
  derivedRows,
  freezeReport,
  IDLE_REPORT,
  scoreReport,
  settledSentence,
  standingProgress,
} from "./actionStatus";

/**
 * Every state an arm can be reported in, and the words each one reads.
 *
 * Written out rather than read back off the table, so a word that changes is a word somebody
 * changed on purpose. The two the prototype draws are its own: "running…" and "completed
 * earlier" on the queue's rows (`Workspace.dc.html` :2540–:2541), and the settled sentence's
 * "is waiting for the customer" and "has completed" (:2396).
 */
const WORDS: Record<ArmProgress, [word: string, phrase: string, busy: boolean]> = {
  queued: ["waiting to run", "is waiting to run", true],
  running: ["running…", "is running", true],
  scoring: ["being scored…", "is being scored", true],
  not_sent: ["not sent this turn", "was not sent this turn", false],
  completed_earlier: ["completed earlier", "completed earlier", false],
  could_not_run: ["could not be run", "could not be run", false],
  awaiting_customer: ["waiting for the customer", "is waiting for the customer", false],
  awaiting_agent: ["waiting for the agent", "is waiting for the agent", false],
  awaiting_retry: [
    "no reply — waiting for a retry",
    "produced no reply and is waiting for a retry",
    false,
  ],
  completed: ["completed", "has completed", false],
  scored: ["scored", "has been scored", false],
  unscored: ["no verdict from the judge", "has no verdict from the judge", false],
};

describe("the states an arm is reported in", () => {
  it("are exactly these, each with its words and whether its card is about to change", () => {
    expect(Object.keys(ARM_PROGRESS).sort()).toEqual(Object.keys(WORDS).sort());
    for (const [state, [word, phrase, busy]] of Object.entries(WORDS)) {
      expect(ARM_PROGRESS[state as ArmProgress], state).toEqual({ word, phrase, busy });
    }
  });

  it("settle into the prototype's sentence", () => {
    expect(
      settledSentence([
        { key: "a", label: "Arm A", detail: "cfg-atlas v4", progress: "awaiting_customer" },
        { key: "b", label: "Arm B", detail: "cfg-beacon v2", progress: "completed" },
      ]),
    ).toBe("Arm A is waiting for the customer · Arm B has completed");
  });
});

const AWAITING: ArmAwaiting[] = ["agent", "customer", "completed"];

describe("an arm's settled state", () => {
  it("is read off the standing, for every awaiting and every count of attempts", () => {
    const seen = new Map<string, ArmProgress>();
    for (const awaiting of AWAITING) {
      for (const attempts of [0, 1, 2]) {
        seen.set(
          `${awaiting}/${attempts}`,
          standingProgress({ awaiting, attempts, ordinal: 0, unanswered: [] }),
        );
      }
    }
    expect(Object.fromEntries(seen)).toEqual({
      "agent/0": "awaiting_agent",
      "agent/1": "awaiting_retry",
      "agent/2": "awaiting_retry",
      "customer/0": "awaiting_customer",
      "customer/1": "awaiting_customer",
      "customer/2": "awaiting_customer",
      "completed/0": "completed",
      "completed/1": "completed",
      "completed/2": "completed",
    });
  });
});

function run(
  id: string,
  label: string,
  awaiting: ArmAwaiting,
  attempts = 0,
  name = `cfg-${id}`,
): ExperimentRunSchema {
  return {
    run_id: id,
    label,
    agent_configuration_name: name,
    agent_configuration_version: 3,
    standing: { awaiting, attempts, ordinal: 1, unanswered: [] },
  } as unknown as ExperimentRunSchema;
}

/** Every subset of a list, in order, the empty one included. */
function subsets<T>(items: readonly T[]): T[][] {
  return items.reduce<T[][]>(
    (all, item) => [...all, ...all.map((subset) => [...subset, item])],
    [[]],
  );
}

/**
 * Every bench action two arms can be in, over every pair of standings: each non-empty set of
 * arms reached; delivering, then each arm in turn running with the ones before it done — some
 * of those failed — and finally settled with any of them failed.
 */
function everyBenchCase() {
  const standings: [ArmAwaiting, number][] = [
    ["agent", 0],
    ["agent", 1],
    ["customer", 0],
    ["completed", 0],
  ];
  const cases: { runs: ExperimentRunSchema[]; action: BenchAction }[] = [];
  for (const [awaitingA, attemptsA] of standings) {
    for (const [awaitingB, attemptsB] of standings) {
      const runs = [
        run("a", "Arm A", awaitingA, attemptsA),
        run("b", "Arm B", awaitingB, attemptsB),
      ];
      for (const targets of subsets(["a", "b"]).filter((subset) => subset.length > 0)) {
        const base = { targets, current: null, done: [], failed: [], settled: false };
        cases.push({ runs, action: { ...base, delivering: true } });
        targets.forEach((current, position) => {
          const done = targets.slice(0, position);
          for (const failed of subsets(done)) {
            cases.push({
              runs,
              action: { ...base, delivering: false, current, done, failed },
            });
          }
        });
        for (const failed of subsets(targets)) {
          cases.push({
            runs,
            action: { ...base, delivering: false, done: targets, failed, settled: true },
          });
        }
      }
    }
  }
  return cases;
}

describe("the bench's queue", () => {
  it("says nothing before anything is pressed", () => {
    expect(benchReport([run("a", "Arm A", "agent")], null)).toEqual(IDLE_REPORT);
  });

  const cases = everyBenchCase();

  it("covers every case it claims to", () => {
    // 16 pairs of standings × (one arm: 1 delivering + 1 running + 2 settled, twice; both arms:
    // 1 delivering + 1 + 2 running + 4 settled) = 16 × (4 + 4 + 8).
    expect(cases).toHaveLength(16 * 16);
  });

  it("names every arm once, in the order they are drawn, with what it runs", () => {
    for (const { runs, action } of cases) {
      const report = benchReport(runs, action);
      expect(report.rows.map((row) => [row.key, row.label, row.detail])).toEqual([
        ["a", "Arm A", "cfg-a v3"],
        ["b", "Arm B", "cfg-b v3"],
      ]);
    }
  });

  it("says where each arm stands while the action runs", () => {
    for (const { runs, action } of cases.filter((entry) => !entry.action.settled)) {
      const report = benchReport(runs, action);
      const label = JSON.stringify(action);
      expect(report.running, label).toBe(true);
      runs.forEach((arm, index) => {
        const progress = report.rows[index].progress;
        if (!action.targets.includes(arm.run_id)) {
          // An arm this action does not reach says why it is still.
          expect(progress, label).toBe(
            arm.standing.awaiting === "completed" ? "completed_earlier" : "not_sent",
          );
        } else if (action.failed.includes(arm.run_id)) {
          expect(progress, label).toBe("could_not_run");
        } else if (action.done.includes(arm.run_id)) {
          // Ended, and read again: where it stands now.
          expect(progress, label).toBe(standingProgress(arm.standing));
        } else if (arm.run_id === action.current) {
          expect(progress, label).toBe("running");
        } else {
          expect(progress, label).toBe("queued");
        }
      });
      // At most one arm runs at a time, and exactly one once delivery is over.
      const runningRows = report.rows.filter((row) => row.progress === "running");
      expect(runningRows.length, label).toBe(action.delivering ? 0 : 1);
      expect(report.summary, label).toBe(
        action.delivering
          ? `Sending the customer's message to ${action.targets.length === 1 ? "1 arm" : "2 arms"}.`
          : `1 of ${action.targets.length} running.`,
      );
    }
  });

  it("says where every arm stands once the action has ended, in one sentence", () => {
    for (const { runs, action } of cases.filter((entry) => entry.action.settled)) {
      const report = benchReport(runs, action);
      const label = JSON.stringify(action);
      expect(report.running, label).toBe(false);
      runs.forEach((arm, index) => {
        expect(report.rows[index].progress, label).toBe(
          action.failed.includes(arm.run_id) ? "could_not_run" : standingProgress(arm.standing),
        );
      });
      expect(
        report.rows.some((row) => ARM_PROGRESS[row.progress].busy),
        label,
      ).toBe(false);
      expect(report.summary, label).toBe(settledSentence(report.rows));
    }
  });

  it("reads the evidence the slice names: which arm is running, then both done", () => {
    const waiting = [run("a", "Arm A", "agent"), run("b", "Arm B", "agent")];
    const aDone = [run("a", "Arm A", "customer"), run("b", "Arm B", "agent")];
    const bothDone = [run("a", "Arm A", "customer"), run("b", "Arm B", "completed")];
    const targets = ["a", "b"];
    const base = { targets, failed: [], settled: false };
    const words = (runs: ExperimentRunSchema[], action: BenchAction) =>
      benchReport(runs, action).rows.map((row) => ARM_PROGRESS[row.progress].word);

    expect(words(waiting, { ...base, delivering: true, current: null, done: [] })).toEqual([
      "waiting to run",
      "waiting to run",
    ]);
    expect(words(waiting, { ...base, delivering: false, current: "a", done: [] })).toEqual([
      "running…",
      "waiting to run",
    ]);
    expect(words(aDone, { ...base, delivering: false, current: "b", done: ["a"] })).toEqual([
      "waiting for the customer",
      "running…",
    ]);
    const settled = benchReport(bothDone, {
      ...base,
      delivering: false,
      current: null,
      done: targets,
      settled: true,
    });
    expect(settled.summary).toBe("Arm A is waiting for the customer · Arm B has completed");
  });
});

function judged(runId: string, judgements: (JudgementSchema | null)[]): ArmEvaluationSchema {
  return {
    run_id: runId,
    settled: false,
    met: 0,
    decided: 0,
    failed: false,
    objectives: [
      { assessment: "deterministic", judgement: null } as unknown as ObjectiveResultSchema,
      ...judgements.map(
        (judgement) => ({ assessment: "judge", judgement }) as unknown as ObjectiveResultSchema,
      ),
    ],
  };
}

const VERDICT = { outcome: "met", failure: null } as unknown as JudgementSchema;
const FAILED = { outcome: null, failure: "timeout" } as unknown as JudgementSchema;

describe("a scoring pass", () => {
  const runs = [run("a", "Arm A", "customer"), run("b", "Arm B", "completed")];

  it("says nothing before one, and every arm is being scored while it runs", () => {
    expect(scoreReport(runs, false, null)).toEqual(IDLE_REPORT);
    const report = scoreReport(runs, true, null);
    expect(report.rows.map((row) => row.progress)).toEqual(["scoring", "scoring"]);
    expect(report.summary).toBe("2 of 2 being scored.");
    expect(report.running).toBe(true);
    // A pass in flight is what the rows say, whatever the last one answered.
    expect(scoreReport(runs, true, [judged("a", [VERDICT])]).rows[0].progress).toBe("scoring");
  });

  it("says, once it answers, whether the judge gave every row it owns a verdict", () => {
    const cases: [(JudgementSchema | null)[], ArmProgress][] = [
      [[], "scored"],
      [[VERDICT], "scored"],
      [[VERDICT, VERDICT], "scored"],
      [[FAILED], "unscored"],
      [[VERDICT, FAILED], "unscored"],
      [[null], "unscored"],
      [[VERDICT, null], "unscored"],
    ];
    for (const [judgements, expected] of cases) {
      const report = scoreReport(runs, false, [judged("a", judgements), judged("b", [VERDICT])]);
      expect(
        report.rows.map((row) => row.progress),
        JSON.stringify(judgements),
      ).toEqual([expected, "scored"]);
      expect(report.running).toBe(false);
      expect(report.summary).toBe(settledSentence(report.rows));
    }
  });
});

describe("a replay or a fork", () => {
  const runs = [run("a", "Arm A", "customer"), run("b", "Arm B", "completed")];

  it("says nothing unless one runs", () => {
    expect(derivationReport(null)).toEqual(IDLE_REPORT);
  });

  it("runs every derived arm until the new run opens", () => {
    for (const kind of ["replay", "fork"] as const) {
      const report = derivationReport({ kind, arms: derivedRows(runs) });
      expect(report.rows.map((row) => [row.label, row.progress])).toEqual([
        ["Arm A", "running"],
        ["Arm B", "running"],
      ]);
      expect(report.running).toBe(true);
      expect(report.summary).toBe(
        `${kind === "replay" ? "Replaying" : "Forking"} this run: 2 of 2 running.`,
      );
    }
    expect(
      derivationReport({ kind: "fork", arms: derivedRows(runs), subject: "Tone comparison" })
        .summary,
    ).toBe("Forking Tone comparison: 2 of 2 running.");
  });
});

describe("a replay or a fork answered while the operator reads another run", () => {
  const runs = [run("a", "Arm A", "customer"), run("b", "Arm B", "completed")];

  it("says what came back, or why nothing did, with no queue and nothing still running", () => {
    expect(
      derivationReport({
        kind: "replay",
        arms: derivedRows(runs),
        subject: "Tone comparison",
        answer: { label: "Tone comparison (replay)" },
      }),
    ).toEqual({
      rows: [],
      summary: "The replay of Tone comparison is ready: Tone comparison (replay).",
      running: false,
    });
    expect(
      derivationReport({
        kind: "fork",
        arms: derivedRows(runs),
        subject: "Tone comparison",
        answer: { error: "no runtime here" },
      }),
    ).toEqual({
      rows: [],
      summary: "The fork of Tone comparison could not be run: no runtime here",
      running: false,
    });
  });
});

describe("freezing a version", () => {
  it("says what it freezes while it runs and what it froze once it has, with no queue", () => {
    expect(freezeReport(null)).toEqual(IDLE_REPORT);
    expect(freezeReport({ version: "2", seed: "7", fingerprint: null })).toEqual({
      rows: [],
      summary: "Freezing v2 at seed 7.",
      running: true,
    });
    expect(freezeReport({ version: "2", seed: "7", fingerprint: "0123456789abcdef" })).toEqual({
      rows: [],
      summary: "Froze v2 at seed 7 as 0123456789ab….",
      running: false,
    });
  });
});
