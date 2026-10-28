// biome-ignore-all lint/a11y/noRedundantRoles: below a phone's width every part of the sheet's
// tables is `display: block`, and WebKit drops a table's implicit roles when its display changes;
// the explicit roles keep each row and cell a row and a cell to assistive technology (ADR 0080).
import { createContext, type ReactNode, useContext, useId } from "react";
import type { SheetArm } from "../lib/sheet";
import { clearStickyStrip } from "../lib/stickyHeader";
import {
  focusRingClasses,
  sheetArmCellRuleClasses,
  sheetArmLetterClasses,
  sheetCellArmClasses,
  sheetCellClasses,
  sheetColumns,
  sheetDiffersRowClasses,
  sheetDiffersTagClasses,
  sheetExtraColumnClasses,
  sheetGroupEmptyClasses,
  sheetGroupHeadingClasses,
  sheetGroupNoteClasses,
  sheetHeadingRowClasses,
  sheetLabelCellClasses,
  sheetNoteClasses,
  sheetRowClasses,
  sheetSameSummaryClasses,
  sheetSectionClasses,
  sheetSectionHeadClasses,
  sheetStripCellClasses,
  sheetStripClasses,
  sheetTitleClasses,
} from "../lib/ui";
import { useNarrowViewport } from "../lib/viewport";

/**
 * The results sheet: each arm a column and every fact a row (ADR 0080,
 * `results-sheet-mockup.dc.html` :131–191).
 *
 * A section is a card with its Georgia title, a one-sentence note and the `id` a chip jumps to.
 * Its rows are a table — `row`, `rowheader`, `cell` to assistive technology — with a header row
 * whose column headers name the arms, so a cell is heard with its arm. That header row is not
 * drawn: on screen the summary row and the strip pinned over the page name the arms over their
 * columns, and each would be a third naming of the same column.
 *
 * Below a phone's width (ADR 0079) the rows stack: the label on a line, then each arm's cell
 * under a line naming its arm, because there is no column left to say it. The width is read from
 * `useNarrowViewport`, the one answer the workspace has to "is this a phone".
 */

interface SheetFrame {
  arms: readonly SheetArm[];
  narrow: boolean;
  /** The section's label column header, which a group's table names its rows by too. */
  labelHeader: string;
}

const SheetContext = createContext<SheetFrame | null>(null);

/**
 * The table a row is drawn in: whether it adds a column after the arms' — the business state's
 * field table adds its *Assessment* — and that column's header.
 */
const SheetTableContext = createContext<{ extra: string | undefined }>({ extra: undefined });

function useSheet(): SheetFrame {
  const frame = useContext(SheetContext);
  if (frame === null) {
    throw new Error("A sheet row is drawn inside a SheetSection.");
  }
  return frame;
}

/** What every arm reads alike is "the same for both arms", or for all of them past two. */
function everyArm(count: number): string {
  return count === 2 ? "both arms" : `all ${count} arms`;
}

/**
 * The rows' table: the header row naming the arms to assistive technology, then the rows.
 *
 * A native table carrying its roles explicitly (see the file's first lines), so its rows and
 * cells are heard as rows and cells whatever the width draws them as. From
 * a phone's width up it lays out on `table-fixed` columns — the label's 240px and the rest shared
 * equally between the arms, which is `sheetColumns` drawn by the table itself. At a phone's width
 * every part of it is a block, and the rows stack.
 *
 * `extra` adds one column after the arms', at a fixed width, whose header it is: a row then
 * carries that column's cell (`SheetRow`'s `extra`), and at a phone's width that cell is stacked
 * last under a line naming the column, as an arm's is under its arm.
 *
 * Its header row is `sr-only`, and so absolutely placed: the box around the table is `relative`
 * so that it is laid out against the table rather than the pane, which it could otherwise widen
 * at a phone's width (ADR 0079).
 */
