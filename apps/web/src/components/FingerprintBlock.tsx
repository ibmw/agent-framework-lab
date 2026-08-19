import { Fingerprint } from "lucide-react";

export function FingerprintBlock({
  hash,
  label,
  chips,
  compact = false,
}: {
  hash: string;
  label: string;
  chips?: string[];
  compact?: boolean;
}) {
  return (
    <div
      className={`flex min-w-0 items-start gap-3 rounded-[10px] bg-lab-fingerprint text-lab-ink ${
        compact ? "px-4 py-3.5" : "px-[18px] py-4"
      }`}
    >
      <Fingerprint className="mt-0.5 shrink-0 text-lab-ink-soft" aria-hidden="true" size={18} />
      <div className="grid min-w-0 gap-2">
        <span className="text-[11px] font-extrabold tracking-[0.06em] text-lab-muted uppercase">
          {label}
        </span>
        <code
          className={`block font-mono leading-normal break-all text-lab-ink ${
            compact ? "text-xs" : "text-[12.5px]"
          }`}
          title={hash}
        >
          {hash}
        </code>
        {chips && chips.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {chips.map((chip) => (
              <span
                className="rounded bg-lab-paper px-2 py-1 font-mono text-[11px] text-lab-ink-soft"
                key={chip}
              >
                {chip}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
