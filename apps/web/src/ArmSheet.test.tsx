import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ArmStrip,
  SameForEveryArm,
  SheetBody,
  SheetGroup,
  SheetHeadingRow,
  SheetLineStrip,
  SheetRow,
  SheetSection,
  SheetSpanningRow,
  SheetTable,
} from "./components/ArmSheet";
import { type SheetArm, sheetArmsOf } from "./lib/sheet";
import { stubViewport } from "./test/viewport";

const TWO = sheetArmsOf([
  { run_id: "run-a", label: "Arm A — Pydantic AI" },
  { run_id: "run-b", label: "Arm B — OpenAI Agents SDK" },
]);
const ONE = TWO.slice(0, 1);

afterEach(() => vi.unstubAllGlobals());

/** A small sheet: a differing row, a shared fact spanning the arms, and two folded rows. */
function Sheet({ arms }: { arms: readonly SheetArm[] }) {
  return (
    <>
      <ArmStrip label="General" arms={arms} />
      <SheetSection
        id="usage"
        title="Usage"
        note="Observations, not scores."
        arms={arms}
        labelHeader="Measure"
        after={
          <SameForEveryArm
            title="Usage"
            labelHeader="Measure"
            noun={["measure", "measures"]}
            rows={[
              { key: "turns", label: "Turns", value: "2" },
              { key: "failures", label: "Failures", value: "1 × timeout\n1 × refused" },
            ]}
          />
        }
      >
        <SheetRow label="Input tokens" differs cells={["7.8k", "1.3k"].slice(0, arms.length)} />
        <SheetRow label="Tool calls" cells={["11", "11"].slice(0, arms.length)} />
        <SheetSpanningRow label="Attribution">One difference.</SheetSpanningRow>
      </SheetSection>
    </>
  );
}

function rowCells(row: HTMLElement) {
  return within(row)
    .getAllByRole("cell", { hidden: true })
    .map((cell) => cell.textContent);
}

