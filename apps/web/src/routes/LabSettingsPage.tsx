import type {
  AgentConfigurationResourcesResponse,
  LabSeedResponse,
  LabStatusResponse,
  ProvenFrameworkSchema,
  ShopSummarySchema,
} from "@agent-lab/contracts";
import { ArrowLeft, ChevronDown, ChevronRight, Lock } from "lucide-react";
import { type ReactNode, useEffect, useId, useState } from "react";
import { Link } from "react-router-dom";
import { readAgentConfigurationResources } from "../api/agentConfigurations";
import { describeApiError } from "../api/client";
import { seedLab } from "../api/labSeed";
import { getLabStatus } from "../api/labStatus";
import { ButtonIcon } from "../components/ButtonIcon";
import { Field, FieldGroup, FieldRows } from "../components/FieldHint";
import { Card, EntryCard, EntryId, EntryKind, PageHeader } from "../components/WorkspaceChrome";
import { describeArchitecture, describeProvider, readableTerm } from "../lib/agents";
import {
  type AppLanding,
  forgetLastVisitedShop,
  readAppLanding,
  readLastVisitedShop,
  readNavigationCollapsed,
  readSettingsReturn,
  readTimestampFormat,
  resetChosenPreferences,
  type TimestampFormat,
  writeAppLanding,
  writeNavigationCollapsed,
  writeTimestampFormat,
} from "../lib/preferences";
import {
  cardTitleClasses,
  focusRingClasses,
  formatAbsoluteTimestamp,
  outlineButtonClasses,
  subtleButtonClasses,
  warningButtonClasses,
} from "../lib/ui";
import { AppShell } from "../shell/AppShell";
import type { LabSurfaceValue } from "../shell/LabSurface";
import { useLabSurface } from "../shell/useLabSurface";

/**
 * A value composed at start-up, quoted where it can be changed: an environment variable, a
 * file path, a model name.
 *
 * `EntryId`'s own span does not wrap, which is right for an identifier in a chip row and wrong
 * for `AGENT_LAB_OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:6006/v1/traces` inside a card
 * that hides its overflow — the one line on this page long enough to be clipped by it.
 */
function ConfigValue({ children }: { children: ReactNode }) {
  return (
    <code className="rounded bg-admin-border/60 px-1.5 py-0.5 font-mono text-[12px] text-admin-ink-soft [overflow-wrap:anywhere]">
      {children}
    </code>
  );
}

/**
 * One of the settings page's zones: a display heading, a line beside it saying what the zone
 * is, an optional control at the right, and whatever the zone holds.
 *
 * The zones are told apart twice over, because *at a glance* and *read out* are two different
 * readers. By **surface**: white where the cards may be edited, grey behind a padlock where
 * they report and cannot. By **role and heading**: each zone is a landmark named by its own
 * `h2`, so a reader who sees no colour still arrives at a run of named places rather than one
 * run of cards.
 */
function Zone({
  title,
  description,
  action,
  children,
}: {
  title: ReactNode;
  description: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="grid gap-3">
      <div className="flex flex-wrap items-baseline gap-3">
        <h2 id={headingId} className="font-display text-[18px] font-bold tracking-[-0.01em]">
          {title}
        </h2>
        <p className="min-w-0 flex-1 text-[12.5px] leading-[1.5] text-admin-muted [text-wrap:pretty]">
          {description}
        </p>
        {action}
      </div>
      {children}
    </section>
  );
}

/**
 * A card in the read-only zone: the grey ground, the padlock, and the "To change it:" line
 * every one of them ends in.
 *
 * It is not `Card` with a colour swapped. `Card`'s heading is an `h2`, and these sit under the
 * zone's own `h2`; and the line at the foot is the whole point of the treatment — a card that
 * says it cannot be edited here without saying where it can be is a dead end.
 */
