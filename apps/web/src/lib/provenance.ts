import type {
  ComparisonDimension,
  ExperimentResponse,
  ExperimentRunSchema,
  ResolvedDefinitionSchema,
} from "@agent-lab/contracts";
import { COMPARISON_DIMENSION, DEFINITION_TYPE, describeValue, labelOf } from "./enumLabels";
import { configurationChip } from "./evidence";
import { blockPinKey } from "./usePinnedBlockNames";

/**
 * What a run pinned, in the groups its provenance reads it in (ADR 0034, ADR 0068).
 *
 * One reading for the bench's *Provenance* card and the results' *Provenance* section, so the
 * two cannot come to group one run's pins differently: the scenario once, however often the
 * record lists it; the fixtures, every other pin that is not a block; the blocks; and each arm's
 * own inputs in the record's arm order.
 */
export interface ProvenancePins {
  /** The scenario version the run itself pins, as a pin of its own. */
  scenario: ResolvedDefinitionSchema;
  /** Every sandbox pin but the scenario, fixtures and blocks alike, in the record's order. */
  inputs: ResolvedDefinitionSchema[];
  /** The inputs that are not blocks: the shop, the ticket, the customer profile. */
  fixtures: ResolvedDefinitionSchema[];
  /** The inputs that are blocks, each named by the name its version was published under. */
  blocks: ResolvedDefinitionSchema[];
  /** Each arm's own pins, by the arm's index in `experiment.runs`. */
  arms: ResolvedDefinitionSchema[][];
}

/** The definition types that are blocks: the ones whose published version carries a name. */
const BLOCK_TYPES: ReadonlySet<string> = new Set(["objective_block", "mutation_block"]);

export function provenancePins(
  experiment: Pick<
    ExperimentResponse,
    "scenario_id" | "scenario_version" | "sandbox_inputs" | "arm_inputs" | "runs"
  >,
): ProvenancePins {
  // The scenario is pinned by the run itself; a sandbox input may pin it again, and one pin per
  // version is enough.
  const inputs = experiment.sandbox_inputs.filter(
    (pin) => !(pin.definition_type === "scenario" && pin.definition_id === experiment.scenario_id),
  );
  return {
    scenario: {
      definition_type: "scenario",
      definition_id: experiment.scenario_id,
      version: experiment.scenario_version,
      content_fingerprint: "",
    },
    inputs,
    fixtures: inputs.filter((pin) => !BLOCK_TYPES.has(pin.definition_type)),
    blocks: inputs.filter((pin) => BLOCK_TYPES.has(pin.definition_type)),
    arms: experiment.runs.map((_, position) => experiment.arm_inputs[position] ?? []),
  };
}

/** A pin's kind in words: "Objective block", "Shop", or the type itself where it is unknown. */
export function pinKind(pin: ResolvedDefinitionSchema): string {
  return describeValue(DEFINITION_TYPE, pin.definition_type);
}

/**
 * A pin as its chip or its link reads: an arm's configuration by its name and version, a block by
 * its kind and its published name where that has been read, anything else by its kind and version.
 */
export function pinLabel(
  pin: ResolvedDefinitionSchema,
  names: ReadonlyMap<string, string | null>,
  run?: ExperimentRunSchema,
): string {
  if (run !== undefined && pin.definition_id === run.agent_configuration_id) {
    return configurationChip(run.label, run.agent_configuration_name, pin.version);
  }
  const name = names.get(blockPinKey(pin));
  return name ? `${pinKind(pin)} · ${name} v${pin.version}` : `${pinKind(pin)} v${pin.version}`;
}

/**
 * What a derivation moved from the run it came from, in words: the dimensions it changed, and
 * whether there were several. Null for a replay, which pins what its source pinned.
 *
 * More than one dimension is the setup gate's comparison warning one level out: a fork that
 * moved two things has no claim that the thing it changed is the only thing that changed, so the
 * sentence says so rather than leaving it to be noticed months later.
 */
export function describeChange(
  changed: readonly ComparisonDimension[],
): { text: string; several: boolean } | null {
  if (changed.length === 0) {
    return null;
  }
  const named = changed.map((dimension) => labelOf(COMPARISON_DIMENSION, dimension)).join(", ");
  return changed.length === 1
    ? { text: `changed ${named}`, several: false }
    : {
        text: `changed ${named} — no difference from that run can be attributed to any one of them`,
        several: true,
      };
}
