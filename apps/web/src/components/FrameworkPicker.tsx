import type { AgentFrameworkListResponse } from "@agent-lab/contracts";
import { LoaderCircle } from "lucide-react";
import { AGENT_CAPABILITIES, FRAMEWORK_DESCRIPTORS } from "../lib/bench";
import { accentButtonClasses, outlineButtonClasses, panelClasses } from "../lib/ui";

type Framework = AgentFrameworkListResponse["frameworks"][number];

export function FrameworkPicker({
  frameworks,
  selected,
  onToggle,
  onRunSelected,
  running,
  error,
  helper = "one conversation per framework",
  runLabel,
  loading = false,
  runDisabled = false,
}: {
  frameworks: Framework[];
  selected: string[];
  onToggle: (frameworkId: string) => void;
  onRunSelected: () => void;
  running: boolean;
  error?: string;
  helper?: string;
  runLabel: string;
  loading?: boolean;
  runDisabled?: boolean;
}) {
  const selectedAvailable = selected.filter((id) =>
    frameworks.some((framework) => framework.framework_id === id && framework.available),
  );

  return (
    <section className={`${panelClasses} overflow-hidden`} aria-labelledby="frameworks-title">
      <div className="flex gap-3.5 border-b border-lab-ink/15 px-[22px] py-[13px] font-mono text-[11px] text-lab-muted">
        <span className="font-extrabold text-lab-accent">03</span>
        <span>GET /api/v1/agent-frameworks</span>
      </div>
      <div className="flex flex-col gap-3.5 p-6">
        <p className="m-0 text-sm text-lab-muted" id="frameworks-title">
          A capability appears here only once an adapter proves it. An unlit row is a real finding,
          not a missing badge.
        </p>

        {loading && (
          <p className="flex items-center gap-2 text-sm text-lab-muted" role="status">
            <LoaderCircle className="motion-safe:animate-spin" aria-hidden="true" size={16} />
            Loading frameworks…
          </p>
        )}

        <div className="flex flex-col gap-2.5">
          {frameworks.map((framework) => {
            const isSelected = selected.includes(framework.framework_id);
            const descriptor =
              framework.model_id ?? FRAMEWORK_DESCRIPTORS[framework.framework_id] ?? "adapter";
            if (!framework.available) {
              const reason = framework.unavailability_reason
                ? framework.unavailability_reason.startsWith("unavailable")
                  ? framework.unavailability_reason
                  : `unavailable — ${framework.unavailability_reason}`
                : "unavailable";
              return (
                <div
                  className="flex items-center gap-2.5 rounded-xl border border-lab-border bg-lab-error-soft p-4"
                  key={framework.framework_id}
                >
                  <span
                    className="size-[9px] shrink-0 rounded-full bg-lab-error"
                    aria-hidden="true"
                  />
                  <div className="min-w-0">
                    <p className="m-0 font-mono text-sm font-semibold">{framework.framework_id}</p>
                    <p className="m-0 text-xs text-lab-error">{reason}</p>
                  </div>
                </div>
              );
            }
            return (
              <button
                className={`flex flex-col gap-[11px] rounded-xl p-4 text-left transition ${
                  isSelected
                    ? "border-2 border-lab-ink bg-lab-paper"
                    : "border border-lab-border bg-lab-paper"
                }`}
                type="button"
                key={framework.framework_id}
                aria-pressed={isSelected}
                aria-label={`Select framework ${framework.framework_id}`}
                onClick={() => onToggle(framework.framework_id)}
              >
                <span className="flex items-center gap-2.5">
                  <span
                    className="size-[9px] shrink-0 rounded-full bg-lab-success"
                    aria-hidden="true"
                  />
                  <span className="font-mono text-[15px] font-semibold">
                    {framework.framework_id}
                  </span>
                  <span className="font-mono text-xs text-lab-muted">{descriptor}</span>
                  <span className="ml-auto rounded-full bg-lab-fingerprint px-2.5 py-1 text-xs font-semibold text-lab-success">
                    available
                  </span>
                </span>
                <span className="flex flex-wrap gap-1.5">
                  {AGENT_CAPABILITIES.map((capability) => {
                    const proven = framework.capabilities.includes(capability);
                    return (
                      <span
                        className={`rounded px-2 py-1 font-mono text-[10.5px] ${
                          proven
                            ? "bg-lab-fingerprint text-lab-success"
                            : "bg-lab-subtle text-lab-muted"
                        }`}
                        key={capability}
                      >
                        {capability}
                        <span className="sr-only">: {proven ? "proven" : "unproven"}</span>
                      </span>
                    );
                  })}
                </span>
              </button>
            );
          })}
        </div>

        {error && (
          <p className="m-0 text-sm text-lab-error" role="alert">
            {error}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            className={selectedAvailable.length >= 2 ? accentButtonClasses : outlineButtonClasses}
            type="button"
            onClick={onRunSelected}
            disabled={runDisabled || running || selectedAvailable.length === 0}
          >
            {running ? (
              <>
                <LoaderCircle className="motion-safe:animate-spin" aria-hidden="true" size={16} />
                Starting…
              </>
            ) : (
              runLabel
            )}
          </button>
          <span className="text-[13px] text-lab-muted">{helper}</span>
        </div>
      </div>
    </section>
  );
}