function ReadOnlyCard({
  title,
  change,
  children,
}: {
  title: string;
  change: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={title}
      className="overflow-hidden rounded-[10px] border border-admin-border bg-[#f6f7f8]"
    >
      <h3
        className={`flex items-center gap-2.5 border-b border-[#e5e9ec] px-[18px] py-[13px] ${cardTitleClasses}`}
      >
        <Lock size={13} aria-hidden="true" focusable="false" className="flex-none opacity-55" />
        {title}
      </h3>
      <div className="grid gap-2.5 px-[18px] py-4 text-[13px] leading-[1.6] text-admin-ink-soft">
        {children}
        <p className="text-xs text-admin-muted">To change it: {change}</p>
      </div>
    </section>
  );
}

/**
 * A closed set of two or three, drawn as the prototype's segmented control.
 *
 * Native radios underneath, because *a closed set is named radios* (`docs/design-direction.md`,
 * *The form language*) and because the prototype's own segments are `div`s with no role and no
 * name at all. The input carries the name and the keyboard behaviour; the label carries the
 * drawing, and takes the focus ring off the input beside it.
 */
function SegmentedChoice<T extends string>({
  name,
  value,
  options,
  onChoose,
}: {
  name: string;
  value: T;
  options: readonly (readonly [T, string])[];
  onChoose: (value: T) => void;
}) {
  const group = useId();
  return (
    <div className="inline-flex flex-wrap rounded-[9px] border border-[#dfe3e6] bg-[#f6f7f8] p-[3px]">
      {options.map(([option, label]) => (
        <label
          key={option}
          className={`flex min-h-[34px] cursor-pointer items-center rounded-[7px] px-[13px] text-[12.5px] whitespace-nowrap transition has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-lab-primary ${
            option === value
              ? "bg-admin-surface font-bold text-admin-ink shadow-[0_1px_2px_rgb(22_51_45/10%)]"
              : "font-semibold text-admin-muted hover:text-admin-ink"
          }`}
        >
          <input
            type="radio"
            className="sr-only"
            name={`${group}-${name}`}
            checked={option === value}
            onChange={() => onChoose(option)}
          />
          {label}
        </label>
      ))}
    </div>
  );
}

/** The three openings, in the prototype's order and its words. */
const APP_LANDINGS: readonly (readonly [AppLanding, string])[] = [
  ["last-shop", "Last shop"],
  ["shops", "All shops"],
  ["lab", "Experiment lab"],
];

const APP_LANDING_HINTS: Readonly<Record<AppLanding, string>> = {
  "last-shop": "The shop you were last in, straight to its overview.",
  shops: "The list of shops, so you choose deliberately each time.",
  lab: "Straight to the experiment lab, for when you rarely touch a shop's setup.",
};

const TIMESTAMP_FORMATS: readonly (readonly [TimestampFormat, string])[] = [
  ["relative", "Relative"],
  ["absolute", "Absolute"],
];

/**
 * The instant the *absolute* reading's hint is drawn from. It goes through the formatter
 * rather than being typed beside it, so the hint cannot come to describe a shape the
 * workspace stopped drawing, and it renders in the reader's own zone, which is the one it is
 * an example of. The relative reading's hint is the prototype's own literal, because there is
 * no fixed instant a formatter could render "12 minutes ago" from.
 */
const TIMESTAMP_EXAMPLE = "2026-09-19T14:07:00+00:00";

/**
 * *Your preferences*: white, saved the moment they change, with one control that puts back the
 * three an operator chose.
 *
 * Four rows, not the prototype's seven. Auto-offered tours and table density are cut
 * (`docs/design-direction.md`, *Proposals, not decisions*; ADR 0049 refused the first
 * outright), and confirm-before-delete lands with the confirm it governs.
 */
