import type {
  DefinitionChangeSchema,
  DefinitionVersionSummarySchema,
  ExperimentSummarySchema,
  ScenarioSummarySchema,
  ShopPreviewResponse,
} from "@agent-lab/contracts";
import { type ReactNode, useEffect, useId, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { LabApiError } from "../api/client";
import { listExperiments } from "../api/experiments";
import { listShopVersions } from "../api/shops";
import { ButtonIcon } from "../components/ButtonIcon";
import {
  Card,
  EditorSaveActions,
  IssueList,
  PageHeader,
  PublishButton,
  PublishReasons,
  VersionChips,
} from "../components/WorkspaceChrome";
import { shopIssueEntries } from "../lib/issueRoutes";
import { type ActivityEntry, recentActivity } from "../lib/recentActivity";
import { formatTimestamp, labNoteClasses, outlineButtonClasses, surfaceClasses } from "../lib/ui";
import { useShopWorkspace } from "../shell/useShopWorkspace";

/**
 * The prototype's own description of the shop (`Workspace.dc.html`:723), which is where the
 * synthetic-sandbox note went: it is what this page is about rather than a banner over it.
 */
const SYNTHETIC_NOTE =
  "A synthetic shop. Everything in it is fictional test data that experiments read through tools.";

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/**
 * One stop on the version timeline: a published version, or the draft at the end of it.
 *
 * Every stop but the first leads with the connector the prototype draws between them
 * (`Workspace.dc.html`:734–741) — solid between published versions, dashed into the draft,
 * because the draft is not a version and the line into it is not a line between two. Both
 * colours are literals, which is the rule for a colour one file draws (*Tokens, type and
 * glyphs*). The connector is `aria-hidden` and takes the slack, so the stops keep one width.
 */
function TimelineNode({
  at,
  tone,
  label,
  note,
  lead,
}: {
  at: string;
  tone: "published" | "latest" | "draft";
  label: ReactNode;
  note?: string;
  /** The connector before this stop, absent on the first one. */
  lead?: "published" | "draft";
}) {
  const dot =
    tone === "draft"
      ? "h-[19px] w-[19px] border-2 border-dashed border-admin-draft-ink bg-admin-draft"
      : tone === "latest"
        ? "h-[19px] w-[19px] border-4 border-admin-published bg-lab-primary"
        : "h-[13px] w-[13px] bg-lab-primary";
  return (
    <li className={`flex items-start ${lead === undefined ? "flex-none" : "min-w-0 flex-1"}`}>
      {lead === undefined ? null : (
        <span
          aria-hidden
          className={`mt-[31px] min-w-6 flex-1 ${
            lead === "draft" ? "border-t-2 border-dashed border-[#d9c98f]" : "h-0.5 bg-[#cfe0d8]"
          }`}
        />
      )}
      <span className="grid w-[128px] flex-none justify-items-center gap-2 text-center">
        <span className="text-[11.5px] text-admin-muted">{at}</span>
        {/* The dot is the drawing of a state the words beside it already carry, so it is
            hidden: status is never colour alone (`docs/design-direction.md`, *Principles*). */}
        <span aria-hidden className={`rounded-full ${dot}`} />
        <span
          className={`text-[12.5px] font-bold ${
            tone === "draft" ? "text-admin-draft-ink" : "text-admin-published-ink"
          }`}
        >
          {label}
        </span>
        {note ? (
          <span className="text-[11.5px] leading-tight text-admin-ink-soft">{note}</span>
        ) : null}
      </span>
    </li>
  );
}

/**
 * Every published version of this shop, and the draft standing after them.
 *
 * The latest published version is marked *in use* because it is the one a resolution reads:
 * `ScenarioResolution` pins whatever is published when it resolves. How many scenarios and
 * experiments have read it — the prototype's "4 scenarios and 18 experiments read this one" —
 * is not drawn, because no payload this page holds carries either figure and a figure the
 * payload lacks is not faked.
 */
function VersionTimeline({
  versions,
  versionsError,
  preview,
}: {
  versions: DefinitionVersionSummarySchema[];
  versionsError: string | null;
  preview: ShopPreviewResponse | null;
}) {
  if (versionsError) {
    return (
      <p role="alert" className="text-[13px] text-lab-error">
        {versionsError}
      </p>
    );
  }
  const changes = preview?.changes.length ?? 0;
  const latest = preview?.latest_published_version ?? null;
  return (
    <ol className="flex flex-wrap items-start gap-y-4">
      {versions.map((version, position) => (
        <TimelineNode
          key={version.version}
          lead={position === 0 ? undefined : "published"}
          at={formatTimestamp(version.published_at)}
          tone={version.version === latest ? "latest" : "published"}
          label={
            <>
              <Link
                className="underline-offset-2 hover:underline"
                to={`versions/${version.version}`}
              >
                v{version.version}
              </Link>
              {version.version === latest ? " · in use" : null}
            </>
          }
          note={version.version === latest ? "What a scenario resolves against today." : undefined}
        />
      ))}
      <TimelineNode
        lead={versions.length === 0 ? undefined : "draft"}
        at="now"
        tone="draft"
        label={`Draft v${preview?.next_version ?? ""}`}
        note={
          changes === 0
            ? "Nothing to publish — it matches what is published."
            : `${plural(changes, "change")} · no experiment can see it`
        }
      />
    </ol>
  );
}

/** One row of *What this shop holds*: the figure, what it is, and the way in. */
function HoldsRow({
  count,
  label,
  note,
  linkLabel,
  to,
}: {
  count: number | null;
  label: string;
  note: string;
  linkLabel: string;
  to: string;
}) {
  return (
    <li className="flex items-center gap-4 border-b border-admin-border/60 px-4 py-3 last:border-b-0">
      {/* Absent while the listing is in flight or failed, and zero is drawn
          (`docs/design-direction.md`, *Lists and counts*). */}
      <span className="w-9 text-right font-display text-[21px] font-bold tabular-nums">
        {count ?? ""}
      </span>
      <span className="grid min-w-0 gap-0.5">
        <span className="text-[13.5px] font-semibold">{label}</span>
        <span className="text-[12.5px] text-admin-ink-soft">{note}</span>
      </span>
      <Link
        className="ml-auto text-[13px] font-semibold text-lab-ink underline-offset-2 hover:underline"
        to={to}
      >
        {linkLabel}
      </Link>
    </li>
  );
}

/** One line of *Recent activity*. */
function ActivityRow({ entry }: { entry: ActivityEntry }) {
  return (
    <li className="grid gap-0.5 border-b border-admin-border/60 px-4 py-2.5 text-[12.5px] leading-snug last:border-b-0">
      <span>
        {entry.kind}{" "}
        <Link
          className="font-semibold text-lab-ink underline-offset-2 hover:underline"
          to={entry.to}
        >
          {entry.name}
        </Link>{" "}
        {entry.said}
      </span>
      <span className="text-admin-muted">{formatTimestamp(entry.at)}</span>
    </li>
  );
}

/**
 * The shop's overview (`Workspace.dc.html`:722, DEPRECADED frame 1).
 *
 * Its spine is the version timeline and the two-step publish beneath it: *Review N changes &
 * publish* opens the list of what becomes the next version, and only the Publish inside that
 * list writes one. Publishing is the one act on this page that cannot be undone, and the
 * review is where the operator reads what they are freezing before they freeze it — the
 * prototype's own answer to a control that used to freeze a shop on one press.
 *
 * **Nothing here reads how far this lab has walked.** ADR 0044 refused a stored checklist and
 * ADR 0045 removed the derived progress strip, and neither comes back: *What this shop holds*
 * counts four listings and judges none of them, and *Run a comparison* reads the scenarios
 * listing and says one sentence. The difference is the one `docs/PLAN-UX.md` states — a count
 * is what a listing holds, a readiness reading is a verdict about what it does not.
 */
export function ShopHomePage() {
  const {
    shopId,
    content,
    listings,
    preview,
    publish,
    publishing,
    checking,
    save,
    saving,
    discard,
    discarding,
    dirty,
    error,
  } = useShopWorkspace();
  const [versions, setVersions] = useState<DefinitionVersionSummarySchema[]>([]);
  const [versionsError, setVersionsError] = useState<string | null>(null);
  const [published, setPublished] = useState<number | null>(null);
  const [reviewing, setReviewing] = useState(false);
  // The review's list is named by the sentence above it, so what becomes the next version is
  // one named thing rather than a second unnamed list beside the timeline's.
  const becomingId = useId();
  const publishReasonsId = useId();
  const [experiments, setExperiments] = useState<ExperimentSummarySchema[]>([]);
  const [experimentsError, setExperimentsError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    listShopVersions(shopId, controller.signal)
      .then((response) => {
        setVersions(response.versions);
        setVersionsError(null);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          // An empty timeline would otherwise read as "never published".
          setVersionsError(
            cause instanceof LabApiError ? cause.message : "Published versions are unavailable.",
          );
        }
      });
    return () => controller.abort();
  }, [shopId]);

  /**
   * The shop's experiments, read here rather than by the shell.
   *
   * ADR 0056 puts a listing on the workspace because the *rail* counts it on every screen, and
   * the bench entry deliberately carries no figure. This one is read by one surface, so it is
   * read on that surface — beside the versions read above, which is the same case and has
   * always lived here.
   */
  useEffect(() => {
    const controller = new AbortController();
    listExperiments(shopId, controller.signal)
      .then((response) => {
        setExperiments(response.experiments);
        setExperimentsError(null);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setExperimentsError(
            cause instanceof LabApiError ? cause.message : "The experiment lab is unavailable.",
          );
        }
      });
    return () => controller.abort();
  }, [shopId]);

  const entryOf = useMemo(
    () => shopIssueEntries(shopId, content.products),
    [shopId, content.products],
  );
  const activity = useMemo(
    () =>
      recentActivity({
        shopId,
        experiments,
        scenarios: listings.scenarios.rows,
        tickets: listings.tickets.rows,
      }),
    [shopId, experiments, listings.scenarios.rows, listings.tickets.rows],
  );

  const changes: DefinitionChangeSchema[] = preview?.changes ?? [];
  const nextVersion = preview?.next_version;
  /**
   * The published notice stands only while it is still true.
   *
   * `matches_latest_published` is a fact about the **saved** draft, so it is not on its own the
   * predicate for the sentence this branch writes — "your draft matches v4" is about the draft,
   * and a draft with unsaved edits does not match anything that is published. `dirty` is the
   * other half of that sentence, and this branch draws no `PublishReasons`, so nothing else
   * here would say "save the draft first".
   *
   * It is a correctness term rather than a fix for a state the operator can reach: nothing on
   * this page calls `edit`, and `published` is this page's own state, dropped when the operator
   * leaves to a screen that can dirty the draft. The term is what keeps the sentence true if
   * a later slice puts an editable row on the overview.
   */
  const justPublished =
    published !== null && preview?.matches_latest_published === true && !dirty ? published : null;

  /**
   * The keyboard follows the two-step publish, because each press unmounts the control that
   * made it.
   *
   * Without this, *Review N changes & publish* leaves focus on `body` and a reader tabs back
   * in from the top of the rail — twice, since Publish does it again. The shell already
   * manages focus across comparable transitions (`ShopSwitcher`, `TourLaunch`, the unsaved-work
   * dialog). The flag is what keeps it to presses: a footer that changed for any other reason
   * moves nobody's focus, and on first render there is nothing to have been pressed.
   */
  const pressed = useRef(false);
  const footerControl = useRef<HTMLElement | null>(null);
  const footerState = justPublished !== null ? "published" : reviewing ? "review" : "idle";
  const footerShown = useRef(footerState);
  useEffect(() => {
    const moved = footerShown.current !== footerState;
    footerShown.current = footerState;
    if (!moved || !pressed.current) {
      return;
    }
    pressed.current = false;
    footerControl.current?.focus();
  }, [footerState]);

  async function onPublish() {
    const version = await publish();
    if (version !== null) {
      // Only once the version exists: a refused publish leaves the operator on the review with
      // the reason, and the control they pressed still under their hands.
      pressed.current = true;
      setPublished(version);
      setReviewing(false);
      setVersions((await listShopVersions(shopId)).versions);
    }
  }

  return (
    <>
      <PageHeader
        title="Overview"
        chips={<VersionChips preview={preview} />}
        description={SYNTHETIC_NOTE}
        actions={
          <EditorSaveActions
            tone="accent"
            dirty={dirty}
            saving={saving}
            discarding={discarding}
            onSave={() => void save()}
            onDiscard={() => void discard()}
          />
        }
      />

      {error ? (
        <p role="alert" className="mb-4 text-[13px] text-lab-error">
          {error}
        </p>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_312px]">
        <div className="grid content-start gap-4">
          <Card
            title="Versions of this shop"
            footer={
              justPublished !== null ? (
                // The prototype draws this state on the same pine-on-cream pair the lab note
                // is drawn in (`#eaf4f0` over `#b7d9cc`), which is `labNoteClasses`.
                <div
                  role="status"
                  className={`flex flex-wrap items-center gap-2 px-3 py-2 text-[13.5px] ${labNoteClasses}`}
                >
                  <span aria-hidden className="font-bold text-admin-published-ink">
                    ✓
                  </span>
                  <span>
                    <strong>v{justPublished} is published.</strong> It is immutable. Your draft
                    matches v{justPublished}.
                  </span>
                  <Link
                    ref={(node) => {
                      footerControl.current = node;
                    }}
                    className="ml-auto font-semibold text-lab-ink underline-offset-2 hover:underline"
                    to="/lab/bench"
                  >
                    Point a scenario at v{justPublished} →
                  </Link>
                </div>
              ) : reviewing ? (
                <div className="grid gap-2.5">
                  <p className="text-[13.5px] font-bold" id={becomingId}>
                    {changes.length === 1
                      ? `This change becomes v${nextVersion}`
                      : `These ${changes.length} changes become v${nextVersion}`}
                  </p>
                  <ul aria-labelledby={becomingId} className="grid gap-1.5 text-[13px]">
                    {changes.map((change) => (
                      <li key={`${change.kind}:${change.path}`} className="flex gap-3">
                        <span className="w-[60px] flex-none font-mono text-[11.5px] text-admin-muted">
                          {change.kind}
                        </span>
                        <span className="text-admin-ink-soft">{change.description}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="flex flex-wrap items-center gap-2.5">
                    <PublishButton
                      ref={(node) => {
                        footerControl.current = node;
                      }}
                      variant="ink"
                      preview={preview}
                      dirty={dirty}
                      publishing={publishing}
                      checking={checking}
                      reasonsId={publishReasonsId}
                      onPublish={() => void onPublish()}
                    >
                      <ButtonIcon verb="publish" />
                      {publishing ? "Publishing…" : `Publish v${nextVersion}`}
                    </PublishButton>
                    <button
                      className={outlineButtonClasses}
                      type="button"
                      onClick={() => {
                        pressed.current = true;
                        setReviewing(false);
                      }}
                      disabled={publishing}
                    >
                      Keep editing
                    </button>
                    {preview?.latest_published_version === null ? null : (
                      <p className="text-[12.5px] text-admin-ink-soft">
                        Scenarios stay on v{preview?.latest_published_version} until you repoint
                        them.
                      </p>
                    )}
                  </div>
                  <PublishReasons
                    id={publishReasonsId}
                    preview={preview}
                    dirty={dirty}
                    checking={checking}
                  />
                </div>
              ) : (
                <div className="grid gap-2">
                  <div className="flex flex-wrap items-center gap-3.5">
                    <p className="text-[13.5px] text-admin-ink-soft">
                      Publishing freezes the draft as <strong>v{nextVersion}</strong>. Nothing
                      already published changes.
                    </p>
                    <PublishButton
                      ref={(node) => {
                        footerControl.current = node;
                      }}
                      variant="ink"
                      className="ml-auto"
                      preview={preview}
                      dirty={dirty}
                      publishing={false}
                      checking={checking}
                      reasonsId={publishReasonsId}
                      onPublish={() => {
                        pressed.current = true;
                        setReviewing(true);
                      }}
                    >
                      <ButtonIcon verb="publish" />
                      {changes.length === 0
                        ? `Publish v${nextVersion}`
                        : `Review ${plural(changes.length, "change")} & publish`}
                    </PublishButton>
                  </div>
                  <PublishReasons
                    id={publishReasonsId}
                    preview={preview}
                    dirty={dirty}
                    checking={checking}
                  />
                </div>
              )
            }
          >
            <p className="max-w-[620px] text-[13.5px] leading-relaxed text-admin-ink-soft">
              Experiments never read your edits. They read a <strong>published version</strong>,
              frozen forever. Your edits sit in a draft until you publish them as the next version.
            </p>
            <VersionTimeline versions={versions} versionsError={versionsError} preview={preview} />
          </Card>

          <section
            aria-label="What this shop holds"
            className={`${surfaceClasses} overflow-hidden`}
          >
            <h2 className="border-b border-admin-border px-4 py-3 font-display text-[17px] font-bold tracking-[-0.01em]">
              What this shop holds
            </h2>
            <ul>
              <HoldsRow
                count={content.products.length}
                label="Products"
                note={`${plural(
                  content.products.reduce((total, product) => total + product.variants.length, 0),
                  "sellable variant",
                )} across them.`}
                linkLabel="Open catalog"
                to="products"
              />
              <HoldsRow
                count={listings.orders.count}
                label="Orders"
                note="What a support agent reads and acts on."
                linkLabel="Open orders"
                to="orders"
              />
              <HoldsRow
                count={listings.tickets.count}
                label="Tickets"
                note="The incidents a scenario is composed on."
                linkLabel="Open tickets"
                to="tickets"
              />
              <HoldsRow
                count={listings.scenarios.count}
                label="Scenarios"
                note="The scenarios an experiment runs."
                linkLabel="Open scenarios"
                to="scenarios"
              />
            </ul>
          </section>
        </div>

        <div className="grid content-start gap-3.5">
          <RunAComparison
            loading={listings.scenarios.loading}
            error={listings.scenarios.error}
            scenarios={listings.scenarios.rows}
            shopVersion={preview?.latest_published_version ?? null}
          />

          <Card title="Findings on the draft">
            <IssueList issues={preview?.issues ?? []} entryOf={entryOf} />
          </Card>

          <Card title="Recent activity">
            {experimentsError ? (
              <p role="alert" className="text-[13px] text-lab-error">
                {experimentsError}
              </p>
            ) : null}
            {activity.length === 0 ? (
              <p className="text-[13px] text-admin-muted">
                Nothing has been authored in this shop yet.
              </p>
            ) : (
              <ol className="-m-4">
                {activity.map((entry) => (
                  <ActivityRow key={entry.key} entry={entry} />
                ))}
              </ol>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}

/**
 * What a comparison would run from this shop, and the way into one.
 *
 * **One listing, one sentence** (`docs/design-direction.md`, *Navigation and chrome*). It reads
 * the scenarios listing the workspace already holds and says either that a published scenario
 * exists — naming it, with a link to New experiment — or that none does, with a link to
 * Scenarios. That is the *empty state says why and links to the prerequisite* rule rather than
 * a reading of progress: nothing here counts steps, ticks anything, or judges the shop.
 *
 * The shop version is the one the named scenario would resolve against, read off the preview
 * this page already holds.
 *
 * **The sentence names what a comparison would run; it never says a comparison can run.** The
 * prototype writes "Everything this needs is ready", and that is a verdict nothing on this page
 * has read: starting an experiment needs two arms on *published agent configurations*, which
 * `start_experiment` refuses without (`AgentConfigurationVersionNotFoundError`) and which no
 * read here makes. A lab with a published scenario and no published configuration would be told
 * it was ready. So the card states the fact the listing holds — this scenario, at this version,
 * against this shop version — and the gate that a comparison actually passes stays where it is
 * enforced, on the bench's own Start.
 */
function RunAComparison({
  loading,
  error,
  scenarios,
  shopVersion,
}: {
  loading: boolean;
  error: string | null;
  scenarios: readonly ScenarioSummarySchema[];
  shopVersion: number | null;
}) {
  const ready = [...scenarios]
    .filter((scenario) => scenario.latest_published_version !== null)
    .sort((left, right) => right.updated_at.localeCompare(left.updated_at))[0];
  return (
    <section
      aria-label="Run a comparison"
      className="grid gap-2.5 rounded-[12px] bg-lab-ink px-5 py-4 text-[#b9cdc5]"
    >
      <h2 className="font-display text-base font-bold text-lab-paper">Run a comparison</h2>
      {error ? (
        <p role="alert" className="text-[13px] leading-relaxed">
          {error}
        </p>
      ) : loading ? null : ready === undefined ? (
        <>
          <p className="text-[13px] leading-relaxed">
            No scenario is published in this shop yet, and a comparison runs a published scenario.
          </p>
          <Link
            className="min-h-[42px] rounded-[9px] border border-[#2f5d51] px-4 text-center text-sm font-bold leading-[42px] text-lab-paper no-underline hover:bg-[#21453b]"
            to="scenarios"
          >
            Open scenarios
          </Link>
        </>
      ) : (
        <>
          <p className="text-[13px] leading-relaxed">
            A comparison runs{" "}
            <strong className="text-lab-paper">
              {ready.name} v{ready.latest_published_version}
            </strong>
            {shopVersion === null ? null : (
              <>
                {" "}
                against shop <strong className="text-lab-paper">v{shopVersion}</strong>
              </>
            )}
            .
          </p>
          <Link
            className="min-h-[42px] rounded-[9px] bg-lab-primary px-4 text-center text-sm font-bold leading-[42px] text-lab-paper no-underline hover:bg-lab-primary-hover"
            to="/lab/bench"
          >
            New experiment
          </Link>
        </>
      )}
    </section>
  );
}
