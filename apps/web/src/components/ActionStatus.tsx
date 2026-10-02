import { type ActionStatusReport, ARM_PROGRESS } from "../lib/actionStatus";

/**
 * A long-running action reporting itself: the arms as a queue, each row saying where it
 * stands, and one sentence under them (`form-decisions.md` 10.2; `Workspace.dc.html` :2538).
 *
 * **The rows and the sentence are one polite live region**, mounted whether or not anything is
 * running, so an assistive technology is already watching it when a press starts — a region
 * inserted with its content is not reliably announced. It is `aria-atomic`, so what is read on
 * a change is the whole queue rather than the one word that moved; and it is announced only
 * when its text changes, because React leaves an unchanged text node alone and a live region
 * speaks on mutation. Nothing polls, so there is no tick to announce: the region moves exactly
 * when an arm does.
 *
 * **The note is outside it.** "This can take a minute and cannot be cancelled." is true before
 * the action and for as long as it runs, and changes nothing while it does, so it is read by
 * whoever reaches the control that starts it — which names it in its description, before the
 * press as after — rather than repeated with every row. It is drawn only while the action runs.
 * No Cancel is drawn: the prototype states that there is none, and so does this.
 *
 * `aria-busy` belongs to the card whose content is about to change, never to an element that
 * holds this region: an assistive technology holds back what a busy region says until it is no
 * longer busy, which would silence the queue for exactly as long as it has something to say.
 */
export function ActionStatus({
  label,
  report,
  note,
  noteId,
  regionId,
}: {
  /** The region's name, which is what a reader — and a test — finds it by. */
  label: string;
  report: ActionStatusReport;
  /** What is true for as long as the action runs: that it cannot be cancelled. */
  note: string;
  /** The id the pressed button's `aria-describedby` names while the action runs. */
  noteId?: string;
  /** The region's own `id`, for a control described by what the region says — a refusal. */
  regionId?: string;
}) {
  const shown = report.rows.length > 0 || report.summary !== "";
  return (
    <div className={shown ? "grid gap-1.5" : undefined}>
      <div
        id={regionId}
        role="status"
        aria-label={label}
        aria-atomic="true"
        className="grid gap-1.5"
      >
        {report.rows.length > 0 ? (
          <ul className="overflow-hidden rounded-[9px] border border-admin-border">
            {report.rows.map((row) => {
              const state = ARM_PROGRESS[row.progress];
              return (
                <li
                  key={row.key}
                  className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 border-b border-admin-border px-3 py-2 text-[12.5px] last:border-b-0"
                >
                  <span className="font-semibold text-lab-ink">{row.label}</span>
                  <span className="font-mono text-[11.5px] text-admin-muted">{row.detail}</span>
                  <span
                    className={`ml-auto text-xs font-semibold ${
                      state.busy ? "text-admin-ink-soft" : "text-admin-muted"
                    }`}
                  >
                    {state.word}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : null}
        {report.summary === "" ? null : (
          <p className="text-xs text-admin-ink-soft">{report.summary}</p>
        )}
      </div>
      {/* Mounted before the press as well, and read then, because it is as true before an
          action runs as while it does: the control that starts it names this line, and a reader
          reaching that control hears it — a description added after the press would not be
          announced again on the control that already has focus. Drawn only while it runs. */}
      <p id={noteId} className={report.running ? "text-xs text-admin-muted" : "sr-only"}>
        {note}
      </p>
    </div>
  );
}
