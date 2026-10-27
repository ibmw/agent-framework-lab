import type {
  ComparisonDimension,
  ComparisonVariableSchema,
  ExperimentResponse,
} from "@agent-lab/contracts";
import { describeArchitecture, readableTerm } from "./agents";
import { COMPARISON_DIMENSION, labelOf } from "./enumLabels";
import { versionPath } from "./versionLinks";

/**
 * What the arms of one experiment differed on, read once for every surface that says it.
 *
 * The bench's *Comparison variables* card and the results' *What the arms differed on* card
 * read this module, so the two cannot disagree about which dimensions differ or about what that
 * lets an operator conclude. `experiment.comparison` carries one value per arm in the arms'
 * `position` order — `get_experiment` reads the runs ordered by position and compares their
 * pinned configurations in that order — so a value is labelled by the run at its position, and
 * `arm_inputs` (the resolution's arms, in the same order) holds what that arm pinned.
 */

/** The parts of an experiment this module reads. */
export type ComparedExperiment = Pick<ExperimentResponse, "comparison" | "runs" | "arm_inputs">;

/** One arm's value along one dimension, under the arm's own name. */
export interface ArmValue {
  /** The arm's run, which keys it: two arms may share a label, never a run. */
  runId: string;
  arm: string;
  value: string;
  /** The whole value where `value` shortens it, such as a support identity's full id. */
  title?: string;
  /** The page of the version this value names, where it names a pinned version. */
  to?: string;
}

/** One dimension of the comparison, as a reader reads it. */
export interface ComparisonRow {
  dimension: ComparisonDimension;
  /** The dimension as a row's header: the chip form, capitalised. */
  label: string;
  differs: boolean;
  values: ArmValue[];
  /** Every arm reads the same, so one value stands for all of them. */
  shared: boolean;
}

/** What the differences let an operator attribute, and how the line says it. */
export interface Attribution {
  tone: "attributable" | "confounded" | "none" | "alone";
  text: string;
}

/** The arms in the order the comparison's values follow. */
export function armsInOrder(experiment: Pick<ExperimentResponse, "runs">) {
  return [...experiment.runs].sort((left, right) => left.position - right.position);
}

/**
 * One value as the record holds it, spelled for a reader where the lab has its own word.
 *
 * The architecture and the tone-of-voice source are closed sets the lab spells; framework,
 * model, prompt, tools and a guideline are the record's own text, because the experiment carries
 * no other name for them. An empty value is a dash, as the setup matrix draws it: no tools is a
 * value, and a blank cell would read as unknown.
 */
export function describeComparisonValue(dimension: ComparisonDimension, value: string): string {
  if (value === "") {
    return "—";
  }
  switch (dimension) {
    case "architecture":
      return describeArchitecture(value);
    case "tone_of_voice":
      return value === "shop_default" ? readableTerm(value) : value;
    default:
      return value;
  }
}

/**
 * A support identity as the version this arm pinned — "v1 · aadf1767", opening its editor —
 * rather than a bare id: the version is frozen on the run, so naming it renames nothing, and two
 * identities both at v1 still read apart by their ids.
 */
function supportIdentityValue(
  experiment: ComparedExperiment,
  position: number,
  id: string,
  shopId: string,
): Pick<ArmValue, "value" | "title" | "to"> {
  const pin = experiment.arm_inputs[position]?.find(
    (entry) => entry.definition_type === "support_identity" && entry.definition_id === id,
  );
  if (!pin) {
    return { value: describeComparisonValue("support_identity", id) };
  }
  return {
    value: `v${pin.version} · ${id.slice(0, 8)}`,
    title: id,
    to: versionPath(pin.definition_type, pin.definition_id, pin.version, shopId) ?? undefined,
  };
}

function capitalised(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Every dimension, with each arm's value under the arm's name. */
export function comparisonRows(experiment: ComparedExperiment, shopId: string): ComparisonRow[] {
  const arms = armsInOrder(experiment);
  return experiment.comparison.map((variable) => {
    const values = variable.values.map((raw, position) => {
      const run = arms[position];
      return {
        runId: run?.run_id ?? String(position),
        arm: run?.label ?? `Arm ${position + 1}`,
        ...(variable.dimension === "support_identity" && raw !== ""
          ? supportIdentityValue(experiment, position, raw, shopId)
          : { value: describeComparisonValue(variable.dimension, raw) }),
      };
    });
    return {
      dimension: variable.dimension,
      label: capitalised(labelOf(COMPARISON_DIMENSION, variable.dimension)),
      differs: variable.differs,
      values,
      shared: values.length > 1 && values.every((entry) => entry.value === values[0]?.value),
    };
  });
}

/** Whether the comparison has a second arm to compare the first against. */
export function hasArmsToCompare(comparison: readonly ComparisonVariableSchema[]): boolean {
  return (comparison[0]?.values.length ?? 0) > 1;
}

/**
 * What the count of differences lets an operator conclude (ADR 0025's setup warning, read back
 * on the run): one difference is what makes a difference in behaviour attributable, two or more
 * make none of it attributable, and none leaves nothing to attribute. One arm has nothing to be
 * compared against, which is a true statement about the run rather than an agreement.
 */
export function attributionOf(comparison: readonly ComparisonVariableSchema[]): Attribution {
  if (!hasArmsToCompare(comparison)) {
    return { tone: "alone", text: "One arm ran, so there is nothing to compare it against." };
  }
  const differences = comparison.filter((variable) => variable.differs).length;
  if (differences === 0) {
    return {
      tone: "none",
      text: "No dimension differs, so nothing above can be attributed to a difference between the arms.",
    };
  }
  if (differences === 1) {
    return {
      tone: "attributable",
      text: "One difference, so the behavior above is attributable to it.",
    };
  }
  return {
    tone: "confounded",
    text: `${differences} differences — no behavior here can be attributed to any one of them.`,
  };
}
