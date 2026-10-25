import type { ComparisonVariableSchema } from "@agent-lab/contracts";
import { Link } from "react-router-dom";
import {
  type ArmValue,
  type Attribution,
  armsInOrder,
  attributionOf,
  type ComparedExperiment,
  comparisonRows,
  hasArmsToCompare,
} from "../lib/comparison";
import { focusRingClasses, tableCellClasses, tableHeadClasses } from "../lib/ui";

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
 * always whole here; only `ComparisonTable`'s shared values are shortened, and never a value that
 * differs, which is the one a reader has to compare.
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
 * Every dimension, each arm's value under the arm's name, and whether they differ: the results'
 * *What the arms differed on* (`Workspace.dc.html:2627–2640`), in the setup matrix's words —
 * *Variable*, *Assessment*, *Difference*, *Same* — because it is the same matrix read back on the
 * run. A dimension every arm reads alike holds one value across their columns, shortened with
 * the whole of it in `title`, because a long prompt written out twice is a second thing to
 * compare by eye for a fact the row already states. A value that differs is drawn whole: it is
 * the thing being compared. One arm has no Assessment column, since there is nothing to assess.
 */
export function ComparisonTable({
  experiment,
  shopId,
}: {
  experiment: ComparedExperiment;
  shopId: string;
}) {
  const rows = comparisonRows(experiment, shopId);
  const compared = hasArmsToCompare(experiment.comparison);
  return (
    <div className="grid gap-3">
      <table className="w-full table-fixed border-collapse text-[13px]">
        <caption className="sr-only">Each arm's value along every variable</caption>
        <thead>
          <tr>
            <th scope="col" className={`${tableHeadClasses} w-36`}>
              Variable
            </th>
            {armsInOrder(experiment).map((run) => (
              <th key={run.run_id} scope="col" className={tableHeadClasses}>
                {run.label}
              </th>
            ))}
            {compared ? (
              <th scope="col" className={`${tableHeadClasses} w-28`}>
                Assessment
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.dimension}>
              <th
                scope="row"
                className={`${tableCellClasses} text-left ${row.differs ? "font-semibold text-admin-ink" : "font-normal text-admin-ink-soft"}`}
              >
                {row.label}
              </th>
              {row.shared && !row.differs ? (
                <td
                  colSpan={row.values.length}
                  className={`${tableCellClasses} break-words text-admin-muted`}
                >
                  <span
                    className="line-clamp-2"
                    title={row.values[0]?.title ?? row.values[0]?.value}
                  >
                    {row.values[0] ? <Value value={row.values[0]} /> : null}
                  </span>
                </td>
              ) : (
                row.values.map((value) => (
                  <td
                    key={value.runId}
                    className={`${tableCellClasses} whitespace-pre-line break-words ${row.differs ? "font-semibold text-admin-ink" : "text-admin-ink-soft"}`}
                  >
                    <Value value={value} />
                  </td>
                ))
              )}
              {compared ? (
                <td
                  className={`${tableCellClasses} ${row.differs ? "font-semibold text-admin-draft-ink" : "text-admin-muted"}`}
                >
                  {row.differs ? "Difference" : "Same"}
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
      <AttributionLine comparison={experiment.comparison} />
    </div>
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
