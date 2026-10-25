import type {
  ComparisonDimension,
  ExperimentResponse,
  ExperimentRunSchema,
  ResolvedDefinitionSchema,
} from "@agent-lab/contracts";
import { Link } from "react-router-dom";
import { COMPARISON_DIMENSION, DEFINITION_TYPE, describeValue, labelOf } from "../lib/enumLabels";
import { configurationChip } from "../lib/evidence";
import { neutralPillClasses, versionChipClasses } from "../lib/ui";
import { blockPinKey, usePinnedBlockNames } from "../lib/usePinnedBlockNames";
import { versionPath } from "../lib/versionLinks";
import { Fingerprint } from "./WorkspaceChrome";

/** A subheading inside the card: the rows below it are one kind of fact. */
const subheadClasses = "text-[11px] font-semibold uppercase tracking-wide text-admin-muted";

/**
 * What a run froze before it started, read off its record: the run it was derived from, the
 * starting state, the fingerprint of everything it resolved, who drove the customer, the
 * versions it pinned, and what each arm ran (ADR 0034, ADR 0038, ADR 0039).
 *
 * One body for the live bench's *Provenance* card and the results' rail, so the two cannot come
 * to describe one run differently. A pinned block is named by the name its version was
 * published under, read off that version, because a scenario composing three objective blocks
 * otherwise pins three *Objective block v1* nothing tells apart. On the results every version
 * opens what it pinned and the source run opens its results (ADR 0068); on the bench, which a
 * reviewer does not read, `linked` is false and nothing in the card is a link.
 */
export function RunProvenance({
  experiment,
  shopId,
  linked,
}: {
  experiment: ExperimentResponse;
  shopId: string;
  linked: boolean;
}) {
  // The scenario is pinned by the run itself; a sandbox input may pin it again, and one chip
  // per version is enough.
  const inputs = experiment.sandbox_inputs.filter(
    (pin) => !(pin.definition_type === "scenario" && pin.definition_id === experiment.scenario_id),
  );
  const names = usePinnedBlockNames([...inputs, ...experiment.arm_inputs.flat()]);
  const derived = experiment.derived_from;

  const chip = (pin: ResolvedDefinitionSchema, label: string, title?: string) => {
    const to = linked
      ? versionPath(pin.definition_type, pin.definition_id, pin.version, shopId)
      : null;
    return (
      <li key={`${pin.definition_type}:${pin.definition_id}`} className="max-w-full">
        {to === null ? (
          <span className={neutralPillClasses} title={title}>
            {label}
          </span>
        ) : (
          <Link className={`${versionChipClasses} inline-block max-w-full`} to={to} title={title}>
            {label}
          </Link>
        )}
      </li>
    );
  };

  const pinLabel = (pin: ResolvedDefinitionSchema, run?: ExperimentRunSchema) => {
    if (run !== undefined && pin.definition_id === run.agent_configuration_id) {
      return configurationChip(run.label, run.agent_configuration_name, pin.version);
    }
    const kind = describeValue(DEFINITION_TYPE, pin.definition_type);
    const name = names.get(blockPinKey(pin));
    return name ? `${kind} · ${name} v${pin.version}` : `${kind} v${pin.version}`;
  };

  return (
    <>
      {derived ? (
        <p className="text-[13px] text-admin-ink-soft">
          {`A ${derived.kind} of `}
          {linked ? (
            <Link
              className="font-semibold text-lab-ink"
              to={`/lab/bench/${shopId}/${derived.experiment_id}/results`}
            >
              {derived.label}
            </Link>
          ) : (
            <span className="font-semibold text-lab-ink">{derived.label}</span>
          )}
          {describeChange(derived.changed)}
        </p>
      ) : null}

      <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1 text-[13px] text-admin-ink-soft">
        <dt>Starting state</dt>
        <dd>
          <Fingerprint value={experiment.sandbox_fingerprint} />
        </dd>
        <dt>Inputs</dt>
        <dd>
          <Fingerprint value={experiment.resolution_fingerprint} />
        </dd>
        <dt>Participant</dt>
        <dd>{experiment.participant_driver} operator</dd>
      </dl>

      <div className="grid gap-1.5">
        <h3 className={subheadClasses}>Pinned</h3>
        <ul aria-label="What this run pinned" className="flex flex-wrap gap-1.5 text-[11.5px]">
          {chip(
            {
              definition_type: "scenario",
              definition_id: experiment.scenario_id,
              version: experiment.scenario_version,
              content_fingerprint: "",
            },
            `scenario v${experiment.scenario_version}`,
          )}
          {inputs.map((pin) => chip(pin, pinLabel(pin)))}
        </ul>
      </div>

      {experiment.runs.map((run, position) => {
        const pins = experiment.arm_inputs[position] ?? [];
        return pins.length === 0 ? null : (
          <div key={run.run_id} className="grid gap-1.5">
            <h3 className={subheadClasses}>{run.label}</h3>
            <ul
              aria-label={`What ${run.label} pinned`}
              className="flex flex-wrap gap-1.5 text-[11.5px]"
            >
              {pins.map((pin) =>
                chip(
                  pin,
                  pinLabel(pin, run),
                  linked && pin.definition_id === run.agent_configuration_id
                    ? `Open ${run.agent_configuration_name}, whose draft published v${pin.version}`
                    : undefined,
                ),
              )}
            </ul>
          </div>
        );
      })}
    </>
  );
}

/**
 * What a derivation moved from the run it came from, said where it names that run.
 *
 * Empty for a replay, which pins what its source pinned. More than one dimension is the
 * setup gate's comparison warning one level out: a fork that moved two things has no claim
 * that the thing it changed is the only thing that changed, so the sentence says so rather
 * than leaving it to be noticed months later.
 */
function describeChange(changed: ComparisonDimension[]) {
  if (changed.length === 0) {
    return null;
  }
  const named = changed.map((dimension) => labelOf(COMPARISON_DIMENSION, dimension)).join(", ");
  return changed.length === 1 ? (
    <span className="text-admin-muted">{` · changed ${named}`}</span>
  ) : (
    <span className="text-admin-draft-ink">
      {` · changed ${named} — no difference from that run can be attributed to any one of them`}
    </span>
  );
}
