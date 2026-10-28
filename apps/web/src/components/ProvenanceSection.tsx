import type {
  ExperimentResponse,
  ExperimentRunSchema,
  ResolvedDefinitionSchema,
} from "@agent-lab/contracts";
import { type ReactNode, useState } from "react";
import { Link } from "react-router-dom";
import { armsInOrder } from "../lib/comparison";
import { configurationChip } from "../lib/evidence";
import { describeChange, pinKind, provenancePins } from "../lib/provenance";
import type { SheetArm } from "../lib/sheet";
import {
  sheetCellEmptyClasses,
  sheetCopyStatusClasses,
  sheetDerivedChangeClasses,
  sheetFingerprintRowClasses,
  sheetLinkKindClasses,
  sheetLinkListClasses,
  sheetLinkRowClasses,
  sheetSentenceClasses,
  sheetValueLinkClasses,
  subtleButtonClasses,
} from "../lib/ui";
import { blockPinKey, usePinnedBlockNames } from "../lib/usePinnedBlockNames";
import { versionPath } from "../lib/versionLinks";
import { SheetRow, SheetSection, SheetSpanningRow } from "./ArmSheet";
import { Fingerprint } from "./WorkspaceChrome";

/**
 * *Provenance*, the sheet's sixth section (ADR 0080; sheet mockup :195–223): what this run froze
 * before it started, a fact a row (ADR 0034, ADR 0038, ADR 0039).
 *
 * Spanning rows for what is the run's — the run it was derived from, the starting state and the
 * inputs' fingerprints with a press that copies each, who drove the customer, the scenario and
 * its fixtures, the blocks by their published names — then each arm's own versions in its
 * column. Every version opens what it pinned and the source run opens its results (ADR 0068). The
 * bench's card groups the same pins through the same helper (`provenancePins`), so the two never
 * describe one run differently.
 */
