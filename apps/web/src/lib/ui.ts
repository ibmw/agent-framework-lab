export const panelClasses = "rounded-panel border border-lab-ink/20 bg-lab-paper/90 shadow-panel";

export const fieldControlClasses =
  "min-h-13 w-full rounded-lg border border-lab-border bg-lab-paper px-3.5 text-lab-ink outline-none transition focus:border-lab-accent focus:ring-[3px] focus:ring-lab-accent/15 aria-invalid:border-lab-error disabled:cursor-not-allowed disabled:opacity-65";

export const filterControlClasses = `${fieldControlClasses} min-h-11`;

export const filterLabelClasses =
  "grid gap-1 text-[0.68rem] font-extrabold tracking-wide text-lab-muted uppercase";

export const LAST_CONVERSATION_KEY = "agent-lab:last-conversation";

export function clearLastConversationIfMatches(path: string): void {
  if (
    typeof window !== "undefined" &&
    window.localStorage.getItem(LAST_CONVERSATION_KEY) === path
  ) {
    window.localStorage.removeItem(LAST_CONVERSATION_KEY);
  }
}

export function clearLastConversationForPersona(personaPath: string): boolean {
  if (
    typeof window !== "undefined" &&
    window.localStorage.getItem(LAST_CONVERSATION_KEY)?.startsWith(`${personaPath}/conversations/`)
  ) {
    window.localStorage.removeItem(LAST_CONVERSATION_KEY);
    return true;
  }
  return false;
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
