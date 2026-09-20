import type {
  LabSeedResponse,
  LabStatusResponse,
  ProvenFrameworkSchema,
  ShopSummarySchema,
} from "@agent-lab/contracts";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { readAgentConfigurationResources } from "../api/agentConfigurations";
import { describeApiError } from "../api/client";
import { seedLab } from "../api/labSeed";
import { getLabStatus } from "../api/labStatus";
import { Card, EntryCard, EntryId, EntryKind } from "../components/WorkspaceChrome";
import { describeArchitecture, describeProvider, readableTerm } from "../lib/agents";
import { readNavigationCollapsed, writeNavigationCollapsed } from "../lib/preferences";
import { outlineButtonClasses, warningButtonClasses } from "../lib/ui";
import { LabSurface, useLabSurface } from "../shell/LabSurface";

function FrameworkRow({ framework }: { framework: ProvenFrameworkSchema }) {
  return (
    <EntryCard title={framework.label} chips={<EntryId value={framework.framework_id} />}>
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
 */
function SeedCard({ shops, onSeeded }: { shops: ShopSummarySchema[]; onSeeded: () => void }) {
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
    <Card title="The fast path">
      <p className="text-[13px] leading-relaxed text-admin-ink-soft">
        Creates a demo to look around: a shop with a catalog, a customer with an incident, and a
        finished comparison of two agent frameworks. It works on an empty lab only, and never
        touches a lab that already holds something.
      </p>
      {seeded === null ? (
        <div className="grid gap-1.5">
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
          <p className="text-xs text-admin-muted" role="status">
            {occupied
              ? "This lab is not empty, so there is nothing to create here."
              : arming
                ? "Nothing is created until you press again."
                : "The same thing make seed does in a terminal."}
          </p>
        </div>
      ) : (
        <div className="grid gap-1.5 border-t border-admin-border pt-3">
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
        <p role="alert" className="text-[13px] leading-relaxed text-lab-error">
          {refusal}
        </p>
      )}
    </Card>
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
    <Card title="Run mode">
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
            <p className="text-[13px] leading-relaxed text-admin-ink-soft">
              No provider credential is configured, so only the deterministic control arm can be
              advanced here: both model-backed frameworks reach their provider under the same
              credential, and an arm running either is refused the moment it is advanced. Any
              comparison this lab does hold offline — the seeded demo among them — has both arms'
              decisions held identical by construction, so what it establishes is the evidence
              model: that tool calls, state changes, objectives, traces and cost reach the record.
              Only a credentialed run answers how two frameworks actually choose.
            </p>
          ) : (
            <p className="text-[13px] leading-relaxed text-admin-ink-soft">
              A provider credential is configured, so a model-backed arm reaches the provider and a
              two-arm comparison can be about how the frameworks actually choose. What an experiment
              ran is still the model its published agent configuration named; the model above is
              only what this process would reach for.
            </p>
          )}
          <p className="text-xs text-admin-muted">
            Run mode is read from the environment when the API starts and cannot be changed from
            here. Set <code className="font-mono">AGENT_LAB_OPENAI_API_KEY</code> and restart the
            API to change it.
          </p>
        </>
      )}
    </Card>
  );
}

function TraceExportCard({ reading }: { reading: Reading<LabStatusResponse> }) {
  const status = reading.value;
  return (
    <Card title="Trace export">
      {status === null ? (
        <Unavailable reading={reading} />
      ) : status.trace_export_configured ? (
        <>
          <p className="text-[13px] text-admin-ink-soft">
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
        <>
          <p className="text-[13px] text-admin-ink-soft">
            No OTLP endpoint is configured. The lab still records a span tree beside every
            experiment arm it advances — the traces tab on a run reads that record, not an exporter
            — but nothing is exported anywhere.
          </p>
          <p className="text-[13px] leading-relaxed text-admin-ink-soft">
            To view traces locally, start{" "}
            <code className="font-mono">infra/phoenix/compose.yaml</code>, set{" "}
            <code className="font-mono">
              AGENT_LAB_OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:6006/v1/traces
            </code>{" "}
            and open <code className="font-mono">http://localhost:6006</code>.
          </p>
        </>
      )}
    </Card>
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

export function LabSettingsPage() {
  const surface = useLabSurface();
  const status = useReading(loadStatus, "The lab could not report how it is composed.");
  const resources = useReading(loadResources, "The lab could not report what it can run.");
  const [collapsedByDefault, setCollapsedByDefault] = useState(readNavigationCollapsed);

  function chooseCollapsedByDefault(next: boolean) {
    setCollapsedByDefault(next);
    writeNavigationCollapsed(next);
  }

  return (
    <LabSurface
      surface={surface}
      title="Lab settings"
      description="What this build can run, how it is composed to run it, and the two things this browser remembers. Credentials, the model and the trace exporter are read from the environment when the API starts; this page reports them and never edits them."
    >
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="grid content-start gap-4">
          <Card title="This build">
            <p className="text-[13px] text-admin-ink-soft">
              The frameworks this lab has an implementation for and a suite that keeps exercising
              it, with the envelope each was proven inside. An agent configuration naming a
              framework, architecture or provider outside this table cannot be published; naming a
              model outside it is a warning that does not block publication.
            </p>
            {resources.value === null ? (
              <Unavailable reading={resources} />
            ) : (
              <ul className="grid gap-2">
                {resources.value.frameworks.map((framework) => (
                  <FrameworkRow key={framework.framework_id} framework={framework} />
                ))}
              </ul>
            )}
          </Card>
          <RunModeCard reading={status} />
          <SeedCard shops={surface.shops} onSeeded={surface.refresh} />
        </div>

        <div className="grid content-start gap-4">
          <TraceExportCard reading={status} />
          <Card title="Workspace">
            <p className="text-[13px] text-admin-ink-soft">
              How this browser starts, and where it was. Both are per-viewer conveniences: neither
              reaches another browser, and neither is a fact about the lab.
            </p>
            <label className="flex items-start gap-2 text-[13px] text-admin-ink-soft">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={collapsedByDefault}
                onChange={(event) => chooseCollapsedByDefault(event.target.checked)}
              />
              <span>
                Start with the navigation rail collapsed
                <span className="block text-xs text-admin-muted">
                  The rail's collapse control writes the same preference. It is remembered in this
                  browser and reaches no other one.
                </span>
              </span>
            </label>
            <div className="grid gap-1 border-t border-admin-border pt-3 text-[13px] text-admin-ink-soft">
              <span className="text-xs font-semibold text-admin-muted">Last-visited shop</span>
              {surface.rememberedShop ? (
                <span>
                  <Link
                    className="font-semibold text-lab-ink underline-offset-2 hover:underline"
                    to={`/shops/${surface.rememberedShop.shop_id}`}
                  >
                    {surface.rememberedShop.name}
                  </Link>
                  <span className="block text-xs text-admin-muted">
                    What this page and the glossary offer a way back to.
                  </span>
                </span>
              ) : surface.loading || surface.error ? (
                // Until the shop list answers, this page has not established that there is no
                // remembered shop — only that it cannot yet name one.
                <span className="text-admin-muted">Reading…</span>
              ) : (
                <span className="text-admin-muted">
                  None yet. Open a shop and this browser remembers the way back.
                </span>
              )}
            </div>
          </Card>
        </div>
      </div>
    </LabSurface>
  );
}
