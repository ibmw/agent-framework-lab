import type {
  ExperimentResponse,
  ExperimentRunSchema,
  MutationEventSchema,
  ToolEventSchema,
} from "@agent-lab/contracts";
import { ChevronDown, ChevronRight, TriangleAlert } from "lucide-react";
import { Fragment, useId, useState } from "react";
import { changeValue, writeKey, writesOf } from "../lib/evidence";
import type { SheetArm } from "../lib/sheet";
import {
  type Assessment,
  type ComparedOrder,
  type ComparedRow,
  compareOrders,
  groupPhrase,
  groupsChanged,
} from "../lib/stateDiff";
import {
  sheetAssessmentClasses,
  sheetCellAlertClasses,
  sheetCellDetailClasses,
  sheetCellEmptyClasses,
  sheetCellLineClasses,
  sheetCellPairClasses,
  sheetCodeClasses,
  sheetDisclosureButtonClasses,
  sheetDisclosureClasses,
  sheetDisclosureNoteClasses,
  sheetFieldValueClasses,
  sheetGroupHeadingClasses,
  sheetGroupLabelClasses,
  sheetGroupNoteClasses,
  sheetLabelDetailClasses,
  sheetLabelLinesClasses,
} from "../lib/ui";
import {
  SheetBody,
  SheetHeadingRow,
  SheetRow,
  SheetSection,
  SheetSpanningRow,
  SheetTable,
} from "./ArmSheet";
import { Fingerprint } from "./WorkspaceChrome";

/**
 * *Business state*, verified rather than claimed (ADR 0035, ADR 0080; sheet mockup :176–180): a
 * row per fact, each arm's value in its column, one fact per line — what wrote, each order it
 * moved and its groups, anything changed outside every order, and where its world stands now —
 * then a spanning row per order saying what the arms' diffs have in common, the rows they differ
 * on, and every changed field behind a disclosure.
 *
 * The grouping and the side-by-side reading are the lab's; the frame lists paths
 * (`docs/design-direction.md`, *Departures*). Every path the backend served stays one press away.
 */
export function BusinessStateSection({
  experiment,
  runs,
  arms,
}: {
  experiment: ExperimentResponse;
  /** The arms' runs in the sheet's order, one per column. */
  runs: ExperimentRunSchema[];
  arms: SheetArm[];
}) {
  const orders = compareOrders(runs);
  const writes = runs.map((run) => writesOf(experiment, run));
  const faults = writes.map((events) => events.filter((event) => !("tool" in event)));
  const calls = writes.map((events) => events.filter((event) => "tool" in event));
  const outside = runs.some((run) => run.state_diff.other.length > 0);
  return (
    <SheetSection
      id="state"
      title="Business state"
      note="Verified, not claimed: read from each arm's own state rather than from what its agent said it did."
      arms={arms}
      labelHeader="Fact"
      tour="results-state"
      after={orders.map((order) => <OrderFields key={order.orderId} order={order} />)}
    >
      {faults.some((events) => events.length > 0) ? (
        <WriteRow label={["Scenario fault", "Scenario faults"]} writes={faults} />
      ) : null}
      {calls.some((events) => events.length > 0) ? (
        <WriteRow label={["Agent write", "Agent writes"]} writes={calls} />
      ) : null}
      {orders.map((order) => (
        <SheetRow
          key={order.orderId}
          label={`Order ${order.reference}`}
          cells={order.arms.map(({ run, groups, count }) =>
            count === 0 ? (
              <span key={run.run_id} className={sheetCellEmptyClasses}>
                No field of this order changed.
              </span>
            ) : (
              <Fragment key={run.run_id}>
                <span>{groupsChanged(groups)}</span>
                {groups.map((group) => (
                  <span
                    key={group.key}
                    className={`${sheetCellLineClasses} first-letter:uppercase`}
                  >
                    {groupPhrase(group)}
                  </span>
                ))}
              </Fragment>
            ),
          )}
        />
      ))}
      {outside ? (
        <SheetRow
          label="Changed outside every order"
          cells={runs.map((run) =>
            run.state_diff.other.length === 0 ? (
              <span key={run.run_id} className={sheetCellEmptyClasses}>
                Nothing
              </span>
            ) : (
              // Static rather than an alert: it was on the record when the page loaded, and
              // nothing announced it changing. The glyph and the words carry it, never the
              // colour alone.
              <Fragment key={run.run_id}>
                {run.state_diff.other.map((change) => (
                  <span key={change.path} className={sheetCellAlertClasses}>
                    <TriangleAlert
                      size={13}
                      aria-hidden="true"
                      focusable="false"
                      className="mt-0.5 flex-none"
                    />
                    <span>
                      {change.path}: {changeValue(change.before)} → {changeValue(change.after)}
                    </span>
                  </span>
                ))}
              </Fragment>
            ),
          )}
        />
      ) : null}
      <SheetRow
        label="Fingerprint now"
        cells={runs.map((run, index) => {
          const moved = orders.some((order) =>
            order.arms.some((arm) => arm.run.run_id === run.run_id && arm.count > 0),
          );
          return (
            <Fragment key={run.run_id}>
              <span>
                <Fingerprint value={run.state_fingerprint} />
              </span>
              <span className={sheetCellLineClasses}>Revision r{run.revision}</span>
              <span className={sheetCellLineClasses}>
                Started from <Fingerprint value={run.snapshot_fingerprint} />
              </span>
              {writes[index]?.length === 0 ? (
                <span className={sheetCellDetailClasses}>
                  Nothing wrote — this arm's world is the one it started in.
                </span>
              ) : run.state_diff.other.length === 0 && moved ? (
                <span className={sheetCellDetailClasses}>No other state changed.</span>
              ) : null}
            </Fragment>
          );
        })}
      />
      {orders.map((order) => {
        const sentence = comparisonSentence(order);
        return sentence ? (
          <SheetSpanningRow
            key={order.orderId}
            label={orders.length === 1 ? "Compared" : `Compared: ${order.reference}`}
          >
            <span>{sentence}</span>
          </SheetSpanningRow>
        ) : null;
      })}
    </SheetSection>
  );
}