function PreferencesZone({ surface }: { surface: LabSurfaceValue }) {
  const [landing, setLanding] = useState(readAppLanding);
  const [collapsed, setCollapsed] = useState(readNavigationCollapsed);
  const [stamps, setStamps] = useState(readTimestampFormat);
  const [rememberedId, setRememberedId] = useState(readLastVisitedShop);

  const rememberedShop = surface.shops.find((shop) => shop.shop_id === rememberedId) ?? null;

  function chooseLanding(next: AppLanding) {
    setLanding(next);
    writeAppLanding(next);
  }

  function chooseCollapsed(next: boolean) {
    setCollapsed(next);
    writeNavigationCollapsed(next);
  }

  function chooseStamps(next: TimestampFormat) {
    setStamps(next);
    writeTimestampFormat(next);
  }

  function forget() {
    setRememberedId(null);
    forgetLastVisitedShop();
  }

  function reset() {
    setLanding("last-shop");
    setCollapsed(false);
    setStamps("relative");
    resetChosenPreferences();
  }

  return (
    <Zone
      title="Your preferences"
      description="Saved in this browser the moment you change them — there is nothing to submit, and none of them reaches another browser or says anything about the lab."
      action={
        <button type="button" className={outlineButtonClasses} onClick={reset}>
          <ButtonIcon verb="discard" />
          Reset to defaults
        </button>
      }
    >
      <Card>
        <FieldRows>
          <FieldGroup
            label="Where the app opens"
            hint={
              landing === "last-shop" && rememberedShop === null && !surface.loading
                ? `${APP_LANDING_HINTS[landing]} With none remembered it opens the list of shops instead.`
                : APP_LANDING_HINTS[landing]
            }
          >
            <SegmentedChoice
              name="app-landing"
              value={landing}
              options={APP_LANDINGS}
              onChoose={chooseLanding}
            />
          </FieldGroup>

          <FieldGroup
            label="Last-visited shop"
            hint="Remembered as you move, so the opening above has somewhere to go. Forgetting it opens the list of shops instead."
          >
            {rememberedShop ? (
              <div className="flex flex-wrap items-center gap-4">
                <Link
                  className={`text-[13px] font-bold text-lab-ink underline-offset-2 hover:underline ${focusRingClasses}`}
                  to={`/shops/${rememberedShop.shop_id}`}
                >
                  {rememberedShop.name}
                </Link>
                <button
                  type="button"
                  className={subtleButtonClasses}
                  aria-label={`Forget ${rememberedShop.name}`}
                  onClick={forget}
                >
                  Forget
                </button>
              </div>
            ) : surface.loading || surface.error ? (
              // Until the shop list answers, this page has not established that there is no
              // remembered shop — only that it cannot yet name one.
              <p className="text-[13px] text-admin-muted">Reading…</p>
            ) : (
              <p className="text-[13px] text-admin-muted">
                None yet. Open a shop and this browser remembers the way back.
              </p>
            )}
          </FieldGroup>

          <Field
            label="Start with the navigation rail collapsed"
            hint="The rail's own collapse control writes this same preference."
          >
            <input
              type="checkbox"
              checked={collapsed}
              onChange={(event) => chooseCollapsed(event.target.checked)}
            />
          </Field>

          <FieldGroup
            label="Timestamps"
            hint={
              stamps === "relative"
                ? "Shown as 12 minutes ago. Easier to read a fresh run with."
                : `Shown as ${formatAbsoluteTimestamp(TIMESTAMP_EXAMPLE)}. Easier to quote in a report with.`
            }
          >
            <SegmentedChoice
              name="timestamp-format"
              value={stamps}
              options={TIMESTAMP_FORMATS}
              onChoose={chooseStamps}
            />
          </FieldGroup>
        </FieldRows>
      </Card>
    </Zone>
  );
}

/**
 * The *Model provider* zone's place, held by one card until the connection is built.
 *
 * It is drawn on the white surface rather than the read-only grey, because the surface says
 * whose the zone is and this one is going to be the operator's: a padlock here would promise
 * the opposite of what lands in it. What the card says instead is that there is nothing to
 * edit yet, and which of the two sources ADR 0052 names is in force meanwhile — the
 * environment, which stays the bootstrap after the connection exists and is the whole of the
 * answer before it does.
 */
