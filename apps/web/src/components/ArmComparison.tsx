import type { ComparisonVariableSchema } from "@agent-lab/contracts";
import { Link } from "react-router-dom";
import {
  type ArmValue,
  type Attribution,
  attributionOf,
  type ComparedExperiment,
  comparisonRows,
  hasArmsToCompare,
} from "../lib/comparison";
import type { SheetArm } from "../lib/sheet";
import { focusRingClasses } from "../lib/ui";
import { SameForEveryArm, SheetRow, SheetSection } from "./ArmSheet";

const ATTRIBUTION_CLASSES: Record<Attribution["tone"], string> = {
  attributable: "font-semibold text-lab-success",
  confounded: "font-semibold text-admin-draft-ink",
  none: "text-admin-muted",
  alone: "text-admin-muted",
};

/**
 * What the differences let an operator attribute, in one line. Only the attributable case
 * carries a mark: it is the one a result can be read against.
 */
export function AttributionLine({
  comparison,
}: {
  comparison: readonly ComparisonVariableSchema[];
}) {
  const attribution = attributionOf(comparison);
  return (
    <p className={`text-[12.5px] leading-relaxed ${ATTRIBUTION_CLASSES[attribution.tone]}`}>
      {attribution.tone === "attributable" ? <span aria-hidden>✓ </span> : null}
      <span>{attribution.text}</span>
    </p>
  );
}

/**
 * One arm's value: a link where it names a pinned version, and otherwise its text. The text is
 * always whole: a value that differs is the one a reader has to compare, and one every arm
 * shares is folded behind a disclosure a reader opens to read it.
 */
function Value({ value }: { value: ArmValue }) {
  return value.to ? (
    <Link
      className={`rounded font-semibold text-lab-ink underline-offset-2 hover:underline ${focusRingClasses}`}
      to={value.to}
      title={value.title}
    >
      {value.value}
    </Link>
  ) : (
    <span title={value.title}>{value.value}</span>
  );
}

/**
 * *Configuration*, on the results sheet (ADR 0080; sheet mockup :182–185): what the arms
 * differed on, in the setup matrix's words, read back on the run.
 *
 * The dimensions the arms differ on come first, each value whole in its arm's column, tinted and
 * marked *Differs* — the matrix's *Assessment* column said in the row instead. The others fold
 * under "N variables are the same for both arms", one value across the arms, drawn whole. One arm
 * has nothing to differ from or to share with, so every dimension is drawn in its column. What
 * the count of differences lets an operator attribute is said once, in *Outcome*, above the
 * evidence it governs.
 */
export function ConfigurationSection({
  experiment,
  shopId,
  arms,
}: {
  experiment: ComparedExperiment;
  shopId: string;
  arms: readonly SheetArm[];
}) {
  const rows = comparisonRows(experiment, shopId);
  const compared = hasArmsToCompare(experiment.comparison);
  const drawn = compared ? rows.filter((row) => row.differs) : rows;
  const folded = compared ? rows.filter((row) => !row.differs) : [];
  return (
    <SheetSection
      id="configuration"
      title="Configuration"
      note="What the arms differed on: each arm's value along every variable."
      arms={arms}
      labelHeader="Variable"
      after={
        <SameForEveryArm
          title="Configuration"
          labelHeader="Variable"
          noun={["variable", "variables"]}
          rows={folded.map((row) => ({
            key: row.dimension,
            label: row.label,
            value: row.shared ? (
              row.values[0] ? (
                <Value value={row.values[0]} />
              ) : null
            ) : (
              // Read alike by the server and spelled apart here: each arm's value on its line.
              <span className="grid gap-1">
                {row.values.map((value) => (
                  <span key={value.runId}>
                    {value.arm}: <Value value={value} />
                  </span>
                ))}
              </span>
            ),
          }))}
        />
      }
    >
      {drawn.map((row) => (
        <SheetRow
          key={row.dimension}
          label={row.label}
          differs={compared && row.differs}
          cellClassName={() => `whitespace-pre-line ${compared ? "font-semibold" : ""}`}
          cells={row.values.map((value) => <Value key={value.runId} value={value} />)}
        />
      ))}
    </SheetSection>
  );
}

/**
 * The bench's compact reading of the same rows: only the dimensions that differ, each arm's
 * whole value under its name, and the one line on what that lets the operator attribute.
 */
export function DifferenceList({
  experiment,
  shopId,
}: {
  experiment: ComparedExperiment;
  shopId: string;
}) {
  const differences = comparisonRows(experiment, shopId).filter((row) => row.differs);
  return (
    <div className="grid gap-2">
      {differences.length > 0 ? (
        <ul className="grid gap-1.5 text-[13px] text-admin-ink-soft">
          {differences.map((row) => (
            <li key={row.dimension}>
              <span className="font-semibold text-admin-ink">{row.label}</span>
              <ul className="grid gap-0.5 pl-3 text-xs">
                {row.values.map((value) => (
                  <li key={value.runId} className="whitespace-pre-line break-words">
                    {value.arm}: <Value value={value} />
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      ) : null}
      <AttributionLine comparison={experiment.comparison} />
    </div>
  );
}
