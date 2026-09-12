import type { ExperimentHistoryEntrySchema } from "@agent-lab/contracts";
import { ChevronDown, CircleCheck, Compass } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { glossaryTerm } from "../lib/glossary";
import { type GuideModeChoice, useGuideModeChoice, useGuideReading } from "../lib/guide";
import { deriveSetupPath, type ScopedShop, type SetupPath, type SetupStep } from "../lib/setupPath";
import { inkButtonClasses, labNoteClasses, outlineButtonClasses } from "../lib/ui";
import { GlossaryTermLink } from "./GuideProse";
import { canPublish, IssueList, PublishReasons } from "./WorkspaceChrome";

/**
 * The setup path, read off the record and shown as a band above the page header.
 *
 * It names the one action that unblocks the chain and links to the surface where the work is
 * done; it never performs the work, and it exposes no control that populates the lab —
 * `make seed` appears as a command to run in a terminal, because ADR 0043 decided the seed is
 * a command and never a route (ADR 0044).
 *
 * There is no percentage, no step count, and no per-step dismissal. A step is complete because
 * the thing it asks for exists in a listing, so there is no stored progress to show off and
 * nothing per-step to put away. What can be put away is the band itself, which is a preference
 * rather than the dismissal of a step.
 */

const CHOICES: { value: GuideModeChoice; label: string; description: string }[] = [
  {
    value: "follow",
    label: "Follow the lab",
    description:
      "On until this lab holds a completed comparison, off afterwards. Nothing is stored.",
  },
  {
    value: "on",
    label: "Always on",
    description: "Keep the band after the first comparison.",
  },
  {
    value: "off",
    label: "Always off",
    description: "Hide the band on every surface, including an empty lab.",
  },
];

/**
 * The three choices, offered wherever guide mode is offered: the derived default and the two
 * ways of disagreeing with it. Shared by the band and the settings page so a reader is never
 * shown two different vocabularies for one preference.
 */
