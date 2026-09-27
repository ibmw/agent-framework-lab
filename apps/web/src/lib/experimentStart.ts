import type { DefinitionIssueSchema } from "@agent-lab/contracts";
import { MAX_SEED } from "./fieldRules";

/**
 * Everything the lab would refuse a start for, read before the press.
 *
 * `start_experiment` refuses in three places, and each one is here:
 *
 * - **The request itself** (`StartExperimentRequest` in `presentation/experiments.py`): a
 *   scenario and a published version of it, a seed that is a whole number inside
 *   `MIN_SCENARIO_SEED`..`MAX_SCENARIO_SEED`, and one or two arms, each a configuration and one
 *   of its published versions. The page never sends an arm half-chosen — `setupOf` leaves it out
 *   — so "no arm" is what is left to refuse.
 * - **The name** (`ExperimentService.start`, `require_label`): non-empty once trimmed — the
 *   page trims before it sends — and at most `MAX_LABEL_LENGTH`, which the field enforces as
 *   its `maxLength`.
 * - **The setup gate** (`ExperimentService._gate`, which `previewExperiment` runs with the same
 *   rules): every **error** it raises, in its own words, and a refusal of the preview itself —
 *   a scenario version not published in this shop, an arm version that does not exist — which
 *   the start would answer identically.
 *
 * One refusal is the machine's rather than the lab's: an arm pinned to a provider this lab
 * cannot reach starts, and its first advance is refused (ADR 0053). It is said with the rest,
 * because Start is where it is prevented.
 *
 * Not here, because nothing before the press can know it: `materialize`'s own gate, re-run
 * against the shop's orders as they read at the moment of the start (ADR 0019). A start it
 * refuses still answers with its findings under the form.
 *
 * The request's own conditions are said in the page's words: the lab's answers there are the
 * contract's generic validation messages, or name padding the page never sends. The gate's
 * findings are the gate's sentences, character for character.
 */

/** `MAX_LABEL_LENGTH` in `domain/content.py`, which `require_label` enforces on the name. */
export const EXPERIMENT_LABEL_MAX_LENGTH = 200;

export const NO_SCENARIO = "Choose the scenario to run.";

export const NO_SCENARIO_VERSION = "Choose a published version of the scenario.";

export const NO_SEED = "Enter the seed this experiment's starting state is frozen with.";

export const SEED_OUT_OF_RANGE = `Enter a seed that is a whole number between 0 and ${MAX_SEED}.`;

export const NO_NAME = "Name the experiment so it can be found again beside the ones before it.";

export const NO_ARM = "Choose at least one agent configuration and the published version to run.";

/** Whether a typed seed is one the contract's `seed` carries: an integer in 0..`MAX_SEED`. */
export function isSeed(seed: string): boolean {
  if (seed.trim() === "") {
    return false;
  }
  const value = Number(seed);
  return Number.isInteger(value) && value >= 0 && value <= MAX_SEED;
}

export interface StartState {
  scenarioId: string;
  scenarioVersion: string;
  seed: string;
  label: string;
  /** Arms with both a configuration and a published version chosen. */
  chosenArms: number;
  /** The setup gate's findings for the setup as it stands, once it has answered for it. */
  gateIssues: readonly DefinitionIssueSchema[];
  /** The preview's own refusal of this setup, in the lab's words, where it refused it. */
  previewRefusal: string | null;
  /** The sentence naming a provider this lab cannot reach, or "" where every arm can run. */
  unreachable: string;
}

/**
 * Why Start would be refused, one sentence per cause, in the order the form asks for them —
 * and every cause at once rather than the first, so an operator can see the whole way to a
 * start from wherever they are.
 */
export function startRefusals(state: StartState): string[] {
  const reasons: string[] = [];
  if (state.scenarioId === "") {
    reasons.push(NO_SCENARIO);
  } else if (state.scenarioVersion === "") {
    reasons.push(NO_SCENARIO_VERSION);
  }
  if (state.seed.trim() === "") {
    reasons.push(NO_SEED);
  } else if (!isSeed(state.seed)) {
    reasons.push(SEED_OUT_OF_RANGE);
  }
  if (state.label.trim() === "") {
    reasons.push(NO_NAME);
  }
  if (state.chosenArms === 0) {
    reasons.push(NO_ARM);
  }
  for (const issue of state.gateIssues) {
    if (issue.severity === "error") {
      reasons.push(issue.message);
    }
  }
  if (state.previewRefusal !== null) {
    reasons.push(state.previewRefusal);
  }
  if (state.unreachable !== "") {
    reasons.push(state.unreachable);
  }
  return reasons;
}