export function SheetTable({
  label,
  labelHeader,
  extra,
  children,
}: {
  label: string;
  /** The label column's header; the section's when not given. */
  labelHeader?: string;
  /** The header of a column after the arms', when the table adds one. */
  extra?: string;
  children: ReactNode;
}) {
  const { arms, narrow, labelHeader: sectionHeader } = useSheet();
  return (
    <div className="relative">
      <table
        role="table"
        aria-label={label}
        className={narrow ? "block w-full" : "w-full table-fixed border-collapse"}
      >
        {narrow ? null : (
          <colgroup>
            <col className="w-[240px]" />
            {arms.map((arm) => (
              <col key={arm.key} />
            ))}
            {extra ? <col className={sheetExtraColumnClasses} /> : null}
          </colgroup>
        )}
        {/* At a phone's width the header row is a block too, so its cells stack inside the
            `sr-only` box rather than laying a row out past the viewport's edge, clipped but
            still there to be measured. */}
        <thead role="rowgroup" className="sr-only">
          <tr role="row" className={narrow ? "block" : undefined}>
            <th role="columnheader" scope="col" className={narrow ? "block" : undefined}>
              {labelHeader ?? sectionHeader}
            </th>
            {arms.map((arm) => (
              <th
                key={arm.key}
                role="columnheader"
                scope="col"
                className={narrow ? "block" : undefined}
              >
                {arm.label}
              </th>
            ))}
            {extra ? (
              <th role="columnheader" scope="col" className={narrow ? "block" : undefined}>
                {extra}
              </th>
            ) : null}
          </tr>
        </thead>
        <SheetTableContext.Provider value={{ extra }}>{children}</SheetTableContext.Provider>
      </table>
    </div>
  );
}

/** A table's rows: one body, or one per group of rows a heading row opens. */
export function SheetBody({ children }: { children: ReactNode }) {
  const { narrow } = useSheet();
  return (
    <tbody role="rowgroup" className={narrow ? "block" : undefined}>
      {children}
    </tbody>
  );
}

/** One section of the sheet: its card, its title and note, and its rows. */
export function SheetSection({
  id,
  title,
  note,
  arms,
  labelHeader,
  children,
  after,
  grouped = false,
  tour,
}: {
  /** The `id` its chip in *Sections* jumps to. */
  id: string;
  title: string;
  /** One sentence on what the section is; a card's footer before the sheet. */
  note?: ReactNode;
  arms: readonly SheetArm[];
  /** The label column's header, heard before each arm's: what a row is a row of. */
  labelHeader: string;
  children: ReactNode;
  /** What follows the rows inside the card: the disclosure of what every arm reads alike. */
  after?: ReactNode;
  /**
   * Whether `children` are `SheetGroup`s, each drawing its own table under its heading, rather
   * than the rows of the section's one table.
   */
  grouped?: boolean;
  /** The tour's hook, where a step lights this section (`lib/tours.ts`). */
  tour?: string;
}) {
  const narrow = useNarrowViewport();
  const titleId = useId();
  return (
    // Focusable from script alone, so a chip's jump moves the reader's place to it; ringed as every
    // focus is, where the browser judges the focus visible (a jump made from the keyboard).
    <section
      id={id}
      tabIndex={-1}
      aria-labelledby={titleId}
      data-tour={tour}
      className={`${sheetSectionClasses} ${focusRingClasses}`}
    >
      <div className={sheetSectionHeadClasses}>
        <h2 id={titleId} className={sheetTitleClasses}>
          {title}
        </h2>
        {note ? <p className={sheetNoteClasses}>{note}</p> : null}
      </div>
      <SheetContext.Provider value={{ arms, narrow, labelHeader }}>
        {grouped ? (
          children
        ) : (
          <SheetTable label={title}>
            <SheetBody>{children}</SheetBody>
          </SheetTable>
        )}
        {after}
      </SheetContext.Provider>
    </section>
  );
}

/**
 * A row's label cell: the label, and *Differs* where the arms do. Its lines and a cell's are
 * `div`s, so a cell may hold flow content — a disclosure, a group of lines.
 */
