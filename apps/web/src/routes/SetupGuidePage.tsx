import type { ShopSummarySchema } from "@agent-lab/contracts";
import { Link } from "react-router-dom";
import { GuideProse } from "../components/GuideProse";
import { Card } from "../components/WorkspaceChrome";
import { SETUP_CHAIN, SETUP_GUIDE_STEPS, type SetupStepShape, stepHref } from "../lib/setupPath";
import { LabSurface, useLabSurface } from "../shell/LabSurface";

/**
 * The written setup guide: an empty database to a two-arm comparison, in dependency order.
 *
 * The chain it walks is `lib/setupPath.ts`'s own table rather than a second list, and this page
 * is now its only reader: nothing in the application projects a lab's progress along it any
 * more (ADR 0045). What that leaves is the reading a person who has not created anything yet
 * needs — what the ten steps are and what refuses until each is satisfied — and what it costs
 * is that somebody returning to a half-built lab is not told here which of them they reached.
 * A step added to that table and not explained here fails to compile, because the copy below is
 * keyed exhaustively by its identifier.
 *
 * `make seed` is at the top, as a command to run in a terminal, and there is no control on this
 * page that performs it or anything else. ADR 0043 decided the seed is a command and never a
 * route, because a running lab must never be one request away from being overwritten with a
 * fixture; a "load demo data" button here would be that route reintroduced as a convenience.
 * Every other step links to the surface where the work is done, so the guide reads the chain
 * and gains no privilege over it (ADR 0044).
 */

function ChainStep({
  step,
  position,
  shop,
}: {
  step: SetupStepShape;
  position: number;
  shop: ShopSummarySchema | null;
}) {
  const copy = SETUP_GUIDE_STEPS[step.id];
  // Composed by `setupPath.ts` rather than here, so a guide link and the band's action for
  // the same step are the same route. Outside a shop there is nowhere to send a reader but
  // the index the chain starts on.
  const href = shop === null ? "/shops" : stepHref(step, shop.shop_id);
  const reachable = shop !== null || step.id === "shop";
  return (
    <li className="grid gap-2 border-b border-admin-border pb-5 last:border-b-0 last:pb-0">
      {/* The chip is a sibling of the heading rather than part of it: inside, every step's
          accessible name would read "1. Shop ends in a published version". */}
      <div className="flex flex-wrap items-baseline gap-2">
        <h3 className="flex items-baseline gap-2 text-[13px] font-semibold text-admin-ink">
          <span className="font-mono text-admin-muted">{position}.</span>
          {step.label}
        </h3>
        {step.publishes ? (
          <span className="rounded-full bg-admin-published px-2 py-0.5 text-[11px] font-semibold text-admin-published-ink">
            ends in a published version
          </span>
        ) : null}
      </div>
      {copy.body.map((paragraph, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: position is a paragraph's identity
        <GuideProse key={index} text={paragraph} />
      ))}
      <p className="text-[12px] text-admin-muted">
        <span className="font-semibold">The gate:</span> {copy.gate}
      </p>
      {reachable ? (
        <p className="text-[12.5px]">
          <Link className="font-semibold text-lab-ink underline-offset-2 hover:underline" to={href}>
            {shop === null ? "Open shops" : step.linkLabel}
          </Link>
        </p>
      ) : null}
    </li>
  );
}

