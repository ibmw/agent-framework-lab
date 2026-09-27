import type {
  ArmEvaluationSchema,
  ArmStandingSchema,
  ExperimentRunSchema,
} from "@agent-lab/contracts";

/**
 * Where one arm stands while a long-running action touches it, and once it has ended.
 *
 * A closed set, so the queue can only say what this table says and `actionStatus.test.ts` can
 * hold every state to its words. `word` is what the arm's row reads, beside its name — the
 * prototype's "running…" and "completed earlier" (`Workspace.dc.html` :2540–:2541); `phrase` is
 * the same state in a sentence about the arm, which is how the settled queue reads aloud:
 * "Arm A is waiting for the customer · Arm B has completed" (:2396). `busy` says whether the
 * arm's own card is about to change, which is what `aria-busy` on that card claims.
 */
export const ARM_PROGRESS = {
  queued: { word: "waiting to run", phrase: "is waiting to run", busy: true },
  running: { word: "running…", phrase: "is running", busy: true },
  scoring: { word: "being scored…", phrase: "is being scored", busy: true },
  not_sent: { word: "not sent this turn", phrase: "was not sent this turn", busy: false },
  completed_earlier: { word: "completed earlier", phrase: "completed earlier", busy: false },
  could_not_run: { word: "could not be run", phrase: "could not be run", busy: false },
  awaiting_customer: {
    word: "waiting for the customer",
    phrase: "is waiting for the customer",
    busy: false,
  },
  awaiting_agent: {
    word: "waiting for the agent",
    phrase: "is waiting for the agent",
    busy: false,
  },
  awaiting_retry: {
    word: "no reply — waiting for a retry",
    phrase: "produced no reply and is waiting for a retry",
    busy: false,
  },
  completed: { word: "completed", phrase: "has completed", busy: false },
  scored: { word: "scored", phrase: "has been scored", busy: false },
  unscored: {
    word: "no verdict from the judge",
    phrase: "has no verdict from the judge",
    busy: false,
  },
} as const satisfies Record<string, { word: string; phrase: string; busy: boolean }>;

export type ArmProgress = keyof typeof ARM_PROGRESS;

/** One row of the queue: which arm, what it runs, and where it stands. */
export interface ActionStatusRow {
  key: string;
  /** The arm's name as the run gave it — "Arm A". */
  label: string;
  /** What the arm runs — "cfg-atlas v4". */
  detail: string;
  progress: ArmProgress;
}

/** What `ActionStatus` draws: the queue, and the sentence under it. */
export interface ActionStatusReport {
  rows: ActionStatusRow[];
  /** Read aloud with the rows whenever either changes. */
  summary: string;
  /** Whether the action is still in flight — the one state that says it cannot be cancelled. */
  running: boolean;
}

/** An action nothing has pressed: no rows, no sentence, nothing to announce. */
export const IDLE_REPORT: ActionStatusReport = { rows: [], summary: "", running: false };

/** The prototype's sentence for an action that calls a model (`Workspace.dc.html` :2543). */
export const TAKES_A_MINUTE = "This can take a minute and cannot be cancelled.";

/**
 * What a replay or a fork adds: it answers with a different run, which opens only where the
 * operator still is, and which History lists whatever they did meanwhile.
 */
export const DERIVATION_NOTE = `${TAKES_A_MINUTE} If you are still here when its arms are done, the new run opens; History lists it either way.`;

/** Freezing calls no model, so it claims no minute; it still cannot be stopped. */
export const FREEZE_NOTE = "This cannot be cancelled.";

/** The settled sentence: every arm's phrase, as the prototype's live card joins them. */
export function settledSentence(rows: readonly ActionStatusRow[]): string {
  return rows.map((row) => `${row.label} ${ARM_PROGRESS[row.progress].phrase}`).join(" · ");
}

/** The arm's settled state, read off the standing the backend served — never a count kept here. */
export function standingProgress(standing: ArmStandingSchema): ArmProgress {
  if (standing.awaiting === "completed") {
    return "completed";
  }
  if (standing.awaiting === "customer") {
    return "awaiting_customer";
  }
  return standing.attempts === 0 ? "awaiting_agent" : "awaiting_retry";
}

function rowOf(run: ExperimentRunSchema, progress: ArmProgress): ActionStatusRow {
  return {
    key: run.run_id,
    label: run.label,
    detail: `${run.agent_configuration_name} v${run.agent_configuration_version}`,
    progress,
  };
}

function arms(count: number): string {
  return count === 1 ? "1 arm" : `${count} arms`;
}

/**
 * The bench's one action in flight: a customer turn sent to some arms and each of them
 * advanced in turn, or one arm advanced on its own (`targets` of one, nothing delivered).
 *
 * The arms run one after another, so the queue is known here rather than guessed: the arm
 * being advanced is `current`, the ones before it are `done`, the ones after it wait.
 */
export interface BenchAction {
  /** The arms this action advances, in the order it advances them. */
  targets: readonly string[];
  /** The customer's message is being delivered, and no arm has been advanced yet. */
  delivering: boolean;
  /** The arm whose advance is in flight. */
  current: string | null;
  /** The arms whose advance has ended and whose record has been read again. */
  done: readonly string[];
  /** The arms whose advance the lab refused or could not answer. */
  failed: readonly string[];
  /** Every advance has ended and the record was read again after the last. */
  settled: boolean;
}

