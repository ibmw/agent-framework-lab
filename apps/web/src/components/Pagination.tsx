import { ChevronLeft, ChevronRight } from "lucide-react";

function pageItems(current: number, total: number): (number | "ellipsis")[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, index) => index + 1);
  }
  const items: (number | "ellipsis")[] = [1];
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  if (start > 2) {
    items.push("ellipsis");
  }
  for (let value = start; value <= end; value += 1) {
    items.push(value);
  }
  if (end < total - 1) {
    items.push("ellipsis");
  }
  items.push(total);
  return items;
}

export function Pagination({
  page,
  pageSize,
  total,
  noun,
  label,
  onPageChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  noun: string;
  label: string;
  onPageChange: (page: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (total === 0 || totalPages <= 1) {
    return null;
  }

  return (
    <nav
      className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-lab-ink/10 pt-4"
      aria-label={label}
    >
      <p className="m-0 text-xs text-lab-muted">
        Page {page} of {totalPages} · {total} {total === 1 ? noun : `${noun}s`}
      </p>
      <div className="flex items-center gap-1">
        <button
          className="inline-flex min-h-10 items-center gap-1 rounded-lg border border-lab-border px-3 text-sm font-bold text-lab-ink-soft transition hover:bg-lab-subtle disabled:cursor-not-allowed disabled:opacity-50"
          type="button"
          onClick={() => onPageChange(Math.max(1, page - 1))}
          disabled={page <= 1}
        >
          <ChevronLeft aria-hidden="true" size={16} /> Previous
        </button>
        {pageItems(page, totalPages).map((item, index) =>
          item === "ellipsis" ? (
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: ellipsis positions are stable per render
              key={`ellipsis-${index}`}
              className="px-1.5 text-sm text-lab-muted"
              aria-hidden="true"
            >
              …
            </span>
          ) : (
            <button
              key={item}
              className={`min-h-10 min-w-10 rounded-lg border px-3 text-sm font-bold transition ${
                item === page
                  ? "border-lab-accent bg-lab-accent-soft text-lab-accent"
                  : "border-lab-border text-lab-ink-soft hover:bg-lab-subtle"
              }`}
              type="button"
              aria-current={item === page ? "page" : undefined}
              aria-label={`Page ${item}`}
              onClick={() => onPageChange(item)}
            >
              {item}
            </button>
          ),
        )}
        <button
          className="inline-flex min-h-10 items-center gap-1 rounded-lg border border-lab-border px-3 text-sm font-bold text-lab-ink-soft transition hover:bg-lab-subtle disabled:cursor-not-allowed disabled:opacity-50"
          type="button"
          onClick={() => onPageChange(Math.min(totalPages, page + 1))}
          disabled={page >= totalPages}
        >
          Next <ChevronRight aria-hidden="true" size={16} />
        </button>
      </div>
    </nav>
  );
}
