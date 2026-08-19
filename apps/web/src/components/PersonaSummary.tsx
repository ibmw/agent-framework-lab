import type { GeneratedScenarioResponse } from "@agent-lab/contracts";
import type { ReactNode } from "react";
import { CATALOG_SIZE, formatMoney, scenarioValue } from "../lib/scenarios";
import { inkButtonClasses, panelClasses } from "../lib/ui";
import { FingerprintBlock } from "./FingerprintBlock";

export function PersonaSummary({
  result,
  onChooseFramework,
  children,
}: {
  result: GeneratedScenarioResponse;
  onChooseFramework?: () => void;
  children?: ReactNode;
}) {
  const { metadata, initial_state: initialState } = result;
  const { persona } = initialState;
  const order = initialState.orders[0];

  return (
    <section className={`${panelClasses} overflow-hidden`} aria-labelledby="persona-title">
      <div className="flex gap-3.5 border-b border-lab-ink/15 px-[22px] py-[13px] font-mono text-[11px] text-lab-muted">
        <span className="font-extrabold text-lab-accent">02</span>
        <span>
          {scenarioValue({ id: metadata.scenario_id, version: metadata.scenario_version })} · seed{" "}
          {metadata.seed}
        </span>
      </div>
      <div className="flex flex-col gap-5 px-6 py-[26px]">
        <div className="flex flex-col gap-1.5">
          <h2
            className="font-display m-0 text-[clamp(2rem,4vw,3.3rem)] leading-[1.05] font-medium tracking-[-0.04em]"
            id="persona-title"
          >
            {persona.display_name}
          </h2>
          <p className="m-0 font-mono text-xs text-lab-muted">
            {persona.email} · {persona.locale}
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {persona.support_traits.map((trait) => (
              <span
                className="rounded-full bg-lab-fingerprint px-2.5 py-1 text-xs font-semibold text-lab-ink-soft capitalize"
                key={trait}
              >
                {trait.replaceAll("_", " ")}
              </span>
            ))}
          </div>
        </div>

        <div className="grid gap-2.5 sm:grid-cols-2">
          <div className="rounded-[10px] bg-lab-subtle p-3.5">
            <div className="mb-1.5 text-[10px] font-extrabold tracking-[0.08em] text-lab-muted uppercase">
              Order
            </div>
            <div className="text-sm font-semibold">
              {order ? `${order.status} · version ${order.version}` : "None"}
            </div>
          </div>
          <div className="rounded-[10px] bg-lab-subtle p-3.5">
            <div className="mb-1.5 text-[10px] font-extrabold tracking-[0.08em] text-lab-muted uppercase">
              Products on file
            </div>
            <div className="text-sm font-semibold">
              {initialState.products.length} of {CATALOG_SIZE} catalog items
            </div>
          </div>
          {initialState.products.map((product) => (
            <div className="rounded-[10px] bg-lab-subtle p-3.5" key={product.id}>
              <div className="mb-1.5 font-mono text-[10px] font-extrabold tracking-[0.08em] text-lab-muted uppercase">
                {product.sku}
              </div>
              <div className="text-sm font-semibold">
                {product.name} · {formatMoney(product.price_amount, product.currency)}
              </div>
            </div>
          ))}
        </div>

        <FingerprintBlock
          compact
          hash={result.initial_state_hash}
          label="Replayable from this fingerprint"
          chips={[
            `canonical schema ${initialState.canonical_schema_version}`,
            `policy set ${metadata.policy_set_version}`,
            `seed ${metadata.seed}`,
          ]}
        />

        {onChooseFramework && (
          <button
            className={`${inkButtonClasses} self-start`}
            type="button"
            onClick={onChooseFramework}
          >
            Choose a framework
          </button>
        )}
        {children}
      </div>
    </section>
  );
}
