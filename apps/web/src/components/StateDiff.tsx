import type { ExperimentResponse, ExperimentRunSchema } from "@agent-lab/contracts";
import { ChevronDown, ChevronRight, TriangleAlert } from "lucide-react";
import { useId, useState } from "react";
import { changeValue, writeKey, writeLabel, writesOf } from "../lib/evidence";
import {
  type Assessment,
  type ComparedOrder,
  type ComparedRow,
  compareOrders,
  summarizeGroups,
} from "../lib/stateDiff";
import { focusRingClasses } from "../lib/ui";
import { Fingerprint } from "./WorkspaceChrome";

/**
 * Every arm's state diff, read as a difference: each arm's writes and one summary line per
 * order it moved, then each order with the arms side by side behind a disclosure that holds
 * every path the backend served (ADR 0035). The grouping and the side-by-side reading are the
 * lab's; the frame lists paths (`docs/design-direction.md`, *Departures*).
 */
export function BusinessStateComparison({ experiment }: { experiment: ExperimentResponse }) {
  const orders = compareOrders(experiment.runs);
  return (
    <div className="grid gap-4 text-[13px]">
      <ul className="grid gap-3 sm:grid-cols-[repeat(auto-fit,minmax(16rem,1fr))]">
        {experiment.runs.map((run) => (
          <ArmState key={run.run_id} experiment={experiment} run={run} orders={orders} />
        ))}
      </ul>
      {orders.map((order) => (
        <OrderComparison key={order.orderId} order={order} />
      ))}
    </div>
  );
}

/**
 * What moved one arm, a line per order on what that moved, and where its world stands now.
 *
 * The writes say who moved it and the summary what about it moved — a revision counter is
 * true of a redirected order and of a corrected typo alike (ADR 0035).
 */
function ArmState({
  experiment,
  run,
  orders,
}: {
  experiment: ExperimentResponse;
  run: ExperimentRunSchema;
  orders: ComparedOrder[];
}) {
  const writes = writesOf(experiment, run);
  const { other } = run.state_diff;
  const moved = orders.flatMap((order) =>
    order.arms
      .filter((arm) => arm.run.run_id === run.run_id && arm.count > 0)
      .map((arm) => ({ order, groups: arm.groups })),
  );
  return (
    <li className="grid content-start gap-0.5">
      <span className="font-semibold text-lab-ink">{run.label}</span>
      {writes.length === 0 ? (
        <span className="text-xs text-admin-muted">
          Nothing wrote — this arm's world is the one it started in.
        </span>
      ) : (
        writes.map((event) => (
          <span key={writeKey(event)} className="text-xs text-admin-muted">
            {writeLabel(event)} · r{event.revision_before} → r{event.revision_after}
          </span>
        ))
      )}
      {moved.map(({ order, groups }) => (
        <span key={order.orderId} className="mt-1 text-xs text-admin-ink-soft">
          <span className="font-semibold text-lab-ink">{order.reference}</span> ·{" "}
          {summarizeGroups(groups)}
        </span>
      ))}
      {other.length > 0 ? (
        // Static rather than an alert: it was on the record when the page loaded, and nothing
        // announced it changing. The glyph and the words carry it, never the colour alone.
        <span className="flex items-start gap-1 text-xs font-semibold text-lab-error">
          <TriangleAlert
            size={13}
            aria-hidden="true"
            focusable="false"
            className="mt-px flex-none"
          />
          <span>
            Changed outside every order:{" "}
            {other
              .map(
                (change) =>
                  `${change.path}: ${changeValue(change.before)} → ${changeValue(change.after)}`,
              )
              .join(", ")}
          </span>
        </span>
      ) : null}
      <span className="text-xs text-admin-muted">
        Now at r{run.revision} · <Fingerprint value={run.state_fingerprint} /> · started from{" "}
        <Fingerprint value={run.snapshot_fingerprint} />
        {other.length === 0 && moved.length > 0 ? " · no other state changed" : null}
      </span>
    </li>
  );
}

/** "Both arms", or "All 3 arms". */
function armsPhrase(count: number): string {
  return count === 2 ? "Both arms" : `All ${count} arms`;
}

