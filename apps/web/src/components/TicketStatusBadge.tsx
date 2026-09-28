import type { TicketStatus } from "@agent-lab/contracts";
import { statusLabel } from "../lib/tickets";

/**
 * A ticket's status, as the index, the editor's header and the customer's other tickets draw
 * it: a glyph for the axis and the word for the meaning, never colour alone.
 */
export function TicketStatusBadge({ status }: { status: TicketStatus }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-admin-border/60 px-2 py-0.5 text-[11px] font-semibold text-admin-ink-soft">
      <span aria-hidden>{status === "open" ? "◐" : "●"}</span> {statusLabel(status)}
    </span>
  );
}
