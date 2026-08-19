export const ACTIVITY_WINDOWS: { value: string; label: string; ms: number }[] = [
  { value: "1h", label: "Last hour", ms: 60 * 60 * 1000 },
  { value: "24h", label: "Last 24 hours", ms: 24 * 60 * 60 * 1000 },
  { value: "7d", label: "Last 7 days", ms: 7 * 24 * 60 * 60 * 1000 },
  { value: "30d", label: "Last 30 days", ms: 30 * 24 * 60 * 60 * 1000 },
  { value: "365d", label: "Last year", ms: 365 * 24 * 60 * 60 * 1000 },
];

export const PAGE_SIZES = [10, 25, 50, 100];

/** Turn a selected activity window into an ISO `active_since` instant, or undefined for "any time". */
export function activeSinceFromWindow(windowValue: string): string | undefined {
  const activityWindow = ACTIVITY_WINDOWS.find((option) => option.value === windowValue);
  return activityWindow ? new Date(Date.now() - activityWindow.ms).toISOString() : undefined;
}
