import type { ExperimentResponse } from "@agent-lab/contracts";
import { describeChange, pinLabel, provenancePins } from "../lib/provenance";
import { neutralPillClasses } from "../lib/ui";
import { usePinnedBlockNames } from "../lib/usePinnedBlockNames";
import { Fingerprint } from "./WorkspaceChrome";

/** A subheading inside the card: the rows below it are one kind of fact. */
const subheadClasses = "text-[11px] font-semibold uppercase tracking-wide text-admin-muted";

/**
 * What a run froze before it started, read off its record on the live bench: the run it was
 * derived from, the starting state, the fingerprint of everything it resolved, who drove the
 * customer, the versions it pinned, and what each arm ran (ADR 0034, ADR 0038, ADR 0039).
 *
 * The results read the same record in their *Provenance* section (`ProvenanceSection`), and both
 * group the pins through one helper (`provenancePins`), so the two cannot come to describe one
 * run differently. A pinned block is named by the name its version was published under, read off
 * that version, because a scenario composing three objective blocks otherwise pins three
 * *Objective block v1* nothing tells apart. A run in progress is not what a reviewer reads, so
 * nothing here is a link; the results link every version to what it pinned (ADR 0068).
 */
export function RunProvenance({ experiment }: { experiment: ExperimentResponse }) {
  const pins = provenancePins(experiment);
  const names = usePinnedBlockNames([...pins.inputs, ...pins.arms.flat()]);
  const derived = experiment.derived_from;
  const change = derived ? describeChange(derived.changed) : null;

  const chip = (key: string, label: string) => (
    <li key={key} className="max-w-full">
      <span className={neutralPillClasses}>{label}</span>
    </li>
  );

  return (
    <>
      {derived ? (
        <p className="text-[13px] text-admin-ink-soft">
          {`A ${derived.kind} of `}
          <span className="font-semibold text-lab-ink">{derived.label}</span>
          {change === null ? null : (
            <span className={change.several ? "text-admin-draft-ink" : "text-admin-muted"}>
              {` · ${change.text}`}
            </span>
          )}
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
          {chip("scenario", `scenario v${experiment.scenario_version}`)}
          {pins.inputs.map((pin) =>
            chip(`${pin.definition_type}:${pin.definition_id}`, pinLabel(pin, names)),
          )}
        </ul>
      </div>

      {experiment.runs.map((run, position) => {
        const armPins = pins.arms[position] ?? [];
        return armPins.length === 0 ? null : (
          <div key={run.run_id} className="grid gap-1.5">
            <h3 className={subheadClasses}>{run.label}</h3>
            <ul
              aria-label={`What ${run.label} pinned`}
              className="flex flex-wrap gap-1.5 text-[11.5px]"
            >
              {armPins.map((pin) =>
                chip(`${pin.definition_type}:${pin.definition_id}`, pinLabel(pin, names, run)),
              )}
            </ul>
          </div>
        );
      })}
    </>
  );
}