export function SetupGuidePage() {
  const surface = useLabSurface();
  // The links below open a shop, and this is the one they open: the shop last visited in this
  // browser, or the first the lab lists. Named rather than assumed, because a reader with
  // several shops should not have to guess which one a link means.
  const shop = surface.rememberedShop ?? surface.shops[0] ?? null;
  const publishing = SETUP_CHAIN.filter((step) => step.publishes).length;

  return (
    <LabSurface
      surface={surface}
      title="From nothing to a two-arm comparison"
      description="The whole chain, in the order it has to be walked. Nearly every step here refuses until the one before it is satisfied, which is why the order is the guide."
    >
      <div className="grid max-w-3xl gap-4">
        <Card title="The fast path">
          <p className="text-[13px] leading-relaxed text-admin-ink-soft">
            Walking the chain by hand is roughly an afternoon of clicking through gates in
            dependency order. If what you want is to see the product with something in it, run this
            in a terminal in the checkout instead — or press <em>Create the demo</em> on{" "}
            <Link
              className="font-semibold text-lab-ink underline-offset-2 hover:underline"
              to="/settings"
            >
              lab settings
            </Link>
            , which does the same thing to the same database:
          </p>
          <pre className="overflow-x-auto rounded-lg border border-admin-border bg-admin-canvas px-3.5 py-2.5 font-mono text-[13px] text-admin-ink">
            make seed
          </pre>
          <p className="text-[13px] leading-relaxed text-admin-ink-soft">
            It writes one complete worked example — the wrong-address incident, authored end to end
            and driven to completion under two agent frameworks — through the same application
            services this application's own screens call, so every gate below applies to it exactly
            as it applies to you. It needs no provider credential and contacts no provider. It
            refuses rather than merging: a database that is not at the migration head, or that holds
            any row in a table the story writes — seeded before, or authored by hand — is left
            untouched, and the tables that stopped it are named. To start again:
          </p>
          <pre className="overflow-x-auto rounded-lg border border-admin-border bg-admin-canvas px-3.5 py-2.5 font-mono text-[13px] text-admin-ink">
            rm -f var/agent-lab.db && make migrate && make seed
          </pre>
          <p className="text-[13px] leading-relaxed text-admin-ink-soft">
            A running lab is still never one request away from being overwritten, because the
            refusal above is what secures that and the button inherits it whole: a lab holding
            anything at all is declined and keeps every row (ADR 0047). This guide performs nothing
            itself — it reads the chain and links to where each step is done — and the reset path
            stays in a shell, because deleting a database file is not an operation a page should
            offer. The shops list offers something narrower again: <em>Use an example shop</em>{" "}
            fills the create form with a ready-made identity so step 1 below costs no invention. It
            writes one empty draft shop when you press Create, overwrites nothing, and leaves the
            other nine steps exactly where they are.
          </p>
        </Card>

        <Card title={`The chain · ${SETUP_CHAIN.length} steps`}>
          <p className="text-[13px] leading-relaxed text-admin-ink-soft">
            {publishing} of these {SETUP_CHAIN.length} steps end in a published version, which is
            what makes a run reproducible: an experiment pins versions, never drafts. The order
            fixture is authored rather than published, and the experiment is a record rather than a
            definition.{" "}
            {surface.loading
              ? null
              : shop === null
                ? "There is no shop in this lab yet, so the links below start where the chain does."
                : `The links below open ${shop.name}.`}{" "}
            Nothing on this page knows how far you have got: it is the chain rather than a report on
            your lab. Most of the screens it links to are ordinary authoring surfaces and say what
            they are; the ones whose vocabulary is this lab's own — the shop's home and the
            objective-block library here, and the scenario editor, the starting states, the bench
            and the results screen further along — each offer to show you around. What any of the
            words below mean is in the glossary.
          </p>
          <ol className="grid gap-5">
            {SETUP_CHAIN.map((step, index) => (
              <ChainStep key={step.id} step={step} position={index + 1} shop={shop} />
            ))}
          </ol>
        </Card>

        <Card title="What this build will and will not do">
          <p className="text-[13px] leading-relaxed text-admin-ink-soft">
            Without a provider credential configured, this API registers one experiment runtime —
            the deterministic control — so an arm running a model-backed framework is refused the
            moment you advance it, and a comparison produced here has both arms deciding identically
            by construction. That establishes the evidence model rather than a difference between
            frameworks.{" "}
            <Link
              className="font-semibold text-lab-ink underline-offset-2 hover:underline"
              to="/settings"
            >
              Lab settings
            </Link>{" "}
            reports which run mode this build is composed for, and which frameworks, models and
            capabilities it has actually proven it can run.
          </p>
          <p className="text-[13px] leading-relaxed text-admin-ink-soft">
            Reading a finished comparison, and deriving a new run from one by replaying or forking
            it, are each worth a guide of their own. Neither is written yet. Until they are, the{" "}
            <Link
              className="font-semibold text-lab-ink underline-offset-2 hover:underline"
              to="/guides/glossary"
            >
              glossary
            </Link>{" "}
            defines every word those screens use, and each of them offers to show you around.
          </p>
        </Card>

        <p className="text-[13px] text-admin-ink-soft">
          <Link
            className="font-semibold text-lab-ink underline-offset-2 hover:underline"
            to="/guides"
          >
            Back to guides
          </Link>
        </p>
      </div>
    </LabSurface>
  );
}