function ModelProviderZone() {
  return (
    <Zone
      title="Model provider"
      description="Any OpenAI-compatible endpoint — hosted or one you run yourself. Saved for the whole lab, not just this browser."
    >
      <Card>
        <p className="text-[13px] leading-relaxed text-admin-ink-soft">
          Not built yet. The lab will hold one connection per provider — a base URL and an encrypted
          key, and no model — saved here and resolved when an arm is advanced, so a run records the
          endpoint it reached (ADR 0052). Slice 19 of <ConfigValue>docs/PLAN-UX.md</ConfigValue>{" "}
          builds it.
        </p>
        <p className="text-[13px] leading-relaxed text-admin-ink-soft">
          Until then the environment is the whole of it:{" "}
          <ConfigValue>AGENT_LAB_OPENAI_API_KEY</ConfigValue>, read when the API started, is what is
          in force, and <em>Run mode</em> below reports what that leaves this build able to advance.
          The environment stays the bootstrap afterwards — a saved connection wins where there is
          one, and the environment answers where there is not.
        </p>
      </Card>
    </Zone>
  );
}

function FrameworkRow({ framework }: { framework: ProvenFrameworkSchema }) {
  return (
    // One level deeper than a list of these usually sits: the card holding them is an `h3`
    // under the zone's `h2`, so a row at `h3` would read as the card's sibling.
    <EntryCard
      title={framework.label}
      titleLevel={4}
      chips={<EntryId value={framework.framework_id} />}
    >
      <p className="text-[13px] text-admin-ink-soft">{framework.summary}</p>
      <dl className="grid gap-1.5 text-[12.5px] text-admin-ink-soft sm:grid-cols-[110px_minmax(0,1fr)]">
        <dt className="font-semibold text-admin-muted">Architectures</dt>
        <dd>{framework.architectures.map(describeArchitecture).join(", ")}</dd>
        <dt className="font-semibold text-admin-muted">Provider · model</dt>
        <dd>
          {framework.providers.map(describeProvider).join(", ")} · {framework.models.join(", ")}
        </dd>
        <dt className="font-semibold text-admin-muted">Proven</dt>
        <dd className="flex flex-wrap gap-1.5">
          {framework.capabilities.map((capability) => (
            <EntryKind key={capability} value={readableTerm(capability)} />
          ))}
        </dd>
      </dl>
    </EntryCard>
  );
}

/**
 * The one control in this application that populates the lab (ADR 0047).
 *
 * ADR 0043 refused this a route on the grounds that "a running lab must never be one request
 * away from being overwritten with a fixture", and ADR 0047 keeps that sentence: what makes
 * the seed safe is its refusal, which the route inherits whole. A lab holding anything at all
 * gets 409 and keeps every row. So the danger this guards against is not lost data but a
 * pointless wait, and the guard is proportionate — one confirmation press, because a button
 * that writes a dozen published versions should take more than a stray click, and no typed
 * phrase, because there is nothing here to lose.
 *
 * It is a zone of its own rather than a card among the preferences, because it is an action:
 * it runs once and changes what the lab holds, where everything above it only changes how the
 * lab is read.
 */
