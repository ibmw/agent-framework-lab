export const panelClasses = "rounded-panel border border-lab-ink/20 bg-lab-paper/90 shadow-panel";

const fieldSurfaceClasses =
  "w-full rounded-lg border border-lab-border bg-lab-paper px-3.5 text-sm text-lab-ink outline-none transition focus:border-lab-accent focus:ring-[3px] focus:ring-lab-accent/15 aria-invalid:border-lab-error disabled:cursor-not-allowed disabled:opacity-65";

export const fieldControlClasses = `box-border h-13 ${fieldSurfaceClasses}`;

export const filterControlClasses = `box-border h-11 ${fieldSurfaceClasses}`;

export const filterLabelClasses =
  "grid gap-1 text-[0.68rem] font-extrabold tracking-wide text-lab-muted uppercase";

export const inkButtonClasses =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-lab-ink px-5 py-[13px] text-sm font-semibold text-lab-canvas-top transition hover:bg-lab-ink-hover disabled:cursor-not-allowed disabled:opacity-65";

export const accentButtonClasses =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-lab-accent px-5 py-[13px] text-sm font-semibold text-lab-paper transition hover:bg-lab-accent/90 disabled:cursor-not-allowed disabled:opacity-65";

export const outlineButtonClasses =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-lab-border bg-transparent px-4 py-[13px] text-sm font-semibold text-lab-ink transition hover:bg-lab-subtle disabled:cursor-not-allowed disabled:opacity-65";

export const LAST_CONVERSATION_KEY = "agent-lab:last-conversation";
export const LAST_COMPARISON_KEY = "agent-lab:last-comparison";
export const LAB_STORAGE_EVENT = "agent-lab:storage";

export function notifyLabStorageChanged(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(LAB_STORAGE_EVENT));
  }
}

export function clearLastConversationIfMatches(path: string): void {
  if (
    typeof window !== "undefined" &&
    window.localStorage.getItem(LAST_CONVERSATION_KEY) === path
  ) {
    window.localStorage.removeItem(LAST_CONVERSATION_KEY);
    notifyLabStorageChanged();
  }
}

export function clearLastConversationForPersona(personaPath: string): boolean {
  if (
    typeof window !== "undefined" &&
    window.localStorage.getItem(LAST_CONVERSATION_KEY)?.startsWith(`${personaPath}/conversations/`)
  ) {
    window.localStorage.removeItem(LAST_CONVERSATION_KEY);
    notifyLabStorageChanged();
    return true;
  }
  return false;
}

export interface LastComparison {
  personaPath: string;
  a: string;
  b: string;
}

export function readLastComparison(): LastComparison | null {
  if (typeof window === "undefined") {
    return null;
  }
  const raw = window.localStorage.getItem(LAST_COMPARISON_KEY);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as LastComparison;
    if (
      typeof parsed.personaPath === "string" &&
      typeof parsed.a === "string" &&
      typeof parsed.b === "string"
    ) {
      return parsed;
    }
  } catch {
    window.localStorage.removeItem(LAST_COMPARISON_KEY);
  }
  return null;
}

export function writeLastComparison(value: LastComparison): void {
  window.localStorage.setItem(LAST_COMPARISON_KEY, JSON.stringify(value));
  notifyLabStorageChanged();
}

export function clearLastComparisonForPersona(personaPath: string): void {
  const stored = readLastComparison();
  if (stored?.personaPath === personaPath) {
    window.localStorage.removeItem(LAST_COMPARISON_KEY);
    notifyLabStorageChanged();
  }
}

export function formatActivity(isoTimestamp: string): string {
  const date = new Date(isoTimestamp);
  if (Number.isNaN(date.getTime())) {
    return isoTimestamp;
  }
  return date.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