export function ProvenanceSection({
  experiment,
  shopId,
  arms,
}: {
  experiment: ExperimentResponse;
  shopId: string;
  arms: SheetArm[];
}) {
  const pins = provenancePins(experiment);
  const names = usePinnedBlockNames([...pins.inputs, ...pins.arms.flat()]);
  const derived = experiment.derived_from;
  const change = derived ? describeChange(derived.changed) : null;
  // The sheet's columns are in the arms' order; the record's arm inputs are by the arm's index
  // in `runs`, so each column reads its own arm's pins by that index rather than by its own.
  const runs = armsInOrder(experiment);
  const armPins = runs.map((run) => pins.arms[experiment.runs.indexOf(run)] ?? []);

  // A version this build has no editor for stays the words it was rather than a link to nowhere.
  const pinned = (pin: ResolvedDefinitionSchema, label: string, title?: string) => {
    const to = versionPath(pin.definition_type, pin.definition_id, pin.version, shopId);
    return to === null ? (
      <span>{label}</span>
    ) : (
      <Link className={sheetValueLinkClasses} to={to} title={title}>
        {label}
      </Link>
    );
  };

  return (
    <SheetSection
      id="provenance"
      title="Provenance"
      note="Every arm was cloned from one snapshot, so the arms began at the same fingerprint and moved apart only when something wrote."
      arms={arms}
      labelHeader="Fact"
      tour="results-provenance"
    >
      {derived ? (
        <SheetSpanningRow label="Derived from">
          <div>
            {`A ${derived.kind} of `}
            <Link
              className={sheetValueLinkClasses}
              to={`/lab/bench/${shopId}/${derived.experiment_id}/results`}
            >
              {derived.label}
            </Link>
          </div>
          {change === null ? null : (
            <div className={sheetDerivedChangeClasses[change.several ? "several" : "one"]}>
              {change.text}
            </div>
          )}
        </SheetSpanningRow>
      ) : null}
      <SheetSpanningRow label="Starting state">
        <div className={sheetFingerprintRowClasses}>
          <Fingerprint value={experiment.sandbox_fingerprint} />
          <CopyFingerprint value={experiment.sandbox_fingerprint} name="starting-state" />
        </div>
      </SheetSpanningRow>
      <SheetSpanningRow label="Inputs">
        <div className={sheetFingerprintRowClasses}>
          <Fingerprint value={experiment.resolution_fingerprint} />
          <CopyFingerprint value={experiment.resolution_fingerprint} name="inputs" />
        </div>
      </SheetSpanningRow>
      <SheetSpanningRow label="Participant">
        <div className={sheetSentenceClasses}>{experiment.participant_driver} operator</div>
      </SheetSpanningRow>
      <SheetSpanningRow label="Scenario and fixtures">
        <ul className={sheetLinkRowClasses}>
          <li>{pinned(pins.scenario, `${pinKind(pins.scenario)} v${pins.scenario.version}`)}</li>
          {pins.fixtures.map((pin) => (
            <li key={`${pin.definition_type}:${pin.definition_id}`}>
              {pinned(pin, `${pinKind(pin)} v${pin.version}`)}
            </li>
          ))}
        </ul>
      </SheetSpanningRow>
      <SheetSpanningRow label="Blocks">
        {pins.blocks.length === 0 ? (
          <div className={sheetCellEmptyClasses}>None</div>
        ) : (
          <ul className={sheetLinkListClasses}>
            {pins.blocks.map((pin) => {
              // By the name its version was published under; until that is read, or where it
              // cannot be, by its kind and version, which the record already carries.
              const name = names.get(blockPinKey(pin));
              return (
                <li key={`${pin.definition_type}:${pin.definition_id}`}>
                  {pinned(
                    pin,
                    name ? `${name} v${pin.version}` : `${pinKind(pin)} v${pin.version}`,
                  )}
                  {name ? (
                    <span className={sheetLinkKindClasses}>{pinKind(pin).toLowerCase()}</span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </SheetSpanningRow>
      <SheetRow
        label="Each arm's versions"
        cells={runs.map((run, index) => (
          <ArmVersions
            key={run.run_id}
            run={run}
            pins={armPins[index] ?? []}
            names={names}
            pinned={pinned}
          />
        ))}
      />
    </SheetSection>
  );
}

/** One arm's own pins in its column: its configuration by name, then its identity. */
function ArmVersions({
  run,
  pins,
  names,
  pinned,
}: {
  run: ExperimentRunSchema;
  pins: ResolvedDefinitionSchema[];
  names: ReadonlyMap<string, string | null>;
  pinned: (pin: ResolvedDefinitionSchema, label: string, title?: string) => ReactNode;
}) {
  if (pins.length === 0) {
    return <div className={sheetCellEmptyClasses}>None</div>;
  }
  return (
    <ul className={sheetLinkListClasses}>
      {pins.map((pin) => {
        const configuration = pin.definition_id === run.agent_configuration_id;
        const name = names.get(blockPinKey(pin));
        const label = configuration
          ? configurationChip(run.label, run.agent_configuration_name, pin.version)
          : name
            ? `${name} v${pin.version}`
            : `${pinKind(pin)} v${pin.version}`;
        return (
          <li key={`${pin.definition_type}:${pin.definition_id}`}>
            {pinned(
              pin,
              label,
              // The editor names only the latest published version, so the link says which
              // version this arm pinned (ADR 0068).
              configuration
                ? `Open ${run.agent_configuration_name}, whose draft published v${pin.version}`
                : undefined,
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * A press that copies one fingerprint whole, named for it, and says in a polite status that it
 * did — or that the browser refused, since a copy that silently did nothing is a fingerprint
 * pasted wrong somewhere else. The value drawn beside it is cut to twelve characters; its
 * `title` holds the rest.
 */
function CopyFingerprint({ value, name }: { value: string; name: string }) {
  const [said, setSaid] = useState("");
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setSaid(`Copied the ${name} fingerprint.`);
    } catch {
      setSaid("This browser refused the copy.");
    }
  };
  return (
    <>
      <button
        type="button"
        className={subtleButtonClasses}
        aria-label={`Copy the ${name} fingerprint`}
        onClick={() => void copy()}
      >
        Copy
      </button>
      {/* Drawn before it says anything, so the status is in the page when its words change. */}
      <span role="status" className={sheetCopyStatusClasses}>
        {said}
      </span>
    </>
  );
}