describe("the arm-column sheet", () => {
  it("names each arm's column by the arm, so a cell is heard with its arm", () => {
    render(<Sheet arms={TWO} />);

    const section = screen.getByRole("region", { name: "Usage" });
    expect(section).toHaveAttribute("id", "usage");
    expect(within(section).getByRole("heading", { level: 2, name: "Usage" })).toHaveClass(
      "font-display",
    );
    const [table] = within(section).getAllByRole("table", { hidden: true });
    expect(table).toHaveAccessibleName("Usage");
    expect(
      within(table)
        .getAllByRole("columnheader", { hidden: true })
        .map((head) => head.textContent),
    ).toEqual(["Measure", "Arm A — Pydantic AI", "Arm B — OpenAI Agents SDK"]);
    // The label column's width and one equal column per arm.
    const columns = table.querySelectorAll("col");
    expect(columns).toHaveLength(3);
    expect(columns[0]).toHaveClass("w-[240px]");
    expect(table).toHaveClass("table-fixed");
    // A row: its header, then a cell per arm in the arms' order.
    const tools = within(table).getByRole("row", { name: /^Tool calls/ });
    expect(within(tools).getByRole("rowheader")).toHaveTextContent("Tool calls");
    expect(rowCells(tools)).toEqual(["11", "11"]);
  });

  it("draws a row that spans the arms as one cell across their columns", () => {
    render(<Sheet arms={TWO} />);

    const row = screen.getByRole("row", { name: /^Attribution/ });
    const cells = within(row).getAllByRole("cell");
    expect(cells).toHaveLength(1);
    expect(cells[0]).toHaveAttribute("colspan", "2");
    expect(cells[0]).toHaveTextContent("One difference.");
  });

  it("tints a differing row and says Differs in words, and nothing more", () => {
    render(<Sheet arms={TWO} />);

    const differing = screen.getByRole("row", { name: /^Input tokens/ });
    expect(differing).toHaveClass("bg-admin-differs");
    expect(within(differing).getByRole("rowheader")).toHaveTextContent("Input tokensDiffers");
    expect(rowCells(differing)).toEqual(["7.8k", "1.3k"]);
    // No winner, no ratio: neither cell is marked apart from the other.
    const [a, b] = within(differing).getAllByRole("cell");
    expect(a.className).toBe(b.className);
    // A row the arms read alike is neither tinted nor marked.
    const same = screen.getByRole("row", { name: /^Tool calls/ });
    expect(same).not.toHaveClass("bg-admin-differs");
    expect(within(same).queryByText("Differs")).toBeNull();
  });

  it("folds what every arm reads alike under its count, closed, each value drawn whole", () => {
    render(<Sheet arms={TWO} />);

    const summary = screen.getByText("2 measures are the same for both arms");
    const disclosure = summary.closest("details") as HTMLElement;
    expect(summary.tagName).toBe("SUMMARY");
    expect(disclosure).not.toHaveAttribute("open");
    const folded = within(disclosure).getByRole("table", { hidden: true });
    expect(folded).toHaveAccessibleName("Usage: 2 measures are the same for both arms");
    const rows = within(folded)
      .getAllByRole("row", { hidden: true })
      .slice(1)
      .map((row) => [
        within(row).getByRole("rowheader", { hidden: true }).textContent,
        ...rowCells(row),
      ]);
    // One spanning row per shared value, the whole value on its own lines.
    expect(rows).toEqual([
      ["Turns", "2"],
      ["Failures", "1 × timeout\n1 × refused"],
    ]);
    const failures = within(folded).getAllByRole("cell", { hidden: true })[1];
    expect(failures).toHaveAttribute("colspan", "2");
    expect(failures.querySelector(".whitespace-pre-line")).not.toBeNull();
    expect(failures.querySelector("[class*='line-clamp']")).toBeNull();
  });

  it("says one shared value in the singular", () => {
    render(
      <SheetSection
        id="configuration"
        title="Configuration"
        arms={TWO}
        labelHeader="Variable"
        after={
          <SameForEveryArm
            title="Configuration"
            labelHeader="Variable"
            noun={["variable", "variables"]}
            rows={[{ key: "tools", label: "Tools", value: "orders.read_order" }]}
          />
        }
      >
        <SheetRow label="Framework" differs cells={["pydantic-ai", "openai-agents"]} />
      </SheetSection>,
    );

    expect(screen.getByText("1 variable is the same for both arms")).toBeVisible();
  });

  it("draws one arm as one column, with no strip and nothing folded", () => {
    render(<Sheet arms={ONE} />);

    expect(document.querySelector("[data-sheet-strip]")).toBeNull();
    expect(screen.queryByText(/same for/)).toBeNull();
    const [table] = screen.getAllByRole("table");
    expect(
      within(table)
        .getAllByRole("columnheader", { hidden: true })
        .map((head) => head.textContent),
    ).toEqual(["Measure", "Arm A — Pydantic AI"]);
    expect(rowCells(screen.getByRole("row", { name: /^Tool calls/ }))).toEqual(["11"]);
    expect(screen.getByRole("row", { name: /^Attribution/ }).querySelector("td")).toHaveAttribute(
      "colspan",
      "1",
    );
  });

  it("pins a strip naming each arm over its column, hidden from assistive technology", () => {
    render(<Sheet arms={TWO} />);

    const strip = document.querySelector("[data-sheet-strip]") as HTMLElement;
    expect(strip).toHaveAttribute("aria-hidden", "true");
    expect(strip).toHaveClass("sticky", "-top-5", "z-10", "border-b", "bg-admin-canvas");
    expect(strip.style.gridTemplateColumns).toBe("240px repeat(2, minmax(0, 1fr))");
    expect(Array.from(strip.children, (cell) => cell.textContent)).toEqual([
      "General",
      "AArm A — Pydantic AI",
      "BArm B — OpenAI Agents SDK",
    ]);
    // A long name is cut on its one line rather than wrapping the strip.
    expect(within(strip).getByText("Arm A — Pydantic AI")).toHaveClass("truncate");
  });

  it("stacks the rows at a phone's width, each cell under a line naming its arm", () => {
    stubViewport("narrow");
    render(<Sheet arms={TWO} />);

    // No strip: no columns are left for it to name.
    expect(document.querySelector("[data-sheet-strip]")).toBeNull();
    const [table] = screen.getAllByRole("table");
    expect(table).toHaveClass("block");
    expect(table.querySelector("colgroup")).toBeNull();
    const row = screen.getByRole("row", { name: /^Input tokens/ });
    expect(row).toHaveClass("block");
    const [a, b] = within(row).getAllByRole("cell");
    expect(a).toHaveClass("block");
    expect(within(a).getByText("Arm A — Pydantic AI")).toBeVisible();
    expect(within(b).getByText("Arm B — OpenAI Agents SDK")).toBeVisible();
    expect(rowCells(row)).toEqual(["Arm A — Pydantic AI7.8k", "Arm B — OpenAI Agents SDK1.3k"]);
    // A spanning row is about the run, and names no arm.
    expect(rowCells(screen.getByRole("row", { name: /^Attribution/ }))).toEqual([
      "One difference.",
    ]);
  });

  it("puts the columns back when the viewport widens past a phone's", () => {
    const viewport = stubViewport("narrow");
    render(<Sheet arms={TWO} />);

    viewport.resize("wide");

    expect(document.querySelector("[data-sheet-strip]")).not.toBeNull();
    const row = screen.getByRole("row", { name: /^Input tokens/ });
    expect(row).not.toHaveClass("block");
    expect(rowCells(row)).toEqual(["7.8k", "1.3k"]);
  });

  it("draws a section's rows in labelled groups, each its own table, one of them busy alone", () => {
    render(
      <SheetSection id="objectives" title="Objectives" arms={TWO} labelHeader="Objective" grouped>
        <SheetGroup heading="Decided by a rule" note="Decided from the record.">
          <SheetRow label="Read document" cells={["met", "met"]} />
        </SheetGroup>
        <SheetGroup heading="Scored by a judge" empty="No objective is left to a judge." busy />
      </SheetSection>,
    );

    const section = screen.getByRole("region", { name: "Objectives" });
    // One table per group, named by its heading, its columns the section's.
    const [ruled] = within(section).getAllByRole("table");
    expect(ruled).toHaveAccessibleName("Decided by a rule");
    expect(
      within(ruled)
        .getAllByRole("columnheader")
        .map((head) => head.textContent),
    ).toEqual(["Objective", "Arm A — Pydantic AI", "Arm B — OpenAI Agents SDK"]);
    const heading = within(section).getByRole("heading", { level: 3, name: "Decided by a rule" });
    expect(heading.nextElementSibling).toHaveTextContent("Decided from the record.");
    // A group with nothing to draw says so in its place, and draws no table.
    expect(within(section).getAllByRole("table")).toHaveLength(1);
    expect(within(section).getByText("No objective is left to a judge.")).toBeVisible();
    // Busy is the group's own: neither its neighbour nor the section is.
    const judged = within(section).getByRole("heading", { level: 3, name: "Scored by a judge" });
    expect(judged.parentElement).toHaveAttribute("aria-busy", "true");
    expect(ruled.closest("[aria-busy]")).toBeNull();
    expect(section).not.toHaveAttribute("aria-busy");
    expect(section).not.toHaveAttribute("data-tour");
  });

  it("adds a column after the arms', and a heading row across every column", () => {
    render(
      <SheetSection
        id="state"
        title="Business state"
        arms={TWO}
        labelHeader="Fact"
        tour="hook"
        grouped
      >
        <SheetTable label="Every field" labelHeader="Field" extra="Assessment">
          <SheetBody>
            <SheetHeadingRow>shipping address</SheetHeadingRow>
            <SheetRow label="city" cells={["Lyon", "Paris"]} extra="Difference" />
            <SheetSpanningRow label="Compared">Both differ.</SheetSpanningRow>
          </SheetBody>
        </SheetTable>
      </SheetSection>,
    );

    expect(screen.getByRole("region", { name: "Business state" })).toHaveAttribute(
      "data-tour",
      "hook",
    );
    const table = screen.getByRole("table", { name: "Every field" });
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((head) => head.textContent),
    ).toEqual(["Field", "Arm A — Pydantic AI", "Arm B — OpenAI Agents SDK", "Assessment"]);
    expect(table.querySelectorAll("col")).toHaveLength(4);
    expect(rowCells(within(table).getByRole("row", { name: /^city/ }))).toEqual([
      "Lyon",
      "Paris",
      "Difference",
    ]);
    // A heading row and a spanning row reach across the added column too.
    const heading = within(table).getByRole("rowheader", { name: "shipping address" });
    expect(heading).toHaveAttribute("scope", "rowgroup");
    expect(heading).toHaveAttribute("colspan", "4");
    const spanning = within(within(table).getByRole("row", { name: /^Compared/ })).getByRole(
      "cell",
    );
    expect(spanning).toHaveAttribute("colspan", "3");
  });

  it("stacks the added column last under a line naming it, at a phone's width", () => {
    stubViewport("narrow");
    render(
      <SheetSection id="state" title="Business state" arms={TWO} labelHeader="Fact" grouped>
        <SheetTable label="Every field" extra="Assessment">
          <SheetBody>
            <SheetRow label="city" cells={["Lyon", "Paris"]} extra="Difference" />
          </SheetBody>
        </SheetTable>
      </SheetSection>,
    );

    const row = screen.getByRole("row", { name: /^city/ });
    expect(row).toHaveClass("block");
    expect(rowCells(row)).toEqual([
      "Arm A — Pydantic AILyon",
      "Arm B — OpenAI Agents SDKParis",
      "AssessmentDifference",
    ]);
  });

  it("names a group of rows, lays a spanning row on its ground, and holds controls in the head", () => {
    render(
      <SheetSection
        id="timeline"
        title="Execution timeline"
        note="What happened."
        arms={TWO}
        labelHeader="Turn"
        grouped
        controls={<button type="button">All events</button>}
      >
        <SheetTable label="Execution timeline">
          <SheetBody label="Turn 1">
            <SheetSpanningRow ground label="Turn 1">
              The customer sent a message.
            </SheetSpanningRow>
            <SheetRow label="Events, in order" cells={["Replied", "Replied"]} />
          </SheetBody>
          <SheetBody label="Turn 2">
            <SheetSpanningRow label="Turn 2">Again.</SheetSpanningRow>
          </SheetBody>
        </SheetTable>
      </SheetSection>,
    );

    const section = screen.getByRole("region", { name: "Execution timeline" });
    // The controls are in the head, after the note and before the rows.
    const lens = within(section).getByRole("button", { name: "All events" });
    expect(within(section).getByText("What happened.").nextElementSibling).toBe(lens);
    const turns = within(section).getAllByRole("rowgroup", { name: /^Turn/ });
    expect(turns.map((group) => group.getAttribute("aria-label"))).toEqual(["Turn 1", "Turn 2"]);
    const [first, second] = turns.map((group) => within(group).getAllByRole("row")[0]);
    expect(first).toHaveClass("bg-admin-canvas/50");
    expect(second).not.toHaveClass("bg-admin-canvas/50");
    expect(within(turns[0]).getAllByRole("row")[1]).not.toHaveClass("bg-admin-canvas/50");
  });

  it("pins Traces' one-line strip for one arm and at a phone's width, cut rather than wrapped", () => {
    stubViewport("narrow");
    render(
      <div>
        <SheetLineStrip
          label="Traces"
          letter="A"
          arm="Arm A — Pydantic AI"
          detail="Turn 1 · attempt 1 · span agent.tool · orders.read_order"
        />
      </div>,
    );

    const strip = document.querySelector("[data-sheet-strip]") as HTMLElement;
    expect(strip).toHaveAttribute("aria-hidden", "true");
    expect(strip).toHaveClass("sticky", "-top-5", "whitespace-nowrap", "overflow-hidden");
    expect(Array.from(strip.children, (part) => part.textContent)).toEqual([
      "Traces",
      "A",
      "Arm A — Pydantic AI",
      "Turn 1 · attempt 1 · span agent.tool · orders.read_order",
    ]);
    expect(strip.children[2]).toHaveClass("truncate");
    expect(strip.children[3]).toHaveClass("truncate");
  });
});
