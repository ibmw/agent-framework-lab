import type { GeneratedScenarioResponse } from "@agent-lab/contracts";
import { Check, Database, Fingerprint } from "lucide-react";
import type { ReactNode } from "react";

const panelClasses = "rounded-panel border border-lab-ink/20 bg-lab-paper/90 shadow-panel";

function scenarioValue(scenarioId: string, scenarioVersion: string): string {
  return `${scenarioId}@${scenarioVersion}`;
}

export function PersonaSummary({
  result,
  source,
  children,
}: {
  result: GeneratedScenarioResponse;
  source: "generated" | "retrieved";
  children?: ReactNode;
}) {
  const { metadata, initial_state: initialState } = result;
  const { persona } = initialState;

  return (
    <section className={`${panelClasses} p-6 sm:p-8 lg:p-10`} aria-labelledby="persona-title">
      <div className="flex items-start justify-between gap-4 border-b border-lab-ink/15 pb-7">
        <div>
          <p className="mb-3 flex items-center gap-1.5 text-xs font-extrabold tracking-[0.11em] text-lab-success uppercase">
            <Check aria-hidden="true" size={14} />
            {source === "retrieved" ? "Retrieved from recorded inputs" : "Persona generated"}
          </p>
          <h2
            className="font-display mb-1.5 text-[clamp(2rem,4vw,3.3rem)] leading-tight font-medium tracking-[-0.04em]"
            id="persona-title"
          >
            {persona.display_name}
          </h2>
          <p className="m-0 text-lab-muted">{persona.email}</p>
        </div>
        <span className="rounded-md bg-lab-accent-soft px-2.5 py-1.5 font-mono text-xs font-bold text-lab-accent uppercase">
          {persona.locale}
        </span>
      </div>

      <div className="grid gap-8 py-7 sm:grid-cols-2">
        <div>
          <h3 className="mb-4 text-xs font-bold tracking-[0.06em] uppercase">Support profile</h3>
          <div className="flex flex-wrap gap-2">
            {persona.support_traits.map((trait) => (
              <span
                className="rounded-full border border-lab-ink/20 px-3 py-2 text-xs text-lab-ink-soft capitalize"
                key={trait}
              >
                {trait.replaceAll("_", " ")}
              </span>
            ))}
          </div>
          <dl className="mt-6 grid gap-2 min-[480px]:grid-cols-3 sm:grid-cols-1 lg:grid-cols-3">
            {[
              ["Products", initialState.products.length],
              ["Orders", initialState.orders.length],
              ["Order status", initialState.orders[0]?.status ?? "None"],
            ].map(([label, value]) => (
              <div className="rounded-lg bg-lab-subtle p-3" key={label}>
                <dt className="text-[0.68rem] text-lab-muted uppercase">{label}</dt>
                <dd className="mt-1 font-mono text-xs font-bold">{value}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div>
          <h3 className="mb-4 flex items-center gap-2 text-xs font-bold tracking-[0.06em] uppercase">
            <Database aria-hidden="true" size={17} /> Replay context
          </h3>
          <dl className="grid gap-3">
            {[
              ["Scenario", scenarioValue(metadata.scenario_id, metadata.scenario_version)],
              ["Seed", metadata.seed],
              ["Policy set", metadata.policy_set_version],
              ["Canonical schema", metadata.canonical_schema_version],
            ].map(([label, value]) => (
              <div
                className="flex items-baseline justify-between gap-4 border-b border-dashed border-lab-ink/15 pb-2"
                key={label}
              >
                <dt className="text-[0.68rem] text-lab-muted uppercase">{label}</dt>
                <dd className="mt-1 font-mono text-xs font-bold">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>

      <div className="flex min-w-0 items-start gap-3 rounded-lg bg-lab-fingerprint p-3.5 text-lab-ink-soft">
        <Fingerprint className="shrink-0" aria-hidden="true" size={18} />
        <div className="min-w-0">
          <span className="mb-1 block text-[0.67rem] font-extrabold tracking-[0.06em] text-lab-muted uppercase">
            Initial-state SHA-256
          </span>
          <code className="block [overflow-wrap:anywhere] text-[0.7rem] leading-relaxed">
            {result.initial_state_hash}
          </code>
        </div>
      </div>

      {children && <div className="mt-5 flex flex-wrap gap-2">{children}</div>}
    </section>
  );
}