/**
 * The writes of one kind, each arm's in its column: each write's name over the revision it moved
 * the arm's world across. The scenario's own faults are writers beside the tools: two arms at
 * different revisions is only explainable when both writers are on the page.
 */
function WriteRow({
  label,
  writes,
}: {
  label: readonly [string, string];
  writes: (ToolEventSchema | MutationEventSchema)[][];
}) {
  const many = writes.some((events) => events.length > 1);
  return (
    <SheetRow
      label={many ? label[1] : label[0]}
      cells={writes.map((events, index) =>
        events.length === 0 ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: one cell per arm, in the arms' order.
          <span key={index} className={sheetCellEmptyClasses}>
            None
          </span>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: one cell per arm, in the arms' order.
          <Fragment key={index}>
            {events.map((event) => (
              <span key={writeKey(event)} className={sheetCellPairClasses}>
                <span className={sheetCodeClasses}>
                  {"tool" in event ? event.tool : event.mutation_id}
                </span>
                <span className={sheetCellLineClasses}>
                  Revision r{event.revision_before} → r{event.revision_after}
                </span>
              </span>
            ))}
          </Fragment>
        ),
      )}
    />
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
 * One order's fields under the section's rows: the rows the arms differ on, drawn on load, then
 * every changed field behind a disclosure — in one table when the arms changed the same fields,
 * otherwise each arm's own changes in its column.
 */
function OrderFields({ order }: { order: ComparedOrder }) {
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  const differing = (order.table ?? [])
    .map((group) => ({ ...group, rows: group.rows.filter((row) => row.assessment === "differs") }))
    .filter((group) => group.rows.length > 0);
  const setAside = (order.table ?? []).some((group) =>
    group.rows.some((row) => row.assessment === "timestamp" || row.assessment === "identifier"),
  );
  return (
    <>
      {differing.length > 0 ? (
        <div className="grid">
          <h3 className={sheetGroupHeadingClasses}>Where the arms differ on {order.reference}</h3>
          <FieldTable
            order={order}
            groups={differing}
            caption={`Where the arms differ on ${order.reference}`}
          />
        </div>
      ) : null}
      <div className={sheetDisclosureClasses}>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={open ? bodyId : undefined}
          onClick={() => setOpen(!open)}
          className={sheetDisclosureButtonClasses}
        >
          {open ? (
            <ChevronDown size={14} aria-hidden="true" focusable="false" className="flex-none" />
          ) : (
            <ChevronRight size={14} aria-hidden="true" focusable="false" className="flex-none" />
          )}
          Every changed field of {order.reference} ({order.fields})
        </button>
      </div>
      {open ? (
        <div id={bodyId} className="grid">
          {order.table ? (
            <>
              <FieldTable
                order={order}
                groups={order.table}
                caption={`Every field of ${order.reference} each arm changed`}
              />
              {setAside ? (
                <div className={sheetDisclosureNoteClasses}>
                  <p className={sheetGroupNoteClasses}>
                    A moment the run's own clock wrote, or the name an address change gives the
                    event it writes, is shown for every arm and not compared: each arm ran at its
                    own moments, and the name hashes the arm's own state.
                  </p>
                </div>
              ) : null}
            </>
          ) : (
            <ArmColumns order={order} />
          )}
        </div>
      ) : null}
    </>
  );
}

const ASSESSMENT_WORDS: Record<Assessment, string> = {
  differs: "Difference",
  same: "Same",
  timestamp: "Not compared",
  identifier: "Not compared",
};

/**
 * The arms side by side on the sheet's rows, a row per path under a row naming its group (the
 * path's first segment), and an *Assessment* column the table adds after the arms' where there
 * is more than one arm to compare. On the sheet's rows, so at a phone's width it stacks as every
 * section does rather than scrolling inside the page.
 */
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
  return (
    <SheetTable
      label={caption}
      labelHeader="Field and what it was"
      extra={compared ? "Assessment" : undefined}
    >
      {groups.map((group) => (
        <SheetBody key={group.key}>
          <SheetHeadingRow>{group.label}</SheetHeadingRow>
          {group.rows.map((row) => (
            <ComparedRowView key={row.path} row={row} compared={compared} />
          ))}
        </SheetBody>
      ))}
    </SheetTable>
  );
}