function FastPathZone({ shops, onSeeded }: { shops: ShopSummarySchema[]; onSeeded: () => void }) {
  const [arming, setArming] = useState(false);
  const [running, setRunning] = useState(false);
  const [seeded, setSeeded] = useState<LabSeedResponse | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  // A lab with a shop in it will be refused, and saying so before the press is kinder than
  // spending a request to be told. It is a hint and not the gate: the server counts every
  // table the story writes, and this browser can only see one of them.
  const occupied = shops.length > 0;

  async function write() {
    setArming(false);
    setRunning(true);
    setRefusal(null);
    try {
      setSeeded(await seedLab());
      onSeeded();
    } catch (cause: unknown) {
      setRefusal(describeApiError(cause, "The demo could not be written."));
    } finally {
      setRunning(false);
    }
  }

  return (
    <Zone
      title="The fast path"
      description="An action, not a setting. It runs once and changes what the lab holds."
    >
      <Card>
        <FieldRows>
          <FieldGroup
            label="Create the demo"
            hint={
              <>
                A shop with a catalog, a customer with an incident, and a finished comparison of two
                agent frameworks — the same thing <ConfigValue>make seed</ConfigValue> does in a
                terminal. It works on an empty lab only, and never touches a lab that already holds
                something.
              </>
            }
          >
            {seeded === null ? (
              <div className="grid justify-items-start gap-1.5">
                <button
                  className={arming ? warningButtonClasses : outlineButtonClasses}
                  type="button"
                  disabled={running || occupied}
                  onClick={() => (arming ? write() : setArming(true))}
                >
                  {running
                    ? "Creating the demo…"
                    : arming
                      ? "Press again to create it"
                      : "Create the demo"}
                </button>
                {/* The live region is mounted whether or not it has anything to say, so the
                    armed message is announced rather than appearing as a new element. Idle and
                    empty is the prototype's own `seedNote`. */}
                <p className="text-xs text-admin-muted" role="status">
                  {occupied
                    ? "This lab is not empty, so there is nothing to create here."
                    : arming
                      ? "Nothing is created until you press again."
                      : ""}
                </p>
              </div>
            ) : (
              <div className="grid gap-1.5">
                <p className="text-[13px] text-admin-ink-soft">
                  Written. The comparison is on the history screen.
                </p>
                <p className="flex flex-wrap gap-3 text-[13px]">
                  <Link
                    className="font-semibold text-lab-ink underline-offset-2 hover:underline"
                    to={`/shops/${seeded.shop_id}`}
                  >
                    Open the shop
                  </Link>
                  <Link
                    className="font-semibold text-lab-ink underline-offset-2 hover:underline"
                    to={`/lab/bench/${seeded.shop_id}/${seeded.experiment_id}/results`}
                  >
                    Read the comparison
                  </Link>
                </p>
              </div>
            )}
            {refusal === null ? null : (
              <p role="alert" className="mt-2 text-[13px] leading-relaxed text-lab-error">
                {refusal}
              </p>
            )}
          </FieldGroup>
        </FieldRows>
      </Card>
    </Zone>
  );
}

/**
 * Run mode and trace export are one request; "this build" is another. They are rendered from
 * separate state for the same reason they are fetched separately: run mode needs no database,
 * and a listing that fails should not take a read-out that answered with it.
 */
interface Reading<T> {
  value: T | null;
  loading: boolean;
  error: string | null;
}

function Unavailable({ reading }: { reading: Reading<unknown> }) {
  if (reading.loading) {
    return <p className="text-[13px] text-admin-muted">Reading…</p>;
  }
  return (
    <p role="alert" className="text-[13px] text-lab-error">
      {reading.error}
    </p>
  );
}

// Run mode is not a version state, so it does not borrow the published/draft palette: those
// two colours mean "frozen" and "in progress" everywhere else in the workspace. Like every
// other chip here it pairs its colour with a glyph and a written label.
const runModeChipClasses =
  "inline-flex items-center gap-1.5 rounded-full bg-admin-border px-2.5 py-0.5 text-[11.5px] font-semibold text-admin-ink-soft";

function RunModeCard({ reading }: { reading: Reading<LabStatusResponse> }) {
  const status = reading.value;
  return (
    <ReadOnlyCard
      title="Run mode"
      change={
        <>
          set <ConfigValue>AGENT_LAB_OPENAI_API_KEY</ConfigValue> in the API's environment and
          restart it. Read once at start-up; nothing on this page moves it.
        </>
      }
    >
      {status === null ? (
        <Unavailable reading={reading} />
      ) : (
        <>
          <p className="flex flex-wrap items-center gap-2 text-[13px]">
            <span className={runModeChipClasses}>
              <span aria-hidden>{status.run_mode === "credentialed" ? "●" : "◦"}</span>
              {status.run_mode === "credentialed" ? "Credentialed" : "Offline"}
            </span>
            <span className="text-admin-ink-soft">
              Configured model <EntryId value={status.model_id} />
            </span>
          </p>
          {status.run_mode === "offline" ? (
            // The standing version of the qualification ADR 0042 established and ADR 0043
            // could only write onto one seeded run. It belongs here because it is a property
            // of the build: a run an operator drove themselves without a credential inherits
            // it too, and carries no label because nobody wrote one.
            <p className="leading-relaxed">
              No provider credential is configured, so only the deterministic control arm can be
              advanced here: both model-backed frameworks reach their provider under the same
              credential, and an arm running either is refused the moment it is advanced. Any
              comparison this lab does hold offline — the seeded demo among them — has both arms'
              decisions held identical by construction, so what it establishes is the evidence
              model: that tool calls, state changes, objectives, traces and cost reach the record.
              Only a credentialed run answers how two frameworks actually choose.
            </p>
          ) : (
            <p className="leading-relaxed">
              A provider credential is configured, so a model-backed arm reaches the provider and a
              two-arm comparison can be about how the frameworks actually choose. What an experiment
              ran is still the model its published agent configuration named; the model above is
              only what this process would reach for.
            </p>
          )}
        </>
      )}
    </ReadOnlyCard>
  );
}