/**
 * The bench's queue: every arm of the experiment, each saying where it stands.
 *
 * While the action runs, an arm it does not reach says why it is still — "completed earlier",
 * or "not sent this turn" — and an arm it has finished says its standing, which was read again
 * the moment that arm ended. Once every arm has ended the queue is the standing of every arm,
 * which is the prototype's "Arm A is waiting for the customer · Arm B has completed".
 */
export function benchReport(
  runs: readonly ExperimentRunSchema[],
  action: BenchAction | null,
): ActionStatusReport {
  if (action === null) {
    return IDLE_REPORT;
  }
  const rows = runs.map((run): ActionStatusRow => {
    const reached = action.targets.includes(run.run_id);
    if (reached && action.failed.includes(run.run_id)) {
      return rowOf(run, "could_not_run");
    }
    if (action.settled || (reached && action.done.includes(run.run_id))) {
      return rowOf(run, standingProgress(run.standing));
    }
    if (!reached) {
      return rowOf(run, run.standing.awaiting === "completed" ? "completed_earlier" : "not_sent");
    }
    return rowOf(run, run.run_id === action.current ? "running" : "queued");
  });
  if (action.settled) {
    return { rows, summary: settledSentence(rows), running: false };
  }
  const summary = action.delivering
    ? `Sending the customer's message to ${arms(action.targets.length)}.`
    : `${action.current === null ? 0 : 1} of ${action.targets.length} running.`;
  return { rows, summary, running: true };
}

/**
 * A scoring pass: every arm is judged in the one request, so every arm is being scored until
 * it answers. Settled, each arm says whether the judge gave every row it owns a verdict — a
 * row whose execution failed carries a judgement with no outcome, and is not "scored".
 */
export function scoreReport(
  runs: readonly ExperimentRunSchema[],
  scoring: boolean,
  settled: readonly ArmEvaluationSchema[] | null,
): ActionStatusReport {
  if (scoring) {
    const rows = runs.map((run) => rowOf(run, "scoring"));
    return { rows, summary: `${rows.length} of ${rows.length} being scored.`, running: true };
  }
  if (settled === null) {
    return IDLE_REPORT;
  }
  const rows = runs.map((run) => {
    const arm = settled.find((entry) => entry.run_id === run.run_id);
    const judged = (arm?.objectives ?? []).filter((row) => row.assessment === "judge");
    const answered = judged.every((row) => row.judgement != null && row.judgement.failure == null);
    return rowOf(run, answered ? "scored" : "unscored");
  });
  return { rows, summary: settledSentence(rows), running: false };
}

/** A replay or a fork, from the press until the page it was pressed on has been told. */
export interface Derivation {
  kind: "replay" | "fork";
  /** The derived run's arms, at the version each will run. */
  arms: readonly ActionStatusRow[];
  /** The run being derived from, where the page is not that run's own. */
  subject?: string;
  /**
   * What the lab answered, once it has, where the page the operator now reads is not the one
   * the derivation was pressed on — so the answer is said here rather than opened over it.
   */
  answer?: { label: string } | { error: string };
}

/**
 * A replay or a fork: the lab runs every derived arm before it answers, and says nothing about
 * one arm until it answers about all of them — so every arm is running until it answers.
 * Answered while the operator reads another run, it says what came back instead of opening it.
 */
export function derivationReport(deriving: Derivation | null): ActionStatusReport {
  if (deriving === null) {
    return IDLE_REPORT;
  }
  const subject = deriving.subject ?? "this run";
  if (deriving.answer !== undefined) {
    return {
      rows: [],
      summary:
        "label" in deriving.answer
          ? `The ${deriving.kind} of ${subject} is ready: ${deriving.answer.label}.`
          : `The ${deriving.kind} of ${subject} could not be run: ${deriving.answer.error}`,
      running: false,
    };
  }
  const rows = deriving.arms.map((arm) => ({ ...arm, progress: "running" as const }));
  const verb = deriving.kind === "replay" ? "Replaying" : "Forking";
  return {
    rows,
    summary: `${verb} ${subject}: ${rows.length} of ${rows.length} running.`,
    running: true,
  };
}

/** The rows a derivation runs, read off the arms of the run it derives from. */
export function derivedRows(runs: readonly ExperimentRunSchema[]): ActionStatusRow[] {
  return runs.map((run) => rowOf(run, "running"));
}

/**
 * Freezing a published version: no arm is involved, so there is no queue — the sentence says
 * what is being frozen while it runs, and what was frozen once it has.
 */
export function freezeReport(
  frozen: { version: string; seed: string; fingerprint: string | null } | null,
): ActionStatusReport {
  if (frozen === null) {
    return IDLE_REPORT;
  }
  const what = `v${frozen.version} at seed ${frozen.seed}`;
  return frozen.fingerprint === null
    ? { rows: [], summary: `Freezing ${what}.`, running: true }
    : {
        rows: [],
        summary: `Froze ${what} as ${frozen.fingerprint.slice(0, 12)}….`,
        running: false,
      };
}
