export const surfaceClasses =
  "rounded-[10px] border border-admin-border bg-admin-surface shadow-[0_1px_2px_rgb(22_51_45/6%)]";

const fieldSurfaceClasses =
  "w-full rounded-lg border border-admin-border bg-admin-surface px-3 text-sm text-admin-ink outline-none transition focus:border-lab-accent focus:ring-[3px] focus:ring-lab-accent/15 aria-invalid:border-lab-error disabled:cursor-not-allowed disabled:opacity-65";

export const fieldControlClasses = `box-border h-10 ${fieldSurfaceClasses}`;

export const textAreaClasses = `box-border min-h-24 py-2 ${fieldSurfaceClasses}`;

export const fieldLabelClasses = "grid gap-1 text-xs font-semibold text-admin-muted";

export const inkButtonClasses =
  "inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-lab-ink px-4 text-sm font-semibold text-lab-canvas-top transition hover:bg-lab-ink-hover disabled:cursor-not-allowed disabled:opacity-55";

export const accentButtonClasses =
  "inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-lab-accent px-4 text-sm font-semibold text-lab-paper transition hover:bg-lab-accent/90 disabled:cursor-not-allowed disabled:opacity-55";

export const outlineButtonClasses =
  "inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-admin-border bg-transparent px-4 text-sm font-semibold text-admin-ink transition hover:bg-admin-canvas disabled:cursor-not-allowed disabled:opacity-55";

export const subtleButtonClasses =
  "inline-flex min-h-8 items-center justify-center gap-1.5 rounded-md border border-admin-border bg-transparent px-2.5 text-xs font-semibold text-admin-muted transition hover:bg-admin-canvas hover:text-admin-ink disabled:cursor-not-allowed disabled:opacity-55";

export const tableHeadClasses =
  "border-b border-admin-border px-4 py-2.5 text-left text-xs font-semibold text-admin-muted";

export const tableCellClasses = "border-b border-admin-border/60 px-4 py-2.5 align-top";

export function formatTimestamp(isoTimestamp: string): string {
  const date = new Date(isoTimestamp);
  if (Number.isNaN(date.getTime())) {
    return isoTimestamp;
  }
  return date.toLocaleString("en-GB", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
