import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ActionStatus } from "./components/ActionStatus";
import { type ActionStatusReport, IDLE_REPORT, TAKES_A_MINUTE } from "./lib/actionStatus";

const RUNNING: ActionStatusReport = {
  rows: [
    { key: "a", label: "Arm A", detail: "cfg-atlas v4", progress: "running" },
    { key: "b", label: "Arm B", detail: "cfg-beacon v2", progress: "queued" },
  ],
  summary: "1 of 2 running.",
  running: true,
};

const NEXT: ActionStatusReport = {
  rows: [
    { key: "a", label: "Arm A", detail: "cfg-atlas v4", progress: "awaiting_customer" },
    { key: "b", label: "Arm B", detail: "cfg-beacon v2", progress: "running" },
  ],
  summary: "1 of 2 running.",
  running: true,
};

function Status({ report }: { report: ActionStatusReport }) {
  return (
    <>
      <ActionStatus
        label="Where each arm stands"
        report={report}
        note={TAKES_A_MINUTE}
        noteId="n"
      />
      <button type="button" aria-describedby="n">
        Running…
      </button>
    </>
  );
}

/** Every change the region's subtree goes through between two renders. */
function watch(region: HTMLElement) {
  const observer = new MutationObserver(() => {});
  observer.observe(region, { subtree: true, childList: true, characterData: true });
  return () => {
    const records = observer.takeRecords();
    observer.disconnect();
    return records.length;
  };
}

describe("ActionStatus", () => {
  it("is a polite, atomic region already on the page before anything runs", () => {
    render(<Status report={IDLE_REPORT} />);
    const region = screen.getByRole("status", { name: "Where each arm stands" });
    // `role="status"` is a polite live region: it waits for a pause, never interrupts.
    expect(region).not.toHaveAttribute("aria-live", "assertive");
    expect(region).toHaveAttribute("aria-atomic", "true");
    expect(region).toHaveTextContent("");
    expect(screen.queryByRole("alert")).toBeNull();
    // The note is there already, undrawn, and what the control that starts the action says.
    expect(screen.getByRole("button", { name: "Running…" })).toHaveAccessibleDescription(
      TAKES_A_MINUTE,
    );
    expect(screen.getByText(TAKES_A_MINUTE)).toHaveClass("sr-only");
  });

  it("names each arm, what it runs and where it stands, and says how many are running", () => {
    render(<Status report={RUNNING} />);
    const region = screen.getByRole("status", { name: "Where each arm stands" });
    const rows = Array.from(region.querySelectorAll("li"), (row) => row.textContent);
    expect(rows).toEqual(["Arm Acfg-atlas v4running…", "Arm Bcfg-beacon v2waiting to run"]);
    expect(region).toHaveTextContent("1 of 2 running.");
  });

  it("says it cannot be cancelled while it runs, outside the region, and offers no Cancel", () => {
    const { rerender } = render(<Status report={RUNNING} />);
    const region = screen.getByRole("status", { name: "Where each arm stands" });
    const note = screen.getByText(TAKES_A_MINUTE);
    expect(region).not.toContainElement(note);
    expect(screen.getByRole("button", { name: "Running…" })).toHaveAccessibleDescription(
      TAKES_A_MINUTE,
    );
    expect(screen.queryByRole("button", { name: /cancel/i })).toBeNull();

    // Settled, it is drawn no longer, and is still what the control is described by: it is
    // as true before the next press as it was during this one.
    rerender(<Status report={{ ...NEXT, running: false, summary: "Done." }} />);
    expect(screen.getByText(TAKES_A_MINUTE)).toHaveClass("sr-only");
    expect(region).not.toContainElement(screen.getByText(TAKES_A_MINUTE));
  });

  it("changes when an arm moves, and not when it is drawn again unchanged", () => {
    const { rerender } = render(<Status report={RUNNING} />);
    const region = screen.getByRole("status", { name: "Where each arm stands" });

    // The same queue again — a re-render, a record read back with nothing new in it: the
    // region's text is not touched, so there is nothing for a reader to be told twice.
    let changes = watch(region);
    rerender(<Status report={{ ...RUNNING, rows: RUNNING.rows.map((row) => ({ ...row })) }} />);
    expect(changes()).toBe(0);

    // Arm A has answered and Arm B has started: that is news, and the region says it.
    changes = watch(region);
    rerender(<Status report={NEXT} />);
    expect(changes()).toBeGreaterThan(0);
    expect(region).toHaveTextContent(/Arm A.*waiting for the customer.*Arm B.*running…/);
  });
});
