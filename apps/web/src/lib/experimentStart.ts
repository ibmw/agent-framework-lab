import type { DefinitionIssueSchema, StartExperimentRequest } from "@agent-lab/contracts";
import { MAX_SEED } from "./fieldRules";
import { pythonStrip } from "./pythonText";

/**
 * Everything the lab would refuse a start for, read before the press.
 *
 * `start_experiment` refuses in three places, and each one is here:
 *
 * - **The request itself** (`StartExperimentRequest` in `presentation/experiments.py`): a
 *   scenario and a published version of it, a seed that is a whole number inside
 *   `MIN_SCENARIO_SEED`..`MAX_SCENARIO_SEED`, and one or two arms, each a configuration and one
 *   of its published versions. The page never sends an arm half-chosen: `setupOf` makes no
 *   request while one is, and an arm whose configuration is chosen and whose version is not —
 *   and is not being read — is refused by name rather than left out of the request.
 * - **The name** (`ExperimentService.start`, `require_label`): non-empty once trimmed — the
 *   page trims before it sends — and at most `MAX_LABEL_LENGTH`, which the field enforces as
 *   its `maxLength`. Trimmed as Python's `str.strip()` trims (`pythonStrip`): a name made only
 *   of a NEL or an information separator is empty to the lab, and not to JavaScript's `trim()`.
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

/** The arm's letter, as the form and the bench name it: A for the first. */
export function armLetter(position: number): string {
  return String.fromCharCode(65 + position);
}

/** An arm whose configuration is chosen and whose version is not: it is refused, never dropped. */
export function noArmVersion(position: number): string {
  return `Choose the published version arm ${armLetter(position)} runs.`;
}

/** Whether a typed seed is one the contract's `seed` carries: an integer in 0..`MAX_SEED`. */
export function isSeed(seed: string): boolean {
  if (seed.trim() === "") {
    return false;
  }
  const value = Number(seed);
  return Number.isInteger(value) && value >= 0 && value <= MAX_SEED;
}

/** One arm as the form holds it: a configuration, and the published version of it to pin. */
export interface ArmChoice {
  configurationId: string;
  version: string;
}

export interface StartState {
  scenarioId: string;
  scenarioVersion: string;
  /**
   * The chosen scenario's published versions are being read: its version is not chosen *yet*,
   * which is a wait rather than a refusal.
   */
  scenarioVersionPending: boolean;
  seed: string;
  label: string;
  /**
   * The name is the proposal, and a read the proposal is made from is still out: no name *yet*,
   * which is a wait rather than a refusal.
   */
  labelPending: boolean;
  /**
   * Every arm in the form, in order, and whether the chosen configuration's published versions
   * are still being read — which, like the scenario's, is a wait rather than a refusal.
   */
  arms: readonly (ArmChoice & { versionPending: boolean })[];
  /** The setup gate's findings for the setup as it stands, once it has answered for it. */
  gateIssues: readonly DefinitionIssueSchema[];
  /** The preview's own refusal of this setup, in the lab's words, where it refused it. */
  previewRefusal: string | null;
  /** The sentence naming a provider this lab cannot reach, or "" where every arm can run. */
  unreachable: string;
}

/**
 * Why Start would be refused, one sentence per cause, in the order the form asks for them —
 * scenario and its version, arm A, arm B, name, seed (ADR 0064) —
 * and every cause at once rather than the first, so an operator can see the whole way to a
 * start from wherever they are.
 */
export function startRefusals(state: StartState): string[] {
  const reasons: string[] = [];
  if (state.scenarioId === "") {
    reasons.push(NO_SCENARIO);
  } else if (state.scenarioVersion === "" && !state.scenarioVersionPending) {
    reasons.push(NO_SCENARIO_VERSION);
  }
  if (state.arms.every((arm) => arm.configurationId === "")) {
    reasons.push(NO_ARM);
  }
  state.arms.forEach((arm, position) => {
    if (arm.configurationId !== "" && arm.version === "" && !arm.versionPending) {
      reasons.push(noArmVersion(position));
    }
  });
  if (pythonStrip(state.label) === "" && !state.labelPending) {
    reasons.push(NO_NAME);
  }
  if (state.seed.trim() === "") {
    reasons.push(NO_SEED);
  } else if (!isSeed(state.seed)) {
    reasons.push(SEED_OUT_OF_RANGE);
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

/**
 * The request a start would make, or null while the operator has not chosen enough for one.
 *
 * An arm left empty is not in the request: arm B is optional. An arm whose configuration is
 * chosen and whose version is not makes no request at all, rather than a request without it —
 * a start that quietly ran one arm of the two on screen would be a different experiment from
 * the one composed. `startRefusals` says which arm it is.
 */
export function setupOf({
  scenarioId,
  scenarioVersion,
  arms,
  label,
  seed,
}: {
  scenarioId: string;
  scenarioVersion: string;
  arms: readonly ArmChoice[];
  label: string;
  seed: string;
}): StartExperimentRequest | null {
  if (scenarioId === "" || scenarioVersion === "") {
    return null;
  }
  if (arms.some((arm) => arm.configurationId !== "" && arm.version === "")) {
    return null;
  }
  const chosen = arms.filter((arm) => arm.configurationId !== "");
  if (chosen.length === 0) {
    return null;
  }
  return {
    label: pythonStrip(label),
    scenario_id: scenarioId,
    scenario_version: Number(scenarioVersion),
    seed: Number(seed),
    arms: chosen.map((arm) => ({
      configuration_id: arm.configurationId,
      version: Number(arm.version),
      label: "",
    })),
    // The only driver implemented, and stated rather than defaulted: which participant drove
    // a run is recorded evidence, not a fallback the operator never chose.
    participant_driver: "human",
  };
}

/**
 * The name an experiment is proposed under: the scenario, then each whole arm's configuration
 * and version — "Wrong shipping address — cfg-atlas v4 vs cfg-beacon v2", the prototype's
 * shape (`Workspace.dc.html`, the setup's `expName`) with the configuration named as the lab
 * names it. An arm whose version is not chosen yet is not in it. Cut to the length the lab
 * stores, so a proposal is never a name the lab refuses — by whole characters, and never
 * ending on a separator.
 */
export function proposedExperimentName(
  scenario: string,
  arms: readonly { configuration: string; version: string }[],
): string {
  const pinned = arms
    .filter((arm) => arm.configuration !== "" && arm.version !== "")
    .map((arm) => `${arm.configuration} v${arm.version}`)
    .join(" vs ");
  const name = [scenario, pinned].filter((part) => part !== "").join(" — ");
  // Cut by code point, so a character is kept whole or not at all, and never past the lab's
  // length in UTF-16 units; then a separator the cut left hanging goes with the space before it.
  let cut = "";
  for (const character of Array.from(name)) {
    if (cut.length + character.length > EXPERIMENT_LABEL_MAX_LENGTH) {
      break;
    }
    cut += character;
  }
  return cut === name ? name.trim() : cut.replace(/(\s+(—|vs))+\s*$/u, "").trim();
}