function LabelCell({
  label,
  differs,
  narrow,
}: {
  label: ReactNode;
  differs?: boolean;
  narrow: boolean;
}) {
  return (
    <th
      role="rowheader"
      scope="row"
      className={`${sheetLabelCellClasses} ${narrow ? "block" : "align-top"}`}
    >
      <div className="grid gap-1.5">
        <div>{label}</div>
        {differs ? <span className={sheetDiffersTagClasses}>Differs</span> : null}
      </div>
    </th>
  );
}

function rowClasses(narrow: boolean, differs: boolean): string {
  return [sheetRowClasses, narrow ? "block" : null, differs ? sheetDiffersRowClasses : null]
    .filter(Boolean)
    .join(" ");
}

/**
 * A row with a cell per arm, in the arms' order.
 *
 * A row the arms differ on is tinted and says *Differs* in words under its label; the tint says
 * the values differ and nothing more — no ratio, no winner.
 */
export function SheetRow({
  label,
  differs = false,
  cells,
  cellClassName,
  extra,
}: {
  label: ReactNode;
  differs?: boolean;
  /** One per arm, in the arms' order. */
  cells: ReactNode[];
  /** Classes for every arm's cell, such as the larger figure of a differing measure. */
  cellClassName?: (index: number) => string | undefined;
  /** The cell of the column the table adds after the arms' (`SheetTable`'s `extra`). */
  extra?: ReactNode;
}) {
  const { arms, narrow } = useSheet();
  const { extra: extraHeader } = useContext(SheetTableContext);
  const cell = (key: string, line: string, content: ReactNode, className?: string) => (
    <td
      key={key}
      role="cell"
      className={[
        sheetCellClasses,
        narrow ? "block pt-0" : `align-top ${sheetArmCellRuleClasses}`,
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="grid gap-1.5">
        {narrow ? <span className={sheetCellArmClasses}>{line}</span> : null}
        {content}
      </div>
    </td>
  );
  return (
    <tr role="row" className={rowClasses(narrow, differs)}>
      <LabelCell label={label} differs={differs} narrow={narrow} />
      {arms.map((arm, index) => cell(arm.key, arm.label, cells[index], cellClassName?.(index)))}
      {extraHeader ? cell("extra", extraHeader, extra) : null}
    </tr>
  );
}

/** A row whose one cell spans the arms: a fact about the run rather than about one arm. */
export function SheetSpanningRow({ label, children }: { label: ReactNode; children: ReactNode }) {
  const { arms, narrow } = useSheet();
  const { extra } = useContext(SheetTableContext);
  return (
    <tr role="row" className={rowClasses(narrow, false)}>
      <LabelCell label={label} narrow={narrow} />
      <td
        role="cell"
        colSpan={arms.length + (extra ? 1 : 0)}
        className={`${sheetCellClasses} ${narrow ? "block pt-0" : "align-top"}`}
      >
        <div className="grid gap-1.5">{children}</div>
      </td>
    </tr>
  );
}

/**
 * A row that opens a group of the rows under it, across every column: the field table's
 * "shipping address" over that group's paths. Its one header names the rows that follow
 * (`scope="rowgroup"`), so it is the first row of its own body.
 */
export function SheetHeadingRow({ children }: { children: ReactNode }) {
  const { arms, narrow } = useSheet();
  const { extra } = useContext(SheetTableContext);
  return (
    <tr role="row" className={rowClasses(narrow, false)}>
      {/* The native header of a group of rows rather than of one, its role explicit for the
          reason the file's first lines give. */}
      {/* biome-ignore lint/a11y/useSemanticElements: it is a `th`, with `scope="rowgroup"`. */}
      <th
        role="rowheader"
        scope="rowgroup"
        colSpan={arms.length + 1 + (extra ? 1 : 0)}
        className={`${sheetHeadingRowClasses} ${narrow ? "block" : ""}`}
      >
        {children}
      </th>
    </tr>
  );
}

/**
 * A labelled group of a section's rows (sheet mockup :139–141): its heading, its note, then
 * its rows in a table of its own named by the heading — or, with no row to draw, its empty
 * sentence.
 *
 * A table of its own, so a group can be `busy` (ADR 0065) while the rest of its section is not:
 * the judged objectives while a judge scores them, and never the controls at the section's foot.
 */
export function SheetGroup({
  heading,
  note,
  empty,
  busy = false,
  children,
}: {
  heading: string;
  /** One sentence on what the group is; a card's footer before the sheet. */
  note?: ReactNode;
  /** What the group says in place of rows when it has none. */
  empty?: ReactNode;
  busy?: boolean;
  children?: ReactNode;
}) {
  return (
    <div aria-busy={busy || undefined} className="grid">
      <h3 className={sheetGroupHeadingClasses}>{heading}</h3>
      {note ? <p className={sheetGroupNoteClasses}>{note}</p> : null}
      {empty ? (
        <p className={sheetGroupEmptyClasses}>{empty}</p>
      ) : (
        <SheetTable label={heading}>
          <SheetBody>{children}</SheetBody>
        </SheetTable>
      )}
    </div>
  );
}

/**
 * What every arm reads alike, folded under one line: "N {things} are the same for both arms",
 * closed. Inside, one spanning row per shared value, drawn whole — never shortened, since a
 * reader who opens it is asking to read the value.
 *
 * Its rows are a table of their own, because a disclosure cannot sit between a table's rows.
 */
export function SameForEveryArm({
  title,
  labelHeader,
  noun,
  rows,
}: {
  /** The section's title, which the folded table is named after. */
  title: string;
  labelHeader: string;
  /** What a row is, singular and plural: ["variable", "variables"]. */
  noun: readonly [string, string];
  /** Each shared value; `className` inks it, as a retry above zero is in the error ink. */
  rows: readonly { key: string; label: ReactNode; value: ReactNode; className?: string }[];
}) {
  const { arms } = useSheet();
  // One arm shares nothing with another: every row of its section is drawn in its column.
  if (rows.length === 0 || arms.length < 2) {
    return null;
  }
  const summary = `${rows.length} ${rows.length === 1 ? `${noun[0]} is` : `${noun[1]} are`} the same for ${everyArm(arms.length)}`;
  return (
    <details className="border-t border-admin-border/60">
      <summary className={sheetSameSummaryClasses}>{summary}</summary>
      <SheetTable label={`${title}: ${summary}`} labelHeader={labelHeader}>
        <SheetBody>
          {rows.map((row) => (
            <SheetSpanningRow key={row.key} label={row.label}>
              <span className={`whitespace-pre-line ${row.className ?? "text-admin-ink-soft"}`}>
                {row.value}
              </span>
            </SheetSpanningRow>
          ))}
        </SheetBody>
      </SheetTable>
    </details>
  );
}

/**
 * The strip pinned at the top of the pane over the sheet: one line naming each arm over its
 * column (sheet mockup :97–103).
 *
 * `aria-hidden`, because every cell's column header already names its arm to a reader who
 * cannot see the columns. It is drawn only where there are columns to name: not for one arm,
 * whose one column needs no naming over it, and not at a phone's width, where the rows stack and
 * each cell names its own arm. It keeps what is scrolled into view clear of it
 * (`clearStickyStrip`).
 */
export function ArmStrip({ label, arms }: { label: string; arms: readonly SheetArm[] }) {
  const narrow = useNarrowViewport();
  if (narrow || arms.length < 2) {
    return null;
  }
  return (
    <div
      aria-hidden
      data-sheet-strip=""
      ref={clearStickyStrip}
      className={`${sheetStripClasses} px-px`}
      style={{ gridTemplateColumns: sheetColumns(arms.length) }}
    >
      <div
        className={`${sheetStripCellClasses} text-[11px] tracking-[0.07em] text-admin-muted uppercase`}
      >
        <span className="truncate">{label}</span>
      </div>
      {arms.map((arm) => (
        <div key={arm.key} className={sheetStripCellClasses}>
          <span className={sheetArmLetterClasses}>{arm.letter}</span>
          <span className="truncate">{arm.label}</span>
        </div>
      ))}
    </div>
  );
}