function TraceExportCard({ reading }: { reading: Reading<LabStatusResponse> }) {
  const status = reading.value;
  return (
    <ReadOnlyCard
      title="Trace export"
      change={
        <>
          start <ConfigValue>infra/phoenix/compose.yaml</ConfigValue>, set{" "}
          <ConfigValue>
            AGENT_LAB_OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:6006/v1/traces
          </ConfigValue>{" "}
          in the API's environment, restart it, and open{" "}
          <ConfigValue>http://localhost:6006</ConfigValue>.
        </>
      }
    >
      {status === null ? (
        <Unavailable reading={reading} />
      ) : status.trace_export_configured ? (
        <>
          <p className="leading-relaxed">
            An OTLP endpoint is configured, so the spans the lab opens leave this process under the
            written allowlist: pseudonymized identifiers, an arm's position, the turn, the framework
            and the published tool name and version. No free-form string of the lab's own is
            exported. A framework SDK that exports its own spans is a separate path the lab does not
            write and cannot promise the sanitization of.
          </p>
          <p className="text-xs text-admin-muted">
            The endpoint itself is not reported here. A collector URL is a place a deployment can
            put a token, and a route that served it would serve that token the day one did.
          </p>
        </>
      ) : (
        <p className="leading-relaxed">
          No OTLP endpoint is configured. The lab still records a span tree beside every experiment
          arm it advances — the traces tab on a run reads that record, not an exporter — but nothing
          is exported anywhere.
        </p>
      )}
    </ReadOnlyCard>
  );
}

function ProvenBuildCard({ reading }: { reading: Reading<AgentConfigurationResourcesResponse> }) {
  return (
    <ReadOnlyCard
      title="What this build can run"
      change={
        <>
          add the adapter and the suite that proves it, and the framework joins{" "}
          <ConfigValue>PROVEN_FRAMEWORKS</ConfigValue> in{" "}
          <ConfigValue>application/agent_capabilities.py</ConfigValue>. It is a property of the
          build rather than of this deployment.
        </>
      }
    >
      <p className="leading-relaxed">
        The frameworks this lab has an implementation for and a suite that keeps exercising it, with
        the envelope each was proven inside. An agent configuration naming a framework, architecture
        or provider outside this table cannot be published; naming a model outside it is a warning
        that does not block publication.
      </p>
      {reading.value === null ? (
        <Unavailable reading={reading} />
      ) : (
        <ul className="grid gap-2">
          {reading.value.frameworks.map((framework) => (
            <FrameworkRow key={framework.framework_id} framework={framework} />
          ))}
        </ul>
      )}
    </ReadOnlyCard>
  );
}

/**
 * *Runtime configuration · Read only*, as a collapsed disclosure.
 *
 * Collapsed by default and held in component state, not in a preference: the handoff lists it
 * with the tour index and the switcher panel as ephemeral, and a lab's composition is the thing
 * on this page an operator least often needs and can least often act on.
 *
 * The three cards keep ADR 0044's character whole — the surface reports composition and never
 * edits it — and each one now ends where that ADR's argument ends, in the environment variable
 * or the file that does change it.
 */