/** "1 field", "17 fields". */
function counted(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** How many paths a sentence names before it counts the rest. */
const NAMED_PATHS = 5;

/** A list of paths, the first few named and the rest counted: "a, b, c, d, e and 6 more". */
function pathList(paths: readonly string[]): string {
  if (paths.length <= NAMED_PATHS) {
    return paths.join(", ");
  }
  return `${paths.slice(0, NAMED_PATHS).join(", ")} and ${paths.length - NAMED_PATHS} more`;
}

/**
 * The one sentence that says what the arms' diffs of one order have in common, and what it set
 * aside: a value shown for every arm and not compared is counted here, so "the same values"
 * never stands for more than it checked.
 */
function comparisonSentence(order: ComparedOrder): string | null {
  const count = order.arms.length;
  if (count < 2) {
    return null;
  }
  if (order.table === null) {
    const unshared = order.unshared
      .map(({ run, paths }) =>
        count === 2
          ? `Only ${run.label} changed ${pathList(paths)}.`
          : `${run.label} changed what not every arm did: ${pathList(paths)}.`,
      )
      .join(" ");
    return `The arms changed different fields, so each keeps its own column. ${unshared}`;
  }
  const rows = order.table.flatMap((group) => group.rows);
  const fields = counted(rows.length, "field");
  const differing = rows.filter((row) => row.assessment === "differs");
  const timestamps = rows.filter((row) => row.assessment === "timestamp").length;
  const identifiers = rows.filter((row) => row.assessment === "identifier").length;
  const setAside = [
    timestamps > 0 ? counted(timestamps, "timestamp") : null,
    identifiers > 0 ? counted(identifiers, "event identifier") : null,
  ].filter((part) => part !== null);
  const notCompared = setAside.join(" and ");
  if (differing.length > 0) {
    const differ = `${armsPhrase(count)} changed the same ${fields}, and differ on ${differing.length}: ${pathList(differing.map((row) => row.path))}.`;
    return notCompared ? `${differ} Not compared: ${notCompared}.` : differ;
  }
  const same = `${armsPhrase(count)} changed the same ${fields} to the same values`;
  const verb = timestamps + identifiers === 1 ? "is" : "are";
  return notCompared
    ? `${same}, apart from ${notCompared}, which ${verb} not compared.`
    : `${same}.`;
}

/**
 * One order as the arms left it: a sentence, the rows the arms differ on, and every changed
 * field behind a disclosure — in one table when the arms changed the same fields, otherwise a
 * column per arm.
 */
function OrderComparison({ order }: { order: ComparedOrder }) {
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  const sentence = comparisonSentence(order);
  const differing = (order.table ?? [])
    .map((group) => ({ ...group, rows: group.rows.filter((row) => row.assessment === "differs") }))
    .filter((group) => group.rows.length > 0);
  return (
    <div className="grid gap-1.5">
      <span className="font-semibold text-lab-ink">{order.reference}</span>
      {sentence ? <p className="text-xs text-admin-ink-soft">{sentence}</p> : null}
      {differing.length > 0 ? (
        <FieldTable
          order={order}
          groups={differing}
          caption={`Where the arms differ on ${order.reference}`}
        />
      ) : null}
      <button
        type="button"
        aria-expanded={open}
        aria-controls={open ? bodyId : undefined}
        onClick={() => setOpen(!open)}
        className={`flex w-fit items-center gap-1 rounded text-left text-xs font-semibold text-admin-ink-soft hover:text-admin-ink ${focusRingClasses}`}
      >
        {open ? (
          <ChevronDown size={12} aria-hidden="true" focusable="false" className="flex-none" />
        ) : (
          <ChevronRight size={12} aria-hidden="true" focusable="false" className="flex-none" />
        )}
        Every changed field of {order.reference} ({order.fields})
      </button>
      {open ? (
        <div id={bodyId} className="grid gap-2">
          {order.table ? (
            <>
              <FieldTable
                order={order}
                groups={order.table}
                caption={`Every field of ${order.reference} each arm changed`}
              />
              {order.table.some((group) =>
                group.rows.some(
                  (row) => row.assessment === "timestamp" || row.assessment === "identifier",
                ),
              ) ? (
                <p className="text-xs text-admin-muted">
                  A moment the run's own clock wrote, or the name an address change gives the event
                  it writes, is shown for every arm and not compared: each arm ran at its own
                  moments, and the name hashes the arm's own state.
                </p>
              ) : null}
            </>
          ) : (
            <ArmColumns order={order} />
          )}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The table's head and cells, a step tighter than an index's `tableHeadClasses`: the card is one
 * column of the results' grid. Each arm's column keeps a minimum width, so at narrow widths the
 * table scrolls inside its wrapper rather than breaking a value mid-word.
 */
const headClasses =
  "border-b border-admin-border px-2 py-2 text-left text-xs font-semibold text-admin-muted";
const cellClasses = "border-b border-admin-border/60 px-2 py-1.5 align-top break-words";

const ASSESSMENT_WORDS: Record<Assessment, string> = {
  differs: "Difference",
  same: "Same",
  timestamp: "Not compared",
  identifier: "Not compared",
};

/** The arms side by side, a row per path, the rows grouped by the path's first segment. */
function FieldTable({
  order,
  groups,
  caption,
}: {
  order: ComparedOrder;
  groups: NonNullable<ComparedOrder["table"]>;
  caption: string;
}) {
  const compared = order.arms.length > 1;
  const columns = order.arms.length + 2 + (compared ? 1 : 0);
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-xs">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col" className={headClasses}>
              Field
            </th>
            <th scope="col" className={`${headClasses} min-w-[7rem]`}>
              Was
            </th>
            {order.arms.map(({ run }) => (
              <th key={run.run_id} scope="col" className={`${headClasses} min-w-[9rem]`}>
                {run.label}
              </th>
            ))}
            {compared ? (
              <th scope="col" className={headClasses}>
                Assessment
              </th>
            ) : null}
          </tr>
        </thead>
        {groups.map((group) => (
          <tbody key={group.key}>
            <tr>
              <th
                scope="rowgroup"
                colSpan={columns}
                className={`${cellClasses} text-left font-semibold text-lab-ink first-letter:uppercase`}
              >
                {group.label}
              </th>
            </tr>
            {group.rows.map((row) => (
              <ComparedRowView
                key={row.path}
                row={row}
                runIds={order.arms.map(({ run }) => run.run_id)}
                compared={compared}
              />
            ))}
          </tbody>
        ))}
      </table>
    </div>
  );
}

/**
 * One path across the arms. "Was" holds the value every arm started from; where the arms
 * started from different values — which one snapshot cannot produce — each arm's cell says
 * both sides instead, so nothing is hidden behind a shared column.
 */
function ComparedRowView({
  row,
  runIds,
  compared,
}: {
  row: ComparedRow;
  runIds: string[];
  compared: boolean;
}) {
  const sharedBefore = new Set(row.before).size === 1;
  const differs = row.assessment === "differs";
  return (
    <tr>
      <th scope="row" className={`${cellClasses} text-left font-mono font-normal`}>
        {row.path}
      </th>
      <td className={`${cellClasses} text-admin-muted`}>
        {sharedBefore ? changeValue(row.before[0] ?? null) : "per arm"}
      </td>
      {row.after.map((after, index) => (
        <td
          key={runIds[index]}
          className={`${cellClasses} ${differs ? "font-semibold text-admin-ink" : "text-admin-ink-soft"}`}
        >
          {sharedBefore
            ? changeValue(after)
            : `${changeValue(row.before[index] ?? null)} → ${changeValue(after)}`}
        </td>
      ))}
      {compared ? (
        <td
          className={`${cellClasses} whitespace-nowrap ${differs ? "font-semibold text-admin-draft-ink" : "text-admin-muted"}`}
        >
          {differs ? <span aria-hidden="true">≠ </span> : null}
          {ASSESSMENT_WORDS[row.assessment]}
        </td>
      ) : null}
    </tr>
  );
}

/** Each arm's own column, grouped, where the arms did not change the same fields. */
function ArmColumns({ order }: { order: ComparedOrder }) {
  return (
    <ul className="grid gap-3 sm:grid-cols-[repeat(auto-fit,minmax(16rem,1fr))]">
      {order.arms.map(({ run, groups, count }) => (
        <li key={run.run_id} className="grid content-start gap-1">
          <span className="text-xs font-semibold text-lab-ink">{run.label}</span>
          {count === 0 ? (
            <span className="text-xs text-admin-muted">No field of this order changed.</span>
          ) : (
            groups.map((group) => (
              <dl key={group.key} className="grid gap-0.5">
                <dt className="text-xs font-semibold text-admin-ink-soft first-letter:uppercase">
                  {group.label}
                </dt>
                {group.changes.map((change) => (
                  <dd key={change.path} className="break-words text-xs text-admin-muted">
                    {change.path}: {changeValue(change.before)} →{" "}
                    <span className="text-lab-ink">{changeValue(change.after)}</span>
                  </dd>
                ))}
              </dl>
            ))
          )}
        </li>
      ))}
    </ul>
  );
}