export function GuideModeChoices({
  idPrefix,
  /** The strip's disclosure already carries the name, so its copy hides the legend. */
  legendHidden = false,
  /** What the preference is, inside the group it describes rather than beside it. */
  description,
}: {
  idPrefix: string;
  legendHidden?: boolean;
  description?: ReactNode;
}) {
  const [choice, chooseMode] = useGuideModeChoice();
  return (
    <fieldset className="grid gap-2">
      <legend className={legendHidden ? "sr-only" : "text-xs font-semibold text-admin-muted"}>
        Guide mode
      </legend>
      {description ? (
        <p className="text-[13px] leading-relaxed text-admin-ink-soft">{description}</p>
      ) : null}
      {CHOICES.map((option) => (
        <label
          key={option.value}
          htmlFor={`${idPrefix}-${option.value}`}
          className="flex items-start gap-2 text-[13px] text-admin-ink-soft"
        >
          <input
            id={`${idPrefix}-${option.value}`}
            type="radio"
            className="mt-0.5"
            name={`${idPrefix}-guide-mode`}
            value={option.value}
            checked={choice === option.value}
            onChange={() => chooseMode(option.value)}
          />
          <span>
            <span className="font-semibold text-admin-ink">{option.label}</span>
            <span className="block text-xs text-admin-muted">{option.description}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

function GuideModeMenu() {
  return (
    <details className="relative">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-full border border-admin-border bg-admin-surface px-3 py-1 text-[11.5px] font-semibold text-admin-ink-soft">
        Guide mode
        <ChevronDown size={11} aria-hidden />
      </summary>
      <div className="absolute right-0 z-10 mt-1.5 w-[320px] rounded-[10px] border border-admin-border bg-admin-surface p-3 shadow-[0_6px_20px_rgb(22_51_45/10%)]">
        <GuideModeChoices idPrefix="strip" legendHidden />
        <p className="mt-2 border-t border-admin-border pt-2 text-xs text-admin-muted">
          Only a disagreement with the derived default is remembered, and only in this browser.{" "}
          <Link
            className="font-semibold text-lab-ink underline-offset-2 hover:underline"
            to="/settings"
          >
            Lab settings
          </Link>{" "}
          shows the same three choices.
        </p>
      </div>
    </details>
  );
}

/** ● now · ◦ waiting · ✓ satisfied by the record. Colour never carries the state alone. */
function ChainRow({ steps, nextStep }: { steps: SetupStep[]; nextStep: SetupStep | null }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-admin-border pt-2 text-[11px] text-admin-muted">
      <ol className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        {steps.map((step, index) => {
          const current = step.id === nextStep?.id;
          return (
            <li key={step.id} className="flex items-center gap-2">
              <span
                className={
                  current
                    ? "font-bold text-lab-ink"
                    : step.complete
                      ? "text-admin-published-ink"
                      : undefined
                }
              >
                <span aria-hidden>{step.complete ? "✓" : current ? "●" : "◦"}</span>{" "}
                <span className="sr-only">
                  {step.complete ? "satisfied:" : current ? "now:" : "waiting:"}
                </span>
                {step.label}
              </span>
              {index < steps.length - 1 ? (
                <span aria-hidden className="text-admin-border">
                  ›
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>
      <span className="ml-auto">● now · ◦ waiting · ✓ satisfied by the record</span>
    </div>
  );
}

/** The words this step uses, each hovering the one place they are defined. */
function GlossaryReferences({ terms }: { terms: readonly string[] }) {
  const defined = terms.map(glossaryTerm).filter((term) => term !== undefined);
  if (defined.length === 0) {
    return null;
  }
  return (
    <p className="text-[11.5px] text-admin-muted">
      In the glossary:{" "}
      {defined.map((term, index) => (
        <span key={term.id}>
          {index > 0 ? ", " : null}
          <GlossaryTermLink id={term.id} label={term.term} />
        </span>
      ))}
    </p>
  );
}

function StepAction({ step, currentPath }: { step: SetupStep; currentPath: string }) {
  const { href, linkLabel } = step.action;
  if (href === null || linkLabel === null || href === currentPath) {
    // The work is done on the surface the reader is already standing on; a link back to here
    // would be an action that goes nowhere.
    return null;
  }
  if (href.startsWith("#")) {
    // Same-page anchor: the form is below the band, so this is a jump rather than a route.
    return (
      <a className={inkButtonClasses} href={href}>
        {linkLabel}
      </a>
    );
  }
  return (
    <Link className={inkButtonClasses} to={href}>
      {linkLabel}
    </Link>
  );
}

/**
 * What the last step was satisfied by, without claiming how it went: the row may still be
 * running, and whether an arm met what was decided for it is the results screen's reading.
 */
function describeExperiment(experiment: ExperimentHistoryEntrySchema): string {
  const arms = experiment.arms
    .map((arm) => `${arm.agent_configuration_name} v${arm.agent_configuration_version}`)
    .join(" with ");
  const scenario = `${experiment.scenario_name} v${experiment.scenario_version}`;
  return arms === ""
    ? `Experiment ${experiment.label} runs ${scenario}.`
    : `Experiment ${experiment.label} puts ${arms} on ${scenario}.`;
}

function CompleteBand({
  path,
  holdsCompletedExperiment,
  choice,
}: {
  path: SetupPath;
  holdsCompletedExperiment: boolean;
  choice: GuideModeChoice;
}) {
  const experiment = path.latestExperiment;
  return (
    <>
      <div className="text-[10.5px] font-bold tracking-[0.06em] text-lab-ink-soft uppercase">
        Setup path · complete
      </div>
      {/* Styled as a headline rather than marked up as one: the band sits above the page's
          own <h1>, and a second-level heading before it would read as a section of nothing. */}
      <p className="text-[14.5px] font-bold tracking-tight">
        Every step of the setup path is satisfied by something in this lab
      </p>
      <p className="text-[12.5px] leading-relaxed text-admin-ink-soft">
        {experiment === null ? "Nothing is left to unblock." : describeExperiment(experiment)}{" "}
        {holdsCompletedExperiment
          ? choice === "on"
            ? "Guide mode is off by default from here; it stays on because you chose that."
            : "Guide mode is off by default from here."
          : "Guide mode stays on until this lab holds a completed comparison."}
      </p>
    </>
  );
}

interface GuideStripProps {
  /** The shop the path is read inside, or `null` on a surface outside shop scope. */
  shop: ScopedShop | null;
  /** The route the band is rendered on, so it never offers a link to the current page. */
  currentPath: string;
}

export function GuideStrip({ shop, currentPath }: GuideStripProps) {
  const [choice] = useGuideModeChoice();
  const reading = useGuideReading(shop?.shopId ?? null);
  if (!reading.on || reading.listings === null) {
    return null;
  }

  const path = deriveSetupPath({ ...reading.listings, shop });
  const step = path.nextStep;
  const gate = step?.id === "shop" ? (shop?.gate ?? null) : null;
  const dirty = shop?.dirty ?? false;
  const errors = gate?.issues.filter((issue) => issue.severity === "error") ?? [];

  return (
    <section
      aria-label="Setup path"
      className={`mb-4 grid gap-2.5 border-l-[3px] px-4 py-3 ${labNoteClasses} ${
        path.complete ? "border-l-lab-success" : "border-l-lab-ink"
      }`}
    >
      <div className="flex items-start gap-3">
        {path.complete ? (
          <CircleCheck className="mt-0.5 flex-none text-lab-success" size={16} aria-hidden />
        ) : (
          <Compass className="mt-0.5 flex-none text-lab-ink" size={16} aria-hidden />
        )}
        <div className="grid min-w-0 flex-1 gap-1.5">
          {step === null ? (
            <CompleteBand
              path={path}
              holdsCompletedExperiment={reading.holdsCompletedExperiment}
              choice={choice}
            />
          ) : (
            <>
              <div className="text-[10.5px] font-bold tracking-[0.06em] text-lab-ink-soft uppercase">
                Setup path · next step
              </div>
              <p className="text-[14.5px] font-bold tracking-tight">{step.action.headline}</p>
              {step.action.body ? (
                <p className="text-[12.5px] leading-relaxed text-admin-ink-soft">
                  {step.action.body}
                  {step.action.command ? (
                    <>
                      {" "}
                      In a terminal,{" "}
                      <code className="rounded border border-admin-border bg-admin-surface px-1.5 py-0.5 font-mono text-[11.5px]">
                        {step.action.command}
                      </code>{" "}
                      walks the whole chain at once and leaves a lab this band reads as complete.
                    </>
                  ) : null}
                </p>
              ) : null}
              <GlossaryReferences terms={step.terms} />
              {gate !== null && !canPublish(gate, dirty) ? (
                // The gate's own finding, in the gate's own components, and shown exactly when
                // the gate itself would refuse — `canPublish` is the same predicate the publish
                // button uses, so the band cannot say "nothing blocks it" over a draft the
                // editor is refusing to freeze.
                //
                // One finding, and the one the action opens: this is a band above a page whose
                // own card lists them all, and `PublishReasons` still says how many there are,
                // so showing the first is a shorter reading of the gate rather than a partial
                // one. Which is first is the gate's ordering, not the band's.
                <div className="grid gap-1.5 rounded-lg border border-admin-border bg-admin-surface px-3 py-2">
                  {errors.length > 0 ? <IssueList issues={errors.slice(0, 1)} /> : null}
                  <PublishReasons preview={gate} dirty={dirty} />
                </div>
              ) : null}
            </>
          )}
        </div>
        <div className="flex flex-none items-center gap-2.5">
          {step === null ? (
            path.latestExperiment === null ? null : (
              <Link
                className={outlineButtonClasses}
                to={`/shops/${path.latestExperiment.shop_id}/bench/${path.latestExperiment.experiment_id}/results`}
              >
                Read the comparison
              </Link>
            )
          ) : (
            <StepAction step={step} currentPath={currentPath} />
          )}
          <Link
            className="text-[12.5px] font-semibold text-lab-ink underline-offset-2 hover:underline"
            to="/guides"
          >
            Guides
          </Link>
          <GuideModeMenu />
        </div>
      </div>
      {path.scoped ? <ChainRow steps={path.steps} nextStep={step} /> : null}
    </section>
  );
}
