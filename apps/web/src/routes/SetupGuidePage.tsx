import type { ShopSummarySchema } from "@agent-lab/contracts";
import { Link } from "react-router-dom";
import { GuideProse } from "../components/GuideProse";
import { Card } from "../components/WorkspaceChrome";
import { SETUP_CHAIN, type SetupStepId, type SetupStepShape, stepHref } from "../lib/setupPath";
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

export interface StepCopy {
  /** What this link of the chain is, in `[[term-id]]` markup. */
  body: readonly string[];
  /** The gate standing between this step and the next — the reason the order is an order. */
  gate: string;
}

/**
 * Exported so the same test that reads the tours' vocabulary reads this page's, since a term
 * here resolving to nothing would render as a bare word exactly as it would there.
 */
export const SETUP_GUIDE_STEPS: Record<SetupStepId, StepCopy> = {
  shop: {
    body: [
      "A [[shop]] is the synthetic commerce platform an incident happens inside: the catalog, the policies and FAQ the agent reaches through tools, the payment and fulfilment methods an order can use, and the named tone-of-voice guidelines it answers in. Nothing else in this chain exists outside one — every later step is either authored in a shop or published against one.",
      "The shop's home lists whatever its publish gate is still refusing, and those words are the gate's own rather than a second opinion. Publishing freezes the draft as version 1; the draft stays yours to keep editing, and nothing that pinned v1 moves when you do.",
    ],
    gate: "Until a shop has one published version, a ticket cannot be published against it.",
  },
  customer: {
    body: [
      "A [[customer-profile|customer profile]] is a fictional person — identity, behaviour, account state, and a named address book with one default entry. Attach one to the shop and publish it.",
      "Publication matters more here than it looks: a ticket pins the customer version it was written against, so the person who complained stays the person the record says complained, however the profile is edited afterwards.",
    ],
    gate: "A ticket can only name a profile that is attached to its shop and published.",
  },
  order: {
    body: [
      "The [[order|order fixture]] is the commerce state the incident is about: line items, payment and fulfilment status, the authored events that got it there, and a shipping address selected from the customer's address book and stored as a frozen copy labelled with where it came from.",
      "It is the only definition in this chain with no version of its own. A recipe names the order rather than freezing it, and the copy is taken later, when a [[sandbox-snapshot|snapshot]] is materialized — so an order edited after the recipe is published changes the starting state of the next run.",
    ],
    gate: "A scenario binds its objectives to this shop's own orders, and a starting state copies the one the recipe named.",
  },
  ticket: {
    body: [
      "A [[ticket]] is the incident as it arrives: the channel, the page it was opened from, whatever was said before, and the triggering first message. Every [[run|arm]] of every experiment built on this ticket opens on that message, which is what makes two agents answer the same question rather than two similar ones.",
      "Publishing it pins the shop version and the customer version it was authored against.",
    ],
    gate: "A scenario is built on one published ticket and cannot be composed without one.",
  },
  blocks: {
    body: [
      "Two libraries, shared across every shop rather than owned by this one. [[objective-block|Objective blocks]] are what an experiment asserts; [[mutation-block|mutation blocks]] are what goes wrong in the middle of it. Both are parameterized templates rather than statements about your shop — a [[scenario]] binds their parameters to its own shop's objects and pins the template version it composed.",
      "Publish at least one objective: a recipe with nothing to decide decides nothing. A fault is optional, and a recipe with none is simply an incident where nothing interrupts.",
    ],
    gate: "A scenario can only bind a template that has a published version.",
  },
  scenario: {
    body: [
      "The [[scenario]] is the experiment recipe, and it is deliberately not a conversation script. Composed on the published ticket, it adds the hidden facts only you can see, the context documents the agent may find through tools, the objective and mutation bindings, and the conditions — including a turn cap — that end a run.",
      "Publishing it freezes the recipe and pins every version it reaches: the ticket, the shop, each block template. Its starting-states page then materializes a [[sandbox-snapshot|snapshot]], which is the world both arms will begin in.",
    ],
    gate: "An experiment pins one published scenario version; a draft cannot be run.",
  },
  "support-identity": {
    body: [
      "A [[support-identity|support identity]] is the role the agent under test adopts: its seniority, what it is permitted to do, and its operating guidance. It is not the voice — that belongs to the shop, so that two agents compared in the same shop cannot accidentally differ in how they sound.",
      "Like the block libraries it is shop-independent, and like everything else it is published, because an agent configuration adopts a version of it and its permissions are what authorize the writes that agent's tools may make.",
    ],
    gate: "An agent configuration's enabled tools are checked against the identity it adopts.",
  },
  "agent-configurations": {
    body: [
      "An [[agent-configuration|agent configuration]] is one agent under test, published as a version like everything else: framework, architecture, model, prompt template, tool bindings, memory, runtime settings, and the support identity it adopts.",
      "Publish two. A comparison is only attributable if they differ in one dimension — the framework, the architecture, or the configuration — and the lab warns when an experiment's arms differ in more than one, because a run that moved two things cannot tell you which one moved the result.",
    ],
    gate: "A two-arm experiment needs two published configurations to bind.",
  },
  judge: {
    body: [
      "A [[judge-configuration|judge configuration]] is the versioned rubric, the model that reads it, and the declared list of what that model is shown. It fills the rows no rule can decide — whether the explanation was correct, clear, and actually resolved the request.",
      "It reads one arm at a time, from an anonymized brief that names no framework, provider or model, and it never overwrites the [[evaluation|deterministic evidence]] standing beside it.",
    ],
    gate: "Objectives a scenario left to a judge stay deferred until a scoring pass is run from the bench with a published judge.",
  },
  experiment: {
    body: [
      "Start the [[experiment]] from the bench. Starting one freezes a [[sandbox-snapshot|starting state]] from the recipe version and the seed it is given, clones that into one arm per configuration, opens both threads on the ticket's triggering message, and hands you the composer — you are the [[participant-driver|participant driver]], so the customer's later turns are yours.",
      "Advance each arm, answer as the customer, and let any bound fault fire. When both arms have finished, the results screen reads them objective by objective, arm beside arm, with no aggregate score anywhere.",
    ],
    gate: "The setup gate refuses an experiment whose inputs are not all published, and warns when its two arms differ in more than one dimension.",
  },
};

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
        <Card title="The fast path is a command">
          <p className="text-[13px] leading-relaxed text-admin-ink-soft">
            Walking the chain by hand is roughly an afternoon of clicking through gates in
            dependency order. If what you want is to see the product with something in it, run this
            in a terminal in the checkout instead:
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
            There is no button for any of this, here or anywhere else in the application, and there
            deliberately never will be. A running lab must never be one request away from being
            overwritten with a fixture, and the refusal a seed can hit — a database that is not
            empty — is one you have to be able to read and act on in a shell anyway.
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
            and the results screen further along — offer to show you around while guide mode is on.
            What any of the words below mean is in the glossary.
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
            defines every word those screens use, and each of them offers to show you around while
            guide mode is on.
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