/**
 * One path across the arms. Its row header is the path over the value every arm started from —
 * "Was" drawn before it and not heard, since the column's header says it, so the row is named
 * field, starting value, each arm's value, assessment. Where the arms started from different
 * values — which one snapshot cannot produce — each arm's cell says both sides instead, so
 * nothing is hidden behind a shared value.
 */
function ComparedRowView({ row, compared }: { row: ComparedRow; compared: boolean }) {
  const sharedBefore = new Set(row.before).size === 1;
  const tone = row.assessment === "differs" ? "differs" : "other";
  return (
    <SheetRow
      label={
        <div className={sheetLabelLinesClasses}>
          <div className={`${sheetCodeClasses} font-normal`}>{row.path}</div>
          <div className={sheetLabelDetailClasses}>
            <span aria-hidden="true">Was </span>
            {sharedBefore ? changeValue(row.before[0] ?? null) : "per arm"}
          </div>
        </div>
      }
      cells={row.after.map((after, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: one cell per arm, in the arms' order.
        <span key={index} className={sheetFieldValueClasses[tone]}>
          {sharedBefore
            ? changeValue(after)
            : `${changeValue(row.before[index] ?? null)} → ${changeValue(after)}`}
        </span>
      ))}
      extra={
        compared ? (
          <span className={sheetAssessmentClasses[tone]}>
            {tone === "differs" ? <span aria-hidden="true">≠ </span> : null}
            {ASSESSMENT_WORDS[row.assessment]}
          </span>
        ) : undefined
      }
    />
  );
}

/**
 * Where the arms did not change the same fields: a row per group any arm changed, and in each
 * arm's column the paths it changed there, each over what it was and what it became.
 */
function ArmColumns({ order }: { order: ComparedOrder }) {
  const keys = [...new Set(order.arms.flatMap((arm) => arm.groups.map((group) => group.key)))];
  return (
    <SheetTable label={`Every field of ${order.reference} each arm changed`}>
      <SheetBody>
        {keys.map((key) => {
          const label = order.arms
            .flatMap((arm) => arm.groups)
            .find((group) => group.key === key)?.label;
          return (
            <SheetRow
              key={key}
              label={<span className={sheetGroupLabelClasses}>{label}</span>}
              cells={order.arms.map(({ run, groups }) => {
                const changes = groups.find((group) => group.key === key)?.changes ?? [];
                return changes.length === 0 ? (
                  <span key={run.run_id} className={sheetCellEmptyClasses}>
                    Nothing in this group changed.
                  </span>
                ) : (
                  <Fragment key={run.run_id}>
                    {changes.map((change) => (
                      <span key={change.path} className={sheetCellPairClasses}>
                        <span className={sheetCodeClasses}>{change.path}</span>
                        <span className={sheetCellLineClasses}>
                          {changeValue(change.before)} → {changeValue(change.after)}
                        </span>
                      </span>
                    ))}
                  </Fragment>
                );
              })}
            />
          );
        })}
      </SheetBody>
    </SheetTable>
  );
}