function RuntimeZone({
  status,
  resources,
}: {
  status: Reading<LabStatusResponse>;
  resources: Reading<AgentConfigurationResourcesResponse>;
}) {
  const [open, setOpen] = useState(false);
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className="overflow-hidden rounded-[10px] border border-admin-border bg-[#fbfcfc]"
    >
      <h2 id={headingId}>
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className={`flex w-full items-center gap-2.5 px-[18px] py-[15px] text-left text-[13.5px] font-bold text-admin-ink transition hover:bg-[#f4f6f6] ${focusRingClasses}`}
        >
          {open ? (
            <ChevronDown size={13} aria-hidden="true" focusable="false" className="opacity-65" />
          ) : (
            <ChevronRight size={13} aria-hidden="true" focusable="false" className="opacity-65" />
          )}
          Runtime configuration
          <span className="font-semibold text-admin-muted">· Read only</span>
        </button>
      </h2>
      {open ? (
        <div className="grid gap-3 border-t border-[#eceef0] px-[18px] pt-4 pb-5">
          <p className="text-[12.5px] leading-[1.5] text-admin-muted [text-wrap:pretty]">
            Read from the environment when the API started. Nothing below can be edited from the
            app; each card names what to change instead.
          </p>
          <RunModeCard reading={status} />
          <TraceExportCard reading={status} />
          <ProvenBuildCard reading={resources} />
        </div>
      ) : null}
    </section>
  );
}

function useReading<T>(load: (signal: AbortSignal) => Promise<T>, unavailable: string): Reading<T> {
  const [reading, setReading] = useState<Reading<T>>({
    value: null,
    loading: true,
    error: null,
  });

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal)
      .then((value) => setReading({ value, loading: false, error: null }))
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setReading({ value: null, loading: false, error: describeApiError(cause, unavailable) });
        }
      });
    return () => controller.abort();
    // The two loaders below are module-level functions, so this runs once per mount.
  }, [load, unavailable]);

  return reading;
}

const loadStatus = (signal: AbortSignal) => getLabStatus(signal);
const loadResources = (signal: AbortSignal) => readAgentConfigurationResources(signal);

/**
 * The lab's settings, in the prototype's three zones with its action under them
 * (`Workspace.dc.html` :3854).
 *
 * A centred column rather than the two the page used to run in: *Principles* already exempts
 * "the settings column cap" from the rule that nothing is fixed width, and the zones read as a
 * sequence from the ones an operator owns to the ones the environment does.
 *
 * *Back to workspace* is the bar's Settings toggle written as a link in the page — the same
 * remembered location, read from the same preference (ADR 0055), so there is one answer to
 * "what was underneath this" and not two. It is not resolved against anything before the move,
 * for the reason that ADR gives: resolving an arbitrary path would mean a second copy of the
 * route tree, and a browser that remembers nowhere goes to the shops index.
 */
export function LabSettingsPage() {
  const surface = useLabSurface();
  const status = useReading(loadStatus, "The lab could not report how it is composed.");
  const resources = useReading(loadResources, "The lab could not report what it can run.");
  // Read once, at mount: the shell stops rewriting it the moment `/settings` is open, so it
  // cannot move underneath the reader while they are standing here.
  const [back] = useState(() => readSettingsReturn() ?? "/shops");

  return (
    <AppShell shops={surface.shops}>
      <div className="mx-auto grid w-full max-w-[1024px] gap-[26px] pb-12">
        <div>
          <Link
            to={back}
            className={`mb-[26px] inline-flex items-center gap-[7px] rounded text-[13px] font-semibold text-lab-primary hover:text-lab-primary-hover ${focusRingClasses}`}
          >
            <ArrowLeft size={15} aria-hidden="true" focusable="false" />
            Back to workspace
          </Link>
          <PageHeader
            title="Lab settings"
            description="Three things live here, and they are kept apart: the preferences saved in this browser, the model provider the whole lab runs through, and the runtime configuration composed when the API started — reported below, read only."
          />
          {surface.error ? (
            <p role="alert" className="text-[13px] text-lab-error">
              {surface.error}
            </p>
          ) : null}
        </div>

        <PreferencesZone surface={surface} />
        <ModelProviderZone />
        <RuntimeZone status={status} resources={resources} />
        <FastPathZone shops={surface.shops} onSeeded={surface.refresh} />
      </div>
    </AppShell>
  );
}
