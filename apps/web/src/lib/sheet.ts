/**
 * The arms as the results sheet names its columns (ADR 0080, `components/ArmSheet.tsx`).
 */

/** One arm as the sheet names it: its column's key, its label, and its position's letter. */
export interface SheetArm {
  key: string;
  label: string;
  /** A, B, … by position: it names the column again in the strip and ranks nothing. */
  letter: string;
}

/** The arms in the order given, each lettered by its position. */
export function sheetArmsOf(runs: readonly { run_id: string; label: string }[]): SheetArm[] {
  return runs.map((run, index) => ({
    key: run.run_id,
    label: run.label,
    letter: String.fromCharCode(65 + index),
  }));
}
